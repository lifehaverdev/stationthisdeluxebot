/**
 * API Service for LoRA Trainings
 */
const express = require('express');
const { ObjectId } = require('../../core/services/db/BaseDB');
const internalApiClient = require('../../utils/internalApiClient');

// Assume trainingDb.js provides functions like:
// const trainingDb = require('../../core/services/db/trainingDb'); // Adjust path as needed
// - getTrainingsByOwner(masterAccountId)
// - getTrainingById(trainingId)
// - createTraining(trainingData) -> trainingData includes masterAccountId, name, etc.
// - updateTraining(trainingId, updateData)
// - deleteTraining(trainingId)

function createTrainingsApi(dependencies) {
  const { logger, db } = dependencies; // db should now be the object containing loraTrainings directly

  // ++ MODIFIED LOGS (adjusted for direct db access) ++
  logger.info(`[TrainingsAPI Init] Received dependencies. Logger type: ${typeof logger}`);
  logger.info(`[TrainingsAPI Init] Received dependencies.db type: ${typeof db}`);

  if (db) {
    logger.info(`[TrainingsAPI Init] dependencies.db keys: ${Object.keys(db).join(', ')}`);
    // No longer expect db.data, directly check for db.loraTrainings
    logger.info(`[TrainingsAPI Init] dependencies.db.loraTrainings type: ${typeof db.loraTrainings}`);
    if (db.loraTrainings && typeof db.loraTrainings.findTrainingsByUser === 'function') {
      logger.info(`[TrainingsAPI Init] db.loraTrainings instance appears valid and has findTrainingsByUser method.`);
    } else {
      logger.warn(`[TrainingsAPI Init] db.loraTrainings IS MISSING or INVALID or lacks expected methods.`);
    }
  } else {
    logger.warn(`[TrainingsAPI Init] dependencies.db IS UNDEFINED.`);
  }
  // -- END MODIFIED LOGS --

  const router = express.Router();

  // GET /internal/v1/data/trainings/owner/:masterAccountId - List trainings by owner
  router.get('/owner/:masterAccountId', async (req, res, next) => {
    const { masterAccountId } = req.params;
    logger.info(`[TrainingsAPI] GET /owner/${masterAccountId} - Fetching trainings for user.`);
    try {
      // Use masterAccountId as userId for the DB query - access db.loraTrainings directly
      const trainings = await db.loraTrainings.findTrainingsByUser(masterAccountId);
      res.json(trainings || []);
      // logger.warn(`[TrainingsAPI] GET /owner/${masterAccountId} - DB interaction not yet implemented. Returning empty array.`);
      // res.json([]); // TODO: Replace with actual DB call
    } catch (error) {
      logger.error(`[TrainingsAPI] Error fetching trainings for owner ${masterAccountId}:`, error);
      next(error);
    }
  });

  // POST /internal/v1/data/trainings - Create a new training
  router.post('/', async (req, res, next) => {
    const {
      masterAccountId,
      name,
      notes,
      allowPublishing,
      tags,
      description,
      costPoints,
      // New training parameters
      datasetId,
      modelType,
      baseModel,
      offeringId,
      steps,
      learningRate,
      batchSize,
      resolution,
      loraRank,
      loraAlpha,
      loraDropout,
      triggerWords,
      // KONTEXT-specific fields
      trainingMode,
      controlDatasetId
    } = req.body;

    logger.info(`[TrainingsAPI] POST / - Creating new training with name "${name}" for MAID ${masterAccountId}`);
    if (!masterAccountId || !name) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId and name are required.' } });
    }

    // Validate required training fields
    if (!datasetId || !modelType || !triggerWords) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'datasetId, modelType, and triggerWords are required for training.' } });
    }

    try {
      // Fetch user via internal API to get their primary wallet address (required for billing)
      let walletAddress = null;
      try {
        const userResponse = await internalApiClient.get(`/internal/v1/data/users/${masterAccountId}`);
        const user = userResponse.data;
        if (user && user.wallets && user.wallets.length > 0) {
          // Find primary wallet, or use first wallet
          const primaryWallet = user.wallets.find(w => w.isPrimary) || user.wallets[0];
          walletAddress = primaryWallet.address;
          logger.info(`[TrainingsAPI] Found wallet ${walletAddress?.slice(0, 10)}... for user ${masterAccountId}`);
        }
      } catch (userErr) {
        logger.error(`[TrainingsAPI] Failed to fetch user ${masterAccountId}: ${userErr.message}`);
        return res.status(500).json({ error: { code: 'USER_FETCH_FAILED', message: 'Failed to fetch user information.' } });
      }

      // Wallet is required for billing - fail early if not found
      if (!walletAddress) {
        logger.error(`[TrainingsAPI] No wallet found for user ${masterAccountId} - cannot proceed with training`);
        return res.status(400).json({ error: { code: 'WALLET_REQUIRED', message: 'A connected wallet is required to start training. Please connect a wallet first.' } });
      }

      // Fetch dataset via internal API to get image count
      let datasetImageCount = 20; // default
      try {
        const datasetResponse = await internalApiClient.get(`/internal/v1/data/datasets/${datasetId}`);
        const dataset = datasetResponse.data?.data || datasetResponse.data;
        if (dataset && dataset.images) {
          datasetImageCount = dataset.images.length;
          logger.info(`[TrainingsAPI] Dataset ${datasetId} has ${datasetImageCount} images`);
        }
      } catch (datasetErr) {
        logger.warn(`[TrainingsAPI] Failed to fetch dataset ${datasetId}: ${datasetErr.message}`);
      }

      // Normalize triggerWords to array and extract first for worker
      const triggerWordsArray = Array.isArray(triggerWords)
        ? triggerWords
        : (triggerWords ? triggerWords.split(',').map(w => w.trim()) : []);
      const triggerWord = triggerWordsArray[0] || '';

      const newTrainingData = {
        userId: masterAccountId, // trainingDb expects userId
        ownerAccountId: masterAccountId, // for worker billing lookup
        name,
        modelName: name, // worker expects modelName
        notes: notes || '',
        description: description || '',  // User-provided description for model card
        allowPublishing: allowPublishing || false,
        tags: tags || [],
        // Wallet for billing (credit ledger)
        walletAddress,
        // Training-specific fields
        datasetId,
        datasetImageCount,
        modelType,
        baseModel: baseModel || modelType,
        offeringId: offeringId || '',
        steps: parseInt(steps) || 1000,
        learningRate: parseFloat(learningRate) || 0.0004,
        batchSize: parseInt(batchSize) || 1,
        resolution: resolution || '1024,1024',
        loraRank: parseInt(loraRank) || 16,
        loraAlpha: parseInt(loraAlpha) || 32,
        loraDropout: parseFloat(loraDropout) || 0.1,
        // Worker expects triggerWord (singular), but keep array for backwards compat
        triggerWord,
        triggerWords: triggerWordsArray,
        // Estimated cost in points (for display and analytics)
        costPoints: parseInt(costPoints) || 0,
        // KONTEXT-specific fields
        trainingMode: trainingMode || null, // 'style_subject' or 'concept' for KONTEXT
        controlDatasetId: controlDatasetId || null, // Required for concept mode
        // status: 'draft', // createTrainingSession in trainingDb.js sets this default
        // ownedBy: masterAccountId, // createTrainingSession in trainingDb.js sets this default
      };

      logger.info(`[TrainingsAPI] Training data prepared:`, {
        name: newTrainingData.name,
        modelName: newTrainingData.modelName,
        modelType: newTrainingData.modelType,
        steps: newTrainingData.steps,
        datasetId: newTrainingData.datasetId,
        datasetImageCount: newTrainingData.datasetImageCount,
        triggerWord: newTrainingData.triggerWord,
        hasWallet: !!newTrainingData.walletAddress
      });

      // Access db.loraTrainings directly
      const createdTraining = await db.loraTrainings.createTrainingSession(newTrainingData);
      if (!createdTraining) {
        logger.error(`[TrainingsAPI] Failed to create training session for MAID ${masterAccountId}. createTrainingSession returned null.`);
        return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create training session.' }});
      }
      res.status(201).json(createdTraining);
    } catch (error) {
      logger.error(`[TrainingsAPI] Error creating training for MAID ${masterAccountId}:`, error);
      next(error);
    }
  });

  // GET /internal/v1/data/trainings/:trainingId - Get a specific training by ID
  router.get('/:trainingId', async (req, res, next) => {
    const { trainingId } = req.params;
    logger.info(`[TrainingsAPI] GET /${trainingId} - Fetching training by ID.`);
    try {
      // Access db.loraTrainings directly
      const training = await db.loraTrainings.findTrainingById(trainingId);
      if (!training) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Training not found.' } });
      }
      res.json(training);
      // logger.warn(`[TrainingsAPI] GET /${trainingId} - DB interaction not yet implemented. Returning mock data.`);
      // if (trainingId === 'mock_train_exists') { // Simulate found
      //    res.json({ _id: trainingId, name: 'Mock Training Details', status: 'draft', notes: 'Details for mock training.', masterAccountId: 'mock_user' });
      // } else {
      //    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Training not found (mock response).' } });
      // } // TODO: Replace with actual DB call
    } catch (error) {
      // Handle ObjectId cast errors if trainingId is not a valid ObjectId format
      if (error.message && error.message.toLowerCase().includes('objectid')) {
        logger.warn(`[TrainingsAPI] Invalid trainingId format: ${trainingId}`);
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid trainingId format.' } });
      }
      logger.error(`[TrainingsAPI] Error fetching training ${trainingId}:`, error);
      next(error);
    }
  });

  // PUT /:trainingId - Update a training
  router.put('/:trainingId', async (req, res, next) => {
    const { trainingId } = req.params;
    const { 
      masterAccountId, 
      name, 
      notes, 
      allowPublishing, 
      tags,
      // Training parameters
      datasetId,
      modelType,
      baseModel,
      offeringId,
      steps,
      learningRate,
      batchSize,
      resolution,
      loraRank,
      loraAlpha,
      loraDropout,
      triggerWords
    } = req.body;
    
    logger.info(`[TrainingsAPI] PUT /${trainingId} - Updating training`);
    
    try {
      // First check if training exists and user owns it
      const existingTraining = await db.loraTrainings.findTrainingById(trainingId);
      if (!existingTraining) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Training not found.' } });
      }
      
      if (existingTraining.userId !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only update your own trainings.' } });
      }
      
      const updateData = {
        ...(name && { name }),
        ...(notes !== undefined && { notes }),
        ...(allowPublishing !== undefined && { allowPublishing }),
        ...(tags && { tags }),
        // Training-specific fields
        ...(datasetId && { datasetId }),
        ...(modelType && { modelType }),
        ...(baseModel && { baseModel }),
        ...(offeringId !== undefined && { offeringId }),
        ...(steps && { steps: parseInt(steps) }),
        ...(learningRate && { learningRate: parseFloat(learningRate) }),
        ...(batchSize && { batchSize: parseInt(batchSize) }),
        ...(resolution && { resolution }),
        ...(loraRank && { loraRank: parseInt(loraRank) }),
        ...(loraAlpha && { loraAlpha: parseInt(loraAlpha) }),
        ...(loraDropout && { loraDropout: parseFloat(loraDropout) }),
        ...(triggerWords && { 
          triggerWords: Array.isArray(triggerWords) ? triggerWords : triggerWords.split(',').map(w => w.trim())
        })
      };
      
      // Update the training
      const updatedTraining = await db.loraTrainings.updateTraining(trainingId, updateData);
      if (!updatedTraining) {
        return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update training.' }});
      }
      
      res.json(updatedTraining);
    } catch (error) {
      logger.error(`[TrainingsAPI] Error updating training ${trainingId}:`, error);
      next(error);
    }
  });

  // DELETE /:trainingId - Delete a training
  router.delete('/:trainingId', async (req, res, next) => {
    const { trainingId } = req.params;
    const { masterAccountId } = req.body;
    
    logger.info(`[TrainingsAPI] DELETE /${trainingId} - Deleting training`);
    
    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required.' } });
    }
    
    try {
      // First check if training exists and user owns it
      const existingTraining = await db.loraTrainings.findTrainingById(trainingId);
      if (!existingTraining) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Training not found.' } });
      }

      // Check ownership - handle both string and ObjectId formats
      const ownerId = String(existingTraining.userId || existingTraining.ownerAccountId || '');
      if (ownerId !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete your own trainings.' } });
      }

      const result = await db.loraTrainings.deleteTraining(trainingId);
      if (!result) {
        return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete training.' }});
      }
      
      res.json({ success: true, message: 'Training deleted successfully.' });
    } catch (error) {
      logger.error(`[TrainingsAPI] Error deleting training ${trainingId}:`, error);
      next(error);
    }
  });

  // POST /:trainingId/retry - Retry a failed training
  router.post('/:trainingId/retry', async (req, res, next) => {
    const { trainingId } = req.params;
    const { masterAccountId } = req.body;

    logger.info(`[TrainingsAPI] POST /${trainingId}/retry - Retrying training`);

    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required.' } });
    }

    try {
      // Check if training exists and user owns it
      const existingTraining = await db.loraTrainings.findTrainingById(trainingId);
      if (!existingTraining) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Training not found.' } });
      }

      // Check ownership
      const ownerId = String(existingTraining.userId || existingTraining.ownerAccountId || '');
      if (ownerId !== masterAccountId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only retry your own trainings.' } });
      }

      // Only allow retrying failed trainings
      if (existingTraining.status !== 'FAILED') {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Only failed trainings can be retried.' } });
      }

      // Reset status to QUEUED and clear error fields
      await db.loraTrainings.setStatus(trainingId, 'QUEUED', {
        error: null,
        errorMessage: null,
        retryCount: (existingTraining.retryCount || 0) + 1,
        progress: 0,
        currentStep: 0
      });

      const updatedTraining = await db.loraTrainings.findTrainingById(trainingId);
      res.json({ success: true, training: updatedTraining });
    } catch (error) {
      logger.error(`[TrainingsAPI] Error retrying training ${trainingId}:`, error);
      next(error);
    }
  });

  // POST /calculate-cost - Calculate training cost
  router.post('/calculate-cost', async (req, res, next) => {
    const { modelType, steps, learningRate, batchSize, resolution, loraRank, loraAlpha, datasetSize } = req.body;
    
    logger.info(`[TrainingsAPI] POST /calculate-cost - Calculating cost for ${modelType} training`);
    
    try {
      const cost = await calculateTrainingCost({
        modelType,
        steps: steps || getDefaultSteps(modelType),
        learningRate: learningRate || getDefaultLearningRate(modelType),
        batchSize: batchSize || 1,
        resolution: resolution || '1024,1024',
        loraRank: loraRank || getDefaultLoraRank(modelType),
        loraAlpha: loraAlpha || getDefaultLoraAlpha(modelType),
        datasetSize: datasetSize || 100
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

  // POST /batch-delete - Batch delete trainings
  router.post('/batch-delete', async (req, res, next) => {
    const { ids, masterAccountId } = req.body;
    
    logger.info(`[TrainingsAPI] POST /batch-delete - Deleting ${ids?.length || 0} trainings`);
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'IDs array is required' } });
    }
    
    if (!masterAccountId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId is required' } });
    }
    
    try {
      const result = await db.loraTrainings.deleteMany({
        _id: { $in: ids.map(id => new ObjectId(id)) },
        userId: masterAccountId
      });
      
      res.json({
        success: true,
        data: {
          deletedCount: result.deletedCount,
          message: `Deleted ${result.deletedCount} training(s)`
        }
      });
    } catch (error) {
      logger.error('Failed to batch delete trainings:', error);
      res.status(500).json({ error: { code: 'DELETE_ERROR', message: 'Failed to delete trainings' } });
    }
  });

  // GET /analytics/:masterAccountId - Get training analytics
  router.get('/analytics/:masterAccountId', async (req, res, next) => {
    const { masterAccountId } = req.params;
    const { startDate, endDate } = req.query;
    
    logger.info(`[TrainingsAPI] GET /analytics/${masterAccountId} - Fetching training analytics`);
    
    try {
      const analytics = await getTrainingAnalytics(masterAccountId, startDate, endDate, db);
      res.json({ success: true, data: analytics });
    } catch (error) {
      logger.error('Failed to get training analytics:', error);
      res.status(500).json({ error: { code: 'ANALYTICS_ERROR', message: 'Failed to get analytics' } });
    }
  });

  // PUT /:trainingId/status - Update training status
  router.put('/:trainingId/status', async (req, res, next) => {
    const { trainingId } = req.params;
    const { status, progress, error } = req.body;
    
    logger.info(`[TrainingsAPI] PUT /${trainingId}/status - Updating status to ${status}`);
    
    try {
      const updateData = { status, updatedAt: new Date() };
      if (progress !== undefined) updateData.progress = progress;
      if (error) updateData.failureReason = error;
      if (status === 'COMPLETED') updateData.completedAt = new Date();
      
      const result = await db.loraTrainings.updateTraining(trainingId, updateData);
      if (!result) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Training not found' } });
      }
      
      // Emit WebSocket update if available
      if (req.app && req.app.get('io')) {
        req.app.get('io').emit('trainingUpdate', {
          trainingId,
          status,
          progress,
          error
        });
      }
      
      res.json({ success: true, data: { trainingId, status, progress } });
    } catch (error) {
      logger.error('Failed to update training status:', error);
      res.status(500).json({ error: { code: 'UPDATE_ERROR', message: 'Failed to update status' } });
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

async function getTrainingAnalytics(masterAccountId, startDate, endDate, db) {
  const query = { userId: masterAccountId };
  
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }
  
  const trainings = await db.loraTrainings.find(query).toArray();
  
  const analytics = {
    totalTrainings: trainings.length,
    completedTrainings: trainings.filter(t => t.status === 'COMPLETED').length,
    failedTrainings: trainings.filter(t => t.status === 'FAILED').length,
    queuedTrainings: trainings.filter(t => t.status === 'QUEUED').length,
    runningTrainings: trainings.filter(t => t.status === 'RUNNING').length,
    totalCost: trainings.reduce((sum, t) => sum + (t.costPoints || 0), 0),
    averageCost: 0,
    successRate: 0,
    averageDuration: 0,
    costOverTime: [],
    statusDistribution: {},
    modelTypeDistribution: {}
  };
  
  // Calculate averages
  if (trainings.length > 0) {
    analytics.averageCost = analytics.totalCost / trainings.length;
    analytics.successRate = (analytics.completedTrainings / trainings.length) * 100;
    
    const completedTrainings = trainings.filter(t => t.status === 'COMPLETED' && t.startedAt && t.completedAt);
    if (completedTrainings.length > 0) {
      const totalDuration = completedTrainings.reduce((sum, t) => {
        return sum + (new Date(t.completedAt) - new Date(t.startedAt));
      }, 0);
      analytics.averageDuration = totalDuration / completedTrainings.length / 1000 / 60; // minutes
    }
  }
  
  // Calculate distributions
  trainings.forEach(training => {
    // Status distribution
    analytics.statusDistribution[training.status] = (analytics.statusDistribution[training.status] || 0) + 1;
    
    // Model type distribution
    analytics.modelTypeDistribution[training.modelType] = (analytics.modelTypeDistribution[training.modelType] || 0) + 1;
  });
  
  // Calculate cost over time (daily)
  const costByDate = {};
  trainings.forEach(training => {
    if (training.costPoints) {
      const date = new Date(training.createdAt).toISOString().split('T')[0];
      costByDate[date] = (costByDate[date] || 0) + training.costPoints;
    }
  });
  
  analytics.costOverTime = Object.entries(costByDate).map(([date, cost]) => ({
    date,
    cost
  })).sort((a, b) => new Date(a.date) - new Date(b.date));
  
  return analytics;
}

module.exports = createTrainingsApi; 