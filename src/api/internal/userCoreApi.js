const express = require('express');
const { v4: uuidv4 } = require('uuid'); // Added for request IDs in errors
const { ObjectId, Decimal128 } = require('mongodb'); // Added for ObjectId validation & Decimal128
const { PRIORITY, getCachedClient } = require('../../core/services/db/utils/queue'); // Import PRIORITY and getCachedClient
const createUserPreferencesApiService = require('./userPreferencesApi'); // Import the new preferences service

/**
 * Creates and configures an Express router for User Core API endpoints.
 * @param {Object} dependencies - Dependencies for the service, expecting 'logger' and 'db'.
 *                                'db' should contain the UserCoreDB service instance.
 * @returns {express.Router} Configured Express router for User Core API.
 */
function createUserCoreApiService(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router();

  if (!db || !db.userCore) {
    logger.error('[userCoreApi] UserCoreDB service not found in dependencies. Endpoints will not function correctly.');
    // Return a router that responds with an error for all paths
    router.use((req, res) => {
      res.status(500).json({ 
        error: { 
          code: 'SERVICE_UNAVAILABLE', 
          message: 'UserCoreDB service is not available. Please check server configuration.' 
        } 
      });
    });
    return router;
  }

  // Middleware to parse JSON bodies
  router.use(express.json());

  // --- User Core Endpoints ---

  // POST /users/find-or-create
  router.post('/find-or-create', async (req, res) => {
    const requestId = uuidv4(); // For error reporting
    logger.info(`[userCoreApi] POST /find-or-create called with body: ${JSON.stringify(req.body)}, requestId: ${requestId}`);
    
    const { platform, platformId, platformContext } = req.body;

    // Validate required inputs
    if (!platform || typeof platform !== 'string' || platform.trim() === '') {
      logger.warn(`[userCoreApi] POST /find-or-create: Missing or invalid 'platform'. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: "Missing or invalid 'platform' in request body. Must be a non-empty string.",
          details: { field: 'platform' },
          requestId: requestId,
        },
      });
    }

    if (!platformId || typeof platformId !== 'string' || platformId.trim() === '') {
      logger.warn(`[userCoreApi] POST /find-or-create: Missing or invalid 'platformId'. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: "Missing or invalid 'platformId' in request body. Must be a non-empty string.",
          details: { field: 'platformId' },
          requestId: requestId,
        },
      });
    }

    try {
      // platformContext is optional and defaults to {} if not provided by findOrCreateByPlatformId
      const { user, isNew: isNewUser } = await db.userCore.findOrCreateByPlatformId(platform, platformId, platformContext || {});

      if (!user || !user._id) {
        // This case should ideally not be reached if findOrCreateByPlatformId behaves as expected (throws or returns user)
        logger.error(`[userCoreApi] POST /find-or-create: findOrCreateByPlatformId returned null or invalid user for ${platform}:${platformId}. requestId: ${requestId}`);
        return res.status(500).json({
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to find or create user due to an unexpected issue with the database service.',
            requestId: requestId,
          },
        });
      }

      // Determine if the user is new.
      // A common heuristic: if userCreationTimestamp and updatedAt are identical (or very close).
      // MongoDB dates have millisecond precision.
      // const isNewUser = user.userCreationTimestamp.getTime() === user.updatedAt.getTime(); // Replaced by direct value from DB service
      const statusCode = isNewUser ? 201 : 200;

      logger.info(`[userCoreApi] POST /find-or-create: User ${isNewUser ? 'created' : 'found'}. MasterAccountId: ${user._id}. Status: ${statusCode}. requestId: ${requestId}`);
      
      res.status(statusCode).json({
        masterAccountId: user._id.toString(), // Ensure ObjectId is converted to string
        user: user, 
        isNewUser: isNewUser,
      });

    } catch (error) {
      logger.error(`[userCoreApi] POST /find-or-create: Error processing request for ${platform}:${platformId}. Error: ${error.message}. requestId: ${requestId}`, error);
      
      // Check if it's a known DB error type that should be a client error, e.g. validation, otherwise 500
      // For now, assuming any catch is a server error unless specifically handled.
      // ADR-003 implies specific error codes, which can be refined if db layer throws custom errors.
      
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while processing your request.',
          details: error.stack ? { stacktrace: error.stack.split('\\n').slice(0,5) } : {}, // Include brief stack in dev/staging if desired
          requestId: requestId,
        },
      });
    }
  });

  // GET /users/{masterAccountId}
  router.get('/:masterAccountId', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId } = req.params;
    logger.info(`[userCoreApi] GET /users/${masterAccountId} called, requestId: ${requestId}`);

    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      logger.warn(`[userCoreApi] GET /users/${masterAccountId}: Invalid masterAccountId format. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid masterAccountId format. Must be a valid MongoDB ObjectId string.',
          details: { field: 'masterAccountId', value: masterAccountId },
          requestId: requestId,
        },
      });
    }

    try {
      const user = await db.userCore.findUserCoreById(masterAccountId);

      if (!user) {
        logger.warn(`[userCoreApi] GET /users/${masterAccountId}: User not found. requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'User not found.',
            details: { masterAccountId: masterAccountId },
            requestId: requestId,
          },
        });
      }

      logger.info(`[userCoreApi] GET /users/${masterAccountId}: User found. requestId: ${requestId}`);
      res.status(200).json(user); // ADR: Response: UserCoreObject

    } catch (error) {
      logger.error(`[userCoreApi] GET /users/${masterAccountId}: Error processing request. Error: ${error.message}. requestId: ${requestId}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while retrieving the user.',
          requestId: requestId,
        },
      });
    }
  });

  // PUT /users/{masterAccountId}
  router.put('/:masterAccountId', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId } = req.params;
    const updatePayload = req.body;

    logger.info(`[userCoreApi] PUT /users/${masterAccountId} called with body: ${JSON.stringify(updatePayload)}, requestId: ${requestId}`);

    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      logger.warn(`[userCoreApi] PUT /users/${masterAccountId}: Invalid masterAccountId format. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid masterAccountId format. Must be a valid MongoDB ObjectId string.',
          details: { field: 'masterAccountId', value: masterAccountId },
          requestId: requestId,
        },
      });
    }

    if (!updatePayload || typeof updatePayload !== 'object' || Object.keys(updatePayload).length === 0) {
      logger.warn(`[userCoreApi] PUT /users/${masterAccountId}: Empty or invalid update payload. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Request body cannot be empty and must be an object containing fields to update.',
          requestId: requestId,
        },
      });
    }

    // Sanitize payload: disallow direct modification of _id, platformIdentities, userCreationTimestamp, etc.
    // ADR implies updating "user core profile" - so focus on profile fields and other mutable fields like status.
    // A more robust solution would use a schema for validation of updatable fields.
    const forbiddenFields = ['_id', 'masterAccountId', 'platformIdentities', 'userCreationTimestamp', 'apiKeys', 'wallets']; // wallets & apiKeys have dedicated endpoints
    for (const field of forbiddenFields) {
      if (updatePayload.hasOwnProperty(field)) {
        logger.warn(`[userCoreApi] PUT /users/${masterAccountId}: Attempt to update forbidden field '${field}'. requestId: ${requestId}`);
        return res.status(400).json({
          error: {
            code: 'FORBIDDEN_FIELD_UPDATE',
            message: `Direct update of field '${field}' is not allowed via this endpoint.`,
            details: { field: field },
            requestId: requestId,
          },
        });
      }
    }

    try {
      // Construct the $set operation from the request body
      // Ensure nested objects like 'profile' are correctly set, e.g., body { profile: { displayName: "x" } } -> $set: { "profile.displayName": "x" }
      // However, updateUserCore expects a direct $set, so we simply pass it as { $set: updatePayload } after validation.
      // For more granular control (e.g. updating profile.displayName only), the client would send { "profile.displayName": "new name" }
      // If the client sends { "profile": { "displayName": "new name" } }, that will replace the whole profile object.
      // The ADR states "Request: UserCoreObject (partial for updates)", suggesting the latter structure.
      // To handle this properly with $set, we'd need to flatten the payload or use a more specific update method.
      // Given userCoreDb.updateUserCore expects full update ops, let's assume the client sends a direct $set compatible payload for now,
      // OR we build it carefully.
      // Let's build a $set object from the top-level keys in updatePayload for simplicity as a starting point.

      const updateOperations = { $set: {} };
      for (const key in updatePayload) {
        if (updatePayload.hasOwnProperty(key)) {
          updateOperations.$set[key] = updatePayload[key];
        }
      }

      if (Object.keys(updateOperations.$set).length === 0) {
        logger.warn(`[userCoreApi] PUT /users/${masterAccountId}: No valid fields to update after filtering. requestId: ${requestId}`);
        // Or, fetch and return the current user with a 200 OK if no actual change is requested.
        // For now, treat as a bad request if payload leads to no-op after filtering forbidden fields.
         return res.status(400).json({
          error: {
            code: 'NO_OP_UPDATE',
            message: 'Update payload resulted in no valid fields to update after filtering forbidden fields.',
            requestId: requestId,
          },
        });
      }

      const updatedUser = await db.userCore.updateUserCore(masterAccountId, updateOperations);

      if (!updatedUser) {
        logger.warn(`[userCoreApi] PUT /users/${masterAccountId}: User not found or update failed. requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND_OR_UPDATE_FAILED',
            message: 'User not found, or the update operation failed.',
            details: { masterAccountId: masterAccountId },
            requestId: requestId,
          },
        });
      }

      logger.info(`[userCoreApi] PUT /users/${masterAccountId}: User updated successfully. requestId: ${requestId}`);
      res.status(200).json(updatedUser); // ADR: Response: Updated UserCoreObject

    } catch (error) {
      logger.error(`[userCoreApi] PUT /users/${masterAccountId}: Error processing update. Error: ${error.message}. requestId: ${requestId}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while updating the user.',
          requestId: requestId,
        },
      });
    }
  });

  // GET /users/by-platform/{platform}/{platformId}
  router.get('/by-platform/:platform/:platformId', async (req, res) => {
    const requestId = uuidv4();
    const { platform, platformId } = req.params;
    logger.info(`[userCoreApi] GET /by-platform/${platform}/${platformId} called, requestId: ${requestId}`);

    if (!platform || typeof platform !== 'string' || platform.trim() === '') {
      logger.warn(`[userCoreApi] GET /by-platform/${platform}/${platformId}: Missing or invalid 'platform'. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: "Missing or invalid 'platform' path parameter. Must be a non-empty string.",
          details: { field: 'platform' },
          requestId: requestId,
        },
      });
    }

    if (!platformId || typeof platformId !== 'string' || platformId.trim() === '') {
      logger.warn(`[userCoreApi] GET /by-platform/${platform}/${platformId}: Missing or invalid 'platformId'. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: "Missing or invalid 'platformId' path parameter. Must be a non-empty string.",
          details: { field: 'platformId' },
          requestId: requestId,
        },
      });
    }

    try {
      const user = await db.userCore.findUserCoreByPlatformId(platform, platformId);

      if (!user) {
        logger.warn(`[userCoreApi] GET /by-platform/${platform}/${platformId}: User not found. requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'User not found for the given platform and platformId.',
            details: { platform, platformId },
            requestId: requestId,
          },
        });
      }

      logger.info(`[userCoreApi] GET /by-platform/${platform}/${platformId}: User found. MasterAccountId: ${user._id}. requestId: ${requestId}`);
      res.status(200).json(user); // ADR: Response: UserCoreObject

    } catch (error) {
      logger.error(`[userCoreApi] GET /by-platform/${platform}/${platformId}: Error processing request. Error: ${error.message}. requestId: ${requestId}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while retrieving the user by platform ID.',
          requestId: requestId,
        },
      });
    }
  });

  // Catch-all for other malformed GET requests under /by-platform/
  // This MUST be defined AFTER the more specific /by-platform/:platform/:platformId route
  router.get('/by-platform/*', (req, res) => {
    const requestId = uuidv4();
    // req.path here will be relative to where the router is mounted, 
    // so for a request to /internal/v1/data/users/by-platform/testPlatform/,
    // req.path within this router would be /by-platform/testPlatform/
    const actualPath = req.originalUrl; // Use originalUrl to show the full problematic path in logs/errors
    logger.warn(`[userCoreApi] GET ${actualPath}: Malformed path. Expected /by-platform/:platform/:platformId with non-empty platform and platformId. requestId: ${requestId}`);
    res.status(400).json({
      error: {
        code: 'INVALID_PATH_PARAMETERS',
        message: 'Malformed path for /by-platform/. Expecting /by-platform/{platform}/{platformId} with non-empty string values for platform and platformId.',
        details: { receivedPath: actualPath },
        requestId: requestId,
      },
    });
  });

  // --- User Session Endpoints (Related to User) ---

  // GET /users/{masterAccountId}/sessions - List ALL user sessions
  // Note: This route now lives in userCoreApi but uses db.userSessions
  router.get('/:masterAccountId/sessions', async (req, res, next) => {
    const { masterAccountId: masterAccountIdStr } = req.params; // Get ID string from params
    logger.info(`[userCoreApi] GET /users/${masterAccountIdStr}/sessions - Received request (fetching all sessions)`);

    // Inline validation for masterAccountId
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
      logger.warn(`[userCoreApi] GET /users/${masterAccountIdStr}/sessions: Invalid masterAccountId format.`);
       return res.status(400).json({
         error: { code: 'INVALID_INPUT', message: 'Invalid masterAccountId format. Must be a valid ObjectId.', details: { value: masterAccountIdStr } }
       });
    }
    const masterAccountId = new ObjectId(masterAccountIdStr); // Convert to ObjectId for DB query

    if (!db.userSessions) {
      logger.error(`[userCoreApi] UserSessionsDB service not available for GET /users/${masterAccountIdStr}/sessions`);
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserSessions database service is not available.' } });
    }

    try {
      const sessions = await db.userSessions.findMany({ masterAccountId: masterAccountId }); // Use ObjectId
      logger.info(`[userCoreApi] GET /users/${masterAccountIdStr}/sessions: Found ${sessions.length} sessions.`);
      res.status(200).json(sessions);
    } catch (error) {
      logger.error(`[userCoreApi] GET /users/${masterAccountIdStr}/sessions: Error processing request. Error: ${error.message}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while finding user sessions.' },
      });
    }
  });

  // GET /users/{masterAccountId}/sessions/active - Find active user sessions by platform
  // Note: This route now lives in userCoreApi but uses db.userSessions
  router.get('/:masterAccountId/sessions/active', async (req, res, next) => {
    const { masterAccountId: masterAccountIdStr } = req.params; // Get ID string from params
    const platform = req.query.platform;
    logger.info(`[userCoreApi] GET /users/${masterAccountIdStr}/sessions/active?platform=${platform} - Received request`);

    // Inline validation for masterAccountId
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
        logger.warn(`[userCoreApi] GET /users/${masterAccountIdStr}/sessions/active: Invalid masterAccountId format.`);
        return res.status(400).json({
         error: { code: 'INVALID_INPUT', message: 'Invalid masterAccountId format. Must be a valid ObjectId.', details: { value: masterAccountIdStr } }
        });
    }
    const masterAccountId = new ObjectId(masterAccountIdStr); // Convert to ObjectId for DB query

    if (!db.userSessions) {
      logger.error(`[userCoreApi] UserSessionsDB service not available for GET /users/${masterAccountIdStr}/sessions/active`);
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserSessions database service is not available.' } });
    }

    if (!platform || typeof platform !== 'string' || platform.trim() === '') {
      logger.warn(`[userCoreApi] GET /users/${masterAccountIdStr}/sessions/active: Missing or invalid platform query parameter.`);
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Missing or invalid \'platform\' query parameter. Must be a non-empty string.', details: { field: 'platform', value: platform } },
      });
    }

    try {
      const activeSessions = await db.userSessions.findActiveSessionsByUserAndPlatform(masterAccountId, platform.trim()); // Use ObjectId
      logger.info(`[userCoreApi] GET /users/${masterAccountIdStr}/sessions/active?platform=${platform}: Found ${activeSessions.length} active sessions.`);
      res.status(200).json(activeSessions);
    } catch (error) {
      logger.error(`[userCoreApi] GET /users/${masterAccountIdStr}/sessions/active?platform=${platform}: Error processing request. Error: ${error.message}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while finding active sessions.' },
      });
    }
  });

  // --- User Event Listing Endpoint ---
  // GET /users/{masterAccountId}/events - List events for a user
  // Note: Uses db.userEvents service
  router.get('/:masterAccountId/events', async (req, res, next) => {
      const { masterAccountId: masterAccountIdStr } = req.params; // Get ID string from params
      logger.info(`[userCoreApi] GET /users/${masterAccountIdStr}/events - Received request`);

      // Inline validation for masterAccountId
      if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
        logger.warn(`[userCoreApi] GET /users/${masterAccountIdStr}/events: Invalid masterAccountId format.`);
         return res.status(400).json({
           error: { code: 'INVALID_INPUT', message: 'Invalid masterAccountId format. Must be a valid ObjectId.', details: { value: masterAccountIdStr } }
         });
      }
      const masterAccountId = new ObjectId(masterAccountIdStr); // Convert to ObjectId for DB query

      if (!db.userEvents) {
        logger.error(`[userCoreApi] UserEventsDB service not available for GET /users/${masterAccountIdStr}/events`);
        return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserEvents database service is not available.' } });
      }

      try {
        // Use the DB method, passing masterAccountId. Add options later for pagination.
        const userEvents = await db.userEvents.findEventsByMasterAccount(masterAccountId); // Use ObjectId
        logger.info(`[userCoreApi] GET /users/${masterAccountIdStr}/events: Found ${userEvents.length} events.`);
        res.status(200).json(userEvents); // Returns an array of UserEventObjects
      } catch (error) {
        logger.error(`[userCoreApi] GET /users/${masterAccountIdStr}/events: Error processing request. Error: ${error.message}`, error);
        res.status(500).json({
          error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while finding user events.' },
        });
      }
  });

  // --- User Economy Endpoints ---
  // Base path: /users/{masterAccountId}/economy

  // GET /users/{masterAccountId}/economy - Retrieves user economy record
  router.get('/:masterAccountId/economy', async (req, res, next) => {
    const { masterAccountId: masterAccountIdStr } = req.params; // Get ID string from params
    logger.info(`[userCoreApi] GET /users/${masterAccountIdStr}/economy - Received request`);

    // Inline validation for masterAccountId
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
      logger.warn(`[userCoreApi] GET /users/${masterAccountIdStr}/economy: Invalid masterAccountId format.`);
       return res.status(400).json({
         error: { code: 'INVALID_INPUT', message: 'Invalid masterAccountId format. Must be a valid ObjectId.', details: { value: masterAccountIdStr } }
       });
    }
    const masterAccountId = new ObjectId(masterAccountIdStr); // Convert to ObjectId for DB query

    // Check dependency
    if (!db.userEconomy) {
      logger.error(`[userCoreApi] UserEconomyDB service not available for GET /users/${masterAccountIdStr}/economy`);
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserEconomy database service is not available.' } });
    }

    try {
      const economyRecord = await db.userEconomy.findByMasterAccountId(masterAccountId);

      if (!economyRecord) {
        logger.warn(`[userCoreApi] GET /users/${masterAccountIdStr}/economy: Economy record not found.`);
        return res.status(404).json({
          error: {
            code: 'ECONOMY_RECORD_NOT_FOUND',
            message: 'User economy record not found for the given masterAccountId.',
            details: { masterAccountId: masterAccountIdStr },
          },
        });
      }

      logger.info(`[userCoreApi] GET /users/${masterAccountIdStr}/economy: Economy record found.`);
      res.status(200).json(economyRecord);

    } catch (error) {
      logger.error(`[userCoreApi] GET /users/${masterAccountIdStr}/economy: Error processing request. Error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while retrieving the user economy record.',
        },
      });
    }
  });

  // POST /users/{masterAccountId}/economy/credit (Placeholder)
  router.post('/:masterAccountId/economy/credit', async (req, res, next) => {
    const { masterAccountId: masterAccountIdStr } = req.params;
    const { amountUsd, description, transactionType, relatedItems, externalTransactionId } = req.body;
    const requestId = uuidv4(); // For logging/tracing

    logger.info(`[userCoreApi] POST /users/${masterAccountIdStr}/economy/credit - RequestId: ${requestId}`, { body: req.body });

    // --- Input Validation --- 
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid masterAccountId format.', requestId } });
    }
    const masterAccountId = new ObjectId(masterAccountIdStr);

    if (amountUsd === undefined || amountUsd === null) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing required field: amountUsd.', details: { field: 'amountUsd' }, requestId } });
    }
    if (!description || typeof description !== 'string' || description.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing or invalid field: description (must be non-empty string).', details: { field: 'description' }, requestId } });
    }
    if (!transactionType || typeof transactionType !== 'string' || transactionType.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing or invalid field: transactionType (must be non-empty string).', details: { field: 'transactionType' }, requestId } });
    }

    let amountUsdDecimal;
    try {
      amountUsdDecimal = Decimal128.fromString(amountUsd.toString());
      // Ensure amount is positive for credit
      if (parseFloat(amountUsdDecimal.toString()) <= 0) { 
          return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid amountUsd: must be a positive value for credit operations.', details: { field: 'amountUsd', value: amountUsd }, requestId } });
      }
    } catch (e) {
      logger.warn(`[userCoreApi] POST /credit: Invalid amountUsd format. Value: ${amountUsd}. RequestId: ${requestId}`, e);
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid amountUsd format: must be a valid number or numeric string.', details: { field: 'amountUsd', value: amountUsd }, requestId } });
    }

    // Check dependencies
    if (!db.userEconomy || !db.transactions) {
        logger.error(`[userCoreApi] POST /credit: Missing required DB services (UserEconomyDB or TransactionsDB). RequestId: ${requestId}`);
        return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Required database services are unavailable.', requestId } });
    }

    // --- Transaction Logic --- 
    let client;
    let session;
    let createdTransaction = null;
    let finalEconomyRecord = null;

    try {
      client = await getCachedClient();
      session = client.startSession();

      logger.info(`[userCoreApi] POST /credit: Starting transaction. RequestId: ${requestId}`);

      await session.withTransaction(async (sess) => {
        // 1. Get current economy record (or create if needed)
        let currentEconomy = await db.userEconomy.findByMasterAccountId(masterAccountId, sess);
        let balanceBeforeUsd;

        if (!currentEconomy) {
          logger.info(`[userCoreApi] POST /credit: No existing economy record found for ${masterAccountIdStr}, creating one. RequestId: ${requestId}`);
          currentEconomy = await db.userEconomy.createUserEconomyRecord(masterAccountId, '0', 0, sess);
          if (!currentEconomy) {
              // This should be unlikely if insertOne works, but handle defensively
              throw new Error('Failed to create initial economy record within transaction.');
          }
          balanceBeforeUsd = Decimal128.fromString('0'); 
        } else {
          balanceBeforeUsd = currentEconomy.usdCredit; // This is already Decimal128
        }

        // 2. Update credit
        const updateResult = await db.userEconomy.updateUsdCredit(masterAccountId, amountUsdDecimal.toString(), sess);
        if (!updateResult || updateResult.matchedCount === 0) {
             // Should not happen if we created the record, implies concurrent deletion or other issue.
             throw new Error('Failed to match user economy record for credit update within transaction.');
        }
        if (updateResult.modifiedCount === 0) {
             // This might happen if the balance didn't actually change, but $inc should always modify if matched.
             logger.warn(`[userCoreApi] POST /credit: User economy record matched but not modified during credit update. RequestId: ${requestId}`);
        }
        
        // 3. Calculate balanceAfter
        // Convert Decimal128 to numbers for calculation, then back to Decimal128
        const balanceAfterUsd = Decimal128.fromString((parseFloat(balanceBeforeUsd.toString()) + parseFloat(amountUsdDecimal.toString())).toString());

        // 4. Log Transaction
        const txData = {
          masterAccountId,
          type: transactionType.trim(),
          description: description.trim(),
          amountUsd: amountUsdDecimal, // Already Decimal128
          balanceBeforeUsd: balanceBeforeUsd, // Already Decimal128
          balanceAfterUsd: balanceAfterUsd, // Calculated Decimal128
          // Optional fields
          ...(relatedItems && { relatedItems }),
          ...(externalTransactionId && { externalTransactionId })
          // timestamp will be added by logTransaction method
        };

        createdTransaction = await db.transactions.logTransaction(txData, sess);
        if (!createdTransaction) {
             throw new Error('Failed to log transaction within database transaction.');
        }

        // 5. Get final economy state (optional, could construct from balanceAfterUsd)
        // Fetching ensures we return the full, latest record including updatedAt.
        finalEconomyRecord = await db.userEconomy.findByMasterAccountId(masterAccountId, sess);
        if (!finalEconomyRecord) {
            // Very unlikely if previous steps succeeded
            throw new Error('Failed to fetch final economy record after successful transaction operations.');
        }

        logger.info(`[userCoreApi] POST /credit: Transaction successful. TxId: ${createdTransaction._id}. RequestId: ${requestId}`);
        
      }); // End of withTransaction

      // If withTransaction completes without error, the transaction is committed.
      res.status(200).json({ 
          updatedEconomy: finalEconomyRecord, 
          transaction: createdTransaction 
      });

    } catch (error) {
      logger.error(`[userCoreApi] POST /credit: Transaction failed for user ${masterAccountIdStr}. Error: ${error.message}. RequestId: ${requestId}`, error);
      // Determine error type
      if (error.message.includes('Failed to match') || error.message.includes('Failed to create') || error.message.includes('Failed to log') || error.message.includes('Failed to fetch')) {
           // Specific errors from our transaction logic
           res.status(500).json({ error: { code: 'TRANSACTION_LOGIC_ERROR', message: `Internal error during transaction: ${error.message}`, requestId } });
      } else if (error.hasOwnProperty('errorLabels') && error.errorLabels.includes('TransientTransactionError')) {
          // Suggest retry for transient errors
          logger.warn(`[userCoreApi] POST /credit: Transient transaction error for user ${masterAccountIdStr}. RequestId: ${requestId}`);
          res.status(503).json({ error: { code: 'TRANSIENT_TRANSACTION_ERROR', message: 'Database conflict, please retry the operation.', requestId } });
      } else {
          // Other potential errors (e.g., network, unexpected DB state)
          res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred during the credit operation.', requestId } });
      }
    } finally {
        if (session) {
            await session.endSession();
            logger.info(`[userCoreApi] POST /credit: Session ended. RequestId: ${requestId}`);
        }
    }
  });

  // POST /users/{masterAccountId}/economy/debit (Placeholder)
  router.post('/:masterAccountId/economy/debit', async (req, res, next) => {
    const { masterAccountId: masterAccountIdStr } = req.params;
    const { amountUsd, description, transactionType, relatedItems } = req.body;
    const requestId = uuidv4();

    logger.info(`[userCoreApi] POST /users/${masterAccountIdStr}/economy/debit - RequestId: ${requestId}`, { body: req.body });

    // --- Input Validation --- 
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid masterAccountId format.', requestId } });
    }
    const masterAccountId = new ObjectId(masterAccountIdStr);

    if (amountUsd === undefined || amountUsd === null) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing required field: amountUsd.', details: { field: 'amountUsd' }, requestId } });
    }
    if (!description || typeof description !== 'string' || description.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing or invalid field: description (must be non-empty string).', details: { field: 'description' }, requestId } });
    }
    if (!transactionType || typeof transactionType !== 'string' || transactionType.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing or invalid field: transactionType (must be non-empty string).', details: { field: 'transactionType' }, requestId } });
    }

    let amountUsdDecimal;
    try {
      amountUsdDecimal = Decimal128.fromString(amountUsd.toString());
      // Ensure amount is positive for debit (we apply it negatively)
      if (parseFloat(amountUsdDecimal.toString()) <= 0) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid amountUsd: must be a positive value for debit operations.', details: { field: 'amountUsd', value: amountUsd }, requestId } });
      }
    } catch (e) {
      logger.warn(`[userCoreApi] POST /debit: Invalid amountUsd format. Value: ${amountUsd}. RequestId: ${requestId}`, e);
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid amountUsd format: must be a valid number or numeric string.', details: { field: 'amountUsd', value: amountUsd }, requestId } });
    }

    // Check dependencies
    if (!db.userEconomy || !db.transactions) {
      logger.error(`[userCoreApi] POST /debit: Missing required DB services (UserEconomyDB or TransactionsDB). RequestId: ${requestId}`);
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Required database services are unavailable.', requestId } });
    }

    // --- Transaction Logic --- 
    let client;
    let session;
    let createdTransaction = null;
    let finalEconomyRecord = null;

    try {
      client = await getCachedClient();
      session = client.startSession();

      logger.info(`[userCoreApi] POST /debit: Starting transaction. RequestId: ${requestId}`);

      await session.withTransaction(async (sess) => {
        // 1. Get current economy record
        const currentEconomy = await db.userEconomy.findByMasterAccountId(masterAccountId, sess);
        let balanceBeforeUsd;

        if (!currentEconomy || !currentEconomy.usdCredit) {
          // If no record or no credit field, treat balance as 0
          logger.warn(`[userCoreApi] POST /debit: No existing economy record or credit field for ${masterAccountIdStr}. Balance treated as 0. RequestId: ${requestId}`);
          balanceBeforeUsd = Decimal128.fromString('0'); 
        } else {
          balanceBeforeUsd = currentEconomy.usdCredit; // Decimal128
        }

        const balanceBeforeFloat = parseFloat(balanceBeforeUsd.toString());
        const amountToDebitFloat = parseFloat(amountUsdDecimal.toString());

        // 2. Check for sufficient funds
        if (balanceBeforeFloat < amountToDebitFloat) {
          logger.warn(`[userCoreApi] POST /debit: Insufficient funds for user ${masterAccountIdStr}. Balance: ${balanceBeforeFloat}, Debit Amount: ${amountToDebitFloat}. RequestId: ${requestId}`);
          // Throw a specific error to be caught outside withTransaction
          const insufficientFundsError = new Error('Insufficient funds.');
          insufficientFundsError.code = 'INSUFFICIENT_FUNDS';
          insufficientFundsError.details = { 
              currentBalance: balanceBeforeFloat.toFixed(2), // Use appropriate precision
              debitAmount: amountToDebitFloat.toFixed(2) 
          };
          throw insufficientFundsError; 
        }

        // 3. Update debit (use negative amount with updateUsdCredit)
        const negativeAmountStr = (-amountToDebitFloat).toString();
        const updateResult = await db.userEconomy.updateUsdCredit(masterAccountId, negativeAmountStr, sess);
        if (!updateResult || updateResult.matchedCount === 0) {
            // Should not happen if balance check passed (implies record existed)
            throw new Error('Failed to match user economy record for debit update within transaction.');
        }
        if (updateResult.modifiedCount === 0) {
            logger.warn(`[userCoreApi] POST /debit: User economy record matched but not modified during debit update. RequestId: ${requestId}`);
        }

        // 4. Calculate balanceAfter
        const balanceAfterUsd = Decimal128.fromString((balanceBeforeFloat - amountToDebitFloat).toString());

        // 5. Log Transaction
        const txData = {
          masterAccountId,
          type: transactionType.trim(),
          description: description.trim(),
          // Log the positive amount that was debited
          amountUsd: amountUsdDecimal, 
          balanceBeforeUsd: balanceBeforeUsd,
          balanceAfterUsd: balanceAfterUsd,
          // Optional fields
          ...(relatedItems && { relatedItems })
          // externalTransactionId is not typically needed for debits from our system
        };

        createdTransaction = await db.transactions.logTransaction(txData, sess);
        if (!createdTransaction) {
          throw new Error('Failed to log transaction within database transaction.');
        }

        // 6. Get final economy state
        finalEconomyRecord = await db.userEconomy.findByMasterAccountId(masterAccountId, sess);
        if (!finalEconomyRecord) {
          throw new Error('Failed to fetch final economy record after successful transaction operations.');
        }

        logger.info(`[userCoreApi] POST /debit: Transaction successful. TxId: ${createdTransaction._id}. RequestId: ${requestId}`);

      }); // End of withTransaction

      // Success: Transaction committed
      res.status(200).json({
        updatedEconomy: finalEconomyRecord,
        transaction: createdTransaction
      });

    } catch (error) {
      logger.error(`[userCoreApi] POST /debit: Transaction failed for user ${masterAccountIdStr}. Error: ${error.message}. RequestId: ${requestId}`, error);
      
      // Handle specific insufficient funds error
      if (error.code === 'INSUFFICIENT_FUNDS') {
           res.status(400).json({ error: { code: 'INSUFFICIENT_FUNDS', message: error.message, details: error.details, requestId } });
      } else if (error.message.includes('Failed to match') || error.message.includes('Failed to log') || error.message.includes('Failed to fetch')) {
           res.status(500).json({ error: { code: 'TRANSACTION_LOGIC_ERROR', message: `Internal error during transaction: ${error.message}`, requestId } });
      } else if (error.hasOwnProperty('errorLabels') && error.errorLabels.includes('TransientTransactionError')) {
           logger.warn(`[userCoreApi] POST /debit: Transient transaction error for user ${masterAccountIdStr}. RequestId: ${requestId}`);
           res.status(503).json({ error: { code: 'TRANSIENT_TRANSACTION_ERROR', message: 'Database conflict, please retry the operation.', requestId } });
      } else {
           res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred during the debit operation.', requestId } });
      }
    } finally {
      if (session) {
        await session.endSession();
        logger.info(`[userCoreApi] POST /debit: Session ended. RequestId: ${requestId}`);
      }
    }
  });

  // PUT /users/{masterAccountId}/economy/exp (Placeholder)
  router.put('/:masterAccountId/economy/exp', async (req, res, next) => {
    const { masterAccountId: masterAccountIdStr } = req.params;
    const { expChange, description } = req.body; // description is optional for now
    const requestId = uuidv4();

    logger.info(`[userCoreApi] PUT /users/${masterAccountIdStr}/economy/exp - RequestId: ${requestId}`, { body: req.body });

    // --- Input Validation --- 
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid masterAccountId format.', requestId } });
    }
    const masterAccountId = new ObjectId(masterAccountIdStr);

    if (expChange === undefined || expChange === null) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing required field: expChange.', details: { field: 'expChange' }, requestId } });
    }
    
    let expChangeInt;
    try {
      // Ensure it's a whole number (integer)
      if (!Number.isInteger(Number(expChange))) {
        throw new Error('expChange must be an integer.');
      }
      expChangeInt = parseInt(expChange, 10);
    } catch (e) {
      logger.warn(`[userCoreApi] PUT /exp: Invalid expChange format. Value: ${expChange}. RequestId: ${requestId}`, e);
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid expChange format: must be a valid integer.', details: { field: 'expChange', value: expChange }, requestId } });
    }

    // Check dependency
    if (!db.userEconomy) {
      logger.error(`[userCoreApi] PUT /exp: Missing UserEconomyDB service. RequestId: ${requestId}`);
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'UserEconomy database service is unavailable.', requestId } });
    }

    // --- Update Logic --- 
    try {
      // 1. Attempt to update experience points
      // We don't need an explicit transaction here unless we add transaction logging for EXP changes later.
      const updateResult = await db.userEconomy.updateExperience(masterAccountId, expChangeInt);

      if (!updateResult || updateResult.matchedCount === 0) {
        // This implies the user doesn't have an economy record yet.
        // Should we create one? Let's return 404 for now, consistent with GET.
        logger.warn(`[userCoreApi] PUT /exp: User economy record not found for ${masterAccountIdStr} during update attempt. RequestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'ECONOMY_RECORD_NOT_FOUND',
            message: 'User economy record not found. Cannot update EXP.',
            details: { masterAccountId: masterAccountIdStr },
            requestId
          }
        });
      }

      // Optional: log if modifiedCount is 0, although $inc should usually modify.
      if (updateResult.modifiedCount === 0) {
          logger.warn(`[userCoreApi] PUT /exp: User economy record matched but not modified during EXP update. expChange was ${expChangeInt}. RequestId: ${requestId}`);
      }

      // 2. Fetch the updated record to return it
      const updatedEconomyRecord = await db.userEconomy.findByMasterAccountId(masterAccountId);
      if (!updatedEconomyRecord) {
          // Should be very unlikely if the update succeeded
          logger.error(`[userCoreApi] PUT /exp: Failed to fetch economy record after successful update for ${masterAccountIdStr}. RequestId: ${requestId}`);
          return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve economy record after update.', requestId } });
      }

      logger.info(`[userCoreApi] PUT /exp: EXP updated successfully for ${masterAccountIdStr}. New EXP: ${updatedEconomyRecord.exp}. RequestId: ${requestId}`);
      res.status(200).json(updatedEconomyRecord); // Return updated UserEconomyObject

    } catch (error) {
      logger.error(`[userCoreApi] PUT /exp: Error processing EXP update for user ${masterAccountIdStr}. Error: ${error.message}. RequestId: ${requestId}`, error);
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred during the EXP update.', requestId } });
    }
  });

  // --- Wallet Endpoints ---
  // Base path for these will be /users/{masterAccountId}/wallets

  // POST /users/{masterAccountId}/wallets
  router.post('/:masterAccountId/wallets', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId } = req.params;
    const walletData = req.body;

    logger.info(`[userCoreApi] POST /users/${masterAccountId}/wallets called with body: ${JSON.stringify(walletData)}, requestId: ${requestId}`);

    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      logger.warn(`[userCoreApi] POST /users/${masterAccountId}/wallets: Invalid masterAccountId. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid masterAccountId format. Must be a valid MongoDB ObjectId string.',
          details: { field: 'masterAccountId', value: masterAccountId },
          requestId: requestId,
        },
      });
    }

    if (!walletData || typeof walletData !== 'object' || Object.keys(walletData).length === 0) {
      logger.warn(`[userCoreApi] POST /users/${masterAccountId}/wallets: Empty or invalid wallet data payload. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Request body cannot be empty and must be an object containing wallet data.',
          requestId: requestId,
        },
      });
    }

    // Validate required wallet fields (e.g., address)
    if (!walletData.address || typeof walletData.address !== 'string' || walletData.address.trim() === '') {
      logger.warn(`[userCoreApi] POST /users/${masterAccountId}/wallets: Missing or invalid 'address' in wallet data. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_WALLET_DATA',
          message: "Missing or invalid 'address' in wallet data. Must be a non-empty string.",
          details: { field: 'address' },
          requestId: requestId,
        },
      });
    }

    // Optional: further validation for other fields like isPrimary (boolean), verified (boolean), etc.
    // For example:
    // if (walletData.hasOwnProperty('isPrimary') && typeof walletData.isPrimary !== 'boolean') { ... }
    // if (walletData.hasOwnProperty('verified') && typeof walletData.verified !== 'boolean') { ... }

    try {
      // The addWallet method in userCoreDb already sets defaults for addedAt, verified, isPrimary.
      // It expects walletData to contain fields like 'address', etc.
      const updatedUser = await db.userCore.addWallet(masterAccountId, walletData);

      if (!updatedUser) {
        // This typically means the masterAccountId was valid format but user not found
        logger.warn(`[userCoreApi] POST /users/${masterAccountId}/wallets: User not found. requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found with the provided masterAccountId.',
            details: { masterAccountId: masterAccountId },
            requestId: requestId,
          },
        });
      }

      // Successfully added wallet, return updated user object.
      // ADR: Response: Updated UserCoreObject or confirmation. We return the updated UserCoreObject.
      // A 201 might be more appropriate if we considered adding a wallet as creating a sub-resource.
      // However, since we return the whole updated user, 200 OK is also common.
      // Let's go with 200 OK for now, consistent with updateUserCore.
      logger.info(`[userCoreApi] POST /users/${masterAccountId}/wallets: Wallet added successfully. requestId: ${requestId}`);
      res.status(200).json(updatedUser);

    } catch (error) {
      // Log the detailed error for server-side inspection
      logger.error(`[userCoreApi] POST /users/${masterAccountId}/wallets: Error adding wallet. Error: ${error.message}. requestId: ${requestId}`, error);
      
      // Generic error for the client
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while adding the wallet.',
          requestId: requestId,
        },
      });
    }
  });

  // PUT /users/{masterAccountId}/wallets/{address}
  router.put('/:masterAccountId/wallets/:address', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId, address: walletAddressToUpdate } = req.params;
    const updatePayload = req.body;

    logger.info(`[userCoreApi] PUT /users/${masterAccountId}/wallets/${walletAddressToUpdate} called with body: ${JSON.stringify(updatePayload)}, requestId: ${requestId}`);

    // Validate masterAccountId
    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      logger.warn(`[userCoreApi] PUT .../${walletAddressToUpdate}: Invalid masterAccountId. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_MASTER_ACCOUNT_ID',
          message: 'Invalid masterAccountId format. Must be a valid MongoDB ObjectId string.',
          details: { field: 'masterAccountId', value: masterAccountId },
          requestId: requestId,
        },
      });
    }

    // Validate walletAddressToUpdate
    if (!walletAddressToUpdate || typeof walletAddressToUpdate !== 'string' || walletAddressToUpdate.trim() === '') {
      logger.warn(`[userCoreApi] PUT /users/${masterAccountId}/wallets/...: Missing or invalid wallet address in path. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_WALLET_ADDRESS_PARAM',
          message: 'Wallet address in path parameter must be a non-empty string.',
          details: { field: 'address', value: walletAddressToUpdate },
          requestId: requestId,
        },
      });
    }

    // Validate updatePayload
    if (!updatePayload || typeof updatePayload !== 'object' || Object.keys(updatePayload).length === 0) {
      logger.warn(`[userCoreApi] PUT .../${walletAddressToUpdate}: Empty or invalid update payload. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_UPDATE_PAYLOAD',
          message: 'Request body cannot be empty and must be an object containing fields to update.',
          requestId: requestId,
        },
      });
    }

    // Construct $set operations and validate payload fields
    const setOperations = {};
    const allowedUpdateFields = ['isPrimary', 'verified', 'name', 'tag'];
    let hasValidUpdateField = false;

    if (updatePayload.hasOwnProperty('isPrimary')) {
      if (typeof updatePayload.isPrimary !== 'boolean') {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_TYPE', message: "'isPrimary' must be a boolean.", details: { field: 'isPrimary' }, requestId }});
      }
      setOperations['wallets.$[elem].isPrimary'] = updatePayload.isPrimary;
      hasValidUpdateField = true;
    }
    if (updatePayload.hasOwnProperty('verified')) {
      if (typeof updatePayload.verified !== 'boolean') {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_TYPE', message: "'verified' must be a boolean.", details: { field: 'verified' }, requestId }});
      }
      setOperations['wallets.$[elem].verified'] = updatePayload.verified;
      hasValidUpdateField = true;
    }
    if (updatePayload.hasOwnProperty('name')) {
      if (typeof updatePayload.name !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_TYPE', message: "'name' must be a string.", details: { field: 'name' }, requestId }});
      }
      setOperations['wallets.$[elem].name'] = updatePayload.name.trim(); // Allow empty string for name to clear it
      hasValidUpdateField = true;
    }
    if (updatePayload.hasOwnProperty('tag')) {
      if (typeof updatePayload.tag !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_TYPE', message: "'tag' must be a string.", details: { field: 'tag' }, requestId }});
      }
      setOperations['wallets.$[elem].tag'] = updatePayload.tag.trim(); // Allow empty string for tag to clear it
      hasValidUpdateField = true;
    }

    if (!hasValidUpdateField) {
      logger.warn(`[userCoreApi] PUT .../${walletAddressToUpdate}: Payload contains no updatable fields. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'NO_UPDATABLE_FIELDS',
          message: `Request body must contain at least one updatable field: ${allowedUpdateFields.join(', ')}.`,
          requestId: requestId,
        },
      });
    }
    
    // Add an updatedAt timestamp to the wallet sub-document
    setOperations['wallets.$[elem].updatedAt'] = new Date();

    const updateQuery = { $set: setOperations };
    const updateOptions = { arrayFilters: [{ 'elem.address': walletAddressToUpdate }] };

    try {
      // First, check if the user and the specific wallet exist to provide a more accurate 404
      // This is an extra read but improves UX for 404s.
      const userExists = await db.userCore.findOne(
        { _id: new ObjectId(masterAccountId), 'wallets.address': walletAddressToUpdate }, 
        PRIORITY.HIGH // Use PRIORITY, remove projection for now to match BaseDB.findOne signature
      );

      if (!userExists) {
        logger.warn(`[userCoreApi] PUT .../${walletAddressToUpdate}: User or specific wallet not found. requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'USER_OR_WALLET_NOT_FOUND',
            message: 'User not found, or no wallet with the specified address exists for this user.',
            details: { masterAccountId, walletAddress: walletAddressToUpdate },
            requestId: requestId,
          },
        });
      }
      
      // If we are setting isPrimary = true, we might want to set other wallets to isPrimary = false.
      // This would involve another updateUserCore call or a more complex single update.
      // For now, we'll just update the target wallet as per the direct payload.
      // ADR-003: "Potentially add logic here to ensure only one primary wallet if isPrimary is true" - this is for addWallet.
      // For PUT, if isPrimary is being set to true, a separate operation might be needed to clear other primaries.
      // This is a business logic rule that can be complex with array updates. Simpler for now: update as requested.
      // A more robust solution for ensuring one primary might involve a pre-check or a dedicated DB method.

      const updatedUser = await db.userCore.updateUserCore(masterAccountId, updateQuery, updateOptions);

      // Note: updateUserCore returns the user doc if matchedCount > 0.
      // It doesn't guarantee the sub-document (wallet) was actually modified if arrayFilters didn't match anything
      // (though our pre-check with findOne should prevent this specific scenario).
      // A more precise check would be to look at updateResult.modifiedCount from the raw mongo response if BaseDB exposed it.
      if (!updatedUser) {
         // This case should be rare now due to the pre-check, but kept for safety.
        logger.warn(`[userCoreApi] PUT .../${walletAddressToUpdate}: User not found post-update (should have been caught by pre-check). requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND_POST_UPDATE',
            message: 'User not found after attempting update. This usually means the user was deleted concurrently or an issue occurred.',
            details: { masterAccountId, walletAddress: walletAddressToUpdate },
            requestId: requestId,
          },
        });
      }

      logger.info(`[userCoreApi] PUT .../${walletAddressToUpdate}: Wallet updated successfully. requestId: ${requestId}`);
      res.status(200).json(updatedUser); // ADR: Response: Updated UserCoreObject

    } catch (error) {
      logger.error(`[userCoreApi] PUT .../${walletAddressToUpdate}: Error updating wallet. Error: ${error.message}. requestId: ${requestId}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while updating the wallet.',
          requestId: requestId,
        },
      });
    }
  });

  // DELETE /users/{masterAccountId}/wallets/{address}
  router.delete('/:masterAccountId/wallets/:address', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId, address: walletAddressToDelete } = req.params;

    logger.info(`[userCoreApi] DELETE /users/${masterAccountId}/wallets/${walletAddressToDelete} called, requestId: ${requestId}`);

    // Validate masterAccountId
    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      logger.warn(`[userCoreApi] DELETE .../${walletAddressToDelete}: Invalid masterAccountId. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_MASTER_ACCOUNT_ID',
          message: 'Invalid masterAccountId format. Must be a valid MongoDB ObjectId string.',
          details: { field: 'masterAccountId', value: masterAccountId },
          requestId: requestId,
        },
      });
    }

    // Validate walletAddressToDelete
    if (!walletAddressToDelete || typeof walletAddressToDelete !== 'string' || walletAddressToDelete.trim() === '') {
      logger.warn(`[userCoreApi] DELETE /users/${masterAccountId}/wallets/...: Missing or invalid wallet address in path. requestId: ${requestId}`);
      return res.status(400).json({
        error: {
          code: 'INVALID_WALLET_ADDRESS_PARAM',
          message: 'Wallet address in path parameter must be a non-empty string.',
          details: { field: 'address', value: walletAddressToDelete },
          requestId: requestId,
        },
      });
    }

    try {
      // 1. Pre-check: Ensure user and the specific wallet exist before attempting deletion
      const initialUser = await db.userCore.findOne(
        { _id: new ObjectId(masterAccountId), 'wallets.address': walletAddressToDelete }, 
        PRIORITY.HIGH
      );

      if (!initialUser) {
        // This means either the user doesn't exist, or the user exists but doesn't have this wallet.
        logger.warn(`[userCoreApi] DELETE .../${walletAddressToDelete}: User or specific wallet not found for deletion. requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'USER_OR_WALLET_NOT_FOUND',
            message: 'User not found, or no wallet with the specified address exists for this user.',
            details: { masterAccountId, walletAddress: walletAddressToDelete },
            requestId: requestId,
          },
        });
      }

      // 2. Attempt to delete the wallet
      const updatedUser = await db.userCore.deleteWallet(masterAccountId, walletAddressToDelete);

      if (!updatedUser) {
        // This case should ideally not be hit if the pre-check for initialUser passed and user wasn't deleted concurrently.
        // It implies the user was found by the pre-check, but then `deleteWallet` (which calls `updateUserCore`)
        // failed to find the user for the update (e.g., concurrent deletion of the user).
        logger.warn(`[userCoreApi] DELETE .../${walletAddressToDelete}: User found initially but disappeared before/during wallet deletion. requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND_DURING_DELETE',
            message: 'User was not found when attempting to delete the wallet, though it existed moments before.',
            details: { masterAccountId, walletAddress: walletAddressToDelete },
            requestId: requestId,
          },
        });
      }

      // 3. Verify wallet was actually removed (since $pull doesn't error on non-match)
      const walletStillExists = updatedUser.wallets && updatedUser.wallets.some(w => w.address === walletAddressToDelete);
      if (walletStillExists) {
        // This implies the $pull operation did not remove the wallet, which is unexpected if pre-check passed.
        // Could be a very rare race condition or an issue with the $pull logic / address matching.
        logger.error(`[userCoreApi] DELETE .../${walletAddressToDelete}: Wallet still found in user document after delete operation. This is unexpected. requestId: ${requestId}`, { updatedUserWallets: updatedUser.wallets });
        return res.status(500).json({
          error: {
            code: 'WALLET_DELETION_VERIFICATION_FAILED',
            message: 'The wallet was targeted for deletion, but it still exists in the user document. Please check server logs.',
            requestId: requestId,
          },
        });
      }

      logger.info(`[userCoreApi] DELETE .../${walletAddressToDelete}: Wallet deleted successfully. requestId: ${requestId}`);
      res.status(200).json(updatedUser); // Return the updated user object

    } catch (error) {
      logger.error(`[userCoreApi] DELETE .../${walletAddressToDelete}: Error deleting wallet. Error: ${error.message}. requestId: ${requestId}`, error);
      // Check if the error is the one we throw from userCoreDb.deleteWallet for bad address
      if (error.message.includes('walletAddress is required')) {
        return res.status(400).json({
            error: {
                code: 'DB_VALIDATION_ERROR',
                message: error.message, // Pass DB validation message through
                requestId: requestId,
            },
        });
      }
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while deleting the wallet.',
          requestId: requestId,
        },
      });
    }
  });

  // Catch-all for other malformed DELETE requests under /users/:masterAccountId/wallets/
  // This MUST be defined AFTER the specific /:masterAccountId/wallets/:address route
  router.delete('/:masterAccountId/wallets/*', (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId } = req.params; // masterAccountId is still captured here
    const actualPath = req.originalUrl;

    // First, validate the masterAccountId that was captured from the path
    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
        logger.warn(`[userCoreApi] DELETE ${actualPath}: Invalid masterAccountId format in malformed path. requestId: ${requestId}`);
        return res.status(400).json({
            error: {
                code: 'INVALID_MASTER_ACCOUNT_ID',
                message: 'Invalid masterAccountId format in path. Must be a valid MongoDB ObjectId string.',
                details: { receivedPath: actualPath, field: 'masterAccountId', value: masterAccountId },
                requestId: requestId,
            },
        });
    }

    logger.warn(`[userCoreApi] DELETE ${actualPath}: Malformed path for wallet deletion. Expected /users/:masterAccountId/wallets/:address. requestId: ${requestId}`);
    res.status(400).json({
      error: {
        code: 'INVALID_WALLET_PATH_PARAMETERS',
        message: 'Malformed path for wallet deletion. Expecting /users/{masterAccountId}/wallets/{address} with a non-empty wallet address.',
        details: { receivedPath: actualPath },
        requestId: requestId,
      },
    });
  });
  
  // --- API Key Endpoints ---
  // Base path for these will be /users/{masterAccountId}/apikeys

  // POST /users/{masterAccountId}/apikeys
  router.post('/:masterAccountId/apikeys', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId } = req.params;
    const { name, permissions } = req.body;

    logger.info(`[userCoreApi] POST /users/${masterAccountId}/apikeys called with name: '${name}', permissions: ${JSON.stringify(permissions)}, requestId: ${requestId}`);

    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      logger.warn(`[userCoreApi] POST /apikeys: Invalid masterAccountId. requestId: ${requestId}`);
      return res.status(400).json({
        error: { code: 'INVALID_MASTER_ACCOUNT_ID', message: 'Invalid masterAccountId format.', details: { field: 'masterAccountId', value: masterAccountId }, requestId },
      });
    }

    if (!name || typeof name !== 'string' || name.trim() === '') {
      logger.warn(`[userCoreApi] POST /apikeys: Missing or invalid 'name'. requestId: ${requestId}`);
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: "Missing or invalid 'name' in request body. Must be a non-empty string.", details: { field: 'name' }, requestId },
      });
    }

    if (permissions && (!Array.isArray(permissions) || !permissions.every(p => typeof p === 'string' && p.trim() !== ''))) {
      logger.warn(`[userCoreApi] POST /apikeys: Invalid 'permissions' format. requestId: ${requestId}`);
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: "Invalid 'permissions' in request body. Must be an array of non-empty strings.", details: { field: 'permissions' }, requestId },
      });
    }

    try {
      // 1. Generate API Key components
      const crypto = require('crypto');
      const apiKeySecret = crypto.randomBytes(24).toString('hex'); // 48 characters
      const fullApiKey = `st_${apiKeySecret}`; // Prefix with st_
      const keyPrefix = `st_${apiKeySecret.substring(0, 6)}`;
      const keyHash = crypto.createHash('sha256').update(fullApiKey).digest('hex');
      const now = new Date();

      const apiKeyDocumentForDb = {
        keyPrefix,
        keyHash,
        name: name.trim(),
        permissions: permissions || [], // Default to empty array if not provided
        createdAt: now,
        updatedAt: now, // Initially same as createdAt
        lastUsedAt: null,
        status: 'active',
      };

      // 2. Add to DB
      const updatedUser = await db.userCore.addApiKey(masterAccountId, apiKeyDocumentForDb);

      if (!updatedUser) {
        logger.warn(`[userCoreApi] POST /apikeys: User not found for masterAccountId ${masterAccountId}. requestId: ${requestId}`);
        return res.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: 'User not found with the provided masterAccountId.', details: { masterAccountId }, requestId },
        });
      }

      // 3. Prepare and send response (showing fullApiKey ONCE)
      const responseApiKeyObject = {
        apiKey: fullApiKey, // Show the full key ONLY in this response
        keyPrefix: apiKeyDocumentForDb.keyPrefix,
        name: apiKeyDocumentForDb.name,
        permissions: apiKeyDocumentForDb.permissions,
        createdAt: apiKeyDocumentForDb.createdAt.toISOString(),
        status: apiKeyDocumentForDb.status,
        // Do not include keyHash, updatedAt, lastUsedAt in this specific creation response for brevity/security.
      };

      logger.info(`[userCoreApi] POST /apikeys: API key created successfully for masterAccountId ${masterAccountId}. KeyPrefix: ${keyPrefix}. requestId: ${requestId}`);
      res.status(201).json(responseApiKeyObject);

    } catch (error) {
      logger.error(`[userCoreApi] POST /apikeys: Error creating API key for masterAccountId ${masterAccountId}. Error: ${error.message}. requestId: ${requestId}`, error);
      if (error.message.includes('Invalid apiKeyDocument')) { // Error from db method validation
        return res.status(500).json({ error: { code: 'DB_OPERATION_ERROR', message: 'Internal error preparing API key for storage.', requestId }});
      }
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while creating the API key.', requestId },
      });
    }
  });

  // GET /users/{masterAccountId}/apikeys
  router.get('/:masterAccountId/apikeys', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId } = req.params;

    logger.info(`[userCoreApi] GET /users/${masterAccountId}/apikeys called, requestId: ${requestId}`);

    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      logger.warn(`[userCoreApi] GET /apikeys: Invalid masterAccountId. requestId: ${requestId}`);
      return res.status(400).json({
        error: { code: 'INVALID_MASTER_ACCOUNT_ID', message: 'Invalid masterAccountId format.', details: { field: 'masterAccountId', value: masterAccountId }, requestId },
      });
    }

    try {
      const user = await db.userCore.findUserCoreById(masterAccountId);

      if (!user) {
        logger.warn(`[userCoreApi] GET /apikeys: User not found for masterAccountId ${masterAccountId}. requestId: ${requestId}`);
        return res.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: 'User not found with the provided masterAccountId.', details: { masterAccountId }, requestId },
        });
      }

      let userApiKeys = [];
      if (user.apiKeys && Array.isArray(user.apiKeys)) {
        userApiKeys = user.apiKeys.map(key => ({
          keyPrefix: key.keyPrefix,
          name: key.name,
          permissions: key.permissions,
          createdAt: key.createdAt ? key.createdAt.toISOString() : null, 
          updatedAt: key.updatedAt ? key.updatedAt.toISOString() : null,
          lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
          status: key.status,
          // Explicitly DO NOT include key.keyHash or the full key itself
        }));
      }

      logger.info(`[userCoreApi] GET /apikeys: Successfully retrieved ${userApiKeys.length} API key(s) for masterAccountId ${masterAccountId}. requestId: ${requestId}`);
      res.status(200).json(userApiKeys);

    } catch (error) {
      logger.error(`[userCoreApi] GET /apikeys: Error retrieving API keys for masterAccountId ${masterAccountId}. Error: ${error.message}. requestId: ${requestId}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while retrieving API keys.', requestId },
      });
    }
  });

  // PUT /users/{masterAccountId}/apikeys/{keyPrefix}
  router.put('/:masterAccountId/apikeys/:keyPrefix', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId, keyPrefix } = req.params;
    const payload = req.body;

    logger.info(`[userCoreApi] PUT /users/${masterAccountId}/apikeys/${keyPrefix} called with payload: ${JSON.stringify(payload)}, requestId: ${requestId}`);

    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      return res.status(400).json({ error: { code: 'INVALID_MASTER_ACCOUNT_ID', message: 'Invalid masterAccountId format.', details: { value: masterAccountId }, requestId }});
    }
    if (!keyPrefix || typeof keyPrefix !== 'string' || keyPrefix.trim() === '') {
      return res.status(400).json({ error: { code: 'INVALID_KEY_PREFIX_PARAM', message: 'keyPrefix path parameter must be a non-empty string.', details: { value: keyPrefix }, requestId }});
    }
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_UPDATE_PAYLOAD', message: 'Request body cannot be empty and must be an object.', requestId }});
    }

    const updatesForDb = {};
    let hasValidUpdate = false;
    const allowedFields = ['name', 'permissions', 'status'];

    if (payload.hasOwnProperty('name')) {
      if (typeof payload.name !== 'string' || payload.name.trim() === '') {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_VALUE', message: "Field 'name' must be a non-empty string.", details: { field: 'name' }, requestId }});
      }
      updatesForDb['apiKeys.$[elem].name'] = payload.name.trim();
      hasValidUpdate = true;
    }
    if (payload.hasOwnProperty('permissions')) {
      if (!Array.isArray(payload.permissions) || !payload.permissions.every(p => typeof p === 'string' && p.trim() !== '')) {
        return res.status(400).json({ error: { code: 'INVALID_FIELD_VALUE', message: "Field 'permissions' must be an array of non-empty strings.", details: { field: 'permissions' }, requestId }});
      }
      updatesForDb['apiKeys.$[elem].permissions'] = payload.permissions;
      hasValidUpdate = true;
    }
    if (payload.hasOwnProperty('status')) {
      // TODO: Add validation for allowed status values, e.g., ['active', 'inactive']
      if (typeof payload.status !== 'string' || !['active', 'inactive'].includes(payload.status)) {
          return res.status(400).json({ error: { code: 'INVALID_FIELD_VALUE', message: "Field 'status' must be either 'active' or 'inactive'.", details: { field: 'status' }, requestId }});
      }
      updatesForDb['apiKeys.$[elem].status'] = payload.status;
      hasValidUpdate = true;
    }

    if (!hasValidUpdate) {
      return res.status(400).json({
        error: { code: 'NO_UPDATABLE_FIELDS', message: `Request body must contain at least one updatable field: ${allowedFields.join(', ')}.`, requestId },
      });
    }

    updatesForDb['apiKeys.$[elem].updatedAt'] = new Date(); // Always update the timestamp

    try {
      // Pre-check user and API key existence
      const userWithKey = await db.userCore.findOne(
        { _id: new ObjectId(masterAccountId), 'apiKeys.keyPrefix': keyPrefix }, 
        PRIORITY.HIGH
      );
      if (!userWithKey) {
        return res.status(404).json({ error: { code: 'USER_OR_API_KEY_NOT_FOUND', message: 'User not found or no API key with the specified prefix exists for this user.', details: { masterAccountId, keyPrefix }, requestId }});
      }

      const updatedUser = await db.userCore.updateApiKey(masterAccountId, keyPrefix, updatesForDb);

      if (!updatedUser) {
        // Should be rare due to pre-check, but indicates user might have been deleted concurrently
        return res.status(404).json({ error: { code: 'USER_NOT_FOUND_POST_UPDATE', message: 'User not found after attempting API key update.', details: { masterAccountId, keyPrefix }, requestId }});
      }
      
      // Optionally, find and return only the updated API key object for a cleaner response
      // For now, returning the whole user object is consistent with other updates.
      logger.info(`[userCoreApi] PUT /apikeys/${keyPrefix}: API key updated successfully for masterAccountId ${masterAccountId}. requestId: ${requestId}`);
      res.status(200).json(updatedUser);

    } catch (error) {
      logger.error(`[userCoreApi] PUT /apikeys/${keyPrefix}: Error: ${error.message}. requestId: ${requestId}`, error);
      if (error.message.includes('keyPrefix is required') || error.message.includes('updates object is required')) {
        return res.status(500).json({ error: { code: 'DB_VALIDATION_ERROR', message: `Internal error calling database: ${error.message}`, requestId }});
      }
      res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred.', requestId }});
    }
  });

  // DELETE /users/{masterAccountId}/apikeys/{keyPrefix}
  router.delete('/:masterAccountId/apikeys/:keyPrefix', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId, keyPrefix } = req.params;

    logger.info(`[userCoreApi] DELETE /users/${masterAccountId}/apikeys/${keyPrefix} called, requestId: ${requestId}`);

    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      logger.warn(`[userCoreApi] DELETE /apikeys/${keyPrefix}: Invalid masterAccountId. Value: ${masterAccountId}, requestId: ${requestId}`);
      return res.status(400).json({
        error: { code: 'INVALID_MASTER_ACCOUNT_ID', message: 'Invalid masterAccountId format.', details: { value: masterAccountId }, requestId },
      });
    }

    if (!keyPrefix || typeof keyPrefix !== 'string' || keyPrefix.trim() === '') {
      logger.warn(`[userCoreApi] DELETE /apikeys/${keyPrefix}: Invalid keyPrefix. Value: ${keyPrefix}, requestId: ${requestId}`);
      return res.status(400).json({
        error: { code: 'INVALID_KEY_PREFIX_PARAM', message: 'keyPrefix path parameter must be a non-empty string.', details: { value: keyPrefix }, requestId },
      });
    }

    try {
      // Pre-check: Ensure the user and the specific API key exist before attempting deletion.
      // The db.userCore.deleteApiKey method also has a pre-check, but doing it here allows a more specific early 404.
      const userWithKey = await db.userCore.findOne(
        { _id: new ObjectId(masterAccountId), 'apiKeys.keyPrefix': keyPrefix },
        PRIORITY.HIGH, // Using HIGH as this is a direct user operation precursor
        // No projection needed, just checking existence
      );

      if (!userWithKey) {
        logger.warn(`[userCoreApi] DELETE /apikeys/${keyPrefix}: User or API Key not found. masterAccountId: ${masterAccountId}, keyPrefix: ${keyPrefix}, requestId: ${requestId}`);
        return res.status(404).json({
          error: {
            code: 'USER_OR_API_KEY_NOT_FOUND',
            message: 'User not found, or no API key with the specified prefix exists for this user.',
            details: { masterAccountId, keyPrefix },
            requestId,
          },
        });
      }
      
      const updatedUser = await db.userCore.deleteApiKey(masterAccountId, keyPrefix);

      if (!updatedUser) {
        // This might happen if the DB method's internal check fails post our pre-check (e.g. concurrent deletion)
        // or if the DB method returns null for other reasons (like key not found, though our pre-check aims to prevent this).
        logger.warn(`[userCoreApi] DELETE /apikeys/${keyPrefix}: API key ${keyPrefix} not found for user ${masterAccountId} during deletion attempt, or user vanished. requestId: ${requestId}`);
        return res.status(404).json({ // Treat as if the key wasn't there to begin with
          error: {
            code: 'API_KEY_NOT_FOUND_ON_DELETE',
            message: 'API key not found during deletion attempt, or user data inconsistent.',
            details: { masterAccountId, keyPrefix },
            requestId,
          },
        });
      }

      // Verify the key is actually gone from the returned user object
      const keyStillExists = updatedUser.apiKeys && updatedUser.apiKeys.some(k => k.keyPrefix === keyPrefix);
      if (keyStillExists) {
        // This is an unexpected error state, log it.
        logger.error(`[userCoreApi] DELETE /apikeys/${keyPrefix}: API key ${keyPrefix} was expected to be deleted for user ${masterAccountId}, but it still exists. requestId: ${requestId}`);
        return res.status(500).json({
          error: {
            code: 'API_KEY_NOT_DELETED_UNEXPECTEDLY',
            message: 'API key was targeted for deletion but was not removed. Please check server logs.',
            details: { masterAccountId, keyPrefix },
            requestId,
          },
        });
      }

      logger.info(`[userCoreApi] DELETE /apikeys/${keyPrefix}: API key ${keyPrefix} deleted successfully for masterAccountId ${masterAccountId}. requestId: ${requestId}`);
      // ADR says "Confirmation", but returning the updated user object (sans the key) is also good.
      // Let's return a success message with keyPrefix.
      res.status(200).json({ 
        message: 'API key deleted successfully.',
        details: { masterAccountId, keyPrefix },
        requestId 
      });

    } catch (error) {
      logger.error(`[userCoreApi] DELETE /apikeys/${keyPrefix}: Error deleting API key for masterAccountId ${masterAccountId}. Error: ${error.message}. requestId: ${requestId}`, error);
      if (error.message.includes('masterAccountId is required') || error.message.includes('keyPrefix is required')) {
         return res.status(500).json({ error: { code: 'DB_VALIDATION_ERROR', message: `Internal error calling database: ${error.message}`, requestId }});
      }
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while deleting the API key.', requestId },
      });
    }
  });

  // Catch-all for malformed DELETE requests to /apikeys to ensure JSON response
  router.delete('/:masterAccountId/apikeys/*', (req, res) => {
    const requestId = uuidv4();
    const actualPath = req.originalUrl;
    const { masterAccountId } = req.params;

    // Check if masterAccountId is valid, otherwise it could be a completely malformed path like /apikeys/foo/bar/baz
    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
        logger.warn(`[userCoreApi] DELETE ${actualPath}: Malformed path, masterAccountId invalid or missing. requestId: ${requestId}`);
        return res.status(400).json({
            error: {
                code: 'INVALID_MASTER_ACCOUNT_ID',
                message: 'Malformed path for API key deletion. Master Account ID is invalid or missing.',
                details: { receivedPath: actualPath, field: 'masterAccountId', value: masterAccountId },
                requestId: requestId,
            },
        });
    }
    
    logger.warn(`[userCoreApi] DELETE ${actualPath}: Malformed path for API key deletion. Expected /users/:masterAccountId/apikeys/:keyPrefix. requestId: ${requestId}`);
    res.status(400).json({
      error: {
        code: 'INVALID_API_KEY_PATH_PARAMETERS',
        message: 'Malformed path for API key deletion. Expecting /users/{masterAccountId}/apikeys/{keyPrefix} with a non-empty keyPrefix.',
        details: { receivedPath: actualPath },
        requestId: requestId,
      },
    });
  });

  // --- Transaction Listing Endpoint (User-Specific) ---
  // GET /users/{masterAccountId}/transactions - List transactions for a user
  // Note: Uses db.transactions service
  router.get('/:masterAccountId/transactions', async (req, res, next) => {
    const { masterAccountId: masterAccountIdStr } = req.params; 
    logger.info(`[userCoreApi] GET /users/${masterAccountIdStr}/transactions - Received request`);

    // Inline validation for masterAccountId
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
      logger.warn(`[userCoreApi] GET /users/${masterAccountIdStr}/transactions: Invalid masterAccountId format.`);
       return res.status(400).json({
         error: { code: 'INVALID_INPUT', message: 'Invalid masterAccountId format. Must be a valid ObjectId.', details: { value: masterAccountIdStr } }
       });
    }
    const masterAccountId = new ObjectId(masterAccountIdStr);

    // Check dependency
    if (!db.transactions) {
      logger.error(`[userCoreApi] TransactionsDB service not available for GET /users/${masterAccountIdStr}/transactions`);
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Transactions database service is not available.' } });
    }

    try {
      // TODO: Add pagination options (limit, skip/page, sort) later via query params
      const userTransactions = await db.transactions.findTransactionsByMasterAccount(masterAccountId);
      logger.info(`[userCoreApi] GET /users/${masterAccountIdStr}/transactions: Found ${userTransactions.length} transactions.`);
      res.status(200).json(userTransactions); // Returns an array of TransactionObjects
    } catch (error) {
      logger.error(`[userCoreApi] GET /users/${masterAccountIdStr}/transactions: Error processing request. Error: ${error.message}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while finding user transactions.' },
      });
    }
  });

  // --- Generation Output Listing Endpoint (User-Specific) ---
  // GET /users/{masterAccountId}/generations - List generation outputs for a user
  // Note: Uses db.generationOutputs service
  router.get('/:masterAccountId/generations', async (req, res, next) => {
    const { masterAccountId: masterAccountIdStr } = req.params;
    logger.info(`[userCoreApi] GET /users/${masterAccountIdStr}/generations - Received request`);

    // Inline validation for masterAccountId
    if (!masterAccountIdStr || !ObjectId.isValid(masterAccountIdStr)) {
      logger.warn(`[userCoreApi] GET .../generations: Invalid masterAccountId format: ${masterAccountIdStr}`);
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'Invalid masterAccountId format. Must be a valid ObjectId.', details: { value: masterAccountIdStr } }
      });
    }
    const masterAccountId = new ObjectId(masterAccountIdStr);

    // Check dependency
    if (!db.generationOutputs) {
      logger.error(`[userCoreApi] GenerationOutputsDB service not available for GET /users/${masterAccountIdStr}/generations`);
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'GenerationOutputs database service is not available.' } });
    }

    try {
      // TODO: Add pagination options (limit, skip/page, sort) later via query params
      const userGenerations = await db.generationOutputs.findGenerationsByMasterAccount(masterAccountId);
      logger.info(`[userCoreApi] GET .../generations: Found ${userGenerations.length} generations for user ${masterAccountIdStr}.`);
      res.status(200).json(userGenerations); // Returns an array of GenerationOutputObjects
    } catch (error) {
      logger.error(`[userCoreApi] GET .../generations: Error for user ${masterAccountIdStr} - ${error.message}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while finding user generation outputs.' }
      });
    }
  });

  // --- Mount User Preferences API Router ---
  // All routes under /users/:masterAccountId/preferences will be handled by this sub-router
  if (createUserPreferencesApiService) {
    const userPreferencesApiRouter = createUserPreferencesApiService(dependencies); // Pass the same dependencies
    if (userPreferencesApiRouter) {
      router.use('/:masterAccountId/preferences', userPreferencesApiRouter);
      logger.info(`[userCoreApi] User Preferences API service mounted under /:masterAccountId/preferences`);
    } else {
      logger.error('[userCoreApi] Failed to create User Preferences API router.');
    }
  } else {
    logger.warn('[userCoreApi] createUserPreferencesApiService not imported correctly.');
  }

  logger.info('[userCoreApi] User Core API service router configured.');
  return router;
}

module.exports = createUserCoreApiService; 