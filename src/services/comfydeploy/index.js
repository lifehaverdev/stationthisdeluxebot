/**
 * ComfyDeploy Integration
 * 
 * Provides a platform-agnostic service for generating images using ComfyDeploy.
 */

const ComfyDeployService = require('./ComfyDeployService');
const ComfyClient = require('./ComfyClient');
const PromptBuilder = require('./PromptBuilder');
const ComfyTaskMapper = require('./ComfyTaskMapper');

/**
 * Create a new ComfyDeployService with default configuration
 * @param {Object} options - Service configuration
 * @returns {ComfyDeployService} - Configured service
 */
function createComfyDeployService(options = {}) {
  return new ComfyDeployService(options);
}

module.exports = {
  ComfyDeployService,
  ComfyClient,
  PromptBuilder,
  ComfyTaskMapper,
  createComfyDeployService
}; 