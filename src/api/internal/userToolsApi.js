const express = require('express');
const { ObjectId } = require('mongodb');
const { createLogger } = require('../../utils/logger');
// const { authenticateInternalKey } = require('../middleware/authMiddleware'); // Placeholder

const logger = createLogger('UserToolsApi');

function createUserToolsApiRouter(dependencies) {
  const { db, logger: depLogger } = dependencies; // Use logger from dependencies
  const router = express.Router({ mergeParams: true }); // Enable mergeParams

  if (!db || !db.generationOutputs) {
    (depLogger || logger).error('[UserToolsApi] Critical dependency failure: db.generationOutputs service is missing!');
    router.use((req, res, next) => {
      res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'GenerationOutputs database service not available.' },
      });
    });
    return router;
  }

  // Middleware for this router
  // router.use(authenticateInternalKey);

  // Helper to get masterAccountId from merged params
  const getMasterAccountId = (req, res) => {
    const { masterAccountId: masterAccountIdStr } = req.params;
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
      (depLogger || logger).error(`[UserToolsApi] Invalid or missing masterAccountId (${masterAccountIdStr}) from merged params.`);
      // res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve valid masterAccountId.' } });
      // Throw an error or ensure the parent router handles this validation strictly.
      // For now, let it proceed, assuming parent validation or it will fail at ObjectId conversion.
      return null; 
    }
    return new ObjectId(masterAccountIdStr);
  };

  /**
   * GET /internal/v1/data/users/:masterAccountId/used-tools
   * Route is now just '/used-tools' due to mergeParams and parent router handling /:masterAccountId
   */
  router.get(
    '/used-tools',
    async (req, res) => {
      const masterAccountId = getMasterAccountId(req, res);
      if (!masterAccountId) {
        // If getMasterAccountId sent a response, it would already be handled.
        // If it returned null due to invalid ID, send 400.
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid or missing masterAccountId.' } });
      }

      (depLogger || logger).info(`[UserToolsApi] GET /users/${masterAccountId}/used-tools - Request received`);

      try {
        const usedToolIds = await db.generationOutputs.distinct('metadata.toolId', {
          masterAccountId: masterAccountId,
          'metadata.toolId': { $exists: true, $ne: null }
        });

        if (!usedToolIds) {
          (depLogger || logger).warn(`[UserToolsApi] GET .../used-tools - Distinct query returned null/undefined for ${masterAccountId}.`);
          return res.status(200).json([]);
        }
        
        const filteredToolIds = usedToolIds.filter(toolId => toolId && typeof toolId === 'string' && toolId.trim() !== '');

        (depLogger || logger).info(`[UserToolsApi] GET .../used-tools - Found ${filteredToolIds.length} used tool(s) for ${masterAccountId}.`);
        res.status(200).json(filteredToolIds);

      } catch (error) {
        (depLogger || logger).error(`[UserToolsApi] GET .../used-tools - Error for ${masterAccountId}: ${error.message}`, error);
        res.status(500).json({
          error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred while retrieving used tools.' },
        });
      }
    }
  );

  (depLogger || logger).info('[UserToolsApi] User Tools API routes initialized (with mergeParams).');
  return router;
}

module.exports = { createUserToolsApiRouter }; 