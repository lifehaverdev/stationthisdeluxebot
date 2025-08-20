const express = require('express');

/**
 * createCookApiRouter
 * External-facing router for Cook Mode (Collections).
 * Delegates to internal /v1/data/cook endpoints via internalApiClient.
 */
function createCookApiRouter(deps = {}) {
  const router = express.Router();
  const internalApiClient = deps.internalApiClient || (deps.internal && deps.internal.client);
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
      const { data } = await internalApiClient.get('/internal/v1/data/cook/collections', { params: { userId } });
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
      const { data } = await internalApiClient.get(`/internal/v1/data/cook/collections/${encodeURIComponent(req.params.id)}`);
      return res.json(data);
    } catch (err) {
      logger.error('get collection proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // PUT /api/v1/collections/:id
  router.put('/collections/:id', async (req, res) => {
    try {
      const { data } = await internalApiClient.put(`/internal/v1/data/cook/collections/${encodeURIComponent(req.params.id)}`, req.body);
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
      const { data } = await internalApiClient.post('/internal/v1/data/cook/collections', req.body);
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
      const { data } = await internalApiClient.delete(`/internal/v1/data/cook/collections/${encodeURIComponent(req.params.id)}`);
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
      const params = {
        'metadata.collectionId': collectionId,
        status: 'completed',
        'metadata.reviewOutcome_ne': 'accepted'
      };
      const { data } = await internalApiClient.get('/internal/v1/data/generations', { params });
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


  // Placeholder routes for pause/resume/delete etc.
  // They will proxy to internal cook routes when implemented.

  return router;
}

module.exports = createCookApiRouter; 