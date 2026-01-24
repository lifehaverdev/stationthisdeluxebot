/**
 * VastAIService - GPU rental orchestration for VastAI marketplace
 *
 * This service handles the full lifecycle of VastAI GPU rentals:
 *   - Searching for available offers (filtering by GPU type, region, price)
 *   - Provisioning instances with SSH key injection
 *   - Monitoring instance status until ready
 *   - Terminating instances when done
 *
 * IMPORTANT: VastAI API Quirks (discovered through debugging)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The VastAI API is inconsistent about field names and response structures.
 * This service normalizes these inconsistencies to provide a stable interface.
 *
 * 1. INSTANCE ID ON PROVISION
 *    - Sometimes returned as `new_contract`
 *    - Sometimes as `instances.id`
 *    - Sometimes missing entirely (must lookup by label)
 *
 * 2. GET INSTANCE RESPONSE
 *    - Data is wrapped in `response.instances` object, not direct
 *
 * 3. FIELD NAME VARIATIONS
 *    | Concept      | API may return        | We normalize to |
 *    |--------------|-----------------------|-----------------|
 *    | Instance ID  | id, instance_id, rental_id, new_contract | instanceId |
 *    | Public IP    | public_ipaddr, public_ip, ip | publicIp |
 *    | SSH Host     | ssh_host              | sshHost (proxy like ssh2.vast.ai) |
 *    | Status       | cur_state, actual_status, status, state | status |
 *    | GPU Name     | gpu_name              | gpuType |
 *    | VRAM         | vram_gb, gpu_ram (in MB or GB!) | vramGb |
 *
 * 4. SSH ROUTING
 *    - VastAI routes SSH through proxy hosts (ssh2.vast.ai:12345)
 *    - The `sshHost` field contains this, prefer it over `publicIp`
 *    - Port varies per instance (NOT always 22)
 *
 * 5. SSH KEY TIMING
 *    - Key is sent with provision request
 *    - Key must ALSO be registered in VastAI dashboard beforehand
 *    - Instance "running" != SSH ready (can take 30-60+ seconds more)
 *
 * @see notes/progress.md for debugging notes (in this directory)
 */
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

    // Filter out fractional GPU instances (gpu_frac < 1.0)
    // These cause CUDA OOM errors because they share GPU memory with other tenants
    if (criteria.requireFullGpu !== false) {
      q.gpu_frac = { gte: 1.0 };
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
      gpuFrac: rawOffer.gpu_frac ?? 1.0,  // Fraction of GPU (1.0 = full GPU)
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
    // Regions known to have SSH connectivity issues
    const BLOCKED_REGIONS = ['CN', 'China', 'HK', 'Hong Kong'];

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
      // Client-side fallback: filter out fractional GPUs
      if (criteria.requireFullGpu !== false && offer.gpuFrac < 1.0) {
        return false;
      }
      // Filter out blocked regions (known SSH connectivity issues)
      if (offer.region && BLOCKED_REGIONS.some(blocked =>
        offer.region.toLowerCase().includes(blocked.toLowerCase())
      )) {
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

    // VastAI extra_env must be an array of "KEY=value" strings, not an object
    let extraEnvArray = undefined;
    if (jobContext.extraEnv && typeof jobContext.extraEnv === 'object') {
      extraEnvArray = Object.entries(jobContext.extraEnv).map(([k, v]) => `${k}=${v}`);
    } else if (Array.isArray(jobContext.extraEnv)) {
      extraEnvArray = jobContext.extraEnv;
    }

    const payload = {
      disk: diskGb,
      image: jobContext.image || this.config.defaultImage,
      template_id: jobContext.templateId || this.config.preferredTemplates?.[0],
      template_hash_id: jobContext.templateHashId || undefined,
      extra_env: extraEnvArray,
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

  /**
   * Normalize raw VastAI instance data into consistent structure.
   *
   * VastAI API returns different field names depending on the endpoint and
   * context. This method handles all known variations.
   *
   * IMPORTANT: For SSH, prefer `sshHost` over `publicIp`. VastAI routes
   * connections through proxy hosts (ssh2.vast.ai) which are more reliable.
   */
  normalizeInstance(rawInstance = {}) {
    const ssh = rawInstance.ssh || rawInstance.connection || {};
    return {
      // ID can come from multiple fields depending on endpoint
      instanceId: rawInstance.id || rawInstance.instance_id || rawInstance.rental_id,
      // IP: prefer public_ipaddr (actual field name), fallback to alternatives
      publicIp: rawInstance.public_ipaddr || rawInstance.public_ip || ssh.hostname || rawInstance.ip,
      // SSH proxy host (e.g., ssh2.vast.ai) - PREFER THIS for SSH connections
      sshHost: rawInstance.ssh_host,
      // Port varies per instance, not always 22
      sshPort: ssh.port || rawInstance.ssh_port || 22,
      sshUser: ssh.user || rawInstance.ssh_user || 'root',
      templateId: rawInstance.image_id || rawInstance.template_id,
      // Status: cur_state is the actual field, others are fallbacks
      status: rawInstance.cur_state || rawInstance.actual_status || rawInstance.status || rawInstance.state,
      hourlyUsd: rawInstance.dph_total || rawInstance.price,
      gpuType: rawInstance.gpu_name,
      diskGb: rawInstance.disk || rawInstance.disk_space || rawInstance.disk_gb,
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

  /**
   * Provision a new VastAI instance.
   *
   * IMPORTANT: The response structure varies! Instance ID may come from:
   *   - response.new_contract (most common)
   *   - response.instance_id
   *   - response.id
   *   - response.instances.id
   *   - Or it may be MISSING entirely (fallback to label lookup)
   *
   * The caller should be prepared for instanceId to be null and use
   * findInstanceByLabel() as a fallback.
   */
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
    // VastAI API returns instance ID in different fields depending on the offer/endpoint
    // Check ALL known locations because consistency is not guaranteed
    const instanceId =
      response?.new_contract ||
      response?.instance_id ||
      response?.id ||
      response?.instances?.id;

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

  /**
   * Get current status of a VastAI instance.
   *
   * NOTE: The getInstance API wraps the data in an "instances" field,
   * unlike what you might expect. We unwrap it here for consistency.
   */
  async getInstanceStatus(instanceId) {
    const response = await this.client.getInstance(instanceId);
    // VastAI wraps instance data in an "instances" field (not "instance", plural!)
    const instanceData = response?.instances || response;
    return this.normalizeInstance(instanceData);
  }

  async attachSshKey(instanceId) {
    const publicKey = this.getPublicKey();
    this.logger.info(`[VastAI] Attaching SSH key to instance ${instanceId}...`);
    const result = await this.client.attachSshKey(instanceId, publicKey);
    if (result?.success === false) {
      throw new VastAIError(result?.msg || 'Failed to attach SSH key', { code: result?.error });
    }
    return result;
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
