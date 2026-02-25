const express = require('express');
const { ObjectId } = require('mongodb');
const { generationService } = require('../../../core/services/store/generations/GenerationService');

const DEFAULT_GENERATION_LIMIT = 100;
const MAX_GENERATION_LIMIT = 200;

function parseLimit(value) {
  if (!value) return DEFAULT_GENERATION_LIMIT;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return DEFAULT_GENERATION_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_GENERATION_LIMIT));
}

function parseSkip(value) {
  if (!value) return 0;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

function parseSort(sortValue) {
  if (!sortValue) {
    return { requestTimestamp: 1 };
  }
  const sort = {};
  const parts = sortValue.split(',');
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;
    const [field, directionRaw] = part.split(':').map(str => str && str.trim()).filter(Boolean);
    if (!field) continue;
    const parsedDir = directionRaw ? parseInt(directionRaw, 10) : null;
    if (!Number.isNaN(parsedDir)) {
      sort[field] = parsedDir === 0 ? 1 : parsedDir;
    } else if (directionRaw && directionRaw.toLowerCase() === 'desc') {
      sort[field] = -1;
    } else {
      sort[field] = 1;
    }
  }
  if (!Object.keys(sort).length) {
    return { requestTimestamp: 1 };
  }
  return sort;
}

function parseProjection(fieldsValue) {
  if (!fieldsValue) return null;
  const projection = {};
  const fields = fieldsValue.split(',');
  for (const rawField of fields) {
    const field = rawField.trim();
    if (!field) continue;
    projection[field] = 1;
  }
  return Object.keys(projection).length ? projection : null;
}

