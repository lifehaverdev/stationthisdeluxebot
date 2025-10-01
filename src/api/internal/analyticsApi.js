/**
 * API Service for Analytics
 */
const express = require('express');
const { ObjectId } = require('../../core/services/db/BaseDB');

function createAnalyticsApi(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router();

  // GET /internal/v1/data/analytics/training/:masterAccountId - Get training analytics
  router.get('/training/:masterAccountId', async (req, res, next) => {
    const { masterAccountId } = req.params;
    const { startDate, endDate } = req.query;
    
    logger.info(`[AnalyticsAPI] GET /training/${masterAccountId} - Fetching training analytics`);
    
    try {
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
      
      res.json({ success: true, data: analytics });
    } catch (error) {
      logger.error('Failed to get training analytics:', error);
      res.status(500).json({ error: { code: 'ANALYTICS_ERROR', message: 'Failed to get analytics' } });
    }
  });

  // GET /internal/v1/data/analytics/datasets/:masterAccountId - Get dataset analytics
  router.get('/datasets/:masterAccountId', async (req, res, next) => {
    const { masterAccountId } = req.params;
    
    logger.info(`[AnalyticsAPI] GET /datasets/${masterAccountId} - Fetching dataset analytics`);
    
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

  // GET /internal/v1/data/analytics/overview/:masterAccountId - Get comprehensive overview
  router.get('/overview/:masterAccountId', async (req, res, next) => {
    const { masterAccountId } = req.params;
    const { startDate, endDate } = req.query;
    
    logger.info(`[AnalyticsAPI] GET /overview/${masterAccountId} - Fetching comprehensive analytics overview`);
    
    try {
      // Get training analytics
      const trainingQuery = { userId: masterAccountId };
      if (startDate || endDate) {
        trainingQuery.createdAt = {};
        if (startDate) trainingQuery.createdAt.$gte = new Date(startDate);
        if (endDate) trainingQuery.createdAt.$lte = new Date(endDate);
      }
      
      const trainings = await db.loraTrainings.find(trainingQuery).toArray();
      const datasets = await db.data.datasets.find({ 
        ownerAccountId: new ObjectId(masterAccountId) 
      }).toArray();
      
      const overview = {
        summary: {
          totalTrainings: trainings.length,
          totalDatasets: datasets.length,
          totalImages: datasets.reduce((sum, d) => sum + (d.images?.length || 0), 0),
          totalCost: trainings.reduce((sum, t) => sum + (t.costPoints || 0), 0)
        },
        trainingMetrics: {
          completed: trainings.filter(t => t.status === 'COMPLETED').length,
          failed: trainings.filter(t => t.status === 'FAILED').length,
          running: trainings.filter(t => t.status === 'RUNNING').length,
          queued: trainings.filter(t => t.status === 'QUEUED').length,
          successRate: 0,
          averageDuration: 0
        },
        datasetMetrics: {
          public: datasets.filter(d => d.visibility === 'public').length,
          private: datasets.filter(d => d.visibility === 'private').length,
          averageImages: 0,
          totalSize: datasets.reduce((sum, d) => sum + (d.sizeBytes || 0), 0)
        },
        recentActivity: [],
        costTrends: [],
        modelTypeUsage: {},
        tagUsage: {}
      };
      
      // Calculate success rate
      if (trainings.length > 0) {
        overview.trainingMetrics.successRate = (overview.trainingMetrics.completed / trainings.length) * 100;
        
        const completedTrainings = trainings.filter(t => t.status === 'COMPLETED' && t.startedAt && t.completedAt);
        if (completedTrainings.length > 0) {
          const totalDuration = completedTrainings.reduce((sum, t) => {
            return sum + (new Date(t.completedAt) - new Date(t.startedAt));
          }, 0);
          overview.trainingMetrics.averageDuration = totalDuration / completedTrainings.length / 1000 / 60; // minutes
        }
      }
      
      // Calculate average images per dataset
      if (datasets.length > 0) {
        overview.datasetMetrics.averageImages = overview.summary.totalImages / datasets.length;
      }
      
      // Recent activity (last 10 items)
      const recentTrainings = trainings
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5)
        .map(t => ({
          type: 'training',
          id: t._id,
          name: t.name,
          status: t.status,
          createdAt: t.createdAt
        }));
      
      const recentDatasets = datasets
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5)
        .map(d => ({
          type: 'dataset',
          id: d._id,
          name: d.name,
          imageCount: d.images?.length || 0,
          createdAt: d.createdAt
        }));
      
      overview.recentActivity = [...recentTrainings, ...recentDatasets]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10);
      
      // Cost trends (daily for last 30 days)
      const costByDate = {};
      trainings.forEach(training => {
        if (training.costPoints) {
          const date = new Date(training.createdAt).toISOString().split('T')[0];
          costByDate[date] = (costByDate[date] || 0) + training.costPoints;
        }
      });
      
      overview.costTrends = Object.entries(costByDate)
        .map(([date, cost]) => ({ date, cost }))
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(-30); // Last 30 days
      
      // Model type usage
      trainings.forEach(training => {
        if (training.modelType) {
          overview.modelTypeUsage[training.modelType] = (overview.modelTypeUsage[training.modelType] || 0) + 1;
        }
      });
      
      // Tag usage
      datasets.forEach(dataset => {
        if (dataset.tags) {
          dataset.tags.forEach(tag => {
            overview.tagUsage[tag] = (overview.tagUsage[tag] || 0) + 1;
          });
        }
      });
      
      res.json({ success: true, data: overview });
    } catch (error) {
      logger.error('Failed to get analytics overview:', error);
      res.status(500).json({ error: { code: 'ANALYTICS_ERROR', message: 'Failed to get analytics overview' } });
    }
  });

  // GET /internal/v1/data/analytics/performance/:masterAccountId - Get performance metrics
  router.get('/performance/:masterAccountId', async (req, res, next) => {
    const { masterAccountId } = req.params;
    const { startDate, endDate } = req.query;
    
    logger.info(`[AnalyticsAPI] GET /performance/${masterAccountId} - Fetching performance metrics`);
    
    try {
      const query = { userId: masterAccountId };
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }
      
      const trainings = await db.loraTrainings.find(query).toArray();
      
      const performance = {
        averageTrainingTime: 0,
        fastestTraining: null,
        slowestTraining: null,
        successRateByModel: {},
        costEfficiency: {},
        monthlyTrends: {}
      };
      
      const completedTrainings = trainings.filter(t => 
        t.status === 'COMPLETED' && t.startedAt && t.completedAt
      );
      
      if (completedTrainings.length > 0) {
        // Calculate average training time
        const totalTime = completedTrainings.reduce((sum, t) => {
          return sum + (new Date(t.completedAt) - new Date(t.startedAt));
        }, 0);
        performance.averageTrainingTime = totalTime / completedTrainings.length / 1000 / 60; // minutes
        
        // Find fastest and slowest trainings
        const trainingTimes = completedTrainings.map(t => ({
          id: t._id,
          name: t.name,
          duration: (new Date(t.completedAt) - new Date(t.startedAt)) / 1000 / 60, // minutes
          modelType: t.modelType
        }));
        
        performance.fastestTraining = trainingTimes.reduce((min, t) => 
          t.duration < min.duration ? t : min
        );
        
        performance.slowestTraining = trainingTimes.reduce((max, t) => 
          t.duration > max.duration ? t : max
        );
        
        // Success rate by model type
        const modelTypes = [...new Set(trainings.map(t => t.modelType))];
        modelTypes.forEach(modelType => {
          const modelTrainings = trainings.filter(t => t.modelType === modelType);
          const completed = modelTrainings.filter(t => t.status === 'COMPLETED').length;
          performance.successRateByModel[modelType] = (completed / modelTrainings.length) * 100;
        });
        
        // Cost efficiency (cost per successful training)
        modelTypes.forEach(modelType => {
          const modelTrainings = trainings.filter(t => t.modelType === modelType);
          const completed = modelTrainings.filter(t => t.status === 'COMPLETED');
          const totalCost = completed.reduce((sum, t) => sum + (t.costPoints || 0), 0);
          performance.costEfficiency[modelType] = completed.length > 0 ? totalCost / completed.length : 0;
        });
      }
      
      // Monthly trends
      const monthlyData = {};
      trainings.forEach(training => {
        const month = new Date(training.createdAt).toISOString().substring(0, 7); // YYYY-MM
        if (!monthlyData[month]) {
          monthlyData[month] = {
            trainings: 0,
            completed: 0,
            cost: 0
          };
        }
        monthlyData[month].trainings++;
        if (training.status === 'COMPLETED') monthlyData[month].completed++;
        monthlyData[month].cost += training.costPoints || 0;
      });
      
      performance.monthlyTrends = Object.entries(monthlyData)
        .map(([month, data]) => ({
          month,
          ...data,
          successRate: (data.completed / data.trainings) * 100
        }))
        .sort((a, b) => a.month.localeCompare(b.month));
      
      res.json({ success: true, data: performance });
    } catch (error) {
      logger.error('Failed to get performance metrics:', error);
      res.status(500).json({ error: { code: 'ANALYTICS_ERROR', message: 'Failed to get performance metrics' } });
    }
  });

  return router;
}

module.exports = createAnalyticsApi;
