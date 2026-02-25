/**
 * LoraService
 *
 * In-process domain service for LoRA data access.
 * Replaces internalApiClient calls to GET /internal/v1/data/lora/trigger-map-data.
 *
 * Mirrors the trigger map logic in src/api/internal/loras/loraTriggerMapApi.js.
 */

const LoRAModelsDB = require('../../db/loRAModelDb');
const LoRAPermissionsDB = require('../../db/loRAPermissionsDb');
const { createLogger } = require('../../../../utils/logger');

const PUBLIC_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class LoraService {
  constructor({ loraModelsDb, loraPermissionsDb, logger } = {}) {
    this.loraModelsDb = loraModelsDb || new LoRAModelsDB(createLogger('LoRAModelsDB'));
    this.loraPermissionsDb = loraPermissionsDb || new LoRAPermissionsDB(createLogger('LoRAPermissionsDB'));
    this.logger = logger || createLogger('LoraService');

    // In-memory public LoRA cache — matches loraTriggerMapApi pattern
    this._publicLorasCache = null;
    this._publicTriggerMapCache = null;
    this._lastPublicRefresh = 0;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Build a trigger-map object from an array of normalised LoRA data objects.
   * Mirrors buildTriggerMapFromLoras() in loraTriggerMapApi.js.
   */
  _buildTriggerMap(loras) {
    const triggerMap = {};

    for (const loraDetails of loras) {
      const hasTriggers = Array.isArray(loraDetails.triggerWords) && loraDetails.triggerWords.length > 0;
      const hasCognates = Array.isArray(loraDetails.cognates) && loraDetails.cognates.length > 0;
      if (!hasTriggers && !hasCognates) continue;

      const loraDataForMap = {
        modelId: loraDetails.modelId ?? loraDetails._id?.toString(),
        slug: loraDetails.slug,
        defaultWeight: loraDetails.defaultWeight || 1.0,
        access: loraDetails.access || 'public',
        ownerAccountId: loraDetails.ownerAccountId || (loraDetails.ownedBy ? loraDetails.ownedBy.toString() : null),
        updatedAt: loraDetails.updatedAt || loraDetails.createdAt,
        checkpoint: loraDetails.checkpoint,
      };

      if (hasTriggers) {
        for (const triggerWord of loraDetails.triggerWords) {
          if (!triggerWord) continue;
          const key = triggerWord.toLowerCase();
          const dataToPush = { ...loraDataForMap, baseTrigger: triggerWord };
          if (!triggerMap[key]) triggerMap[key] = [];
          if (!triggerMap[key].some(m => m.modelId === dataToPush.modelId)) {
            triggerMap[key].push(dataToPush);
          }
        }
      }

      if (hasCognates) {
        for (const cognate of loraDetails.cognates) {
          if (!cognate?.word) continue;
          const key = cognate.word.toLowerCase();
          const effectiveBaseTrigger = cognate.replaceWith || (hasTriggers ? loraDetails.triggerWords[0] : cognate.word);
          const cognateDataForMap = {
            ...loraDataForMap,
            isCognate: true,
            replaceWithBaseTrigger: effectiveBaseTrigger,
          };
          if (!triggerMap[key]) triggerMap[key] = [];
          if (!triggerMap[key].some(m => m.modelId === cognateDataForMap.modelId)) {
            triggerMap[key].push(cognateDataForMap);
          }
        }
      }
    }

    return triggerMap;
  }

  async _refreshPublicCache() {
    try {
      const publicLoras = await this.loraModelsDb.findMany({ visibility: 'public' });
      this._publicLorasCache = publicLoras.map(lora => ({
        modelId: lora._id.toString(),
        slug: lora.slug,
        triggerWords: lora.triggerWords || [],
        cognates: lora.cognates || [],
        defaultWeight: lora.defaultWeight || 1.0,
        access: 'public',
        ownerAccountId: lora.ownedBy ? lora.ownedBy.toString() : null,
        updatedAt: lora.updatedAt || lora.createdAt,
        checkpoint: lora.checkpoint,
      }));
      this._publicTriggerMapCache = this._buildTriggerMap(this._publicLorasCache);
      this._lastPublicRefresh = Date.now();
      this.logger.info(`[LoraService] Public cache refreshed: ${this._publicLorasCache.length} LoRAs, ${Object.keys(this._publicTriggerMapCache).length} trigger keys`);
    } catch (err) {
      this.logger.error('[LoraService] Failed to refresh public cache:', err.message);
      // On error, leave existing cache in place (stale cache is better than nothing)
      if (!this._publicTriggerMapCache) {
        this._publicLorasCache = [];
        this._publicTriggerMapCache = {};
      }
    }
  }

  async _ensurePublicCache() {
    const stale = (Date.now() - this._lastPublicRefresh) > PUBLIC_CACHE_TTL_MS;
    if (!this._publicTriggerMapCache || stale) {
      await this._refreshPublicCache();
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Get trigger map data — replaces GET /internal/v1/data/lora/trigger-map-data.
   *
   * Returns a plain object keyed by lowercase trigger word / cognate.
   * Each value is an array of LoRA info objects (same shape as the HTTP API).
   *
   * @param {string|null} userId - masterAccountId; if provided, includes user-accessible private LoRAs
   * @returns {Promise<object>}
   */
  async getTriggerMapData(userId) {
    await this._ensurePublicCache();

    if (!userId) {
      return this._publicTriggerMapCache || {};
    }

    // Clone public map so we don't mutate the cache
    const triggerMap = JSON.parse(JSON.stringify(this._publicTriggerMapCache || {}));
    const publicIds = new Set((this._publicLorasCache || []).map(l => l.modelId));

    try {
      const permissions = await this.loraPermissionsDb.listAccessibleLoRAs(userId);
      this.logger.info(`[LoraService] User ${userId} has ${permissions.length} LoRA permission(s).`);

      for (const permission of permissions) {
        if (publicIds.has(permission.loraId.toString())) continue;

        const privateLora = await this.loraModelsDb.findById(permission.loraId);
        if (!privateLora) continue;

        const privateData = {
          modelId: privateLora._id.toString(),
          slug: privateLora.slug,
          triggerWords: privateLora.triggerWords || [],
          cognates: privateLora.cognates || [],
          defaultWeight: privateLora.defaultWeight || 1.0,
          access: 'private',
          ownerAccountId: privateLora.ownedBy ? privateLora.ownedBy.toString() : userId,
          updatedAt: privateLora.updatedAt || privateLora.createdAt,
          checkpoint: privateLora.checkpoint,
        };

        for (const triggerWord of privateData.triggerWords) {
          if (!triggerWord) continue;
          const key = triggerWord.toLowerCase();
          const dataToPush = { ...privateData, baseTrigger: triggerWord };
          if (!triggerMap[key]) triggerMap[key] = [];
          if (!triggerMap[key].some(m => m.modelId === dataToPush.modelId)) {
            triggerMap[key].push(dataToPush);
          }
        }

        for (const cognate of privateData.cognates) {
          if (!cognate?.word) continue;
          const key = cognate.word.toLowerCase();
          const effectiveBaseTrigger = cognate.replaceWith || (privateData.triggerWords.length > 0 ? privateData.triggerWords[0] : cognate.word);
          const cognateData = {
            ...privateData,
            isCognate: true,
            replaceWithBaseTrigger: effectiveBaseTrigger,
          };
          if (!triggerMap[key]) triggerMap[key] = [];
          if (!triggerMap[key].some(m => m.modelId === cognateData.modelId)) {
            triggerMap[key].push(cognateData);
          }
        }
      }
    } catch (err) {
      this.logger.error(`[LoraService] Error fetching private LoRAs for user ${userId}:`, err.message);
      // Return whatever we have (public map + any private ones successfully merged so far)
    }

    return triggerMap;
  }

  /**
   * Invalidate the public LoRA cache.
   * Call after creating or updating a public LoRA to force a fresh DB read on the next request.
   */
  invalidatePublicCache() {
    this._publicLorasCache = null;
    this._publicTriggerMapCache = null;
    this._lastPublicRefresh = 0;
    this.logger.info('[LoraService] Public trigger map cache invalidated.');
  }
}

// Module-level singleton — callers that can't receive injection import this directly
const loraService = new LoraService();

module.exports = { LoraService, loraService };
