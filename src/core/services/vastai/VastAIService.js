const fs = require('fs');
const { ComputeProvider } = require('../compute');
const { getVastAIConfig } = require('../../../config/vastai');
const VastAIClient = require('./VastAIClient');
const VastAIError = require('./VastAIError');

class VastAIService extends ComputeProvider {
  constructor({ logger, config } = {}) {
    super({ logger });
    this.config = getVastAIConfig(config);
    this.client = new VastAIClient({
      apiKey: this.config.apiKey,
      apiBaseUrl: this.config.apiBaseUrl,
      logger: this.logger
    });
  }

  ensureSshKeyConfigured() {
    if (!this.config.sshKeyPath) {
      throw new Error('VastAIService requires VASTAI_SSH_KEY_PATH to provision servers');
    }
    const privateKeyExists = fs.existsSync(this.config.sshKeyPath);
    const publicKeyExists = fs.existsSync(`${this.config.sshKeyPath}.pub`);
    if (!privateKeyExists || !publicKeyExists) {
      throw new Error(`VastAI SSH keypair not found at ${this.config.sshKeyPath}`);
    }
  }

  getPublicKey() {
    if (!this.publicKey) {
      this.ensureSshKeyConfigured();
      this.publicKey = fs.readFileSync(`${this.config.sshKeyPath}.pub`, 'utf8').trim();
    }
    return this.publicKey;
  }

  buildOfferQuery(criteria = {}) {
    const q = {
      order: [['dph_total', 'asc']],
      limit: criteria.limit || 50,
      rentable: { eq: true },
      external: { eq: false },
      rented: { eq: false }
    };

    if (criteria.onlyVerified !== false) {
      q.verified = { eq: true };
    }

    const gpuType = criteria.gpuType || this.config.preferredGpuTypes?.[0];
    if (gpuType && criteria.useExactGpuMatch) {
      q.gpu_name = { eq: gpuType };
    }

    const minVramGb = criteria.minVramGb || this.config.minVramGb;
    if (minVramGb) {
      q.gpu_ram = { gte: minVramGb * 1024 }; // VastAI expects MB
    }

    if (criteria.region) {
      q.geolocation = { in: Array.isArray(criteria.region) ? criteria.region : [criteria.region] };
    }

    if (criteria.extra && typeof criteria.extra === 'object') {
      Object.assign(q, criteria.extra);
    }

    return {
      select_cols: ['*'],
      q
    };
  }

  normalizeOffer(rawOffer = {}) {
    const rawVram = rawOffer.vram_gb ?? rawOffer.gpu_ram;
    const vramGb = rawVram
      ? rawVram > 500 ? rawVram / 1024 : rawVram
      : undefined;

    const hourlyUsd = parseFloat(rawOffer.dph_base || rawOffer.dph_total || rawOffer.price || 0);
    return {
      id: rawOffer.id || rawOffer.offer_id || rawOffer.machine_id,
      gpuType: rawOffer.gpu_name,
      vramGb,
      hourlyUsd,
      region: rawOffer.region || rawOffer.country || rawOffer.geolocation,
      reliability: rawOffer.reliability || rawOffer.host_score,
      templateId: rawOffer.template_id,
      raw: rawOffer
    };
  }

  async searchOffers(criteria = {}) {
    const body = this.buildOfferQuery(criteria);
    const data = await this.client.searchOffers(body);
    const offers = data?.offers || data?.data || [];
    const normalized = (Array.isArray(offers) ? offers : Object.values(offers || {})).map((offer) =>
      this.normalizeOffer(offer)
    );
    return this.filterAndSortOffers(normalized, criteria);
  }

