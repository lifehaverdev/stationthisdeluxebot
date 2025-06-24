/**
 * Test script to verify we can fetch workflows and deployments
 * using our updated API endpoints
 */

// Import core services
const WorkflowsService = require('./src/core/services/workflows');
const ComfyUIService = require('./src/core/services/comfyui');

// Set up logger
function log(type, message, data) {
  console.log(`[${type.toUpperCase()}] ${message}`);
  if (data) {
    console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }
}

async function main() {
  console.log('\n===== TESTING COMFYUI DEPLOY API INTEGRATION =====\n');
  
  // Create service instances
  const workflows = new WorkflowsService({
    logger: (msg) => log('workflows', msg)
  });
  
  const comfyui = new ComfyUIService({
    logger: (msg) => log('comfyui', msg)
  });
  
  console.log('\n----- Testing API Connectivity -----\n');
  
  // Test 1: Fetch workflows
  try {
    log('test', 'Fetching workflows from API directly using ComfyUIService');
    const apiWorkflows = await comfyui.getWorkflows();
    log('result', `Successfully fetched ${apiWorkflows.length} workflows from API`);
    log('data', `First workflow: ${apiWorkflows[0]?.name || 'N/A'}`);
  } catch (error) {
    log('error', `Failed to fetch workflows from API: ${error.message}`);
  }
  
  // Test 2: Fetch deployments
  try {
    log('test', 'Fetching deployments from API directly using ComfyUIService');
    const apiDeployments = await comfyui.getDeployments();
    log('result', `Successfully fetched ${apiDeployments.length} deployments from API`);
    log('data', `First deployment ID: ${apiDeployments[0]?.id || 'N/A'}`);
  } catch (error) {
    log('error', `Failed to fetch deployments from API: ${error.message}`);
  }
  
  // Test 3: Fetch machines
  try {
    log('test', 'Fetching machines from API');
    const apiMachines = await comfyui.getMachines();
    log('result', `Successfully fetched ${apiMachines.length} machines from API`);
    log('data', `Machines with 'ready' status: ${apiMachines.filter(m => m.status === 'ready').length}`);
  } catch (error) {
    log('error', `Failed to fetch machines from API: ${error.message}`);
  }
  
  console.log('\n----- Testing WorkflowsService Integration -----\n');
  
  // Test 4: Initialize WorkflowsService
  try {
    log('test', 'Initializing WorkflowsService');
    await workflows.initialize();
    const allWorkflows = await workflows.getWorkflows();
    log('result', `WorkflowsService initialized with ${allWorkflows.length} workflows`);
    
    if (allWorkflows.length > 0) {
      // Display some workflow information
      log('data', 'Available workflow names:');
      allWorkflows.slice(0, 5).forEach((wf, index) => {
        log('data', `${index + 1}. ${wf.name} (ID: ${wf.id})`);
      });
      
      // Test name standardization
      if (allWorkflows[0]) {
        const originalName = allWorkflows[0].name;
        const standardizedName = workflows.standardizeWorkflowName(originalName);
        log('data', `Name standardization: "${originalName}" -> "${standardizedName}"`);
      }
    }
  } catch (error) {
    log('error', `Failed to initialize WorkflowsService: ${error.message}`);
  }
  
  // Test 5: Test machine routing
  try {
    log('test', 'Testing machine routing for workflows');
    const allWorkflows = await workflows.getWorkflows();
    
    if (allWorkflows.length > 0) {
      const testWorkflow = allWorkflows[0];
      const machineId = await workflows.getMachineForWorkflow(testWorkflow.name);
      
      log('result', `Machine for workflow "${testWorkflow.name}": ${machineId || 'None found'}`);
      
      if (machineId) {
        const machine = await workflows.getMachineById(machineId);
        log('data', `Selected machine: ${machine?.name || 'Unknown'} (Status: ${machine?.status || 'Unknown'})`);
      }
    } else {
      log('warning', 'No workflows available to test machine routing');
    }
  } catch (error) {
    log('error', `Failed to test machine routing: ${error.message}`);
  }
  
  console.log('\n===== TEST COMPLETE =====\n');
}

// Run the tests
main().catch(error => {
  console.error('Test failed with error:', error);
}); 