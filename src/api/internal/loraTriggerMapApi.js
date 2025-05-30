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
  const userId = req.query.userId; // masterAccountId from query
  logger.info(`[LoraTriggerMapApi] Received request for trigger map. UserID: ${userId || 'N/A (public only)'}`);

  const triggerMap = {};
  const allFetchedLoras = [];

  try {
    // 1. Fetch Public LoRAs
    // ADR-009 field names: trigger, cognates: [{word, replaceWith}], slug, defaultWeight, access: "public" | "private", ownerAccountId, updatedAt
    const publicLoras = await loRAModelsDb.findMany({ access: 'public' }); // Assuming findMany can filter by access type
    if (publicLoras) {
      publicLoras.forEach(lora => {
        allFetchedLoras.push({
          modelId: lora._id.toString(),
          slug: lora.slug,
          trigger: lora.trigger, // Main trigger word
          cognates: lora.cognates || [], // Array of {word, replaceWith}
          defaultWeight: lora.defaultWeight || 1.0,
          access: 'public',
          ownerAccountId: lora.ownedBy ? lora.ownedBy.toString() : null, // Assuming ownedBy is ObjectId
          updatedAt: lora.updatedAt || lora.createdAt, // Fallback to createdAt if updatedAt isn't set
          // triggerWordForReplacement: lora.trigger, // Per ADR-009 Q5, actual trigger is part of replacement string
        });
      });
      logger.info(`[LoraTriggerMapApi] Fetched ${publicLoras.length} public LoRAs.`);
    }

    // 2. Fetch Private LoRAs (if userId is provided)
    if (userId) {
      const accessibleLoraPermissions = await loRAPermissionsDb.listAccessibleLoRAs(userId);
      logger.info(`[LoraTriggerMapApi] User ${userId} has ${accessibleLoraPermissions.length} LoRA permissions.`);
      
      for (const permission of accessibleLoraPermissions) {
        // Avoid re-fetching if already fetched as public (though unlikely if permissions are strict)
        if (!allFetchedLoras.some(l => l.modelId === permission.loraId.toString())) {
          const privateLORA = await loRAModelsDb.findById(permission.loraId);
          if (privateLORA) {
            // Ensure it's actually marked as private or has some owner defined
            // (could be public but user has explicit permission record for some reason - though ADR implies clear separation)
            allFetchedLoras.push({
              modelId: privateLORA._id.toString(),
              slug: privateLORA.slug,
              trigger: privateLORA.trigger,
              cognates: privateLORA.cognates || [],
              defaultWeight: privateLORA.defaultWeight || 1.0,
              access: privateLORA.access || 'private', // Default to private if fetched via permission
              ownerAccountId: privateLORA.ownedBy ? privateLORA.ownedBy.toString() : userId, // If ownedBy is null, assume requesting user owns it if they have permission
              updatedAt: privateLORA.updatedAt || privateLORA.createdAt,
              // triggerWordForReplacement: privateLORA.trigger,
            });
          } else {
            logger.warn(`[LoraTriggerMapApi] Could not find LoRA model for permissioned loraId: ${permission.loraId}`);
          }
        }
      }
    }
    logger.info(`[LoraTriggerMapApi] Total LoRAs to process for map (public + user-specific private): ${allFetchedLoras.length}`);

    // 3. Build Trigger Map from allFetchedLoras
    for (const loraDetails of allFetchedLoras) {
      if (!loraDetails.trigger && (!loraDetails.cognates || loraDetails.cognates.length === 0)) {
        logger.warn(`[LoraTriggerMapApi] LoRA ${loraDetails.slug} (ID: ${loraDetails.modelId}) has no trigger words or cognates. Skipping.`);
        continue;
      }

      const loraDataForMap = {
        modelId: loraDetails.modelId,
        slug: loraDetails.slug,
        baseTrigger: loraDetails.trigger, // Store the original base trigger for reference
        defaultWeight: loraDetails.defaultWeight,
        access: loraDetails.access,
        ownerAccountId: loraDetails.ownerAccountId,
        updatedAt: loraDetails.updatedAt,
        // triggerWordForReplacement is implicitly the trigger/cognate word itself when used by loraResolutionService
      };

      // Add primary trigger
      if (loraDetails.trigger) {
        const mainTriggerKey = loraDetails.trigger.toLowerCase();
        if (!triggerMap[mainTriggerKey]) {
          triggerMap[mainTriggerKey] = [];
        }
        // Add only if not already present (e.g. multiple LoRAs on same trigger)
        if (!triggerMap[mainTriggerKey].some(m => m.modelId === loraDataForMap.modelId)) {
            triggerMap[mainTriggerKey].push(loraDataForMap);
        }
      }

      // Add cognates
      if (loraDetails.cognates && loraDetails.cognates.length > 0) {
        for (const cognate of loraDetails.cognates) {
          if (cognate.word) {
            const cognateKey = cognate.word.toLowerCase();
            const cognateDataForMap = {
                ...loraDataForMap,
                isCognate: true,
                replaceWithBaseTrigger: cognate.replaceWith || loraDetails.trigger // The trigger to use for <lora:slug:weight> [trigger]
            };
            if (!triggerMap[cognateKey]) {
              triggerMap[cognateKey] = [];
            }
            if (!triggerMap[cognateKey].some(m => m.modelId === cognateDataForMap.modelId)) {
                triggerMap[cognateKey].push(cognateDataForMap);
            }
          }
        }
      }
    }

    logger.info(`[LoraTriggerMapApi] Trigger map built. Number of unique trigger keys: ${Object.keys(triggerMap).length}`);
    // For debugging, log a small sample of the map
    if (Object.keys(triggerMap).length > 0) {
        const sampleKey = Object.keys(triggerMap)[0];
        logger.debug(`[LoraTriggerMapApi] Sample entry for trigger '${sampleKey}': ${JSON.stringify(triggerMap[sampleKey])}`);
    }

    res.status(200).json(triggerMap); // Send the map as JSON response

  } catch (error) {
    logger.error(`[LoraTriggerMapApi] Error building trigger map: ${error.message}`, error.stack);
    res.status(500).json({ error: 'Failed to build LoRA trigger map', details: error.message });
  }
}

// Mount the handler on the router
router.get('/lora/trigger-map-data', getLoraTriggerMapDataHandler);

module.exports = router; 