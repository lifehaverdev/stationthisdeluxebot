/**
 * LoraService
 *
 * In-process domain service for LoRA data access.
 * Replaces internalApiClient calls to:
 *   GET  /internal/v1/data/lora/trigger-map-data  (Phase 6a)
 *   GET  /internal/v1/data/loras/list              (Phase 6b)
 *   GET  /internal/v1/data/loras/categories        (Phase 6b)
 *   GET  /internal/v1/data/loras/:id               (Phase 6b)
 *   POST /internal/v1/data/loras/:id/tag           (Phase 6b)
 *   POST /internal/v1/data/loras/:id/rate          (Phase 6b)
 *   POST /internal/v1/data/models/lora/import      (Phase 6b)
 */

const LoRAModelsDB = require('../../db/loRAModelDb');
const LoRAPermissionsDB = require('../../db/loRAPermissionsDb');
const UserPreferencesDB = require('../../db/userPreferencesDb');
const { ObjectId } = require('../../db/BaseDB');
const { createLogger } = require('../../../../utils/logger');

const PUBLIC_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const SORT_MAP = {
  recent:         { createdAt: -1 },
  createdAt_desc: { createdAt: -1 },
  createdAt_asc:  { createdAt: 1 },
  popular:        { usageCount: -1 },
  name_asc:       { name: 1 },
  name_desc:      { name: -1 },
  price_asc:      { 'monetization.priceUSD': 1 },
  price_desc:     { 'monetization.priceUSD': -1 },
  rating_desc:    { 'rating.sum': -1 },
  rating_asc:     { 'rating.sum': 1 },
};

const OBJ_ID_RE = /^[0-9a-fA-F]{24}$/;

