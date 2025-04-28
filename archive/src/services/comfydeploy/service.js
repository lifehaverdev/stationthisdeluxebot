/**
 * ComfyDeploy Service
 * 
 * This file exports the ComfyDeployService for use with the internal API.
 * It serves as a convenience wrapper around the ComfyDeployService implementation.
 */

const { ComfyDeployService, createComfyDeployService } = require('./index');

// Create an instance of the service with default configuration
// This can be configured via environment variables
const comfyDeployService = createComfyDeployService({
  config: {
    apiKey: process.env.COMFY_DEPLOY_API_KEY,
    baseUrl: process.env.COMFY_DEPLOY_BASE_URL,
    webhookUrl: process.env.COMFY_DEPLOY_WEBHOOK_URL
  }
});

/**
 * Register an external workflow definition
 * This allows workflows from other services like workflowManager to be registered
 * with the ComfyDeploy service
 * 
 * @param {Object} workflow - The workflow to register
 * @returns {boolean} - True if registration was successful
 */
comfyDeployService.registerExternalWorkflow = function(workflow) {
  if (!workflow || !workflow.name) {
    // Use safer check for logger
    if (this.logger) {
      this.logger.warn('Invalid workflow provided to registerExternalWorkflow');
    } else {
      console.warn('Invalid workflow provided to registerExternalWorkflow (logger not available)');
    }
    return false;
  }

  try {
    // Verify workflows array exists
    if (!this.workflows || !Array.isArray(this.workflows)) {
      if (this.logger) {
        this.logger.warn('Workflows array not initialized in ComfyDeploy service');
      } else {
        console.warn('Workflows array not initialized in ComfyDeploy service');
      }
      this.workflows = [];
    }

    // Check if workflow already exists
    const existingIndex = this.workflows.findIndex(w => w.name === workflow.name);
    
    if (existingIndex >= 0) {
      // Update existing workflow
      this.workflows[existingIndex] = {
        ...this.workflows[existingIndex],
        ...workflow,
        inputs: workflow.inputs || this.workflows[existingIndex].inputs || {},
        active: workflow.active !== false
      };
      
      // Safe logger usage
      if (this.logger) {
        this.logger.debug(`Updated external workflow: ${workflow.name}`);
      } else {
        console.log(`Updated external workflow: ${workflow.name}`);
      }
    } else {
      // Add new workflow
      this.workflows.push({
        name: workflow.name,
        inputs: workflow.inputs || {},
        active: workflow.active !== false
      });
      
      // Safe logger usage
      if (this.logger) {
        this.logger.debug(`Added external workflow: ${workflow.name}`);
      } else {
        console.log(`Added external workflow: ${workflow.name}`);
      }
    }
    
    return true;
  } catch (error) {
    // Safe error logging
    if (this.logger) {
      this.logger.error(`Error registering external workflow: ${workflow.name}`, { error });
    } else {
      console.error(`Error registering external workflow: ${workflow.name}`, error);
    }
    return false;
  }
}

// Export the service instance and the class for direct imports
module.exports = {
  ComfyDeployService,
  comfyDeployService
}; 