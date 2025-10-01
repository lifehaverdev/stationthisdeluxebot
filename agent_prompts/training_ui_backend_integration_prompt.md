# Training UI Backend Integration - Agent Prompt

## Objective
Create and update backend API endpoints to support the enhanced training UI features, ensuring proper integration between frontend and backend systems.

## Context
The training UI audit revealed that the frontend needs several new API endpoints and updates to existing ones to support the enhanced training system. This prompt covers the backend work needed to support all three phases of UI improvements.

## Files to Modify/Create
- `src/api/internal/trainingsApi.js` (update existing)
- `src/api/internal/datasetsApi.js` (create new)
- `src/api/internal/marketplaceApi.js` (create new)
- `src/api/internal/analyticsApi.js` (create new)
- `src/api/internal/costCalculationApi.js` (create new)

## Tasks

### 1. Update Trainings API (HIGH PRIORITY)
**Current State**: Basic CRUD operations for trainings
**Required**: Enhanced endpoints with all training parameters, cost calculation, and status management

**Implementation**:
- Add cost calculation endpoint
- Add batch operations endpoints
- Add training parameter validation
- Add real-time status updates via WebSocket
- Add training analytics endpoints

**Code Location**: `src/api/internal/trainingsApi.js`
```javascript
// Add new endpoints to existing trainingsApi.js

// POST /internal/v1/data/trainings/calculate-cost - Calculate training cost
router.post('/calculate-cost', async (req, res, next) => {
  const { modelType, steps, learningRate, batchSize, resolution, loraRank, loraAlpha } = req.body;
  
  try {
    // Calculate cost based on parameters
    const cost = await calculateTrainingCost({
      modelType,
      steps: steps || getDefaultSteps(modelType),
      learningRate: learningRate || getDefaultLearningRate(modelType),
      batchSize: batchSize || 1,
      resolution: resolution || '1024,1024',
      loraRank: loraRank || getDefaultLoraRank(modelType),
      loraAlpha: loraAlpha || getDefaultLoraAlpha(modelType)
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
        estimatedDuration: cost.estimatedDuration
      }
    });
  } catch (error) {
    logger.error('Failed to calculate training cost:', error);
    res.status(500).json({ error: { code: 'CALCULATION_ERROR', message: 'Failed to calculate cost' } });
  }
});

// POST /internal/v1/data/trainings/batch-delete - Batch delete trainings
router.post('/batch-delete', async (req, res, next) => {
  const { ids, masterAccountId } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'IDs array is required' } });
  }
  
  try {
    const result = await db.loraTrainings.deleteMany({
      _id: { $in: ids.map(id => new ObjectId(id)) },
      ownerAccountId: new ObjectId(masterAccountId)
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

// GET /internal/v1/data/trainings/analytics/:masterAccountId - Get training analytics
router.get('/analytics/:masterAccountId', async (req, res, next) => {
  const { masterAccountId } = req.params;
  const { startDate, endDate } = req.query;
  
  try {
    const analytics = await getTrainingAnalytics(masterAccountId, startDate, endDate);
    res.json({ success: true, data: analytics });
  } catch (error) {
    logger.error('Failed to get training analytics:', error);
    res.status(500).json({ error: { code: 'ANALYTICS_ERROR', message: 'Failed to get analytics' } });
  }
});

// PUT /internal/v1/data/trainings/:trainingId/status - Update training status
router.put('/:trainingId/status', async (req, res, next) => {
  const { trainingId } = req.params;
  const { status, progress, error } = req.body;
  
  try {
    const updateData = { status, updatedAt: new Date() };
    if (progress !== undefined) updateData.progress = progress;
    if (error) updateData.failureReason = error;
    if (status === 'COMPLETED') updateData.completedAt = new Date();
    
    await db.loraTrainings.updateOne(
      { _id: new ObjectId(trainingId) },
      { $set: updateData }
    );
    
    // Emit WebSocket update
    if (req.app.get('io')) {
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
```

### 2. Create Datasets API (HIGH PRIORITY)
**Current State**: No dedicated datasets API
**Required**: Complete CRUD operations for datasets with image management and caption generation

**Implementation**:
- Create new datasets API with full CRUD operations
- Add image upload and management endpoints
- Add caption generation endpoints
- Add batch operations for datasets
- Add dataset analytics and statistics

