/**
 * Webhook Controller
 * 
 * High-level controller for processing incoming webhooks from various platforms.
 * Acts as the main entry point for webhook processing in the system.
 */

const { AppError, ERROR_SEVERITY } = require('../shared/errors');
const { EventEmitter } = require('events');

/**
 * WebhookController class
 * Main controller for webhook processing
 */
class WebhookController extends EventEmitter {
  /**
   * @param {Object} options - Controller options
   * @param {Object} options.registry - WebhookRegistry instance
   * @param {Object} options.router - WebhookRouter instance
   */
  constructor(options = {}) {
    super();
    
    if (!options.registry) {
      throw new Error('WebhookRegistry is required for WebhookController');
    }
    
    if (!options.router) {
      throw new Error('WebhookRouter is required for WebhookController');
    }
    
    this.registry = options.registry;
    this.router = options.router;
    
    // Set up event forwarding from registry and router
    this._setupEventForwarding();
  }
  
  /**
   * Process an incoming webhook
   * @param {Object} webhook - Webhook data
   * @param {string} [webhook.platform] - Platform the webhook came from
   * @param {string} [webhook.service] - Service the webhook is for
   * @param {Object} webhook.payload - Raw webhook payload
   * @param {Object} [context={}] - Additional context data for processing
   * @returns {Promise<Object>} - Processing result
   */
  async processWebhook(webhook, context = {}) {
    try {
      // Track start time for metrics
      const startTime = Date.now();
      
      // Validate webhook data
      if (!webhook || typeof webhook !== 'object') {
        throw new AppError('Invalid webhook data', {
          severity: ERROR_SEVERITY.ERROR,
          code: 'WEBHOOK_INVALID_DATA'
        });
      }
      
      if (!webhook.payload) {
        throw new AppError('Webhook payload is required', {
          severity: ERROR_SEVERITY.ERROR,
          code: 'WEBHOOK_MISSING_PAYLOAD'
        });
      }
      
      // Emit received event
      this.emit('webhook:received', {
        platform: webhook.platform,
        service: webhook.service,
        context,
        timestamp: Date.now()
      });
      
      // Add context to webhook data
      const webhookWithContext = {
        ...webhook,
        context
      };
      
      // Route webhook to handlers
      const result = await this.router.routeWebhook(webhookWithContext);
      
      // Track processing time
      const processingTime = Date.now() - startTime;
      
      // Emit processed event
      this.emit('webhook:completed', {
        platform: webhook.platform,
        service: webhook.service,
        success: result.success,
        processingTime,
        timestamp: Date.now()
      });
      
      return {
        ...result,
        processingTime
      };
    } catch (error) {
      // Emit error event
      this.emit('webhook:processing:error', {
        error: error.message || 'Unknown error',
        code: error.code || 'WEBHOOK_PROCESSING_ERROR',
        platform: webhook.platform,
        service: webhook.service,
        timestamp: Date.now()
      });
      
      // Rethrow as AppError
      throw error instanceof AppError ? error : new AppError('Failed to process webhook', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'WEBHOOK_PROCESSING_FAILED',
        cause: error
      });
    }
  }
  
  /**
   * Create a middleware function for Express/HTTP webhook handling
   * @param {Object} options - Middleware options
   * @param {string} [options.platform] - Default platform for webhooks
   * @param {Function} [options.getService] - Function to extract service from request
   * @param {Function} [options.getPayload] - Function to extract payload from request
   * @returns {Function} - Express middleware function
   */
  createMiddleware(options = {}) {
    const { platform, getService, getPayload } = options;
    
    return async (req, res, next) => {
      try {
        // Extract webhook data from request
        const payload = typeof getPayload === 'function'
          ? getPayload(req)
          : req.body;
        
        const service = typeof getService === 'function'
          ? getService(req)
          : req.params.service || req.query.service;
        
        // Process webhook
        const result = await this.processWebhook({
          platform,
          service,
          payload
        });
        
        // Add result to request for downstream handlers
        req.webhookResult = result;
        
        // Continue middleware chain
        next();
      } catch (error) {
        // Pass error to Express error handler
        next(error);
      }
    };
  }
  
  /**
   * Set up event forwarding from registry and router
   * @private
   */
  _setupEventForwarding() {
    // Forward registry events
    this.registry.on('handler:registered', (data) => {
      this.emit('handler:registered', data);
    });
    
    this.registry.on('registry:cleared', (data) => {
      this.emit('registry:cleared', data);
    });
    
    // Forward router events
    this.router.on('adapter:registered', (data) => {
      this.emit('adapter:registered', data);
    });
    
    this.router.on('webhook:route', (data) => {
      this.emit('webhook:route', data);
    });
    
    this.router.on('webhook:processed', (data) => {
      this.emit('webhook:processed', data);
    });
    
    this.router.on('webhook:error', (data) => {
      this.emit('webhook:error', data);
    });
    
    this.router.on('webhook:handler:error', (data) => {
      this.emit('webhook:handler:error', data);
    });
  }
}

module.exports = {
  WebhookController
}; 