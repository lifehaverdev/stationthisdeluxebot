const express = require('express');
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
  
  // ✅ Configure WebSocket service for CookOrchestratorService
  if (deps.webSocketService) {
    CookOrchestratorService.setWebSocketService(deps.webSocketService);
    logger.info('[CookAPI] WebSocket service configured for CookOrchestratorService');
  }

  // POST /internal/v1/data/collections/:id/resume - resume a paused/stopped cook
  // Note: This must be defined BEFORE the catch-all /:id routes
  router.post('/:id/resume', async (req, res) => {
    try {
      const collectionId = req.params.id;
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      if (!collectionId || !userId) {
        return res.status(400).json({ error: 'collectionId and userId required' });
      }

      // ✅ AUTHORIZATION CHECK: Verify collection exists and user owns it
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const collection = await cookDb.findById(collectionId);
      if (!collection) {
        return res.status(404).json({ error: 'collection-not-found' });
      }
      if (collection.userId !== userId) {
        return res.status(403).json({ error: 'unauthorized' });
      }

      const { spellId, toolId, traitTree = [], paramOverrides = {}, totalSupply } = req.body;
      
      // ✅ Get current collection config
      const collToolId = collection.toolId || collection.config?.toolId;
      const collSpellId = collection.spellId || collection.config?.spellId;
      
      // ✅ Determine final toolId and spellId - prioritize toolId over spellId
      // Rule: If toolId exists (in request or collection), use it and ignore spellId
      // This handles cases where collection was migrated from spell to tool but still has stale spellId
      let finalToolId = toolId || collToolId;
      let finalSpellId = null;
      
      if (finalToolId) {
        // ✅ toolId exists - use it and clear spellId
        finalSpellId = null;
      } else {
        // No toolId - fall back to spellId
        finalSpellId = spellId || collSpellId;
        if (!finalSpellId) {
          return res.status(400).json({ error: 'spellId or toolId required' });
        }
      }
      
      const finalTraitTree = traitTree.length ? traitTree : (collection.config?.traitTree || []);
      const finalParamOverrides = Object.keys(paramOverrides).length ? paramOverrides : (collection.config?.paramOverrides || {});
      const finalTotalSupply = Number.isFinite(totalSupply) ? totalSupply : (collection.totalSupply || collection.config?.totalSupply || 1);

      if(!cooksDb) return res.status(503).json({ error: 'cooksDb-unavailable' });
      // Create a new cook record for the resume
      const cook = await cooksDb.createCook({ collectionId, initiatorAccountId: userId, targetSupply: finalTotalSupply });
      const cookId = cook._id;

      // Return immediately and process startCook in the background to avoid timeout
      // startCook handles resuming automatically by checking producedSoFar
      logger.info(`[CookAPI] Starting resume cook for collection ${collectionId}, userId: ${userId}, cookId: ${cookId}, spellId: ${finalSpellId}, toolId: ${finalToolId}, totalSupply: ${finalTotalSupply}`);
      
      CookOrchestratorService.startCook({
        collectionId,
        userId,
        cookId,
        spellId: finalSpellId,
        toolId: finalToolId,
        traitTypes: [],
        paramsTemplate: {},
        traitTree: finalTraitTree,
        paramOverrides: finalParamOverrides,
        totalSupply: finalTotalSupply,
      }).then(result => {
        logger.info(`[CookAPI] Resumed cook successfully. Queued ${result.queued} pieces for collection ${collectionId} by user ${userId}`);
      }).catch(err => {
        logger.error(`[CookAPI] Resume cook error for collection ${collectionId}:`, err);
        logger.error(`[CookAPI] Resume cook error stack:`, err.stack);
      });

      // Return immediately to avoid timeout
      return res.json({ queued: 0, status: 'resuming' });
    } catch (err) {
      logger.error('[CookAPI] resume error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

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

      // ✅ AUTHORIZATION CHECK: Verify collection exists and user owns it
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const collection = await cookDb.findById(collectionId);
      if (!collection) {
        return res.status(404).json({ error: 'collection-not-found' });
      }
      if (collection.userId !== userId) {
        return res.status(403).json({ error: 'unauthorized' });
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
      // ✅ Canonical source for generated pieces - no longer using deprecated cook_jobs
      const genOutputsCol = db.collection('generationOutputs');

      // Base: collections owned by user
      let collections = await cookDb.findByUser(userId);

      // ✅ Augment with any collectionIds seen in generation outputs for this user
      const eventCollIds = await genOutputsCol.distinct('metadata.collectionId', { 'metadata.collectionId': { $exists: true }, masterAccountId: userId });
      const derivedIds = new Set([...(eventCollIds || [])]);
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
        // ✅ Get running count from CookOrchestratorService (in-memory state)
        const orchestratorKey = `${collectionId}:${userId}`;
        const orchestratorState = CookOrchestratorService.runningByCollection?.get(orchestratorKey);
        const runningFromOrchestrator = orchestratorState?.running?.size || 0;
        
        // ✅ Use same query logic as _getProducedCount for consistency
        const { ObjectId } = require('mongodb');
        // ✅ Handle both string and ObjectId formats for userId
        let userIdObj;
        if (ObjectId.isValid(userId)) {
          userIdObj = new ObjectId(userId);
        } else {
          // If userId is not a valid ObjectId, try to find generations with string match too
          userIdObj = userId;
        }
        
        const countQuery = {
          $and: [
            {
              $or: [
                { 'metadata.collectionId': collectionId },
                { collectionId } // legacy flat field
              ]
            },
            {
              $or: [
                { masterAccountId: userIdObj }, // ✅ Match ObjectId format
                { masterAccountId: userId } // ✅ Also try string format
              ]
            },
            { status: 'completed' }, // ✅ Use same status filter as _getProducedCount
            { deliveryStrategy: { $ne: 'spell_step' } },
            {
              $or: [
                { 'metadata.reviewOutcome': { $exists: false } },
                { 'metadata.reviewOutcome': { $ne: 'rejected' } } // ✅ Match _getProducedCount logic
              ]
            },
            {
              $or: [
                { reviewOutcome: { $exists: false } },
                { reviewOutcome: { $ne: 'rejected' } } // ✅ Also check flat field
              ]
            }
          ]
        };
        
        const [generated] = await Promise.all([
          genOutputsCol.countDocuments(countQuery),
        ]);
        
        // ✅ Debug logging to help diagnose counting issues
        if (generated === 0) {
          // Check if there are any generations at all for this collection
          const totalForCollection = await genOutputsCol.countDocuments({
            $or: [
              { 'metadata.collectionId': collectionId },
              { collectionId }
            ]
          });
          if (totalForCollection > 0) {
            // ✅ Sample a few generations to see what they look like
            const sampleGens = await genOutputsCol.find({
              $or: [
                { 'metadata.collectionId': collectionId },
                { collectionId }
              ]
            }).limit(3).toArray();
            
            logger.debug(`[CookAPI] Found ${totalForCollection} total generations for collection ${collectionId}, but 0 match completed filter.`);
            logger.debug(`[CookAPI] Sample generations:`, sampleGens.map(g => ({
              _id: g._id,
              status: g.status,
              masterAccountId: g.masterAccountId,
              userId: userId,
              userIdObj: userIdObj,
              metadataCollectionId: g.metadata?.collectionId,
              collectionId: g.collectionId,
              deliveryStrategy: g.deliveryStrategy,
              reviewOutcome: g.metadata?.reviewOutcome || g.reviewOutcome
            })));
            logger.debug(`[CookAPI] Query used:`, JSON.stringify(countQuery, null, 2));
          }
        } else {
          // ✅ Log successful matches too for debugging
          logger.debug(`[CookAPI] Collection ${collectionId}: Found ${generated} completed generations matching query`);
        }
        
        const targetSupply = coll.totalSupply || coll.config?.totalSupply || 0;
        const generationCount = generated;
        // ✅ Use running count from orchestrator (in-memory state) - no deprecated job store
        const running = runningFromOrchestrator;
        const queued = 0; // ✅ No queued jobs - orchestrator handles scheduling directly
        // ✅ Include cooks that are: actively running, paused but not complete, OR completed and awaiting review
        const isActive = running > 0 || (targetSupply && generationCount < targetSupply);
        const isAwaitingReview = targetSupply > 0 && generationCount >= targetSupply && running === 0;
        
        // ✅ Debug logging for status determination
        logger.debug(`[CookAPI] Collection ${collectionId}: generationCount=${generationCount}, targetSupply=${targetSupply}, running=${running}, isActive=${isActive}, isAwaitingReview=${isAwaitingReview}`);
        
        if (isActive || isAwaitingReview) {
          cooks.push({
            collectionId,
            collectionName: coll.name || 'Untitled',
            generationCount,
            targetSupply,
            queued,
            running, // ✅ Running count from orchestrator only
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
      
      // ✅ Clear stale spellId/toolId when switching between them
      // If toolId is being set, clear spellId (and vice versa)
      // This handles cases where collection was migrated from spell to tool
      const unsetFields = {};
      
      if (update.toolId || (update.config && update.config.toolId)) {
        // Setting toolId - clear spellId fields (both top-level and in config)
        unsetFields.spellId = '';
        unsetFields['config.spellId'] = '';
      } else if (update.spellId || (update.config && update.config.spellId)) {
        // Setting spellId - clear toolId fields (both top-level and in config)
        unsetFields.toolId = '';
        unsetFields['config.toolId'] = '';
      }
      
      // Use updateCollection with unset support
      await cookDb.updateCollection(collectionId, update, unsetFields);
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

  // POST /:id/resume – resume cook (must be before catch-all /:id route)
  // This route is already defined above, but we need to ensure it's not caught by catch-all

  // GET /:id         – get collection by ID
  router.get('/:id', async (req, res, next) => {
    // Prevent collision with other explicit routes like /active, /start etc.
    if (['start', 'active', 'ping', 'debug', 'status', 'resume'].includes(req.params.id)) return next();
    req.url = `/collections/${encodeURIComponent(req.params.id)}`;
    return router.handle(req, res);
  });

  // PUT /:id         – update collection
  router.put('/:id', async (req, res, next) => {
    if (['start', 'active', 'ping', 'debug', 'status', 'resume'].includes(req.params.id)) return next();
    req.url = `/collections/${encodeURIComponent(req.params.id)}`;
    return router.handle(req, res);
  });

  // DELETE /:id      – delete a collection
  router.delete('/:id', async (req, res, next) => {
    if (['start', 'active', 'ping', 'debug', 'status', 'resume'].includes(req.params.id)) return next();
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
  // ✅ DEPRECATED: Removed /debug/queue endpoint - CookJobStore is deprecated
  // Use CookOrchestratorService.runningByCollection for debugging instead

  router.put('/cooks/:cookId', async (req,res)=>{
    if(!cooksDb) return res.status(503).json({ error: 'service-unavailable' });
    const { cookId } = req.params;
    const { ObjectId } = require('mongodb');
    const idFilter = { _id: new ObjectId(cookId) };
    const { generationId, status, costDeltaUsd } = req.body;
    const update={};
    // ✅ Convert generationId to ObjectId if provided
    if(generationId) {
      const genIdObj = ObjectId.isValid(generationId) ? new ObjectId(generationId) : generationId;
      update.$push = { generationIds: genIdObj };
    }
    if(costDeltaUsd!==undefined) update.$inc = { costUsd: costDeltaUsd, generatedCount:1 };
    if(status) update.$set = { status, completedAt: status==='completed'?new Date():undefined };
    // ✅ Always update updatedAt
    if(!update.$set) update.$set = {};
    update.$set.updatedAt = new Date();
    try{ 
      await cooksDb.updateOne(idFilter, update); 
      logger.info(`[CookAPI] Updated cook ${cookId} with generationId: ${generationId}, costDelta: ${costDeltaUsd}, status: ${status}`);
      res.json({ ok:true }); 
    }
    catch(e){ 
      logger.error('[CookAPI] cook update err', e); 
      res.status(500).json({ error:'internal' }); 
    }
  });

  return router;
}

module.exports = { createCookApi }; 