/**
 * ComfyDeploy Webhook Integration Example
 * 
 * This example demonstrates how to set up the webhook system for ComfyDeploy integration.
 * It shows how to create handlers, register them with the registry, and process incoming webhooks.
 */

// Import core webhook components
const { createWebhookSystem } = require('../index');
const { createComfyDeployWebhookHandler } = require('../handlers/comfyDeployHandler');
const { createWebAdapter, createComfyDeployAdapter } = require('../adapter');

// Import services needed by the webhook handler
const ComfyDeployService = require('../../../services/comfydeploy/ComfyDeployService');
const WorkflowManager = require('../../workflow/manager');
const TaskManager = require('../../tasks/manager');

/**
 * Set up the webhook system for ComfyDeploy
 * @param {Object} options - Setup options
 * @param {Object} options.comfyDeployService - ComfyDeploy service instance
 * @param {Object} options.workflowManager - Workflow manager instance
 * @param {Object} options.taskManager - Task manager instance
 * @param {Object} options.eventBus - Event bus instance
 * @returns {Object} - Webhook system
 */
function setupComfyDeployWebhooks(options = {}) {
  // Create or use provided services
  const comfyDeployService = options.comfyDeployService || new ComfyDeployService();
  const workflowManager = options.workflowManager || new WorkflowManager();
  const taskManager = options.taskManager || new TaskManager();
  const eventBus = options.eventBus || { emit: () => {} };
  
  // Create ComfyDeploy webhook handler
  const comfyDeployHandler = createComfyDeployWebhookHandler({
    comfyDeployService,
    workflowManager,
    taskManager,
    eventBus
  });
  
  // Create platform adapters
  const webAdapter = createWebAdapter();
  const comfyDeployAdapter = createComfyDeployAdapter();
  
  // Create the webhook system
  const webhookSystem = createWebhookSystem({
    handlers: [comfyDeployHandler],
    adapters: [webAdapter, comfyDeployAdapter]
  });
  
  // Set up event listeners for monitoring
  webhookSystem.controller.on('webhook:received', ({ platform, service }) => {
    console.log(`Received webhook from platform: ${platform}, service: ${service}`);
  });
  
  webhookSystem.controller.on('webhook:completed', ({ processingTime }) => {
    console.log(`Webhook processed in ${processingTime}ms`);
  });
  
  webhookSystem.controller.on('webhook:error', ({ error, code }) => {
    console.error(`Webhook error: ${error} (${code})`);
  });
  
  return webhookSystem;
}

/**
 * Process a ComfyDeploy webhook
 * @param {Object} webhookSystem - Webhook system instance
 * @param {Object} payload - Raw webhook payload
 * @returns {Promise<Object>} - Processing result
 */
async function processComfyDeployWebhook(webhookSystem, payload) {
  try {
    // Process webhook
    const result = await webhookSystem.processWebhook({
      platform: 'comfydeploy', // Use the ComfyDeploy platform adapter
      service: 'comfydeploy',  // Specify the service
      payload                  // The raw webhook payload
    });
    
    console.log('Webhook processed with result:', result.success);
    return result;
  } catch (error) {
    console.error('Failed to process webhook:', error);
    throw error;
  }
}

/**
 * Example usage
 */
async function exampleUsage() {
  // Create mock services
  const mockComfyDeployService = {
    processWebhook: (payload) => ({ success: true, taskId: payload.webhook_data?.taskId })
  };
  
  const mockWorkflowManager = {
    getWorkflow: (id) => ({ id, getCurrentStepId: () => 'status' }),
    processWorkflowStep: async () => ({})
  };
  
  const mockTaskManager = {
    completeTask: async () => ({}),
    failTask: async () => ({}),
    updateTask: async () => ({})
  };
  
  // Set up webhook system
  const webhookSystem = setupComfyDeployWebhooks({
    comfyDeployService: mockComfyDeployService,
    workflowManager: mockWorkflowManager,
    taskManager: mockTaskManager
  });
  
  // Example webhook payload from ComfyDeploy
  const examplePayload = {
    run_id: 'run_123456',
    status: 'success',
    output: {
      images: ['https://example.com/image1.png']
    },
    webhook_data: {
      taskId: 'task_123456',
      userId: 'user_123456',
      workflowId: 'workflow_123456'
    }
  };
  
  // Process the webhook
  try {
    const result = await processComfyDeployWebhook(webhookSystem, examplePayload);
    console.log('Example webhook processed successfully:', result);
  } catch (error) {
    console.error('Example failed:', error);
  }
}

/**
 * Only run the example if this file is executed directly
 */
if (require.main === module) {
  exampleUsage().catch(console.error);
}

module.exports = {
  setupComfyDeployWebhooks,
  processComfyDeployWebhook
}; 