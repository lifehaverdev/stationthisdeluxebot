const express = require('express');
const { CookJobStore } = require('../../core/services/cook');
const { CookOrchestratorService } = require('../../core/services/cook');
const { CookProjectionUpdater } = require('../../core/services/cook');
const { createLogger } = require('../../utils/logger');

function createCookApi(deps = {}) {
  const router = express.Router();
  const logger = deps.logger || createLogger('CookAPI');
  const cookDb = deps.db?.cookCollections;

  // POST /internal/cook/start
  router.post('/start', async (req, res) => {
    try {
      const { collectionId, userId, spellId, toolId } = req.body;
      if (!collectionId || !userId) {
        return res.status(400).json({ error: 'collectionId and userId required' });
      }
      if (!spellId && !toolId) {
        return res.status(400).json({ error: 'spellId or toolId required' });
      }

      const { traitTypes = [], paramsTemplate = {} } = req.body;

      const result = await CookOrchestratorService.startCook({
        collectionId,
        userId,
        spellId,
        toolId,
        traitTypes,
        paramsTemplate,
      });

      logger.info(`[CookAPI] Started cook. Job ${result.jobId}`);
      return res.json({ jobId: result.jobId, status: 'queued' });
    } catch (err) {
      logger.error('[CookAPI] start error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // Health check / ping
  router.get('/ping', (req, res) => res.json({ ok: true }));

  // GET /internal/cook/active - list active cook statuses for current user (stub implementation)
  router.get('/active', async (req, res) => {
    try {
      const userId = req.query.userId || req.user?.id || req.userId;
      // TODO: query CookProjectionUpdater once permission/user scoping is solid
      const active = []; // return empty list for now to unblock front-end
      return res.json({ cooks: active });
    } catch (err) {
      logger.error('[CookAPI] active list error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // GET /internal/cook/collections – list collections for user (stub)
  router.get('/collections', async (req, res) => {
    try {
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const userId = req.query.userId || req.user?.id || req.userId;
      const collections = await cookDb.findByUser(userId);
      return res.json({ collections });
    } catch (err) {
      logger.error('[CookAPI] collections list error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // GET /internal/cook/collections/:id – get collection by ID
  router.get('/collections/:id', async (req, res) => {
    try {
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const doc = await cookDb.findById(req.params.id);
      if (!doc) return res.status(404).json({ error: 'not-found' });
      return res.json(doc);
    } catch (err) {
      logger.error('[CookAPI] get collection error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // POST /internal/cook/collections – create collection (stub)
  router.post('/collections', async (req, res) => {
    try {
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const { name, description = '' } = req.body;
      const userId = req.user?.id || req.userId;
      if (!name) return res.status(400).json({ error: 'name required' });

      const doc = await cookDb.createCollection({ name, description, userId });
      return res.status(201).json(doc);
    } catch (err) {
      logger.error('[CookAPI] create collection error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // PUT /internal/cook/collections/:id – update collection metadata/config
  router.put('/collections/:id', async (req, res) => {
    try {
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const collectionId = req.params.id;
      const update = { ...req.body };
      delete update.collectionId;
      delete update.userId; // prevent id changes
      await cookDb.updateCollection(collectionId, update);
      const doc = await cookDb.findById(collectionId);
      return res.json(doc);
    } catch (err) {
      logger.error('[CookAPI] update collection error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // GET /internal/cook/status?collectionId=&userId=
  router.get('/status', async (req, res) => {
    try {
      const { collectionId, userId } = req.query;
      if (!collectionId || !userId) return res.status(400).json({ error: 'collectionId and userId required' });
      const status = await CookProjectionUpdater.getStatus(Number(collectionId), userId);
      if (!status) return res.status(404).json({ error: 'not-found' });
      return res.json(status);
    } catch (err) {
      logger.error('[CookAPI] status error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  return router;
}

module.exports = { createCookApi }; 