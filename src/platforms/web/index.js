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
const fs = require('fs');

/**
 * Sets up the page-specific routes
 * @param {Object} app - Express app instance
 */
function setupPageRoutes(app) {
  const publicPath = path.join(__dirname, '..', '..', '..', 'public');

  app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'landing.html'));
  });

  app.get('/docs', (req, res) => {
    res.sendFile(path.join(publicPath, 'docs.html'));
  });

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicPath, 'admin.html'));
  });
}

/**
 * Initialize the web platform
 * @param {Object} services - Core services
 * @param {Object} options - Configuration options
 * @returns {Object} - Web platform instance
 */
function initializeWebPlatform(services, options = {}) {
  const app = express();
  const logger = services.logger || console; // Get logger from services, fallback to console

  // Trust the first proxy in front of the app.
  app.set('trust proxy', 1);

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

  return {
    app,
    initializeRoutes: async () => {
      await initializeRoutes(app, services); // Initialize API routes

      setupPageRoutes(app); // Initialize our new page routes

      // Serve static files from the client/dist directory first (for the main app)
      app.use(express.static(path.join(__dirname, 'client', 'dist')));
      
      // Then serve from the regular static path if specified
      if (options.staticPath) {
        app.use(express.static(options.staticPath));
      }

      // Handle SPA routing - return main app's index.html for all other routes
      app.get('*', (req, res) => {
        if (req.accepts('html')) {
          const clientIndexPath = path.join(__dirname, 'client', 'dist', 'index.html');
          if (fs.existsSync(clientIndexPath)) {
            res.sendFile(clientIndexPath);
          } else {
             // If the main app doesn't exist, we don't have a good fallback for SPA routes.
             // Sending a 404 is more appropriate than sending an unrelated file.
            res.status(404).send('Application not found.');
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