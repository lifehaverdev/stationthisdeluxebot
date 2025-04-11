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

// Export the service instance and the class for direct imports
module.exports = {
  ComfyDeployService,
  comfyDeployService
}; 