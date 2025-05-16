/**
 * Webhook Adapter Interface
 * 
 * Provides abstract interfaces for platform-specific webhook adapters.
 * These adapters convert platform-specific webhook formats to a standard internal format.
 */

const { AppError, ERROR_SEVERITY } = require('../shared/errors');

/**
 * Abstract WebhookAdapter interface
 * @typedef {Object} WebhookAdapter
 * @property {string} platform - Platform identifier (e.g. 'web', 'telegram')
 * @property {Function} parseWebhook - Function to parse platform-specific webhook
 */

/**
 * Create a webhook adapter for a specific platform
 * @param {Object} options - Adapter options
 * @param {string} options.platform - Platform identifier (e.g. 'web', 'telegram')
 * @param {Function} options.parseWebhook - Function to parse platform-specific webhook
 * @returns {WebhookAdapter} - Webhook adapter
 */
function createWebhookAdapter(options = {}) {
  if (!options.platform) {
    throw new Error('Platform identifier is required for webhook adapter');
  }
  
  if (typeof options.parseWebhook !== 'function') {
    throw new Error('parseWebhook function is required for webhook adapter');
  }
  
  return {
    platform: options.platform,
    parseWebhook: options.parseWebhook
  };
}

/**
 * Create a web platform adapter for standard HTTP webhooks
 * @returns {WebhookAdapter} - Web platform adapter
 */
function createWebAdapter() {
  return createWebhookAdapter({
    platform: 'web',
    parseWebhook: async (webhook) => {
      try {
        // For web webhooks, we assume the service is already specified
        // or that it can be determined from the payload
        const { service, payload } = webhook;
        
        // Try to determine service from payload if not provided
        let detectedService = service;
        
        if (!detectedService) {
          // Look for common patterns in webhooks to identify the service
          if (payload.run_id && payload.webhook_data) {
            detectedService = 'comfydeploy';
          } else if (payload.event && payload.api_version) {
            detectedService = 'stripe';
          } else if (payload.repository && payload.action) {
            detectedService = 'github';
          }
        }
        
        return {
          service: detectedService,
          platform: 'web',
          payload
        };
      } catch (error) {
        throw new AppError('Failed to parse web webhook', {
          severity: ERROR_SEVERITY.ERROR,
          code: 'WEBHOOK_PARSE_FAILED',
          cause: error
        });
      }
    }
  });
}

/**
 * Create a ComfyDeploy specific adapter
 * @returns {WebhookAdapter} - ComfyDeploy specific adapter
 */
function createComfyDeployAdapter() {
  return createWebhookAdapter({
    platform: 'comfydeploy',
    parseWebhook: async (webhook) => {
      try {
        const { payload } = webhook;
        
        // Validate payload
        if (!payload.run_id) {
          throw new Error('Missing run_id in ComfyDeploy webhook');
        }
        
        return {
          service: 'comfydeploy',
          platform: 'comfydeploy',
          payload,
          // Extract useful metadata from payload
          metadata: {
            runId: payload.run_id,
            status: payload.status,
            taskId: payload.webhook_data?.taskId,
            userId: payload.webhook_data?.userId,
            timestamp: Date.now()
          }
        };
      } catch (error) {
        throw new AppError('Failed to parse ComfyDeploy webhook', {
          severity: ERROR_SEVERITY.ERROR,
          code: 'WEBHOOK_PARSE_FAILED',
          cause: error
        });
      }
    }
  });
}

module.exports = {
  createWebhookAdapter,
  createWebAdapter,
  createComfyDeployAdapter
}; 