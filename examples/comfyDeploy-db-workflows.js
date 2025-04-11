/**
 * ComfyDeploy Service with Database-Driven Workflows
 * 
 * This example demonstrates how to use the ComfyDeploy service
 * with workflows loaded from the database.
 */

require('dotenv').config();
const internalAPI = require('../src/core/internalAPI');
const { SessionManager } = require('../src/core/session/manager');
const { ComfyDeployAdapter } = require('../src/services/comfyDeployAdapter');
const { loadWorkflows } = require('../src/services/comfydeploy/workflowLoader');
const WorkflowRepository = require('../src/db/models/workflows');

/**
 * Create a test workflow in the database
 * @returns {Promise<Object>} - The created workflow document
 */
async function createTestWorkflow() {
  // Use the repository through abstraction layer
  const workflowRepository = new WorkflowRepository();
  
  // Example workflow layout structure
  const workflowLayout = {
    nodes: [
      {
        type: 'ComfyUIDeploy',
        widgets_values: [
          'input_prompt',
          'input_negative_prompt',
          'input_width',
          'input_height',
          'input_steps',
          'input_seed'
        ]
      }
    ]
  };
  
  // Example workflows
  const testFlows = [
    {
      name: 'TEST_TXT2IMG',
      ids: ['test-deployment-id-1'],
      layout: JSON.stringify(workflowLayout),
      active: true
    },
    {
      name: 'TEST_UPSCALE',
      ids: ['test-deployment-id-2'],
      layout: JSON.stringify({
        nodes: [
          {
            type: 'ComfyUIDeploy',
            widgets_values: [
              'input_image',
              'input_scale',
              'input_model'
            ]
          }
        ]
      }),
      active: true
    }
  ];
  
  try {
    // Check if we already have workflows
    const existingDoc = await workflowRepository.findOne();
    
    if (existingDoc) {
      // Update existing document
      console.log('Updating existing workflows document');
      return await workflowRepository.updateOne(
        { _id: existingDoc._id },
        { flows: [...(existingDoc.flows || []), ...testFlows] }
      );
    } else {
      // Create new document
      console.log('Creating new workflows document');
      return await workflowRepository.create({
        flows: testFlows
      });
    }
  } catch (error) {
    console.error('Error creating test workflows:', error);
    throw error;
  }
}

/**
 * Display all workflows with their input structure
 */
async function displayAvailableWorkflows() {
  try {
    // Load workflows from database
    const workflows = await loadWorkflows();
    
    console.log('\n=== Available Workflows ===');
    
    if (workflows.length === 0) {
      console.log('No workflows available in database');
      return;
    }
    
    workflows.forEach(workflow => {
      console.log(`\n- ${workflow.name}:`);
      console.log(`  Deployment IDs: ${workflow.ids.join(', ') || 'none'}`);
      console.log('  Required Inputs:');
      
      if (workflow.parsedInputs && workflow.parsedInputs.length > 0) {
        workflow.parsedInputs.forEach(input => {
          console.log(`    - ${input}`);
        });
      } else {
        console.log('    (No inputs defined)');
      }
      
      console.log(`  Active: ${workflow.active ? 'Yes' : 'No'}`);
    });
    
    console.log('\n');
  } catch (error) {
    console.error('Error displaying workflows:', error);
  }
}

/**
 * Initialize the internal API and services
 */
