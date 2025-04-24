/**
 * ComfyDeploy Workflow Loader
 * 
 * Loads workflow configurations from the database
 * and parses their structure into a format usable by ComfyDeployAdapter.
 */

const WorkflowRepository = require('../../db/models/workflows');
const { createLogger } = require('../../utils/logger');

// Initialize logger
const logger = createLogger('workflowLoader');

/**
 * Parse a workflow's JSON layout to extract input parameters
 * @param {Object} workflow - Workflow layout object
 * @returns {Array} - Array of input names
 */
function parseWorkflow(workflow) {
  let workflowInputs = [];

  try {
    // Filter nodes that start with 'ComfyUIDeploy'
    const deployNodes = workflow.nodes.filter(node => 
      node.type && node.type.startsWith('ComfyUIDeploy')
    );

    // Extract inputs from deploy nodes
    deployNodes.forEach(node => {
      if (node.widgets_values && Array.isArray(node.widgets_values)) {
        // Collect relevant inputs from widgets_values
        node.widgets_values.forEach(value => {
          if (typeof value === 'string' && value.startsWith('input_')) {
            workflowInputs.push(value);
          }
        });
      }
    });

    // Return unique inputs
    return [...new Set(workflowInputs)];
  } catch (error) {
    logger.error('Error parsing workflow layout', { error });
    return workflowInputs;
  }
}

/**
 * Converts workflow inputs array to input template object
 * @param {Array} inputs - Array of input parameter names
 * @returns {Object} - Input template object
 */
function createInputTemplate(inputs) {
  const template = {};
  
  // Create default values for each input
  inputs.forEach(input => {
    const param = input.replace('input_', '');
    template[param] = '';
  });
  
  // Add some default properties if needed
  if (!template.prompt && !template.positive_prompt) {
    template.prompt = '';
  }
  
  if (!template.negative_prompt) {
    template.negative_prompt = '';
  }
  
  return template;
}

/**
 * Load workflows from database
 * @returns {Promise<Array>} - Array of formatted workflow configurations
 */
async function loadWorkflows() {
  // Use the repository through abstraction layer
  const workflowRepository = new WorkflowRepository();
  const workflows = [];
  
  try {
    logger.info('Loading workflows from database');
    
    // Find workflow document - accessing database through abstraction
    const document = await workflowRepository.findOne();
    
    if (!document || !document.flows || !Array.isArray(document.flows)) {
      logger.warn('No workflows found in database');
      return workflows;
    }

    console.log('======= WORKFLOW DEPLOYMENT IDS =======');
    
    // Map database workflows to adapter-compatible format
    document.flows.forEach(flow => {
      try {
        // Parse workflow layout
        const layout = JSON.parse(flow.layout);
        const parsedInputs = parseWorkflow(layout);
        const inputTemplate = createInputTemplate(parsedInputs);
        
        workflows.push({
          name: flow.name,
          ids: flow.ids || [],
          inputs: parsedInputs, // Use the array of input names directly for UI compatibility
          inputTemplate: inputTemplate, // Keep the template for other uses
          parsedInputs: parsedInputs, // Keep original input names for reference
          active: flow.active !== false // Default to active if not specified
        });
        
        console.log(`Workflow: ${flow.name}`);
        console.log(`  IDs: ${JSON.stringify(flow.ids || [])}`);
        
        logger.debug(`Processed workflow ${flow.name}:`, {
          inputCount: parsedInputs.length,
          sampleInputs: parsedInputs.slice(0, 3),
          inputTemplate: Object.keys(inputTemplate).slice(0, 3)
        });
      } catch (error) {
        logger.error('Error processing workflow', { 
          workflow: flow.name,
          error
        });
      }
    });
    
    console.log('=======================================');
    
    logger.info(`Loaded ${workflows.length} workflows from database`);
    
    return workflows;
  } catch (error) {
    logger.error('Error loading workflows from database', { error });
    return workflows;
  }
}

/**
 * Reload workflows from database
 * @param {ComfyDeployAdapter} adapter - ComfyDeploy adapter instance
 * @returns {Promise<boolean>} - True if reload was successful
 */
async function reloadWorkflows(adapter) {
  try {
    // Load workflows from database
    const workflows = await loadWorkflows();
    
    if (!workflows || workflows.length === 0) {
      logger.warn('No workflows loaded, keeping existing configuration');
      return false;
    }
    
    // Update adapter configuration
    if (adapter && adapter.config) {
      adapter.config.workflows = workflows;
      logger.info(`Updated adapter with ${workflows.length} workflows`);
      
      // If adapter has a comfyService with workflows, update those too
      if (adapter.comfyService) {
        adapter.comfyService.workflows = workflows;
        logger.info('Updated comfyService workflows');
      }
    }
    
    return true;
  } catch (error) {
    logger.error('Error reloading workflows', { error });
    return false;
  }
}

module.exports = {
  loadWorkflows,
  reloadWorkflows,
  parseWorkflow
}; 