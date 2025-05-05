/**
 * Status API Routes
 * 
 * External API endpoints for status information
 */

const express = require('express');

/**
 * Create status routes
 * @param {Object} services - Application services
 * @returns {express.Router} - Express router with status routes
 */
function createStatusRoutes(services) {
  const router = express.Router();
  
  /**
   * @route GET /api/status
   * @description Get application status information
   * @access Public
   */
  router.get('/', (req, res) => {
    try {
      const statusInfo = services.internal.status.getStatus();
      res.status(200).json(statusInfo);
    } catch (error) {
      console.error('Error in status endpoint:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to retrieve status information'
      });
    }
  });
  
  /**
   * @route GET /api/status/health
   * @description Simple health check endpoint
   * @access Public
   */
  router.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  
  return router;
}

module.exports = createStatusRoutes; 