/**
 * Web Webhook Adapter
 * 
 * Platform-specific implementation of webhook handling for the web integration.
 * Provides Express middleware for handling incoming webhooks.
 */

const { createWebAdapter } = require('../../core/webhook/adapter');
const { AppError, ERROR_SEVERITY } = require('../../core/shared/errors');

/**
 * Create an Express middleware for handling webhooks
 * @param {Object} options - Middleware options
 * @param {Object} options.webhookController - WebhookController instance
 * @param {Function} [options.getService] - Custom function to extract service from request
 * @param {Object} [options.errorHandler] - Custom error handler function
 * @returns {Function} - Express middleware
 */
function createWebhookMiddleware(options = {}) {
  const { webhookController, getService, errorHandler } = options;
  
  if (!webhookController) {
    throw new Error('WebhookController is required for webhook middleware');
  }
  
  // Create web adapter
  const webAdapter = createWebAdapter();
  
  // Return middleware function
  return async (req, res, next) => {
    try {
      // Extract service from request if getService function is provided
      const service = typeof getService === 'function'
        ? getService(req)
        : req.params.service || req.query.service;
      
      // Process webhook through controller
      const result = await webhookController.processWebhook({
        platform: 'web',
        service,
        payload: req.body
      });
      
      // Return success response
      res.status(200).json({
        success: true,
        message: 'Webhook processed successfully',
        processingTime: result.processingTime
      });
    } catch (error) {
      // Handle error with custom handler if provided
      if (typeof errorHandler === 'function') {
        return errorHandler(error, req, res, next);
      }
      
      // Default error handling
      console.error('Webhook processing error:', error);
      
      // Determine status code based on error
      const statusCode = error.code === 'WEBHOOK_NO_HANDLERS' ? 404 : 500;
      
      // Return error response
      res.status(statusCode).json({
        success: false,
        error: error.message || 'Failed to process webhook',
        code: error.code || 'WEBHOOK_ERROR'
      });
    }
  };
}

/**
 * Create a service-specific webhook route handler
 * @param {Object} options - Route handler options
 * @param {Object} options.webhookController - WebhookController instance
 * @param {string} options.service - Service identifier
 * @returns {Function} - Express route handler
 */
function createServiceWebhookHandler(options = {}) {
  const { webhookController, service } = options;
  
  if (!webhookController) {
    throw new Error('WebhookController is required for webhook handler');
  }
  
  if (!service) {
    throw new Error('Service identifier is required for webhook handler');
  }
  
  // Return route handler
  return async (req, res) => {
    try {
      // Process webhook through controller
      const result = await webhookController.processWebhook({
        platform: 'web',
        service,
        payload: req.body
      });
      
      // Return success response
      res.status(200).json({
        success: true,
        message: `${service} webhook processed successfully`,
        processingTime: result.processingTime
      });
    } catch (error) {
      console.error(`${service} webhook processing error:`, error);
      
      // Return error response
      res.status(500).json({
        success: false,
        error: error.message || `Failed to process ${service} webhook`,
        code: error.code || 'WEBHOOK_ERROR'
      });
    }
  };
}

/**
 * Create a ComfyDeploy webhook route handler
 * @param {Object} options - Route handler options
 * @param {Object} options.webhookController - WebhookController instance
 * @returns {Function} - Express route handler
 */
function createComfyDeployWebhookHandler(options = {}) {
  return createServiceWebhookHandler({
    ...options,
    service: 'comfydeploy'
  });
}

/**
 * Initialize webhook routes for an Express app
 * @param {Object} app - Express app instance
 * @param {Object} options - Init options
 * @param {Object} options.webhookController - WebhookController instance
 * @param {string} [options.basePath='/webhooks'] - Base path for webhook routes
 * @returns {Object} - Express app
 */
function initWebhookRoutes(app, options = {}) {
  const { webhookController, basePath = '/webhooks' } = options;
  
  if (!webhookController) {
    throw new Error('WebhookController is required for webhook routes');
  }
  
  // Create generic webhook middleware
  const webhookMiddleware = createWebhookMiddleware({ webhookController });
  
  // Create service-specific handlers
  const comfyDeployHandler = createComfyDeployWebhookHandler({ webhookController });
  
  // Register routes
  app.post(`${basePath}`, webhookMiddleware);
  app.post(`${basePath}/:service`, webhookMiddleware);
  app.post(`${basePath}/comfydeploy`, comfyDeployHandler);
  
  return app;
}

module.exports = {
  createWebhookMiddleware,
  createServiceWebhookHandler,
  createComfyDeployWebhookHandler,
  initWebhookRoutes
}; 