/**
 * Internal API Services
 * 
 * Exports all internal API services for use within the application
 */

const express = require('express');
const axios = require('axios');
const { createLogger } = require('../../utils/logger');
const { createRateLimitMiddleware } = require('../../utils/rateLimiter');
const createStatusService = require('./status');
const { createUserCoreApi, createUserEventsApi, createUserPreferencesApiRouter, createUserStatusReportApiService } = require('./users');
const { createTransactionsApiService, createPointsApi, createCreditLedgerApi, createUserEconomyApi, createRatesApiService } = require('./economy');
const { createGenerationOutputsApiService, createGenerationExecutionApi, createGenerationOutputsApi } = require('./generations');
// Removed deprecated Teams API and related DB service
const { createToolDefinitionApiRouter } = require('./toolDefinitionApi');
const { createModelsApiRouter } = require('./models');
const { loraTriggerMapApi, lorasApiRouter, loraImportRouter } = require('./loras');
// userPreferencesApi and userStatusReportApi now imported from './users' above
const createTrainingsApi = require('./trainingsApi');
const createSpellsApi = require('./spells'); // spells index now exports function
const { initializeLlmApi } = require('./llm');
const internalApiClient = require('../../utils/internalApiClient');
const initializeWalletsApi = require('./wallets'); // path updated after folder reorg
const { createAuthApi } = require('./auth');
const { createCookApi } = require('./cookApi');
const createReviewQueueApi = require('./reviewQueue/reviewQueueApi');
// createCreditLedgerApi and createPointsApi now from economy aggregator above
const { createStorageApi } = require('./storage'); // path updated after folder reorg
const generationExecutionApi = createGenerationExecutionApi; // from aggregator
const pointsApi = require('./economy/pointsApi');
const generationOutputsApi = createGenerationOutputsApi;
const { createSystemApi, createActionsApi } = require('./system');
const { createLogsApi } = require('./logsApi');
const createDatasetsApi = require('./datasetsApi');
const createCostCalculationApi = require('./costCalculationApi');
const createAnalyticsApi = require('./analyticsApi');
const createMarketplaceApi = require('./marketplaceApi');
const createUploadApi = require('./uploadApi');
const createEmbellishmentApi = require('./embellishmentApi');
// Placeholder imports for new API service modules
// const createUserSessionsApiService = require('./userSessionsApiService');

/**
 * Initialize and export all internal API services and their router
 * @param {Object} dependencies - Shared dependencies for services (logger, appStartTime, version, db)
 * @returns {Object} - Object containing initialized services (like status), the main internal API router, and an API client
 */
