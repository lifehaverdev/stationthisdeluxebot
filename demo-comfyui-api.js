/**
 * Demo script to show the ComfyUI Deploy API integration in action
 * 
 * This script demonstrates how workflows are loaded directly from the
 * ComfyUI Deploy API without any database dependencies.
 */

// Load environment variables from .env file
require('dotenv').config();

// Import the core services
const WorkflowsService = require('./src/core/services/workflows');
const ComfyUIService = require('./src/core/services/comfyui');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Enhanced logging function
function log(level, message, details = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  
  console.log(`${prefix} ${message}`);
  if (details) {
    console.log(`${' '.repeat(prefix.length + 1)}`, details);
  }
}

// Get API URL from environment or use default
const API_URL = process.env.COMFY_DEPLOY_API_URL || 'https://api.comfydeploy.com';
log('info', `Using ComfyUI Deploy API URL: ${API_URL}`);

// Verify API connectivity
async function testAPIConnectivity() {
  log('debug', 'Testing API connectivity...');
  
  try {
    // Try with the updated endpoint paths
    const endpoints = [
      `${API_URL}/run/123`, // Get run status endpoint - requires valid ID but will test auth
      `${API_URL}/deployments`, // Get deployments endpoint
      `${API_URL}/machines`, // Get machines endpoint
      `${API_URL}` // Base URL check
    ];
    
    log('debug', 'Testing the following endpoints:');
    endpoints.forEach(endpoint => log('debug', `- ${endpoint}`));
    
    for (const endpoint of endpoints) {
      log('debug', `Trying to connect to: ${endpoint}`);
      
      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${process.env.COMFY_DEPLOY_API_KEY || ''}`,
            'Accept': 'application/json'
          }
        });
        
        log('debug', `Response from ${endpoint}: Status ${response.status}`);
        
        if (response.status === 401) {
          log('info', `✅ Endpoint ${endpoint} exists (Authentication required)`);
        } else if (response.ok) {
          log('info', `✅ Successfully connected to ${endpoint}`);
          return;
        } else if (response.status === 404) {
          log('warn', `❌ Endpoint not found: ${endpoint}`);
        } else {
          const text = await response.text();
          log('debug', `Response body: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
        }
      } catch (error) {
        log('debug', `Error connecting to ${endpoint}: ${error.message}`);
      }
    }
    
    log('warn', '❓ Could not fully verify API connectivity. This may be due to authentication issues or endpoint changes.');
  } catch (error) {
    log('error', `Error testing API connectivity: ${error.message}`);
  }
}

// Display API client configuration
function showAPIClientConfig() {
  log('info', '\n====== API CLIENT CONFIGURATION ======\n');
  log('info', `API URL: ${API_URL}`);
  log('info', `API Key present: ${process.env.COMFY_DEPLOY_API_KEY ? 'Yes' : 'No'}`);
  log('info', `API Key length: ${process.env.COMFY_DEPLOY_API_KEY ? process.env.COMFY_DEPLOY_API_KEY.length : 0}`);
  
  // Display endpoints that will be used
  log('info', '\nEndpoints that will be used:');
  log('info', ` - Get deployments: ${API_URL}/deployments`);
  log('info', ` - Get workflow: ${API_URL}/workflow/{id}`);
  log('info', ` - Get machines: ${API_URL}/machines`);
  log('info', ` - Submit run: ${API_URL}/run/deployment/queue`);
  log('info', ` - Check run status: ${API_URL}/run/{run_id}`);
  log('info', ` - Cancel run: ${API_URL}/run/{run_id}/cancel`);
  log('info', '');
}

// Create service instances with custom API URL and enhanced logging
const workflowsLogger = {
  info: (message) => log('workflows', message),
  warn: (message, details = null) => log('workflows-warn', message, details),
  error: (message, details = null) => log('workflows-error', message, details)
};

const workflows = new WorkflowsService({
  logger: workflowsLogger,
  apiUrl: API_URL
});

const comfyuiLogger = {
  info: (message) => log('comfyui', message),
  warn: (message, details = null) => log('comfyui-warn', message, details),
  error: (message, details = null) => log('comfyui-error', message, details)
};

const comfyui = new ComfyUIService({
  logger: comfyuiLogger,
  apiUrl: API_URL
});

// Override the _makeApiRequest method to add more logging
const originalMakeApiRequest = comfyui._makeApiRequest;
comfyui._makeApiRequest = async function(endpoint, options = {}) {
  const url = endpoint.startsWith('http') 
    ? endpoint 
    : `${this.apiUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  
  log('debug', `Making API request to: ${url}`);
  log('debug', `Request method: ${options.method || 'GET'}`);
  
  try {
    const response = await originalMakeApiRequest.call(this, endpoint, options);
    log('debug', `Response status: ${response.status}`);
    
    if (!response.ok) {
      const text = await response.text();
      log('debug', `Error response body: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
    }
    
    return response;
  } catch (error) {
    log('error', `API request failed: ${error.message}`);
    throw error;
  }
};

