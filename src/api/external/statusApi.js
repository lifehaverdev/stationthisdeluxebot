const express = require('express');
const { createLogger } = require('../../utils/logger');

/**
 * Creates a router for public status endpoints.
 * Provides basic health check and application status information.
 * 
 * @param {Object} dependencies - Dependencies from the main application
 * @returns {express.Router} - The configured Express router for status endpoints
 */
function createStatusApi(dependencies) {
  const logger = createLogger('StatusAPI');
  const router = express.Router();
  
  const { statusService } = dependencies;
  
  if (!statusService) {
    logger.error('[StatusAPI] Status service not available');
    throw new Error('Status service not available for StatusAPI');
  }

  /**
   * GET /status
   * Returns detailed application status information
   */
  router.get('/', (req, res) => {
    try {
      const status = statusService.getStatus();
      res.status(200).json(status);
    } catch (error) {
      logger.error('[StatusAPI] Error getting application status:', error);
      res.status(500).json({
        status: 'error',
        error: { 
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve application status'
        }
      });
    }
  });

  /**
   * GET /status/health
   * Simple health check endpoint
   */
  router.get('/health', (req, res) => {
    try {
      // Just check if we can get status - if yes, we're healthy
      statusService.getStatus();
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      logger.error('[StatusAPI] Health check failed:', error);
      res.status(503).json({ 
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service is not healthy'
        }
      });
    }
  });

  return router;
}

module.exports = { createStatusApi }; 