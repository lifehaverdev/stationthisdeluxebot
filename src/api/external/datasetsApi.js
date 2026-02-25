const express = require('express');

function createDatasetsApiRouter(deps = {}) {
  const router = express.Router();
  const datasetService = deps.datasetService;
  const logger = (deps.logger || console).child ? (deps.logger || console).child({ mod: 'ExternalDatasetsApi' }) : (deps.logger || console);

  if (!datasetService) {
    logger.error('[ExternalDatasetsApi] datasetService missing – router disabled');
    return null;
  }

  // Helper to map service Error.status to HTTP status
  function statusOf(err) {
    return err.status || 500;
  }

  // GET / (list datasets for authenticated user)
  router.get('/', async (req, res) => {
    const user = req.user;
    if (!user || (!user.userId && !user.masterAccountId)) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    try {
      const { page, limit, search, filter } = req.query;
      const result = await datasetService.listByOwner(ownerId, { page, limit, search, filter });
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('list datasets error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // GET /owner/:ownerId (list datasets for specified owner)
  router.get('/owner/:ownerId', async (req, res) => {
    const { ownerId } = req.params;
    if (!ownerId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'ownerId param required' } });
    }
    try {
      const { page, limit, search, filter } = req.query;
      const result = await datasetService.listByOwner(ownerId, { page, limit, search, filter });
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('list datasets by owner error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // GET /embellishment-spells – list spells with embellishment capabilities (BEFORE /:id to avoid conflict)
  router.get('/embellishment-spells', async (req, res) => {
    const { type } = req.query;
    try {
      const spells = await datasetService.listEmbellishmentSpells(type || null);
      res.json({ success: true, data: spells });
    } catch (err) {
      logger.error('list embellishment spells error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // GET /:id (fetch dataset by id)
  router.get('/:id', async (req, res) => {
    try {
      const dataset = await datasetService.getById(req.params.id);
      if (!dataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      res.json({ success: true, data: dataset });
    } catch (err) {
      logger.error('get dataset error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // POST / (create new dataset)
  router.post('/', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    try {
      const dataset = await datasetService.create({ ...req.body, masterAccountId });
      res.status(201).json({ success: true, data: dataset });
    } catch (err) {
      logger.error('create dataset error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
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
      const masterAccountId = user?.masterAccountId || user?.userId;
      const result = await datasetService.addImages(id, imageUrls, masterAccountId);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('add images error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // PUT /:id (update dataset)
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    const { masterAccountId: _ignored, ...updateData } = req.body;
    try {
      const result = await datasetService.update(id, masterAccountId, updateData);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('update dataset error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // DELETE /:id (remove dataset)
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    try {
      const result = await datasetService.delete(id, masterAccountId);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('delete dataset error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // POST /:id/caption-via-spell – generate captions via selected spell
  router.post('/:id/caption-via-spell', async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;

    // Normalise parameterOverrides / trigger fields (same logic as internal handler)
    const rawOverrides = (req.body && req.body.parameterOverrides) || {};
    const parameterOverrides = (rawOverrides && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides))
      ? { ...rawOverrides }
      : {};

    const coerceString = (val) => (typeof val === 'string' ? val.trim() : '');
    const firstFromList = (input) => {
      if (Array.isArray(input)) return input.map(e => coerceString(e)).find(Boolean) || '';
      if (typeof input === 'string') return input.split(',').map(p => p.trim()).find(Boolean) || '';
      return '';
    };
    const triggerCandidate =
      coerceString(parameterOverrides.stringB) ||
      coerceString(parameterOverrides.triggerWord) ||
      firstFromList(parameterOverrides.triggerWords) ||
      coerceString(req.body?.triggerWord) ||
      firstFromList(req.body?.triggerWords);

    if (triggerCandidate) {
      if (!coerceString(parameterOverrides.triggerWord)) parameterOverrides.triggerWord = triggerCandidate;
      if (!Array.isArray(parameterOverrides.triggerWords) || !parameterOverrides.triggerWords.length) parameterOverrides.triggerWords = [triggerCandidate];
      if (!coerceString(parameterOverrides.stringB)) parameterOverrides.stringB = triggerCandidate;
    }

    const { spellSlug } = req.body;
    if (!spellSlug) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'spellSlug is required' } });
    }

    try {
      const result = await datasetService.captionViaSpell(id, { spellSlug, masterAccountId, parameterOverrides });
      res.status(202).json({ success: true, data: result });
    } catch (err) {
      logger.error('caption via spell error', err.message);
      const code = err.code || 'CAPTION_SPELL_ERROR';
      res.status(statusOf(err)).json({ error: { code, message: err.message } });
    }
  });

  // GET /:id/captions – list caption sets
  router.get('/:id/captions', async (req, res) => {
    const { id } = req.params;
    try {
      const captions = await datasetService.listCaptions(id);
      res.json({ success: true, data: captions });
    } catch (err) {
      logger.error('get captions error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // POST /:id/caption-task/cancel – cancel active caption generation
  router.post('/:id/caption-task/cancel', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    const { id } = req.params;
    try {
      const result = await datasetService.cancelCaptionTask(id, masterAccountId);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('cancel caption task error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // DELETE /:id/captions/:captionId – remove a caption set
  router.delete('/:id/captions/:captionId', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    const { id, captionId } = req.params;
    try {
      const result = await datasetService.deleteCaption(id, captionId, masterAccountId);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('delete caption set error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // POST /:id/captions/:captionId/default – mark caption set as default
  router.post('/:id/captions/:captionId/default', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    const { id, captionId } = req.params;
    try {
      const result = await datasetService.setDefaultCaption(id, captionId, masterAccountId);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('set default caption set error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // PATCH /:id/captions/:captionSetId/entries/:index – update a single caption entry
  router.patch('/:id/captions/:captionSetId/entries/:index', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    const { id, captionSetId, index } = req.params;
    const { text } = req.body;
    if (typeof text !== 'string') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'text is required' } });
    }
    try {
      const result = await datasetService.updateCaptionEntry(id, captionSetId, index, text, masterAccountId);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('update caption entry error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // --- Embellishment Routes ---

  // POST /:id/embellishments/manual – create manual embellishment (user-written captions)
  router.post('/:id/embellishments/manual', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    const { id } = req.params;
    const { type } = req.body;
    try {
      const result = await datasetService.createManualEmbellishment(id, masterAccountId, type);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      logger.error('create manual embellishment error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // GET /:id/embellishments – list embellishments for dataset
  router.get('/:id/embellishments', async (req, res) => {
    const { id } = req.params;
    const { type } = req.query;
    try {
      const embellishments = await datasetService.listEmbellishments(id, type || null);
      res.json({ success: true, data: embellishments });
    } catch (err) {
      logger.error('list embellishments error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // DELETE /:id/embellishments/:embellishmentId – remove embellishment
  router.delete('/:id/embellishments/:embellishmentId', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    const { id, embellishmentId } = req.params;
    try {
      const result = await datasetService.deleteEmbellishment(id, embellishmentId, masterAccountId);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('delete embellishment error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // PATCH /:id/embellishments/:embellishmentId/results/:index – update a single embellishment result
  router.patch('/:id/embellishments/:embellishmentId/results/:index', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    const { id, embellishmentId, index } = req.params;
    const { value } = req.body;
    try {
      const result = await datasetService.updateEmbellishmentResult(id, embellishmentId, index, value, masterAccountId);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('update embellishment result error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // PATCH /:id/embellishments/:embellishmentId/results – bulk update embellishment results
  router.patch('/:id/embellishments/:embellishmentId/results', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    const { id, embellishmentId } = req.params;
    const { results } = req.body;
    if (!Array.isArray(results)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'results must be an array' } });
    }
    try {
      const result = await datasetService.bulkUpdateEmbellishmentResults(id, embellishmentId, results, masterAccountId);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('bulk update embellishment results error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // POST /:id/embellishments/:embellishmentId/regenerate/:index – regenerate a single embellishment item
  router.post('/:id/embellishments/:embellishmentId/regenerate/:index', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    const { id, embellishmentId, index } = req.params;
    const { config } = req.body;
    try {
      const result = await datasetService.regenerateEmbellishmentItem(id, embellishmentId, index, masterAccountId, config || null);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('regenerate embellishment item error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // POST /:id/embellish – start embellishment task via spell
  router.post('/:id/embellish', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    const { id } = req.params;
    const { spellSlug, parameterOverrides } = req.body;
    try {
      const result = await datasetService.startEmbellishment(id, { spellSlug, masterAccountId, parameterOverrides: parameterOverrides || {} });
      res.status(202).json({ success: true, data: result });
    } catch (err) {
      logger.error('start embellishment task error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  // POST /embellishment-tasks/:taskId/cancel – cancel a running embellishment task
  router.post('/embellishment-tasks/:taskId/cancel', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const masterAccountId = user.masterAccountId || user.userId;
    const { taskId } = req.params;
    try {
      const result = await datasetService.cancelEmbellishmentTask(taskId, masterAccountId);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('cancel embellishment task error', err.message);
      res.status(statusOf(err)).json({ error: err.message || 'error' });
    }
  });

  return router;
}

module.exports = createDatasetsApiRouter;
