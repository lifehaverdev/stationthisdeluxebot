/**
 * StationThis Bot - Modern Entry Point
 * 
 * This file serves as the modern entry point for the refactored application
 * while preserving backward compatibility with the legacy codebase.
 */

const express = require('express');
const path = require('path');
require('dotenv').config();

// Store application start time
const APP_START_TIME = new Date();

// Import refactored components
const { initializeServices } = require('./src/core/services');
const { initializePlatforms } = require('./src/platforms');
const { initialize } = require('./src/core/initialization');
// Import the route initializer function directly
const { initializeRoutes: setupWebRoutes } = require('./src/platforms/web/routes');

/**
 * Initialize and start the refactored application
 */
async function startApp() {
  try {
    console.log('===================================================');
    console.log('| Initializing StationThis refactored application |');
    console.log('===================================================');
    
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
    
    // First start the Telegram bot
    if (platforms.telegram) {
      try {
        console.log('Starting Telegram bot...');
        await platforms.telegram.start();
        console.log('Telegram bot is running!');
      } catch (telegramError) {
        console.error('Failed to start Telegram bot:', telegramError.message);
      }
    } else {
      console.warn('Telegram platform not configured or disabled');
    }
    
    // Then start the Discord bot
    if (platforms.discord) {
      try {
        console.log('Starting Discord bot...');
        await platforms.discord.start();
        console.log('Discord bot is running!');
      } catch (discordError) {
        console.error('Failed to start Discord bot:', discordError.message);
      }
    } else {
      console.warn('Discord platform not configured or disabled');
    }
    
    // Initialize web server routes BEFORE starting the server
    if (platforms.web) {
      try {
        // Ensure the web platform exposes its app instance and the setup function exists
        if (platforms.web.app && typeof setupWebRoutes === 'function') {
          console.log('Initializing Web platform routes...');
          await setupWebRoutes(platforms.web.app, platformServices); // Pass app and services
          console.log('Web platform routes initialized.');
        } else {
          console.warn('Web platform app instance or setupWebRoutes function not available. Routes might not be fully set up.');
        }

        const port = process.env.WEB_PORT || 4000; // Use different port than server.js
        console.log(`Starting Web platform on port ${port}...`);
        
        // Now start the server (assuming start just begins listening)
        await platforms.web.start(port);
        console.log(`Web platform running on port ${port}`);
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