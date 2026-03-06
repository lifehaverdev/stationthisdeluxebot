const express = require('express');

/**
 * createBatchApiRouter
 * External-facing routes for Batch Mode.
 * POST /api/v1/batch/start   — start a batch run using the cook engine
 * GET  /api/v1/batch/:id     — get batch status (proxies to cook status)
 * POST /api/v1/batch/:id/zip — trigger zip assembly
 * POST /api/v1/batch/:id/promote — promote batch to full cook collection
 */
function createBatchApiRouter(deps = {}) {
  const router = express.Router();
  const internalApiClient = deps.internalApiClient || (deps.internal && deps.internal.client);
  const longRunningApiClient = deps.longRunningApiClient || internalApiClient;
  const logger = (deps.logger || console).child
    ? (deps.logger || console).child({ mod: 'BatchApi' })
    : deps.logger || console;

  if (!internalApiClient) {
    logger.error('[BatchApi] internalApiClient missing – router disabled');
    return null;
  }

  // POST /api/v1/batch/start
  // Body: { images: [url, ...], toolId?, spellId?, paramOverrides? }
  router.post('/batch/start', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const { images, toolId, spellId, paramOverrides } = req.body;
      if (!Array.isArray(images) || images.length === 0) {
        return res.status(400).json({ error: 'images array required' });
      }
      if (!toolId && !spellId) {
        return res.status(400).json({ error: 'toolId or spellId required' });
      }

      const { data } = await internalApiClient.post('/internal/v1/data/cook/batch/start', {
        mode: 'batch',
        userId,
        images,
        toolId,
        spellId,
        paramOverrides: paramOverrides || {},
      });
      return res.json(data);
    } catch (err) {
      logger.error('batch start error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'batch-start-failed' });
    }
  });

  // GET /api/v1/batch/:id
  router.get('/batch/:id', async (req, res) => {
    try {
      const { data } = await internalApiClient.get(
        `/internal/v1/data/cook/batch/${encodeURIComponent(req.params.id)}`
      );
      return res.json(data);
    } catch (err) {
      logger.error('batch status error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'batch-status-failed' });
    }
  });

  // POST /api/v1/batch/:id/zip
  router.post('/batch/:id/zip', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const { data } = await longRunningApiClient.post(
        `/internal/v1/data/cook/batch/${encodeURIComponent(req.params.id)}/zip`,
        { userId }
      );
      return res.json(data);
    } catch (err) {
      logger.error('batch zip error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'batch-zip-failed' });
    }
  });

  // POST /api/v1/batch/:id/promote
  router.post('/batch/:id/promote', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const { data } = await internalApiClient.post(
        `/internal/v1/data/cook/batch/${encodeURIComponent(req.params.id)}/promote`,
        { userId }
      );
      return res.json(data);
    } catch (err) {
      logger.error('batch promote error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'batch-promote-failed' });
    }
  });

  return router;
}

module.exports = createBatchApiRouter;
