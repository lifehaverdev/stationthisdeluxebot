/**
 * Basic Image Generation Workflow Example
 * 
 * This example shows how to create a workflow for a simple image generation process
 * using the workflow system. It demonstrates the transition from the old approach in
 * iMake.js to the new workflow-based system.
 */

const { createLinearWorkflow } = require('../index');

/**
 * Validate a generation prompt
 * @param {string} input - User input
 * @returns {Object} Validation result
 */
function validatePrompt(input) {
  if (!input || typeof input !== 'string') {
    return {
      valid: false,
      errors: ['Prompt must be a non-empty string']
    };
  }
  
  if (input.length < 3) {
    return {
      valid: false,
      errors: ['Prompt must be at least 3 characters']
    };
  }
  
  if (input.length > 1000) {
    return {
      valid: false,
      errors: ['Prompt exceeds maximum length of 1000 characters']
    };
  }
  
  return { valid: true };
}

/**
 * Process generation request
 * This would typically call a service to queue the generation
 * @param {string} input - Generation settings
 * @param {Object} workflow - Current workflow state
 * @returns {Object} Processing result
 */
async function processGeneration(input, workflow) {
  // Get the prompt from previous step
  const prompt = workflow.getInput('prompt');
  
  // Get settings from the workflow context or input
  const settings = input || workflow.context.settings || {};
  
  // In a real implementation, this would call a service to queue the generation
  console.log(`Queuing generation with prompt: ${prompt}`);
  console.log(`Settings: ${JSON.stringify(settings)}`);
  
  // Simulate a generation result
  return {
    taskId: 'gen_' + Math.floor(Math.random() * 1000000),
    prompt,
    settings,
    status: 'queued',
    queuedAt: Date.now()
  };
}

/**
 * Create a basic generation workflow
 * @returns {Object} Workflow sequence
 */
function createBasicGenerationWorkflow() {
  return createLinearWorkflow({
    name: 'BasicImageGeneration',
    steps: [
      {
        id: 'prompt',
        name: 'Prompt Input',
        validate: validatePrompt,
        ui: {
          type: 'text_input',
          message: 'What would you like to create?',
          placeholder: 'Enter a detailed description of what you want to generate'
        }
      },
      {
        id: 'settings',
        name: 'Generation Settings',
        validate: (input) => ({ valid: true }), // Optional step, minimal validation
        process: (input, workflow) => {
          // Process and return generation settings
          return {
            width: input.width || 512,
            height: input.height || 512,
            seed: input.seed || Math.floor(Math.random() * 1000000),
            steps: input.steps || 20,
            cfg: input.cfg || 7.5,
            batch: input.batch || 1
          };
        },
        ui: {
          type: 'settings_form',
          message: 'Adjust generation settings or continue with defaults',
          fields: [
            { name: 'width', label: 'Width', type: 'number', default: 512 },
            { name: 'height', label: 'Height', type: 'number', default: 512 },
            { name: 'steps', label: 'Steps', type: 'number', default: 20 },
            { name: 'cfg', label: 'CFG Scale', type: 'number', default: 7.5 },
            { name: 'batch', label: 'Batch Size', type: 'number', default: 1 }
          ]
        }
      },
      {
        id: 'generate',
        name: 'Generate Image',
        process: processGeneration,
        ui: {
          type: 'progress',
          message: 'Generating your image...'
        }
      },
      {
        id: 'result',
        name: 'Result Display',
        ui: {
          type: 'results',
          message: 'Here is your creation:'
        }
      }
    ],
    metadata: {
      description: 'Basic image generation workflow',
      category: 'generation',
      version: '1.0.0'
    }
  });
}

/**
 * Example usage of the workflow
 */
async function exampleUsage() {
  // Create the workflow
  const generationWorkflow = createBasicGenerationWorkflow();
  
  // Create a workflow instance for a specific user
  const workflowInstance = generationWorkflow.createWorkflow({
    userId: 'user123',
    settings: {
      modelId: 'sdxl',
      defaultWidth: 1024,
      defaultHeight: 1024
    }
  });
  
  // Get the first step
  const firstStep = workflowInstance.getCurrentStep();
  console.log(`First step: ${firstStep.name}`);
  console.log(`UI message: ${firstStep.ui.message}`);
  
  // Submit prompt input
  const promptResult = workflowInstance.submitInput('A beautiful sunset over mountains');
  console.log(`Prompt submission success: ${promptResult.success}`);
  console.log(`Next step: ${promptResult.nextStep}`);
  
  // Submit settings or use defaults
  const settingsResult = workflowInstance.submitInput({
    width: 1024,
    height: 1024,
    steps: 30
  });
  console.log(`Settings submission success: ${settingsResult.success}`);
  
  // Process generation
  const generateResult = await workflowInstance.submitInput();
  console.log(`Generation queued: ${generateResult.success}`);
  
  // Now the workflow is at the result step
  console.log(`Current step: ${workflowInstance.getCurrentStep().name}`);
  
  // In a real implementation, we'd store the workflow in the user's session
  // sessionManager.updateSession(userId, {
  //   [`workflows.${workflowInstance.context.workflowId}`]: workflowInstance.serialize()
  // });
  
  return workflowInstance;
}

// Allow this to be required or run directly
if (require.main === module) {
  exampleUsage()
    .then(workflow => {
      console.log('Workflow completed successfully');
      console.log('Workflow state:', JSON.stringify(workflow.getState(), null, 2));
    })
    .catch(error => {
      console.error('Workflow error:', error);
    });
}

module.exports = {
  createBasicGenerationWorkflow,
  validatePrompt,
  processGeneration
}; 