async function initialize() {
  console.log('Setting up test environment...');
  
  try {
    // Create test workflows in DB if needed
    await createTestWorkflow();
    
    // Display available workflows
    await displayAvailableWorkflows();
    
    // Initialize session manager
    const sessionManager = new SessionManager();
    
    // Setup internal API with session manager
    internalAPI.setup({ sessionManager });
    
    // Register ComfyDeploy service with DB-driven workflows
    const result = await internalAPI.registerService({
      name: 'comfydeploy',
      type: 'ComfyDeploy',
      config: {
        apiKey: process.env.COMFY_DEPLOY_API_KEY,
        baseUrl: process.env.COMFY_DEPLOY_BASE_URL,
        webhookUrl: process.env.COMFY_DEPLOY_WEBHOOK_URL,
        // No need to specify workflows here - they will be loaded from DB
        workflowReloadInterval: 60000, // Reload every minute for this example
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
    
    console.log('ComfyDeploy service registered with database workflows!');
    
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
  } catch (error) {
    console.error('Error in initialization:', error);
    throw error;
  }
}

/**
 * Add a new workflow to the database
 * @param {string} name - Workflow name
 * @param {Array} deploymentIds - Array of deployment IDs
 * @param {Array} inputs - Array of input parameter names
 */
async function addWorkflow(name, deploymentIds, inputs) {
  try {
    console.log(`Adding new workflow: ${name}`);
    
    // Use the repository through abstraction layer
    const workflowRepository = new WorkflowRepository();
    
    // Create a node structure with the inputs
    const workflowLayout = {
      nodes: [
        {
          type: 'ComfyUIDeploy',
          widgets_values: inputs.map(input => `input_${input}`)
        }
      ]
    };
    
    // Create workflow object
    const newWorkflow = {
      name,
      ids: deploymentIds,
      layout: JSON.stringify(workflowLayout),
      active: true
    };
    
    // Get the existing document
    const existingDoc = await workflowRepository.findOne();
    
    if (existingDoc) {
      // Check if the workflow already exists
      const existingIndex = existingDoc.flows.findIndex(flow => flow.name === name);
      
      if (existingIndex >= 0) {
        // Update existing workflow
        existingDoc.flows[existingIndex] = newWorkflow;
      } else {
        // Add new workflow
        existingDoc.flows.push(newWorkflow);
      }
      
      // Save changes
      await workflowRepository.updateOne(
        { _id: existingDoc._id },
        { flows: existingDoc.flows }
      );
    } else {
      // Create new document
      await workflowRepository.create({
        flows: [newWorkflow]
      });
    }
    
    console.log(`Workflow '${name}' added/updated successfully`);
    
    // Display the updated workflows
    await displayAvailableWorkflows();
    
    return true;
  } catch (error) {
    console.error(`Error adding workflow '${name}':`, error);
    return false;
  }
}

/**
 * Execute a generation request
 * @param {string} userId - User ID
 * @param {string} type - Workflow type
 * @param {string} prompt - Generation prompt
 * @param {Object} settings - Generation settings
 */
async function generateImage(userId, type, prompt, settings = {}) {
  console.log(`Generating ${type} image with prompt: "${prompt}"`);
  
  try {
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
  } catch (error) {
    console.error('Error generating image:', error);
    return null;
  }
}

/**
 * Force reload workflows and display the current list
 */
async function forceReloadWorkflows() {
  try {
    // Get the ComfyDeploy service from the registry
    const serviceRegistry = require('../src/services/registry').ServiceRegistry.getInstance();
    const comfyAdapter = serviceRegistry.get('comfydeploy');
    
    // Reload workflows
    const reloadResult = await comfyAdapter.reloadWorkflows();
    
    if (reloadResult) {
      console.log('Workflows reloaded successfully');
      
      // Get updated metadata
      const metadata = comfyAdapter.getMetadata();
      console.log('Available workflows:', metadata.availableWorkflows);
      console.log('Last reload time:', new Date(metadata.workflowLastLoaded).toLocaleString());
    } else {
      console.log('Workflow reload not performed or failed');
    }
  } catch (error) {
    console.error('Error reloading workflows:', error);
  }
}

/**
 * Demonstrates how to manipulate and use database-driven workflows
 */
async function main() {
  try {
    // Initialize the system
    const user = await initialize();
    
    // Execute a generation using a workflow from the database
    console.log('\nTesting generation with database workflow:');
    const generation = await generateImage(
      user.id,
      'TEST_TXT2IMG',
      'a beautiful landscape with mountains and a lake, photorealistic',
      {
        width: 1024,
        height: 1024,
        steps: 30,
        seed: -1
      }
    );
    
    // Add a new workflow to the database
    console.log('\nAdding a new workflow to the database:');
    await addWorkflow(
      'CUSTOM_STYLE',
      ['custom-deployment-id'],
      ['prompt', 'negative_prompt', 'width', 'height', 'steps', 'seed', 'style']
    );
    
    // Force reload workflows to pick up the new workflow
    console.log('\nForcing workflow reload:');
    await forceReloadWorkflows();
    
    // Try the new workflow
    console.log('\nTesting generation with new workflow:');
    await generateImage(
      user.id,
      'CUSTOM_STYLE',
      'a cute cat in a garden',
      {
        width: 768,
        height: 768,
        steps: 25,
        seed: 12345,
        style: 'anime'
      }
    );
    
    console.log('\nExample completed successfully!');
  } catch (error) {
    console.error('Error in example:', error);
  }
}

// Run the example
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  initialize,
  addWorkflow,
  displayAvailableWorkflows,
  forceReloadWorkflows,
  generateImage
}; 