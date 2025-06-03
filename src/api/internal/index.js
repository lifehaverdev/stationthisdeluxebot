/**
 * Internal API Services
 * 
 * Exports all internal API services for use within the application
 */

const express = require('express');
const axios = require('axios');
const createStatusService = require('./status');
const userCoreApi = require('./userCoreApi');
const userSessionsApi = require('./userSessionsApi');
const userEventsApi = require('./userEventsApi');
const createTransactionsApiService = require('./transactionsApi');
const createGenerationOutputsApiService = require('./generationOutputsApi');
const createTeamServiceDb = require('../../core/services/db/teamServiceDb');
const createTeamsApi = require('./teamsApi');
const { createToolDefinitionApiRouter } = require('./toolDefinitionApi');

// BEGIN ADDITION: Import LoRA Trigger Map API Router
const loraTriggerMapApiRouter = require('./loraTriggerMapApi');
// END ADDITION

// Placeholder imports for new API service modules
// const createUserSessionsApiService = require('./userSessionsApiService');
const createUserStatusReportApiService = require('./userStatusReportApi');
// ... other service imports

// ++ NEW LORAS API ROUTER IMPORT ++
const lorasApiRouter = require('./lorasApi');
// -- END NEW LORAS API ROUTER IMPORT --

// ++ NEW USER LORA FAVORITES API ROUTER IMPORT ++
// const userLoraFavoritesApiRouter = require('./userLoraFavoritesApi'); // REMOVE THIS OLD IMPORT
// -- END NEW USER LORA FAVORITES API ROUTER IMPORT --

/**
 * Initialize and export all internal API services and their router
 * @param {Object} dependencies - Shared dependencies for services (logger, appStartTime, version, db)
 * @returns {Object} - Object containing initialized services (like status), the main internal API router, and an API client
 */
