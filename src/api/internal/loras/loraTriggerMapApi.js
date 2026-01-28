// src/api/internal/loraTriggerMapApi.js

const express = require('express');
const router = express.Router();

// BEGIN ADDITION: Import DB Services and ObjectId
const LoRAModelsDB = require('../../../core/services/db/loRAModelDb');
const LoRAPermissionsDB = require('../../../core/services/db/loRAPermissionsDb');
const { ObjectId } = require('../../../core/services/db/BaseDB');

// Assuming these are instantiated, perhaps in a central place or passed via dependency injection.
// For now, let's assume we can instantiate them here if not provided.
// TODO: Proper dependency injection for DB services and logger
const logger = console; // Placeholder logger
const loRAModelsDb = new LoRAModelsDB(logger);
const loRAPermissionsDb = new LoRAPermissionsDB(logger);
// END ADDITION

// --- Caching Layer ---
let publicLorasCache = null;
let publicTriggerMapCache = null; // cached trigger map for public LoRAs
const PUBLIC_CACHE_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // Refresh every 5 minutes

// Helper to build trigger map from a list of LoRA records
function buildTriggerMapFromLoras(loras) {
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
      checkpoint: loraDetails.checkpoint
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
          replaceWithBaseTrigger: effectiveBaseTrigger
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
// --- End Caching Layer ---


/**
 * Rebuilds the in-memory cache of public LoRAs.
 * This is called on startup and when LoRA visibility changes.
 */
async function refreshPublicLoraCache() {
  logger.info('[LoraTriggerMapApi] Refreshing public LoRA cache...');
  try {
    const publicLoras = await loRAModelsDb.findMany({ visibility: 'public' });
    publicLorasCache = publicLoras.map(lora => ({
      modelId: lora._id.toString(),
      slug: lora.slug,
      triggerWords: lora.triggerWords || [],
      cognates: lora.cognates || [],
      defaultWeight: lora.defaultWeight || 1.0,
      access: 'public',
      ownerAccountId: lora.ownedBy ? lora.ownedBy.toString() : null,
      updatedAt: lora.updatedAt || lora.createdAt,
      checkpoint: lora.checkpoint
    }));

    publicTriggerMapCache = buildTriggerMapFromLoras(publicLorasCache);

    logger.info(`[LoraTriggerMapApi] Public LoRA cache refreshed. Count: ${publicLorasCache.length}. Trigger keys: ${Object.keys(publicTriggerMapCache).length}`);
  } catch (error) {
    logger.error(`[LoraTriggerMapApi] Failed to refresh public LoRA cache:`, error);
    // On error, clear the cache to force a rebuild on the next request.
    publicLorasCache = null;
    publicTriggerMapCache = null;
  }
}
// --- End Caching Layer ---


/**
 * Handler for GET /lora/trigger-map-data
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
async function getLoraTriggerMapDataHandler(req, res) {
  // If public trigger map cache is missing, rebuild caches
  if (publicTriggerMapCache === null) {
    logger.warn('[LoraTriggerMapApi] Public trigger map cache empty, rebuilding...');
    await refreshPublicLoraCache();
  }

  // EARLY RETURN: public-only request
  if (!req.query.userId) {
    logger.info('[LoraTriggerMapApi] Returning cached public trigger map (no userId).');
    return res.status(200).json(publicTriggerMapCache || {});
  }

  const userId = req.query.userId;
  logger.info(`[LoraTriggerMapApi] Received request for trigger map. UserID: ${userId}`);

  // Start with a clone of the public trigger map to avoid mutating the cache
  const triggerMap = JSON.parse(JSON.stringify(publicTriggerMapCache));

  try {
    // 2. Fetch user-specific private LoRAs (if userId is provided)
    const accessibleLoraPermissions = await loRAPermissionsDb.listAccessibleLoRAs(userId);
    logger.info(`[LoraTriggerMapApi] User ${userId} has ${accessibleLoraPermissions.length} LoRA permissions.`);
    
    for (const permission of accessibleLoraPermissions) {
      if (!publicLorasCache.some(l => l.modelId === permission.loraId.toString())) {
        const privateLORA = await loRAModelsDb.findById(permission.loraId);
        if (privateLORA) {
          const privateLoraDataForMap = {
            modelId: privateLORA._id.toString(),
            slug: privateLORA.slug,
            triggerWords: privateLORA.triggerWords || [],
            cognates: privateLORA.cognates || [],
            defaultWeight: privateLORA.defaultWeight || 1.0,
            access: 'private', 
            ownerAccountId: privateLORA.ownedBy ? privateLORA.ownedBy.toString() : userId,
            updatedAt: privateLORA.updatedAt || privateLORA.createdAt,
            checkpoint: privateLORA.checkpoint
          };

          // Add primary triggers from triggerWords array
          if (Array.isArray(privateLoraDataForMap.triggerWords) && privateLoraDataForMap.triggerWords.length > 0) {
            for (const triggerWord of privateLoraDataForMap.triggerWords) {
              if (triggerWord && typeof triggerWord === 'string') {
                const mainTriggerKey = triggerWord.toLowerCase();
                const dataToPush = { ...privateLoraDataForMap, baseTrigger: triggerWord }; // Add the specific trigger word for context
                if (!triggerMap[mainTriggerKey]) triggerMap[mainTriggerKey] = [];
                if (!triggerMap[mainTriggerKey].some(m => m.modelId === dataToPush.modelId)) {
                    triggerMap[mainTriggerKey].push(dataToPush);
                }
              }
            }
          }

          // Add cognates
          if (Array.isArray(privateLoraDataForMap.cognates) && privateLoraDataForMap.cognates.length > 0) {
            for (const cognate of privateLoraDataForMap.cognates) {
              if (cognate.word && typeof cognate.word === 'string') {
                const cognateKey = cognate.word.toLowerCase();
                // If cognate.replaceWith is defined, it implies this cognate maps to a specific primary trigger.
                // Otherwise, assume it maps to the first primary trigger word if available.
                const effectiveBaseTrigger = cognate.replaceWith || (Array.isArray(privateLoraDataForMap.triggerWords) && privateLoraDataForMap.triggerWords.length > 0 ? privateLoraDataForMap.triggerWords[0] : cognate.word);
                const cognateDataForMap = {
                    ...privateLoraDataForMap,
                    isCognate: true,
                    replaceWithBaseTrigger: effectiveBaseTrigger 
                };
                if (!triggerMap[cognateKey]) triggerMap[cognateKey] = [];
                if (!triggerMap[cognateKey].some(m => m.modelId === cognateDataForMap.modelId)) {
                    triggerMap[cognateKey].push(cognateDataForMap);
                }
              }
            }
          }
        }
      }
    }
    logger.info(`[LoraTriggerMapApi] Total LoRAs to process for map: ${publicLorasCache.length + accessibleLoraPermissions.length}`);

    logger.info(`[LoraTriggerMapApi] Trigger map built. Keys: ${Object.keys(triggerMap).length}`);
    if (Object.keys(triggerMap).length > 0) {
        const sampleKey = Object.keys(triggerMap)[0];
        logger.debug(`[LoraTriggerMapApi] Sample for '${sampleKey}': ${JSON.stringify(triggerMap[sampleKey])}`);
    }
    res.status(200).json(triggerMap);
  } catch (error) {
    logger.error(`[LoraTriggerMapApi] Error building trigger map: ${error.message}`, error.stack);
    res.status(500).json({ error: 'Failed to build LoRA trigger map', details: error.message });
  }
}

// Mount the handler on the router
router.get('/lora/trigger-map-data', getLoraTriggerMapDataHandler);

// Populate cache on startup
refreshPublicLoraCache();

// Periodically refresh the cache so new models (e.g., from training finalization
// in a separate worker process) are picked up without requiring a restart.
setInterval(() => {
  refreshPublicLoraCache().catch(err => {
    logger.error('[LoraTriggerMapApi] Periodic cache refresh failed:', err.message);
  });
}, PUBLIC_CACHE_REFRESH_INTERVAL_MS);

// Export the refresh function alongside the router
module.exports = {
    router,
    refreshPublicLoraCache
}; 