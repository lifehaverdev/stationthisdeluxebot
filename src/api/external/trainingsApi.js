const express = require('express');
const TrainingCostEstimator = require('../../core/services/training/TrainingCostEstimator');

/**
 * External Trainings API Router
 * Uses TrainingService directly (Phase 6f — no internalApiClient proxy).
 */
module.exports = function createTrainingsApiRouter(deps = {}) {
  const router = express.Router();
  const trainingService = deps.trainingService;
  const logger = (deps.logger || console).child
    ? (deps.logger || console).child({ mod: 'ExternalTrainingsApi' })
    : (deps.logger || console);
  const costEstimator = new TrainingCostEstimator({ logger });

  if (!trainingService) {
    logger.error('[ExternalTrainingsApi] trainingService missing – router disabled');
    return null;
  }

  // POST /calculate-cost -> estimate training cost (local, no service needed)
  router.post('/calculate-cost', async (req, res) => {
    try {
      const { modelType, steps, imageCount, gpuClass } = req.body;

      const baseModelMap = {
        'FLUX': 'FLUX',
        'SDXL': 'SDXL',
        'SD1.5': 'SD1.5',
        'WAN': 'FLUX',
        'KONTEXT': 'FLUX',
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
      const trainings = await trainingService.listByOwner(ownerId);
      res.json({ trainings });
    } catch (err) {
      const status = err.status || 500;
      logger.error('[ExternalTrainingsApi] list trainings error:', err.message);
      res.status(status).json({ error: { code: 'ERROR', message: err.message } });
    }
  });

  // GET /:id -> get training detail
  router.get('/:id', async (req, res) => {
    try {
      const training = await trainingService.getById(req.params.id);
      if (!training) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Training not found.' } });
      }
      res.json(training);
    } catch (err) {
      const status = err.status || 500;
      logger.error('[ExternalTrainingsApi] get training error:', err.message);
      res.status(status).json({ error: { code: 'ERROR', message: err.message } });
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
      const created = await trainingService.create({ ...req.body, masterAccountId: ownerId });
      res.status(201).json(created);
    } catch (err) {
      const status = err.status || 500;
      logger.error('[ExternalTrainingsApi] create training error:', err.message);
      res.status(status).json({ error: { code: err.code || 'ERROR', message: err.message } });
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
      const result = await trainingService.delete(req.params.id, ownerId);
      res.json(result);
    } catch (err) {
      const status = err.status || 500;
      logger.error('[ExternalTrainingsApi] delete training error:', err.message);
      res.status(status).json({ error: { code: err.code || 'ERROR', message: err.message } });
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
      const result = await trainingService.retry(req.params.id, ownerId);
      res.json(result);
    } catch (err) {
      const status = err.status || 500;
      logger.error('[ExternalTrainingsApi] retry training error:', err.message);
      res.status(status).json({ error: { code: err.code || 'ERROR', message: err.message } });
    }
  });

  // POST /:id/cancel -> cancel a non-terminal training
  router.post('/:id/cancel', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    const ownerId = user.masterAccountId || user.userId;
    try {
      const result = await trainingService.cancel(req.params.id, ownerId);
      res.json(result);
    } catch (err) {
      const status = err.status || 500;
      logger.error('[ExternalTrainingsApi] cancel training error:', err.message);
      res.status(status).json({ error: { code: err.code || 'ERROR', message: err.message } });
    }
  });

  return router;
};
