/**
 * StationThis Bot - Entry Point
 *
 * This file serves as the entry point for the application.
 */

// Load environment variables FIRST before any other imports
require('dotenv').config();

//const express = require('express');
const path = require('path');
const { randomUUID } = require('crypto');
let uuidv4;
try {
  ({ v4: uuidv4 } = require('uuid')); // Prefer external lib when available
} catch (err) {
  console.warn('[app] uuid package not found, falling back to crypto.randomUUID');
  uuidv4 = () => randomUUID();
}

// Store application start time
const APP_START_TIME = new Date();

// Import our custom logger
const { createLogger } = require('./src/utils/logger');
const logger = createLogger('app'); // Create a logger for app.js

// Import refactored components
const { initializeDatabase } = require('./src/core/initDB'); // Uses getCachedClient() to ping database and create a connection;
const { initializeServices } = require('./src/core/services'); // Initializes all services
const { initializePlatforms } = require('./src/platforms');
const { initialize } = require('./src/core/initialization');

// Import our new WebSocketService singleton
const websocketServer = require('./src/core/services/websocket/server.js');

// Import new services for notification dispatching
const NotificationDispatcher = require('./src/core/services/notificationDispatcher');
const TelegramNotifier = require('./src/platforms/telegram/telegramNotifier');
const WebSandboxNotifier = require('./src/platforms/web/webSandboxNotifier');
const WebhookNotifier = require('./src/platforms/webhook/webhookNotifier');

// geniusoverhaul: Import ToolRegistry
const { ToolRegistry } = require('./src/core/tools/ToolRegistry.js');
// Note: CommandRegistry is no longer imported here - each platform creates its own instance

/**
 * Initialize and start the refactored application
 */
