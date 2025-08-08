// src/core/services/comfydeploy/modelDiscoveryService.js
// Combines Comfy-Deploy search API results with model names extracted
// from workflow enum inputs to produce a comprehensive list.
// Categories: checkpoint, lora, upscale, tagger, embedding, vae, other.

const WorkflowCacheManager = require('./workflowCacheManager');

class ModelDiscoveryService {
  /**
   * @param {Object} deps
   * @param {ComfyUIService} deps.comfyService  – an *initialised* ComfyUIService instance
   * @param {WorkflowCacheManager} [deps.workflowCache] – pass existing cache or fallback to singleton
   */
  constructor ({ comfyService, workflowCache } = {}) {
    if (!comfyService) throw new Error('ModelDiscoveryService requires comfyService');
    this.comfy = comfyService;
    if (workflowCache) {
      this.wfCache = workflowCache;
    } else {
      this.wfCache = new WorkflowCacheManager({
        apiUrl: comfyService.apiUrl,
        apiKey: comfyService.apiKey,
        timeout: comfyService.timeout,
        logger: comfyService.logger || console
      });
    }

    // In-memory cache: { data: Array, fetchedAt: number }
    this._cache = null;
    this._cacheAt = 0;
  }

  /** Fetch models from remote registry via search endpoint */
  async _fetchSearchCatalogue ({ provider = 'all' } = {}) {
    try {
      const res = await this.comfy._makeApiRequest(`/api/search/model?query=&provider=${provider}`, {
        headers: { 'Accept': 'application/json' }
      });
      const payload = await res.json();
      return Array.isArray(payload.models) ? payload.models : [];
    } catch (err) {
      this.comfy.logger?.warn?.('[ModelDiscoveryService] search catalogue error:', err.message);
      return [];
    }
  }

  /** Extract enum-based model names from cached workflows */
  async _extractWorkflowEnums () {
    await this.wfCache.ensureInitialized();
    const wfDatas = this.wfCache._workflows || [];
    const names = new Set();

    for (const wf of wfDatas) {
      const json = wf.workflowJson || wf.json || wf._workflowJson;
      if (!json || !Array.isArray(json.nodes)) continue;
      for (const node of json.nodes) {
        const widgets = node.widgets || [];
        widgets.forEach(w => {
          if (w && w.class_type === 'ComfyUIDeployExternalEnum' && /model/i.test(w.input_id || '')) {
            (w.enum_values || []).forEach(v => names.add(v));
          }
        });
      }
    }

    return [...names].map(n => ({ name: n, type: 'unknown', provider: 'workflow_enum' }));
  }

  /** Fetch models from private model volume (Modal filesystem) */
  async _fetchPrivateVolume () {
    try {
      const res = await this.comfy._makeApiRequest('/api/volume/private-models', {
        headers: { 'Accept': 'application/json' }
      });
      const payload = await res.json();
      if (!Array.isArray(payload)) return [];

      // Normalise keys so downstream filters work identically to search-API results
      return payload.map(rec => ({
        ...rec,
        save_path: rec.path || rec.save_path,
        provider: 'private_volume'
      }));
    } catch (err) {
      this.comfy.logger?.warn?.('[ModelDiscoveryService] private-volume fetch error:', err.message);
      return [];
    }
  }

  /**
   * Composite list.
   * @param {Object} opts
   * @param {string} [opts.category] – if provided filter to that category
   * @param {string} [opts.provider] – provider passed to search endpoint (default all)
   * @returns {Promise<Array>} – array of {name,type,provider,filename,save_path,…}
   */
  async listModels (opts = {}) {
    const { category, provider = 'all', includeWorkflowEnums = true } = opts;

    // --- TTL cache check (10-min default) ---
    const TTL_MS = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    if (this._cache && (now - this._cacheAt) < TTL_MS) {
      return category ? this._filterByCategory(this._cache, category) : this._cache;
    }

    const [privateVol, catalogue, enumModels] = await Promise.all([
      this._fetchPrivateVolume(),
      this._fetchSearchCatalogue({ provider }),
      includeWorkflowEnums ? this._extractWorkflowEnums() : Promise.resolve([])
    ]);

    const combined = [...privateVol, ...catalogue, ...enumModels];

    // cache results
    this._cache = combined;
    this._cacheAt = now;

    return category ? this._filterByCategory(combined, category) : combined;
  }

  /**
   * Helper to filter list by category using same logic as before.
   * @private
   */
  _filterByCategory (list, category) {
    if (!category) return list;
    const catLower = category.toLowerCase();
    return list.filter(m => {
      const path = (m.save_path || m.path || '').toString().toLowerCase();
      const type = (m.type !== undefined && m.type !== null ? String(m.type) : '').toLowerCase();
      if (catLower === 'checkpoint') return /checkpoint|checkpoints/.test(type) || /checkpoints/.test(path);
      if (catLower === 'lora')       return /lora(s)?/.test(type) || /lora(s)?/.test(path);
      if (catLower === 'upscale')    return /upscale/.test(type) || /upscale/.test(path);
      if (catLower === 'tagger')     return /tagger/.test(type) || /tagger/.test(path);
      if (catLower === 'embedding')  return /embedding/.test(type) || /embedding/.test(path);
      if (catLower === 'vae')        return /vae/.test(type) || /vae/.test(path);
      return true;
    });
  }
}

module.exports = ModelDiscoveryService; 