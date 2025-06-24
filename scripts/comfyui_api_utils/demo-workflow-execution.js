/**
 * Demo script to demonstrate workflow execution using ComfyUI Deploy API
 * 
 * This script shows how to run a workflow and get results directly from
 * the ComfyUI Deploy API without any database dependencies.
 * Updated to use the latest API endpoints from the OpenAPI specification.
 */

// Import the core services
const WorkflowsService = require('./src/core/services/workflows');
const ComfyUIService = require('./src/core/services/comfyui');

// Helper to get arguments from command line
function getArgValue(name, defaultValue) {
  const arg = process.argv.find(arg => arg.startsWith(`--${name}=`));
  if (arg) {
    return arg.split('=')[1];
  }
  return defaultValue;
}

// Enhanced logging with timestamps
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

// Create service instances with custom API URL
const workflows = new WorkflowsService({
  logger: (msg) => log('workflows', msg),
  apiUrl: API_URL
});

const comfyui = new ComfyUIService({
  apiUrl: API_URL
});

// Function to find a suitable workflow by name pattern
async function findWorkflow(namePattern) {
  const allWorkflows = await workflows.getWorkflows();
  
  // Try exact match first
  let matchedWorkflow = allWorkflows.find(w => 
    w.name === namePattern || 
    w.displayName === namePattern
  );
  
  // If no exact match, try partial match
  if (!matchedWorkflow) {
    const pattern = new RegExp(namePattern, 'i');
    matchedWorkflow = allWorkflows.find(w => 
      pattern.test(w.name) || 
      (w.displayName && pattern.test(w.displayName))
    );
  }
  
  return matchedWorkflow;
}

