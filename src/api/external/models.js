const express = require('express');

/**
 * External Models API Router
 * Simply proxies requests to the internal models API, preserving query params.
 * Requires `internalApiClient` in dependencies.
 */
module.exports = function createModelsApiRouter(deps = {}) {
  const { internalApiClient, logger = console } = deps;
  if (!internalApiClient) {
    logger.error('[external-modelsApi] Missing internalApiClient dependency.');
    return express.Router().get('*', (_, res) => res.status(503).json({ error: 'Service unavailable' }));
  }

  const router = express.Router();

  // GET /models => fetch from internal API
  router.get('/', async (req, res) => {
    try {
      const response = await internalApiClient.get('/internal/v1/data/models', {
        params: req.query,
      });
      res.json(response.data);
    } catch (err) {
      logger.error('[external-modelsApi] Proxy error:', err.response?.status, err.message);
      const status = err.response?.status || 500;
      res.status(status).json({ error: 'Failed to fetch model list' });
    }
  });

  // GET /models/stats – proxy stats endpoint
  router.get('/stats', async (_req, res) => {
    try {
      const response = await internalApiClient.get('/internal/v1/data/models/stats');
      res.json(response.data);
    } catch (err) {
      logger.error('[external-modelsApi] Stats proxy error:', err.response?.status, err.message);
      const status = err.response?.status || 500;
      res.status(status).json({ error: 'Failed to fetch model stats' });
    }
  });

  return router;
}; 