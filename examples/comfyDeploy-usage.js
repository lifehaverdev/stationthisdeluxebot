/**
 * Example usage of ComfyDeploy service with the internal API
 * 
 * This script demonstrates how to:
 * 1. Register the ComfyDeploy service
 * 2. Execute generation requests
 * 3. Check generation status
 * 4. Cancel generations
 */

require('dotenv').config();
const internalAPI = require('../src/core/internalAPI');
const { SessionManager } = require('../src/core/session/manager');
const { ComfyDeployAdapter } = require('../src/services/comfyDeployAdapter');

// Define example workflows for ComfyDeploy
const exampleWorkflows = [
  {
    name: 'DEFAULT',
    ids: ['default-deployment-id'], // Replace with actual deployment ID
    inputs: {
      positive_prompt: '', // Will be populated from request
      negative_prompt: '',
      width: 1024,
      height: 1024,
      steps: 30,
      cfg: 7,
      sampler: 'dpmpp_2m',
      seed: -1
    }
  },
  {
    name: 'UPSCALE',
    ids: ['upscale-deployment-id'], // Replace with actual deployment ID
    inputs: {
      image: '', // Will be populated from inputImages
      scale: 2
    }
  },
  {
    name: 'RMBG',
    ids: ['rmbg-deployment-id'], // Replace with actual deployment ID
    inputs: {
      image: '' // Will be populated from inputImages
    }
  }
];

// Example function to get base prompts by name
function getBasePromptByName(name) {
  const basePrompts = {
    'realistic': 'photorealistic, high quality, intricate details, RAW photo, 4k uhd',
    'anime': 'anime style, vibrant colors, clean lines, manga style artwork',
    'cartoon': 'cartoon style, bright colors, simple shapes, fun and playful'
  };
  
  return basePrompts[name] || '';
}

// Initialize the API and service
async function initialize() {
  console.log('Initializing internal API and ComfyDeploy service...');
  
  // Initialize session manager
  const sessionManager = new SessionManager();
  
  // Setup internal API with session manager
  internalAPI.setup({ sessionManager });
  
  // Register ComfyDeploy service
  const result = await internalAPI.registerService({
    name: 'comfydeploy',
    type: 'ComfyDeploy',
    config: {
      apiKey: process.env.COMFY_DEPLOY_API_KEY,
      baseUrl: process.env.COMFY_DEPLOY_BASE_URL,
      webhookUrl: process.env.COMFY_DEPLOY_WEBHOOK_URL,
      getBasePromptByName,
      workflows: exampleWorkflows,
      defaultSettings: {
        WIDTH: 1024,
        HEIGHT: 1024,
        STEPS: 30,
        CFG: 7
      }
    }
  });
  
  if (result.status !== 'ok') {
    console.error('Failed to register ComfyDeploy service:', result.error);
    process.exit(1);
  }
  
  console.log('ComfyDeploy service registered successfully!');
  
  // Create a test user
  const userData = await internalAPI.createUser({
    platform: 'test',
    platformId: 'test123',
    profile: {
      username: 'tester',
      email: 'test@example.com'
    }
  });
  
  if (userData.status !== 'ok') {
    console.error('Failed to create test user:', userData.error);
    process.exit(1);
  }
  
  console.log('Test user created:', userData.user.id);
  
  // Add credits to the user
  const creditResult = await internalAPI.addUserCredit(userData.user.id, 1000, 'test');
  
  if (creditResult.status !== 'ok') {
    console.error('Failed to add credits:', creditResult.error);
    process.exit(1);
  }
  
  console.log('Added 1000 credits to user account');
  
  return userData.user;
}

// Execute a generation request through the internal API
async function generateImage(userId, type, prompt, settings = {}) {
  console.log(`Generating ${type} image with prompt: "${prompt}"`);
  
  const result = await internalAPI.executeService('comfydeploy', {
    type,
    prompt,
    settings
  }, {
    userId
  });
  
  if (result.status !== 'ok') {
    console.error('Failed to execute service:', result.error);
    return null;
  }
  
  console.log(`Generation started with task ID: ${result.result.taskId}`);
  console.log(`Estimated time: ${result.result.timeEstimate} seconds`);
  console.log(`Cost: ${result.result.cost} points`);
  
  return result.result;
}

// Check the status of a generation task
async function checkGenerationStatus(taskId) {
  console.log(`Checking status of task: ${taskId}`);
  
  // For this example, we access the service directly
  // In a real app, you'd have an endpoint in your API
  const services = await internalAPI.getServices();
  
  if (services.status !== 'ok') {
    console.error('Failed to get services:', services.error);
    return null;
  }
  
  // Get the ComfyDeploy service from the registry
  const serviceRegistry = require('../src/services/registry').ServiceRegistry.getInstance();
  const comfyAdapter = serviceRegistry.get('comfydeploy');
  
  // Check status
  const status = await comfyAdapter.checkStatus(taskId);
  
  console.log(`Status: ${status.status}, Progress: ${status.progress}%`);
  
  if (status.isComplete && status.status === 'completed') {
    console.log('Generation completed!');
    console.log('Outputs:', status.result.outputs);
  } else if (status.isComplete && status.status === 'failed') {
    console.log('Generation failed:', status.error);
  }
  
  return status;
}

// Cancel a generation task
async function cancelGeneration(taskId) {
  console.log(`Cancelling task: ${taskId}`);
  
  // Get the ComfyDeploy service from the registry
  const serviceRegistry = require('../src/services/registry').ServiceRegistry.getInstance();
  const comfyAdapter = serviceRegistry.get('comfydeploy');
  
  // Cancel the task
  const result = await comfyAdapter.cancelTask(taskId);
  
  console.log(`Task ${taskId} cancelled:`, result);
  
  return result;
}

// Main function to run the example
async function main() {
  try {
    // Initialize and get test user
    const user = await initialize();
    
    // Get the cost estimate for a generation
    const costResult = await internalAPI.getServiceCost('comfydeploy', {
      type: 'DEFAULT',
      settings: {
        width: 1024,
        height: 1024
      }
    });
    
    if (costResult.status === 'ok') {
      console.log(`Estimated cost for DEFAULT generation: ${costResult.cost} points`);
    }
    
    // Execute a generation
    const generation = await generateImage(
      user.id,
      'DEFAULT',
      'a beautiful landscape with mountains and a lake, photorealistic',
      {
        width: 1024,
        height: 1024,
        steps: 30,
        seed: -1
      }
    );
    
    if (!generation) {
      console.log('Failed to start generation');
      return;
    }
    
    // Poll for status a few times
    let status = null;
    let isComplete = false;
    let attempt = 0;
    
    while (!isComplete && attempt < 5) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      status = await checkGenerationStatus(generation.taskId);
      
      if (!status) {
        console.log('Failed to check status');
        break;
      }
      
      isComplete = status.isComplete;
      attempt++;
      
      // If still in progress after 3 attempts, cancel the generation
      if (!isComplete && attempt === 3) {
        console.log('Generation taking too long, cancelling...');
        await cancelGeneration(generation.taskId);
        break;
      }
    }
    
    // Get user's remaining credit
    const creditResult = await internalAPI.getUserCredit(user.id);
    
    if (creditResult.status === 'ok') {
      console.log(`Remaining credits: ${creditResult.credits.points}`);
    }
    
    console.log('Example completed successfully!');
  } catch (error) {
    console.error('Error running example:', error);
  }
}

// Run the example
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  initialize,
  generateImage,
  checkGenerationStatus,
  cancelGeneration
}; 