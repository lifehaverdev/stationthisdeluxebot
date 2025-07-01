const express = require('express');
const { ObjectId } = require('mongodb');

// This function initializes the routes for the User Sessions API
module.exports = function userSessionsApi(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router({ mergeParams: true });

  if (!db || !db.userSessions) {
    logger.error('[userSessionsApi] Critical dependency failure: db.userSessions service is missing!');
    // Return a router that reports an error for all requests
    return (req, res, next) => {
        res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserSessions database service is not available.' } });
    };
  }

  logger.info('[userSessionsApi] Initializing User Sessions API routes...');

  // Middleware for validating ObjectId in path parameters
  const validateObjectId = (paramName) => (req, res, next) => {
    const id = req.params[paramName];
    if (!ObjectId.isValid(id)) {
      logger.warn(`[userSessionsApi] Invalid ObjectId format for param '${paramName}': ${id}`);
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: `Invalid format for ${paramName}. Must be a valid ObjectId.` }
      });
    }
    // Store the validated ObjectId in req.locals for convenience, if needed
    if (!req.locals) req.locals = {};
    req.locals[paramName] = new ObjectId(id);
    next();
  };

  const getMasterAccountId = (req, res) => {
    const { masterAccountId: masterAccountIdStr } = req.params;
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
        if (res && !res.headersSent) {
             res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid or missing masterAccountId parameter.' } });
        }
        return null;
    }
    return new ObjectId(masterAccountIdStr);
  };

  //-------------------------------------------------------------------------
  // --- API Endpoint Implementations ---
  //-------------------------------------------------------------------------

  // GET / - List sessions for a user (when mounted under /users/:masterAccountId/sessions)
  router.get('/', async (req, res, next) => {
    const masterAccountId = getMasterAccountId(req, res);
    // If there's no masterAccountId, this might be a request to a different route.
    // Let other handlers for this path (e.g. POST /) take over.
    if (!masterAccountId) {
      return next(); 
    }

    logger.info(`[userSessionsApi] GET / (list) for masterAccountId ${masterAccountId.toString()} with query:`, req.query);
    
    const { status, startDate, endDate, limit, offset } = req.query;

    try {
      const filter = { masterAccountId };
      if (status) {
        filter.status = status;
      }

      const timestampFilter = {};
      if (startDate) {
        const parsedStartDate = new Date(startDate);
        if (isNaN(parsedStartDate.getTime())) {
          return res.status(400).json({ error: { code: 'INVALID_INPUT', message: `Invalid startDate: ${startDate}` } });
        }
        timestampFilter.$gte = parsedStartDate;
      }
      if (endDate) {
        const parsedEndDate = new Date(endDate);
        if (isNaN(parsedEndDate.getTime())) {
          return res.status(400).json({ error: { code: 'INVALID_INPUT', message: `Invalid endDate: ${endDate}` } });
        }
        timestampFilter.$lte = parsedEndDate;
      }
      if (Object.keys(timestampFilter).length > 0) {
        filter.sessionStartTimestamp = timestampFilter;
      }

      const options = { sort: { sessionStartTimestamp: -1 } };
      if (limit) {
        options.limit = parseInt(limit, 10) || 100;
      }
      if (offset) {
        options.skip = parseInt(offset, 10) || 0;
      }

      const sessions = await db.userSessions.findMany(filter, options);

      const formattedSessions = sessions.map(s => ({
        sessionId: s._id,
        createdAt: s.sessionStartTimestamp,
        endedAt: s.sessionEndTimestamp,
        status: s.status,
        toolsUsed: [], // Not tracked in schema
        pointsSpent: 0, // Not tracked in schema
        numGenerations: 0, // Not tracked in schema
      }));
      
      res.status(200).json(formattedSessions);

    } catch (error) {
      logger.error(`[userSessionsApi] Error listing sessions for ${masterAccountId.toString()}:`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Error listing sessions.' } });
    }
  });

  // POST /sessions - Create a new session
  router.post('/', async (req, res, next) => {
    logger.info('[userSessionsApi] POST /sessions - Received request', { body: req.body });

    const { masterAccountId, platform, userAgent, metadata } = req.body;

    // 1. Validate required inputs
    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      logger.warn(`[userSessionsApi] POST /sessions: Invalid or missing masterAccountId. Value: ${masterAccountId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid or missing masterAccountId. Must be a valid ObjectId string.',
          details: { field: 'masterAccountId', value: masterAccountId },
        },
      });
    }

    if (!platform || typeof platform !== 'string' || platform.trim() === '') {
      logger.warn(`[userSessionsApi] POST /sessions: Invalid or missing platform. Value: ${platform}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid or missing platform. Must be a non-empty string.',
          details: { field: 'platform', value: platform },
        },
      });
    }

    // Optional: Validate metadata type if provided
    if (metadata && typeof metadata !== 'object') {
      logger.warn(`[userSessionsApi] POST /sessions: Invalid metadata format. Must be an object. Value: ${JSON.stringify(metadata)}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid metadata format. Must be an object.',
          details: { field: 'metadata' },
        },
      });
    }

    try {
      // 2. Prepare data for DB service
      // The DB service handles setting startTime, isActive, lastUserActivityTimestamp defaults
      const sessionData = {
        masterAccountId: new ObjectId(masterAccountId), // Ensure it's an ObjectId
        platform: platform.trim(),
        // Include optional fields only if they are provided and valid
        ...(userAgent && typeof userAgent === 'string' && { userAgent: userAgent.trim() }),
        ...(metadata && typeof metadata === 'object' && { metadata }),
      };

      logger.debug('[userSessionsApi] POST /sessions: Calling db.userSessions.createSession with data:', sessionData);

      // 3. Call DB service
      const newSession = await db.userSessions.createSession(sessionData);

      if (!newSession || !newSession._id) {
        logger.error('[userSessionsApi] POST /sessions: db.userSessions.createSession returned null or invalid session.');
        return res.status(500).json({
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to create session due to a database service error.',
          },
        });
      }

      logger.info(`[userSessionsApi] POST /sessions: Session created successfully. SessionId: ${newSession._id}`);

      // 4. Return success response
      res.status(201).json(newSession); // ADR: Response: UserSessionObject

    } catch (error) {
      logger.error(`[userSessionsApi] POST /sessions: Error processing request. Error: ${error.message}`, error);
      // Generic error response
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while creating the session.',
        },
      });
    }
  });

  // GET /sessions/{sessionId} - Get session by ID
  router.get('/:sessionId', validateObjectId('sessionId'), async (req, res, next) => {
    const { sessionId } = req.locals; // Use validated ObjectId from middleware
    logger.info(`[userSessionsApi] GET /sessions/${sessionId} - Received request`);

    try {
      const session = await db.userSessions.findSessionById(sessionId);

      if (!session) {
        logger.warn(`[userSessionsApi] GET /sessions/${sessionId}: Session not found.`);
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Session not found.',
            details: { sessionId: sessionId.toString() }, // Use string representation in response
          },
        });
      }

      logger.info(`[userSessionsApi] GET /sessions/${sessionId}: Session found.`);
      res.status(200).json(session); // ADR: Response: UserSessionObject

    } catch (error) {
      logger.error(`[userSessionsApi] GET /sessions/${sessionId}: Error processing request. Error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while retrieving the session.',
        },
      });
    }
  });

  // PUT /sessions/{sessionId}/activity - Update session activity timestamp
  router.put('/:sessionId/activity', validateObjectId('sessionId'), async (req, res, next) => {
    const { sessionId } = req.locals;
    logger.info(`[userSessionsApi] PUT /sessions/${sessionId}/activity - Received request`);

    try {
      // The db.userSessions.updateLastActivity method should handle setting the new timestamp
      const updateResult = await db.userSessions.updateLastActivity(sessionId);

      // updateOne usually returns an object like { matchedCount, modifiedCount, ... }
      // For this operation, we consider it successful if a document was matched.
      // The actual UserSessionObject isn't returned by updateLastActivity by default in the current DB service.
      // ADR-003 doesn't specify a response body for this, so a 200 OK with a success message is appropriate.
      // If no document was matched, it implies the session ID was valid format but not found.
      if (!updateResult || updateResult.matchedCount === 0) {
        logger.warn(`[userSessionsApi] PUT /sessions/${sessionId}/activity: Session not found or not updated.`);
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Session not found or activity not updated. The session may not exist.',
            details: { sessionId: sessionId.toString() },
          },
        });
      }

      // If we want to return the updated session object, we would need to fetch it after update.
      // For now, a 200 OK is sufficient as per typical activity update endpoints.
      logger.info(`[userSessionsApi] PUT /sessions/${sessionId}/activity: Activity timestamp updated successfully.`);
      res.status(200).json({ message: 'Session activity updated successfully.' });

    } catch (error) {
      logger.error(`[userSessionsApi] PUT /sessions/${sessionId}/activity: Error processing request. Error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while updating session activity.',
        },
      });
    }
  });

  // PUT /sessions/{sessionId}/end - End a session
  router.put('/:sessionId/end', validateObjectId('sessionId'), async (req, res, next) => {
    const { sessionId } = req.locals;
    const { endReason, endTime } = req.body; // endTime is optional per ADR

    logger.info(`[userSessionsApi] PUT /sessions/${sessionId}/end - Received request`, { body: req.body });

    // Validate required endReason
    if (!endReason || typeof endReason !== 'string' || endReason.trim() === '') {
      logger.warn(`[userSessionsApi] PUT /sessions/${sessionId}/end: Missing or invalid endReason.`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Missing or invalid endReason in request body. Must be a non-empty string.',
          details: { field: 'endReason' },
        },
      });
    }

    // Optional: Validate endTime if provided
    let parsedEndTime = null;
    if (endTime) {
      parsedEndTime = new Date(endTime);
      if (isNaN(parsedEndTime.getTime())) {
        logger.warn(`[userSessionsApi] PUT /sessions/${sessionId}/end: Invalid endTime format. Value: ${endTime}`);
        return res.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid endTime format. Must be a valid date string (ISO 8601 recommended).',
            details: { field: 'endTime', value: endTime },
          },
        });
      }
    }

    try {
      // The db service method endSession handles setting isActive=false and endTime (defaults to now if not provided)
      // Pass the validated or null endTime to the DB method if necessary (current DB method doesn't accept it, it sets its own)
      // Let's stick to the existing db.userSessions.endSession signature which just takes endReason.
      // If providing custom endTime becomes necessary, the DB method needs updating.
      const updateResult = await db.userSessions.endSession(sessionId, endReason.trim());

      // Check if the session was found and potentially updated
      if (!updateResult || updateResult.matchedCount === 0) {
        logger.warn(`[userSessionsApi] PUT /sessions/${sessionId}/end: Session not found or not ended.`);
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Session not found or could not be ended. The session may not exist.',
            details: { sessionId: sessionId.toString() },
          },
        });
      }

      // ADR-003 doesn't specify a response body. A success message is appropriate.
      logger.info(`[userSessionsApi] PUT /sessions/${sessionId}/end: Session ended successfully. Reason: ${endReason.trim()}`);
      res.status(200).json({ message: 'Session ended successfully.' });

    } catch (error) {
      logger.error(`[userSessionsApi] PUT /sessions/${sessionId}/end: Error processing request. Error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while ending the session.',
        },
      });
    }
  });

  // --- Session Event Listing Endpoint (Moved from userEventsApi) ---
  // GET /sessions/{sessionId}/events - List events for a session
  router.get('/:sessionId/events', validateObjectId('sessionId'), async (req, res, next) => {
    const { sessionId } = req.locals;
    // TODO: Add pagination query params (limit, skip/page, sort)
    logger.info(`[userSessionsApi] GET /sessions/${sessionId}/events - Received request`);

    // Need access to userEvents DB service
    if (!db.userEvents) {
        logger.error(`[userSessionsApi] UserEventsDB service not available for GET /sessions/${sessionId}/events`);
        return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserEvents database service is not available.' } });
    }

    try {
        // Use the DB method, passing sessionId. Add options later for pagination.
        // Note: We previously corrected findEventsBySession in userEventsDb.js to only take sessionId
        const sessionEvents = await db.userEvents.findEventsBySession(sessionId);
        logger.info(`[userSessionsApi] GET /sessions/${sessionId}/events: Found ${sessionEvents.length} events.`);
        res.status(200).json(sessionEvents);
    } catch (error) {
        logger.error(`[userSessionsApi] GET /sessions/${sessionId}/events: Error processing request. Error: ${error.message}`, error);
        res.status(500).json({
            error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while finding session events.' },
        });
    }
  });

  // --- User Specific Session Routes (Moved to userCoreApi) ---
  // These endpoints are defined in ADR-003 under /users/{masterAccountId}/sessions...
  // They were moved to src/api/internal/userCoreApi.js to match the routing pattern.
  // GET /users/{masterAccountId}/sessions
  // GET /users/{masterAccountId}/sessions/active?platform={platform}

  // --- Generation Output Listing Endpoint (Session-Specific) ---
  // GET /sessions/{sessionId}/generations - List generation outputs for a session
  // Note: Uses db.generationOutputs service
  router.get('/:sessionId/generations', validateObjectId('sessionId'), async (req, res, next) => {
    const { sessionId } = req.locals; // Get validated ObjectId from middleware
    logger.info(`[userSessionsApi] GET /sessions/${sessionId}/generations - Received request`);

    // Check dependency
    if (!db.generationOutputs) {
      logger.error(`[userSessionsApi] GenerationOutputsDB service not available for GET /sessions/${sessionId}/generations`);
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'GenerationOutputs database service is not available.' } });
    }

    try {
      // TODO: Add pagination options (limit, skip/page, sort) later via query params
      const sessionGenerations = await db.generationOutputs.findGenerationsBySession(sessionId);
      logger.info(`[userSessionsApi] GET .../generations: Found ${sessionGenerations.length} generations for session ${sessionId}.`);
      res.status(200).json(sessionGenerations); // Returns an array of GenerationOutputObjects
    } catch (error) {
      logger.error(`[userSessionsApi] GET .../generations: Error for session ${sessionId} - ${error.message}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while finding session generation outputs.' }
      });
    }
  });

  logger.info('[userSessionsApi] User Sessions API routes initialized.');
  return router;
}; 