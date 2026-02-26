const express = require('express');

// This function initializes the routes for the centralized Generation Execution API
module.exports = function generationExecutionApi(dependencies) {
  const { logger, generationExecutionService } = dependencies;
  const router = express.Router();

  if (!generationExecutionService) {
    logger.error('[generationExecutionApi] generationExecutionService missing');
    return (req, res) => res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Generation execution service not available.' } });
  }

  logger.debug('[generationExecutionApi] Initializing Generation Execution API routes...');

  router.post('/', async (req, res) => {
    try {
      const { toolId, inputs, user, sessionId, eventId, metadata } = req.body;
      const result = await generationExecutionService.execute({ toolId, inputs, user, metadata, eventId, sessionId });
      return res.status(result.statusCode).json(result.body);
    } catch (err) {
      logger.error('[generationExecutionApi] Unhandled error from service', err);
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' } });
    }
  });

  logger.debug('[generationExecutionApi] Generation Execution API routes initialized.');
  return router;
};
