/**
 * Demonstrate workflow input payload capabilities
 * 
 * This simple script shows:
 * 1. Default input payload generation from ComfyUIDeployExternal nodes
 * 2. Input validation
 * 3. Merging default values with user inputs
 * 4. Complete payload preparation for workflow execution
 */

require('dotenv').config();
const WorkflowsService = require('./src/core/services/workflows');

async function main() {
  try {
    const workflowName = process.argv[2] || 'fluxgeneral';
    
    console.log(`Demonstrating input payload capabilities for workflow: ${workflowName}`);
    
    // Initialize workflow service
    const workflows = new WorkflowsService({ 
      logger: {
        info: msg => console.log(`[INFO] ${msg}`),
        warn: msg => console.log(`[WARN] ${msg}`),
        error: msg => console.log(`[ERROR] ${msg}`)
      }
    });
    
    // Initialize and get workflows
    await workflows.initialize();
    
    // Get workflow details
    console.log(`\nChecking if workflow "${workflowName}" exists...`);
    const workflowExists = await workflows.hasWorkflow(workflowName);
    
    if (!workflowExists) {
      console.log(`Workflow "${workflowName}" not found!`);
      console.log('Available workflows:');
      const allWorkflows = await workflows.getWorkflows();
      allWorkflows.forEach(workflow => {
        console.log(`- ${workflow.name}`);
      });
      return;
    }
    
    // Get workflow output type
    const outputType = await workflows.getWorkflowOutputType(workflowName);
    console.log(`Workflow produces: ${outputType}`);
    
    // Check lora support
    const hasLoraSupport = await workflows.hasLoraLoaderSupport(workflowName);
    console.log(`Lora support: ${hasLoraSupport ? 'Yes' : 'No'}`);
    
    // Get required inputs
    console.log('\n=== REQUIRED INPUTS ===');
    const requiredInputs = await workflows.getWorkflowRequiredInputs(workflowName);
    
    if (requiredInputs.length === 0) {
      console.log('No required inputs found');
    } else {
      console.log(`Found ${requiredInputs.length} required inputs:`);
      requiredInputs.forEach(input => {
        console.log(`- ${input.inputName} (Type: ${input.inputType})`);
        if (input.defaultValue !== null && input.defaultValue !== undefined) {
          const displayValue = typeof input.defaultValue === 'string' && input.defaultValue.length > 60
            ? input.defaultValue.substring(0, 57) + '...'
            : input.defaultValue;
          console.log(`  Default: ${displayValue}`);
        }
      });
    }
    
    // Create default input payload
    console.log('\n=== DEFAULT INPUT PAYLOAD ===');
    const defaultPayload = await workflows.createDefaultInputPayload(workflowName);
    console.log(JSON.stringify(defaultPayload, null, 2));
    
    // Demonstrate validation
    console.log('\n=== INPUT VALIDATION ===');
    
    // Valid payload (using defaults)
    const validationResult = await workflows.validateInputPayload(workflowName, defaultPayload);
    console.log('Default payload validation result:');
    console.log(JSON.stringify(validationResult, null, 2));
    
    // Invalid payload (missing inputs)
    const incompletePayload = {};
    const invalidResult = await workflows.validateInputPayload(workflowName, incompletePayload);
    console.log('\nIncomplete payload validation result:');
    console.log(JSON.stringify(invalidResult, null, 2));
    
    // Demonstrate merging with user inputs
    console.log('\n=== MERGING WITH USER INPUTS ===');
    
    // Choose one input to override
    const userInputs = {};
    
    if (Object.keys(defaultPayload).length > 0) {
      // Pick the first input to override
      const firstKey = Object.keys(defaultPayload)[0];
      
      // Set a different value based on the input type
      const inputType = requiredInputs.length > 0
        ? requiredInputs.find(input => input.inputName === firstKey)?.inputType
        : (typeof defaultPayload[firstKey] === 'number' 
            ? (Number.isInteger(defaultPayload[firstKey]) ? 'numberint' : 'number')
            : typeof defaultPayload[firstKey]);
      
      switch (inputType?.toLowerCase()) {
        case 'text':
          userInputs[firstKey] = 'User provided text value';
          break;
        case 'number':
          userInputs[firstKey] = 2.5;
          break;
        case 'numberint':
          userInputs[firstKey] = 512;
          break;
        default:
          // Try to match the type of the default value
          const defaultType = typeof defaultPayload[firstKey];
          if (defaultType === 'number') {
            userInputs[firstKey] = Number.isInteger(defaultPayload[firstKey]) ? 512 : 2.5;
          } else if (defaultType === 'string') {
            userInputs[firstKey] = 'User provided text value';
          } else if (defaultType === 'boolean') {
            userInputs[firstKey] = !defaultPayload[firstKey]; // Toggle boolean value
          } else {
            userInputs[firstKey] = 'User provided value';
          }
      }
    } else {
      userInputs.dummy_input = 'No real inputs available';
    }
    
    console.log('User inputs:');
    console.log(JSON.stringify(userInputs, null, 2));
    
    const mergedPayload = await workflows.mergeWithDefaultInputs(workflowName, userInputs);
    console.log('\nMerged payload:');
    console.log(JSON.stringify(mergedPayload, null, 2));
    
    // Demonstrate the complete workflow payload preparation
    console.log('\n=== COMPLETE WORKFLOW PAYLOAD PREPARATION ===');
    const completeResult = await workflows.prepareWorkflowPayload(workflowName, userInputs);
    
    console.log('Complete preparation result:');
    console.log('Success:', completeResult.success);
    if (completeResult.error) {
      console.log('Error:', completeResult.error);
    }
    
    console.log('\nPayload:');
    console.log(JSON.stringify(completeResult.payload, null, 2));
    
    console.log('\nWorkflow Info:');
    console.log(JSON.stringify(completeResult.workflow, null, 2));
    
    if (completeResult.workflow && completeResult.workflow.recommendedDeploymentId) {
      console.log(`\nRecommended deployment ID: ${completeResult.workflow.recommendedDeploymentId}`);
    }
    
    if (completeResult.workflow && completeResult.workflow.recommendedMachineId) {
      console.log(`Recommended machine ID: ${completeResult.workflow.recommendedMachineId}`);
    }
    
  } catch (error) {
    console.error('Error in payload demo:', error);
  }
}

// Run the demo
main().then(() => {
  console.log('\nPayload demo completed');
}).catch(error => {
  console.error('\nPayload demo failed:', error);
}); 