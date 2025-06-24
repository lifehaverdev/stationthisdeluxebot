/**
 * StationThis Bot - Main Entry Point
 * 
 * Initializes services and platform adapters
 */

require('dotenv').config(); // Load environment variables from .env file

// Import core services
const { initializeServices } = require('./core/services');

// Import platform adapters
const { initializePlatforms } = require('./platforms');

// Initialize logger
const logger = console;

async function startApplication() {
  try {
    logger.info('Starting StationThis Bot...');
    
    // Initialize core services
    logger.info('Initializing core services...');
    const services = await initializeServices({ logger });
    
    // Initialize platform adapters
    logger.info('Initializing platform adapters...');
    const platforms = initializePlatforms(services, {
      enableTelegram: true,
      enableWeb: true, // Explicitly enable the web platform
      telegram: {
        // Any telegram-specific options
      },
      web: {
        // Web-specific options could go here in the future
      }
    });
    
    // Start the web platform if it was initialized
    if (platforms.web) {
      logger.info('Web platform is enabled, initializing routes...');
      await platforms.web.initializeRoutes(); // Await the async route initialization
      logger.info('Web routes initialized. Starting web server...');
      const port = process.env.PORT || 3000;
      await platforms.web.start(port);
    }
    
    logger.info('StationThis Bot is running!');
    logger.info('Press Ctrl+C to stop');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down...');
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application
startApplication(); 