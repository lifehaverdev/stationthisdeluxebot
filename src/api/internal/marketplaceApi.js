/**
 * API Service for Marketplace
 */
const express = require('express');
const { ObjectId } = require('../../core/services/db/BaseDB');

function createMarketplaceApi(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router();

  // GET /internal/v1/data/marketplace/datasets - Browse public datasets
  router.get('/datasets', async (req, res, next) => {
    const { page = 1, limit = 20, search, tags, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    
    logger.info(`[MarketplaceAPI] GET /datasets - Browsing public datasets`);
    
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
    
    logger.info(`[MarketplaceAPI] GET /models - Browsing public models`);
    
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

  // GET /internal/v1/data/marketplace/featured - Get featured items
  router.get('/featured', async (req, res, next) => {
    const { type = 'all', limit = 10 } = req.query;
    
    logger.info(`[MarketplaceAPI] GET /featured - Fetching featured items`);
    
    try {
      const featuredItems = {
        datasets: [],
        models: []
      };
      
      if (type === 'all' || type === 'datasets') {
        featuredItems.datasets = await db.data.datasets.find({
          visibility: 'public',
          featured: true
        })
        .sort({ featuredAt: -1 })
        .limit(parseInt(limit))
        .toArray();
      }
      
      if (type === 'all' || type === 'models') {
        featuredItems.models = await db.data.loraModels.find({
          visibility: 'public',
          featured: true
        })
        .sort({ featuredAt: -1 })
        .limit(parseInt(limit))
        .toArray();
      }
      
      res.json({ success: true, data: featuredItems });
    } catch (error) {
      logger.error('Failed to fetch featured items:', error);
      res.status(500).json({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch featured items' } });
    }
  });

  // GET /internal/v1/data/marketplace/categories - Get marketplace categories
  router.get('/categories', async (req, res, next) => {
    logger.info(`[MarketplaceAPI] GET /categories - Fetching marketplace categories`);
    
    try {
      const categories = {
        datasetTags: [],
        modelTypes: [],
        popularTags: []
      };
      
      // Get unique dataset tags
      const datasetTags = await db.data.datasets.distinct('tags', { visibility: 'public' });
      categories.datasetTags = datasetTags.filter(tag => tag).slice(0, 20);
      
      // Get unique model types
      const modelTypes = await db.data.loraModels.distinct('modelType', { visibility: 'public' });
      categories.modelTypes = modelTypes.filter(type => type);
      
      // Get popular tags (most used)
      const tagCounts = {};
      const allDatasets = await db.data.datasets.find({ visibility: 'public' }).toArray();
      allDatasets.forEach(dataset => {
        if (dataset.tags) {
          dataset.tags.forEach(tag => {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          });
        }
      });
      
      categories.popularTags = Object.entries(tagCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 15)
        .map(([tag]) => tag);
      
      res.json({ success: true, data: categories });
    } catch (error) {
      logger.error('Failed to fetch categories:', error);
      res.status(500).json({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch categories' } });
    }
  });

  // POST /internal/v1/data/marketplace/purchase - Purchase dataset or model
  router.post('/purchase', async (req, res, next) => {
    const { masterAccountId, itemType, itemId, paymentMethod } = req.body;
    
    logger.info(`[MarketplaceAPI] POST /purchase - Processing purchase for ${itemType} ${itemId}`);
    
    if (!masterAccountId || !itemType || !itemId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId, itemType, and itemId are required' } });
    }
    
    try {
      // Validate item exists and is purchasable
      let item;
      if (itemType === 'dataset') {
        item = await db.data.datasets.findOne({ 
          _id: new ObjectId(itemId), 
          visibility: 'public',
          purchasable: true 
        });
      } else if (itemType === 'model') {
        item = await db.data.loraModels.findOne({ 
          _id: new ObjectId(itemId), 
          visibility: 'public',
          purchasable: true 
        });
      } else {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid itemType. Must be "dataset" or "model"' } });
      }
      
      if (!item) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found or not available for purchase' } });
      }
      
      // Check if user already owns this item
      const existingPurchase = await db.data.purchases.findOne({
        buyerId: new ObjectId(masterAccountId),
        itemType,
        itemId: new ObjectId(itemId)
      });
      
      if (existingPurchase) {
        return res.status(400).json({ error: { code: 'ALREADY_OWNED', message: 'You already own this item' } });
      }
      
      // Create purchase record
      const purchaseData = {
        buyerId: new ObjectId(masterAccountId),
        sellerId: item.ownerAccountId || item.userId,
        itemType,
        itemId: new ObjectId(itemId),
        itemName: item.name,
        price: item.price || 0,
        paymentMethod: paymentMethod || 'credits',
        status: 'completed',
        purchasedAt: new Date()
      };
      
      const result = await db.data.purchases.insertOne(purchaseData);
      
      // Update item usage count
      if (itemType === 'dataset') {
        await db.data.datasets.updateOne(
          { _id: new ObjectId(itemId) },
          { $inc: { usageCount: 1 } }
        );
      } else if (itemType === 'model') {
        await db.data.loraModels.updateOne(
          { _id: new ObjectId(itemId) },
          { $inc: { usageCount: 1 } }
        );
      }
      
      res.json({
        success: true,
        data: {
          purchaseId: result.insertedId,
          itemType,
          itemId,
          status: 'completed',
          purchasedAt: purchaseData.purchasedAt
        }
      });
    } catch (error) {
      logger.error('Failed to process purchase:', error);
      res.status(500).json({ error: { code: 'PURCHASE_ERROR', message: 'Failed to process purchase' } });
    }
  });

  // GET /internal/v1/data/marketplace/purchases/:masterAccountId - Get user's purchases
  router.get('/purchases/:masterAccountId', async (req, res, next) => {
    const { masterAccountId } = req.params;
    const { page = 1, limit = 20, itemType } = req.query;
    
    logger.info(`[MarketplaceAPI] GET /purchases/${masterAccountId} - Fetching user purchases`);
    
    try {
      const query = { buyerId: new ObjectId(masterAccountId) };
      
      if (itemType) {
        query.itemType = itemType;
      }
      
      const purchases = await db.data.purchases.find(query)
        .sort({ purchasedAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .toArray();
      
      const total = await db.data.purchases.countDocuments(query);
      
      res.json({
        success: true,
        data: {
          purchases,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      logger.error('Failed to fetch purchases:', error);
      res.status(500).json({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch purchases' } });
    }
  });

  // POST /internal/v1/data/marketplace/sell - List item for sale
  router.post('/sell', async (req, res, next) => {
    const { masterAccountId, itemType, itemId, price, description } = req.body;
    
    logger.info(`[MarketplaceAPI] POST /sell - Listing ${itemType} ${itemId} for sale`);
    
    if (!masterAccountId || !itemType || !itemId || !price) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'masterAccountId, itemType, itemId, and price are required' } });
    }
    
    try {
      // Validate item exists and user owns it
      let item;
      if (itemType === 'dataset') {
        item = await db.data.datasets.findOne({ 
          _id: new ObjectId(itemId),
          ownerAccountId: new ObjectId(masterAccountId)
        });
      } else if (itemType === 'model') {
        item = await db.data.loraModels.findOne({ 
          _id: new ObjectId(itemId),
          userId: masterAccountId
        });
      } else {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid itemType. Must be "dataset" or "model"' } });
      }
      
      if (!item) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found or you do not own it' } });
      }
      
      // Update item to be purchasable
      const updateData = {
        purchasable: true,
        price: parseFloat(price),
        marketplaceDescription: description || '',
        listedAt: new Date(),
        visibility: 'public'
      };
      
      let result;
      if (itemType === 'dataset') {
        result = await db.data.datasets.updateOne(
          { _id: new ObjectId(itemId) },
          { $set: updateData }
        );
      } else {
        result = await db.data.loraModels.updateOne(
          { _id: new ObjectId(itemId) },
          { $set: updateData }
        );
      }
      
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found' } });
      }
      
      res.json({
        success: true,
        data: {
          itemType,
          itemId,
          price: parseFloat(price),
          status: 'listed',
          listedAt: updateData.listedAt
        }
      });
    } catch (error) {
      logger.error('Failed to list item for sale:', error);
      res.status(500).json({ error: { code: 'LIST_ERROR', message: 'Failed to list item for sale' } });
    }
  });

  // GET /internal/v1/data/marketplace/stats - Get marketplace statistics
  router.get('/stats', async (req, res, next) => {
    logger.info(`[MarketplaceAPI] GET /stats - Fetching marketplace statistics`);
    
    try {
      const stats = {
        totalDatasets: await db.data.datasets.countDocuments({ visibility: 'public' }),
        totalModels: await db.data.loraModels.countDocuments({ visibility: 'public' }),
        totalPurchases: await db.data.purchases.countDocuments({}),
        totalRevenue: 0,
        topSellers: [],
        recentActivity: []
      };
      
      // Calculate total revenue
      const purchases = await db.data.purchases.find({ status: 'completed' }).toArray();
      stats.totalRevenue = purchases.reduce((sum, p) => sum + (p.price || 0), 0);
      
      // Get top sellers
      const sellerStats = {};
      purchases.forEach(purchase => {
        const sellerId = purchase.sellerId.toString();
        if (!sellerStats[sellerId]) {
          sellerStats[sellerId] = { sales: 0, revenue: 0 };
        }
        sellerStats[sellerId].sales++;
        sellerStats[sellerId].revenue += purchase.price || 0;
      });
      
      stats.topSellers = Object.entries(sellerStats)
        .map(([sellerId, data]) => ({ sellerId, ...data }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);
      
      // Get recent activity
      stats.recentActivity = await db.data.purchases.find({})
        .sort({ purchasedAt: -1 })
        .limit(10)
        .toArray();
      
      res.json({ success: true, data: stats });
    } catch (error) {
      logger.error('Failed to fetch marketplace stats:', error);
      res.status(500).json({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch marketplace stats' } });
    }
  });

  return router;
}

module.exports = createMarketplaceApi;
