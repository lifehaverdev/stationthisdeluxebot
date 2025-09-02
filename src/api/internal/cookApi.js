const express = require('express');
const { CookJobStore } = require('../../core/services/cook');
const { CookOrchestratorService } = require('../../core/services/cook');
const { CookProjectionUpdater } = require('../../core/services/cook');
const { createLogger } = require('../../utils/logger');
const { getCachedClient } = require('../../core/services/db/utils/queue');

function createCookApi(deps = {}) {
  const router = express.Router();
  const logger = deps.logger || createLogger('CookAPI');
  // Collections database. Prefer the new `collections` service, falling back to legacy `cookCollections` for backward-compat.
  const cookDb = deps.db?.collections || deps.db?.cookCollections;
  const cooksDb = deps.db?.cooks;

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

      const { traitTypes = [], paramsTemplate = {}, traitTree = [], paramOverrides = {}, totalSupply } = req.body;

      if(!cooksDb) return res.status(503).json({ error: 'cooksDb-unavailable' });
      const cook = await cooksDb.createCook({ collectionId, initiatorAccountId: userId, targetSupply: totalSupply });
      const cookId = cook._id;

      const result = await CookOrchestratorService.startCook({
        collectionId,
        userId,
        cookId,
        spellId,
        toolId,
        traitTypes,
        paramsTemplate,
        traitTree,
        paramOverrides,
        totalSupply: Number.isFinite(totalSupply) ? totalSupply : 1,
      });

      logger.info(`[CookAPI] Started cook. Queued ${result.queued} for collection ${collectionId} by user ${userId}`);
      return res.json({ queued: result.queued, status: 'queued' });
    } catch (err) {
      logger.error('[CookAPI] start error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // Health check / ping
  router.get('/ping', (req, res) => res.json({ ok: true }));

  // GET /internal/cook/active - list active cook statuses for current user
  router.get('/active', async (req, res) => {
    try {
      const userId = req.query.userId || req.user?.userId || req.user?.id || req.userId;
      if (!userId) return res.json({ cooks: [] });

      // Ensure access to collections and job/events collections
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const client = await getCachedClient();
      const dbName = process.env.MONGO_DB_NAME || 'station';
      const db = client.db(dbName);
      // New canonical source for generated pieces.
      const genOutputsCol = db.collection('generationOutputs');
      // Legacy cook_jobs queue is optional. Fall back gracefully if missing.
      let jobsCol = null;
      try {
        await CookJobStore._init?.();
        jobsCol = CookJobStore.collection || db.collection('cook_jobs');
      } catch (_) {}

      // Base: collections owned by user
      let collections = await cookDb.findByUser(userId);

      // Augment with any collectionIds seen in jobs/events for this user (including legacy docs without userId)
      const jobCollIds = jobsCol ? await jobsCol.distinct('collectionId', { userId, status: { $in: ['queued', 'running'] } }) : [];
      const eventCollIds = await genOutputsCol.distinct('metadata.collectionId', { 'metadata.collectionId': { $exists: true }, masterAccountId: userId });
      const derivedIds = new Set([...(jobCollIds || []), ...(eventCollIds || [])]);
      const knownIds = new Set((collections || []).map(c => c.collectionId));
      const missing = Array.from(derivedIds).filter(id => !knownIds.has(id));
      if (missing.length) {
        try {
          const extra = await cookDb.findMany({ collectionId: { $in: missing } }, { projection: { _id: 0 } });
          collections = [...(collections || []), ...(extra || [])];
        } catch (_) {
          // If DB lookup fails, still proceed with minimal entries using just IDs
          for (const id of missing) {
            collections.push({ collectionId: id, name: 'Collection', description: '' });
          }
        }
      }

      // Build status per collection
      const cooks = [];
      for (const coll of (collections || [])) {
        const collectionId = coll.collectionId;
        const [queued, running, generated] = await Promise.all([
          jobsCol ? jobsCol.countDocuments({ userId, collectionId, status: 'queued' }) : 0,
          jobsCol ? jobsCol.countDocuments({ userId, collectionId, status: 'running' }) : 0,
          genOutputsCol.countDocuments({
            'metadata.collectionId': collectionId,
            status: 'completed',
            $or: [ { 'metadata.reviewOutcome': { $exists: false } }, { 'metadata.reviewOutcome': 'accepted' } ]
          }),
        ]);
        const targetSupply = coll.totalSupply || coll.config?.totalSupply || 0;
        const generationCount = generated;
        const isActive = (queued + running) > 0 || (targetSupply && generationCount < targetSupply);
        if (isActive) {
          cooks.push({
            collectionId,
            collectionName: coll.name || 'Untitled',
            generationCount,
            targetSupply,
            queued,
            running,
            updatedAt: coll.updatedAt,
          });
        }
      }

      return res.json({ cooks });
    } catch (err) {
      logger.error('[CookAPI] active list error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // GET /internal/cook/collections – list collections for user (fallback to all if none found to ease dev/testing)
  router.get('/collections', async (req, res) => {
    try {
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const userId = req.query.userId || req.user?.userId || req.user?.id || req.userId;
      let collections = [];
      if (userId) {
        collections = await cookDb.findByUser(userId);
        logger.info(`[CookAPI] collections list for user ${userId} -> ${collections?.length || 0}`);
      }
      if ((!collections || collections.length === 0)) {
        // Fallback: include legacy docs created without userId during early dev
        try {
          const legacy = await cookDb.findMany({ $or: [ { userId: { $exists: false } }, { userId: null } ] }, { projection: { _id: 0 } });
          if (Array.isArray(legacy) && legacy.length) {
            logger.warn(`[CookAPI] Falling back to legacy collections without userId: ${legacy.length}`);
            collections = legacy;
          }
        } catch (e) {
          logger.warn('[CookAPI] Legacy fallback failed', e.message);
        }
      }
      return res.json({ collections });
    } catch (err) {
      logger.error('[CookAPI] collections list error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // POST /internal/cook/collections – create collection
  router.post('/collections', async (req, res) => {
    try {
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const { name, description = '' } = req.body || {};
      const userId = req.user?.userId || req.user?.id || req.userId || req.body?.userId;
      if (!name) return res.status(400).json({ error: 'name required' });
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const doc = await cookDb.createCollection({ name, description, userId });
      return res.status(201).json(doc);
    } catch (err) {
      logger.error('[CookAPI] create collection error', err);
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

  // DELETE /internal/cook/collections/:id – delete a collection
  router.delete('/collections/:id', async (req, res) => {
    try {
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const collectionId = req.params.id;
      const userId = req.user?.id || req.userId;
      await cookDb.deleteCollection(collectionId, userId);
      return res.json({ ok: true });
    } catch (err) {
      logger.error('[CookAPI] delete collection error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // NEW: ----- Aliases for /collections root -----
  // These routes mirror the /collections/* ones but are mounted at root when the router
  // itself is mounted at `/collections` (e.g. /internal/v1/data/collections).

  // GET /            – list collections for user (same as /collections)
  router.get('/', async (req, res) => {
    // Re-use original handler logic without losing query params
    const userId = req.query.userId || req.user?.userId || req.user?.id || req.userId;
    try {
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      let collections = [];
      if (userId) {
        collections = await cookDb.findByUser(userId);
        logger.info(`[CookAPI] collections list for user ${userId} -> ${collections?.length || 0}`);
      }
      if ((!collections || collections.length === 0)) {
        try {
          const legacy = await cookDb.findMany({ $or: [ { userId: { $exists: false } }, { userId: null } ] }, { projection: { _id: 0 } });
          if (Array.isArray(legacy) && legacy.length) {
            logger.warn(`[CookAPI] Falling back to legacy collections without userId: ${legacy.length}`);
            collections = legacy;
          }
        } catch (e) {
          logger.warn('[CookAPI] Legacy fallback failed', e.message);
        }
      }
      return res.json({ collections });
    } catch (err) {
      logger.error('[CookAPI] collections list error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // POST /           – create collection
  router.post('/', async (req, res) => {
    req.url = '/collections';
    return router.handle(req, res);
  });

  // GET /:id         – get collection by ID
  router.get('/:id', async (req, res, next) => {
    // Prevent collision with other explicit routes like /active, /start etc.
    if (['start', 'active', 'ping', 'debug', 'status'].includes(req.params.id)) return next();
    req.url = `/collections/${encodeURIComponent(req.params.id)}`;
    return router.handle(req, res);
  });

  // PUT /:id         – update collection
  router.put('/:id', async (req, res, next) => {
    if (['start', 'active', 'ping', 'debug', 'status'].includes(req.params.id)) return next();
    req.url = `/collections/${encodeURIComponent(req.params.id)}`;
    return router.handle(req, res);
  });

  // DELETE /:id      – delete a collection
  router.delete('/:id', async (req, res, next) => {
    if (['start', 'active', 'ping', 'debug', 'status'].includes(req.params.id)) return next();
    req.url = `/collections/${encodeURIComponent(req.params.id)}`;
    return router.handle(req, res);
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

  // DEV: GET /internal/cook/debug/queue
  router.get('/debug/queue', async (req, res) => {
    try {
      const userId = req.query.userId;
      const filter = userId ? { userId } : {};
      const dbg = await CookJobStore.getQueueDebug(filter);
      return res.json(dbg);
    } catch (err) {
      logger.error('[CookAPI] debug queue error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  router.put('/cooks/:cookId', async (req,res)=>{
    if(!cooksDb) return res.status(503).json({ error: 'service-unavailable' });
    const { cookId } = req.params;
    const { generationId, status, costDeltaUsd } = req.body;
    const update={};
    if(generationId) update.$push = { generationIds: generationId };
    if(costDeltaUsd!==undefined) update.$inc = { costUsd: costDeltaUsd, generatedCount:1 };
    if(status) update.$set = { status, completedAt: status==='completed'?new Date():undefined };
    try{ await cooksDb.updateOne({ _id:cookId }, update); res.json({ ok:true }); }
    catch(e){ logger.error('cook update err',e); res.status(500).json({ error:'internal' }); }
  });

  return router;
}

module.exports = { createCookApi }; 