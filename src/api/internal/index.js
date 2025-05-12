/**
 * Internal API Services
 * 
 * Exports all internal API services for use within the application
 */

const express = require('express');
const createStatusService = require('./status');
const userCoreApi = require('./userCoreApi');
const userSessionsApi = require('./userSessionsApi');
const userEventsApi = require('./userEventsApi');
const createTransactionsApiService = require('./transactionsApi');
const createGenerationOutputsApiService = require('./generationOutputsApi');

// Placeholder imports for new API service modules
// const createUserSessionsApiService = require('./userSessionsApiService');
// ... other service imports

/**
 * Initialize and export all internal API services and their router
 * @param {Object} dependencies - Shared dependencies for services (logger, appStartTime, version, db)
 * @returns {Object} - Object containing initialized services (like status) and the main internal API router
 */
function initializeInternalServices(dependencies = {}) {
  const mainInternalRouter = express.Router();

  const logger = dependencies.logger || console;
  const dbDataServices = dependencies.db?.data;

  if (!dbDataServices) {
    logger.error('[InternalAPI] Database services (dependencies.db.data) not found. API services requiring DB will likely fail.');
    // Consider returning an error router immediately
  }

  // Create a dependencies object specifically for the API services
  const apiDependencies = {
      logger: logger,
      db: dbDataServices, // Use the extracted dbDataServices which contains userCore, userSessions etc.
      // Pass other relevant top-level dependencies if needed
      appStartTime: dependencies.appStartTime,
      version: dependencies.version
  };

  // Pass the correctly structured apiDependencies to the service routers

  // Status API (Example adjustment - check how statusApi uses dependencies)
  // Assuming statusApi also expects logger and db directly
  // const statusApiRouter = statusApi(apiDependencies); 
  // if (statusApiRouter) { ... }
  // CURRENT STATUS API MOUNTING SEEMS DIFFERENT - review if needed
  const statusService = createStatusService({
    logger,
    version: dependencies.version,
    appStartTime: dependencies.appStartTime || new Date(),
    db: dbDataServices // Pass dbDataServices here too
  });

  if (statusService && typeof statusService.getStatus === 'function') {
    mainInternalRouter.get('/status', statusService.getStatus);
  } else if (statusService && typeof statusService.router === 'function') {
    mainInternalRouter.use('/status', statusService.router);
  } else {
    logger.warn('[InternalAPI] Status service structure not recognized for automatic routing.');
  }

  // --- Initialize and Mount New Data API Services ---

  // User Core API Service:
  if (userCoreApi) {
    const userCoreApiRouter = userCoreApi(apiDependencies); // Pass apiDependencies
    if (userCoreApiRouter) {
      mainInternalRouter.use('/v1/data/users', userCoreApiRouter);
      logger.info('[InternalAPI] User Core API service mounted to /v1/data/users');
    } else {
      logger.error('[InternalAPI] Failed to create User Core API router.');
    }
  } else {
    logger.warn('[InternalAPI] userCoreApi not imported correctly.');
  }

  // User Sessions API Service:
  if (userSessionsApi) {
    const userSessionsApiRouter = userSessionsApi(apiDependencies);
    if (userSessionsApiRouter) {
      mainInternalRouter.use('/v1/data/sessions', userSessionsApiRouter);
      logger.info('[InternalAPI] User Sessions API service mounted to /v1/data/sessions');
    } else {
      logger.error('[InternalAPI] Failed to create User Sessions API router.');
    }
  } else {
    logger.warn('[InternalAPI] userSessionsApi not imported correctly.');
  }

  // User Events API Service:
  if (userEventsApi) {
    const userEventsApiRouter = userEventsApi(apiDependencies);
    if (userEventsApiRouter) {
      mainInternalRouter.use('/v1/data/events', userEventsApiRouter);
      logger.info('[InternalAPI] User Events API service mounted to /v1/data/events');
    } else {
      logger.error('[InternalAPI] Failed to create User Events API router.');
    }
  } else {
    logger.warn('[InternalAPI] userEventsApi not imported correctly.');
  }

  // Transactions API Service:
  if (createTransactionsApiService) {
    const transactionsApiRouter = createTransactionsApiService(apiDependencies);
    if (transactionsApiRouter) {
      mainInternalRouter.use('/v1/data/transactions', transactionsApiRouter);
      logger.info('[internalApiIndex] Transactions API service mounted to /v1/data/transactions');
    } else {
      logger.error('[internalApiIndex] Failed to create Transactions API router.');
    }
  } else {
    logger.warn('[internalApiIndex] transactionsApi not imported correctly.');
  }

  // Generation Outputs API Service:
  if (createGenerationOutputsApiService) {
    const generationOutputsApiRouter = createGenerationOutputsApiService(apiDependencies);
    if (generationOutputsApiRouter) {
      mainInternalRouter.use('/v1/data/generations', generationOutputsApiRouter);
      logger.info('[internalApiIndex] Generation Outputs API service mounted to /v1/data/generations');
    } else {
      logger.error('[internalApiIndex] Failed to create Generation Outputs API router.');
    }
  } else {
    logger.warn('[internalApiIndex] generationOutputsApi not imported correctly.');
  }

  // User Economy API Service:
  // MOVED to userCoreApi.js - Remove this mounting
  /*
  if (createUserEconomyApiService) {
    const userEconomyApiRouter = createUserEconomyApiService(apiDependencies);
    if (userEconomyApiRouter) {
      mainInternalRouter.use('/users/:masterAccountId/economy', userEconomyApiRouter);
      logger.info('[internalApiIndex] User Economy API service mounted to /users/:masterAccountId/economy');
    } else {
      logger.error('[internalApiIndex] Failed to create User Economy API router.');
    }
  } else {
    logger.warn('[internalApiIndex] userEconomyApi not imported correctly.');
  }
  */

  // ... (placeholders for other services: economy, etc.)

  // --- Global Error Handling ---
  // Catch-all for 404 Not Found on the internal API path
  mainInternalRouter.use((req, res, next) => {
    logger.warn(`[InternalAPI] 404 Not Found - ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Internal API endpoint not found.' } });
  });

  // Generic error handler
  mainInternalRouter.use((err, req, res, next) => {
    const requestId = req.id || 'N/A'; // Assuming request ID middleware is used
    logger.error(`[InternalAPI] Unhandled error on ${req.method} ${req.originalUrl}. RequestID: ${requestId}`, err);

    // Avoid sending detailed stack traces in production
    const errorResponse = {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected internal server error occurred.',
        requestId: requestId
      }
    };

    res.status(500).json(errorResponse);
  });

  logger.info('[InternalAPI] Internal API router fully initialized.');

  return {
    status: statusService, 
    router: mainInternalRouter 
  };
}

module.exports = initializeInternalServices; 