/**
 * Webhook Router
 * 
 * Routes incoming webhooks to appropriate handlers based on their service type and payload.
 * Manages platform adapters for receiving webhooks from different platforms.
 */

const { AppError, ERROR_SEVERITY } = require('../shared/errors');
const { EventEmitter } = require('events');

/**
 * WebhookRouter class
 * Routes webhooks to appropriate handlers
 */
class WebhookRouter extends EventEmitter {
  /**
   * @param {Object} options - Router options
   * @param {Object} options.registry - WebhookRegistry instance
   */
  constructor(options = {}) {
    super();
    
    if (!options.registry) {
      throw new Error('WebhookRegistry is required for WebhookRouter');
    }
    
    this.registry = options.registry;
    this.adapters = new Map();
  }
  
  /**
   * Register a platform adapter
   * @param {Object} adapter - Platform adapter
   * @param {string} adapter.platform - Platform name
   * @param {Function} adapter.parseWebhook - Function to parse platform-specific webhook
   * @returns {WebhookRouter} - The router instance for chaining
   */
  registerAdapter(adapter) {
    if (!adapter.platform) {
      throw new Error('Platform name is required for webhook adapter');
    }
    
    if (typeof adapter.parseWebhook !== 'function') {
      throw new Error('parseWebhook function is required for webhook adapter');
    }
    
    this.adapters.set(adapter.platform, adapter);
    
    this.emit('adapter:registered', {
      platform: adapter.platform,
      timestamp: Date.now()
    });
    
    return this;
  }
  
  /**
   * Get an adapter by platform name
   * @param {string} platform - Platform name
   * @returns {Object|null} - Platform adapter or null if not found
   */
  getAdapter(platform) {
    return this.adapters.get(platform) || null;
  }
  
  /**
   * Process a webhook through the routing system
   * @param {Object} webhook - Webhook data
   * @param {string} webhook.platform - Platform the webhook came from
   * @param {string} [webhook.service] - Service the webhook is for (optional if can be determined from payload)
   * @param {Object} webhook.payload - Raw webhook payload
   * @returns {Promise<Object>} - Processing result
   */
  async routeWebhook(webhook) {
    try {
      // Track start time for metrics
      const startTime = Date.now();
      
      // Parse webhook using platform adapter if platform is specified
      let parsedWebhook = webhook;
      
      if (webhook.platform) {
        const adapter = this.getAdapter(webhook.platform);
        
        if (!adapter) {
          throw new AppError(`No adapter found for platform: ${webhook.platform}`, {
            severity: ERROR_SEVERITY.WARNING,
            code: 'WEBHOOK_ADAPTER_NOT_FOUND'
          });
        }
        
        // Parse webhook using the adapter
        parsedWebhook = await adapter.parseWebhook(webhook);
      }
      
      // Find handlers for this webhook
      const handlers = this.registry.findHandlers(parsedWebhook);
      
      if (handlers.length === 0) {
        throw new AppError('No handlers found for webhook', {
          severity: ERROR_SEVERITY.WARNING,
          code: 'WEBHOOK_NO_HANDLERS',
          details: { 
            service: parsedWebhook.service,
            platform: parsedWebhook.platform
          }
        });
      }
      
      // Log handlers found for debugging
      this.emit('webhook:route', {
        service: parsedWebhook.service,
        platform: parsedWebhook.platform,
        handlers: handlers.length,
        timestamp: Date.now()
      });
      
      // Execute each handler in priority order
      const results = [];
      
      for (const handler of handlers) {
        try {
          const result = await handler.processWebhook(parsedWebhook.payload);
          results.push({
            service: handler.service,
            success: true,
            result
          });
        } catch (error) {
          results.push({
            service: handler.service,
            success: false,
            error: error.message || 'Unknown error'
          });
          
          // Emit error event
          this.emit('webhook:handler:error', {
            service: handler.service,
            error: error.message || 'Unknown error',
            timestamp: Date.now()
          });
        }
      }
      
      // Track processing time
      const processingTime = Date.now() - startTime;
      
      // Emit success event
      this.emit('webhook:processed', {
        service: parsedWebhook.service,
        platform: parsedWebhook.platform,
        handlersExecuted: results.length,
        processingTime,
        timestamp: Date.now()
      });
      
      return {
        success: results.some(r => r.success),
        results,
        processingTime
      };
    } catch (error) {
      // Emit error event
      this.emit('webhook:error', {
        error: error.message || 'Unknown error',
        code: error.code || 'WEBHOOK_PROCESSING_ERROR',
        service: webhook.service,
        platform: webhook.platform,
        timestamp: Date.now()
      });
      
      // Rethrow as AppError
      throw error instanceof AppError ? error : new AppError('Failed to route webhook', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'WEBHOOK_ROUTING_FAILED',
        cause: error
      });
    }
  }
}

module.exports = {
  WebhookRouter
}; 