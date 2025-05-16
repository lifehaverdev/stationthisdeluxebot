/**
 * Web Router
 * 
 * Express router for web interface integration.
 * Serves static files and renders web views.
 */

const express = require('express');
const path = require('path');
const { Logger } = require('../../utils/logger');

// Initialize logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'web-router'
});

// Create router
const router = express.Router();

/**
 * Configure and return the web interface router
 * @param {Object} options - Router options
 * @param {Object} options.app - Express app instance
 * @returns {Object} - Express router
 */
function setupWebRouter(options = {}) {
  const { app } = options;
  
  if (!app) {
    throw new Error('Express app is required');
  }
  
  // Set up static files
  const staticPath = path.join(__dirname, '../../core/ui/web/static');
  router.use('/static', express.static(staticPath));
  
  // Main interface route
  router.get('/', (req, res) => {
    const indexPath = path.join(__dirname, '../../core/ui/web/views/index.html');
    res.sendFile(indexPath);
  });
  
  // Log requests to the web interface
  router.use((req, res, next) => {
    logger.info(`Web interface request: ${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    next();
  });
  
  return router;
}

module.exports = {
  setupWebRouter
}; 