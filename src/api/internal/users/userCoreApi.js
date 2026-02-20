const express = require('express');
const { v4: uuidv4 } = require('uuid'); // Added for request IDs in errors
const { ObjectId, Decimal128 } = require('mongodb'); // Added for ObjectId validation & Decimal128
const { PRIORITY, getCachedClient } = require('../../../core/services/db/utils/queue'); // path adjusted
const createUserPreferencesApiService = require('./userPreferencesApi'); // Import the new preferences service
const initializeApiKeysApi = require('../apiKeysApi'); // path adjusted one level up
const initializeUserEconomyApi = require('../economy/userEconomyApi.js'); // path adjusted
const { createUserToolsApiRouter } = require('../userToolsApi'); // path adjusted
const createTransactionsApiService = require('../economy/transactionsApi');

/**
 * Creates and configures an Express router for User Core API endpoints.
 * @param {Object} dependencies - Dependencies for the service, expecting 'logger' and 'db'.
 *                                'db' should contain the UserCoreDB service instance.
 * @returns {express.Router} Configured Express router for User Core API.
 */
function createUserCoreApiService(dependencies) {
  const { logger, db } = dependencies;
  const router = express.Router();

  // Platform link notification service - will get notifiers from dependencies at runtime
  // (since notifiers are created after API initialization)
  const PlatformLinkNotificationService = require('../../../core/services/platformLinkNotificationService');
  let linkNotificationService = null;

  // Helper to get or create notification service with current notifiers
  function getNotificationService() {
    const platformNotifiers = dependencies.platformNotifiers || {};
    if (Object.keys(platformNotifiers).length > 0) {
      if (!linkNotificationService) {
        linkNotificationService = new PlatformLinkNotificationService(platformNotifiers, logger);
        logger.debug('[userCoreApi] Platform link notification service initialized.');
      }
      return linkNotificationService;
    }
    return null;
  }

  // Ensure all required DB services are present (add checks as needed for sub-routers)
  if (!db || !db.userCore || !db.userEvents || !db.userEconomy || !db.transactions || !db.generationOutputs || !db.userPreferences) {
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

  // Check for platformLinkRequests service
  if (!db.platformLinkRequests) {
    logger.warn('[userCoreApi] platformLinkRequests service not found. Platform linking endpoints will not be available.');
  }

  // Mount the user-specific transaction routes
  const transactionsApiRouter = createTransactionsApiService(dependencies);
  router.use('/:masterAccountId/transactions', transactionsApiRouter);
  logger.debug('[userCoreApi] User-specific Transactions API service mounted.');

  // Middleware to parse JSON bodies
  router.use(express.json());

  // --- User Core Endpoints ---

  // POST /users/find-or-create
  router.post('/find-or-create', async (req, res) => {
    const requestId = uuidv4(); // For error reporting
    let bodyStr;
    try {
      bodyStr = JSON.stringify(req.body);
    } catch (_) {
      // Fallback to util.inspect on circular / BigInt issues
      const util = require('util');
      bodyStr = util.inspect(req.body, { depth: 2, breakLength: 100 });
    }
    logger.debug(`[userCoreApi] POST /find-or-create called with body: ${bodyStr}, requestId: ${requestId}`);
    
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
    logger.debug(`[userCoreApi] GET /users/${masterAccountId} called, requestId: ${requestId}`);

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

      logger.debug(`[userCoreApi] GET /users/${masterAccountId}: User found. requestId: ${requestId}`);
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

    logger.debug(`[userCoreApi] PUT /users/${masterAccountId} called with body: ${JSON.stringify(updatePayload)}, requestId: ${requestId}`);

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
    logger.debug(`[userCoreApi] GET /by-platform/${platform}/${platformId} called, requestId: ${requestId}`);

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

      logger.debug(`[userCoreApi] GET /by-platform/${platform}/${platformId}: User found. MasterAccountId: ${user._id}. requestId: ${requestId}`);
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

  // --- User Event Listing Endpoint ---
  // GET /users/{masterAccountId}/events - List events for a user
  // Note: Uses db.userEvents service
  router.get('/:masterAccountId/events', async (req, res, next) => {
      const { masterAccountId: masterAccountIdStr } = req.params; // Get ID string from params
      logger.debug(`[userCoreApi] GET /users/${masterAccountIdStr}/events - Received request`);

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
        logger.debug(`[userCoreApi] GET /users/${masterAccountIdStr}/events: Found ${userEvents.length} events.`);
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
    logger.debug(`[userCoreApi] GET /users/${masterAccountIdStr}/transactions - Received request`);

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
      logger.debug(`[userCoreApi] GET /users/${masterAccountIdStr}/transactions: Found ${userTransactions.length} transactions.`);
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
  logger.debug(`[userCoreApi] User Preferences API routes mounted under /:masterAccountId/preferences.`);

  // User Wallets API (mounted at /:masterAccountId/wallets)
  if (dependencies.userScopedWalletsRouter) {
    router.use('/:masterAccountId/wallets', dependencies.userScopedWalletsRouter);
    logger.debug(`[userCoreApi] User Wallets API routes mounted under /:masterAccountId/wallets.`);
  } else {
    logger.error('[userCoreApi] userScopedWalletsRouter not found in dependencies, skipping wallet routes.');
  }

  // User API Keys API (mounted at /:masterAccountId/apikeys)
  const { managementRouter: apiKeysManagementRouter, performApiKeyValidation } = initializeApiKeysApi(dependencies);
  if (apiKeysManagementRouter && performApiKeyValidation) {
    router.use('/:masterAccountId/apikeys', validateObjectId('masterAccountId', 'params'), apiKeysManagementRouter);
    logger.debug(`[userCoreApi] API Keys management routes mounted under /:masterAccountId/apikeys.`);

    router.post('/apikeys/validate-token', async (req, res) => {
      const { apiKey } = req.body;
      const requestId = uuidv4();
      logger.debug(`[userCoreApi] POST /apikeys/validate-token called, requestId: ${requestId}`);
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
    logger.debug(`[userCoreApi] API Key validation endpoint POST /apikeys/validate-token registered.`);
  } else {
    logger.error('[userCoreApi] Failed to initialize API Keys service (management router or validation function missing).');
  }
  
  // Mount User Economy routes
  const userEconomyApiRouter = initializeUserEconomyApi(dependencies);
  router.use('/:masterAccountId/economy', validateObjectId('masterAccountId', 'params'), userEconomyApiRouter);
  logger.debug(`[userCoreApi] User Economy API routes mounted under /:masterAccountId/economy.`);

  // Mount User Tools API Router
  if (createUserToolsApiRouter) {
    const userToolsApiRouterInstance = createUserToolsApiRouter(dependencies);
    if (userToolsApiRouterInstance) {
      router.use('/:masterAccountId/used-tools', userToolsApiRouterInstance);
      logger.debug(`[userCoreApi] User Tools API service mounted under /:masterAccountId/used-tools`);
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
    logger.debug(`[userCoreApi] GET /users/${masterAccountIdStr}/generations - Received request`);

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
      logger.debug(`[userCoreApi] GET .../generations: Found ${userGenerations.length} generations for user ${masterAccountIdStr}.`);
      res.status(200).json(userGenerations); // Returns an array of GenerationOutputObjects
    } catch (error) {
      logger.error(`[userCoreApi] GET .../generations: Error for user ${masterAccountIdStr} - ${error.message}`, error);
      res.status(500).json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: error.message || 'An unexpected error occurred while finding user generation outputs.' }
      });
    }
  });

  // --- Platform Linking Endpoints ---

  // POST /users/request-platform-link
  router.post('/request-platform-link', async (req, res) => {
    const requestId = uuidv4();
    const { requestingPlatform, requestingPlatformId, walletAddress, linkMethod } = req.body;

    logger.debug(`[userCoreApi] POST /request-platform-link called. RequestId: ${requestId}, Platform: ${requestingPlatform}, Wallet: ${walletAddress?.substring(0, 10)}...`);

    // Validate required inputs
    if (!requestingPlatform || typeof requestingPlatform !== 'string') {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: "Missing or invalid 'requestingPlatform'. Must be a non-empty string.",
          requestId
        }
      });
    }

    if (!requestingPlatformId || typeof requestingPlatformId !== 'string') {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: "Missing or invalid 'requestingPlatformId'. Must be a non-empty string.",
          requestId
        }
      });
    }

    if (!walletAddress || typeof walletAddress !== 'string') {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: "Missing or invalid 'walletAddress'. Must be a valid Ethereum address.",
          requestId
        }
      });
    }

    if (linkMethod !== 'approval') {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: "linkMethod must be 'approval' for this endpoint.",
          requestId
        }
      });
    }

    if (!db.platformLinkRequests) {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Platform linking service is not available.',
          requestId
        }
      });
    }

    try {
      // Find or create requesting user
      const { user: requestingUser, isNew: isNewRequestingUser } = await db.userCore.findOrCreateByPlatformId(
        requestingPlatform,
        requestingPlatformId,
        { lastSeenPlatform: requestingPlatform }
      );

      if (!requestingUser || !requestingUser._id) {
        return res.status(500).json({
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to find or create requesting user.',
            requestId
          }
        });
      }

      // Check if user is banned from making link requests
      const linkRequestBan = requestingUser.linkRequestBan;
      if (linkRequestBan && linkRequestBan.banned) {
        const banExpiresAt = linkRequestBan.expiresAt ? new Date(linkRequestBan.expiresAt) : null;
        const isPermanent = !banExpiresAt;
        const isExpired = banExpiresAt && banExpiresAt < new Date();
        
        if (!isExpired) {
          const banReason = linkRequestBan.reason || 'Abuse of platform linking feature';
          const expiresInfo = isPermanent ? 'permanently' : `until ${banExpiresAt.toLocaleString()}`;
          
          logger.warn(`[userCoreApi] Banned user attempted to create link request. User: ${requestingUser._id}, Ban expires: ${expiresInfo}`);
          
          return res.status(403).json({
            error: {
              code: 'LINK_REQUEST_BANNED',
              message: `You are banned from making link requests ${expiresInfo}. Reason: ${banReason}`,
              requestId,
              banExpiresAt: banExpiresAt?.toISOString() || null,
              isPermanent
            }
          });
        } else {
          // Ban expired, remove it
          logger.info(`[userCoreApi] Link request ban expired for user ${requestingUser._id}, removing ban.`);
          await db.userCore.updateUserCore(requestingUser._id, {
            $unset: { linkRequestBan: '' }
          });
        }
      }

      // Normalize wallet address
      const normalizedWalletAddress = walletAddress.toLowerCase();

      // Find user by wallet address
      const targetUser = await db.userCore.findUserCoreByWalletAddress(normalizedWalletAddress);

      if (!targetUser) {
        return res.status(404).json({
          error: {
            code: 'WALLET_NOT_FOUND',
            message: 'No account found with this wallet address.',
            requestId
          }
        });
      }

      // Check if platform is already linked
      const targetPlatforms = targetUser.platformIdentities || {};
      if (targetPlatforms[requestingPlatform] === requestingPlatformId) {
        return res.status(409).json({
          error: {
            code: 'PLATFORM_ALREADY_LINKED',
            message: `Platform ${requestingPlatform} is already linked to this account.`,
            requestId
          }
        });
      }

      // Rate limiting: Check total pending requests from this user
      const existingRequests = await db.platformLinkRequests.findPendingByRequestingPlatform(
        requestingPlatform,
        requestingPlatformId
      );
      
      // Limit to 5 pending requests per user to prevent spam
      const MAX_PENDING_REQUESTS = 5;
      if (existingRequests.length >= MAX_PENDING_REQUESTS) {
        return res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `You have too many pending requests (${existingRequests.length}/${MAX_PENDING_REQUESTS}). Please cancel some requests or wait for them to be processed.`,
            requestId,
            pendingCount: existingRequests.length,
            maxAllowed: MAX_PENDING_REQUESTS
          }
        });
      }

      // Check for duplicate request to the same wallet
      const duplicateRequest = existingRequests.find(
        req => req.targetMasterAccountId.toString() === targetUser._id.toString()
      );

      if (duplicateRequest) {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_REQUEST',
            message: 'A pending link request already exists for this wallet.',
            requestId: duplicateRequest.requestId,
            requestId
          }
        });
      }

      // Create link request
      const linkRequest = await db.platformLinkRequests.createRequest({
        requestingPlatform,
        requestingPlatformId,
        requestingMasterAccountId: requestingUser._id,
        targetWalletAddress: normalizedWalletAddress,
        targetMasterAccountId: targetUser._id,
        expiresInHours: 48
      });

      if (!linkRequest) {
        return res.status(500).json({
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to create link request.',
            requestId
          }
        });
      }

      // TODO: Send approval message to target platform user
      // This will be handled by platform-specific handlers
      // For now, we'll return the request and let the caller handle notification

      logger.info(`[userCoreApi] Platform link request created. RequestId: ${linkRequest.requestId}, Target: ${targetUser._id}`);
      
      // Log target user structure for debugging
      logger.debug(`[userCoreApi] Target user structure:`, {
        _id: targetUser._id?.toString(),
        hasPlatformIdentities: !!targetUser.platformIdentities,
        platformIdentities: targetUser.platformIdentities,
        platformIdentitiesKeys: Object.keys(targetUser.platformIdentities || {}),
        platformIdentitiesType: typeof targetUser.platformIdentities,
        hasWallets: !!targetUser.wallets,
        walletCount: targetUser.wallets?.length || 0
      });

      // Send approval request notification to target platform user
      const notificationService = getNotificationService();
      if (notificationService) {
        logger.debug(`[userCoreApi] Notification service available. Attempting to send notification for request ${linkRequest.requestId}`);
        logger.debug(`[userCoreApi] Target user platforms: ${JSON.stringify(Object.keys(targetUser.platformIdentities || {}))}`);
        logger.debug(`[userCoreApi] Full platformIdentities object: ${JSON.stringify(targetUser.platformIdentities)}`);
        try {
          const notificationResult = await notificationService.sendApprovalRequestNotification(
            linkRequest,
            targetUser,
            requestingUser
          );
          if (notificationResult) {
            logger.info(`[userCoreApi] Approval request notification sent successfully for request ${linkRequest.requestId}`);
          } else {
            logger.warn(`[userCoreApi] Notification service returned false for request ${linkRequest.requestId}. Notification may not have been sent.`);
          }
        } catch (notifError) {
          // Non-fatal: log error but don't fail the request creation
          logger.error(`[userCoreApi] Failed to send approval request notification: ${notifError.message}`, notifError);
          logger.error(`[userCoreApi] Notification error stack:`, notifError.stack);
        }
      } else {
        logger.warn(`[userCoreApi] Notification service not available. Cannot send notification for request ${linkRequest.requestId}`);
        logger.warn(`[userCoreApi] Dependencies object keys: ${Object.keys(dependencies).join(', ')}`);
        logger.warn(`[userCoreApi] dependencies.platformNotifiers: ${JSON.stringify(dependencies.platformNotifiers)}`);
      }

      // Get target user's platform identities for notification (reuse targetPlatforms from above)
      const targetPlatformNames = Object.keys(targetPlatforms);

      res.status(201).json({
        requestId: linkRequest.requestId,
        status: linkRequest.status,
        expiresAt: linkRequest.expiresAt,
        targetPlatform: targetPlatformNames[0] || 'unknown',
        targetPlatforms: targetPlatformNames,
        targetMasterAccountId: targetUser._id.toString(),
        requestingPlatform: requestingPlatform,
        requestingPlatformId: requestingPlatformId,
        requestingUsername: requestingUser.platformContext?.username || requestingUser.platformContext?.firstName || 'Unknown',
        message: 'Link request created. Waiting for approval.',
        // Include full link request for notification handlers
        linkRequest: {
          requestId: linkRequest.requestId,
          requestingPlatform,
          requestingPlatformId,
          targetWalletAddress: normalizedWalletAddress,
          targetMasterAccountId: targetUser._id.toString(),
          expiresAt: linkRequest.expiresAt
        }
      });

    } catch (error) {
      logger.error(`[userCoreApi] POST /request-platform-link error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while creating the link request.',
          requestId
        }
      });
    }
  });

  // POST /users/link-requests/:requestId/approve
  router.post('/link-requests/:requestId/approve', async (req, res) => {
    const requestId = uuidv4();
    const { requestId: linkRequestId } = req.params;
    const { masterAccountId } = req.body;

    logger.debug(`[userCoreApi] POST /link-requests/${linkRequestId}/approve called. RequestId: ${requestId}`);

    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid masterAccountId format.',
          requestId
        }
      });
    }

    if (!db.platformLinkRequests) {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Platform linking service is not available.',
          requestId
        }
      });
    }

    try {
      // Find link request
      const linkRequest = await db.platformLinkRequests.findByRequestId(linkRequestId);

      if (!linkRequest) {
        return res.status(404).json({
          error: {
            code: 'REQUEST_NOT_FOUND',
            message: 'Link request not found.',
            requestId
          }
        });
      }

      // Verify request is pending
      if (linkRequest.status !== 'pending') {
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST_STATE',
            message: `Request is already ${linkRequest.status}.`,
            requestId
          }
        });
      }

      // Verify request is not expired
      if (new Date() > new Date(linkRequest.expiresAt)) {
        await db.platformLinkRequests.updateRequestStatus(linkRequestId, 'expired');
        return res.status(400).json({
          error: {
            code: 'REQUEST_EXPIRED',
            message: 'Link request has expired.',
            requestId
          }
        });
      }

      // Verify masterAccountId matches target user
      const approverId = new ObjectId(masterAccountId);
      if (linkRequest.targetMasterAccountId.toString() !== approverId.toString()) {
        return res.status(403).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'You are not authorized to approve this request.',
            requestId
          }
        });
      }

      // Get requesting user to link platform
      const requestingUser = await db.userCore.findUserCoreById(linkRequest.requestingMasterAccountId);
      if (!requestingUser) {
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'Requesting user not found.',
            requestId
          }
        });
      }

      // Link platform to target user's account
      await db.userCore.addPlatformIdentity(
        linkRequest.targetMasterAccountId,
        linkRequest.requestingPlatform,
        linkRequest.requestingPlatformId
      );

      // Update request status
      await db.platformLinkRequests.updateRequestStatus(linkRequestId, 'approved', {
        approvedAt: new Date()
      });

      // Get updated target user
      const updatedTargetUser = await db.userCore.findUserCoreById(linkRequest.targetMasterAccountId);

      logger.info(`[userCoreApi] Platform link request approved. RequestId: ${linkRequestId}, Platform: ${linkRequest.requestingPlatform}`);

      // Get requesting user info for notification
      const requestingUserInfo = {
        platform: linkRequest.requestingPlatform,
        platformId: linkRequest.requestingPlatformId,
        masterAccountId: linkRequest.requestingMasterAccountId.toString()
      };

      // Send success notifications to both users
      const notificationService = getNotificationService();
      if (notificationService) {
        try {
          await notificationService.sendApprovalSuccessNotifications(
            linkRequest,
            updatedTargetUser,
            requestingUser
          );
          logger.info(`[userCoreApi] Success notifications sent for approved request ${linkRequestId}`);
        } catch (notifError) {
          // Non-fatal: log error but don't fail the approval
          logger.error(`[userCoreApi] Failed to send approval success notifications: ${notifError.message}`, notifError);
        }
      }
      res.status(200).json({
        success: true,
        message: 'Platform linked successfully.',
        requestId: linkRequestId,
        linkedPlatform: linkRequest.requestingPlatform,
        masterAccountId: linkRequest.targetMasterAccountId.toString(),
        platformIdentities: updatedTargetUser.platformIdentities,
        // Include notification data
        notificationData: {
          requestingUser: requestingUserInfo,
          targetUser: {
            masterAccountId: linkRequest.targetMasterAccountId.toString(),
            platforms: Object.keys(updatedTargetUser.platformIdentities || {})
          }
        }
      });

    } catch (error) {
      logger.error(`[userCoreApi] POST /link-requests/${linkRequestId}/approve error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while approving the link request.',
          requestId
        }
      });
    }
  });

  // POST /users/link-requests/:requestId/reject
  router.post('/link-requests/:requestId/reject', async (req, res) => {
    const requestId = uuidv4();
    const { requestId: linkRequestId } = req.params;
    const { masterAccountId, reason } = req.body;

    logger.debug(`[userCoreApi] POST /link-requests/${linkRequestId}/reject called. RequestId: ${requestId}`);

    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid masterAccountId format.',
          requestId
        }
      });
    }

    if (!db.platformLinkRequests) {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Platform linking service is not available.',
          requestId
        }
      });
    }

    try {
      // Find link request
      const linkRequest = await db.platformLinkRequests.findByRequestId(linkRequestId);

      if (!linkRequest) {
        return res.status(404).json({
          error: {
            code: 'REQUEST_NOT_FOUND',
            message: 'Link request not found.',
            requestId
          }
        });
      }

      // Verify request is pending
      if (linkRequest.status !== 'pending') {
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST_STATE',
            message: `Request is already ${linkRequest.status}.`,
            requestId
          }
        });
      }

      // Verify masterAccountId matches target user
      const rejectorId = new ObjectId(masterAccountId);
      if (linkRequest.targetMasterAccountId.toString() !== rejectorId.toString()) {
        return res.status(403).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'You are not authorized to reject this request.',
            requestId
          }
        });
      }

      // Update request status
      await db.platformLinkRequests.updateRequestStatus(linkRequestId, 'rejected', {
        rejectedAt: new Date(),
        rejectionReason: reason || 'No reason provided'
      });

      logger.info(`[userCoreApi] Platform link request rejected. RequestId: ${linkRequestId}`);

      // Get requesting user info for notification
      const requestingUserInfo = {
        platform: linkRequest.requestingPlatform,
        platformId: linkRequest.requestingPlatformId,
        masterAccountId: linkRequest.requestingMasterAccountId.toString()
      };

      // Send rejection notification to requester
      const notificationService = getNotificationService();
      if (notificationService) {
        try {
          // Get requesting user for notification
          const requestingUser = await db.userCore.findUserCoreById(linkRequest.requestingMasterAccountId);
          if (requestingUser) {
            await notificationService.sendRejectionNotification(linkRequest, requestingUser);
            logger.info(`[userCoreApi] Rejection notification sent for request ${linkRequestId}`);
          }
        } catch (notifError) {
          // Non-fatal: log error but don't fail the rejection
          logger.error(`[userCoreApi] Failed to send rejection notification: ${notifError.message}`, notifError);
        }
      }
      res.status(200).json({
        success: true,
        message: 'Link request rejected.',
        requestId: linkRequestId,
        notificationData: {
          requestingUser: requestingUserInfo
        }
      });

    } catch (error) {
      logger.error(`[userCoreApi] POST /link-requests/${linkRequestId}/reject error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while rejecting the link request.',
          requestId
        }
      });
    }
  });

  // DELETE /users/link-requests/cancel-all
  router.delete('/link-requests/cancel-all', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId } = req.body;

    logger.debug(`[userCoreApi] DELETE /link-requests/cancel-all called. RequestId: ${requestId}`);

    try {
      if (!masterAccountId) {
        return res.status(400).json({
          error: {
            code: 'MISSING_MASTER_ACCOUNT_ID',
            message: 'masterAccountId is required.',
            requestId
          }
        });
      }

      // Find all pending requests for this user
      const allRequests = await db.platformLinkRequests.findByMasterAccountId(masterAccountId, 'pending');
      
      // Filter to only requests sent by this user (not received)
      const sentRequests = allRequests.filter(
        req => req.requestingMasterAccountId.toString() === masterAccountId
      );

      if (sentRequests.length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No pending requests to cancel.',
          cancelledCount: 0
        });
      }

      // Cancel all sent requests
      let cancelledCount = 0;
      for (const request of sentRequests) {
        try {
          await db.platformLinkRequests.updateRequestStatus(request.requestId, 'cancelled', {
            cancelledAt: new Date(),
            cancelledReason: 'Bulk cancellation by user'
          });
          cancelledCount++;
        } catch (err) {
          logger.error(`[userCoreApi] Failed to cancel request ${request.requestId}:`, err);
        }
      }

      logger.info(`[userCoreApi] Cancelled ${cancelledCount} link requests for user ${masterAccountId}`);

      res.status(200).json({
        success: true,
        message: `Cancelled ${cancelledCount} pending request(s).`,
        cancelledCount
      });

    } catch (error) {
      logger.error(`[userCoreApi] DELETE /link-requests/cancel-all error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while cancelling requests.',
          requestId
        }
      });
    }
  });

  // DELETE /users/link-requests/:requestId/cancel
  router.delete('/link-requests/:requestId/cancel', async (req, res) => {
    const requestId = uuidv4();
    const { requestId: linkRequestId } = req.params;
    const { masterAccountId } = req.body;

    logger.debug(`[userCoreApi] DELETE /link-requests/${linkRequestId}/cancel called. RequestId: ${requestId}`);

    try {
      if (!masterAccountId) {
        return res.status(400).json({
          error: {
            code: 'MISSING_MASTER_ACCOUNT_ID',
            message: 'masterAccountId is required.',
            requestId
          }
        });
      }

      // Find the link request
      const linkRequest = await db.platformLinkRequests.findByRequestId(linkRequestId);
      if (!linkRequest) {
        return res.status(404).json({
          error: {
            code: 'REQUEST_NOT_FOUND',
            message: 'Link request not found.',
            requestId
          }
        });
      }

      // Verify masterAccountId matches requesting user (only requester can cancel)
      const requesterId = new ObjectId(masterAccountId);
      if (linkRequest.requestingMasterAccountId.toString() !== requesterId.toString()) {
        return res.status(403).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'You can only cancel your own link requests.',
            requestId
          }
        });
      }

      // Check if request is still pending
      if (linkRequest.status !== 'pending') {
        return res.status(400).json({
          error: {
            code: 'INVALID_REQUEST_STATE',
            message: `Request is already ${linkRequest.status} and cannot be cancelled.`,
            requestId
          }
        });
      }

      // Update request status to cancelled
      await db.platformLinkRequests.updateRequestStatus(linkRequestId, 'cancelled', {
        cancelledAt: new Date()
      });

      logger.info(`[userCoreApi] Platform link request cancelled. RequestId: ${linkRequestId}`);

      res.status(200).json({
        success: true,
        message: 'Link request cancelled successfully.',
        requestId: linkRequestId
      });
    } catch (error) {
      logger.error(`[userCoreApi] DELETE /link-requests/${linkRequestId}/cancel error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while cancelling the request.',
          requestId
        }
      });
    }
  });

  // POST /users/link-requests/ban - Admin endpoint to ban a user from making link requests
  router.post('/link-requests/ban', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId, reason, expiresInHours } = req.body;
    // TODO: Add admin authentication check

    logger.debug(`[userCoreApi] POST /link-requests/ban called. RequestId: ${requestId}`);

    try {
      if (!masterAccountId) {
        return res.status(400).json({
          error: {
            code: 'MISSING_MASTER_ACCOUNT_ID',
            message: 'masterAccountId is required.',
            requestId
          }
        });
      }

      // Find the user
      const user = await db.userCore.findUserCoreById(masterAccountId);
      if (!user) {
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found.',
            requestId
          }
        });
      }

      // Calculate expiration date
      const bannedAt = new Date();
      const expiresAt = expiresInHours 
        ? new Date(bannedAt.getTime() + expiresInHours * 60 * 60 * 1000)
        : null; // null = permanent ban

      // Update user with ban
      const banData = {
        banned: true,
        bannedAt,
        expiresAt,
        reason: reason || 'Abuse of platform linking feature',
        bannedBy: 'admin' // TODO: Get actual admin user ID
      };

      await db.userCore.updateUserCore(masterAccountId, {
        $set: { linkRequestBan: banData }
      });

      logger.info(`[userCoreApi] User ${masterAccountId} banned from link requests. Expires: ${expiresAt ? expiresAt.toISOString() : 'permanently'}`);

      res.status(200).json({
        success: true,
        message: 'User banned from making link requests.',
        masterAccountId,
        ban: banData
      });

    } catch (error) {
      logger.error(`[userCoreApi] POST /link-requests/ban error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while banning user.',
          requestId
        }
      });
    }
  });

  // POST /users/link-requests/unban - Admin endpoint to unban a user
  router.post('/link-requests/unban', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId } = req.body;
    // TODO: Add admin authentication check

    logger.debug(`[userCoreApi] POST /link-requests/unban called. RequestId: ${requestId}`);

    try {
      if (!masterAccountId) {
        return res.status(400).json({
          error: {
            code: 'MISSING_MASTER_ACCOUNT_ID',
            message: 'masterAccountId is required.',
            requestId
          }
        });
      }

      // Find the user
      const user = await db.userCore.findUserCoreById(masterAccountId);
      if (!user) {
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found.',
            requestId
          }
        });
      }

      // Remove ban
      await db.userCore.updateUserCore(masterAccountId, {
        $unset: { linkRequestBan: '' }
      });

      logger.info(`[userCoreApi] User ${masterAccountId} unbanned from link requests.`);

      res.status(200).json({
        success: true,
        message: 'User unbanned from making link requests.',
        masterAccountId
      });

    } catch (error) {
      logger.error(`[userCoreApi] POST /link-requests/unban error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while unbanning user.',
          requestId
        }
      });
    }
  });

  // POST /users/link-requests/:requestId/report - Report a suspicious link request
  router.post('/link-requests/:requestId/report', async (req, res) => {
    const requestId = uuidv4();
    const { requestId: linkRequestId } = req.params;
    const { masterAccountId, reason } = req.body;

    logger.debug(`[userCoreApi] POST /link-requests/${linkRequestId}/report called. RequestId: ${requestId}`);

    try {
      if (!masterAccountId) {
        return res.status(400).json({
          error: {
            code: 'MISSING_MASTER_ACCOUNT_ID',
            message: 'masterAccountId is required.',
            requestId
          }
        });
      }

      // Find the link request
      const linkRequest = await db.platformLinkRequests.findByRequestId(linkRequestId);
      if (!linkRequest) {
        return res.status(404).json({
          error: {
            code: 'REQUEST_NOT_FOUND',
            message: 'Link request not found.',
            requestId
          }
        });
      }

      // Verify the reporter is the target user (only target can report)
      const reporterId = new ObjectId(masterAccountId);
      if (linkRequest.targetMasterAccountId.toString() !== reporterId.toString()) {
        return res.status(403).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Only the target user can report this request.',
            requestId
          }
        });
      }

      // Update request with report
      await db.platformLinkRequests.updateRequestStatus(linkRequestId, linkRequest.status, {
        reported: true,
        reportedAt: new Date(),
        reportReason: reason || 'Suspicious activity',
        reportedBy: masterAccountId
      });

      logger.warn(`[userCoreApi] Link request ${linkRequestId} reported by user ${masterAccountId}. Reason: ${reason || 'Suspicious activity'}`);

      // Check if requester has multiple reports (auto-ban logic)
      const allRequests = await db.platformLinkRequests.findByMasterAccountId(
        linkRequest.requestingMasterAccountId,
        null // all statuses
      );
      const reportedCount = allRequests.filter(req => req.reported === true).length;
      
      // Auto-ban after 3 reports
      const AUTO_BAN_THRESHOLD = 3;
      if (reportedCount >= AUTO_BAN_THRESHOLD) {
        const requestingUser = await db.userCore.findUserCoreById(linkRequest.requestingMasterAccountId);
        if (requestingUser && (!requestingUser.linkRequestBan || !requestingUser.linkRequestBan.banned)) {
          const banData = {
            banned: true,
            bannedAt: new Date(),
            expiresAt: null, // Permanent ban after multiple reports
            reason: `Automatic ban: ${reportedCount} link requests reported as suspicious`,
            bannedBy: 'system'
          };
          
          await db.userCore.updateUserCore(linkRequest.requestingMasterAccountId, {
            $set: { linkRequestBan: banData }
          });
          
          logger.warn(`[userCoreApi] Auto-banned user ${linkRequest.requestingMasterAccountId} from link requests after ${reportedCount} reports.`);
        }
      }

      res.status(200).json({
        success: true,
        message: 'Link request reported.',
        requestId: linkRequestId,
        reportedCount,
        autoBanned: reportedCount >= AUTO_BAN_THRESHOLD
      });

    } catch (error) {
      logger.error(`[userCoreApi] POST /link-requests/${linkRequestId}/report error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while reporting the request.',
          requestId
        }
      });
    }
  });

  // GET /users/:masterAccountId/link-requests
  router.get('/:masterAccountId/link-requests', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId } = req.params;
    const { status } = req.query;

    logger.debug(`[userCoreApi] GET /users/${masterAccountId}/link-requests called. Status filter: ${status || 'all'}`);

    if (!masterAccountId || !ObjectId.isValid(masterAccountId)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid masterAccountId format.',
          requestId
        }
      });
    }

    if (!db.platformLinkRequests) {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Platform linking service is not available.',
          requestId
        }
      });
    }

    try {
      const requests = await db.platformLinkRequests.findByMasterAccountId(
        masterAccountId,
        status || null
      );

      // Separate sent and received requests
      const sentRequests = requests.filter(req => 
        req.requestingMasterAccountId.toString() === masterAccountId
      );
      const receivedRequests = requests.filter(req => 
        req.targetMasterAccountId.toString() === masterAccountId
      );

      res.status(200).json({
        sent: sentRequests,
        received: receivedRequests,
        total: requests.length
      });

    } catch (error) {
      logger.error(`[userCoreApi] GET /users/${masterAccountId}/link-requests error: ${error.message}`, error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred while retrieving link requests.',
          requestId
        }
      });
    }
  });

  logger.debug('[userCoreApi] User Core API service router configured.');
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