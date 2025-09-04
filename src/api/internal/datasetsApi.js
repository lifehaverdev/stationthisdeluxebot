const express = require('express');

/**
 * Internal Dataset API
 * Endpoint prefix: /internal/v1/data/datasets
 *
 * Dependencies injected from internal API initializer:
 * { logger, db }
 *   - db.dataset expected to be instance of DatasetDB
 */
module.exports = function createDatasetsApi(deps = {}) {
  const { logger = console, db } = deps;
  const datasetsDb = db && db.dataset;
  if (!datasetsDb) {
    logger.error('[datasetsApi] DatasetDB dependency missing.');
    return express.Router().get('*', (_, res) => res.status(503).json({ error: 'Service unavailable' }));
  }

  const router = express.Router();

  // ---------------------------------------------
  // GET /owner/:ownerId – list datasets for user
  // ---------------------------------------------
  router.get('/owner/:ownerId', async (req, res) => {
    const { ownerId } = req.params;
    try {
      const list = await datasetsDb.findMany({ ownerAccountId: ownerId });
      res.json({ datasets: list });
    } catch (err) {
      logger.error('[datasetsApi] list error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // ---------------------------------------------
  // GET /:datasetId – fetch single dataset
  // ---------------------------------------------
  router.get('/:datasetId', async (req, res) => {
    const { datasetId } = req.params;
    try {
      const ds = await datasetsDb.findOne({ _id: datasetId });
      if (!ds) return res.status(404).json({ error: 'Not found' });
      res.json(ds);
    } catch (err) {
      logger.error('[datasetsApi] get error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // ---------------------------------------------
  // POST / – create dataset
  // ---------------------------------------------
  router.post('/', async (req, res) => {
    const { ownerAccountId, name, description } = req.body;
    if (!ownerAccountId || !name) {
      return res.status(400).json({ error: 'ownerAccountId and name required' });
    }
    try {
      const doc = await datasetsDb.createDataset({ ownerAccountId, name, description });
      res.status(201).json(doc);
    } catch (err) {
      logger.error('[datasetsApi] create error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // ---------------------------------------------
  // POST /:datasetId/images – append image URLs
  // ---------------------------------------------
  router.post('/:datasetId/images', async (req, res) => {
    const { datasetId } = req.params;
    const { imageUrls } = req.body; // expects array
    if (!Array.isArray(imageUrls) || !imageUrls.length) {
      return res.status(400).json({ error: 'imageUrls array required' });
    }
    try {
      await datasetsDb.addImages(datasetId, imageUrls);
      res.json({ ok: true });
    } catch (err) {
      logger.error('[datasetsApi] add images error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Additional routes (captions, status) to be added later

  return router;
};