function initializeInternalServices(dependencies = {}) {
  const mainInternalRouter = express.Router();
  const v1DataRouter = express.Router();

  const logger = dependencies.logger || console;

  // General rate limiting for internal API: 100 requests per 15 minutes per IP
  // This provides basic DoS protection while allowing legitimate internal traffic
  const generalRateLimiter = createRateLimitMiddleware({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests to internal API. Please try again later.',
    // Skip rate limiting for health checks, status endpoints, and trusted internal clients
    skip: (req) => {
      const isStatusEndpoint = req.path === '/status' ||
        req.path === '/health' ||
        req.path.startsWith('/internal/v1/data/system/status');
      const hasInternalClientKey = Boolean(req.headers['x-internal-client-key']);
      const isLoopback =
        req.ip === '127.0.0.1' ||
        req.ip === '::ffff:127.0.0.1' ||
        req.ip === '::1';
      return isStatusEndpoint || hasInternalClientKey || isLoopback;
    }
  }, logger);

  // Apply general rate limiting to v1DataRouter
  v1DataRouter.use(generalRateLimiter);
  const dbDataServices = dependencies.db?.data;

  // Initialize logger for the internal API
  const internalLogger = createLogger('InternalAPI');

  // Retrieve the base URL for the internal API from environment variables,
  // falling back to a default for local development.
  const internalApiBaseUrl = process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;

  // Create an instance of the Axios-based API client for internal use.
  //const internalApiClient = internalApiClient(internalApiBaseUrl, 'InternalOnBehalfOf');

  // Middleware to enforce that requests to this API must originate from an allowed internal source.
  // It checks for a valid internal API key.
  function internalOnly(req, res, next) {
    // ... existing code ...
  }

  if (!dbDataServices) {
    logger.error('[InternalAPI] Database services (dependencies.db.data) not found. API services requiring DB will likely fail.');
    // Consider returning an error router immediately
  }

  // Create a dependencies object specifically for the API services
  const apiDependencies = {
      logger: logger,
      db: dbDataServices, // Use the extracted dbDataServices which contains userCore, userSessions etc.
      openai: dependencies.openai, // Pass down the openai service instance
      storageService: dependencies.storageService, // Pass down the storage service
      // Pass other relevant top-level dependencies if needed
      appStartTime: dependencies.appStartTime,
      version: dependencies.version,
      toolRegistry: dependencies.toolRegistry || require('../../core/tools/ToolRegistry').ToolRegistry.getInstance(), // Ensure toolRegistry is available
      userSettingsService: dependencies.userSettingsService, // Pass through the service
      comfyUIService: dependencies.comfyUIService, // Pass through the comfyUi service
      openaiService: dependencies.openai, // Pass through the openai service
      huggingfaceService: dependencies.huggingface, // Pass through the huggingface service
      loraResolutionService: dependencies.loraResolutionService, // Pass through the loraResolutionService
      // Pass internalApiClient if UserSettingsService in userPreferencesApi needs it explicitly
      // internalApiClient: apiClient, (defined later in this function)
      internalApiClient: internalApiClient,
      stringService: dependencies.stringService,
      spellsService: dependencies.spellsService, // Inject spellsService so spellsApi can cast spells
      workflowExecutionService: dependencies.workflowExecutionService,
      webSocketService: dependencies.webSocketService, // Pass through the webSocket service
      adminActivityService: dependencies.adminActivityService, // Pass through the admin activity service
      // --- Inject required backend services for pointsApi ---
      priceFeedService: dependencies.priceFeedService,
      creditService: dependencies.creditService,
      creditServices: dependencies.creditService, // keyed map for multichain support
      ethereumService: dependencies.ethereumService,
      ethereumServices: dependencies.ethereumService, // keyed map for multichain support
      nftPriceService: dependencies.nftPriceService,
      saltMiningService: dependencies.saltMiningService,
      // Platform notifiers for cross-platform notifications
      platformNotifiers: dependencies.platformNotifiers || {},
      collectionExportService: dependencies.collectionExportService,
      embellishmentTaskService: dependencies.embellishmentTaskService,
      datasetService: dependencies.datasetService,
      userService: dependencies.userService,
      trainingService: dependencies.trainingService,
      generationExecutionService: dependencies.generationExecutionService, // Phase 8
  };

  // Create an instance of teamServiceDb and add it to apiDependencies
  // This ensures that any API service needing teamServiceDb can access it.
  // Removed deprecated Teams API and related DB service

  // Pass the correctly structured apiDependencies to the service routers

  // Status API (Example adjustment - check how statusApi uses dependencies)
  // Assuming statusApi also expects logger and db directly
  // const statusApiRouter = statusApi(apiDependencies); 
  // if (statusApiRouter) { ... }
  // CURRENT STATUS API MOUNTING SEEMS DIFFERENT - review if needed
  const statusService = createStatusService(apiDependencies);

  if (statusService && typeof statusService.getStatus === 'function') {
    mainInternalRouter.get('/status', statusService.getStatus);
  } else if (statusService && typeof statusService.router === 'function') {
    mainInternalRouter.use('/status', statusService.router);
  } else {
    logger.warn('[InternalAPI] Status service structure not recognized for automatic routing.');
  }

  // Logs level control API
  mainInternalRouter.use('/v1/logs', createLogsApi());
  logger.debug('[InternalAPI] Logs API mounted at /v1/logs');

  // --- Initialize and Mount New Data API Services ---

  // Auth API Service:
  const authApiRouter = createAuthApi(apiDependencies);
  if (authApiRouter) {
    v1DataRouter.use('/auth', authApiRouter);
    logger.debug('[InternalAPI] Auth API service mounted to /v1/data/auth');
  } else {
    logger.error('[InternalAPI] Failed to create Auth API router.');
  }

  // Wallets API Service (for top-level lookups):
  // Initialize once and get both routers.
  const { walletsRouter, userScopedRouter: userScopedWalletsRouter } = initializeWalletsApi(apiDependencies);

  if (walletsRouter) {
    v1DataRouter.use('/wallets', walletsRouter);
    logger.debug('[InternalAPI] Wallets Lookup API service mounted to /v1/data/wallets');
  } else {
    logger.error('[InternalAPI] Failed to create Wallets Lookup API router.');
  }

  // Pass the user-scoped router to the UserCore service via dependencies.
  if (userScopedWalletsRouter) {
    apiDependencies.userScopedWalletsRouter = userScopedWalletsRouter;
  } else {
    logger.error('[InternalAPI] Failed to get userScopedWalletsRouter.');
  }

  // Groups API Service
  const createGroupsApi = require('./groups');
  const groupsApiRouter = createGroupsApi(apiDependencies);
  v1DataRouter.use('/groups', groupsApiRouter);
  logger.debug('[InternalAPI] Groups API service mounted to /v1/data/groups');

  // User Core API Service:
  const userCoreApiRouter = createUserCoreApi(apiDependencies);
  if (userCoreApiRouter) {
    v1DataRouter.use('/users', userCoreApiRouter);
    logger.debug('[InternalAPI] User Core API service mounted to /v1/data/users');
  } else {
    logger.error('[InternalAPI] Failed to create User Core API router.');
  }

  // User Events API Service:
  const userEventsApiRouter = createUserEventsApi(apiDependencies);
  if (userEventsApiRouter) {
    v1DataRouter.use('/events', userEventsApiRouter);
    logger.debug('[InternalAPI] User Events API service mounted to /v1/data/events');
  } else {
    logger.error('[InternalAPI] Failed to create User Events API router.');
  }

  // User Status Report API Service:
  const userStatusReportApiRouter = createUserStatusReportApiService(apiDependencies);
  if (userStatusReportApiRouter) {
    v1DataRouter.use('/', userStatusReportApiRouter);
    logger.debug('[InternalAPI] User Status Report API service mounted to /v1/data');
  } else {
    logger.error('[InternalAPI] Failed to create User Status Report API router.');
  }

  // Transactions API Service:
  const transactionsApiRouter = createTransactionsApiService(apiDependencies);
  if (transactionsApiRouter) {
    v1DataRouter.use('/transactions', transactionsApiRouter);
    logger.debug('[InternalAPI] Transactions API service mounted to /v1/data/transactions');
  } else {
    logger.error('[InternalAPI] Failed to create Transactions API router.');
  }

  // Costs API Service:
  try {
    const { createCostsApi } = require('./costs/costsApi');
    const costsApiRouter = createCostsApi(apiDependencies, logger);
    if (costsApiRouter) {
      v1DataRouter.use('/costs', costsApiRouter);
      logger.debug('[InternalAPI] Costs API service mounted to /v1/data/costs');
    } else {
      logger.error('[InternalAPI] Failed to create Costs API router.');
    }
  } catch (err) {
    logger.error('[InternalAPI] Error initializing or mounting Costs API:', err);
  }

  // Generation Outputs API Service:
  const generationOutputsApiRouter = createGenerationOutputsApiService(apiDependencies);
  if (generationOutputsApiRouter) {
    v1DataRouter.use('/generations', generationOutputsApiRouter);
    logger.debug('[InternalAPI] Generation Outputs API service mounted to /v1/data/generations');
  } else {
    logger.error('[InternalAPI] Failed to create Generation Outputs API router.');
  }

  // Models API Service:
  const modelsApiRouter = createModelsApiRouter(apiDependencies);
  if (modelsApiRouter) {
    v1DataRouter.use('/models', modelsApiRouter);
    logger.debug('[InternalAPI] Models API service mounted to /v1/data/models');
  } else {
    logger.error('[InternalAPI] Failed to create Models API router.');
  }

  // Storage API Service:
  const storageApiRouter = createStorageApi(apiDependencies);
  if (storageApiRouter) {
    v1DataRouter.use('/storage', storageApiRouter);
    logger.debug('[InternalAPI] Storage API service mounted to /v1/data/storage');
  } else {
    logger.error('[InternalAPI] Failed to create Storage API router.');
  }

  // Review Queue API
  const reviewQueueApiRouter = createReviewQueueApi(apiDependencies);
  if (reviewQueueApiRouter) {
    v1DataRouter.use('/review-queue', reviewQueueApiRouter);
    logger.debug('[InternalAPI] Review Queue API service mounted to /v1/data/review-queue');
  } else {
    logger.error('[InternalAPI] Failed to create Review Queue API router.');
  }

  // Points API Service:
  const pointsApiRouter = createPointsApi(apiDependencies);
  if (pointsApiRouter) {
      v1DataRouter.use('/points', pointsApiRouter);
      logger.debug('[InternalAPI] Points API service mounted to /v1/data/points');
  } else {
      logger.error('[InternalAPI] Failed to create Points API router.');
  }

  // Teams API Service:
  // Removed deprecated Teams API and related DB service

  // User Preferences API (includes UserSettingsService logic):
  // Assuming userPreferencesApi.js exports a function that takes apiDependencies and returns a router
  // This router should handle routes like /users/:masterAccountId/preferences/:scope?
  if (createUserPreferencesApiRouter && typeof createUserPreferencesApiRouter === 'function') {
    const userPreferencesRouter = createUserPreferencesApiRouter(apiDependencies);
    if (userPreferencesRouter) {
      v1DataRouter.use('/users/:masterAccountId', userPreferencesRouter);
      logger.debug('[InternalAPI] User Preferences API service (including settings) mounted to /v1/data/users/:masterAccountId');
    } else {
      logger.error('[InternalAPI] Failed to create User Preferences API router.');
    }
  } else {
    logger.warn('[InternalAPI] userPreferencesApi not imported correctly or is not a function.');
  }

  // Mount the LoRA Trigger Map API Router
  try {
    if (loraTriggerMapApi && loraTriggerMapApi.router) {
      v1DataRouter.use('/', loraTriggerMapApi.router);
      logger.debug('[InternalAPI] LoRA Trigger Map API service mounted.');
    } else {
      logger.error('[InternalAPI] LoRA trigger map router not found in ./loraTriggerMapApi');
    }
  } catch(e) {
    logger.error('[InternalAPI] Failed to mount LoRA trigger map router', e);
  }

  // Tool Definition API Service (New)
  let toolDefinitionRouter;
  try {
    toolDefinitionRouter = createToolDefinitionApiRouter(apiDependencies);
    if (toolDefinitionRouter) {
      v1DataRouter.use('/tools', toolDefinitionRouter);
      logger.debug('[InternalAPI] Tool Definition API service mounted to /v1/data/tools');
    } else {
      logger.error('[InternalAPI] createToolDefinitionApiRouter did not return a valid router. Value received:', toolDefinitionRouter);
    }
  } catch (err) {
    logger.error('[InternalAPI] Error initializing or mounting Tool Definition API:', err);
  }

  // Spells API Service (New)
  try {
    const spellsApiRouter = createSpellsApi(apiDependencies);
    if (spellsApiRouter) {
      v1DataRouter.use('/spells', spellsApiRouter);
      logger.debug('[InternalAPI] Spells API service mounted to /v1/data/spells');
    } else {
      logger.error('[InternalAPI] Failed to create Spells API router.');
    }
  } catch (err) {
    logger.error('[InternalAPI] Error initializing or mounting Spells API:', err);
  }

  // After Spells API mount, add Cook API mount
  try {
    const cookApiRouter = createCookApi(apiDependencies);
    if (cookApiRouter) {
      // New preferred mount path
      v1DataRouter.use('/collections', cookApiRouter);
      // Legacy mount for backward compatibility (to be removed after migration)
      v1DataRouter.use('/cook', cookApiRouter);
      logger.debug('[InternalAPI] Cook API service mounted to /v1/data/collections and /v1/data/cook (legacy)');
    } else {
      logger.error('[InternalAPI] Failed to create Cook API router.');
    }
  } catch (err) {
    logger.error('[InternalAPI] Error initializing or mounting Cook API:', err);
  }

  // Initialize and mount the LLM API within the data router
  const llmRouter = initializeLlmApi(apiDependencies);
  v1DataRouter.use('/llm', llmRouter);
  logger.debug('[InternalAPI] LLM API service mounted to /v1/data/llm');

  // Economy Rates API Service
  const ratesApiRouter = createRatesApiService(apiDependencies);
  if (ratesApiRouter) {
    v1DataRouter.use('/economy', ratesApiRouter);
    logger.debug('[InternalAPI] Economy Rates API service mounted to /v1/data/economy');
  } else {
    logger.error('[InternalAPI] Failed to create Economy Rates API router.');
  }

  // User Economy API Service:
  // MOVED to userCoreApi.js - Remove this mounting
  /*
  if (createUserEconomyApiService) {
    const userEconomyApiRouter = createUserEconomyApiService(apiDependencies);
    if (userEconomyApiRouter) {
      mainInternalRouter.use('/users/:masterAccountId/economy', userEconomyApiRouter);
      logger.debug('[internalApiIndex] User Economy API service mounted to /users/:masterAccountId/economy');
    } else {
      logger.error('[internalApiIndex] Failed to create User Economy API router.');
    }
  } else {
    logger.warn('[internalApiIndex] userEconomyApi not imported correctly.');
  }
  */

  // ... (placeholders for other services: economy, etc.)

  // Mount the consolidated v1DataRouter onto the mainInternalRouter
  mainInternalRouter.use('/v1/data', v1DataRouter);

  // Mount other specific internal APIs
  // Model Import API
  const modelImportRouter = require('./models/modelImportApi')(apiDependencies);
  if (modelImportRouter && typeof modelImportRouter === 'function') {
    v1DataRouter.use('/models', modelImportRouter);
    logger.debug('[InternalAPI] Model Import API mounted at /v1/data/models');
  }
  // mainInternalRouter.use('/lora-trigger-map', loraTriggerMapRouter); // REVOVED: Redundant mounting, already on v1DataRouter

  // ++ MOUNT NEW LORAS API ROUTER ++
  // Assuming we want it under /v1/data/loras
  try {
    if (lorasApiRouter && typeof lorasApiRouter === 'function') {
      v1DataRouter.use('/loras', lorasApiRouter);
      logger.debug('[InternalAPI] LoRAs API service mounted to /v1/data/loras');
    } else {
      logger.error('[InternalAPI] lorasApiRouter (from ./lorasApi.js) is not a valid router/function. Value received:', lorasApiRouter);
    }
  } catch (err) {
    logger.error('[InternalAPI] Error mounting LoRAs API router:', err);
  }
  // -- END MOUNT NEW LORAS API ROUTER --

  // Mount LoRA Import API Service
  if (loraImportRouter && typeof loraImportRouter === 'function') {
    v1DataRouter.use('/loras', loraImportRouter);
    logger.debug('[InternalAPI] LoRA Import API service mounted to /v1/data/loras (handling /import-from-url internally)');
  } else {
    logger.error('[InternalAPI] Failed to create LoRA Import API router.');
  }

  // Trainings API Service:
  const trainingsApiRouter = createTrainingsApi(apiDependencies);
  if (trainingsApiRouter) {
    v1DataRouter.use('/trainings', trainingsApiRouter);
    logger.debug('[InternalAPI] Trainings API service mounted to /v1/data/trainings');
  } else {
    logger.error('[InternalAPI] Failed to create Trainings API router.');
  }

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

  // Mount LoRA Import API Service
  if (loraImportRouter && typeof loraImportRouter === 'function') {
    v1DataRouter.use('/loras', loraImportRouter);
    logger.debug('[InternalAPI] LoRA Import API service mounted to /v1/data/loras (handling /import-from-url internally)');
  } else {
    logger.error('[InternalAPI] Failed to create LoRA Import API router.');
  }

  // Mount credit ledger routes
  v1DataRouter.use('/ledger', createCreditLedgerApi(apiDependencies, logger));

  // Mount generations routes
  v1DataRouter.use('/generations', generationOutputsApi);

  // Mount points routes
  v1DataRouter.use('/points', pointsApi(apiDependencies));

  // Mount generation execution routes
  v1DataRouter.use('/execute', generationExecutionApi(apiDependencies));

  // Mount actions routes
  const actionsApiRouter = createActionsApi(apiDependencies);
  if (actionsApiRouter) {
    v1DataRouter.use('/actions', actionsApiRouter);
    logger.debug('[InternalAPI] Actions API service mounted to /v1/actions');
  } else {
    logger.error('[InternalAPI] Failed to create Actions API router.');
  }

  // Workspaces API Service:
  const { createWorkspacesApi } = require('./workspacesApi');
  try {
    const workspacesRouter = createWorkspacesApi(apiDependencies);
    v1DataRouter.use('/workspaces', workspacesRouter);
    logger.debug('[InternalAPI] Workspaces API mounted to /v1/data/workspaces');
  } catch(err){ logger.error('[InternalAPI] Failed to init Workspaces API', err); }

  // Embellishment API Service (must be mounted BEFORE datasets API to handle /datasets/:id/embellishments routes):
  try {
    const embellishmentApi = createEmbellishmentApi({
      logger,
      db: dbDataServices,
      embellishmentTaskService: apiDependencies.embellishmentTaskService,
    });
    if (embellishmentApi) {
      v1DataRouter.use('/', embellishmentApi);
      logger.debug('[InternalAPI] Embellishment API service mounted to /v1/data (before datasets)');
    } else {
      logger.error('[InternalAPI] Failed to create Embellishment API router.');
    }
  } catch (err) {
    logger.error('[InternalAPI] Error creating embellishment API:', err);
  }

  // Datasets API Service:
  const datasetsApi = createDatasetsApi(apiDependencies);
  if (datasetsApi) {
    v1DataRouter.use('/datasets', datasetsApi);
    logger.debug('[InternalAPI] Datasets API service mounted to /v1/data/datasets');
  } else {
    logger.error('[InternalAPI] Failed to create Datasets API router.');
  }

  // Cost Calculation API Service:
  const costCalculationApi = createCostCalculationApi(apiDependencies);
  if (costCalculationApi) {
    v1DataRouter.use('/cost', costCalculationApi);
    logger.debug('[InternalAPI] Cost Calculation API service mounted to /v1/data/cost');
  } else {
    logger.error('[InternalAPI] Failed to create Cost Calculation API router.');
  }

  // Analytics API Service:
  const analyticsApi = createAnalyticsApi(apiDependencies);
  if (analyticsApi) {
    v1DataRouter.use('/analytics', analyticsApi);
    logger.debug('[InternalAPI] Analytics API service mounted to /v1/data/analytics');
  } else {
    logger.error('[InternalAPI] Failed to create Analytics API router.');
  }

  // Marketplace API Service:
  const marketplaceApi = createMarketplaceApi(apiDependencies);
  if (marketplaceApi) {
    v1DataRouter.use('/marketplace', marketplaceApi);
    logger.debug('[InternalAPI] Marketplace API service mounted to /v1/data/marketplace');
  } else {
    logger.error('[InternalAPI] Failed to create Marketplace API router.');
  }

  // Upload API Service:
  const uploadApi = createUploadApi(apiDependencies);
  if (uploadApi) {
    v1DataRouter.use('/upload', uploadApi);
    logger.debug('[InternalAPI] Upload API service mounted to /v1/data/upload');
  } else {
    logger.error('[InternalAPI] Failed to create Upload API router.');
  }

  // Admin API Service (Revenue reporting, etc.):
  try {
    const { createAdminApi } = require('./admin');
    const adminApiRouter = createAdminApi(apiDependencies);
    if (adminApiRouter) {
      v1DataRouter.use('/admin', adminApiRouter);
      logger.debug('[InternalAPI] Admin API service mounted to /v1/data/admin');
    } else {
      logger.error('[InternalAPI] Failed to create Admin API router.');
    }
  } catch (err) {
    logger.error('[InternalAPI] Error initializing Admin API:', err);
  }

  // --- Global Error Handling ---
  // Catch-all for 404 Not Found on the internal API path
  mainInternalRouter.use((req, res, next) => {
    logger.warn(`[InternalAPI] 404 Not Found - ${req.method} ${req.originalUrl} ( chegou no final do mainInternalRouter)`);
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

    if (process.env.NODE_ENV !== 'production') {
      errorResponse.error.details = err.message; // Add more details in non-prod
      errorResponse.error.stack = err.stack;
    }

    res.status(err.status || 500).json(errorResponse);
  });

  logger.info('[InternalAPI] Internal API router fully initialized.');

  return {
    status: statusService, 
    router: mainInternalRouter,
    client: internalApiClient,
    // Expose apiDependencies so it can be updated after platform initialization
    updateDependencies: (newDeps) => {
      Object.assign(apiDependencies, newDeps);
      logger.debug('[InternalAPI] Updated API dependencies with platform notifiers.');
    },
    getDependencies: () => apiDependencies
  };
}

module.exports = initializeInternalServices; 