// This function initializes the routes for the Generation Outputs API
module.exports = function generationOutputsApi(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router();

  // Check for essential dependencies
  if (!db || !db.generationOutputs) {
    logger.error('[generationOutputsApi] Critical dependency failure: db.generationOutputs service is missing!');
    return (req, res, next) => {
        res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'GenerationOutputs database service is not available.' } });
    };
  }

  logger.debug('[generationOutputsApi] Initializing Generation Outputs API routes...');

  // Middleware for validating ObjectId in path parameters
  const validateObjectId = (paramName) => (req, res, next) => {
    const id = req.params[paramName];
    if (!ObjectId.isValid(id)) {
      logger.warn(`[generationOutputsApi] Invalid ObjectId format for param '${paramName}': ${id}`);
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: `Invalid format for ${paramName}. Must be a valid ObjectId.` }
      });
    }
    if (!req.locals) req.locals = {};
    req.locals[paramName] = new ObjectId(id);
    next();
  };

  //-------------------------------------------------------------------------
  // --- API Endpoint Implementations --- 
  // Mounted at /internal/v1/data/generations
  //-------------------------------------------------------------------------

  // GET / - Retrieves multiple generation outputs based on query filters
  router.get('/', async (req, res, next) => {
    logger.debug('[generationOutputsApi] GET / - Received request with query:', req.query);
    try {
      const filter = {};
      const reservedQueryKeys = new Set(['limit', 'skip', 'page', 'sort', 'fields', 'projection']);

      for (const key in req.query) {
        if (reservedQueryKeys.has(key)) continue;
        const value = req.query[key];

        if (key.endsWith('_in')) {
          const field = key.slice(0, -3);
          let values = Array.isArray(value)
            ? value
            : (typeof value === 'string' && value.includes(',')
              ? value.split(',').map(v => v.trim())
              : [value]);
          if (field === '_id') {
            filter[field] = { $in: values.map(v => ObjectId.isValid(v) ? new ObjectId(v) : v) };
          } else {
            filter[field] = { $in: values };
          }
        } else if (key.endsWith('_ne')) {
          const field = key.slice(0, -3);
          filter[field] = { $ne: value };
        } else if (key.endsWith('_gte')) {
          const field = key.slice(0, -4);
          if (!filter[field]) filter[field] = {};
          filter[field].$gte = new Date(value);
        } else if (key.endsWith('_lte')) {
          const field = key.slice(0, -4);
          if (!filter[field]) filter[field] = {};
          filter[field].$lte = new Date(value);
        } else {
          filter[key] = value;
        }
      }

      const limit = parseLimit(req.query.limit);
      const skip = parseSkip(req.query.skip);
      const sort = parseSort(req.query.sort);
      const projection = parseProjection(req.query.fields || req.query.projection);

      const page = parseInt(req.query.page, 10);
      let effectiveSkip = 0;
      if (!Number.isNaN(page) && page > 0) {
        effectiveSkip = (page - 1) * limit;
      } else if (skip) {
        effectiveSkip = skip;
      }
      const queryOptions = { limit, sort };
      if (effectiveSkip) queryOptions.skip = effectiveSkip;
      if (projection) queryOptions.projection = projection;

      logger.debug('[generationOutputsApi] GET / - Filter & options:', { filter, queryOptions });

      const startMs = Date.now();
      const generations = await db.generationOutputs.findGenerations(filter, queryOptions);
      const durationMs = Date.now() - startMs;
      if (durationMs > 5000) {
        logger.warn('[generationOutputsApi] GET / - Slow query detected', { durationMs, collectionId: filter['metadata.collectionId'], limit, sort });
      }

      if (!generations) {
        logger.debug('[generationOutputsApi] GET / - No generations found matching criteria or db method returned null/undefined.');
        return res.status(200).json({ generations: [] }); // Return empty array for consistency
      }
      
      logger.debug(`[generationOutputsApi] GET / - Found ${generations.length} generation(s).`);
      // The API contract usually expects an object with a key (e.g., "generations") holding the array.
      res.status(200).json({ generations });

    } catch (error) {
      logger.error(`[generationOutputsApi] GET /: Error processing request - ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error retrieving generation outputs.' } });
    }
  });

  // GET /last/:masterAccountId - Get the last generation for a user
  router.get('/last/:masterAccountId', async (req, res) => {
    const { masterAccountId } = req.params;
    const { platform } = req.query;

    if (!ObjectId.isValid(masterAccountId)) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Invalid masterAccountId format.' }
      });
    }

    try {
      // Find the most recent generation for this user
      const generations = await db.generationOutputs.findGenerations(
        {
          masterAccountId: new ObjectId(masterAccountId)
        },
        {
          sort: { requestTimestamp: -1 },
          limit: 1
        }
      );

      if (!generations || generations.length === 0) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'No previous generations found for this user.' }
        });
      }

      res.json(generations[0]);
    } catch (error) {
      logger.error(`[generationOutputsApi] Error fetching last generation for user ${masterAccountId}: ${error.message}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch last generation.' }
      });
    }
  });

  // POST / - Logs a new generation task
  router.post('/', async (req, res, next) => {
    logger.debug('[generationOutputsApi] POST / - Received request', { body: req.body });

    // Validate required fields from ADR-003
    const { masterAccountId, initiatingEventId, serviceName, toolId, toolDisplayName, spellId, castId, cookId, requestPayload, responsePayload, metadata, requestTimestamp, notificationPlatform, deliveryStatus, deliveryStrategy, status } = req.body;
    const requiredFields = { masterAccountId, initiatingEventId, serviceName, requestPayload, notificationPlatform, deliveryStatus };
    for (const field in requiredFields) {
      if (requiredFields[field] === undefined || requiredFields[field] === null) { // Check for undefined or null
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: `Missing required field: ${field}.`, details: { field } } });
      }
    }
    // Validate ObjectIds (optional for spellId/castId/cookId)
    if (!ObjectId.isValid(masterAccountId)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid masterAccountId format.', details: { field: 'masterAccountId' } } });
    if (!ObjectId.isValid(initiatingEventId)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid initiatingEventId format.', details: { field: 'initiatingEventId' } } });
    if (spellId && !ObjectId.isValid(spellId)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid spellId format.', details: { field: 'spellId' } } });
    if (castId && !ObjectId.isValid(castId)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid castId format.', details: { field: 'castId' } } });
    if (cookId && !ObjectId.isValid(cookId)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid cookId format.', details: { field: 'cookId' } } });
    
    // Validate types for core fields
    if (typeof serviceName !== 'string' || serviceName.trim() === '') return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'serviceName must be a non-empty string.', details: { field: 'serviceName' } } });
    if (typeof requestPayload !== 'object') return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'requestPayload must be an object.', details: { field: 'requestPayload' } } });
    if (metadata && typeof metadata !== 'object') return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'metadata must be an object if provided.', details: { field: 'metadata' } } });
    
    // Validate new notification fields
    if (typeof notificationPlatform !== 'string' || notificationPlatform.trim() === '') {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'notificationPlatform must be a non-empty string.', details: { field: 'notificationPlatform' } } });
    }
    const validDeliveryStatuses = ['pending', 'skipped', 'none']; // Define valid initial statuses for creation
    if (typeof deliveryStatus !== 'string' || !validDeliveryStatuses.includes(deliveryStatus)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: `deliveryStatus must be one of: ${validDeliveryStatuses.join(', ')}.`, details: { field: 'deliveryStatus' } } });
    }
    // Validate metadata.notificationContext if metadata is provided
    if (metadata && metadata.notificationContext && typeof metadata.notificationContext !== 'object'){
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'metadata.notificationContext must be an object if provided.', details: { field: 'metadata.notificationContext' } } });
    }

    let parsedTimestamp = null;
    if (requestTimestamp) {
        parsedTimestamp = new Date(requestTimestamp);
        if (isNaN(parsedTimestamp.getTime())) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid requestTimestamp format.', details: { field: 'requestTimestamp' } } });
        }
    }

    try {
      const dataToCreate = {
        masterAccountId: new ObjectId(masterAccountId),
        initiatingEventId: new ObjectId(initiatingEventId),
        serviceName: serviceName.trim(),
        ...(toolId && { toolId }),
        ...(toolDisplayName && { toolDisplayName }),
        ...(spellId && { spellId }),
        ...(castId && { castId }),
        ...(cookId && { cookId }),
        requestPayload: requestPayload,
        ...(responsePayload && { responsePayload }),
        status: status || 'pending', // Honor status from body, otherwise default to pending
        notificationPlatform: notificationPlatform.trim(),
        deliveryStatus: deliveryStatus,
        ...(deliveryStrategy && { deliveryStrategy }),
        ...(metadata && { metadata }), // metadata now contains notificationContext
        ...(parsedTimestamp && { requestTimestamp: parsedTimestamp }),
      };

      const newGeneration = await db.generationOutputs.createGenerationOutput(dataToCreate);

      if (!newGeneration || !newGeneration._id) {
        logger.error('[generationOutputsApi] POST /: Failed to create generation output.');
        throw new Error('Database operation failed to create generation output.');
      }

      // If the newly created generation is immediately ready for delivery, emit an event.
      // This is crucial for spell/workflow final notifications.
      const isNotificationReady =
        newGeneration.deliveryStatus === 'pending' &&
        ['completed', 'failed'].includes(newGeneration.status) &&
        newGeneration.notificationPlatform !== 'none';

      if (isNotificationReady) {
        logger.debug(`[generationOutputsApi] POST /: New generation ${newGeneration._id} is ready for delivery, emitting event.`);
        notificationEvents.emit('generationUpdated', newGeneration);
      }

      logger.info(`[generationOutputsApi] POST /: Generation output created successfully. ID: ${newGeneration._id}`);
      res.status(201).json(newGeneration); // ADR: Response: GenerationOutputObject

    } catch (error) {
      logger.error(`[generationOutputsApi] POST /: Error processing request - ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'Error creating generation output.' } });
    }
  });

  // GET /:generationId - Retrieves a generation output
  router.get('/:generationId', validateObjectId('generationId'), async (req, res, next) => {
    const { generationId } = req.locals;
    logger.debug(`[generationOutputsApi] GET /${generationId} - Received request`);

    try {
      const generation = await db.generationOutputs.findGenerationById(generationId);

      if (!generation) {
        logger.warn(`[generationOutputsApi] GET /${generationId}: Generation output not found.`);
        return res.status(404).json({ 
          error: { code: 'NOT_FOUND', message: 'Generation output not found.', details: { generationId: generationId.toString() } } 
        });
      }

      logger.debug(`[generationOutputsApi] GET /${generationId}: Generation output found.`);
      res.status(200).json(generation);

    } catch (error) {
      logger.error(`[generationOutputsApi] GET /${generationId}: Error processing request - ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error retrieving generation output.' } });
    }
  });

  // PUT /:generationId - Updates a generation output
  router.put('/:generationId', validateObjectId('generationId'), async (req, res, next) => {
    const { generationId } = req.locals;
    const updatePayload = req.body;

    logger.debug(`[generationOutputsApi] PUT /${generationId} - Received request, PAYLOAD:`, { body: updatePayload });

    if (!updatePayload || typeof updatePayload !== 'object' || Object.keys(updatePayload).length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Request body must be a non-empty object containing fields to update.' } });
    }

    try {
      const updated = await generationService.update(generationId, updatePayload);
      if (!updated) {
        logger.warn(`[generationOutputsApi] PUT /${generationId}: Generation output not found for update.`);
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Generation output not found.', details: { generationId: generationId.toString() } } });
      }
      logger.debug(`[generationOutputsApi] PUT /${generationId}: Generation output updated successfully.`);
      res.status(200).json(updated);
    } catch (err) {
      logger.error(`[generationOutputsApi] PUT /${generationId}: Error processing request - ${err.message}`, err);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error updating generation output.' } });
    }
  });

  // GET /users/:masterAccountId/most-frequent-tools - Retrieves the most frequently used tools for a user
  router.get('/users/:masterAccountId/most-frequent-tools', validateObjectId('masterAccountId'), async (req, res, next) => {
    const { masterAccountId } = req.locals; // Comes from validateObjectId middleware
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 12; // Fetch a decent number for client-side filtering, e.g., 12 (was displayLimit * 3)

    if (isNaN(limit) || limit <= 0) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Invalid limit parameter. Must be a positive integer.' }
      });
    }

    logger.debug(`[generationOutputsApi] GET /users/${masterAccountId}/most-frequent-tools - Requested limit for DB fetch: ${limit}`);

    try {
      const frequentToolsDataFromDb = await db.generationOutputs.getMostFrequentlyUsedToolsByMasterAccountId(masterAccountId, limit);

      if (!frequentToolsDataFromDb) {
        logger.warn(`[generationOutputsApi] No frequent tools data returned from DB for MAID ${masterAccountId}`);
        return res.status(200).json({ frequentTools: [] });
      }
      
      // The API now returns raw data: toolId and usageCount. Client will handle enrichment and filtering.
      // The objects will be like { toolId: string, usageCount: number }
      logger.debug(`[generationOutputsApi] GET /users/${masterAccountId}/most-frequent-tools - Returning ${frequentToolsDataFromDb.length} raw tool usage data entries.`);
      res.status(200).json({ frequentTools: frequentToolsDataFromDb });

    } catch (error) {
      logger.error(`[generationOutputsApi] GET /users/${masterAccountId}/most-frequent-tools: Error - ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error retrieving most frequent tools.' } });
    }
  });

  // POST /rate_gen/:generationId - Updates ratings for a generation output
  router.post('/rate_gen/:generationId', validateObjectId('generationId'), async (req, res, next) => {
    const { generationId } = req.locals;
    const { ratingType, masterAccountId } = req.body;

    logger.debug(`[generationOutputsApi] POST /rate_gen/${generationId} - Received request to rate as ${ratingType}`);

    if (!ratingType || !['beautiful', 'funny', 'sad'].includes(ratingType)) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid rating type.' } });
    }

    if (!ObjectId.isValid(masterAccountId)) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid masterAccountId format.' } });
    }

    try {
      const generation = await db.generationOutputs.findGenerationById(generationId);

      if (!generation) {
        logger.warn(`[generationOutputsApi] POST /rate_gen/${generationId}: Generation output not found.`);
        return res.status(404).json({ 
          error: { code: 'NOT_FOUND', message: 'Generation output not found.', details: { generationId: generationId.toString() } } 
        });
      }

      // Update the ratings
      const ratings = generation.ratings || { beautiful: [], funny: [], sad: [] };

      // Remove the user from all rating categories
      for (const key in ratings) {
        ratings[key] = ratings[key].filter(id => id.toString() !== masterAccountId.toString());
      }

      // Add the user to the new rating category
      if (!ratings[ratingType].includes(masterAccountId)) {
        ratings[ratingType].push(masterAccountId);
      }

      await db.generationOutputs.updateGenerationOutput(generationId, { ratings, masterAccountId, ratingType });

      logger.debug(`[generationOutputsApi] POST /rate_gen/${generationId}: Rating updated successfully.`);
      res.status(200).json({ message: 'Rating updated successfully.' });

    } catch (error) {
      logger.error(`[generationOutputsApi] POST /rate_gen/${generationId}: Error processing request - ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error updating rating.' } });
    }
  });

  logger.debug('[generationOutputsApi] Generation Outputs API routes initialized.');
  return router;
}; 
