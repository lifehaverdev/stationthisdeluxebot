# Implementation Guide: Workflow Naming Standardization & Machine Routing

This guide provides implementation details for standardizing workflow names and configuring machine-specific routing for workflows.

## Workflow Name Standardization

### Step 1: Create Utility Module

Create a new file at `src/core/utils/workflow-name-utils.js`:

```javascript
/**
 * Workflow Name Utilities
 * 
 * Standardizes workflow names between different sources
 */

// Name mapping for known workflow names
const workflowNameMap = {
  // API source names
  'text2img': 'text2img',
  'inpaint': 'inpaint',
  'img2img': 'img2img',
  'upscale_esrgan': 'upscale',
  'controlnet-canny': 'controlnet_canny',
  'upscale-real-esrgan': 'upscale_realesrgan',
  
  // Database source names
  'text-to-image': 'text2img',
  'inpainting': 'inpaint',
  'image-to-image': 'img2img',
  'super-resolution': 'upscale',
  'controlnet_canny': 'controlnet_canny',
  'realesrgan': 'upscale_realesrgan'
};

/**
 * Standardize workflow names from any source
 * @param {string} workflowName - Original workflow name from any source
 * @returns {string} - Standardized workflow name
 */
function standardizeWorkflowName(workflowName) {
  if (!workflowName) return '';
  
  // Convert to lowercase
  const lowerName = workflowName.toLowerCase();
  
  // Return mapped name if it exists
  if (workflowNameMap[lowerName]) {
    return workflowNameMap[lowerName];
  }
  
  // Apply standardization rules for unknown names
  return lowerName
    .replace(/[\s-]+/g, '_')     // Replace spaces and hyphens with underscores
    .replace(/[^a-z0-9_]/g, '')  // Remove any non-alphanumeric or underscore characters
    .replace(/_+/g, '_');        // Replace multiple consecutive underscores with a single one
}

/**
 * Convert standardized name back to source-specific format
 * @param {string} standardName - Standardized workflow name
 * @param {string} source - Source type ('api' or 'database')
 * @returns {string} - Source-specific workflow name
 */
function getSourceSpecificName(standardName, source = 'api') {
  if (!standardName) return '';
  
  // Invert the mapping based on source
  const invertedMap = {};
  Object.entries(workflowNameMap).forEach(([srcName, stdName]) => {
    if (stdName === standardName) {
      // Check if this is from the requested source
      const isApiSource = !srcName.includes('-to-') && 
                        !['inpainting', 'super-resolution', 'realesrgan'].includes(srcName);
      
      if ((source === 'api' && isApiSource) || 
          (source === 'database' && !isApiSource)) {
        invertedMap[stdName] = srcName;
      }
    }
  });
  
  return invertedMap[standardName] || standardName;
}

module.exports = {
  standardizeWorkflowName,
  getSourceSpecificName,
  workflowNameMap
};
```

### Step 2: Extend WorkflowsService

Update `src/core/services/workflows.js` to include workflow name standardization:

```javascript
// Add to the top of the file with other imports
const { standardizeWorkflowName } = require('../utils/workflow-name-utils');

// Add this method to the WorkflowsService class
/**
 * Get a workflow by its standardized name
 * 
 * @param {string} name - Name of the workflow (can be non-standardized)
 * @returns {Promise<Object|null>} - Workflow object or null if not found
 */
async getWorkflowByStandardName(name) {
  await this._ensureInitialized();
  
  // Standardize the provided name
  const standardName = standardizeWorkflowName(name);
  
  // Try direct lookup first
  if (this.cache.byName.has(standardName)) {
    return this.cache.byName.get(standardName);
  }
  
  // Try original name as fallback
  if (this.cache.byName.has(name)) {
    return this.cache.byName.get(name);
  }
  
  // If still not found, check all workflows with standardized names
  for (const workflow of this.cache.workflows) {
    if (standardizeWorkflowName(workflow.name) === standardName ||
        standardizeWorkflowName(workflow.displayName) === standardName) {
      return workflow;
    }
  }
  
  return null;
}
```

## Machine Routing Implementation

### Step 1: Create Configuration File

Create a new file at `config/workflow-machine-routing.js`:

```javascript
/**
 * Workflow Machine Routing Configuration
 * 
 * Maps standardized workflow names to specific machine IDs
 */

module.exports = {
  // Map workflow names to specific machine IDs
  routingRules: {
    'text2img': 'machine-id-1',
    'inpaint': 'machine-id-2',
    'img2img': 'machine-id-1',
    'upscale': 'machine-id-3',
    'controlnet_canny': 'machine-id-4',
    'upscale_realesrgan': 'machine-id-3'
  },
  
  // Default machine if no specific rule exists
  defaultMachine: 'machine-id-default',
  
  // Machine priority (fallbacks if preferred machine is unavailable)
  machinePriority: {
    'text2img': ['machine-id-1', 'machine-id-5', 'machine-id-default'],
    'inpaint': ['machine-id-2', 'machine-id-1', 'machine-id-default']
    // Add more as needed
  }
};
```

### Step 2: Add Routing Method to WorkflowsService

Add the following methods to `src/core/services/workflows.js`:

