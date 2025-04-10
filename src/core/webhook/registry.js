/**
 * Webhook Registry
 * 
 * Manages registered webhook handlers and routes webhooks to appropriate handler.
 * Provides a lookup system for finding handlers based on service type and event.
 */

const { AppError, ERROR_SEVERITY } = require('../shared/errors');
const { EventEmitter } = require('events');

/**
 * WebhookHandler class
 * Defines the interface for webhook handlers
 */
class WebhookHandler {
  /**
   * @param {Object} options - Handler options
   * @param {string} options.service - Service this handler manages (e.g., 'comfydeploy')
   * @param {Function} options.canHandle - Function that determines if this handler can process a webhook
   * @param {Function} options.processWebhook - Function that processes the webhook payload
   * @param {number} [options.priority=10] - Handler priority (lower values run first)
   */
  constructor(options = {}) {
    if (!options.service) {
      throw new Error('Service name is required for webhook handler');
    }
    
    if (typeof options.canHandle !== 'function') {
      throw new Error('canHandle function is required for webhook handler');
    }
    
    if (typeof options.processWebhook !== 'function') {
      throw new Error('processWebhook function is required for webhook handler');
    }
    
    this.service = options.service;
    this.canHandle = options.canHandle;
    this.processWebhook = options.processWebhook;
    this.priority = options.priority || 10;
  }
}

/**
 * WebhookRegistry class
 * Manages registered webhook handlers
 */
class WebhookRegistry extends EventEmitter {
  constructor() {
    super();
    this.handlers = [];
  }
  
  /**
   * Register a new webhook handler
   * @param {WebhookHandler|Object} handler - Handler to register
   * @returns {WebhookRegistry} - The registry instance for chaining
   */
  registerHandler(handler) {
    // Ensure handler is a WebhookHandler instance
    const handlerInstance = handler instanceof WebhookHandler
      ? handler
      : new WebhookHandler(handler);
    
    // Add to handlers array
    this.handlers.push(handlerInstance);
    
    // Sort handlers by priority
    this.handlers.sort((a, b) => a.priority - b.priority);
    
    // Emit registration event
    this.emit('handler:registered', {
      service: handlerInstance.service,
      timestamp: Date.now()
    });
    
    return this;
  }
  
  /**
   * Find handlers that can process a webhook
   * @param {Object} webhook - Webhook data
   * @param {string} [webhook.service] - Service name
   * @param {Object} webhook.payload - Raw webhook payload
   * @returns {Array<WebhookHandler>} - Matching handlers
   */
  findHandlers(webhook) {
    // Return all handlers that can handle this webhook
    return this.handlers.filter(handler => {
      // If service is specified in webhook, filter by service
      if (webhook.service && handler.service !== webhook.service) {
        return false;
      }
      
      // Check if the handler can process this webhook
      try {
        return handler.canHandle(webhook.payload);
      } catch (error) {
        return false;
      }
    });
  }
  
  /**
   * Find handlers by service name
   * @param {string} service - Service name
   * @returns {Array<WebhookHandler>} - Matching handlers
   */
  getHandlersByService(service) {
    return this.handlers.filter(handler => handler.service === service);
  }
  
  /**
   * Get all registered handlers
   * @returns {Array<WebhookHandler>} - All handlers
   */
  getAllHandlers() {
    return [...this.handlers];
  }
  
  /**
   * Clear all handlers
   * @returns {WebhookRegistry} - The registry instance for chaining
   */
  clearHandlers() {
    this.handlers = [];
    this.emit('registry:cleared', {
      timestamp: Date.now()
    });
    return this;
  }
}

module.exports = {
  WebhookHandler,
  WebhookRegistry
}; 