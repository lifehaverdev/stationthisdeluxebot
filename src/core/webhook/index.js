/**
 * Webhook Module
 * 
 * Platform-agnostic implementation of webhook handling for service integrations.
 * Provides a registry, router, and management for incoming webhooks from external services.
 */

const { WebhookRegistry } = require('./registry');
const { WebhookRouter } = require('./router');
const { WebhookController } = require('./controller');
const { createWebhookAdapter } = require('./adapter');

/**
 * Create a webhook system with the provided options
 * @param {Object} options - Configuration options
 * @param {Object} [options.registry] - Optional pre-configured webhook registry
 * @param {Object} [options.router] - Optional pre-configured webhook router
 * @param {Array} [options.adapters] - Array of platform adapters to register
 * @param {Array} [options.handlers] - Array of webhook handlers to register
 * @returns {Object} - Configured webhook system
 */
function createWebhookSystem(options = {}) {
  const registry = options.registry || new WebhookRegistry();
  const router = options.router || new WebhookRouter({ registry });
  const controller = new WebhookController({ registry, router });
  
  // Register all provided handlers
  if (options.handlers && Array.isArray(options.handlers)) {
    options.handlers.forEach(handler => {
      registry.registerHandler(handler);
    });
  }
  
  // Register all provided adapters
  if (options.adapters && Array.isArray(options.adapters)) {
    options.adapters.forEach(adapter => {
      router.registerAdapter(adapter);
    });
  }
  
  return {
    registry,
    router,
    controller,
    
    // Convenience method to process a webhook
    processWebhook: controller.processWebhook.bind(controller)
  };
}

module.exports = {
  WebhookRegistry,
  WebhookRouter,
  WebhookController,
  createWebhookAdapter,
  createWebhookSystem
}; 