```javascript
// Add to imports
const workflowRouting = require('../../config/workflow-machine-routing');
const { standardizeWorkflowName } = require('../utils/workflow-name-utils');

// Add these methods to the WorkflowsService class

/**
 * Get the appropriate machine ID for a workflow
 * 
 * @param {string} workflowName - Name of the workflow (can be non-standardized)
 * @param {boolean} checkAvailability - Whether to check if machines are available
 * @returns {Promise<string|null>} - Machine ID or null if none available
 */
async getMachineForWorkflow(workflowName, checkAvailability = true) {
  // Standardize the workflow name
  const standardName = standardizeWorkflowName(workflowName);
  
  // Get the preferred machine ID from routing rules
  const preferredMachineId = workflowRouting.routingRules[standardName] || 
                            workflowRouting.defaultMachine;
  
  // If not checking availability, return the preferred machine
  if (!checkAvailability) {
    return preferredMachineId;
  }
  
  // Check if the preferred machine is available
  const isAvailable = await this._isMachineAvailable(preferredMachineId);
  if (isAvailable) {
    return preferredMachineId;
  }
  
  // If not available, try fallbacks in priority order
  const machinePriority = workflowRouting.machinePriority[standardName] || [];
  for (const machineId of machinePriority) {
    if (machineId !== preferredMachineId) {
      const isAvailable = await this._isMachineAvailable(machineId);
      if (isAvailable) {
        return machineId;
      }
    }
  }
  
  // If no machines are available, return null
  return null;
}

/**
 * Check if a machine is available
 * @param {string} machineId - Machine ID to check
 * @returns {Promise<boolean>} - Whether the machine is available
 * @private
 */
async _isMachineAvailable(machineId) {
  // Get all machines
  const machines = await this.getMachines();
  
  // Find the machine by ID
  const machine = machines.find(m => m.id === machineId);
  
  // Check if the machine exists and is online
  return machine && machine.status === 'online';
}
```

### Step 3: Update Workflow Execution Code

Modify workflow execution code to use the new routing logic:

```javascript
/**
 * Submit a workflow for execution
 * @param {Object} options - Execution options
 * @param {string} options.workflowName - Name of the workflow to execute
 * @param {Object} options.inputs - Input parameters for the workflow
 * @returns {Promise<string>} - Run ID if successful
 */
async function executeWorkflow(options) {
  const { workflowName, inputs } = options;
  
  // Get workflow by standardized name
  const workflow = await workflows.getWorkflowByStandardName(workflowName);
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowName}`);
  }
  
  // Get appropriate machine for this workflow
  const machineId = await workflows.getMachineForWorkflow(workflowName);
  if (!machineId) {
    throw new Error(`No available machines for workflow: ${workflowName}`);
  }
  
  // Get a deployment ID for this workflow on the selected machine
  const deploymentId = await workflows.getDeploymentForWorkflowOnMachine(
    workflow.id, machineId
  );
  
  if (!deploymentId) {
    throw new Error(`No deployment found for workflow ${workflowName} on machine ${machineId}`);
  }
  
  // Submit the execution request
  const runId = await comfyui.submitRequest({
    deploymentId: deploymentId,
    inputs: inputs
  });
  
  return runId;
}
```

## Testing the Implementation

Create a test script at `tests/workflow-routing-test.js`:

```javascript
/**
 * Workflow Routing Test
 * 
 * Tests the workflow name standardization and machine routing logic
 */

// Load environment variables
require('dotenv').config();

// Import required modules
const WorkflowsService = require('../src/core/services/workflows');
const ComfyUIService = require('../src/core/services/comfyui');
const { standardizeWorkflowName } = require('../src/core/utils/workflow-name-utils');

// Create service instances
const workflows = new WorkflowsService();
const comfyui = new ComfyUIService();

/**
 * Test workflow name standardization
 */
async function testNameStandardization() {
  console.log('\n=== Testing Workflow Name Standardization ===\n');
  
  const testCases = [
    'text2img',
    'Text2Img',
    'text-to-image',
    'inpainting',
    'img2img',
    'image-to-image',
    'super-resolution',
    'controlnet-canny',
    'unknown-workflow-name'
  ];
  
  console.log('Input Name -> Standardized Name');
  console.log('--------------------------------');
  
  testCases.forEach(name => {
    console.log(`${name} -> ${standardizeWorkflowName(name)}`);
  });
}

/**
 * Test machine routing
 */
async function testMachineRouting() {
  console.log('\n=== Testing Machine Routing ===\n');
  
  // Initialize workflows service
  await workflows.initialize();
  
  const testCases = [
    'text2img',
    'inpaint',
    'img2img',
    'upscale',
    'controlnet_canny',
    'unknown_workflow'
  ];
  
  console.log('Workflow Name -> Machine ID');
  console.log('--------------------------');
  
  for (const name of testCases) {
    try {
      const machineId = await workflows.getMachineForWorkflow(name);
      console.log(`${name} -> ${machineId || 'No machine available'}`);
    } catch (error) {
      console.log(`${name} -> Error: ${error.message}`);
    }
  }
}

/**
 * Run all tests
 */
async function runTests() {
  try {
    await testNameStandardization();
    await testMachineRouting();
    
    console.log('\nAll tests completed.');
  } catch (error) {
    console.error('Error running tests:', error);
  }
}

// Run the tests
runTests();
```

## Running the Tests

To run the tests:

```powershell
node tests/workflow-routing-test.js
```

## Next Steps

After implementing the workflow naming standardization and machine routing:

1. Update the workflow catalog (`docs/comfyui-deploy/WORKFLOWS_CATALOG.md`) with actual workflows
2. Update the name mapping table (`docs/comfyui-deploy/WORKFLOW_NAME_MAPPING.md`) with actual mappings
3. Configure real machine IDs in `config/workflow-machine-routing.js`
4. Write comprehensive tests to validate the implementation 