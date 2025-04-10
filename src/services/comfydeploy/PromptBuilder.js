/**
 * PromptBuilder for ComfyDeploy
 * 
 * Handles prompt construction for ComfyDeploy API requests.
 * Inspired by buildCommonPromptObj, promptPreProc, and imgPreProc from legacy code.
 */

const path = require('path');
const { GenerationRequest } = require('../../core/generation/models');

/**
 * PromptBuilder for ComfyDeploy
 */
class PromptBuilder {
  /**
   * Create a new PromptBuilder
   * @param {Object} options - Configuration options
   * @param {Object} options.loraTriggerHandler - Handler for LoRA triggers
   * @param {Function} options.getBasePromptByName - Function to retrieve base prompts
   * @param {Object} options.defaultSettings - Default generation settings
   */
  constructor(options = {}) {
    this.loraTriggerHandler = options.loraTriggerHandler || null;
    this.getBasePromptByName = options.getBasePromptByName || (() => '');
    this.defaultSettings = options.defaultSettings || {
      WIDTH: 1024, 
      HEIGHT: 1024,
      STEPS: 30,
      CFG: 7
    };
    this.baseNegPrompt = options.baseNegPrompt || 'embedding:easynegative';
  }

  /**
   * Build complete ComfyDeploy prompt object
   * @param {GenerationRequest} request - Generation request
   * @param {Object} userContext - User context information
   * @param {Object} deploymentInfo - Deployment information (ids and inputs)
   * @returns {Promise<Object>} - Complete prompt object for API request
   */
  async build(request, userContext, deploymentInfo) {
    // Create the basic prompt object
    const promptObj = this._buildCommonPromptObj(request, userContext);
    
    // Apply model settings from deployment info
    this._applyDeploymentInfo(promptObj, deploymentInfo);

    // Process input images if provided
    await this._processInputImages(promptObj);
    
    // Apply prompt text preprocessing
    await this._processPromptText(promptObj);

    // Apply image dimension adjustments if needed
    this._adjustImageDimensions(promptObj);
    
    // Finalize request structure
    return this._finalizeRequest(promptObj);
  }

  /**
   * Build common prompt object fields
   * @private
   * @param {GenerationRequest} request - Generation request
   * @param {Object} userContext - User context information
   * @returns {Object} - Basic prompt object
   */
  _buildCommonPromptObj(request, userContext) {
    const promptObj = {
      // Core request data
      type: request.type || 'DEFAULT',
      userId: request.userId,
      prompt: request.prompt || '',
      basePrompt: userContext.basePrompt || '',
      negativePrompt: request.negativePrompt || this.baseNegPrompt,
      
      // User data
      username: userContext.username || 'unknown_user',
      balance: userContext.balance || 0,
      
      // Image settings
      photoStats: {
        height: request.settings?.height || this.defaultSettings.HEIGHT,
        width: request.settings?.width || this.defaultSettings.WIDTH,
      },
      
      // Seeds and batch size
      input_seed: request.settings?.seed || -1,
      input_batch: request.settings?.batch || 1,
      
      // Model settings from user context or defaults
      input_checkpoint: userContext.input_checkpoint || request.settings?.checkpoint,
      input_sampler: userContext.input_sampler || request.settings?.sampler,
      input_steps: userContext.input_steps || request.settings?.steps || this.defaultSettings.STEPS,
      input_cfg: userContext.input_cfg || request.settings?.cfg || this.defaultSettings.CFG,
      
      // Input images if relevant
      input_image: request.inputImages && request.inputImages.length > 0 ? request.inputImages[0] : null,
      
      // Tracking
      timeRequested: Date.now(),
      
      // Additional context
      userBasePrompt: userContext.userBasePrompt || '',
      userPrompt: request.prompt || '',
      
      // Pass-through the full request settings for reference
      settings: request.settings || {}
    };
    
    return promptObj;
  }

  /**
   * Apply deployment information to prompt object
   * @private
   * @param {Object} promptObj - Prompt object
   * @param {Object} deploymentInfo - Deployment information
   */
  _applyDeploymentInfo(promptObj, deploymentInfo) {
    if (!deploymentInfo) return;
    
    // Store deployment IDs
    promptObj.deploymentIds = deploymentInfo.ids || [];
    
    // Apply input templates if provided
    if (deploymentInfo.inputs) {
      promptObj.inputTemplate = deploymentInfo.inputs;
    }
  }

  /**
   * Process and prepare input images
   * @private
   * @param {Object} promptObj - Prompt object
   */
  async _processInputImages(promptObj) {
    if (!promptObj.input_image) return;
    
    // Input image processing logic would go here
    // For example, resizing, encoding to base64, etc.
    
    // If image processing is needed, this would be implemented here
    // For now, we just ensure the image URL/path is properly set
    if (typeof promptObj.input_image === 'string') {
      // Handle URL or file path
      promptObj.input_image_url = promptObj.input_image;
    }
  }