  filterAndSortOffers(offers = [], criteria = {}) {
    const filtered = offers.filter((offer) => {
      if (criteria.gpuType && !criteria.useExactGpuMatch) {
        const q = criteria.gpuType.toLowerCase();
        if (!offer.gpuType?.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (criteria.minVramGb && offer.vramGb && offer.vramGb < criteria.minVramGb) {
        return false;
      }
      if (criteria.maxHourlyUsd && offer.hourlyUsd && offer.hourlyUsd > criteria.maxHourlyUsd) {
        return false;
      }
      return true;
    });

    const sortBy = criteria.sortBy || 'hourlyUsd';
    const direction = (criteria.sortDirection || 'asc').toLowerCase();
    filtered.sort((a, b) => {
      const av = a[sortBy] ?? 0;
      const bv = b[sortBy] ?? 0;
      if (av === bv) return 0;
      return av < bv ? -1 : 1;
    });
    if (direction === 'desc') {
      filtered.reverse();
    }
    return filtered;
  }

  buildInstancePayload(jobContext = {}) {
    const diskGb = jobContext.diskGb || this.config.defaultDiskGb;
    const payload = {
      disk: diskGb,
      image: jobContext.image || this.config.defaultImage,
      template_id: jobContext.templateId || this.config.preferredTemplates?.[0],
      template_hash_id: jobContext.templateHashId || undefined,
      extra_env: jobContext.extraEnv,
      runtype: jobContext.runtimeType,
      onstart: jobContext.onstartCmd || jobContext.startupScript || undefined,
      label: jobContext.label || this.generateLabel(jobContext),
      price: jobContext.priceUsdPerHour || undefined,
      target_state: jobContext.targetState || 'running',
      direct: jobContext.direct ?? true,
      client_id: jobContext.clientId,
      apikey_id: jobContext.apiKeyId,
      ssh_key: this.getPublicKey(),
      ssh: jobContext.ssh ?? true
    };

    if (!payload.image && !payload.template_id) {
      throw new VastAIError('VastAI provisioning requires either an image or template_id');
    }

    // Remove undefined/null fields
    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined || payload[key] === null) {
        delete payload[key];
      }
    });

    return payload;
  }

  normalizeInstance(rawInstance = {}) {
    const ssh = rawInstance.ssh || rawInstance.connection || {};
    return {
      instanceId: rawInstance.id || rawInstance.instance_id || rawInstance.rental_id,
      publicIp: rawInstance.public_ip || ssh.hostname || rawInstance.ip,
      sshPort: ssh.port || rawInstance.ssh_port || 22,
      sshUser: ssh.user || rawInstance.ssh_user || 'root',
      templateId: rawInstance.image_id || rawInstance.template_id,
      status: rawInstance.status || rawInstance.state,
      hourlyUsd: rawInstance.dph_total || rawInstance.price,
      gpuType: rawInstance.gpu_name,
      diskGb: rawInstance.disk || rawInstance.disk_gb,
      raw: rawInstance,
      label: rawInstance.label
    };
  }

  generateLabel(jobContext = {}) {
    if (jobContext.jobId) {
      return `stationthis-${jobContext.jobId}`;
    }
    return `stationthis-${Date.now()}`;
  }

  async findInstanceByLabel(label) {
    if (!label) {
      return null;
    }
    const data = await this.client.listInstances();
    const instances = data?.instances || data?.data || [];
    const match = instances.find((instance) => instance.label === label);
    if (!match) {
      return null;
    }
    return this.normalizeInstance(match);
  }

  async provisionInstance(jobContext = {}) {
    this.ensureSshKeyConfigured();
    const offerId = jobContext.offerId || jobContext.offer?.id;
    if (!offerId) {
      throw new VastAIError('offerId is required to provision a VastAI instance');
    }

    const payload = this.buildInstancePayload(jobContext);
    const response = await this.client.createInstance(offerId, payload);
    if (response?.success === false) {
      throw new VastAIError(response?.msg || 'Failed to create VastAI instance', { code: response?.error });
    }
    const instanceId = response?.new_contract || response?.instance_id || response?.id;

    if (instanceId) {
      return this.getInstanceStatus(instanceId);
    }

    this.logger.warn('[VastAI] createInstance returned no instance ID, falling back to label lookup');
    const fallback = await this.findInstanceByLabel(payload.label);
    if (!fallback) {
      return {
        instanceId: null,
        raw: response
      };
    }
    return fallback;
  }

  async getInstanceStatus(instanceId) {
    const response = await this.client.getInstance(instanceId);
    return this.normalizeInstance(response);
  }

  async terminateInstance(instanceId, { deleteInstance = true } = {}) {
    if (deleteInstance) {
      await this.client.deleteInstance(instanceId);
    } else {
      await this.client.stopInstance(instanceId);
    }
    this.logger.info(`[VastAI] Instance ${instanceId} ${deleteInstance ? 'deleted' : 'stopped'}`);
  }
}

module.exports = VastAIService;