// Function to list all workflows
async function listAllWorkflows() {
  log('info', '\n====== WORKFLOWS FROM COMFYUI DEPLOY ======\n');
  
  try {
    // Load workflows directly from ComfyUI Deploy API
    const allWorkflows = await workflows.getWorkflows();
    
    log('info', `Found ${allWorkflows.length} workflows:\n`);
    
    // Display workflow information
    allWorkflows.forEach((workflow, index) => {
      log('info', `${index + 1}. ${workflow.displayName || workflow.name}`);
      log('info', `   ID: ${workflow.id}`);
      log('info', `   Inputs: ${workflow.inputs.length ? workflow.inputs.join(', ') : 'None'}`);
      log('info', `   Deployments: ${workflow.deploymentIds.length}`);
      log('info', `   Last Updated: ${workflow.updatedAt || 'Unknown'}`);
      log('info', '');
    });
  } catch (error) {
    log('error', `Error listing workflows: ${error.message}`);
  }
}

// Function to get details about a specific deployment
async function getDeploymentDetails(deploymentId) {
  log('info', `\n====== DEPLOYMENT DETAILS FOR ${deploymentId} ======\n`);
  
  try {
    // Get deployment directly from ComfyUI Deploy API
    const deployment = await workflows.getDeploymentById(deploymentId, true);
    
    if (!deployment) {
      log('warn', `No deployment found with ID: ${deploymentId}`);
      return;
    }
    
    log('info', `Name: ${deployment.name || 'Unnamed'}`);
    log('info', `Status: ${deployment.status || 'Unknown'}`);
    log('info', `Machine: ${deployment.machine?.name || 'Unknown'}`);
    
    if (deployment.workflow_version) {
      log('info', '\nWorkflow Information:');
      log('info', `  Name: ${deployment.workflow_version.workflow?.name || 'Unnamed'}`);
      log('info', `  Version: ${deployment.workflow_version.version_number || 'Unknown'}`);
    }
  } catch (error) {
    log('error', `Error getting deployment details: ${error.message}`);
  }
}

// Function to get available machines
async function listAvailableMachines() {
  log('info', '\n====== AVAILABLE MACHINES FROM COMFYUI DEPLOY ======\n');
  
  try {
    // Get machines directly from ComfyUI Deploy API
    const machines = await comfyui.getMachines();
    
    log('info', `Found ${machines.length} machines:\n`);
    
    // Display machine information
    machines.forEach((machine, index) => {
      log('info', `${index + 1}. ${machine.name || 'Unnamed'}`);
      log('info', `   ID: ${machine.id}`);
      log('info', `   Status: ${machine.status || 'Unknown'}`);
      log('info', `   Last Seen: ${machine.last_seen_at || 'Never'}`);
      log('info', '');
    });
  } catch (error) {
    log('error', `Error listing machines: ${error.message}`);
  }
}

// Function to simulate a simple workflow submission
async function testWorkflowSubmission() {
  log('info', '\n====== TESTING WORKFLOW SUBMISSION ======\n');
  
  try {
    // Get the first available deployment
    const allWorkflows = await workflows.getWorkflows();
    
    if (allWorkflows.length === 0 || allWorkflows[0].deploymentIds.length === 0) {
      log('warn', 'No deployments available to test submission');
      return;
    }
    
    const deploymentId = allWorkflows[0].deploymentIds[0];
    log('info', `Using deployment ID: ${deploymentId}`);
    
    // Create a simple test workflow submission
    log('info', 'Preparing to submit a test workflow run...');
    log('info', 'This is a simulation and will not actually submit a job unless you uncomment the code');
    
    // Example of what would be submitted
    const testInputs = {
      prompt: "A test prompt for workflow submission",
      negative_prompt: "low quality, blurry"
    };
    
    log('info', 'Test inputs that would be used:');
    log('info', testInputs);
    
    /* 
    // Uncomment this section to actually submit a workflow run
    const runId = await comfyui.submitRequest({
      deploymentId,
      inputs: testInputs
    });
    
    log('info', `Submitted test run with ID: ${runId}`);
    */
    
    log('info', 'Workflow submission test completed (simulated)');
  } catch (error) {
    log('error', `Error testing workflow submission: ${error.message}`);
  }
}

