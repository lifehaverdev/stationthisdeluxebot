/**
 * StationThis Bot - Modern Entry Point
 * 
 * This file serves as the modern entry point for the refactored application
 * while preserving backward compatibility with the legacy codebase.
 */

const express = require('express');
const path = require('path');
require('dotenv').config();
const { v4: uuidv4 } = require('uuid'); // For request IDs in errors

// Store application start time
const APP_START_TIME = new Date();

// Import refactored components
const { initializeDatabase } = require('./src/core/initDB');
const { initializeServices } = require('./src/core/services');
const { initializePlatforms } = require('./src/platforms');
const { initialize } = require('./src/core/initialization');
// Import the route initializer function directly
const { initializeRoutes: setupWebRoutes } = require('./src/platforms/web/routes');

// Import new services for notification dispatching
const NotificationDispatcher = require('./src/core/services/notificationDispatcher');
const TelegramNotifier = require('./src/platforms/telegram/telegramNotifier');

/**
 * Initialize and start the refactored application
 */
async function startApp() {
  try {
    console.log('===================================================');
    console.log('| Initializing StationThis refactored application |');
    console.log('===================================================');
    
    // Initialize Database Connection FIRST
    await initializeDatabase();
    console.log('Database connection initialized (or initialization process started).');
    
    // Initialize core services
    const services = await initializeServices({ 
      logger: console
    });
    console.log('Core services initialized');
    
    // Explicitly initialize WorkflowsService and wait for it
    if (services.workflows && typeof services.workflows.initialize === 'function') {
      console.log('Initializing WorkflowsService cache...');
      await services.workflows.initialize();
      console.log('WorkflowsService cache initialized.');
    } else {
      console.warn('WorkflowsService not found or does not have an initialize method.');
    }
    
    // Debug log to verify internal services are available
    console.log('DEBUG: Internal API services available:', 
      services.internal ? 'Yes' : 'No',
      services.internal?.status ? 'Status service OK' : 'Status service missing');
    
    // Run system initialization
    console.log('\nStarting system initialization sequence...');
    const initResults = await initialize(services, console);
    
    // Log initialization results
    if (initResults.status === 'success') {
      console.log('\nInitialization Results: SUCCESS');
    } else if (initResults.status === 'partial') {
      console.warn('\nInitialization Results: PARTIAL - Some components failed to initialize');
      console.warn('Error:', initResults.error);
      console.log('Continuing with available components...');
    } else {
      console.error('\nInitialization Results: FAILED');
      console.error('Error:', initResults.error);
      console.log('Attempting to continue with critical services only...');
    }
    
    // Log data availability regardless of status
    console.log('- Burns data records:', initResults.data.burns);
    console.log('- Rooms/Groups:', initResults.data.rooms);
    console.log('- Workflows:', initResults.data.workflows);
    console.log('- Lora Triggers:', initResults.data.loras);
    console.log('- ComfyUI API:', initResults.data.comfyUI.connected ? 'Connected' : 'Failed');
    
    if (initResults.data.comfyUI.connected) {
      console.log('  - Available workflows:', initResults.data.comfyUI.workflows);
      console.log('  - Available deployments:', initResults.data.comfyUI.deployments);
      console.log('  - Available machines:', initResults.data.comfyUI.machines);
      console.log('  - Ready machines:', initResults.data.comfyUI.readyMachines);
    }
    
    console.log('\nProceeding to platform initialization...\n');
    
    // Map services to the names/structure expected by the platform initializers
    const platformServices = {
      // Pass the actual comfyUI service instance under the key 'comfyui'
      comfyui: services.comfyUI, 
      points: services.points,
      session: services.session,
      // Pass the actual workflows service instance under the key 'workflows'
      workflows: services.workflows,
      media: services.media,
      logger: services.logger,
      appStartTime: APP_START_TIME,
      db: services.db,
      internal: services.internal,
      internalApiClient: services.internalApiClient,
      // Keep the stubbed collections structure separate if needed by other platforms,
      // but don't overwrite the main workflows service instance.
      // If platforms *specifically* need the stubbed collections, they should access
      // it via a different key or this structure needs rethinking.
      _workflowsServiceWithCollectionsStub: { // Example of keeping it separate
        ...services.workflows,
        collections: {
          collectionsWorkflow: {
            getUserCollections: async () => ([]),
            getCollection: async () => null,
            createCollection: async () => ({ error: 'Not implemented' }),
            deleteCollection: async () => false
          }
        }
      }
    };
    
    // Rename internal services to match platform expectations if needed
    // (Example assuming platforms expect pointsService, sessionService, etc.)
    platformServices.pointsService = platformServices.points;
    platformServices.sessionService = platformServices.sessionService;
    // Add other mappings as required by specific platforms... 
    
    // Initialize platforms with the corrected services object
    console.log('Initializing platform adapters...');
    const platforms = initializePlatforms(platformServices, {
      enableTelegram: true,
      enableDiscord: true,
      enableWeb: true,
      web: {
        staticPath: path.join(__dirname, 'public')
      }
    });
    console.log('Platform adapters initialized');

    // --- Initialize and Start Notification Dispatcher ---
    if (services.internalApiClient && services.logger && platforms.telegram && platforms.telegram.bot) {
      try {
        console.log('[App] Initializing TelegramNotifier...');
        const telegramNotifierInstance = new TelegramNotifier(platforms.telegram.bot, services.logger);
        
        const platformNotifiersMap = {
          telegram: telegramNotifierInstance,
          // Add other notifiers here, e.g.:
          // discord: new DiscordNotifier(platforms.discord.bot, services.logger),
        };

        console.log('[App] Initializing NotificationDispatcher...');
        const notificationDispatcher = new NotificationDispatcher(
          {
            internalApiClient: services.internalApiClient,
            logger: services.logger,
            platformNotifiers: platformNotifiersMap,
          },
          { /* Optional: pollingIntervalMs, etc. */ }
        );
        await notificationDispatcher.start();
        console.log('[App] NotificationDispatcher started.');
      } catch (dispatcherError) {
        console.error('[App] Failed to initialize or start NotificationDispatcher:', dispatcherError.message, dispatcherError.stack);
        // Decide if this is a fatal error or if the app can run without it
      }
    } else {
      console.warn('[App] Could not initialize NotificationDispatcher: Missing dependencies (internalApiClient, logger, or Telegram platform/bot). Dispatcher will not run.');
    }
    // --- End Notification Dispatcher Initialization ---

    // --- Internal API Auth Middleware (defined within startApp to access logger if needed, and be close to its usage) ---
    const internalApiAuthMiddleware = (req, res, next) => {
      const requestId = uuidv4(); // Generate request ID for error logging
      // Ensure logger is available, fallback to console if services.logger is not yet initialized or passed
      const currentLogger = services && services.logger ? services.logger : console;
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
        process.env.INTERNAL_API_KEY_TELEGRAM,
        process.env.INTERNAL_API_KEY_DISCORD,
        process.env.INTERNAL_API_KEY_WEB,
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
      console.log('Internal API authentication middleware and router mounted at /internal');
    } else {
      console.warn('Internal API router or web app instance not available for mounting. Internal API might not be accessible or secured.');
    }
    
    // Initialize web server routes BEFORE setting up Telegram commands
    if (platforms.web) {
      try {
        // Ensure the web platform exposes its app instance and its own initializeRoutes method
        if (platforms.web.app && typeof platforms.web.initializeRoutes === 'function') {
          console.log('Initializing Web platform routes (API, static, SPA)...');
          // This single call will handle API routes, static files, and SPA fallback internally.
          await platforms.web.initializeRoutes(); 
          console.log('Web platform routes (API, static, SPA) initialized.');
        } else {
          console.warn('Web platform app instance or its initializeRoutes method not available.');
        }

        const port = process.env.WEB_PORT || 4000;
        console.log(`Starting Web platform on port ${port}...`);
        await platforms.web.start(port);
        console.log(`Web platform running on port ${port}`);
        
        // Now setup Telegram commands AFTER web routes are initialized
        if (platforms.telegram) {
          try {
            console.log('Setting up Telegram dynamic commands...');
            await platforms.telegram.setupCommands();
            console.log('Telegram dynamic commands configured');
          } catch (telegramError) {
            console.error('Failed to setup Telegram commands:', telegramError.message);
          }
        }
        
        // Then start Discord...
        
      } catch (webError) {
        console.error('Failed to start Web platform:', webError.message);
      }
    } else {
      console.warn('Web platform not configured or disabled');
    }
    
    console.log('\n===========================================');
    console.log('| StationThis application is now running! |');
    console.log('===========================================\n');
    
    // Return components for external access
    return {
      services,
      platforms
    };
  } catch (error) {
    console.error('Failed to start application:', error);
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
    console.error('Application startup failed:', error);
    process.exit(1);
  });
} 