  /**
   * Process prompt text including LoRA triggers
   * @private
   * @param {Object} promptObj - Prompt object
   */
  async _processPromptText(promptObj) {
    // Determine which base prompt types don't need additional basePrompt text
    const basepromptlessTypes = [
      'MAKE', 'I2I', 'MAKE_PLUS', 'INPAINT', 
      'MILADY', 'CHUD', 'RADBRO', 'LOSER', 
      'I2I_3', 'MAKE3', 'MS3.3'
    ];
    
    // Special cases that don't need a prompt
    const promptlessTypes = [
      'MS3', 'MS3.2', 'UPSCALE', 'RMBG'
    ];
    
    // Skip processing for types that don't need a prompt
    if (promptlessTypes.includes(promptObj.type)) {
      promptObj.finalPrompt = promptObj.prompt || '';
      return;
    }
    
    // Arrange the prompt components
    let promptArrangement;
    if (basepromptlessTypes.includes(promptObj.type)) {
      promptArrangement = `${promptObj.prompt} ${promptObj.userPrompt === '-1' ? '' : ', ' + promptObj.userPrompt + ', '}`;
    } else {
      promptArrangement = `${promptObj.prompt} ${promptObj.userPrompt === '-1' ? '' : ', ' + promptObj.userPrompt + ', '} ${this.getBasePromptByName(promptObj.basePrompt)}`;
    }
    
    // Process LoRA triggers if handler is available
    if (this.loraTriggerHandler && promptObj.input_checkpoint) {
      try {
        const promptFinal = await this.loraTriggerHandler(
          promptArrangement, 
          promptObj.input_checkpoint,
          promptObj.balance
        );
        promptObj.finalPrompt = promptFinal;
      } catch (error) {
        console.error('Error in LoRA trigger handler:', error);
        promptObj.finalPrompt = promptArrangement;
      }
    } else {
      promptObj.finalPrompt = promptArrangement;
    }
  }

  /**
   * Adjust image dimensions based on aspect ratio
   * @private
   * @param {Object} promptObj - Prompt object
   */
  _adjustImageDimensions(promptObj) {
    // Skip for types that don't need dimension adjustment
    if (
      promptObj.type.slice(0, 3) === 'QUICKI2I' ||
      promptObj.type.slice(0, 3) === 'PFP' ||
      promptObj.type.slice(0, 3) === 'MS3'
    ) {
      return;
    }
    
    // Get current dimensions
    let height = promptObj.photoStats.height;
    let width = promptObj.photoStats.width;
    
    // Calculate aspect ratio
    const ratio = height / width;
    
    // Adjust dimensions to maintain aspect ratio within allowed bounds
    if (height > width) {
      promptObj.input_width = Math.floor((this.defaultSettings.WIDTH / ratio) / 8) * 8;
      promptObj.input_height = this.defaultSettings.HEIGHT;
    } else if (width > height) {
      promptObj.input_height = Math.floor((this.defaultSettings.HEIGHT * ratio) / 8) * 8;
      promptObj.input_width = this.defaultSettings.WIDTH;
    } else {
      // Square image, use default size
      promptObj.input_height = this.defaultSettings.HEIGHT;
      promptObj.input_width = this.defaultSettings.WIDTH;
    }
  }

  /**
   * Finalize request structure for ComfyDeploy API
   * @private
   * @param {Object} promptObj - Processed prompt object
   * @returns {Object} - Final request object
   */
  _finalizeRequest(promptObj) {
    // Choose deployment ID
    const deploymentId = this._chooseDeploymentId(promptObj);
    
    // Build inputs object based on input template if available
    const inputs = {};
    
    // Always add the prompt if it exists
    if (promptObj.finalPrompt) {
      inputs.prompt = promptObj.finalPrompt;
    }
    
    // Add negative prompt
    inputs.negative_prompt = promptObj.negativePrompt;
    
    // Add common settings
    inputs.width = promptObj.input_width || promptObj.photoStats.width;
    inputs.height = promptObj.input_height || promptObj.photoStats.height;
    inputs.seed = promptObj.input_seed || -1;
    inputs.steps = promptObj.input_steps;
    inputs.cfg_scale = promptObj.input_cfg;
    inputs.batch_size = promptObj.input_batch;
    
    // Add sampler and checkpoint if provided
    if (promptObj.input_sampler) {
      inputs.sampler_name = promptObj.input_sampler;
    }
    
    if (promptObj.input_checkpoint) {
      inputs.checkpoint = promptObj.input_checkpoint;
    }
    
    // Add input image if available
    if (promptObj.input_image_url) {
      inputs.image = promptObj.input_image_url;
    }
    
    // Apply any template-specific inputs from deploymentInfo
    if (promptObj.inputTemplate) {
      Object.entries(promptObj.inputTemplate).forEach(([key, defaultValue]) => {
        // Only set if not already defined
        if (inputs[key] === undefined) {
          // Check if prompt object has this value
          if (promptObj[key] !== undefined) {
            inputs[key] = promptObj[key];
          } else if (promptObj.settings && promptObj.settings[key] !== undefined) {
            inputs[key] = promptObj.settings[key];
          } else {
            inputs[key] = defaultValue;
          }
        }
      });
    }
    
    // Build final result
    return {
      deployment_id: deploymentId,
      inputs,
      
      // Include original prompt object for reference and debugging
      originalPrompt: promptObj
    };
  }

  /**
   * Choose appropriate deployment ID
   * @private
   * @param {Object} promptObj - Prompt object
   * @returns {string} - Selected deployment ID
   */
  _chooseDeploymentId(promptObj) {
    if (!promptObj.deploymentIds || !Array.isArray(promptObj.deploymentIds) || promptObj.deploymentIds.length === 0) {
      throw new Error(`No deployment IDs available for type: ${promptObj.type}`);
    }
    
    // For now, just use the first ID
    // More sophisticated logic could be implemented here based on load balancing,
    // specific input requirements, etc.
    return promptObj.deploymentIds[0];
  }
}

module.exports = PromptBuilder; 