**Code Location**: `src/api/internal/datasetsApi.js` (create new)
```javascript
/**
 * API Service for Datasets
 */
const express = require('express');
const { ObjectId } = require('../../core/db/BaseDB');

function createDatasetsApi(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router();

  // GET /internal/v1/data/datasets/owner/:masterAccountId - List datasets by owner
  router.get('/owner/:masterAccountId', async (req, res, next) => {
    const { masterAccountId } = req.params;
    const { page = 1, limit = 20, search, filter } = req.query;
    
    try {
      const query = { ownerAccountId: new ObjectId(masterAccountId) };
      
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { tags: { $in: [new RegExp(search, 'i')] } }
        ];
      }
      
      if (filter) {
        query.visibility = filter;
      }
      
      const datasets = await db.data.datasets.find(query)
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .sort({ updatedAt: -1 });
      
      const total = await db.data.datasets.countDocuments(query);
      
      res.json({
        success: true,
        data: {
          datasets,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      logger.error('Failed to fetch datasets:', error);
      res.status(500).json({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch datasets' } });
    }
  });

  // POST /internal/v1/data/datasets - Create a new dataset
  router.post('/', async (req, res, next) => {
    const { masterAccountId, name, description, tags, visibility = 'private' } = req.body;
    
    if (!masterAccountId || !name) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId and name are required' } });
    }
    
    try {
      const datasetData = {
        name,
        description: description || '',
        ownerAccountId: new ObjectId(masterAccountId),
        tags: tags || [],
        visibility,
        images: [],
        captionSets: [],
        usageCount: 0,
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      const result = await db.data.datasets.insertOne(datasetData);
      const dataset = { _id: result.insertedId, ...datasetData };
      
      res.status(201).json({ success: true, data: dataset });
    } catch (error) {
      logger.error('Failed to create dataset:', error);
      res.status(500).json({ error: { code: 'CREATE_ERROR', message: 'Failed to create dataset' } });
    }
  });

  // PUT /internal/v1/data/datasets/:datasetId - Update dataset
  router.put('/:datasetId', async (req, res, next) => {
    const { datasetId } = req.params;
    const updateData = { ...req.body, updatedAt: new Date() };
    
    try {
      const result = await db.data.datasets.updateOne(
        { _id: new ObjectId(datasetId) },
        { $set: updateData }
      );
      
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      res.json({ success: true, data: { datasetId, updated: true } });
    } catch (error) {
      logger.error('Failed to update dataset:', error);
      res.status(500).json({ error: { code: 'UPDATE_ERROR', message: 'Failed to update dataset' } });
    }
  });

  // POST /internal/v1/data/datasets/:datasetId/images - Add images to dataset
  router.post('/:datasetId/images', async (req, res, next) => {
    const { datasetId } = req.params;
    const { imageUrls } = req.body;
    
    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'imageUrls array is required' } });
    }
    
    try {
      const result = await db.data.datasets.updateOne(
        { _id: new ObjectId(datasetId) },
        { 
          $push: { images: { $each: imageUrls } },
          $set: { updatedAt: new Date() }
        }
      );
      
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      res.json({ success: true, data: { addedCount: imageUrls.length } });
    } catch (error) {
      logger.error('Failed to add images to dataset:', error);
      res.status(500).json({ error: { code: 'ADD_IMAGES_ERROR', message: 'Failed to add images' } });
    }
  });

  // POST /internal/v1/data/datasets/:datasetId/generate-captions - Generate captions for dataset
  router.post('/:datasetId/generate-captions', async (req, res, next) => {
    const { datasetId } = req.params;
    const { method = 'blip' } = req.body;
    
    try {
      const dataset = await db.data.datasets.findOne({ _id: new ObjectId(datasetId) });
      if (!dataset) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dataset not found' } });
      }
      
      // Generate captions using specified method
      const captions = await generateCaptions(dataset.images, method);
      
      // Add caption set to dataset
      const captionSet = {
        _id: new ObjectId(),
        method,
        captions,
        createdBy: dataset.ownerAccountId,
        createdAt: new Date()
      };
      
      await db.data.datasets.updateOne(
        { _id: new ObjectId(datasetId) },
        { 
          $push: { captionSets: captionSet },
          $set: { updatedAt: new Date() }
        }
      );
      
      res.json({ success: true, data: { captionSet, generatedCount: captions.length } });
    } catch (error) {
      logger.error('Failed to generate captions:', error);
      res.status(500).json({ error: { code: 'CAPTION_ERROR', message: 'Failed to generate captions' } });
    }
  });

  // POST /internal/v1/data/datasets/batch-delete - Batch delete datasets
  router.post('/batch-delete', async (req, res, next) => {
    const { ids, masterAccountId } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'IDs array is required' } });
    }
    
    try {
      const result = await db.data.datasets.deleteMany({
        _id: { $in: ids.map(id => new ObjectId(id)) },
        ownerAccountId: new ObjectId(masterAccountId)
      });
      
      res.json({
        success: true,
        data: {
          deletedCount: result.deletedCount,
          message: `Deleted ${result.deletedCount} dataset(s)`
        }
      });
    } catch (error) {
      logger.error('Failed to batch delete datasets:', error);
      res.status(500).json({ error: { code: 'DELETE_ERROR', message: 'Failed to delete datasets' } });
    }
  });

  return router;
}

module.exports = createDatasetsApi;
```

