const express = require('express');
const { v4: uuidv4 } = require('uuid'); // Added for request IDs in errors
const { ObjectId, Decimal128 } = require('mongodb'); // Added for ObjectId validation & Decimal128
const { PRIORITY, getCachedClient } = require('../../core/services/db/utils/queue'); // Import PRIORITY and getCachedClient
const createUserPreferencesApiService = require('./userPreferencesApi'); // Import the new preferences service
const initializeApiKeysApi = require('./apiKeysApi'); // Import the new API keys service
const initializeUserEconomyApi = require('./userEconomyApi.js'); // Import the new economy service (fixed)
const { createUserToolsApiRouter } = require('./userToolsApi'); // Import the new user tools service
const createTransactionsApiService = require('./transactionsApi');
const createUserSessionsApi = require('./userSessionsApi');

/**
 * Creates and configures an Express router for User Core API endpoints.
 * @param {Object} dependencies - Dependencies for the service, expecting 'logger' and 'db'.
 *                                'db' should contain the UserCoreDB service instance.
 * @returns {express.Router} Configured Express router for User Core API.
 */
function createUserCoreApiService(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router();

  // Ensure all required DB services are present (add checks as needed for sub-routers)
  if (!db || !db.userCore || !db.userSessions || !db.userEvents || !db.userEconomy || !db.transactions || !db.generationOutputs || !db.userPreferences) {
    logger.error('[userCoreApi] One or more required DB services not found in dependencies. API may not function correctly.');
    // Consider checking specific dependencies needed by sub-routers as well.
    router.use((req, res) => {
      res.status(500).json({ 
        error: { 
          code: 'SERVICE_UNAVAILABLE', 
          message: 'One or more required database services are not available. Please check server configuration.' 
        } 
      });
    });
    return router;
  }

  // Mount the user-specific transaction routes
  const transactionsApiRouter = createTransactionsApiService(dependencies);
  router.use('/:masterAccountId/transactions', transactionsApiRouter);
  logger.info('[userCoreApi] User-specific Transactions API service mounted.');

  // Mount the user-specific session routes
  const userSessionsApiRouter = createUserSessionsApi(dependencies);
  router.use('/:masterAccountId/sessions', userSessionsApiRouter);
  logger.info('[userCoreApi] User-specific Sessions API service mounted.');

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
      const { user, isNew: isNewUser } = await db.userCore.findOrCreateByPlatformId(platform, platformId, platformContext || {});

      if (!user || !user._id) {
        logger.error(`[userCoreApi] POST /find-or-create: findOrCreateByPlatformId returned null or invalid user for ${platform}:${platformId}. requestId: ${requestId}`);
        return res.status(500).json({
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to find or create user due to an unexpected issue with the database service.',
            requestId: requestId,
          },
        });
      }

      const statusCode = isNewUser ? 201 : 200;

      logger.info(`[userCoreApi] POST /find-or-create: User ${isNewUser ? 'created' : 'found'}. MasterAccountId: ${user._id}. Status: ${statusCode}. requestId: ${requestId}`);
      
      res.status(statusCode).json({
        masterAccountId: user._id.toString(),
        user: user, 
        isNewUser: isNewUser,
      });

    } catch (error) {
      logger.error(`[userCoreApi] POST /find-or-create: Error processing request for ${platform}:${platformId}. Error: ${error.message}. requestId: ${requestId}`, error);
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

  // --- Mount Sub-Routers for User-Specific Data ---

  // User Preferences API (already mounted at /:masterAccountId/preferences)
  const userPreferencesApiRouter = createUserPreferencesApiService(dependencies);
  router.use('/:masterAccountId/preferences', userPreferencesApiRouter);
  logger.info(`[userCoreApi] User Preferences API routes mounted under /:masterAccountId/preferences.`);

  // User Wallets API (mounted at /:masterAccountId/wallets)
  if (dependencies.userScopedWalletsRouter) {
    router.use('/:masterAccountId/wallets', dependencies.userScopedWalletsRouter);
    logger.info(`[userCoreApi] User Wallets API routes mounted under /:masterAccountId/wallets.`);
  } else {
    logger.error('[userCoreApi] userScopedWalletsRouter not found in dependencies, skipping wallet routes.');
  }

  // User API Keys API (mounted at /:masterAccountId/apikeys)
  const { managementRouter: apiKeysManagementRouter, performApiKeyValidation } = initializeApiKeysApi(dependencies);
  if (apiKeysManagementRouter && performApiKeyValidation) {
    router.use('/:masterAccountId/apikeys', validateObjectId('masterAccountId', 'params'), apiKeysManagementRouter);
    logger.info(`[userCoreApi] API Keys management routes mounted under /:masterAccountId/apikeys.`);

    router.post('/apikeys/validate-token', async (req, res) => {
      const { apiKey } = req.body;
      const requestId = uuidv4();
      logger.info(`[userCoreApi] POST /apikeys/validate-token called, requestId: ${requestId}`);
      if (!apiKey) {
        logger.warn(`[userCoreApi] POST /apikeys/validate-token: Missing apiKey in request body. requestId: ${requestId}`);
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'apiKey is required in the request body.', requestId } });
      }
      try {
        const validationResult = await performApiKeyValidation(apiKey);
        if (validationResult && validationResult.masterAccountId) {
          logger.info(`[userCoreApi] POST /apikeys/validate-token: API key validated successfully for masterAccountId ${validationResult.masterAccountId}. requestId: ${requestId}`);
          res.status(200).json({
            masterAccountId: validationResult.masterAccountId,
          });
        } else {
          logger.warn(`[userCoreApi] POST /apikeys/validate-token: API key validation failed. requestId: ${requestId}`);
          res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or inactive API key.', requestId } });
        }
      } catch (error) {
        logger.error(`[userCoreApi] POST /apikeys/validate-token: Error during API key validation. Error: ${error.message}. requestId: ${requestId}`, error);
        res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred during API key validation.', requestId } });
      }
    });
    logger.info(`[userCoreApi] API Key validation endpoint POST /apikeys/validate-token registered.`);
  } else {
    logger.error('[userCoreApi] Failed to initialize API Keys service (management router or validation function missing).');
  }
  
  // Mount User Economy routes
  const userEconomyApiRouter = initializeUserEconomyApi(dependencies);
  router.use('/:masterAccountId/economy', validateObjectId('masterAccountId', 'params'), userEconomyApiRouter);
  logger.info(`[userCoreApi] User Economy API routes mounted under /:masterAccountId/economy.`);

  // Mount User Tools API Router
  if (createUserToolsApiRouter) {
    const userToolsApiRouterInstance = createUserToolsApiRouter(dependencies);
    if (userToolsApiRouterInstance) {
      router.use('/:masterAccountId/used-tools', userToolsApiRouterInstance);
      logger.info(`[userCoreApi] User Tools API service mounted under /:masterAccountId/used-tools`);
    } else {
      logger.error('[userCoreApi] Failed to create User Tools API router.');
    }
  } else {
    logger.warn('[userCoreApi] createUserToolsApiRouter not imported correctly.');
  }

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

  logger.info('[userCoreApi] User Core API service router configured.');
  return router;
}

// Middleware for validating ObjectId in path parameters
// This should ideally be shared or placed in a utility file, but defining here for now
const validateObjectId = (paramName, source = 'params') => (req, res, next) => {
  const id = req[source]?.[paramName]; // Safely access param
  if (!id || !ObjectId.isValid(id)) {
    logger.warn(`[userCoreApi:validateObjectId] Invalid ObjectId format for ${source}.${paramName}: ${id}`);
    return res.status(400).json({
      error: { code: 'INVALID_INPUT', message: `Invalid format for ${paramName}. Must be a valid ObjectId.` }
    });
  }
  // Optionally attach the validated ObjectId to req.locals or similar if needed downstream
  // if (!req.locals) req.locals = {};
  // req.locals[paramName] = new ObjectId(id);
  next();
};

module.exports = createUserCoreApiService; 