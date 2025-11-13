const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');

/**
 * Creates the costs API router for internal use
 * @param {object} services - Service container
 * @param {CostsDB} services.costsDb - Costs database service
 * @param {object} logger - Logger instance
 * @returns {express.Router} The configured router
 */
function createCostsApi(services, logger) {
  const router = express.Router();
  const { db } = services;
  const costsDb = db?.costs;

  if (!costsDb) {
    logger.error('[CostsApi] Missing costsDb service. Available db keys:', Object.keys(db || {}));
    // Return a router that responds with service unavailable
    router.use((req, res) => {
      res.status(503).json({ 
        error: { 
          code: 'SERVICE_UNAVAILABLE', 
          message: 'Costs database service is not available.' 
        } 
      });
    });
    return router;
  }

  // POST /costs - Create a new cost entry
  router.post('/', async (req, res) => {
    const requestId = uuidv4();
    const { date, category, description, amount, currency, vendor, receiptUrl, tags, createdBy } = req.body;

    logger.info(`[CostsApi] POST /costs - RequestId: ${requestId}`, { body: req.body });

    try {
      if (!date || !category || !description || amount === undefined || !createdBy) {
        return res.status(400).json({
          error: { message: 'Missing required fields: date, category, description, amount, createdBy', requestId }
        });
      }

      const result = await costsDb.createCostEntry({
        date,
        category,
        description,
        amount,
        currency: currency || 'USD',
        vendor,
        receiptUrl,
        tags: tags || [],
        createdBy
      });

      if (!result.insertedId) {
        throw new Error('Failed to create cost entry');
      }

      res.status(201).json({ costId: result.insertedId, requestId });
    } catch (error) {
      logger.error(`[CostsApi] Error creating cost entry:`, error);
      res.status(500).json({
        error: { message: 'Failed to create cost entry', details: error.message, requestId }
      });
    }
  });

  // GET /costs - Get cost entries with optional filters
  router.get('/', async (req, res) => {
    const requestId = uuidv4();
    const { category, startDate, endDate, createdBy, limit, skip } = req.query;

    logger.info(`[CostsApi] GET /costs - RequestId: ${requestId}`);

    try {
      const filter = {};
      
      if (category) {
        filter.category = category;
      }
      
      if (startDate || endDate) {
        filter.date = {};
        if (startDate) filter.date.$gte = new Date(startDate);
        if (endDate) filter.date.$lte = new Date(endDate);
      }
      
      if (createdBy) {
        filter.createdBy = createdBy;
      }

      const options = {};
      if (limit) options.limit = parseInt(limit);
      if (skip) options.skip = parseInt(skip);
      options.sort = { date: -1 }; // Newest first

      const costs = await costsDb.findCosts(filter, options);

      // Convert Decimal128 amounts to strings for JSON serialization
      const costsFormatted = costs.map(cost => ({
        ...cost,
        amount: cost.amount ? cost.amount.toString() : '0',
        _id: cost._id.toString()
      }));

      res.json({ costs: costsFormatted, requestId });
    } catch (error) {
      logger.error(`[CostsApi] Error getting cost entries:`, error);
      res.status(500).json({
        error: { message: 'Failed to get cost entries', details: error.message, requestId }
      });
    }
  });

  // GET /costs/:costId - Get a specific cost entry
  router.get('/:costId', async (req, res) => {
    const { costId } = req.params;
    const requestId = uuidv4();

    logger.info(`[CostsApi] GET /costs/${costId} - RequestId: ${requestId}`);

    try {
      if (!ObjectId.isValid(costId)) {
        return res.status(400).json({
          error: { message: 'Invalid cost ID format', requestId }
        });
      }

      const cost = await costsDb.findCostById(costId);
      
      if (!cost) {
        return res.status(404).json({
          error: { message: 'Cost entry not found', requestId }
        });
      }

      // Convert Decimal128 amount to string
      const costFormatted = {
        ...cost,
        amount: cost.amount ? cost.amount.toString() : '0',
        _id: cost._id.toString()
      };

      res.json({ cost: costFormatted, requestId });
    } catch (error) {
      logger.error(`[CostsApi] Error getting cost entry:`, error);
      res.status(500).json({
        error: { message: 'Failed to get cost entry', details: error.message, requestId }
      });
    }
  });

  // PUT /costs/:costId - Update a cost entry
  router.put('/:costId', async (req, res) => {
    const { costId } = req.params;
    const requestId = uuidv4();
    const updateData = req.body;

    logger.info(`[CostsApi] PUT /costs/${costId} - RequestId: ${requestId}`);

    try {
      if (!ObjectId.isValid(costId)) {
        return res.status(400).json({
          error: { message: 'Invalid cost ID format', requestId }
        });
      }

      const result = await costsDb.updateCost(costId, updateData);
      
      if (result.matchedCount === 0) {
        return res.status(404).json({
          error: { message: 'Cost entry not found', requestId }
        });
      }

      res.json({ success: true, requestId });
    } catch (error) {
      logger.error(`[CostsApi] Error updating cost entry:`, error);
      res.status(500).json({
        error: { message: 'Failed to update cost entry', details: error.message, requestId }
      });
    }
  });

  // DELETE /costs/:costId - Delete a cost entry
  router.delete('/:costId', async (req, res) => {
    const { costId } = req.params;
    const requestId = uuidv4();

    logger.info(`[CostsApi] DELETE /costs/${costId} - RequestId: ${requestId}`);

    try {
      if (!ObjectId.isValid(costId)) {
        return res.status(400).json({
          error: { message: 'Invalid cost ID format', requestId }
        });
      }

      const result = await costsDb.deleteCost(costId);
      
      if (result.deletedCount === 0) {
        return res.status(404).json({
          error: { message: 'Cost entry not found', requestId }
        });
      }

      res.json({ success: true, requestId });
    } catch (error) {
      logger.error(`[CostsApi] Error deleting cost entry:`, error);
      res.status(500).json({
        error: { message: 'Failed to delete cost entry', details: error.message, requestId }
      });
    }
  });

  // GET /costs/totals/by-category - Get totals by category for a date range
  router.get('/totals/by-category', async (req, res) => {
    const requestId = uuidv4();
    const { startDate, endDate } = req.query;

    logger.info(`[CostsApi] GET /costs/totals/by-category - RequestId: ${requestId}`);

    try {
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // Default: last year
      const end = endDate ? new Date(endDate) : new Date();

      const totals = await costsDb.getTotalsByCategory(start, end);

      // Convert Decimal128 amounts to strings
      const totalsFormatted = totals.map(total => ({
        ...total,
        total: total.total ? total.total.toString() : '0'
      }));

      res.json({ totals: totalsFormatted, startDate: start.toISOString(), endDate: end.toISOString(), requestId });
    } catch (error) {
      logger.error(`[CostsApi] Error getting totals by category:`, error);
      res.status(500).json({
        error: { message: 'Failed to get totals by category', details: error.message, requestId }
      });
    }
  });

  return router;
}

module.exports = { createCostsApi };