### 3. Create Cost Calculation API (HIGH PRIORITY)
**Current State**: No cost calculation service
**Required**: Real-time cost calculation for training parameters

**Implementation**:
- Create cost calculation service
- Add cost estimation endpoints
- Add cost breakdown by component
- Add cost validation and limits

**Code Location**: `src/api/internal/costCalculationApi.js` (create new)
```javascript
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

  return router;
}

async function calculateTrainingCost(params) {
  const { modelType, steps, batchSize, datasetSize } = params;
  
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
  const processingCost = steps * PROCESSING_COSTS[modelType] || 0;
  
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
```

### 4. Create Analytics API (MEDIUM PRIORITY)
**Current State**: No analytics endpoints
**Required**: Training and dataset analytics for dashboard

**Implementation**:
- Create analytics service for training metrics
- Add cost tracking and reporting
- Add usage statistics and trends
- Add performance metrics

**Code Location**: `src/api/internal/analyticsApi.js` (create new)
```javascript
/**
 * API Service for Analytics
 */
const express = require('express');
const { ObjectId } = require('../../core/db/BaseDB');

function createAnalyticsApi(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router();

  // GET /internal/v1/data/analytics/training/:masterAccountId - Get training analytics
  router.get('/training/:masterAccountId', async (req, res, next) => {
    const { masterAccountId } = req.params;
    const { startDate, endDate } = req.query;
    
    try {
      const query = { ownerAccountId: new ObjectId(masterAccountId) };
      
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }
      
      const trainings = await db.data.trainingJobs.find(query).toArray();
      
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
        analytics.modelTypeDistribution[training.baseModel] = (analytics.modelTypeDistribution[training.baseModel] || 0) + 1;
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
      
      res.json({ success: true, data: analytics });
    } catch (error) {
      logger.error('Failed to get training analytics:', error);
      res.status(500).json({ error: { code: 'ANALYTICS_ERROR', message: 'Failed to get analytics' } });
    }
  });

  // GET /internal/v1/data/analytics/datasets/:masterAccountId - Get dataset analytics
  router.get('/datasets/:masterAccountId', async (req, res, next) => {
    const { masterAccountId } = req.params;
    
    try {
      const datasets = await db.data.datasets.find({ 
        ownerAccountId: new ObjectId(masterAccountId) 
      }).toArray();
      
      const analytics = {
        totalDatasets: datasets.length,
        totalImages: datasets.reduce((sum, d) => sum + (d.images?.length || 0), 0),
        averageImagesPerDataset: 0,
        totalSize: datasets.reduce((sum, d) => sum + (d.sizeBytes || 0), 0),
        visibilityDistribution: {},
        usageDistribution: {},
        tagsDistribution: {}
      };
      
      if (datasets.length > 0) {
        analytics.averageImagesPerDataset = analytics.totalImages / datasets.length;
      }
      
      // Calculate distributions
      datasets.forEach(dataset => {
        // Visibility distribution
        analytics.visibilityDistribution[dataset.visibility] = 
          (analytics.visibilityDistribution[dataset.visibility] || 0) + 1;
        
        // Usage distribution
        const usageRange = dataset.usageCount < 5 ? '0-4' : 
                          dataset.usageCount < 10 ? '5-9' : 
                          dataset.usageCount < 20 ? '10-19' : '20+';
        analytics.usageDistribution[usageRange] = 
          (analytics.usageDistribution[usageRange] || 0) + 1;
        
        // Tags distribution
        if (dataset.tags) {
          dataset.tags.forEach(tag => {
            analytics.tagsDistribution[tag] = (analytics.tagsDistribution[tag] || 0) + 1;
          });
        }
      });
      
      res.json({ success: true, data: analytics });
    } catch (error) {
      logger.error('Failed to get dataset analytics:', error);
      res.status(500).json({ error: { code: 'ANALYTICS_ERROR', message: 'Failed to get analytics' } });
    }
  });

  return router;
}

module.exports = createAnalyticsApi;
```