function initializeInternalServices(dependencies = {}) {
  const mainInternalRouter = express.Router();

  const logger = dependencies.logger || console;
  const dbDataServices = dependencies.db?.data;

  // Determine the base URL for the internal API client
  // This should ideally come from environment variables or a central config
  logger.info(`[InternalAPIClientConfig] Current process.env.PORT: ${process.env.PORT}`);
  logger.info(`[InternalAPIClientConfig] Current process.env.INTERNAL_API_BASE_URL: ${process.env.INTERNAL_API_BASE_URL}`);
  const internalApiBaseUrl = process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 4000}/internal`;
  logger.info(`[InternalAPIClient] Base URL configured to: ${internalApiBaseUrl}`);

  // Log the value of the admin API key
  logger.info(`[InternalAPIClientConfig] Value of process.env.INTERNAL_API_KEY_ADMIN: "${process.env.INTERNAL_API_KEY_ADMIN}"`);

  // Create an Axios instance for the internal API
  const apiClient = axios.create({
    baseURL: internalApiBaseUrl,
    timeout: process.env.INTERNAL_API_TIMEOUT_MS || 10000, // Default 10 seconds
    headers: {
      // The X-Internal-Client-Key will be set by the CALLER of this client,
      // as the key depends on which service is making the call (e.g., Telegram backend, Web backend)
      'Content-Type': 'application/json',
      'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_ADMIN // Add default admin key
    }
  });

  // Optional: Add request/response interceptors for logging or error handling
  apiClient.interceptors.request.use(request => {
    logger.debug(`[InternalAPIClient] Sending request to: ${request.method?.toUpperCase()} ${request.url}`, { headers: request.headers, data: request.data });
    return request;
  }, error => {
    logger.error('[InternalAPIClient] Request Error:', error.message);
    return Promise.reject(error);
  });

  apiClient.interceptors.response.use(response => {
    // logger.debug(`[InternalAPIClient] Received response from: ${response.config.method?.toUpperCase()} ${response.config.url}`, { status: response.status, data: response.data });
    return response;
  }, error => {
    if (error.response) {
      logger.error(`[InternalAPIClient] Response Error Status: ${error.response.status} from ${error.config.method?.toUpperCase()} ${error.config.url}`, { data: error.response.data, headers: error.response.headers });
    } else if (error.request) {
      logger.error(`[InternalAPIClient] No response received for request to ${error.config.method?.toUpperCase()} ${error.config.url}:`, error.message);
    } else {
      logger.error('[InternalAPIClient] Error setting up request:', error.message);
    }
    return Promise.reject(error);
  });

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
      version: dependencies.version,
      toolRegistry: dependencies.toolRegistry || require('../../core/tools/ToolRegistry').ToolRegistry.getInstance(), // Ensure toolRegistry is available
      // Pass internalApiClient if UserSettingsService in userPreferencesApi needs it explicitly
      // internalApiClient: apiClient, (defined later in this function)
      internalApiClient: apiClient // Added apiClient here
  };

  // Create an instance of teamServiceDb and add it to apiDependencies
  // This ensures that any API service needing teamServiceDb can access it.
  if (dbDataServices) { // only if db is available
    apiDependencies.teamServiceDb = createTeamServiceDb({ logger }); // Pass only logger
    // Pass userSettingsService if it was initialized here and needed by userPreferencesApi
    // apiDependencies.userSettingsService = getUserSettingsService({ toolRegistry: apiDependencies.toolRegistry, internalApiClient: apiClient /* or dedicated one */});
  } else {
    logger.warn('[InternalAPI] teamServiceDb not initialized because dbDataServices is not available.');
    // We might want to handle this more gracefully, but for now, teamsApi will get undefined for teamServiceDb
    // and should handle it (which it does by returning a 500 error router).
  }

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

  // User Status Report API Service:
  if (createUserStatusReportApiService) {
    const userStatusReportApiRouter = createUserStatusReportApiService(apiDependencies);
    if (userStatusReportApiRouter) {
      // The service itself handles /users/:masterAccountId/status-report
      // So we mount it at the base it expects.
      // Considering userCoreApi is at /v1/data/users, and this is also a user-centric data report.
      // The router in userStatusReportApi.js is defined as router.get('/users/:masterAccountId/status-report', ... )
      // So, it should be mounted at /v1/data path for the full URL to be /internal/v1/data/users/:masterAccountId/status-report
      mainInternalRouter.use('/v1/data', userStatusReportApiRouter); // Mount point
      logger.info('[InternalAPI] User Status Report API service mounted to /v1/data');
    } else {
      logger.error('[InternalAPI] Failed to create User Status Report API router.');
    }
  } else {
    logger.warn('[InternalAPI] createUserStatusReportApiService not imported correctly.');
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

  // Teams API Service:
  if (createTeamsApi) {
    // Pass teamServiceDb specifically if it was created
    const teamsApiRouter = createTeamsApi({ teamServiceDb: apiDependencies.teamServiceDb, logger });
    if (teamsApiRouter) {
      // Mounts routes like /v1/data/teams, /v1/data/users/:masterAccountId/teams
      mainInternalRouter.use('/v1/data', teamsApiRouter); 
      logger.info('[InternalAPI] Teams API service mounted to /v1/data');
    } else {
      logger.error('[InternalAPI] Failed to create Teams API router.');
    }
  } else {
    logger.warn('[InternalAPI] teamsApi not imported correctly.');
  }

  // User Preferences API (includes UserSettingsService logic):
  // Assuming userPreferencesApi.js exports a function that takes apiDependencies and returns a router
  // This router should handle routes like /users/:masterAccountId/preferences/:scope?
  const createUserPreferencesApiRouter = require('./userPreferencesApi'); // Correct import for the factory function
  if (createUserPreferencesApiRouter && typeof createUserPreferencesApiRouter === 'function') {
    const userPreferencesRouter = createUserPreferencesApiRouter(apiDependencies);
    if (userPreferencesRouter) {
      // Mount at /v1/data because it deals with user-specific data and preferences.
      // The routes within userPreferencesRouter will be relative to this.
      // E.g., /users/:masterAccountId/preferences/:scope becomes /internal/v1/data/users/:masterAccountId/preferences/:scope
      mainInternalRouter.use('/v1/data', userPreferencesRouter);
      logger.info('[InternalAPI] User Preferences API service (including settings) mounted to /v1/data');
    } else {
      logger.error('[InternalAPI] Failed to create User Preferences API router.');
    }
  } else {
    logger.warn('[InternalAPI] userPreferencesApi not imported correctly or is not a function.');
  }

  // BEGIN ADDITION: Mount LoRA Trigger Map API Router
  if (loraTriggerMapApiRouter) {
    // The loraTriggerMapApiRouter handles /lora/trigger-map-data internally
    // So we mount it at /v1/data for the full path to be /internal/v1/data/lora/trigger-map-data
    mainInternalRouter.use('/v1/data', loraTriggerMapApiRouter);
    logger.info('[InternalAPI] LoRA Trigger Map API service mounted to /v1/data');
  } else {
    logger.warn('[InternalAPI] loraTriggerMapApiRouter not imported correctly.');
  }
  // END ADDITION

  // Tool Definition API Service (New)
  if (createToolDefinitionApiRouter) {
    const toolDefinitionRouter = createToolDefinitionApiRouter(apiDependencies); // Pass apiDependencies
    if (toolDefinitionRouter) {
      mainInternalRouter.use('/v1/data/tools', toolDefinitionRouter);
      logger.info('[InternalAPI] Tool Definition API service mounted to /v1/data/tools');
    } else {
      logger.error('[InternalAPI] Failed to create Tool Definition API router.');
    }
  } else {
    logger.warn('[InternalAPI] createToolDefinitionApiRouter not imported correctly.');
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

  // Mount other specific internal APIs
  mainInternalRouter.use('/lora-trigger-map', loraTriggerMapApiRouter); // Path might be /lora/trigger-map-data or similar

  // ++ MOUNT NEW LORAS API ROUTER ++
  // Assuming we want it under /v1/data/loras
  mainInternalRouter.use('/loras', lorasApiRouter); 
  // -- END MOUNT NEW LORAS API ROUTER --

  // Mount Noema Data Service APIs & other user-specific APIs
  // It's common to group user-specific sub-routes under a main user route.
  // For example, if userCoreApiRouter handles /users/:masterAccountId/*
  // we might need to adjust how it's structured or add a new top-level router for users.

  // Assuming userCoreApiRouter already handles routes starting with /users/:masterAccountId/
  // If so, we would ideally add the new route *within* userCoreApiRouter or make userCoreApiRouter a parent.
  // For simplicity now, and if userCoreApiRouter is only for /users/find-or-create etc., 
  // we can mount it directly, but this path structure is a bit less standard if other /users/:id routes exist elsewhere.

  // Let's assume a structure where user-specific sub-routes are explicitly mounted:
  // mainInternalRouter.use('/users/:masterAccountId/preferences/lora-favorites', userLoraFavoritesApiRouter); // REMOVE THIS OLD MOUNTING

  // Make sure this doesn't conflict with how userCoreApiRouter is defined if it uses general /users/ path.
  // Example: if userCoreApiRouter is mounted at router.use('/users', userCoreApiRouter)
  // and it has routes like /:masterAccountId/profile, then the order of mounting might matter,
  // or more specific routes should be defined first.
  // For now, this explicit path should work.

  // Mount the User Preferences API router (which now includes LoRA favorites)
  // This router is designed to be mounted at /users/:masterAccountId
  const userPreferencesRouter = createUserPreferencesApiRouter(apiDependencies); 
  // userCoreApiRouter should ideally handle the /:masterAccountId part and then use userPreferencesRouter for /preferences/*
  // For example, inside userCoreApi.js:
  //   router.use('/:masterAccountId/preferences', createUserPreferencesApiRouter(dependencies));
  // However, if userCoreApiRouter is not structured for that, we mount userPreferencesRouter directly here for the specific path.
  // Let's refine this based on userCoreApi.js's actual structure if needed. 
  // For now, let's assume userCoreApi does NOT use up the whole /users/:masterAccountId path for itself exclusively.
  // So we can mount userPreferences specific to its needs.
  // The userPreferencesApi.js itself expects to be mounted on a route that already has :masterAccountId.
  mainInternalRouter.use('/users/:masterAccountId', userPreferencesRouter); 
  // This means routes in userPreferencesApi.js like /preferences/lora-favorites will become /users/:masterAccountId/preferences/lora-favorites

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
    router: mainInternalRouter,
    client: apiClient
  };
}

module.exports = initializeInternalServices; 