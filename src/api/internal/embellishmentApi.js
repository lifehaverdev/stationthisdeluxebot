// src/api/internal/embellishmentApi.js
console.log('[EmbellishmentAPI] Module loading...');

const express = require('express');
const { ObjectId } = require('mongodb');

console.log('[EmbellishmentAPI] Dependencies loaded');

/**
 * Embellishment API endpoints
 *
 * POST   /datasets/:id/embellish        - Start embellishment task
 * GET    /datasets/:id/embellishments   - List embellishments
 * DELETE /datasets/:id/embellishments/:embellishmentId - Remove embellishment
 * POST   /embellishment-tasks/:taskId/cancel - Cancel task
 * GET    /embellishment-tasks/:taskId   - Get task progress
 */
function createEmbellishmentApi({ logger, db, embellishmentTaskService }) {
  const router = express.Router();

  logger.info('[EmbellishmentAPI] Creating embellishment API router...');

  if (!db) {
    logger.error('[EmbellishmentAPI] db is undefined!');
    return router;
  }

  const datasetDb = db.dataset;
  const spellsDb = db.spells;

  if (!datasetDb) {
    logger.error('[EmbellishmentAPI] datasetDb is undefined!');
  }
  if (!spellsDb) {
    logger.error('[EmbellishmentAPI] spellsDb is undefined!');
  }

  // Debug middleware to log all requests hitting this router
  router.use((req, res, next) => {
    logger.info(`[EmbellishmentAPI] Incoming: ${req.method} ${req.path}`);
    next();
  });

  // POST /datasets/:datasetId/embellish - Start an embellishment task
  router.post('/datasets/:datasetId/embellish', async (req, res) => {
    const { datasetId } = req.params;
    const { spellSlug, masterAccountId, parameterOverrides } = req.body;

    logger.info(`[EmbellishmentAPI] POST /datasets/${datasetId}/embellish - spell=${spellSlug}`);

    if (!spellSlug) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'spellSlug is required' } });
    }
    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }

    try {
      const result = await embellishmentTaskService.startTask(
        datasetId,
        spellSlug,
        masterAccountId,
        parameterOverrides || {}
      );

      res.status(202).json({
        success: true,
        data: {
          taskId: result.taskId,
          embellishmentId: result.embellishmentId,
          type: result.type,
          totalItems: result.totalItems,
          message: 'Embellishment task started',
        },
      });
    } catch (err) {
      logger.error('[EmbellishmentAPI] Failed to start embellishment task:', err);

      const statusCode = err.message.includes('not found') ? 404 :
                        err.message.includes('own') ? 403 :
                        err.message.includes('already running') ? 409 :
                        400;

      res.status(statusCode).json({
        error: { code: 'EMBELLISHMENT_ERROR', message: err.message }
      });
    }
  });

  // GET /datasets/:datasetId/embellishments - List embellishments for dataset
  router.get('/datasets/:datasetId/embellishments', async (req, res) => {
    const { datasetId } = req.params;
    const { type } = req.query;

    try {
      const embellishments = await datasetDb.getEmbellishments(datasetId, type || null);
      res.json({ success: true, data: embellishments });
    } catch (err) {
      logger.error('[EmbellishmentAPI] Failed to fetch embellishments:', err);
      res.status(500).json({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch embellishments' } });
    }
  });

  // DELETE /datasets/:datasetId/embellishments/:embellishmentId - Remove embellishment
  router.delete('/datasets/:datasetId/embellishments/:embellishmentId', async (req, res) => {
    const { datasetId, embellishmentId } = req.params;
    const { masterAccountId } = req.body;

    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }

    try {
      // Verify ownership
      const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
      if (!dataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      if (dataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete your own embellishments' } });
      }

      await datasetDb.removeEmbellishment(datasetId, embellishmentId);
      res.json({ success: true, data: { deleted: true } });
    } catch (err) {
      logger.error('[EmbellishmentAPI] Failed to delete embellishment:', err);
      res.status(500).json({ error: { code: 'DELETE_ERROR', message: 'Failed to delete embellishment' } });
    }
  });

  // POST /embellishment-tasks/:taskId/cancel - Cancel running task
  router.post('/embellishment-tasks/:taskId/cancel', async (req, res) => {
    const { taskId } = req.params;
    const { masterAccountId } = req.body;

    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }

    try {
      const result = await embellishmentTaskService.cancelTask(taskId, masterAccountId);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('[EmbellishmentAPI] Failed to cancel task:', err);

      const statusCode = err.message.includes('not found') ? 404 :
                        err.message.includes('own') ? 403 : 500;

      res.status(statusCode).json({
        error: { code: 'CANCEL_ERROR', message: err.message }
      });
    }
  });

  // GET /embellishment-tasks/:taskId - Get task progress
  router.get('/embellishment-tasks/:taskId', async (req, res) => {
    const { taskId } = req.params;

    try {
      const progress = await embellishmentTaskService.getTaskProgress(taskId);
      if (!progress) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Task not found' } });
      }
      res.json({ success: true, data: progress });
    } catch (err) {
      logger.error('[EmbellishmentAPI] Failed to get task progress:', err);
      res.status(500).json({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch task progress' } });
    }
  });

  // Test endpoint to verify router is mounted
  router.get('/embellishment-test', (req, res) => {
    logger.info('[EmbellishmentAPI] Test endpoint hit!');
    res.json({ success: true, message: 'Embellishment API is mounted correctly' });
  });

  logger.info('[EmbellishmentAPI] Registering POST /datasets/:datasetId/embellishments/manual');

  // POST /datasets/:datasetId/embellishments/manual - Create manual embellishment (for user-written captions)
  router.post('/datasets/:datasetId/embellishments/manual', async (req, res) => {
    logger.info(`[EmbellishmentAPI] Manual embellishment route hit! datasetId=${req.params.datasetId}`);
    const { datasetId } = req.params;
    const { masterAccountId, type = 'caption' } = req.body;

    logger.info(`[EmbellishmentAPI] POST /datasets/${datasetId}/embellishments/manual - type=${type}`);

    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }

    try {
      // Verify ownership
      const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
      if (!dataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      if (dataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only add embellishments to your own datasets' } });
      }
      if (!dataset.images || dataset.images.length === 0) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Dataset has no images' } });
      }

      // Create embellishment with empty results (user will fill in)
      const embellishment = await datasetDb.addEmbellishment(datasetId, {
        type,
        method: 'manual',
        status: 'completed', // Manual embellishments are "complete" immediately (user edits inline)
        createdBy: masterAccountId,
        results: dataset.images.map(() => ({ value: null, generationOutputId: null })),
      });

      res.status(201).json({
        success: true,
        data: {
          embellishmentId: embellishment._id,
          type,
          method: 'manual',
          totalItems: dataset.images.length,
        },
      });
    } catch (err) {
      logger.error('[EmbellishmentAPI] Failed to create manual embellishment:', err);
      res.status(500).json({ error: { code: 'CREATE_ERROR', message: 'Failed to create embellishment' } });
    }
  });

  // PATCH /datasets/:datasetId/embellishments/:embellishmentId/results/:index - Update a single result
  router.patch('/datasets/:datasetId/embellishments/:embellishmentId/results/:index', async (req, res) => {
    const { datasetId, embellishmentId, index } = req.params;
    const { masterAccountId, value } = req.body;
    const resultIndex = parseInt(index, 10);

    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }
    if (isNaN(resultIndex) || resultIndex < 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid result index' } });
    }

    try {
      // Verify ownership
      const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
      if (!dataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      if (dataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only edit your own embellishments' } });
      }

      await datasetDb.updateEmbellishmentResult(datasetId, embellishmentId, resultIndex, {
        value: value ?? null,
        generationOutputId: null, // Manual entries don't have generation outputs
      });

      res.json({ success: true, data: { updated: true, index: resultIndex } });
    } catch (err) {
      logger.error('[EmbellishmentAPI] Failed to update embellishment result:', err);
      res.status(500).json({ error: { code: 'UPDATE_ERROR', message: 'Failed to update result' } });
    }
  });

  // PATCH /datasets/:datasetId/embellishments/:embellishmentId/results - Bulk update results
  router.patch('/datasets/:datasetId/embellishments/:embellishmentId/results', async (req, res) => {
    const { datasetId, embellishmentId } = req.params;
    const { masterAccountId, results } = req.body;

    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }
    if (!Array.isArray(results)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'results must be an array' } });
    }

    try {
      // Verify ownership
      const dataset = await datasetDb.findOne({ _id: new ObjectId(datasetId) });
      if (!dataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      if (dataset.ownerAccountId.toString() !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only edit your own embellishments' } });
      }

      // Update each result
      for (let i = 0; i < results.length; i++) {
        if (results[i] !== undefined) {
          await datasetDb.updateEmbellishmentResult(datasetId, embellishmentId, i, {
            value: results[i]?.value ?? results[i] ?? null,
            generationOutputId: null,
          });
        }
      }

      res.json({ success: true, data: { updated: true, count: results.length } });
    } catch (err) {
      logger.error('[EmbellishmentAPI] Failed to bulk update embellishment results:', err);
      res.status(500).json({ error: { code: 'UPDATE_ERROR', message: 'Failed to update results' } });
    }
  });

  // GET /embellishment-spells - List spells with embellishment capabilities
  router.get('/embellishment-spells', async (req, res) => {
    const { type } = req.query;

    try {
      const spells = await spellsDb.findEmbellishmentSpells(type || null);

      // Return simplified spell info
      const simplified = spells.map(spell => ({
        slug: spell.slug,
        name: spell.name,
        description: spell.description,
        embellishment: spell.embellishment,
      }));

      res.json({ success: true, data: simplified });
    } catch (err) {
      logger.error('[EmbellishmentAPI] Failed to fetch embellishment spells:', err);
      res.status(500).json({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch embellishment spells' } });
    }
  });

  logger.info(`[EmbellishmentAPI] Router created with ${router.stack.length} routes`);
  return router;
}

module.exports = createEmbellishmentApi;
