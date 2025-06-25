// require('dotenv').config();
/**
 * Web Platform Entry Point
 * 
 * Initializes the web platform adapter and configures Express routes
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const httpLogger = require('../../utils/pino'); // Import the centralized pino-http logger
const { initializeRoutes } = require('./routes');
const { setupMiddleware } = require('./middleware');
const fs = require('fs');

/**
 * Initialize the web platform
 * @param {Object} services - Core services
 * @param {Object} options - Configuration options
 * @returns {Object} - Web platform instance
 */
function initializeWebPlatform(services, options = {}) {
  const app = express();
  const logger = services.logger || console; // Get logger from services, fallback to console
  
  // Set up middleware
  logger.info('[WebPlatform] Initializing middleware...');
  app.use(httpLogger); // Use the centralized, correctly configured HTTP logger
  app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  
  // Initialize API routes (now async)
  // We need to wrap the rest of the setup in an async IIFE or make initializeWebPlatform async
  // Making initializeWebPlatform async seems cleaner
  
  // Return an async function that completes the setup
  return {
    app,
    initializeRoutes: async () => { // Introduce an async method to handle route initialization
      await initializeRoutes(app, services); // Await the async route initializer
  
  // Serve static files from the client/dist directory first (for the canvas UI)
  app.use(express.static(path.join(__dirname, 'client', 'dist')));
  
  // Then serve from the regular static path if specified
  if (options.staticPath) {
    app.use(express.static(options.staticPath));
  }
  
  // Handle SPA routing - return index.html for all unmatched routes
  app.get('*', (req, res) => {
    if (req.accepts('html')) {
      // Prioritize the client/dist/index.html for the canvas UI
      const clientIndexPath = path.join(__dirname, 'client', 'dist', 'index.html');
      if (fs.existsSync(clientIndexPath)) {
        res.sendFile(clientIndexPath);
      } else if (options.staticPath) {
        // Fallback to the static path if the client index doesn't exist
        res.sendFile(path.join(options.staticPath, 'index.html'));
      } else {
        // Default fallback
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
      }
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });
    },
    start: (port = 3000) => {
      return new Promise((resolve) => {
        const server = app.listen(port, () => {
          logger.info(`Web platform running on port ${port}`); // Use logger here
          resolve(server);
        });
      });
    }
  };
}

module.exports = {
  initializeWebPlatform
}; 