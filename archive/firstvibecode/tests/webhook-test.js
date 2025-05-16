/**
 * ComfyDeploy Webhook Test
 * 
 * A simple test script to send a mock webhook to the ComfyDeploy webhook handler.
 * This can be used for local testing without setting up full webhook infrastructure.
 */

require('dotenv').config();
const { processWebhook } = require('../src/core/webhook/comfyDeployHandler');
const { ServiceRegistry } = require('../src/services/registry');
const { ComfyDeployAdapter } = require('../src/services/comfyDeployAdapter');
const { SessionManager } = require('../src/core/session/manager');
const internalAPI = require('../src/core/internalAPI');

// Example workflows for testing
const testWorkflows = [
  {
    name: 'TEST',
    ids: ['test-deployment-id'],
    inputs: {
      prompt: '',
      negative_prompt: '',
      width: 512,
      height: 512
    }
  }
];

// Initialize the service
async function setupService() {
  console.log('Initializing ComfyDeploy service...');
  
  // Setup session manager
  const sessionManager = new SessionManager();
  
  // Initialize internal API
  internalAPI.setup({
    sessionManager
  });
  
  // Create the adapter
  const adapter = new ComfyDeployAdapter({
    serviceName: 'comfydeploy',
    config: {
      apiKey: process.env.COMFY_DEPLOY_API_KEY || 'test-api-key',
      baseUrl: process.env.COMFY_DEPLOY_BASE_URL || 'https://api.example.com',
      webhookUrl: process.env.COMFY_DEPLOY_WEBHOOK_URL || 'https://webhook.example.com',
      workflows: testWorkflows
    }
  });
  
  // Initialize the adapter
  await adapter.init();
  
  // Register the adapter with the service registry
  const serviceRegistry = ServiceRegistry.getInstance();
  serviceRegistry.register(adapter);
  
  console.log('ComfyDeploy service initialized and registered');
  
  return adapter;
}

// Create a mock webhook payload
function createMockWebhook(success = true) {
  return {
    run_id: `test_run_${Date.now()}`,
    status: success ? 'success' : 'failed',
    outputs: success ? [
      {
        type: 'image',
        url: 'https://example.com/image.jpg',
        metadata: {
          seed: 12345,
          width: 512,
          height: 512
        }
      }
    ] : [],
    error: success ? null : 'Test error message',
    webhook_data: {
      taskId: `task_${Date.now()}`,
      userId: 'test-user-123',
      platform: 'test'
    }
  };
}

// Process a webhook
async function testWebhook(success = true) {
  try {
    // Setup the service
    const adapter = await setupService();
    
    // Create a listener for the webhook result
    adapter.comfyService.once('generation:completed', (data) => {
      console.log('Generation completed event received:', data);
    });
    
    adapter.comfyService.once('generation:failed', (data) => {
      console.log('Generation failed event received:', data);
    });
    
    // Create a mock webhook
    const webhookPayload = createMockWebhook(success);
    
    console.log('Processing webhook payload:', JSON.stringify(webhookPayload, null, 2));
    
    // Process the webhook
    const result = await processWebhook(webhookPayload);
    
    console.log('Webhook processed successfully:', result);
    
    return result;
  } catch (error) {
    console.error('Error processing webhook:', error);
    throw error;
  } finally {
    // Shutdown the service registry
    const serviceRegistry = ServiceRegistry.getInstance();
    await serviceRegistry.shutdownAll();
  }
}

// Run the test
async function main() {
  console.log('Testing successful webhook...');
  await testWebhook(true);
  
  console.log('\nTesting failed webhook...');
  await testWebhook(false);
}

// Run if called directly
if (require.main === module) {
  main()
    .then(() => {
      console.log('Webhook test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Webhook test failed:', error);
      process.exit(1);
    });
}

module.exports = {
  testWebhook,
  createMockWebhook
}; 