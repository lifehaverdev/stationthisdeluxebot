const express = require('express');
const { CookOrchestratorService } = require('../../core/services/cook');
const { CookProjectionUpdater } = require('../../core/services/cook');
const { createLogger } = require('../../utils/logger');
const { getCachedClient } = require('../../core/services/db/utils/queue');
const { ObjectId } = require('mongodb');

function createCookApi(deps = {}) {
  const router = express.Router();
  const logger = deps.logger || createLogger('CookAPI');
  // Collections database. Prefer the new `collections` service, falling back to legacy `cookCollections` for backward-compat.
  const cookDb = deps.db?.collections || deps.db?.cookCollections;
  const cooksDb = deps.db?.cooks;
  const generationOutputsDb = deps.db?.generationOutputs;
  
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

  // POST /internal/v1/data/collections/:id/pause - pause an active cook
  router.post('/:id/pause', async (req, res) => {
    try {
      const collectionId = req.params.id;
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      if (!collectionId || !userId) {
        return res.status(400).json({ error: 'collectionId and userId required' });
      }

      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const collection = await cookDb.findById(collectionId);
      if (!collection) {
        return res.status(404).json({ error: 'collection-not-found' });
      }
      if (collection.userId !== userId) {
        return res.status(403).json({ error: 'unauthorized' });
      }

      const reason = req.body?.reason || 'manual';
      const result = await CookOrchestratorService.pauseCook({ collectionId, userId, reason });
      return res.json({ ...result, status: result?.status || 'paused' });
    } catch (err) {
      logger.error('[CookAPI] pause error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // POST /internal/v1/data/collections/:id/stop - stop an active cook
  router.post('/:id/stop', async (req, res) => {
    try {
      const collectionId = req.params.id;
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      if (!collectionId || !userId) {
        return res.status(400).json({ error: 'collectionId and userId required' });
      }

      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const collection = await cookDb.findById(collectionId);
      if (!collection) {
        return res.status(404).json({ error: 'collection-not-found' });
      }
      if (collection.userId !== userId) {
        return res.status(403).json({ error: 'unauthorized' });
      }

      const reason = req.body?.reason || 'manual';
      const result = await CookOrchestratorService.stopCook({ collectionId, userId, reason });
      return res.json({ ...result, status: result?.status || 'stopped' });
    } catch (err) {
      logger.error('[CookAPI] stop error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // GET /:id/analytics – collection analytics + export prep
  router.get('/:id/analytics', async (req, res) => {
    try {
      const collectionId = req.params.id;
      const userId = req.query.userId || req.user?.userId || req.user?.id || req.userId;
      if (!collectionId || !userId) {
        return res.status(400).json({ error: 'collectionId and userId required' });
      }
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      if (!generationOutputsDb) return res.status(503).json({ error: 'generationOutputs-unavailable' });

      const collection = await cookDb.findById(collectionId);
      if (!collection) {
        return res.status(404).json({ error: 'collection-not-found' });
      }
      if (collection.userId !== userId) {
        return res.status(403).json({ error: 'unauthorized' });
      }

      if (!ObjectId.isValid(userId)) {
        return res.status(400).json({ error: 'invalid-user-id' });
      }
      const masterAccountId = new ObjectId(userId);

      const match = {
        $and: [
          {
            $or: [
              { 'metadata.collectionId': collectionId },
              { collectionId }
            ]
          },
          { masterAccountId },
          { status: 'completed' },
          { deliveryStrategy: { $ne: 'spell_step' } }
        ]
      };

      const generations = await generationOutputsDb.findGenerations(match, {
        projection: {
          pointsSpent: 1,
          durationMs: 1,
          reviewOutcome: 1,
          requestTimestamp: 1,
          responseTimestamp: 1,
          metadata: 1
        }
      });

      let totalPointsSpent = 0;
      let totalDurationMs = 0;
      let durationSamples = 0;
      let approvedCount = 0;
      let rejectedCount = 0;
      let pendingCount = 0;

      const normalizeOutcome = (doc) => (doc.reviewOutcome || doc.metadata?.reviewOutcome || '').toLowerCase();

      for (const gen of generations) {
        const pointsVal = Number(gen.pointsSpent || 0);
        if (!Number.isNaN(pointsVal)) {
          totalPointsSpent += pointsVal;
        }
        const reviewOutcome = normalizeOutcome(gen);
        if (reviewOutcome === 'accepted' || reviewOutcome === 'approved') {
          approvedCount += 1;
        } else if (reviewOutcome === 'rejected') {
          rejectedCount += 1;
        } else {
          pendingCount += 1;
        }

        let duration = typeof gen.durationMs === 'number' ? gen.durationMs : null;
        if ((!duration || Number.isNaN(duration)) && gen.requestTimestamp && gen.responseTimestamp) {
          duration = new Date(gen.responseTimestamp) - new Date(gen.requestTimestamp);
        }
        if (Number.isFinite(duration) && duration > 0) {
          totalDurationMs += duration;
          durationSamples += 1;
        }
      }

      const totalGenerations = generations.length;
      const avgDurationMs = durationSamples ? totalDurationMs / durationSamples : 0;
      const decisionCount = approvedCount + rejectedCount;
      const approvalRate = decisionCount ? (approvedCount / decisionCount) * 100 : 0;
      const rejectionRate = decisionCount ? (rejectedCount / decisionCount) * 100 : 0;

      const traitUsageMap = new Map();
      const pushTraitStat = (category, name, outcome) => {
        if (!name) return;
        const key = `${category || 'Uncategorized'}::${name}`;
        if (!traitUsageMap.has(key)) {
          traitUsageMap.set(key, {
            category: category || 'Uncategorized',
            name,
            approved: 0,
            rejected: 0,
            pending: 0,
            total: 0
          });
        }
        const bucket = traitUsageMap.get(key);
        bucket.total += 1;
        if (outcome === 'accepted' || outcome === 'approved') bucket.approved += 1;
        else if (outcome === 'rejected') bucket.rejected += 1;
        else bucket.pending += 1;
      };

      const extractTraits = (gen) => {
        const entries = [];
        const meta = gen.metadata || {};
        const addEntry = (category, label) => {
          if (!label) return;
          entries.push({
            category: category || 'Uncategorized',
            label: String(label)
          });
        };
        const detailArrays = [
          meta.appliedTraits,
          meta.traits?.details,
          meta.traitDetails
        ];
        let detailsFound = false;
        detailArrays.forEach(arr => {
          if (Array.isArray(arr) && arr.length) {
            detailsFound = true;
            arr.forEach(item => {
              if (!item) return;
              const category = item.category || item.group || item.type || 'Uncategorized';
              const name = item.name || item.value || item.slug || item.label;
              addEntry(category, name);
            });
          }
        });
        if (!detailsFound) {
          const selectedSets = [
            meta.selectedTraits,
            meta.traits?.selected,
            meta.traitSel
          ];
          selectedSets.forEach(set => {
            if (set && typeof set === 'object') {
              Object.entries(set).forEach(([category, val]) => {
                if (val === undefined || val === null) return;
                const label = typeof val === 'string'
                  ? val.slice(0, 60)
                  : (val?.name || val?.value || val?.label || '');
                addEntry(category, label);
              });
            }
          });
        }
        return entries;
      };

      for (const gen of generations) {
        const entries = extractTraits(gen);
        if (!entries.length) continue;
        const seenKeys = new Set();
        const outcome = normalizeOutcome(gen);
        entries.forEach(entry => {
          const key = `${entry.category}::${entry.label}`;
          if (seenKeys.has(key)) return;
          seenKeys.add(key);
          pushTraitStat(entry.category, entry.label, outcome);
        });
      }

      const summary = {
        totalGenerations,
        totalPointsSpent,
        approvedCount,
        rejectedCount,
        pendingCount,
        approvalRate,
        rejectionRate,
        avgDurationMs,
        totalSupply: collection.totalSupply || collection.config?.totalSupply || 0
      };

      const approvedTotal = summary.approvedCount || 0;
      const traitRarity = Array.from(traitUsageMap.values())
        .map(entry => ({
          category: entry.category,
          name: entry.name,
          approved: entry.approved,
          rejected: entry.rejected,
          pending: entry.pending,
          total: entry.total,
          approvalRate: entry.total ? (entry.approved / entry.total) * 100 : null,
          approvalShare: approvedTotal ? (entry.approved / approvedTotal) * 100 : null
        }))
        .sort((a, b) => b.approved - a.approved || b.total - a.total);

      return res.json({
        summary,
        traitRarity,
        traitSampleCount: traitUsageMap.size,
        approvedGenerationsWithTraits: generations.filter(g => normalizeOutcome(g) === 'accepted' && Array.isArray(g.metadata?.appliedTraits)).length
      });
    } catch (err) {
      logger.error('[CookAPI] analytics error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  router.post('/:id/export', async (req, res) => {
    try {
      const exportService = deps.collectionExportService;
      if (!exportService) {
        return res.status(503).json({ error: 'export-service-unavailable' });
      }
      const collectionId = req.params.id;
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      if (!collectionId || !userId) {
        return res.status(400).json({ error: 'collectionId and userId required' });
      }
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const collection = await cookDb.findById(collectionId);
      if (!collection) {
        return res.status(404).json({ error: 'collection-not-found' });
      }
      if (collection.userId !== userId) {
        return res.status(403).json({ error: 'unauthorized' });
      }

      const metadataOptions = req.body?.metadataOptions || {};
      const job = await exportService.requestExport({ userId, collectionId, metadataOptions });
      return res.json(job);
    } catch (err) {
      if (['export-not-ready', 'no-approved-pieces', 'export-service-unavailable'].includes(err.message)) {
        const status = err.message === 'export-service-unavailable' ? 503 : 400;
        return res.status(status).json({ error: err.message });
      }
      logger.error('[CookAPI] export enqueue error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  router.post('/:id/publish', async (req, res) => {
    try {
      const exportService = deps.collectionExportService;
      if (!exportService) {
        return res.status(503).json({ error: 'export-service-unavailable' });
      }
      const collectionId = req.params.id;
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      if (!collectionId || !userId) {
        return res.status(400).json({ error: 'collectionId and userId required' });
      }
      if (!cookDb) return res.status(503).json({ error: 'service-unavailable' });
      const collection = await cookDb.findById(collectionId);
      if (!collection) {
        return res.status(404).json({ error: 'collection-not-found' });
      }
      if (collection.userId !== userId) {
        return res.status(403).json({ error: 'unauthorized' });
      }

      const metadataOptions = req.body?.metadataOptions || {};
      const job = await exportService.requestPublish({ userId, collectionId, metadataOptions });
      return res.json(job);
    } catch (err) {
      if (['already-published', 'no-approved-pieces', 'export-service-unavailable'].includes(err.message)) {
        const status = err.message === 'export-service-unavailable' ? 503 : 400;
        return res.status(status).json({ error: err.message });
      }
      logger.error('[CookAPI] publish enqueue error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  router.get('/:id/export/status', async (req, res) => {
    try {
      const exportService = deps.collectionExportService;
      if (!exportService) {
        return res.status(503).json({ error: 'export-service-unavailable' });
      }
      const collectionId = req.params.id;
      const userId = req.user?.userId || req.user?.id || req.query?.userId;
      if (!collectionId || !userId) {
        return res.status(400).json({ error: 'collectionId and userId required' });
      }

      const jobTypeParam = req.query.type;
      const normalizedJobType = jobTypeParam === 'gallery' || jobTypeParam === 'archive'
        ? jobTypeParam
        : null;
      const exportId = req.query.exportId;
      let job = null;
      if (exportId) {
        job = await exportService.getJobById(exportId);
      } else {
        job = await exportService.getLatestJob({ userId, collectionId, jobType: normalizedJobType });
      }

      if (!job) {
        return res.status(404).json({ error: 'export-not-found' });
      }
      if (job.userId !== userId || job.collectionId !== collectionId) {
        return res.status(403).json({ error: 'unauthorized' });
      }
      return res.json(job);
    } catch (err) {
      logger.error('[CookAPI] export status error', err);
      return res.status(500).json({ error: err.message || 'internal-error' });
    }
  });

  router.get('/:id/publish/status', async (req, res) => {
    try {
      const exportService = deps.collectionExportService;
      if (!exportService) {
        return res.status(503).json({ error: 'export-service-unavailable' });
      }
      const collectionId = req.params.id;
      const userId = req.user?.userId || req.user?.id || req.query?.userId;
      if (!collectionId || !userId) {
        return res.status(400).json({ error: 'collectionId and userId required' });
      }

      const exportId = req.query.exportId;
      let job = null;
      if (exportId) {
        job = await exportService.getJobById(exportId);
      } else {
        job = await exportService.getLatestJob({ userId, collectionId, jobType: 'gallery' });
      }

      if (!job) {
        return res.status(404).json({ error: 'export-not-found' });
      }
      if (job.userId !== userId || job.collectionId !== collectionId) {
        return res.status(403).json({ error: 'unauthorized' });
      }
      return res.json(job);
    } catch (err) {
      logger.error('[CookAPI] publish status error', err);
      return res.status(500).json({ error: err.message || 'internal-error' });
    }
  });

  router.post('/:id/export/cancel', async (req, res) => {
    try {
      const exportService = deps.collectionExportService;
      if (!exportService) {
        return res.status(503).json({ error: 'export-service-unavailable' });
      }
      const collectionId = req.params.id;
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      if (!collectionId || !userId) {
        return res.status(400).json({ error: 'collectionId and userId required' });
      }

      const job = await exportService.cancelJob({ collectionId, userId });
      if (!job) {
        return res.status(404).json({ error: 'export-not-found' });
      }
      return res.json(job);
    } catch (err) {
      logger.error('[CookAPI] export cancel error', err);
      return res.status(500).json({ error: err.message || 'internal-error' });
    }
  });

  router.get('/export/worker/status', async (req, res) => {
    try {
      const exportService = deps.collectionExportService;
      if (!exportService) {
        return res.status(503).json({ error: 'export-service-unavailable' });
      }
      const status = await exportService.getWorkerStatus({ includeQueueSize: true });
      return res.json(status);
    } catch (err) {
      logger.error('[CookAPI] export worker status error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  router.post('/export/worker/pause', async (req, res) => {
    try {
      const exportService = deps.collectionExportService;
      if (!exportService) {
        return res.status(503).json({ error: 'export-service-unavailable' });
      }
      const reason = req.body?.reason || 'manual';
      const status = await exportService.pauseProcessing({ reason });
      return res.json(status);
    } catch (err) {
      logger.error('[CookAPI] export worker pause error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  router.post('/export/worker/resume', async (req, res) => {
    try {
      const exportService = deps.collectionExportService;
      if (!exportService) {
        return res.status(503).json({ error: 'export-service-unavailable' });
      }
      const status = await exportService.resumeProcessing();
      return res.json(status);
    } catch (err) {
      logger.error('[CookAPI] export worker resume error', err);
      return res.status(500).json({ error: 'internal-error' });
    }
  });

  // POST /internal/cook/start
  router.post('/start', async (req, res) => {
    try {
      const { collectionId, userId, spellId, toolId } = req.body || {};
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

      const { traitTypes = [], paramsTemplate = {}, traitTree = [], paramOverrides = {}, totalSupply } = req.body || {};

      const collToolId = collection.toolId || collection.config?.toolId;
      const collSpellId = collection.spellId || collection.config?.spellId;
      let finalToolId = toolId || collToolId;
      let finalSpellId = null;
      if (finalToolId) {
        finalSpellId = null;
      } else {
        finalSpellId = spellId || collSpellId;
        if (!finalSpellId) {
          return res.status(400).json({ error: 'spellId-or-toolId-required' });
        }
      }

      const finalTraitTree = (Array.isArray(traitTree) && traitTree.length)
        ? traitTree
        : (collection.config?.traitTree || []);
      const finalParamOverrides = (paramOverrides && Object.keys(paramOverrides).length)
        ? paramOverrides
        : (collection.config?.paramOverrides || {});
      const finalTotalSupply = Number.isFinite(totalSupply) && Number(totalSupply) > 0
        ? Number(totalSupply)
        : (collection.totalSupply || collection.config?.totalSupply || 1);

      if(!cooksDb) return res.status(503).json({ error: 'cooksDb-unavailable' });
      const cook = await cooksDb.createCook({ collectionId, initiatorAccountId: userId, targetSupply: finalTotalSupply });
      const cookId = cook._id;

      const result = await CookOrchestratorService.startCook({
        collectionId,
        userId,
        cookId,
        spellId: finalSpellId,
        toolId: finalToolId,
        traitTypes,
        paramsTemplate,
        traitTree: finalTraitTree,
        paramOverrides: finalParamOverrides,
        totalSupply: Number.isFinite(finalTotalSupply) && finalTotalSupply > 0 ? finalTotalSupply : 1,
      });

      logger.info(`[CookAPI] Started cook. Queued ${result.queued} for collection ${collectionId} by user ${userId}`);
      return res.json({ queued: result.queued, status: 'queued' });
    } catch (err) {
      logger.error('[CookAPI] start error', err);
      const spellMissing = err?.response?.data?.error?.code === 'SPELL_CAST_FAILED'
        || /spell .* not found/i.test(err?.message || '');
      if (spellMissing) {
        return res.status(400).json({ error: 'generator-not-found' });
      }
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

      const normalizedUserId = String(userId);
      const projectionStatusCache = new Map();
      const getProjectionStatus = async (collectionId) => {
        if (!CookProjectionUpdater || typeof CookProjectionUpdater.getStatus !== 'function') {
          return null;
        }
        if (!projectionStatusCache.has(collectionId)) {
          const lookup = CookProjectionUpdater.getStatus(collectionId, normalizedUserId).catch((err) => {
            logger.warn(`[CookAPI] projection status lookup failed for collection ${collectionId}: ${err.message}`);
            return null;
          });
          projectionStatusCache.set(collectionId, lookup);
        }
        return projectionStatusCache.get(collectionId);
      };

      // Build status per collection
      const cooks = [];
      for (const coll of (collections || [])) {
        const collectionId = coll.collectionId;
        try {
          await CookOrchestratorService.reconcileState({ collectionId, userId });
        } catch (reconErr) {
          logger.warn(`[CookAPI] reconcileState failed for ${collectionId}: ${reconErr.message}`);
        }
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
        
        const baseMatch = [
          {
            $or: [
              { 'metadata.collectionId': collectionId },
              { collectionId } // legacy flat field
            ]
          },
          {
            $or: [
              { masterAccountId: userIdObj },
              { masterAccountId: userId }
            ]
          },
          { status: 'completed' },
          { deliveryStrategy: { $ne: 'spell_step' } }
        ];

        const countQuery = { $and: baseMatch };
        const reviewAcceptedFilter = {
          $or: [
            { 'metadata.reviewOutcome': { $in: ['accepted', 'approved'] } },
            { reviewOutcome: { $in: ['accepted', 'approved'] } }
          ]
        };
        const reviewRejectedFilter = {
          $or: [
            { 'metadata.reviewOutcome': { $in: ['rejected'] } },
            { reviewOutcome: { $in: ['rejected'] } }
          ]
        };
        const approvedQuery = { $and: [...baseMatch, reviewAcceptedFilter] };
        const rejectedQuery = { $and: [...baseMatch, reviewRejectedFilter] };
        
        const [generated, approved, rejected] = await Promise.all([
          genOutputsCol.countDocuments(countQuery),
          genOutputsCol.countDocuments(approvedQuery),
          genOutputsCol.countDocuments(rejectedQuery),
        ]);
        
        // ✅ Diagnostic logging to help diagnose counting issues (INFO level so it shows up)
        const totalForCollection = await genOutputsCol.countDocuments({
          $or: [
            { 'metadata.collectionId': collectionId },
            { collectionId }
                ]
        });
        
        if (totalForCollection > 0 && generated === 0) {
          // ✅ Sample a few generations to see what they look like
          const sampleGens = await genOutputsCol.find({
            $or: [
              { 'metadata.collectionId': collectionId },
              { collectionId }
            ]
          }).limit(3).toArray();
          
          logger.info(`[CookAPI] ⚠️ Found ${totalForCollection} total generations for collection ${collectionId}, but 0 match completed filter.`);
          logger.info(`[CookAPI] Sample generation details:`, JSON.stringify(sampleGens.map(g => ({
            _id: String(g._id),
            status: g.status,
            masterAccountId: String(g.masterAccountId),
            userId: userId,
            userIdMatches: String(g.masterAccountId) === String(userId) || String(g.masterAccountId) === String(userIdObj),
            metadataCollectionId: g.metadata?.collectionId,
            flatCollectionId: g.collectionId,
            deliveryStrategy: g.deliveryStrategy,
            reviewOutcome: g.metadata?.reviewOutcome || g.reviewOutcome,
            hasMetadata: !!g.metadata
          })), null, 2));
          logger.info(`[CookAPI] Query used:`, JSON.stringify(countQuery, null, 2));
        } else if (generated > 0) {
          logger.info(`[CookAPI] ✅ Collection ${collectionId}: Found ${generated}/${totalForCollection} completed generations matching query`);
        }
        
        const targetSupply = coll.totalSupply || coll.config?.totalSupply || 0;
        const generationCount = generated;
        const approvedCount = approved;
        const rejectedCount = rejected;
        const pendingReviewCount = Math.max(0, generationCount - approvedCount - rejectedCount);
        // ✅ Use running count from orchestrator (in-memory state) - no deprecated job store
        const running = runningFromOrchestrator;
        const queued = 0; // ✅ No queued jobs - orchestrator handles scheduling directly
        // ✅ Include cooks that are: actively running, paused but not complete, OR completed and awaiting review
        const isActive = running > 0 || (targetSupply && generationCount < targetSupply);
        const isAwaitingReview = targetSupply > 0 && generationCount >= targetSupply && running === 0;
        
        // ✅ Debug logging for status determination
        logger.debug(`[CookAPI] Collection ${collectionId}: generationCount=${generationCount}, targetSupply=${targetSupply}, running=${running}, isActive=${isActive}, isAwaitingReview=${isAwaitingReview}`);
        
        const projectionStatus = await getProjectionStatus(collectionId);
        const normalizedProjectionState = typeof projectionStatus?.state === 'string'
          ? projectionStatus.state.toLowerCase()
          : null;
        const projectionIndicatesStopped = normalizedProjectionState === 'stopped';
        const projectionIndicatesPaused = normalizedProjectionState === 'paused';
        const projectionIndicatesRunning = normalizedProjectionState === 'cooking';
        const projectionIndicatesCompleted = normalizedProjectionState === 'completed';

        let status = 'paused';
        if (orchestratorState?.stopped || projectionIndicatesStopped) {
          status = 'stopped';
        } else if (running > 0 || projectionIndicatesRunning) {
          status = 'running';
        } else if (isAwaitingReview || projectionIndicatesCompleted) {
          status = 'awaiting_review';
        } else if (orchestratorState?.paused || projectionIndicatesPaused) {
          status = 'paused';
        }
        const pauseReason = orchestratorState?.pauseReason || null;

        if (isActive || isAwaitingReview) {
          cooks.push({
            collectionId,
            collectionName: coll.name || 'Untitled',
            generationCount,
            approvedCount,
            rejectedCount,
            pendingReviewCount,
            targetSupply,
            queued,
            running, // ✅ Running count from orchestrator only
            updatedAt: coll.updatedAt,
            status,
            pauseReason,
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
      
      const wantsTool = Boolean(
        update.toolId ||
        update.generatorType === 'tool' ||
        (update.config && update.config.toolId)
      );
      const wantsSpell = Boolean(
        update.spellId ||
        update.generatorType === 'spell' ||
        (update.config && update.config.spellId)
      );
      
      if (wantsTool) {
        // Setting toolId - clear spellId fields (both top-level and in config)
        unsetFields.spellId = '';
        unsetFields['config.spellId'] = '';
      } else if (wantsSpell) {
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
    if (['start', 'active', 'ping', 'debug', 'status', 'resume', 'pause', 'stop'].includes(req.params.id)) return next();
    req.url = `/collections/${encodeURIComponent(req.params.id)}`;
    return router.handle(req, res);
  });

  // PUT /:id         – update collection
  router.put('/:id', async (req, res, next) => {
    if (['start', 'active', 'ping', 'debug', 'status', 'resume', 'pause', 'stop'].includes(req.params.id)) return next();
    req.url = `/collections/${encodeURIComponent(req.params.id)}`;
    return router.handle(req, res);
  });

  // DELETE /:id      – delete a collection
  router.delete('/:id', async (req, res, next) => {
    if (['start', 'active', 'ping', 'debug', 'status', 'resume', 'pause', 'stop'].includes(req.params.id)) return next();
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