async function startApp() {
  try {
    logger.info('===================================================');
    logger.info('===| Initializing StationThis Bot Application |====');
    logger.info('===================================================');
    logger.info('===================================================');
    logger.info('===================================================');
    logger.info('===================================================');
    logger.info('===================================================');
    // Initialize Database Connection FIRST
    await initializeDatabase();
    logger.info('Database connection initialized.');
    
    // Initialize core services, passing the WebSocketService instance
    const exportProcessingEnabled = process.env.COLLECTION_EXPORT_PROCESSING_ENABLED !== 'false';
    const services = await initializeServices({
      logger: logger,
      webSocketService: websocketServer,
      collectionExportProcessingEnabled: exportProcessingEnabled
    });
    _services = services; // Store for graceful shutdown
    logger.info('Core services initialized.');
    /*
    ] [app]: services (shallow): {
      "session": "object",
      "media": "object",
      "points": "object",
      "comfyUI": "object",
      "workflows": "object",
      "openai": "object",
      "db": "object",
      "internal": "object",
      "internalApiClient": "undefined",
      "userSettingsService": "object",
      "spellsService": "object",
      "workflowExecutionService": "object",
      "logger": "object",
      "appStartTime": "object",
      "toolRegistry": "object"
    }
    */

    // Explicitly initialize WorkflowsService and wait for it
    if (services.workflows && typeof services.workflows.initialize === 'function') {
      logger.info('Initializing WorkflowsService cache in background...');
      services.workflows.initialize().catch(err => logger.error('Background workflow cache init failed', err));
    } else {
      logger.warn('WorkflowsService not found or does not have an initialize method.');
    }

    // Debug log to verify internal services are available
    logger.debug('DEBUG: Internal API services available:', {
      internalAvailable: services.internal ? 'Yes' : 'No',
      statusService: services.internal?.status ? 'Status service OK' : 'Status service missing'
    });
    
    // Run system initialization
    logger.info('\nStarting system initialization sequence...');
    const initResults = await initialize(services, logger); // Pass logger here too
    
    // Log initialization results
    if (initResults.status === 'success') {
      logger.info('\nInitialization Results: SUCCESS');
    } else if (initResults.status === 'partial') {
      logger.warn('\nInitialization Results: PARTIAL - Some components failed to initialize');
      logger.warn('Error:', initResults.error);
      logger.info('Continuing with available components...');
    } else {
      logger.error('\nInitialization Results: FAILED');
      logger.error('Error:', initResults.error);
      logger.info('Attempting to continue with critical services only...');
    }
    
    // Log data availability regardless of status
    logger.info(`- Burns data records: ${initResults.data.burns}`);
    logger.info(`- Rooms/Groups: ${initResults.data.rooms}`);
    logger.info(`- Workflows: ${initResults.data.workflows}`);
    logger.info(`- Lora Triggers: ${initResults.data.loras}`);
    logger.info(`- ComfyUI API: ${initResults.data.comfyUI.connected ? 'Connected' : 'Failed'}`);
    
    if (initResults.data.comfyUI.connected) {
      logger.info(`  - Available workflows: ${JSON.stringify(initResults.data.comfyUI.workflows)}`);
      logger.info(`  - Available deployments: ${JSON.stringify(initResults.data.comfyUI.deployments)}`);
      logger.info(`  - Available machines: ${JSON.stringify(initResults.data.comfyUI.machines)}`);
      logger.info(`  - Ready machines: ${JSON.stringify(initResults.data.comfyUI.readyMachines)}`);
    }
    
    logger.info('\nProceeding to platform initialization...\n');
    
    // Create the canonical dependencies object as defined in ADR-001
    // Note: commandRegistry is NOT shared - each platform creates its own instance
    // to avoid conflicts between Telegram and Discord command registrations
    const dependencies = {
      ...services, // Spread all initialized services
      logger,      // Add the root app logger
      appStartTime: APP_START_TIME,
      internalApiClient: services.internalApiClient || services.internal?.client,
      toolRegistry: ToolRegistry.getInstance(),
      // commandRegistry removed - each platform will create its own instance
    };

    // Backward compatibility: ensure legacy path dependencies.internal.client exists
    if (!dependencies.internal) {
      dependencies.internal = {};
    }
    dependencies.internal.client = dependencies.internalApiClient;
    // geniusoverhaul: Add a log to verify dependencies.toolRegistry
    logger.info('[App] Canonical dependencies object created. Checking toolRegistry...');
    if (dependencies.toolRegistry && typeof dependencies.toolRegistry.getToolById === 'function') {
        logger.info('[App] dependencies.toolRegistry appears to be a valid ToolRegistry instance.');
    } else {
        logger.warn('[App] dependencies.toolRegistry is MISSING or INVALID!', { registry: dependencies.toolRegistry });
    }
    // End verification log
    
    // Initialize platforms with the canonical dependencies object
    logger.info('Initializing platform adapters...');
    const platforms = initializePlatforms(dependencies, {
      enableTelegram: true,
      enableDiscord: true,
      enableWeb: true,
      web: {
        staticPath: path.join(__dirname, 'public')
      }
    });
    logger.info('Platform adapters initialized');

    // --- Build Platform Notifiers Map (needed for both NotificationDispatcher and Internal API) ---
    const platformNotifiersMap = {};

    // --- Telegram Notifier ---
    if (platforms.telegram && platforms.telegram.bot) {
      try {
        logger.info('[App] Initializing TelegramNotifier...');
        const telegramNotifierInstance = new TelegramNotifier(platforms.telegram.bot, services.logger);
        platformNotifiersMap.telegram = telegramNotifierInstance;
      } catch (telegramErr) {
        logger.error('[App] Failed to initialize TelegramNotifier:', telegramErr.message);
      }
    } else {
      logger.info('[App] Telegram platform not available. TelegramNotifier not registered.');
    }

    // --- Web Sandbox Notifier ---
    try {
      if (websocketServer) {
        const webSandboxNotifierInstance = new WebSandboxNotifier(websocketServer, services.logger);
        platformNotifiersMap['web-sandbox'] = webSandboxNotifierInstance;
        logger.info('[App] WebSandboxNotifier initialized and registered.');
      } else {
        logger.warn('[App] WebSocketService not available. WebSandboxNotifier will not be registered.');
      }
    } catch (webNotifierErr) {
      logger.error('[App] Failed to initialize WebSandboxNotifier:', webNotifierErr.message);
    }

    // --- Discord Notifier ---
    if (platforms.discord && (platforms.discord.client || platforms.discord.bot)) {
      try {
        logger.info('[App] Initializing DiscordNotifier...');
        const DiscordNotifier = require('./src/platforms/discord/discordNotifier');
        const discordClient = platforms.discord.client || platforms.discord.bot?.client;
        if (discordClient) {
          const discordNotifierInstance = new DiscordNotifier(discordClient, services.logger);
          platformNotifiersMap.discord = discordNotifierInstance;
          logger.info('[App] DiscordNotifier initialized and registered.');
        } else {
          logger.warn('[App] Discord client not available. DiscordNotifier will not be registered.');
        }
      } catch (discordErr) {
        logger.error('[App] Failed to initialize DiscordNotifier:', discordErr.message);
      }
    } else {
      logger.info('[App] Discord platform not available. DiscordNotifier not registered.');
    }

    // --- Webhook Notifier ---
    try {
      logger.info('[App] Initializing WebhookNotifier...');
      // WebhookNotifier needs internalApiClient for fetching cast records
      const internalApiClient = services.internal?.client;
      if (internalApiClient) {
        const webhookNotifierInstance = new WebhookNotifier(services.logger, internalApiClient);
        platformNotifiersMap.webhook = webhookNotifierInstance;
        logger.info('[App] WebhookNotifier initialized and registered.');
      } else {
        logger.warn('[App] Internal API client not available. WebhookNotifier will not be registered.');
      }
    } catch (webhookErr) {
      logger.error('[App] Failed to initialize WebhookNotifier:', webhookErr.message);
    }

    // Add platform notifiers to services dependencies for Internal API
    services.platformNotifiers = platformNotifiersMap;
    dependencies.platformNotifiers = platformNotifiersMap;
    
    // Update internal API dependencies with platform notifiers
    if (services.internal && typeof services.internal.updateDependencies === 'function') {
      services.internal.updateDependencies({ platformNotifiers: platformNotifiersMap });
      logger.info('[App] Updated internal API dependencies with platform notifiers.');
    } else {
      logger.warn('[App] Internal API updateDependencies method not available. Notifications may not work.');
    }

    // --- Initialize and Start Notification Dispatcher ---
    if (services.internal?.client && services.logger) {
      try {
        logger.info('[App] Initializing NotificationDispatcher...');
        const notificationDispatcher = new NotificationDispatcher(
          {
            internalApiClient: services.internal.client,
            logger: services.logger,
            platformNotifiers: platformNotifiersMap,
            workflowExecutionService: services.workflowExecutionService,
          },
          { /* Optional: pollingIntervalMs, etc. */ }
        );
        await notificationDispatcher.start();
        logger.info('[App] NotificationDispatcher started.');
      } catch (dispatcherError) {
        logger.error('[App] Failed to initialize or start NotificationDispatcher:', dispatcherError.message, { stack: dispatcherError.stack });
        // Decide if this is a fatal error or if the app can run without it
      }
    } else {
      logger.warn('[App] Could not initialize NotificationDispatcher: Missing dependencies (internal.client, logger, or Telegram platform/bot). Dispatcher will not run.');
    }
    // --- End Notification Dispatcher Initialization ---

    // --- Internal API Auth Middleware (defined within startApp to access logger if needed, and be close to its usage) ---
    const internalApiAuthMiddleware = (req, res, next) => {
      // No public bypasses – all internal routes require X-Internal-Client-Key
      const requestId = uuidv4(); // Generate request ID for error logging
      // Ensure logger is available, fallback to console if services.logger is not yet initialized or passed
      const currentLogger = services && services.logger ? services.logger : logger; // Use app logger as fallback
      const clientKey = req.headers['x-internal-client-key'];

      if (!clientKey) {
        currentLogger.warn(`[AuthMiddleware] Internal API request denied: Missing X-Internal-Client-Key header. Path: ${req.originalUrl}, IP: ${req.ip}, RequestId: ${requestId}`);
        return res.status(401).json({
          error: {
            code: 'MISSING_AUTH_HEADER',
            message: 'Missing X-Internal-Client-Key header.',
            requestId: requestId
          }
        });
      }

      const validKeys = [
        process.env.INTERNAL_API_KEY_SYSTEM, // Added for system-level services
        process.env.INTERNAL_API_KEY_TELEGRAM,
        process.env.INTERNAL_API_KEY_DISCORD,
        process.env.INTERNAL_API_KEY_WEB,
        process.env.INTERNAL_API_KEY_API,
        process.env.INTERNAL_API_KEY_ADMIN,
      ].filter(key => key);

      if (!validKeys.includes(clientKey)) {
        currentLogger.warn(`[AuthMiddleware] Internal API request denied: Invalid X-Internal-Client-Key provided. Path: ${req.originalUrl}, IP: ${req.ip}, KeyProvided: ${clientKey}, RequestId: ${requestId}`);
        return res.status(403).json({
          error: {
            code: 'INVALID_API_KEY',
            message: 'Invalid API key provided.',
            requestId: requestId
          }
        });
      }
      currentLogger.debug(`[AuthMiddleware] Internal API request authorized. Path: ${req.originalUrl}, RequestId: ${requestId}`);
      next();
    };

    // Mount the internal API router
    if (services.internal && services.internal.router && platforms.web && platforms.web.app) {
      // Apply the auth middleware specifically to the /internal path of the web app
      platforms.web.app.use('/internal', internalApiAuthMiddleware);
      platforms.web.app.use('/internal', services.internal.router);
      logger.info('Internal API authentication middleware and router mounted at /internal');
    } else {
      logger.warn('Internal API router or web app instance not available for mounting. Internal API might not be accessible or secured.');
    }
    
    // Mount the external API router
    if (services.external && services.external.router && platforms.web && platforms.web.app) {
      platforms.web.app.use('/api/v1', services.external.router);
      platforms.web.app.use('/api/external', services.external.router); // legacy path compatibility
      logger.info('External API router mounted at /api/v1 and /api/external');
    } else {
      logger.warn('External API router or web app instance not available for mounting. External API will not be accessible.');
    }
    
    // Initialize web server routes BEFORE setting up Telegram commands
    if (platforms.web) {
      try {
        // Ensure the web platform exposes its app instance and its own initializeRoutes method
        if (platforms.web.app && typeof platforms.web.initializeRoutes === 'function') {
          logger.info('Initializing Web platform routes (API, static, SPA)...');
          // This single call will handle API routes, static files, and SPA fallback internally.
          await platforms.web.initializeRoutes(); 
          logger.info('Web platform routes (API, static, SPA) initialized.');
        } else {
          logger.warn('Web platform app instance or its initializeRoutes method not available.');
        }

        const port = process.env.WEB_PORT || 4000;
        logger.info(`Starting Web platform on port ${port}...`);
        // Get the httpServer instance when starting the web platform
        const httpServer = await platforms.web.start(port);
        logger.info(`Web platform running on port ${port}`);

        // Initialize the WebSocket service by attaching it to the running HTTP server
        logger.info('Initializing WebSocket service...');
        websocketServer.initialize(httpServer);
        // Set ethereumServices for admin verification
        if (services.ethereumService) {
          websocketServer.setEthereumServices(services.ethereumService);
          logger.info('WebSocket service ethereumServices configured for admin verification.');
        }
        logger.info('WebSocket service initialized.');
        
        // --- Credit Service Startup ---
        // This is now started AFTER the web platform is running to ensure
        // the internal API is ready to receive requests from the service.
        const creditServices = services.creditService;
        if (creditServices && typeof creditServices === 'object') {
            const chainIds = Object.keys(creditServices);
            if (chainIds.length === 0) {
                logger.warn('CreditService registry is empty. On-chain deposit features will not be reconciled.');
            }
            for (const chainId of chainIds) {
                const serviceInstance = creditServices[chainId];
                if (serviceInstance && typeof serviceInstance.start === 'function') {
                    logger.info(`Starting CreditService for chainId ${chainId} to sync with on-chain state...`);
                    serviceInstance.start().catch(err => {
                        logger.error(`CreditService (chain ${chainId}) failed to start or encountered a runtime error:`, err);
                    });
                } else {
                    logger.warn(`CreditService for chainId ${chainId} is missing or invalid. Deposits on this chain will not be reconciled.`);
                }
            }
            if (chainIds.length > 0) {
                logger.info('CreditService startup invoked for all configured chains.');
            }
        } else {
            logger.warn('CreditService not found or not initialized. On-chain deposit features will not be reconciled.');
        }
        
        // Now setup Telegram commands AFTER web routes are initialized
        if (platforms.telegram) {
          try {
            logger.info('Setting up Telegram dynamic commands...');
            // Truncate descriptions before setting up commands
            const allTools = dependencies.toolRegistry.getAllTools();
            allTools.forEach(tool => {
                if (tool.description && tool.description.length > 255) {
                    logger.warn(`[App] Truncating description for tool "${tool.displayName}" as it exceeds 255 characters.`);
                    tool.description = tool.description.substring(0, 255);
                }
            });
            await platforms.telegram.setupCommands();
            logger.info('Telegram dynamic commands configured');
          } catch (telegramError) {
            logger.error('Failed to setup Telegram commands:', telegramError.message);
          }
        }
        
        // Then start Discord...
        
      } catch (webError) {
        logger.error('Failed to start Web platform:', webError.message);
      }
    } else {
      logger.warn('Web platform not configured or disabled');
    }
    
    logger.info('\n===========================================');
    logger.info('| StationThis application is now running! |');
    logger.info('===========================================\n');
    
    // Return components for external access
    return {
      services,
      platforms
    };
  } catch (error) {
    logger.error('Failed to start application:', error);
    throw error;
  }
}

