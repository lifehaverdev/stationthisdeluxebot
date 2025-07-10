/**
 * StationThis Bot - Entry Point
 * 
 * This file serves as the entry point for the application.
 */

//const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // For request IDs in errors

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

// geniusoverhaul: Import ToolRegistry
const { ToolRegistry } = require('./src/core/tools/ToolRegistry.js');
// Import the new CommandRegistry
const { CommandRegistry } = require('./src/platforms/telegram/dynamicCommands.js');

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
    const services = await initializeServices({ 
      logger: logger,
      webSocketService: websocketServer
    });
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
      logger.info('Initializing WorkflowsService cache...');
      await services.workflows.initialize();
      logger.info('WorkflowsService cache initialized.');
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
    const dependencies = {
      ...services, // Spread all initialized services
      logger,      // Add the root app logger
      appStartTime: APP_START_TIME,
      toolRegistry: ToolRegistry.getInstance(),
      commandRegistry: new CommandRegistry(logger), // Instantiate the CommandRegistry
    };
    
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

    // --- Initialize and Start Notification Dispatcher ---
    if (services.internal?.client && services.logger && platforms.telegram && platforms.telegram.bot) {
      try {
        logger.info('[App] Initializing TelegramNotifier...');
        const telegramNotifierInstance = new TelegramNotifier(platforms.telegram.bot, services.logger);
        
        const platformNotifiersMap = {
          telegram: telegramNotifierInstance,
          // Add other notifiers here, e.g.:
          // discord: new DiscordNotifier(platforms.discord.bot, services.logger),
        };

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
      logger.info('External API router mounted at /api/v1');
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
        logger.info('WebSocket service initialized.');
        
        // --- Credit Service Startup ---
        // This is now started AFTER the web platform is running to ensure
        // the internal API is ready to receive requests from the service.
        if (services.creditService && typeof services.creditService.start === 'function') {
            logger.info('Starting CreditService to sync with on-chain state...');
            // We do not await this, as it can be a long-running process.
            // It will run in the background.
            services.creditService.start().catch(err => {
                logger.error('CreditService failed to start or encountered a runtime error:', err);
            });
            logger.info('CreditService sync process has been initiated.');
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

// Export components for use in other files
module.exports = {
  startApp,
  APP_START_TIME
};

// Start the app if this file is run directly
if (require.main === module) {
  startApp().catch(error => {
    logger.error('Application startup failed:', error);
    process.exit(1);
  });
} 