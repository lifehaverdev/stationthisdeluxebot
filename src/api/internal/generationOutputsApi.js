const express = require('express');
const { ObjectId, Decimal128 } = require('mongodb');
const notificationEvents = require('../../core/events/notificationEvents');

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

  logger.info('[generationOutputsApi] Initializing Generation Outputs API routes...');

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
    logger.info('[generationOutputsApi] GET / - Received request with query:', req.query);
    try {
      const filter = {};
      
      // Generic query parameter processing
      for (const key in req.query) {
        const value = req.query[key];

        if (key.endsWith('_in')) {
          const field = key.slice(0, -3);
          filter[field] = { $in: Array.isArray(value) ? value : [value] };
        } else if (key.endsWith('_ne')) {
          const field = key.slice(0, -3);
          filter[field] = { $ne: value };
        } else {
          // Allow dot notation for nested metadata fields e.g., "metadata.run_id"
          if (key.startsWith('metadata.')) {
              filter[key] = value;
          } else {
              filter[key] = value;
          }
        }
      }

      logger.debug('[generationOutputsApi] GET / - Constructed filter:', filter);

      const generations = await db.generationOutputs.findGenerations(filter);

      if (!generations) {
        logger.info('[generationOutputsApi] GET / - No generations found matching criteria or db method returned null/undefined.');
        return res.status(200).json({ generations: [] }); // Return empty array for consistency
      }
      
      logger.info(`[generationOutputsApi] GET / - Found ${generations.length} generation(s).`);
      // The API contract usually expects an object with a key (e.g., "generations") holding the array.
      res.status(200).json({ generations });

    } catch (error) {
      logger.error(`[generationOutputsApi] GET /: Error processing request - ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error retrieving generation outputs.' } });
    }
  });

  // POST / - Logs a new generation task
  router.post('/', async (req, res, next) => {
    logger.info('[generationOutputsApi] POST / - Received request', { body: req.body });

    // Validate required fields from ADR-003
    const { masterAccountId, sessionId, initiatingEventId, serviceName, requestPayload, responsePayload, metadata, requestTimestamp, notificationPlatform, deliveryStatus, deliveryStrategy, status } = req.body;
    const requiredFields = { masterAccountId, sessionId, initiatingEventId, serviceName, requestPayload, notificationPlatform, deliveryStatus };
    for (const field in requiredFields) {
      if (requiredFields[field] === undefined || requiredFields[field] === null) { // Check for undefined or null
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: `Missing required field: ${field}.`, details: { field } } });
      }
    }
    // Validate ObjectIds
    if (!ObjectId.isValid(masterAccountId)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid masterAccountId format.', details: { field: 'masterAccountId' } } });
    if (!ObjectId.isValid(sessionId)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid sessionId format.', details: { field: 'sessionId' } } });
    if (!ObjectId.isValid(initiatingEventId)) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid initiatingEventId format.', details: { field: 'initiatingEventId' } } });
    
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
        sessionId: new ObjectId(sessionId),
        initiatingEventId: new ObjectId(initiatingEventId),
        serviceName: serviceName.trim(),
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
        logger.info(`[generationOutputsApi] POST /: New generation ${newGeneration._id} is ready for delivery, emitting event.`);
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
    logger.info(`[generationOutputsApi] GET /${generationId} - Received request`);

    try {
      const generation = await db.generationOutputs.findGenerationById(generationId);

      if (!generation) {
        logger.warn(`[generationOutputsApi] GET /${generationId}: Generation output not found.`);
        return res.status(404).json({ 
          error: { code: 'NOT_FOUND', message: 'Generation output not found.', details: { generationId: generationId.toString() } } 
        });
      }

      logger.info(`[generationOutputsApi] GET /${generationId}: Generation output found.`);
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

    logger.info(`[generationOutputsApi] PUT /${generationId} - Received request, PAYLOAD:`, { body: updatePayload });

    if (!updatePayload || typeof updatePayload !== 'object' || Object.keys(updatePayload).length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Request body must be a non-empty object containing fields to update.' } });
    }

    // Basic validation (more specific type checks could be added)
    // Example: Check costUsd if present
    if (updatePayload.costUsd !== undefined) {
      // If costUsd is null, set it to 0 for Decimal128 conversion
      if (updatePayload.costUsd === null) {
        updatePayload.costUsd = Decimal128.fromString("0");
      } else {
        try {
          // Ensure it's a string before calling Decimal128.fromString
          Decimal128.fromString(updatePayload.costUsd.toString());
          // Convert to Decimal128 for the update operation
          updatePayload.costUsd = Decimal128.fromString(updatePayload.costUsd.toString());
        } catch (e) {
          return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid costUsd format. Must be convertible to Decimal128.', details: { field: 'costUsd' } } });
        }
      }
    }

    try {
      // The DB method `updateGenerationOutput` handles setting responseTimestamp if status is terminal.
      const updateResult = await db.generationOutputs.updateGenerationOutput(generationId, updatePayload);

      if (!updateResult || updateResult.matchedCount === 0) {
          logger.warn(`[generationOutputsApi] PUT /${generationId}: Generation output not found for update.`);
          return res.status(404).json({ 
              error: { code: 'NOT_FOUND', message: 'Generation output not found.', details: { generationId: generationId.toString() } } 
          });
      }
      
      // Fetch the updated record to return it
      const updatedGeneration = await db.generationOutputs.findGenerationById(generationId);
      if (!updatedGeneration) {
        // Should be rare if update succeeded
        logger.error(`[generationOutputsApi] PUT /${generationId}: Failed to fetch record after update.`);
        throw new Error('Failed to fetch generation output after successful update.');
      }

      // If the generation is complete and pending notification, emit an event
      const isNotificationReady =
        updatedGeneration.deliveryStatus === 'pending' &&
        ['completed', 'failed'].includes(updatedGeneration.status) &&
        updatedGeneration.notificationPlatform !== 'none';

      if (isNotificationReady) {
        logger.info(`[generationOutputsApi] PUT /${generationId}: Generation is ready for delivery, emitting event.`);
        notificationEvents.emit('generationUpdated', updatedGeneration);
      }

      logger.info(`[generationOutputsApi] PUT /${generationId}: Generation output updated successfully.`);
      res.status(200).json(updatedGeneration);

    } catch (error) {
      logger.error(`[generationOutputsApi] PUT /${generationId}: Error processing request - ${error.message}`, error);
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

    logger.info(`[generationOutputsApi] GET /users/${masterAccountId}/most-frequent-tools - Requested limit for DB fetch: ${limit}`);

    try {
      const frequentToolsDataFromDb = await db.generationOutputs.getMostFrequentlyUsedToolsByMasterAccountId(masterAccountId, limit);

      if (!frequentToolsDataFromDb) {
        logger.warn(`[generationOutputsApi] No frequent tools data returned from DB for MAID ${masterAccountId}`);
        return res.status(200).json({ frequentTools: [] });
      }
      
      // The API now returns raw data: toolId and usageCount. Client will handle enrichment and filtering.
      // The objects will be like { toolId: string, usageCount: number }
      logger.info(`[generationOutputsApi] GET /users/${masterAccountId}/most-frequent-tools - Returning ${frequentToolsDataFromDb.length} raw tool usage data entries.`);
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

    logger.info(`[generationOutputsApi] POST /rate_gen/${generationId} - Received request to rate as ${ratingType}`);

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

      logger.info(`[generationOutputsApi] POST /rate_gen/${generationId}: Rating updated successfully.`);
      res.status(200).json({ message: 'Rating updated successfully.' });

    } catch (error) {
      logger.error(`[generationOutputsApi] POST /rate_gen/${generationId}: Error processing request - ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error updating rating.' } });
    }
  });

  logger.info('[generationOutputsApi] Generation Outputs API routes initialized.');
  return router;
}; 