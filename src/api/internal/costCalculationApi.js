/**
 * API Service for Cost Calculation
 */
const express = require('express');

function createCostCalculationApi(dependencies) {
  const { logger } = dependencies;
  const router = express.Router();

  // Cost calculation constants
  const GPU_COSTS = {
    'RTX4090': 0.15, // per second
    'RTX4080': 0.12,
    'RTX3090': 0.10,
    'RTX3080': 0.08,
    'A100': 0.25,
    'V100': 0.20
  };

  const STORAGE_COSTS = {
    'dataset': 0.01, // per GB per hour
    'model': 0.005,  // per GB per hour
    'checkpoint': 0.002 // per GB per hour
  };

  const PROCESSING_COSTS = {
    'SDXL': 0.001, // per step
    'FLUX': 0.0015,
    'WAN': 0.0008
  };

  // POST /internal/v1/data/cost/calculate-training - Calculate training cost
  router.post('/calculate-training', async (req, res, next) => {
    const { modelType, steps, learningRate, batchSize, resolution, loraRank, loraAlpha, datasetSize } = req.body;
    
    logger.info(`[CostCalculationAPI] POST /calculate-training - Calculating cost for ${modelType} training`);
    
    try {
      const cost = await calculateTrainingCost({
        modelType,
        steps: steps || getDefaultSteps(modelType),
        learningRate: learningRate || getDefaultLearningRate(modelType),
        batchSize: batchSize || 1,
        resolution: resolution || '1024,1024',
        loraRank: loraRank || getDefaultLoraRank(modelType),
        loraAlpha: loraAlpha || getDefaultLoraAlpha(modelType),
        datasetSize: datasetSize || 100 // default dataset size in images
      });
      
      res.json({
        success: true,
        data: {
          totalCost: cost.total,
          breakdown: {
            gpuTime: cost.gpuTime,
            storage: cost.storage,
            processing: cost.processing
          },
          estimatedDuration: cost.estimatedDuration,
          costPerStep: cost.costPerStep
        }
      });
    } catch (error) {
      logger.error('Failed to calculate training cost:', error);
      res.status(500).json({ error: { code: 'CALCULATION_ERROR', message: 'Failed to calculate cost' } });
    }
  });

  // POST /internal/v1/data/cost/calculate-dataset - Calculate dataset storage cost
  router.post('/calculate-dataset', async (req, res, next) => {
    const { imageCount, imageSize, duration } = req.body;
    
    logger.info(`[CostCalculationAPI] POST /calculate-dataset - Calculating storage cost for ${imageCount} images`);
    
    try {
      const totalSize = imageCount * (imageSize || 2); // 2MB per image default
      const storageCost = totalSize * STORAGE_COSTS.dataset * (duration || 24); // 24 hours default
      
      res.json({
        success: true,
        data: {
          totalCost: storageCost,
          breakdown: {
            storage: storageCost,
            size: totalSize
          }
        }
      });
    } catch (error) {
      logger.error('Failed to calculate dataset cost:', error);
      res.status(500).json({ error: { code: 'CALCULATION_ERROR', message: 'Failed to calculate cost' } });
    }
  });

  // POST /internal/v1/data/cost/calculate-batch - Calculate cost for multiple trainings
  router.post('/calculate-batch', async (req, res, next) => {
    const { trainings } = req.body;
    
    logger.info(`[CostCalculationAPI] POST /calculate-batch - Calculating cost for ${trainings?.length || 0} trainings`);
    
    if (!trainings || !Array.isArray(trainings) || trainings.length === 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'trainings array is required' } });
    }
    
    try {
      const results = await Promise.all(
        trainings.map(async (training, index) => {
          try {
            const cost = await calculateTrainingCost(training);
            return {
              index,
              trainingId: training.trainingId || `training_${index}`,
              cost: cost.total,
              breakdown: cost.breakdown,
              estimatedDuration: cost.estimatedDuration
            };
          } catch (error) {
            logger.error(`Failed to calculate cost for training ${index}:`, error);
            return {
              index,
              trainingId: training.trainingId || `training_${index}`,
              error: 'Failed to calculate cost'
            };
          }
        })
      );
      
      const totalCost = results
        .filter(r => r.cost !== undefined)
        .reduce((sum, r) => sum + r.cost, 0);
      
      res.json({
        success: true,
        data: {
          results,
          totalCost,
          summary: {
            totalTrainings: trainings.length,
            successfulCalculations: results.filter(r => r.cost !== undefined).length,
            failedCalculations: results.filter(r => r.error).length
          }
        }
      });
    } catch (error) {
      logger.error('Failed to calculate batch costs:', error);
      res.status(500).json({ error: { code: 'CALCULATION_ERROR', message: 'Failed to calculate batch costs' } });
    }
  });

  // GET /internal/v1/data/cost/rates - Get current cost rates
  router.get('/rates', async (req, res, next) => {
    logger.info(`[CostCalculationAPI] GET /rates - Fetching current cost rates`);
    
    try {
      res.json({
        success: true,
        data: {
          gpuCosts: GPU_COSTS,
          storageCosts: STORAGE_COSTS,
          processingCosts: PROCESSING_COSTS,
          lastUpdated: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Failed to fetch cost rates:', error);
      res.status(500).json({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch cost rates' } });
    }
  });

  return router;
}

// Helper functions for cost calculation
async function calculateTrainingCost(params) {
  const { modelType, steps, batchSize, datasetSize } = params;
  
  // Cost calculation constants
  const GPU_COSTS = {
    'RTX4090': 0.15, // per second
    'RTX4080': 0.12,
    'RTX3090': 0.10,
    'RTX3080': 0.08,
    'A100': 0.25,
    'V100': 0.20
  };

  const STORAGE_COSTS = {
    'dataset': 0.01, // per GB per hour
    'model': 0.005,  // per GB per hour
    'checkpoint': 0.002 // per GB per hour
  };

  const PROCESSING_COSTS = {
    'SDXL': 0.001, // per step
    'FLUX': 0.0015,
    'WAN': 0.0008
  };
  
  // Estimate training duration based on model type and parameters
  const durationHours = estimateTrainingDuration(modelType, steps, batchSize, datasetSize);
  const durationSeconds = durationHours * 3600;
  
  // Calculate GPU cost (using RTX4090 as default)
  const gpuCost = durationSeconds * GPU_COSTS.RTX4090;
  
  // Calculate storage cost
  const datasetSizeGB = (datasetSize * 2) / 1024; // 2MB per image
  const modelSizeGB = 0.5; // estimated model size
  const storageCost = (datasetSizeGB + modelSizeGB) * STORAGE_COSTS.dataset * durationHours;
  
  // Calculate processing cost
  const processingCost = steps * (PROCESSING_COSTS[modelType] || 0.001);
  
  const total = gpuCost + storageCost + processingCost;
  
  return {
    total: Math.round(total * 100) / 100,
    gpuTime: Math.round(gpuCost * 100) / 100,
    storage: Math.round(storageCost * 100) / 100,
    processing: Math.round(processingCost * 100) / 100,
    estimatedDuration: durationHours,
    costPerStep: Math.round((total / steps) * 100) / 100
  };
}

function estimateTrainingDuration(modelType, steps, batchSize, datasetSize) {
  const baseRates = {
    'SDXL': 0.5, // steps per second
    'FLUX': 0.3,
    'WAN': 0.4
  };
  
  const rate = baseRates[modelType] || 0.5;
  const stepsPerSecond = rate * batchSize;
  const durationSeconds = steps / stepsPerSecond;
  
  return durationSeconds / 3600; // convert to hours
}

function getDefaultSteps(modelType) {
  const defaults = { 'SDXL': 1000, 'FLUX': 1500, 'WAN': 1200 };
  return defaults[modelType] || 1000;
}

function getDefaultLearningRate(modelType) {
  const defaults = { 'SDXL': 0.0004, 'FLUX': 0.0003, 'WAN': 0.0005 };
  return defaults[modelType] || 0.0004;
}

function getDefaultLoraRank(modelType) {
  const defaults = { 'SDXL': 16, 'FLUX': 24, 'WAN': 20 };
  return defaults[modelType] || 16;
}

function getDefaultLoraAlpha(modelType) {
  const defaults = { 'SDXL': 32, 'FLUX': 48, 'WAN': 40 };
  return defaults[modelType] || 32;
}

module.exports = createCostCalculationApi;
