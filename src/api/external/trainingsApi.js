const express = require('express');
const TrainingCostEstimator = require('../../core/services/training/TrainingCostEstimator');

/**
 * External Trainings API Router
 * Proxies requests to the internal trainings API layer.
 * Requires an `internalApiClient` injected in dependencies.
 */
module.exports = function createTrainingsApiRouter(deps = {}) {
  const router = express.Router();
  const client = deps.internalApiClient || (deps.internal && deps.internal.client);
  const logger = (deps.logger || console).child ? (deps.logger || console).child({ mod: 'ExternalTrainingsApi' }) : (deps.logger || console);
  const costEstimator = new TrainingCostEstimator({ logger });

  if (!client) {
    logger.error('[ExternalTrainingsApi] internalApiClient missing – router disabled');
    return null;
  }

  // POST /calculate-cost -> estimate training cost
  router.post('/calculate-cost', async (req, res) => {
    try {
      const { modelType, steps, imageCount, gpuClass } = req.body;

      // Map frontend modelType to baseModel names used by estimator
      const baseModelMap = {
        'FLUX': 'FLUX',
        'SDXL': 'SDXL',
        'SD1.5': 'SD1.5',
        'WAN': 'FLUX', // WAN uses similar resources to FLUX
        'KONTEXT': 'FLUX', // KONTEXT uses similar resources to FLUX
      };

      const baseModel = baseModelMap[modelType] || 'FLUX';
      const numSteps = parseInt(steps) || 1000;
      const numImages = parseInt(imageCount) || 20;

      const estimate = await costEstimator.estimate({
        baseModel,
        steps: numSteps,
        imageCount: numImages,
        gpuClass: gpuClass || '24GB',
      });

      logger.debug(`[ExternalTrainingsApi] Cost estimate: ${baseModel}, ${numSteps} steps, ${numImages} images -> ${estimate.estimatedPoints} points`);

      res.json({
        totalCost: estimate.estimatedPoints,
        breakdown: {
          estimatedHours: estimate.estimatedHours,
          gpuRate: estimate.gpuRate,
          gpuCostUsd: estimate.gpuCostUsd,
          platformFeeUsd: estimate.platformFeeUsd,
          totalCostUsd: estimate.totalCostUsd,
          bufferedCostUsd: estimate.bufferedCostUsd,
          source: estimate.source,
        },
      });
    } catch (err) {
      logger.error('[ExternalTrainingsApi] calculate-cost error:', err.message);
      res.status(500).json({ error: { code: 'COST_CALC_ERROR', message: err.message } });
    }
  });

  // GET / -> list trainings for current user
  router.get('/', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    try {
      const { data } = await client.get(`/internal/v1/data/trainings/owner/${encodeURIComponent(ownerId)}`);
      res.json({ trainings: data });
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('list trainings proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // GET /:id -> get training detail
  router.get('/:id', async (req, res) => {
    try {
      const { data } = await client.get(`/internal/v1/data/trainings/${encodeURIComponent(req.params.id)}`);
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('get training proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST / -> create training
  router.post('/', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    try {
      const payload = { ...req.body, masterAccountId: ownerId };
      const { data } = await client.post('/internal/v1/data/trainings', payload);
      res.status(201).json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('create training proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // DELETE /:id -> delete training
  router.delete('/:id', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    try {
      const { data } = await client.delete(`/internal/v1/data/trainings/${encodeURIComponent(req.params.id)}`, {
        data: { masterAccountId: ownerId }
      });
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('delete training proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  // POST /:id/retry -> retry a failed training
  router.post('/:id/retry', async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    }
    const ownerId = user.masterAccountId || user.userId;
    try {
      const { data } = await client.post(`/internal/v1/data/trainings/${encodeURIComponent(req.params.id)}/retry`, {
        masterAccountId: ownerId
      });
      res.json(data);
    } catch (err) {
      const status = err.response?.status || 500;
      logger.error('retry training proxy error', err.response?.data || err.message);
      res.status(status).json(err.response?.data || { error: 'proxy-error' });
    }
  });

  return router;
};
