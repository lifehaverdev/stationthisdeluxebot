const express = require('express');
const { createLogger } = require('../../utils/logger');

function createDatasetsApiRouter(deps = {}) {
  const router = express.Router();
  const client = deps.internalApiClient || (deps.internal && deps.internal.client);
  const logger = (deps.logger || console).child ? (deps.logger || console).child({ mod: 'ExternalDatasetsApi' }) : (deps.logger || console);

  if (!client) {
    logger.error('[ExternalDatasetsApi] internalApiClient missing – router disabled');
    return null;
  }

  // GET / (list datasets for authenticated user)
  router.get('/', async (req, res) => {
    const user = req.user;
    if (!user || !user.userId && !user.masterAccountId) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    try {
      const { data } = await client.get(`/internal/v1/data/datasets/owner/${encodeURIComponent(ownerId)}`);
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('list datasets proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // GET /owner/:ownerId (list datasets for specified owner)
  router.get('/owner/:ownerId', async (req, res) => {
    const { ownerId } = req.params;
    if (!ownerId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'ownerId param required' } });
    }
    try {
      const { data } = await client.get(`/internal/v1/data/datasets/owner/${encodeURIComponent(ownerId)}`);
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('list datasets by owner proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // GET /:id (fetch dataset by id)
  router.get('/:id', async (req, res) => {
    try {
      const { data } = await client.get(`/internal/v1/data/datasets/${encodeURIComponent(req.params.id)}`);
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('get dataset proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST / (create new dataset)
  router.post('/', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    try {
      const payload = { ...req.body, masterAccountId: ownerId };
      const { data } = await client.post('/internal/v1/data/datasets', payload);
      res.status(201).json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('create dataset proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /:id/images (add images to dataset)
  router.post('/:id/images', async (req, res) => {
    const { id } = req.params;
    const { imageUrls } = req.body;
    if (!Array.isArray(imageUrls) || !imageUrls.length) {
      return res.status(400).json({ error: 'imageUrls array required' });
    }
    try {
      const user = req.user;
      const ownerId = user?.masterAccountId || user?.userId;
      const { data } = await client.post(`/internal/v1/data/datasets/${encodeURIComponent(id)}/images`, { 
        imageUrls, 
        masterAccountId: ownerId 
      });
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('add images proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  return router;
}

module.exports = createDatasetsApiRouter;
