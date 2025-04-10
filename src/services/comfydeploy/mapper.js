/**
 * ComfyDeploy Mapper
 * 
 * Maps between internal domain models and ComfyDeploy API formats
 */

const { GenerationRequest, GenerationResponse } = require('../../core/generation/models');

/**
 * ComfyDeploy Mapper
 */
class ComfyDeployMapper {
  /**
   * Map GenerationRequest to ComfyDeploy request format
   * @param {GenerationRequest} request - Generation request
   * @param {Object} deploymentInfo - Deployment information with IDs and input structure
   * @returns {Object} - ComfyDeploy request payload
   */
  mapToComfyDeployRequest(request, deploymentInfo) {
    if (!deploymentInfo || !deploymentInfo.ids || !deploymentInfo.inputs) {
      throw new Error('Valid deployment information is required');
    }
    
    // Select a deployment ID from the available options
    const deployment_id = this._selectDeploymentId(deploymentInfo.ids, request);
    
    // Build input structure based on template
    const inputs = this._buildInputs(request, deploymentInfo.inputs);
    
    return {
      deployment_id,
      inputs
    };
  }

  /**
   * Map ComfyDeploy response to internal GenerationResponse
   * @param {Object} response - ComfyDeploy response data
   * @param {string} taskId - Internal task ID
   * @param {string} userId - User ID
   * @returns {GenerationResponse} - Internal response object
   */
  mapFromComfyDeployResponse(response, taskId, userId) {
    // Extract outputs
    const outputs = [];
    const metadata = {};
    
    if (response.output && response.output.outputs) {
      response.output.outputs.forEach(output => {
        outputs.push(output.url);
        
        // Store media type and any additional metadata
        if (!metadata.types) metadata.types = [];
        metadata.types.push(output.type);
        
        if (output.metadata) {
          Object.entries(output.metadata).forEach(([key, value]) => {
            metadata[key] = value;
          });
        }
      });
    }
    
    // Get status information
    const success = response.status === 'success';
    const error = response.error || '';
    
    return new GenerationResponse({
      requestId: taskId,
      userId: userId,
      outputs: outputs,
      success: success,
      error: error,
      metadata: metadata,
      processingTime: response.processing_time || 0
    });
  }

  /**
   * Select appropriate deployment ID based on request
   * @private
   * @param {Array<string>} ids - Available deployment IDs
   * @param {GenerationRequest} request - Generation request
   * @returns {string} - Selected deployment ID
   */
  _selectDeploymentId(ids, request) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new Error('No deployment IDs available');
    }
    
    // For now, just select the first ID
    // This can be expanded to have more sophisticated selection logic
    // based on load balancing, specific model needs, etc.
    return ids[0];
  }

  /**
   * Build input structure for ComfyDeploy
   * @private
   * @param {GenerationRequest} request - Generation request
   * @param {Object} inputTemplate - Template for input structure
   * @returns {Object} - Filled input structure
   */
  _buildInputs(request, inputTemplate) {
    const inputs = {};
    
    // Apply input template with values from request
    if (inputTemplate) {
      Object.entries(inputTemplate).forEach(([key, defaultValue]) => {
        // Try to find a corresponding value in the request
        const value = this._getValueFromRequest(request, key, defaultValue);
        inputs[key] = value;
      });
    }
    
    // Special handling for prompt and negative prompt
    if (request.prompt && !inputs.prompt) {
      inputs.prompt = request.prompt;
    }
    
    if (request.negativePrompt && !inputs.negative_prompt) {
      inputs.negative_prompt = request.negativePrompt;
    }
    
    // Handle settings
    if (request.settings) {
      // Map common settings if not already set
      const settingMappings = {
        width: 'width',
        height: 'height',
        steps: 'steps',
        cfg: 'cfg_scale',
        seed: 'seed',
        batch: 'batch_size',
        sampler: 'sampler_name',
        checkpoint: 'checkpoint'
      };
      
      Object.entries(settingMappings).forEach(([requestKey, comfyKey]) => {
        if (request.settings[requestKey] !== undefined && inputs[comfyKey] === undefined) {
          inputs[comfyKey] = request.settings[requestKey];
        }
      });
    }
    
    return inputs;
  }

  /**
   * Get value from request based on key
   * @private
   * @param {GenerationRequest} request - Generation request
   * @param {string} key - Input key
   * @param {*} defaultValue - Default value
   * @returns {*} - Value for the input
   */
  _getValueFromRequest(request, key, defaultValue) {
    // Direct properties
    if (request[key] !== undefined) {
      return request[key];
    }
    
    // Check in settings
    if (request.settings && request.settings[key] !== undefined) {
      return request.settings[key];
    }
    
    // Check in metadata
    if (request.metadata && request.metadata[key] !== undefined) {
      return request.metadata[key];
    }
    
    // Special handling for common mappings with different names
    const commonMappings = {
      prompt: 'prompt',
      negative_prompt: 'negativePrompt',
      width: 'settings.width',
      height: 'settings.height',
      steps: 'settings.steps',
      cfg_scale: 'settings.cfg',
      seed: 'settings.seed',
      batch_size: 'settings.batch'
    };
    
    if (commonMappings[key]) {
      const path = commonMappings[key].split('.');
      let value = request;
      
      for (const segment of path) {
        if (value === undefined || value === null) break;
        value = value[segment];
      }
      
      if (value !== undefined) {
        return value;
      }
    }
    
    // Fallback to default
    return defaultValue;
  }
}

module.exports = ComfyDeployMapper; 