// Function to execute a workflow
async function executeWorkflow(deploymentId, inputs, machineId, workflowName) {
  log('info', `\n====== EXECUTING WORKFLOW (DEPLOYMENT ID: ${deploymentId}) ======\n`);
  log('info', 'Input parameters:', JSON.stringify(inputs, null, 2));
  
  try {
    // Submit the workflow execution request
    const runId = await comfyui.submitRequest({
      deploymentId,
      machineId,
      workflowName,
      inputs
    });
    
    log('info', `\nWorkflow execution started with Run ID: ${runId}`);
    log('info', 'Waiting for results...\n');
    
    // Poll for results
    let complete = false;
    let lastProgress = -1;
    let attempts = 0;
    const maxAttempts = 30; // Maximum number of status check attempts (2s * 30 = 60s timeout)
    
    while (!complete && attempts < maxAttempts) {
      attempts++;
      
      // Check status
      const status = await comfyui.checkStatus(runId);
      
      // Update progress if changed
      if (status.progress !== lastProgress && status.status === 'running') {
        log('info', `Progress: ${Math.round(status.progress * 100)}%`);
        lastProgress = status.progress;
      }
      
      // Check if completed or error
      if (status.status === 'completed' || status.status === 'success') {
        log('info', 'Workflow execution completed successfully!');
        complete = true;
        
        // Get full results
        const results = await comfyui.getResults(runId);
        log('info', '\nResults:');
        
        // If we have images, show their URLs
        if (results.images && results.images.length > 0) {
          log('info', '\nGenerated Images:');
          results.images.forEach((image, index) => {
            log('info', `  ${index + 1}. ${image}`);
          });
        } else {
          log('info', 'No images found in the results.');
        }
        
        // Show other outputs
        if (Object.keys(results.outputs || {}).length > 0) {
          log('info', '\nAll Outputs:');
          log('info', JSON.stringify(results.outputs, null, 2));
        }
      } else if (status.status === 'error') {
        log('error', 'Workflow execution failed with error:', status.error);
        complete = true;
      } else {
        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    if (!complete) {
      log('warn', `Exceeded maximum wait time (${maxAttempts * 2} seconds). The workflow might still be running.`);
      log('info', 'You can check its status later using the run ID.');
    }
  } catch (error) {
    log('error', 'Error executing workflow:', error.message);
  }
}

// Function to display the API endpoints that will be used
function showApiEndpoints() {
  log('info', '\n====== API ENDPOINTS IN USE ======\n');
  
  const exampleRunId = '00000000-0000-0000-0000-000000000000'; // Dummy ID for example
  
  log('info', 'The following API endpoints will be used:');
  log('info', `  Get Workflows:   ${API_URL}/workflows`);
  log('info', `  Submit Run:      ${API_URL}/run/deployment/queue`);
  log('info', `  Check Run:       ${API_URL}/run/${exampleRunId}`);
  log('info', `  Cancel Run:      ${API_URL}/run/${exampleRunId}/cancel`);
  log('info', '');
}

// Main function to run the demo
async function runDemo() {
  // Get workflow name pattern from command line or use default
  const workflowPattern = getArgValue('workflow', 'text2img');
  
  // Get optional prompt input
  const promptText = getArgValue('prompt', 'a beautiful landscape with mountains and a lake');
  
  log('info', '==============================================');
  log('info', '   COMFYUI DEPLOY WORKFLOW EXECUTION DEMO');
  log('info', '==============================================');
  log('info', 'Demonstrates how to execute workflows directly');
  log('info', 'using the ComfyUI Deploy API with updated endpoints.');
  log('info', '==============================================\n');
  
  // Show API endpoints
  showApiEndpoints();
  
  try {
    log('info', `Searching for workflow matching: "${workflowPattern}"...`);
    
    // Find a suitable workflow
    const workflow = await findWorkflow(workflowPattern);
    
    if (!workflow) {
      log('error', `No workflow found matching "${workflowPattern}".`);
      log('info', 'Available workflows:');
      
      const allWorkflows = await workflows.getWorkflows();
      allWorkflows.forEach((w, i) => {
        log('info', `  ${i + 1}. ${w.displayName || w.name}`);
      });
      
      return;
    }
    
    log('info', `Found workflow: ${workflow.displayName || workflow.name}`);
    
    // Check if the workflow has deployments
    if (!workflow.deploymentIds || workflow.deploymentIds.length === 0) {
      log('error', `No deployments found for the workflow: ${workflow.displayName || workflow.name}`);
      return;
    }
    
    // Get the first deployment ID
    const deploymentId = workflow.deploymentIds[0];
    log('info', `Using deployment ID: ${deploymentId}`);
    
    // Prepare input parameters
    const inputs = {
      prompt: promptText
    };
    
    // For demo purposes, add additional parameters for different workflows
    const workflowName = workflow.name;
    log('info', `Standardized workflow name: ${workflows.standardizeWorkflowName(workflowName)}`);
    
    // Get recommended machine for this workflow
    const machineId = await workflows.getMachineForWorkflow(workflowName);
    if (machineId) {
      log('info', `Using machine ID: ${machineId} for workflow ${workflowName}`);
    } else {
      log('warn', `No specific machine recommended for workflow ${workflowName}, using API default`);
    }
    
    // Should we actually execute?
    const shouldExecute = getArgValue('execute', 'false') === 'true';
    
    if (!shouldExecute) {
      log('info', '\nThis is a DRY RUN. To actually execute the workflow, add --execute=true');
      log('info', 'Would execute workflow with the following parameters:');
      log('info', `  Deployment ID: ${deploymentId}`);
      log('info', `  Machine ID: ${machineId || 'API default'}`);
      log('info', '  Inputs:');
      log('info', JSON.stringify(inputs, null, 2));
      return;
    }
    
    // Execute the workflow with machine routing
    await executeWorkflow(deploymentId, inputs, machineId, workflowName);
    
  } catch (error) {
    log('error', 'Demo failed with error:', error);
  }
}

// Check if there's an API key configured
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
    log('error', 'Demo failed with error:', error);
    log('error', '\nTroubleshooting tips:');
    log('error', '1. Check if your API key is correct and has proper permissions');
    log('error', '2. Verify the API URL is correct - use COMFY_DEPLOY_API_URL to set a custom URL');
    log('error', '3. Check if ComfyUI Deploy is running and accessible from your network');
    log('error', '4. The default API URLs might be incorrect. Try setting the correct URL:');
    log('error', '   - On Windows: $env:COMFY_DEPLOY_API_URL = "https://your-comfyui-deploy-url"');
    log('error', '   - On Linux/Mac: export COMFY_DEPLOY_API_URL="https://your-comfyui-deploy-url"');
  });
} 