const express = require('express');

const MAX_BULK_REVIEW_DECISIONS = 50;

/**
 * createCookApiRouter
 * External-facing router for Cook Mode (Collections).
 * Delegates to internal /v1/data/cook endpoints via internalApiClient.
 */
function createCookApiRouter(deps = {}) {
  const router = express.Router();
  const internalApiClient = deps.internalApiClient || (deps.internal && deps.internal.client);
  const longRunningApiClient = deps.longRunningApiClient || internalApiClient;
  const logger = (deps.logger || console).child ? (deps.logger || console).child({ mod: 'ExternalCookApi' }) : (deps.logger || console);

  if (!internalApiClient) {
    logger.error('[ExternalCookApi] internalApiClient missing – router disabled');
    return null;
  }

  // GET /api/v1/cooks/active
  router.get('/cooks/active', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.query.userId;
      const { data } = await internalApiClient.get('/internal/v1/data/cook/active', { params: { userId } });
      return res.json(data);
    } catch (err) {
      logger.error('active cooks proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // GET /api/v1/collections
  router.get('/collections', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.query.userId;
      const { data } = await internalApiClient.get('/internal/v1/data/collections', { params: { userId } });
      return res.json(data);
    } catch (err) {
      logger.error('collections list proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // GET /api/v1/collections/:id
  router.get('/collections/:id', async (req, res) => {
    try {
      const { data } = await internalApiClient.get(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}`);
      return res.json(data);
    } catch (err) {
      logger.error('get collection proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // GET /api/v1/collections/:id/analytics
  router.get('/collections/:id/analytics', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.query.userId;
      const { data } = await internalApiClient.get(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}/analytics`, { params: { userId } });
      return res.json(data);
    } catch (err) {
      logger.error('collection analytics proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  router.post('/collections/:id/export', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      const metadataOptions = req.body?.metadataOptions;
      const { data } = await internalApiClient.post(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}/export`, {
        userId,
        metadataOptions
      });
      return res.json(data);
    } catch (err) {
      logger.error('collection export proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  router.get('/collections/:id/export/status', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.query?.userId;
      const params = { userId };
      if (req.query?.exportId) params.exportId = req.query.exportId;
      if (req.query?.type) params.type = req.query.type;
      const { data } = await internalApiClient.get(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}/export/status`, { params });
      return res.json(data);
    } catch (err) {
      logger.error('collection export status proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  router.post('/collections/:id/publish', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      const metadataOptions = req.body?.metadataOptions;
      const { data } = await internalApiClient.post(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}/publish`, {
        userId,
        metadataOptions
      });
      return res.json(data);
    } catch (err) {
      logger.error('collection publish proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  router.get('/collections/:id/publish/status', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.query?.userId;
      const params = { userId };
      if (req.query?.exportId) params.exportId = req.query.exportId;
      const { data } = await internalApiClient.get(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}/publish/status`, { params });
      return res.json(data);
    } catch (err) {
      logger.error('collection publish status proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  router.post('/collections/:id/export/cancel', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      const { data } = await internalApiClient.post(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}/export/cancel`, { userId });
      return res.json(data);
    } catch (err) {
      logger.error('collection export cancel proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // PUT /api/v1/collections/:id
  router.put('/collections/:id', async (req, res) => {
    try {
      const { data } = await internalApiClient.put(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}`, req.body);
      return res.json(data);
    } catch (err) {
      logger.error('update collection proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /api/v1/collections
  router.post('/collections', async (req, res) => {
    try {
      // Ensure userId is forwarded because internal API relies on it when req.user is absent.
      // The internalApiClient call does not include authentication cookies/headers by default,
      // so we extract it from the verified JWT populated by AuthMiddleware on the external route.
      const userId = req.user?.userId || req.user?.id || req.body?.userId;

      // Merge the incoming body with userId (user-supplied userId, if any, wins for flexibility)
      const payload = { ...req.body, userId: req.body?.userId || userId };

      const { data } = await internalApiClient.post('/internal/v1/data/collections', payload);
      return res.status(201).json(data);
    } catch (err) {
      logger.error('create collection proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // DELETE /api/v1/collections/:id
  router.delete('/collections/:id', async (req, res) => {
    try {
      const { data } = await internalApiClient.delete(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}`);
      return res.json(data);
    } catch (err) {
      logger.error('delete collection proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /api/v1/collections/:id/cook/start
  router.post('/collections/:id/cook/start', async (req, res) => {
    try {
      const id = req.params.id;
      // Body may contain explicit toolId/traitTree/paramOverrides/totalSupply; if not, we rely on server-side defaults
      const { toolId, spellId, traitTree, paramOverrides, totalSupply } = req.body || {};
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      const payload = {
        collectionId: id,
        userId,
        toolId,
        spellId,
        traitTree: traitTree || undefined,
        paramOverrides: paramOverrides || undefined,
        totalSupply: Number.isFinite(totalSupply) ? totalSupply : undefined,
      };
      const { data } = await internalApiClient.post('/internal/v1/data/cook/start', payload);
      return res.json(data);
    } catch (err) {
      logger.error('cook start proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /api/v1/collections/:id/cook/resume
  router.post('/collections/:id/cook/resume', async (req, res) => {
    try {
      const id = req.params.id;
      const { toolId, spellId, traitTree, paramOverrides, totalSupply } = req.body || {};
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      const payload = {
        userId,
        toolId,
        spellId,
        traitTree: traitTree || undefined,
        paramOverrides: paramOverrides || undefined,
        totalSupply: Number.isFinite(totalSupply) ? totalSupply : undefined,
      };
      const { data } = await internalApiClient.post(`/internal/v1/data/collections/${encodeURIComponent(id)}/resume`, payload);
      return res.json(data);
    } catch (err) {
      logger.error('cook resume proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /api/v1/collections/:id/cook/pause
  router.post('/collections/:id/cook/pause', async (req, res) => {
    try {
      const id = req.params.id;
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      const reason = req.body?.reason || 'manual';
      const payload = { userId, reason };
      const { data } = await internalApiClient.post(`/internal/v1/data/collections/${encodeURIComponent(id)}/pause`, payload);
      return res.json(data);
    } catch (err) {
      logger.error('cook pause proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /api/v1/collections/:id/cook/stop
  router.post('/collections/:id/cook/stop', async (req, res) => {
    try {
      const id = req.params.id;
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      const reason = req.body?.reason || 'manual';
      const payload = { userId, reason };
      const { data } = await internalApiClient.post(`/internal/v1/data/collections/${encodeURIComponent(id)}/stop`, payload);
      return res.json(data);
    } catch (err) {
      logger.error('cook stop proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  /**
   * GET /api/v1/collections/:id/pieces/unreviewed
   * Returns oldest unreviewed generation outputs for a collection (status=completed & no metadata.reviewOutcome)
   * Query params:
   *   limit (optional) – number of pieces to return, default 1
   */
  router.get('/collections/:id/pieces/unreviewed', async (req, res) => {
    try {
      const collectionId = req.params.id;
      const limit = Math.max(1, Math.min(parseInt(req.query.limit || '1', 10), 50));
      const fetchLimit = Math.min(limit * 2, 100);
      const params = {
        'metadata.collectionId': collectionId,
        status: 'completed',
        deliveryStrategy_ne: 'spell_step',
        'metadata.reviewOutcome_ne': 'accepted',
        limit: fetchLimit,
        sort: 'requestTimestamp:1',
        fields: 'requestTimestamp,outputs,artifactUrls,metadata,responsePayload,status,deliveryStrategy'
      };
      const apiClient = longRunningApiClient || internalApiClient;
      const { data } = await apiClient.get('/internal/v1/data/generations', { params });
      let gens = Array.isArray(data.generations) ? data.generations : [];
      // Apply second _ne in memory and sort oldest first
      gens = gens.filter(g => !['accepted', 'rejected'].includes(g.metadata?.reviewOutcome))
                 .sort((a,b)=> new Date(a.requestTimestamp||a.createdAt||0) - new Date(b.requestTimestamp||b.createdAt||0))
                 .slice(0, limit);
      return res.json({ generations: gens });
    } catch (err) {
      logger.error('unreviewed pieces proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  /**
   * PUT /api/v1/collections/:collectionId/pieces/:id/review
   * Body: { outcome: 'accepted' | 'rejected' }
   */
  router.put('/collections/:collectionId/pieces/:id/review', async (req, res) => {
    try {
      const generationId = req.params.id;
      const { outcome } = req.body || {};
      if (!['accepted', 'rejected'].includes(outcome)) {
        return res.status(400).json({ error: 'invalid_outcome' });
      }
      const payload = { 'metadata.reviewOutcome': outcome };
      const { data } = await internalApiClient.put(`/internal/v1/data/generations/${encodeURIComponent(generationId)}`, payload);
      return res.json(data);
    } catch (err) {
      logger.error('review outcome proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  /**
   * POST /api/v1/collections/:collectionId/pieces/review/bulk
   * Body: { decisions: [{ generationId, outcome }] }
   */
  router.post('/collections/:collectionId/pieces/review/bulk', async (req, res) => {
    try {
      const { decisions } = req.body || {};
      if (!Array.isArray(decisions) || decisions.length === 0) {
        return res.status(400).json({ error: 'missing_decisions' });
      }
      const normalized = [];
      const allowedOutcomes = new Set(['accepted', 'rejected']);
      for (const rawDecision of decisions.slice(0, MAX_BULK_REVIEW_DECISIONS)) {
        if (!rawDecision) continue;
        const generationId = String(rawDecision.generationId || '').trim();
        const outcome = String(rawDecision.outcome || '').toLowerCase();
        if (!generationId || !allowedOutcomes.has(outcome)) continue;
        normalized.push({ generationId, outcome });
      }
      if (!normalized.length) {
        return res.status(400).json({ error: 'no_valid_decisions' });
      }

      const results = [];
      for (const { generationId, outcome } of normalized) {
        try {
          const payload = { 'metadata.reviewOutcome': outcome };
          await internalApiClient.put(`/internal/v1/data/generations/${encodeURIComponent(generationId)}`, payload);
          results.push({ generationId, outcome, status: 'ok' });
        } catch (err) {
          logger.error('bulk review outcome proxy error', {
            generationId,
            error: err.response?.data || err.message
          });
          results.push({
            generationId,
            outcome,
            status: 'error',
            error: err.response?.data?.error || err.response?.data || err.message
          });
        }
      }
      const hasErrors = results.some(r => r.status === 'error');
      const statusCode = hasErrors ? 207 : 200;
      return res.status(statusCode).json({ results });
    } catch (err) {
      logger.error('bulk review outcome proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  router.post('/collections/:id/review/reset', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      const { data } = await internalApiClient.post(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}/review/reset`, { userId });
      return res.json(data);
    } catch (err) {
      logger.error('review reset proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  router.post('/collections/:id/cull/pop', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      const payload = { ...(req.body || {}), userId };
      const { data } = await internalApiClient.post(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}/cull/pop`, payload);
      return res.json(data);
    } catch (err) {
      logger.error('cull pop proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  router.post('/collections/:id/cull/commit', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      const payload = { ...(req.body || {}), userId };
      const { data } = await internalApiClient.post(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}/cull/commit`, payload);
      return res.json(data);
    } catch (err) {
      logger.error('cull commit proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  router.post('/collections/:id/cull/reset', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.body?.userId;
      const { data } = await internalApiClient.post(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}/cull/reset`, { userId });
      return res.json(data);
    } catch (err) {
      logger.error('cull reset proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  router.get('/collections/:id/cull/stats', async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.query.userId;
      const params = { userId };
      const { data } = await internalApiClient.get(`/internal/v1/data/collections/${encodeURIComponent(req.params.id)}/cull/stats`, { params });
      return res.json(data);
    } catch (err) {
      logger.error('cull stats proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });


  // Placeholder routes for pause/resume/delete etc.
  // They will proxy to internal cook routes when implemented.

  return router;
}

module.exports = createCookApiRouter; 
