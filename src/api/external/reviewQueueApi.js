const express = require('express');

function createReviewQueueApiRouter(deps = {}) {
  const router = express.Router();
  const internalApiClient = deps.internalApiClient || (deps.internal && deps.internal.client);
  const logger = (deps.logger || console).child ? (deps.logger || console).child({ mod: 'ExternalReviewQueueApi' }) : (deps.logger || console);

  if (!internalApiClient) {
    logger.error('[ExternalReviewQueueApi] internalApiClient missing – router disabled');
    return null;
  }

  const dualAuth = deps.authenticateUserOrApiKey;
  if (!dualAuth) {
    logger.warn('[ExternalReviewQueueApi] dualAuth middleware missing – routes may be unprotected');
  }

  const withAuth = (handler) => (req, res, next) => {
    if (dualAuth) {
      return dualAuth(req, res, () => handler(req, res, next));
    }
    return handler(req, res, next);
  };

  router.post('/review-queue/pop', withAuth(async (req, res) => {
    try {
      const reviewerId = req.user?.userId || req.user?.id;
      const payload = {
        collectionId: req.body?.collectionId || req.query?.collectionId,
        limit: req.body?.limit || req.query?.limit,
        lockWindowMs: req.body?.lockWindowMs,
        reviewerId
      };
      if (!payload.collectionId) {
        return res.status(400).json({ error: 'collectionId_required' });
      }
      const { data } = await internalApiClient.post('/internal/v1/data/review-queue/pop', payload);
      return res.json(data);
    } catch (err) {
      logger.error('[ExternalReviewQueueApi] pop proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy_error' });
    }
  }));

  router.post('/review-queue/commit', withAuth(async (req, res) => {
    try {
      const reviewerId = req.user?.userId || req.user?.id;
      const payload = { decisions: req.body?.decisions || [], reviewerId };
      if (!Array.isArray(payload.decisions) || !payload.decisions.length) {
        return res.status(400).json({ error: 'missing_decisions' });
      }
      const { data } = await internalApiClient.post('/internal/v1/data/review-queue/commit', payload);
      return res.json(data);
    } catch (err) {
      logger.error('[ExternalReviewQueueApi] commit proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy_error' });
    }
  }));

  router.post('/review-queue/release', withAuth(async (req, res) => {
    try {
      const reviewerId = req.user?.userId || req.user?.id;
      const payload = { queueIds: req.body?.queueIds || [], reviewerId };
      if (!Array.isArray(payload.queueIds) || !payload.queueIds.length) {
        return res.status(400).json({ error: 'missing_queue_ids' });
      }
      const { data } = await internalApiClient.post('/internal/v1/data/review-queue/release', payload);
      return res.json(data);
    } catch (err) {
      logger.error('[ExternalReviewQueueApi] release proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy_error' });
    }
  }));

  router.get('/review-queue/stats', withAuth(async (req, res) => {
    try {
      const params = {};
      if (req.query?.collectionId) params.collectionId = req.query.collectionId;
      const { data } = await internalApiClient.get('/internal/v1/data/review-queue/stats', { params });
      return res.json(data);
    } catch (err) {
      logger.error('[ExternalReviewQueueApi] stats proxy error', err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: 'proxy_error' });
    }
  }));

  return router;
}

module.exports = createReviewQueueApiRouter;