// Function to print out current API endpoints being used
async function showEndpointsBeingUsed() {
  log('info', '\n====== CURRENT API ENDPOINTS IN USE ======\n');
  
  try {
    // Show how the API client is configured to construct URLs
    const exampleRunId = '00000000-0000-0000-0000-000000000000'; // Dummy ID for example
    const exampleDeploymentId = '00000000-0000-0000-0000-000000000000'; // Dummy ID for example
    
    const submitUrl = `${API_URL}/run/deployment/queue`;
    const statusUrl = `${API_URL}/run/${exampleRunId}`;
    const cancelUrl = `${API_URL}/run/${exampleRunId}/cancel`;
    const deploymentsUrl = `${API_URL}/deployments`;
    const workflowsUrl = `${API_URL}/workflows`;
    const machinesUrl = `${API_URL}/machines`;
    
    log('info', 'The API client is configured to use the following endpoints:');
    log('info', `  Submit run: ${submitUrl}`);
    log('info', `  Check run status: ${statusUrl}`);
    log('info', `  Cancel run: ${cancelUrl}`);
    log('info', `  List deployments: ${deploymentsUrl}`);
    log('info', `  List workflows: ${workflowsUrl}`);
    log('info', `  List machines: ${machinesUrl}`);
    
    // Example payload that would be sent for a run submission
    const examplePayload = {
      deployment_id: exampleDeploymentId,
      inputs: {
        prompt: "Example prompt",
        negative_prompt: "low quality"
      }
    };
    
    log('info', '\nExample run submission payload:');
    log('info', JSON.stringify(examplePayload, null, 2));
    
  } catch (error) {
    log('error', `Error showing endpoints: ${error.message}`);
  }
}

// Main function to run the demo
async function runDemo() {
  log('info', '==============================================');
  log('info', '   COMFYUI DEPLOY API INTEGRATION DEMO');
  log('info', '==============================================');
  log('info', 'Demonstrates how StationThis now uses ComfyUI Deploy API');
  log('info', 'as the primary source of truth for workflow information.');
  log('info', 'This version uses the latest API endpoints from the OpenAPI spec.');
  log('info', '==============================================\n');
  
  // Show API client configuration
  showAPIClientConfig();
  
  // First, test API connectivity
  await testAPIConnectivity();
  
  // Show the endpoints being used
  await showEndpointsBeingUsed();
  
  // List available machines
  await listAvailableMachines();
  
  try {
    // First, let's list all workflows from the API
    await listAllWorkflows();
    
    // Get deployment ID from the first workflow, if any
    const allWorkflows = await workflows.getWorkflows();
    let deploymentId = null;
    
    if (allWorkflows.length > 0 && allWorkflows[0].deploymentIds.length > 0) {
      deploymentId = allWorkflows[0].deploymentIds[0];
      
      // Show details for this deployment
      await getDeploymentDetails(deploymentId);
      
      // Test workflow submission
      await testWorkflowSubmission();
    } else {
      log('info', '\nNo deployments found to show details for.');
    }
    
    log('info', '\n==============================================');
    log('info', 'Demo complete! Note that all data was fetched directly');
    log('info', 'from the ComfyUI Deploy API with no database access.');
    log('info', 'Using the updated API endpoints from OpenAPI spec.');
    log('info', '==============================================');
  } catch (error) {
    log('error', `Error in demo execution: ${error.message}`);
  }
}

// Main execution
if (!process.env.COMFY_DEPLOY_API_KEY) {
  log('error', '\nError: COMFY_DEPLOY_API_KEY environment variable not set.');
  log('error', 'Please set the API key before running this demo:');
  log('error', '- On Windows: $env:COMFY_DEPLOY_API_KEY = "your-api-key"');
  log('error', '- On Linux/Mac: export COMFY_DEPLOY_API_KEY="your-api-key"');
  log('error', '\nYou can also set a custom API URL if needed:');
  log('error', '- On Windows: $env:COMFY_DEPLOY_API_URL = "https://your-api-url"');
  log('error', '- On Linux/Mac: export COMFY_DEPLOY_API_URL="https://your-api-url"\n');
} else {
  // Run the demo
  runDemo().catch(error => {
    log('error', `Demo failed with error: ${error}`);
    log('error', '\nTroubleshooting tips:');
    log('error', '1. Check if your API key is correct and has proper permissions');
    log('error', '2. Verify the API URL is correct - use COMFY_DEPLOY_API_URL to set a custom URL');
    log('error', '3. Check if ComfyUI Deploy is running and accessible from your network');
    log('error', '4. The default API URLs might be incorrect. Try setting the correct URL:');
    log('error', '   - On Windows: $env:COMFY_DEPLOY_API_URL = "https://your-comfyui-deploy-url"');
    log('error', '   - On Linux/Mac: export COMFY_DEPLOY_API_URL="https://your-comfyui-deploy-url"');
    
    log('debug', '\nAdditional debugging info:');
    log('debug', `API URL: ${API_URL}`);
    log('debug', `API Key present: ${process.env.COMFY_DEPLOY_API_KEY ? 'Yes' : 'No'}`);
    log('debug', `API Key length: ${process.env.COMFY_DEPLOY_API_KEY ? process.env.COMFY_DEPLOY_API_KEY.length : 0}`);
    log('debug', 'Node.js version:', process.version);
    
    // Try a raw fetch as a final diagnostic
    log('debug', 'Trying a direct fetch to test network connectivity...');
    fetch(`${API_URL}/health`, { 
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    })
      .then(res => {
        log('debug', `Direct fetch result: Status ${res.status}`);
        return res.text();
      })
      .then(text => log('debug', 'Response body:', text.substring(0, 200)))
      .catch(e => log('debug', `Direct fetch error: ${e.message}`));
  });
} 