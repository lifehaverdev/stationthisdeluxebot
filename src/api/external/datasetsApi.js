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

  // GET /embellishment-spells – list spells with embellishment capabilities (BEFORE /:id to avoid conflict)
  router.get('/embellishment-spells', async (req, res) => {
    const { type } = req.query;
    try {
      const url = type
        ? `/internal/v1/data/embellishment-spells?type=${encodeURIComponent(type)}`
        : '/internal/v1/data/embellishment-spells';
      const { data } = await client.get(url);
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('list embellishment spells proxy error', err.response?.data || err.message);
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

  // PUT /:id (update dataset)
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    try {
      const payload = { ...req.body, masterAccountId: ownerId };
      const { data } = await client.put(`/internal/v1/data/datasets/${encodeURIComponent(id)}`, payload);
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('update dataset proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // DELETE /:id (remove dataset)
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    try {
      const { data } = await client.delete(`/internal/v1/data/datasets/${encodeURIComponent(id)}`, {
        data: { masterAccountId: ownerId },
      });
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('delete dataset proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /:id/caption-via-spell – generate captions via selected spell
  router.post('/:id/caption-via-spell', async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    try {
      const payload = { ...req.body, masterAccountId: ownerId };
      const { data } = await client.post(`/internal/v1/data/datasets/${encodeURIComponent(id)}/caption-via-spell`, payload);
      res.status(202).json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('caption via spell proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // GET /:id/captions – list caption sets
  router.get('/:id/captions', async (req, res) => {
    const { id } = req.params;
    try {
      const { data } = await client.get(`/internal/v1/data/datasets/${encodeURIComponent(id)}/captions`);
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('get captions proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /:id/caption-task/cancel – cancel active caption generation
  router.post('/:id/caption-task/cancel', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    const { id } = req.params;
    try {
      const payload = { masterAccountId: ownerId };
      const { data } = await client.post(`/internal/v1/data/datasets/${encodeURIComponent(id)}/caption-task/cancel`, payload);
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('cancel caption task proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // DELETE /:id/captions/:captionId – remove a caption set
  router.delete('/:id/captions/:captionId', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    const { id, captionId } = req.params;
    try {
      const { data } = await client.delete(`/internal/v1/data/datasets/${encodeURIComponent(id)}/captions/${encodeURIComponent(captionId)}`, {
        data: { masterAccountId: ownerId },
      });
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('delete caption set proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /:id/captions/:captionId/default – mark caption set as default
  router.post('/:id/captions/:captionId/default', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    const { id, captionId } = req.params;
    try {
      const payload = { masterAccountId: ownerId };
      const { data } = await client.post(`/internal/v1/data/datasets/${encodeURIComponent(id)}/captions/${encodeURIComponent(captionId)}/default`, payload);
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('set default caption set proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // --- Embellishment Routes ---

  // POST /:id/embellishments/manual – create manual embellishment (user-written captions)
  router.post('/:id/embellishments/manual', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    const { id } = req.params;
    try {
      const payload = { ...req.body, masterAccountId: ownerId };
      const { data } = await client.post(`/internal/v1/data/datasets/${encodeURIComponent(id)}/embellishments/manual`, payload);
      res.status(201).json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('create manual embellishment proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // GET /:id/embellishments – list embellishments for dataset
  router.get('/:id/embellishments', async (req, res) => {
    const { id } = req.params;
    const { type } = req.query;
    try {
      const url = type
        ? `/internal/v1/data/datasets/${encodeURIComponent(id)}/embellishments?type=${encodeURIComponent(type)}`
        : `/internal/v1/data/datasets/${encodeURIComponent(id)}/embellishments`;
      const { data } = await client.get(url);
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('list embellishments proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // DELETE /:id/embellishments/:embellishmentId – remove embellishment
  router.delete('/:id/embellishments/:embellishmentId', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    const { id, embellishmentId } = req.params;
    try {
      const { data } = await client.delete(`/internal/v1/data/datasets/${encodeURIComponent(id)}/embellishments/${encodeURIComponent(embellishmentId)}`, {
        data: { masterAccountId: ownerId },
      });
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('delete embellishment proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // PATCH /:id/embellishments/:embellishmentId/results – bulk update embellishment results
  router.patch('/:id/embellishments/:embellishmentId/results', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    const { id, embellishmentId } = req.params;
    try {
      const payload = { ...req.body, masterAccountId: ownerId };
      const { data } = await client.patch(`/internal/v1/data/datasets/${encodeURIComponent(id)}/embellishments/${encodeURIComponent(embellishmentId)}/results`, payload);
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('bulk update embellishment results proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /:id/embellish – start embellishment task via spell
  router.post('/:id/embellish', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    const { id } = req.params;
    try {
      const payload = { ...req.body, masterAccountId: ownerId };
      const { data } = await client.post(`/internal/v1/data/datasets/${encodeURIComponent(id)}/embellish`, payload);
      res.status(202).json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('start embellishment task proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /embellishment-tasks/:taskId/cancel – cancel a running embellishment task
  router.post('/embellishment-tasks/:taskId/cancel', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    const { taskId } = req.params;
    try {
      const payload = { masterAccountId: ownerId };
      const { data } = await client.post(`/internal/v1/data/embellishment-tasks/${encodeURIComponent(taskId)}/cancel`, payload);
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('cancel embellishment task proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  return router;
}

module.exports = createDatasetsApiRouter;