### 5. Create Marketplace API (LOW PRIORITY)
**Current State**: No marketplace functionality
**Required**: Pricing, licensing, and marketplace features

**Implementation**:
- Create marketplace API for pricing and licensing
- Add revenue tracking and sharing
- Add marketplace discovery and browsing
- Add licensing and usage tracking

**Code Location**: `src/api/internal/marketplaceApi.js` (create new)
```javascript
/**
 * API Service for Marketplace
 */
const express = require('express');
const { ObjectId } = require('../../core/db/BaseDB');

function createMarketplaceApi(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router();

  // GET /internal/v1/data/marketplace/datasets - Browse public datasets
  router.get('/datasets', async (req, res, next) => {
    const { page = 1, limit = 20, search, tags, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    
    try {
      const query = { visibility: 'public' };
      
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }
      
      if (tags) {
        query.tags = { $in: tags.split(',') };
      }
      
      const sort = {};
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
      
      const datasets = await db.data.datasets.find(query)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .toArray();
      
      const total = await db.data.datasets.countDocuments(query);
      
      res.json({
        success: true,
        data: {
          datasets,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      logger.error('Failed to browse datasets:', error);
      res.status(500).json({ error: { code: 'BROWSE_ERROR', message: 'Failed to browse datasets' } });
    }
  });

  // GET /internal/v1/data/marketplace/models - Browse public models
  router.get('/models', async (req, res, next) => {
    const { page = 1, limit = 20, search, modelType, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    
    try {
      const query = { visibility: 'public' };
      
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }
      
      if (modelType) {
        query.modelType = modelType;
      }
      
      const sort = {};
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
      
      const models = await db.data.loraModels.find(query)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .toArray();
      
      const total = await db.data.loraModels.countDocuments(query);
      
      res.json({
        success: true,
        data: {
          models,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      logger.error('Failed to browse models:', error);
      res.status(500).json({ error: { code: 'BROWSE_ERROR', message: 'Failed to browse models' } });
    }
  });

  // POST /internal/v1/data/marketplace/purchase - Purchase dataset or model
  router.post('/purchase', async (req, res, next) => {
    const { masterAccountId, itemType, itemId, paymentMethod } = req.body;
    
    try {
      // Implement purchase logic
      // This would integrate with your payment system
      
      res.json({
        success: true,
        data: {
          purchaseId: new ObjectId(),
          itemType,
          itemId,
          status: 'completed'
        }
      });
    } catch (error) {
      logger.error('Failed to process purchase:', error);
      res.status(500).json({ error: { code: 'PURCHASE_ERROR', message: 'Failed to process purchase' } });
    }
  });

  return router;
}

module.exports = createMarketplaceApi;
```

## Success Criteria
- [ ] Enhanced trainings API with cost calculation and batch operations
- [ ] Complete datasets API with image management and caption generation
- [ ] Cost calculation API with real-time estimation
- [ ] Analytics API with comprehensive metrics
- [ ] Marketplace API with pricing and discovery features
- [ ] WebSocket integration for real-time updates
- [ ] Proper error handling and validation for all endpoints

## Testing
1. Test all new API endpoints with various parameters
2. Test cost calculation accuracy with different model types
3. Test batch operations with multiple items
4. Test analytics data accuracy and performance
5. Test WebSocket real-time updates
6. Test error handling and edge cases
7. Test API integration with frontend components

## Notes
- Ensure all APIs follow existing patterns and conventions
- Add proper authentication and authorization checks
- Implement rate limiting for cost calculation endpoints
- Add comprehensive logging for debugging
- Follow RESTful API design principles
- Add proper API documentation and examples
