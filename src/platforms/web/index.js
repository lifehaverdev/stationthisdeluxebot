/**
 * Web Platform Entry Point
 * 
 * Initializes the web platform adapter and configures Express routes
 */

const express = require('express');
const path = require('path');
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
  
  // Set up middleware
  setupMiddleware(app);
  
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
          console.log(`Web platform running on port ${port}`);
          resolve(server);
        });
      });
    }
  };
}

module.exports = {
  initializeWebPlatform
}; 