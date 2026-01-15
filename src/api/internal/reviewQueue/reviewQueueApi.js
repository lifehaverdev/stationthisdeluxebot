const express = require('express');
const { ObjectId } = require('mongodb');
const { getCachedClient } = require('../../../core/services/db/utils/queue');

const DEFAULT_POP_LIMIT = 48;
const MAX_POP_LIMIT = 100;

function createReviewQueueApi(dependencies = {}) {
  const { logger = console, db } = dependencies;
  if (!db || !db.reviewQueue) {
    logger.error('[reviewQueueApi] Missing reviewQueue DB dependency.');
    return null;
  }
  const reviewQueueDb = db.reviewQueue;
  const generationOutputsDb = db.generationOutputs;
  const router = express.Router();

  const getReviewerId = (req) => req.user?.userId || req.user?.id || req.body?.reviewerId || req.query?.reviewerId || null;

  router.post('/enqueue', async (req, res) => {
    try {
      const entries = Array.isArray(req.body?.entries) ? req.body.entries : [req.body];
      const results = [];
      for (const entry of entries) {
        if (!entry) continue;
        try {
          const enqueueResult = await reviewQueueDb.enqueueOrUpdate(entry);
          results.push({ generationId: entry.generationId, status: 'ok', result: enqueueResult });
        } catch (err) {
          logger.error('[reviewQueueApi] enqueue failed', err);
          results.push({ generationId: entry.generationId, status: 'error', error: err.message });
        }
      }
      res.json({ results });
    } catch (err) {
      logger.error('[reviewQueueApi] enqueue error', err);
      res.status(500).json({ error: 'enqueue_failed' });
    }
  });

  router.post('/pop', async (req, res) => {
    try {
      const { collectionId, limit, lockWindowMs, mode } = req.body || {};
      if (!collectionId) {
        return res.status(400).json({ error: 'collectionId_required' });
      }
      const reviewerId = getReviewerId(req);
      const batchLimit = Math.max(1, Math.min(parseInt(limit, 10) || DEFAULT_POP_LIMIT, MAX_POP_LIMIT));
      const normalizedMode = mode === 'cull' ? 'cull' : 'review';
      let claimed = await reviewQueueDb.claimNextBatch({ collectionId, limit: batchLimit, reviewerId, lockWindowMs, mode });

      if (claimed.length < batchLimit && !generationOutputsDb) {
        logger.warn('[reviewQueueApi] generationOutputsDb not available - fallback query skipped', { collectionId, mode: normalizedMode, claimed: claimed.length });
      }
      if (claimed.length < batchLimit && generationOutputsDb) {
        const needed = batchLimit - claimed.length;
        const fallbackLimit = Math.min(needed * 3, MAX_POP_LIMIT);
        const collectionMatch = {
          $or: [
            { 'metadata.collectionId': collectionId },
            { collectionId }
          ]
        };
        const unresolvedMatch = {
          $and: [
            {
              $or: [
                { 'metadata.reviewOutcome': { $exists: false } },
                { 'metadata.reviewOutcome': { $nin: ['accepted', 'approved', 'rejected'] } }
              ]
            },
            {
              $or: [
                { reviewOutcome: { $exists: false } },
                { reviewOutcome: { $nin: ['accepted', 'approved', 'rejected'] } }
              ]
            }
          ]
        };
        const cullMatch = {
          $and: [
        {
          $or: [
            { 'metadata.cullStatus': { $exists: false } },
            { 'metadata.cullStatus': { $in: ['', null, 'pending'] } },
            { cullStatus: { $exists: false } },
            { cullStatus: { $in: ['', null, 'pending'] } }
          ]
        },
            {
              $or: [
                { 'metadata.reviewOutcome': { $in: ['accepted', 'approved'] } },
                { reviewOutcome: { $in: ['accepted', 'approved'] } }
              ]
            }
          ]
        };
        const filter = {
          $and: [
            collectionMatch,
            { status: 'completed' },
            { deliveryStrategy: { $ne: 'spell_step' } },
            (mode === 'cull' ? cullMatch : unresolvedMatch)
          ]
        };
        // Diagnostic logging for cull mode
        if (mode === 'cull') {
          try {
            const baseCount = await generationOutputsDb.count({ $and: [collectionMatch, { status: 'completed' }, { deliveryStrategy: { $ne: 'spell_step' } }] });
            const approvedCount = await generationOutputsDb.count({
              $and: [
                collectionMatch,
                { status: 'completed' },
                { deliveryStrategy: { $ne: 'spell_step' } },
                { $or: [{ 'metadata.reviewOutcome': { $in: ['accepted', 'approved'] } }, { reviewOutcome: { $in: ['accepted', 'approved'] } }] }
              ]
            });
            const cullableCount = await generationOutputsDb.count(filter);
            logger.info('[reviewQueueApi] Cull fallback diagnostic', {
              collectionId,
              baseCount, // pieces with status:completed, no spell_step
              approvedCount, // pieces that passed review
              cullableCount, // pieces available for cull
              filter: JSON.stringify(filter)
            });
          } catch (diagErr) {
            logger.warn('[reviewQueueApi] Cull diagnostic query failed', diagErr.message);
          }
        }
        try {
        const fallbackGenerations = await generationOutputsDb.findMany(filter, {
          sort: { requestTimestamp: 1, _id: 1 },
          limit: fallbackLimit,
          projection: {
            requestTimestamp: 1,
            outputs: 1,
              artifactUrls: 1,
              responsePayload: 1,
              metadata: 1,
              status: 1,
              deliveryStrategy: 1
            }
          });
          for (const gen of fallbackGenerations) {
            await reviewQueueDb.enqueueOrUpdate({
              generationId: gen._id,
              collectionId,
              mode: normalizedMode,
              requestTimestamp: gen.requestTimestamp,
              metadata: {
                deliveryStrategy: gen.deliveryStrategy,
                ...gen.metadata
              }
            });
          }
          if (fallbackGenerations.length) {
            const additional = await reviewQueueDb.claimNextBatch({
              collectionId,
              limit: needed,
              reviewerId,
              lockWindowMs,
              mode
            });
            claimed = claimed.concat(additional);
          }
        } catch (seedErr) {
          logger.error('[reviewQueueApi] failed to seed review queue', seedErr);
        }
      }

      const logPopResult = (itemsList = []) => {
        if (typeof logger?.info !== 'function') return;
        const sample = claimed.slice(0, 5).map(doc => ({
          queueId: doc._id?.toString(),
          generationId: doc.generationId?.toString?.() ?? doc.generationId,
          status: doc.status,
          mode: doc.mode || normalizedMode
        }));
        logger.info('[reviewQueueApi] pop result', {
          collectionId,
          mode: normalizedMode,
          requestedLimit: batchLimit,
          claimedCount: claimed.length,
          returnedCount: itemsList.length,
          reviewerId: reviewerId || null,
          sample
        });
      };

      if (claimed.length && generationOutputsDb) {
        const genIds = claimed
          .map(item => item.generationId)
          .filter(Boolean)
          .map(id => (ObjectId.isValid(id) ? new ObjectId(id) : null))
          .filter(Boolean);
        let generationMap = new Map();
        if (genIds.length) {
          const generations = await generationOutputsDb.findMany(
            { _id: { $in: genIds } },
            {
              projection: {
                outputs: 1,
                responsePayload: 1,
                artifactUrls: 1,
                metadata: 1,
                requestTimestamp: 1,
                status: 1,
                deliveryStrategy: 1
              }
            }
          );
          generationMap = new Map(
            generations.map(doc => [doc._id?.toString(), { ...doc, _id: doc._id?.toString() }])
          );
        }
        const items = claimed.map(item => {
          const queueId = item._id?.toString();
          const generationId = item.generationId?.toString();
          return {
            queueId,
            generationId,
            status: item.status,
            assignedAt: item.assignedAt,
            metadata: item.metadata,
            generation: generationMap.get(generationId) || null
          };
        });
        logPopResult(items);
        return res.json({ items });
      }

      const items = claimed.map(item => ({
        queueId: item._id?.toString(),
        generationId: item.generationId?.toString(),
        status: item.status,
        assignedAt: item.assignedAt,
        metadata: item.metadata,
        generation: null
      }));
      logPopResult(items);
      res.json({ items });
    } catch (err) {
      logger.error('[reviewQueueApi] pop error', err);
      res.status(500).json({ error: 'pop_failed' });
    }
  });

  router.post('/commit', async (req, res) => {
    try {
      const { decisions } = req.body || {};
      if (!Array.isArray(decisions) || !decisions.length) {
        return res.status(400).json({ error: 'missing_decisions' });
      }
      const reviewerId = getReviewerId(req);
      const result = await reviewQueueDb.commitDecisions(decisions, { reviewerId });
      if (generationOutputsDb) {
        await Promise.all(decisions.map(async decision => {
          if (!decision?.generationId) return;
          const genId = ObjectId.isValid(decision.generationId)
            ? new ObjectId(decision.generationId)
            : null;
          if (!genId) return;
          try {
            if (decision.mode === 'cull') {
              const isExclude = decision.outcome === 'exclude';
              await generationOutputsDb.updateGenerationOutput(genId, {
                'metadata.cullStatus': isExclude ? 'excluded' : 'keep',
                cullStatus: isExclude ? 'excluded' : 'keep',
                'metadata.cullReviewedAt': new Date(),
                'metadata.exportExcluded': isExclude,
                exportExcluded: isExclude
              });
            } else {
              await generationOutputsDb.updateGenerationOutput(genId, {
                'metadata.reviewOutcome': decision.outcome,
                reviewOutcome: decision.outcome
              });
            }
          } catch (err) {
            logger.error('[reviewQueueApi] failed to update generation outcome', {
              generationId: decision.generationId,
              error: err.message
            });
          }
        }));
      }
      res.json({ result });
    } catch (err) {
      logger.error('[reviewQueueApi] commit error', err);
      res.status(500).json({ error: 'commit_failed' });
    }
  });

  router.post('/release', async (req, res) => {
    try {
      const { queueIds } = req.body || {};
      if (!Array.isArray(queueIds) || !queueIds.length) {
        return res.status(400).json({ error: 'missing_queue_ids' });
      }
      const reviewerId = getReviewerId(req);
      const released = await reviewQueueDb.releaseAssignments(queueIds, { reviewerId });
      res.json({ released });
    } catch (err) {
      logger.error('[reviewQueueApi] release error', err);
      res.status(500).json({ error: 'release_failed' });
    }
  });

  router.get('/stats', async (req, res) => {
    try {
      const { collectionId } = req.query;
      const stats = await reviewQueueDb.getStats(collectionId);
      res.json({ stats });
    } catch (err) {
      logger.error('[reviewQueueApi] stats error', err);
      res.status(500).json({ error: 'stats_failed' });
    }
  });

  router.post('/reap', async (req, res) => {
    try {
      const { lockWindowMs = 5 * 60 * 1000 } = req.body || {};
      const cutoff = new Date(Date.now() - lockWindowMs);
      const client = await getCachedClient();
      const collection = client.db(reviewQueueDb.dbName).collection(reviewQueueDb.collectionName);
      const result = await collection.updateMany(
        {
          status: 'in_progress',
          assignedAt: { $lte: cutoff }
        },
        {
          $set: { status: 'pending' },
          $unset: { assignedTo: '', assignedAt: '' }
        }
      );
      res.json({ reaped: result.modifiedCount || 0 });
    } catch (err) {
      logger.error('[reviewQueueApi] reap error', err);
      res.status(500).json({ error: 'reap_failed' });
    }
  });

  return router;
}

module.exports = createReviewQueueApi;