// Track services for graceful shutdown
let _services = null;

/**
 * Gracefully shuts down all services.
 * Call this before process exit to ensure in-flight operations complete.
 * @returns {Promise<void>}
 */
async function shutdownApp() {
  logger.info('[App] Graceful shutdown initiated...');

  if (_services && _services.creditService) {
    const creditServices = _services.creditService;
    const chainIds = Object.keys(creditServices);

    for (const chainId of chainIds) {
      const serviceInstance = creditServices[chainId];
      if (serviceInstance && typeof serviceInstance.stop === 'function') {
        try {
          logger.info(`[App] Stopping CreditService for chainId ${chainId}...`);
          await serviceInstance.stop();
          logger.info(`[App] CreditService for chainId ${chainId} stopped.`);
        } catch (err) {
          logger.error(`[App] Error stopping CreditService (chain ${chainId}):`, err);
        }
      }
    }
  }

  logger.info('[App] Graceful shutdown complete.');
}

// Setup graceful shutdown handlers
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) {
    logger.warn(`[App] Already shutting down, ignoring ${signal}`);
    return;
  }
  isShuttingDown = true;

  logger.info(`[App] Received ${signal}, starting graceful shutdown...`);

  try {
    await shutdownApp();
  } catch (err) {
    logger.error('[App] Error during graceful shutdown:', err);
  }

  logger.info('[App] Exiting process.');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Export components for use in other files
module.exports = {
  startApp,
  shutdownApp,
  APP_START_TIME
};

// Start the app if this file is run directly
if (require.main === module) {
  startApp().catch(error => {
    logger.error('Application startup failed:', error);
    process.exit(1);
  });
} 
