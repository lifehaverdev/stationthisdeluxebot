const express = require('express');

/**
 * createCookApiRouter
 * External-facing router for Cook Mode (Collections).
 * Delegates to internal /v1/data/cook endpoints via internalApiClient.
 */
function createCookApiRouter(deps = {}) {
  const router = express.Router();
  const internalApiClient = deps.internalApiClient || (deps.internal && deps.internal.client);
  const logger = (deps.logger || console).child ? (deps.logger || console).child({ mod: 'ExternalCookApi' }) : (deps.logger || console);

  if (!internalApiClient) {
    logger.error('[ExternalCookApi] internalApiClient missing – router disabled');
    return null;
  }

  // GET /api/v1/cooks/active
  router.get('/cooks/active', async (req, res) => {
    try {
      const userId = req.user?.id || req.query.userId;
      const { data } = await internalApiClient.get('/internal/v1/data/cook/active', { params: { userId } });
      return res.json(data);
    } catch (err) {
      logger.error('active cooks proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // GET /api/v1/collections
  router.get('/collections', async (req, res) => {
    try {
      const userId = req.user?.id || req.query.userId;
      const { data } = await internalApiClient.get('/internal/v1/data/cook/collections', { params: { userId } });
      return res.json(data);
    } catch (err) {
      logger.error('collections list proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // GET /api/v1/collections/:id
  router.get('/collections/:id', async (req, res) => {
    try {
      const { data } = await internalApiClient.get(`/internal/v1/data/cook/collections/${encodeURIComponent(req.params.id)}`);
      return res.json(data);
    } catch (err) {
      logger.error('get collection proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // PUT /api/v1/collections/:id
  router.put('/collections/:id', async (req, res) => {
    try {
      const { data } = await internalApiClient.put(`/internal/v1/data/cook/collections/${encodeURIComponent(req.params.id)}`, req.body);
      return res.json(data);
    } catch (err) {
      logger.error('update collection proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /api/v1/collections
  router.post('/collections', async (req, res) => {
    try {
      const { data } = await internalApiClient.post('/internal/v1/data/cook/collections', req.body);
      return res.status(201).json(data);
    } catch (err) {
      logger.error('create collection proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // Placeholder routes for pause/resume/delete etc.
  // They will proxy to internal cook routes when implemented.

  return router;
}

module.exports = createCookApiRouter; 