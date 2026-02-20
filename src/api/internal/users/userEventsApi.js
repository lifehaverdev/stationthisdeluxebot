const express = require('express');
const { ObjectId } = require('mongodb');

// This function initializes the routes for the User Events API
module.exports = function userEventsApi(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router();

  if (!db || !db.userEvents) {
    logger.error('[userEventsApi] Critical dependency failure: db.userEvents service is missing!');
    return (req, res, next) => {
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserEvents database service is not available.' } });
    };
  }

  logger.debug('[userEventsApi] Initializing User Events API routes...');

  // Middleware for validating ObjectId in path parameters
  const validateObjectId = (paramName) => (req, res, next) => {
    const id = req.params[paramName];
    if (!ObjectId.isValid(id)) {
      logger.warn(`[userEventsApi] Invalid ObjectId format for param '${paramName}': ${id}`);
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
  //-------------------------------------------------------------------------

  // POST /events - Log a new event
  router.post('/', async (req, res, next) => {
    logger.debug('[userEventsApi] POST /events - Received request', { body: req.body });

    const { masterAccountId, sessionId, eventType, eventData, sourcePlatform, timestamp } = req.body;

    // 1. Validate required inputs
    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid or missing masterAccountId.', details: { field: 'masterAccountId' } } });
    }
    if (!eventType || typeof eventType !== 'string' || eventType.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid or missing eventType.', details: { field: 'eventType' } } });
    }
    if (!eventData || typeof eventData !== 'object') { // eventData is required as per ADR, should be an object
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid or missing eventData. Must be an object.', details: { field: 'eventData' } } });
    }
    if (!sourcePlatform || typeof sourcePlatform !== 'string' || sourcePlatform.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid or missing sourcePlatform.', details: { field: 'sourcePlatform' } } });
    }

    let parsedTimestamp = null;
    if (timestamp) {
      parsedTimestamp = new Date(timestamp);
      if (isNaN(parsedTimestamp.getTime())) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid timestamp format. Must be a valid date string.', details: { field: 'timestamp' } } });
      }
    }

    try {
      const eventDetails = {
        masterAccountId: new ObjectId(masterAccountId),
        ...(sessionId && ObjectId.isValid(sessionId) && { sessionId: new ObjectId(sessionId) }),
        eventType: eventType.trim(),
        eventData: eventData, // Already validated as object
        sourcePlatform: sourcePlatform.trim(),
        ...(parsedTimestamp && { timestamp: parsedTimestamp }), // Add if valid
      };

      const newEvent = await db.userEvents.logEvent(eventDetails);

      if (!newEvent || !newEvent._id) {
        logger.error('[userEventsApi] POST /events: db.userEvents.logEvent returned null or invalid event.');
        return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Failed to log event due to a database service error.' } });
      }

      logger.debug(`[userEventsApi] POST /events: Event logged successfully. EventId: ${newEvent._id}`);
      res.status(201).json(newEvent); // ADR: Response: UserEventObject

    } catch (error) {
      logger.error(`[userEventsApi] POST /events: Error processing request. Error: ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while logging the event.' } });
    }
  });

  // GET /events/{eventId} - Retrieve a specific event
  router.get('/:eventId', validateObjectId('eventId'), async (req, res, next) => {
    const { eventId } = req.locals;
    logger.debug(`[userEventsApi] GET /events/${eventId} - Received request`);

    try {
      const event = await db.userEvents.findEventById(eventId);

      if (!event) {
        logger.warn(`[userEventsApi] GET /events/${eventId}: Event not found.`);
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Event not found.', details: { eventId: eventId.toString() } }
        });
      }

      logger.debug(`[userEventsApi] GET /events/${eventId}: Event found.`);
      res.status(200).json(event);

    } catch (error) {
      logger.error(`[userEventsApi] GET /events/${eventId}: Error processing request. Error: ${error.message}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while retrieving the event.' } });
    }
  });

  // --- Deprecated Session Event Listing Endpoint ---
  // This route is deprecated since sessions have been removed.
  router.get('/:sessionId/events', (req, res) => {
      res.status(410).json({ error: { code: 'GONE', message: 'Session-centric events endpoint has been removed. Sessions are deprecated.' } });
  });

  // --- User/Session Specific Event Routes ---
  // These are defined relative to the mounting point of this router
  // In src/api/internal/index.js, this router is mounted at /internal/v1/data/events
  // ADR-003 implies these should be top-level under /internal/v1/data:
  //   GET /users/{masterAccountId}/events
  //   GET /sessions/{sessionId}/events
  // This requires moving these routes, similar to how user-session routes were moved to userCoreApi.
  // Option A: Move these to userCoreApi and userSessionsApi respectively.
  // Option B: Create separate routers for user-centric and session-centric endpoints under /users and /sessions.
  // Option C: Keep them here but adjust the paths in ADR-003 (e.g., /events/by-user/{masterAccountId}).
  
  // Given the pattern established with user-sessions, Option A seems most consistent.
  // Let's add placeholders here *temporarily* but plan to move them.

  // Placeholder for GET /users/{masterAccountId}/events (To be moved to userCoreApi.js)
  // TODO: Move this endpoint
  // --- ROUTE MOVED --- 
  /* router.get(...) */

  // Placeholder for GET /sessions/{sessionId}/events (To be moved to userSessionsApi.js)
  // TODO: Move this endpoint
  // --- ROUTE MOVED --- 
  /* router.get(...) */

  logger.debug('[userEventsApi] User Events API routes initialized (pending route moves).');
  return router;
}; 