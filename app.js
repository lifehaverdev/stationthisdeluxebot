/**
 * StationThis Bot - Modern Entry Point
 * 
 * This file serves as the modern entry point for the refactored application
 * while preserving backward compatibility with the legacy codebase.
 */

const express = require('express');
const path = require('path');
require('dotenv').config();

// Import refactored components
const { initializeServices } = require('./src/core/services');
const { initializePlatforms } = require('./src/platforms');

/**
 * Initialize and start the refactored application
 */
async function startApp() {
  try {
    console.log('Initializing StationThis refactored application...');
    
    // Initialize core services
    const services = await initializeServices({ 
      logger: console
    });
    console.log('Core services initialized');
    
    // Map services to expected names for platform compatibility
    const platformServices = {
      comfyuiService: services.comfyUI,
      pointsService: services.points,
      sessionService: services.session,
      workflowsService: {
        ...services.workflows,
        // Stub for collections functionality until fully implemented
        collections: {
          collectionsWorkflow: {
            getUserCollections: async () => ([]),
            getCollection: async () => null,
            createCollection: async () => ({ error: 'Not implemented' }),
            deleteCollection: async () => false
          }
        }
      },
      mediaService: services.media,
      logger: services.logger,
      // Add mock db implementation
      db: {
        collections: {
          getCollectionsByUserId: async () => ([]),
          loadCollection: async () => null,
          createCollection: async () => false,
          deleteCollection: async () => true
        }
      }
    };
    
    // Initialize platforms with properly mapped services
    const platforms = initializePlatforms(platformServices, {
      enableTelegram: true,
      enableDiscord: true,
      enableWeb: true,
      web: {
        staticPath: path.join(__dirname, 'public')
      }
    });
    console.log('Platform adapters initialized');
    
    // Initialize web server if web platform is enabled
    if (platforms.web) {
      const port = process.env.WEB_PORT || 4000; // Use different port than server.js
      platforms.web.start(port).then(server => {
        console.log(`Web platform running on port ${port}`);
      });
    }
    
    console.log('StationThis refactored application is running!');
    
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
  startApp
};

// Start the app if this file is run directly
if (require.main === module) {
  startApp().catch(error => {
    console.error('Application startup failed:', error);
    process.exit(1);
  });
} 