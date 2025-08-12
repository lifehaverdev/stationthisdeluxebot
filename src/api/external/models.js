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

  // ---------- LO RA specific routes ----------

  // GET /models/lora -> proxy list endpoint
  router.get('/lora', async (req, res) => {
    try {
      const response = await internalApiClient.get('/internal/v1/data/loras/list', {
        params: req.query,
      });
      res.json(response.data);
    } catch (err) {
      logger.error('[external-modelsApi] LoRA list proxy error:', err.response?.status, err.message);
      const status = err.response?.status || 500;
      res.status(status).json({ error: 'Failed to fetch LoRA list' });
    }
  });

  // GET /models/lora/categories -> proxy distinct categories
  router.get('/lora/categories', async (_req, res) => {
    try {
      const response = await internalApiClient.get('/internal/v1/data/loras/categories');
      res.json(response.data);
    } catch (err) {
      logger.error('[external-modelsApi] LoRA categories proxy error:', err.response?.status, err.message);
      const status = err.response?.status || 500;
      res.status(status).json({ error: 'Failed to fetch LoRA categories' });
    }
  });

  // GET /models/lora/:id -> proxy detail endpoint
  router.get('/lora/:id', async (req, res) => {
    try {
      const response = await internalApiClient.get(`/internal/v1/data/loras/${req.params.id}`, {
        params: req.query,
      });
      res.json(response.data);
    } catch (err) {
      logger.error('[external-modelsApi] LoRA detail proxy error:', err.response?.status, err.message);
      const status = err.response?.status || 500;
      res.status(status).json({ error: 'Failed to fetch LoRA detail' });
    }
  });

  // POST /models/lora/import -> proxy import endpoint (body: {url})
  router.post('/lora/import', async (req, res) => {
    try {
      const response = await internalApiClient.post('/internal/v1/data/loras/import', req.body);
      res.json(response.data);
    } catch (err) {
      logger.error('[external-modelsApi] LoRA import proxy error:', err.response?.status, err.message);
      const status = err.response?.status || 500;
      res.status(status).json({ error: 'LoRA import failed', details: err.response?.data || err.message });
    }
  });

  // POST /models/lora/:id/tag
  router.post('/lora/:id/tag', async (req, res) => {
    try {
      const body = { ...req.body };
      if (!body.userId && req.user?.userId) body.userId = req.user.userId;
      const response = await internalApiClient.post(`/internal/v1/data/loras/${req.params.id}/tag`, body);
      res.json(response.data);
    } catch(err){
      const status = err.response?.status || 500;
      res.status(status).json({ error:'tag failed', details: err.response?.data||err.message });
    }
  });

  // POST /models/lora/:id/rate
  router.post('/lora/:id/rate', async (req, res) => {
    try {
      const body = { ...req.body };
      if (!body.userId && req.user?.userId) body.userId = req.user.userId;
      const response = await internalApiClient.post(`/internal/v1/data/loras/${req.params.id}/rate`, body);
      res.json(response.data);
    } catch(err){
      const status = err.response?.status || 500;
      res.status(status).json({ error:'rate failed', details: err.response?.data||err.message });
    }
  });

  return router;
}; 