class LoraService {
  constructor({ loraModelsDb, loraPermissionsDb, userPreferencesDb, logger } = {}) {
    this.loraModelsDb = loraModelsDb || new LoRAModelsDB(createLogger('LoRAModelsDB'));
    this.loraPermissionsDb = loraPermissionsDb || new LoRAPermissionsDB(createLogger('LoRAPermissionsDB'));
    this.userPreferencesDb = userPreferencesDb || new UserPreferencesDB(createLogger('UserPreferencesDB'));
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

  // ── Phase 6a ───────────────────────────────────────────────────────────────

  /**
   * Get trigger map data — replaces GET /internal/v1/data/lora/trigger-map-data.
   * @param {string|null} userId - masterAccountId; includes user-accessible private LoRAs when provided
   * @returns {Promise<object>}
   */
  async getTriggerMapData(userId) {
    await this._ensurePublicCache();

    if (!userId) {
      return this._publicTriggerMapCache || {};
    }

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
          const cognateData = { ...privateData, isCognate: true, replaceWithBaseTrigger: effectiveBaseTrigger };
          if (!triggerMap[key]) triggerMap[key] = [];
          if (!triggerMap[key].some(m => m.modelId === cognateData.modelId)) {
            triggerMap[key].push(cognateData);
          }
        }
      }
    } catch (err) {
      this.logger.error(`[LoraService] Error fetching private LoRAs for user ${userId}:`, err.message);
    }

    return triggerMap;
  }

  // ── Phase 6b ───────────────────────────────────────────────────────────────

  /**
   * List LoRAs with filtering, sorting, and pagination.
   * Replaces GET /internal/v1/data/loras/list.
   *
   * @param {object} opts
   * @param {string}  [opts.userId]
   * @param {string}  [opts.checkpoint]
   * @param {string}  [opts.q]             - search query
   * @param {string}  [opts.category]
   * @param {string}  [opts.tag]
   * @param {string}  [opts.filterType]    - popular | recent | favorites | type_<category>
   * @param {string}  [opts.sort]          - see SORT_MAP
   * @param {number}  [opts.page=1]
   * @param {number}  [opts.limit=10]
   * @param {boolean} [opts.includeCivitaiTags=false]
   * @returns {Promise<{ loras: object[], pagination: object }>}
   */
  async listLoras({ userId, checkpoint, q, category, tag, filterType, sort, page = 1, limit = 10, includeCivitaiTags = false } = {}) {
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    let dbQuery = {};
    let sortOptions = {};
    let MAID = null;

    // Visibility: public + any private the user can access
    if (userId) {
      MAID = new ObjectId(userId);
      const permissions = await this.loraPermissionsDb.listAccessibleLoRAs(userId);
      const privateIds = permissions.map(p => p.loraId);
      dbQuery.$or = [
        { visibility: 'public' },
        { _id: { $in: privateIds } },
      ];
    } else {
      dbQuery.visibility = 'public';
    }

    if (checkpoint && checkpoint.toLowerCase() !== 'all') {
      dbQuery.checkpoint = checkpoint;
    }

    if (tag) {
      dbQuery['tags.tag'] = tag;
    }

    if (category && category.toLowerCase() !== 'all') {
      const catCond = [{ category }, { 'tags.tag': category }];
      if (dbQuery.$or) {
        // Wrap existing $or + new category $or in $and
        dbQuery = { $and: [{ $or: dbQuery.$or }, { $or: catCond }] };
      } else {
        dbQuery.$or = catCond;
      }
    }

    if (q) {
      dbQuery.$or = [
        { name: { $regex: q, $options: 'i' } },
        { slug: { $regex: q, $options: 'i' } },
        { triggerWords: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { 'tags.tag': { $regex: q, $options: 'i' } },
      ];
    }

    if (filterType) {
      if (filterType.startsWith('type_')) {
        dbQuery['tags.tag'] = filterType.substring(5);
        sortOptions = { createdAt: -1 };
      } else if (filterType === 'popular') {
        sortOptions = { usageCount: -1 };
      } else if (filterType === 'recent') {
        sortOptions = { createdAt: -1 };
      } else if (filterType === 'favorites') {
        if (!MAID) {
          const err = new Error('userId required for favorites filter');
          err.statusCode = 400;
          throw err;
        }
        const favIds = await this.userPreferencesDb.getLoraFavoriteIds(MAID);
        if (favIds.length === 0) {
          return { loras: [], pagination: { currentPage: pageNum, totalPages: 0, totalLoras: 0, limit: limitNum } };
        }
        dbQuery._id = { $in: favIds.filter(id => OBJ_ID_RE.test(id)).map(id => new ObjectId(id)) };
        sortOptions = { createdAt: -1 };
      }
    }

    if (sort && SORT_MAP[sort]) {
      sortOptions = SORT_MAP[sort];
    }

    // Fetch favorites set for isFavorite annotation
    let userFavSet = new Set();
    if (MAID) {
      const favIds = await this.userPreferencesDb.getLoraFavoriteIds(MAID);
      userFavSet = new Set(favIds);
    }

    const mapLora = (lora) => {
      const cleanTags = (lora.tags || []).filter(t => {
        if (includeCivitaiTags) return true;
        if (typeof t === 'string') return true;
        return (t.source || '').toLowerCase() !== 'civitai';
      });
      return {
        _id: lora._id.toString(),
        slug: lora.slug,
        name: lora.name,
        triggerWords: lora.triggerWords || [],
        checkpoint: lora.checkpoint,
        tags: cleanTags,
        createdAt: lora.createdAt,
        previewImageUrl: lora.previewImages?.[0] || null,
        ownedBy: lora.ownedBy ? lora.ownedBy.toString() : null,
        monetization: lora.monetization,
        isPurchased: userFavSet.has(lora._id.toString()),
      };
    };

    // Special default sort: favorites + recency boost via aggregate pipeline
    if (!sort && !filterType) {
      const totalLoras = await this.loraModelsDb.count(dbQuery);
      const recentThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const favoriteObjectIds = userFavSet.size
        ? Array.from(userFavSet).filter(id => OBJ_ID_RE.test(id)).map(id => new ObjectId(id))
        : [];

      const pipeline = [
        { $match: dbQuery },
        { $addFields: {
          isFavorite: favoriteObjectIds.length ? { $in: ['$_id', favoriteObjectIds] } : false,
          isRecent: { $gte: ['$createdAt', recentThreshold] },
        }},
        { $sort: { isFavorite: -1, isRecent: -1, createdAt: -1, usageCount: -1 } },
        { $skip: skip },
        { $limit: limitNum },
      ];

      const lorasFromDb = await this.loraModelsDb.aggregate(pipeline);
      return {
        loras: lorasFromDb.map(mapLora),
        pagination: { currentPage: pageNum, totalPages: Math.ceil(totalLoras / limitNum), totalLoras, limit: limitNum },
      };
    }

    const totalLoras = await this.loraModelsDb.count(dbQuery);
    const lorasFromDb = await this.loraModelsDb.findMany(dbQuery, { sort: sortOptions, skip, limit: limitNum });

    return {
      loras: lorasFromDb.map(mapLora),
      pagination: { currentPage: pageNum, totalPages: Math.ceil(totalLoras / limitNum), totalLoras, limit: limitNum },
    };
  }

  /**
   * Get distinct LoRA categories.
   * Replaces GET /internal/v1/data/loras/categories.
   * @returns {Promise<string[]>}
   */
  async getCategories() {
    return this.loraModelsDb.listCategories();
  }

  /**
   * Get a single LoRA by slug or ObjectId string.
   * Replaces GET /internal/v1/data/loras/:loraIdentifier.
   *
   * @param {string} loraIdentifier - slug or ObjectId hex string
   * @param {object} [opts]
   * @param {string}  [opts.userId]
   * @param {boolean} [opts.isAdmin=false]
   * @returns {Promise<object|null>}  null → 404; throws with .statusCode=403 on access denied
   */
  async getById(loraIdentifier, { userId, isAdmin = false } = {}) {
    let lora = await this.loraModelsDb.findOne({ slug: loraIdentifier });

    if (!lora) {
      try {
        lora = await this.loraModelsDb.findById(loraIdentifier);
      } catch (_) { /* invalid ObjectId format — leave lora null */ }
    }

    if (!lora) return null;

    // Permission check for private LoRAs
    if (lora.visibility === 'private' && !isAdmin) {
      if (!userId) {
        const err = new Error('Access denied. This LoRA is private and requires user authentication.');
        err.statusCode = 403;
        throw err;
      }
      const hasAccess = await this.loraPermissionsDb.hasAccess(userId, lora._id.toString());
      if (!hasAccess) {
        const err = new Error('Access denied to this private LoRA.');
        err.statusCode = 403;
        throw err;
      }
    }

    let isFavorite = false;
    if (userId) {
      const MAID = new ObjectId(userId);
      const favIds = await this.userPreferencesDb.getLoraFavoriteIds(MAID);
      isFavorite = favIds.includes(lora._id.toString());
    }

    return {
      _id: lora._id.toString(),
      slug: lora.slug,
      name: lora.name,
      description: lora.description,
      triggerWords: lora.triggerWords || [],
      cognates: lora.cognates || [],
      tags: lora.tags || [],
      checkpoint: lora.checkpoint,
      baseModel: lora.baseModel,
      version: lora.versionInfo,
      visibility: lora.visibility || 'public',
      ownedBy: lora.ownedBy ? lora.ownedBy.toString() : null,
      usageCount: lora.usageCount || 0,
      lastUsedAt: lora.lastUsedAt,
      rating: lora.rating || { sum: 0, count: 0 },
      ratingAvg: lora.rating?.count ? (lora.rating.sum / lora.rating.count) : 0,
      previewImages: lora.previewImages || [],
      downloadUrl: lora.downloadUrl,
      civitaiPageUrl: lora.civitaiPageUrl,
      notes: lora.notes,
      defaultWeight: lora.defaultWeight || 1.0,
      createdAt: lora.createdAt,
      updatedAt: lora.updatedAt,
      isFavorite,
    };
  }

  /**
   * Add a user tag to a LoRA.
   * Replaces POST /internal/v1/data/loras/:loraId/tag.
   *
   * @param {string} loraId - ObjectId hex or slug
   * @param {string} tag
   * @param {string} userId
   * @returns {Promise<{ ok: boolean, tag: string }>}
   */
  async addTag(loraId, tag, userId) {
    const MAID = new ObjectId(userId);
    const tagObj = { tag: tag.toLowerCase(), source: 'user', addedBy: MAID, addedAt: new Date() };
    const query = OBJ_ID_RE.test(loraId) ? { _id: new ObjectId(loraId) } : { slug: loraId };

    await this.loraModelsDb.updateOne(query, { $addToSet: { tags: tagObj } });

    const loraDoc = await this.loraModelsDb.findOne(query);
    const canonicalId = loraDoc ? loraDoc._id.toString() : loraId;
    await this.userPreferencesDb.addModelFavorite(MAID, 'loraAddedTags', { loraId: canonicalId, tag: tagObj.tag });

    return { ok: true, tag: tagObj.tag };
  }

  /**
   * Rate a LoRA (1–3 stars).
   * Replaces POST /internal/v1/data/loras/:loraId/rate.
   *
   * @param {string} loraId - ObjectId hex or slug
   * @param {number} stars  - 1 | 2 | 3
   * @param {string} userId
   * @returns {Promise<{ ok: boolean }>}
   */
  async addRating(loraId, stars, userId) {
    const n = Number(stars);
    if (![1, 2, 3].includes(n)) {
      const err = new Error('invalid stars: must be 1, 2, or 3');
      err.statusCode = 400;
      throw err;
    }
    const MAID = new ObjectId(userId);
    const query = OBJ_ID_RE.test(loraId) ? { _id: new ObjectId(loraId) } : { slug: loraId };

    await this.loraModelsDb.updateOne(query, { $inc: { 'rating.sum': n, 'rating.count': 1 } });

    const loraDoc = await this.loraModelsDb.findOne(query);
    const canonicalId = loraDoc ? loraDoc._id.toString() : loraId;
    await this.userPreferencesDb.setPreferenceByKey(MAID, 'loraRatings', { [canonicalId]: n });

    return { ok: true };
  }

  /**
   * Import a LoRA from a Civitai or HuggingFace URL.
   * Replaces the chain: POST /models/lora/import → /internal/v1/data/models/lora/import → /internal/v1/data/loras/import
   *
   * @param {string} loraUrl
   * @param {string} masterAccountId
   * @returns {Promise<{ slug: string, name: string }>}
   */
  async importFromUrl(loraUrl, masterAccountId) {
    const {
      extractCivitaiModelId,
      extractCivitaiModelVersionId,
      fetchCivitaiMetadata,
      extractHFRepoId,
      fetchHuggingFaceMetadata,
    } = require('../../../../utils/loraImportService');

    const SUPPORTED_CHECKPOINTS = ['SDXL', 'SD1.5', 'FLUX', 'SD3', 'KONTEXT'];
    const DISALLOWED_DOWNLOAD_HOSTS = ['r2.dev'];

    const mapBaseModel = (str) => {
      if (!str) return null;
      const s = str.toLowerCase();
      if (s.includes('sdxl')) return 'SDXL';
      if (s.includes('sd 3') || s.includes('sd3')) return 'SD3';
      if (s.includes('sd 1.5') || s.includes('sd1.5')) return 'SD1.5';
      if (s.includes('kontext')) return 'KONTEXT';
      if (s.includes('flux')) return 'FLUX';
      const upper = str.toUpperCase();
      return SUPPORTED_CHECKPOINTS.includes(upper) ? upper : null;
    };

    let source = null;
    let meta = null;
    let importDetails = { url: loraUrl, source: null, originalAuthor: null, modelFileUrl: null };

    if (loraUrl.includes('civitai.com')) {
      source = 'civitai';
      importDetails.source = source;
      const modelId = extractCivitaiModelId(loraUrl);
      const versionId = extractCivitaiModelVersionId(loraUrl);
      if (!modelId) {
        const err = new Error('Invalid Civitai URL or could not extract model ID.');
        err.statusCode = 400;
        throw err;
      }
      meta = await fetchCivitaiMetadata(modelId, versionId);
      if (meta) {
        importDetails.originalAuthor = meta.originalAuthor;
        importDetails.modelFileUrl = meta.downloadUrl;
      }
    } else if (loraUrl.includes('huggingface.co')) {
      source = 'huggingface';
      importDetails.source = source;
      const repoId = extractHFRepoId(loraUrl);
      if (!repoId) {
        const err = new Error('Invalid Hugging Face URL or could not extract repository ID.');
        err.statusCode = 400;
        throw err;
      }
      meta = await fetchHuggingFaceMetadata(repoId);
      if (meta) {
        importDetails.originalAuthor = meta.originalAuthor;
        importDetails.modelFileUrl = meta.downloadUrl;
      }
    } else {
      const err = new Error('Unsupported URL source. Only Civitai and Hugging Face are supported.');
      err.statusCode = 400;
      throw err;
    }

    if (!meta) {
      const err = new Error(`Could not fetch or parse metadata from ${source}.`);
      err.statusCode = 404;
      throw err;
    }

    const checkpoint = mapBaseModel(meta.baseModel);
    if (!checkpoint || !SUPPORTED_CHECKPOINTS.includes(checkpoint)) {
      const err = new Error(`Unsupported or undetermined base model type: ${meta.baseModel || 'Not specified'}. Supported: ${SUPPORTED_CHECKPOINTS.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }
    meta.checkpoint = checkpoint;

    if (!importDetails.modelFileUrl) {
      const err = new Error('Could not determine the direct download URL for the model file.');
      err.statusCode = 400;
      throw err;
    }

    try {
      const downloadHost = new URL(importDetails.modelFileUrl).hostname;
      if (DISALLOWED_DOWNLOAD_HOSTS.some(h => downloadHost.includes(h))) {
        const err = new Error(`Downloads from the host '${downloadHost}' are not permitted.`);
        err.statusCode = 400;
        throw err;
      }
    } catch (urlErr) {
      if (urlErr.statusCode) throw urlErr;
      const err = new Error('Invalid model file download URL format.');
      err.statusCode = 400;
      throw err;
    }

    const newLora = await this.loraModelsDb.createImportedLoRAModel(
      {
        name: meta.name,
        description: meta.description,
        triggerWords: meta.triggerWords,
        checkpoint: meta.checkpoint,
        tags: meta.tags,
      },
      masterAccountId,
      importDetails
    );

    if (!newLora) {
      throw new Error('Failed to save LoRA model to database after fetching metadata.');
    }

    this.logger.info(`[LoraService] LoRA submitted for review: ${newLora.name} (${newLora.slug})`);
    return { slug: newLora.slug, name: newLora.name };
  }

  // ── Cache management ───────────────────────────────────────────────────────

  /**
   * Invalidate the public LoRA cache.
   * Call after creating or updating a public LoRA.
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
