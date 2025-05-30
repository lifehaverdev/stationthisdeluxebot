// src/api/internal/loraTriggerMapApi.js

const express = require('express');
const router = express.Router();

// BEGIN ADDITION: Import DB Services and ObjectId
const LoRAModelsDB = require('../../core/services/db/loRAModelDb'); // Adjust path as needed
const LoRAPermissionsDB = require('../../core/services/db/loRAPermissionsDb'); // Adjust path as needed
const { ObjectId } = require('../../core/services/db/BaseDB'); // Assuming BaseDB exports ObjectId

// Assuming these are instantiated, perhaps in a central place or passed via dependency injection.
// For now, let's assume we can instantiate them here if not provided.
// TODO: Proper dependency injection for DB services and logger
const logger = console; // Placeholder logger
const loRAModelsDb = new LoRAModelsDB(logger);
const loRAPermissionsDb = new LoRAPermissionsDB(logger);
// END ADDITION

// This would typically be an Express router or similar
// For now, just an illustrative function representing the API endpoint handler.

// Mock DB services for now
// const mockLoraModelsDb = { ... }; // Remove mock
// const mockLoraPermissionsDb = { ... }; // Remove mock

/**
 * Handler for GET /lora/trigger-map-data
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
async function getLoraTriggerMapDataHandler(req, res) {
  const userId = req.query.userId;
  logger.info(`[LoraTriggerMapApi] Received request for trigger map. UserID: ${userId || 'N/A (public only)'}`);

  const triggerMap = {};
  const allFetchedLoras = [];

  try {
    // 1. Fetch Public LoRAs - CHANGED to use visibility: 'public'
    const publicLoras = await loRAModelsDb.findMany({ visibility: 'public' }); 
    if (publicLoras) {
      publicLoras.forEach(lora => {
        allFetchedLoras.push({
          modelId: lora._id.toString(),
          slug: lora.slug,
          triggerWords: lora.triggerWords || [], // EXPECTS triggerWords (array)
          cognates: lora.cognates || [],
          defaultWeight: lora.defaultWeight || 1.0,
          access: lora.access || 'public', // Keep access field, derive from visibility or permissionType if needed
          ownerAccountId: lora.ownedBy ? lora.ownedBy.toString() : null,
          updatedAt: lora.updatedAt || lora.createdAt,
        });
      });
      logger.info(`[LoraTriggerMapApi] Fetched ${publicLoras.length} public LoRAs using visibility.`);
    }

    // 2. Fetch Private LoRAs (if userId is provided)
    if (userId) {
      const accessibleLoraPermissions = await loRAPermissionsDb.listAccessibleLoRAs(userId);
      logger.info(`[LoraTriggerMapApi] User ${userId} has ${accessibleLoraPermissions.length} LoRA permissions.`);
      
      for (const permission of accessibleLoraPermissions) {
        if (!allFetchedLoras.some(l => l.modelId === permission.loraId.toString())) {
          const privateLORA = await loRAModelsDb.findById(permission.loraId);
          if (privateLORA) {
            allFetchedLoras.push({
              modelId: privateLORA._id.toString(),
              slug: privateLORA.slug,
              triggerWords: privateLORA.triggerWords || [], // EXPECTS triggerWords (array)
              cognates: privateLORA.cognates || [],
              defaultWeight: privateLORA.defaultWeight || 1.0,
              access: privateLORA.access || 'private', 
              ownerAccountId: privateLORA.ownedBy ? privateLORA.ownedBy.toString() : userId,
              updatedAt: privateLORA.updatedAt || privateLORA.createdAt,
            });
          }
        }
      }
    }
    logger.info(`[LoraTriggerMapApi] Total LoRAs to process for map: ${allFetchedLoras.length}`);

    // 3. Build Trigger Map
    for (const loraDetails of allFetchedLoras) {
      // Ensure triggerWords is an array and not empty, or cognates exist
      const hasTriggers = loraDetails.triggerWords && Array.isArray(loraDetails.triggerWords) && loraDetails.triggerWords.length > 0;
      const hasCognates = loraDetails.cognates && Array.isArray(loraDetails.cognates) && loraDetails.cognates.length > 0;

      if (!hasTriggers && !hasCognates) {
        logger.warn(`[LoraTriggerMapApi] LoRA ${loraDetails.slug} (ID: ${loraDetails.modelId}) has no triggerWords or cognates. Skipping.`);
        continue;
      }

      const loraDataForMap = {
        modelId: loraDetails.modelId,
        slug: loraDetails.slug,
        // baseTrigger: (hasTriggers ? loraDetails.triggerWords[0] : null), // Main trigger for replacement context
        defaultWeight: loraDetails.defaultWeight,
        access: loraDetails.access, // Use the access determined when fetching
        ownerAccountId: loraDetails.ownerAccountId,
        updatedAt: loraDetails.updatedAt,
      };

      // Add primary triggers from triggerWords array
      if (hasTriggers) {
        for (const triggerWord of loraDetails.triggerWords) {
          if (triggerWord && typeof triggerWord === 'string') {
            const mainTriggerKey = triggerWord.toLowerCase();
            const dataToPush = { ...loraDataForMap, baseTrigger: triggerWord }; // Add the specific trigger word for context
            if (!triggerMap[mainTriggerKey]) triggerMap[mainTriggerKey] = [];
            if (!triggerMap[mainTriggerKey].some(m => m.modelId === dataToPush.modelId)) {
                triggerMap[mainTriggerKey].push(dataToPush);
            }
          }
        }
      }

      // Add cognates
      if (hasCognates) {
        for (const cognate of loraDetails.cognates) {
          if (cognate.word && typeof cognate.word === 'string') {
            const cognateKey = cognate.word.toLowerCase();
            // If cognate.replaceWith is defined, it implies this cognate maps to a specific primary trigger.
            // Otherwise, assume it maps to the first primary trigger word if available.
            const effectiveBaseTrigger = cognate.replaceWith || (hasTriggers ? loraDetails.triggerWords[0] : cognate.word);
            const cognateDataForMap = {
                ...loraDataForMap,
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

module.exports = router; 