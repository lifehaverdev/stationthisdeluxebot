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
    
    // Initialize tracking for input decisions and normalized inputs
    const inputDecisions = {};
    const normalizedInputs = {};
    
    // Log initial state for debugging
    console.log('PROMPTBUILDER INPUT SOURCES:', {
      workflowType: promptObj.type,
      hasSettings: !!promptObj.settings,
      settingsKeys: promptObj.settings ? Object.keys(promptObj.settings) : [],
      hasInputsInSettings: !!(promptObj.settings && promptObj.settings.inputs),
      originalInputsCount: promptObj.settings && promptObj.settings.inputs ? Object.keys(promptObj.settings.inputs).length : 0
    });
    
    // STEP 1: Determine ALL potentially requested inputs
    // --------------------------------------------------
    // 1a. Extract requested inputs from UI (these are highest priority)
    const requestedInputs = [];
    
    if (promptObj.settings && promptObj.settings.inputs) {
      Object.entries(promptObj.settings.inputs).forEach(([key, value]) => {
        // Handle numeric keys that point to input names
        if (!isNaN(parseInt(key)) && value) {
          const inputName = value.startsWith('input_') ? value : `input_${value}`;
          requestedInputs.push(inputName);
        } 
        // Handle direct input name keys
        else if (key.startsWith('input_') || !isNaN(parseInt(key))) {
          // Skip numeric keys as values (already handled above)
          if (isNaN(parseInt(key))) {
            requestedInputs.push(key.startsWith('input_') ? key : `input_${key}`);
          }
        }
      });
    }
    
    // 1b. Define core inputs that should be included by default
    const coreInputs = [
      'input_seed', 'input_prompt', 'input_cfg', 
      'input_batch', 'input_width', 'input_height',
      'input_steps'
    ];
    
    // 1c. Combine and deduplicate all inputs
    const allPossibleInputs = [...new Set([...requestedInputs, ...coreInputs])];
    
    console.log('Input processing strategy:', {
      requestedFromUI: requestedInputs,
      coreInputs: coreInputs,
      combinedInputs: allPossibleInputs
    });
    
    // STEP 2: Collect all input values in PRIORITY ORDER
    // --------------------------------------------------
    
    // PRIORITY 1: User-supplied values from UI (settings.inputs)
    // These are direct values from the frontend, highest priority
    if (promptObj.settings && promptObj.settings.inputs) {
      Object.entries(promptObj.settings.inputs).forEach(([key, value]) => {
        // Skip numeric keys (they are just references to input names)
        if (!isNaN(parseInt(key))) {
          return;
        }
        
        // Normalize the key name
        const normalizedKey = key.startsWith('input_') ? key : `input_${key}`;
        
        // Only accept defined values
        if (value !== undefined && value !== null) {
          normalizedInputs[normalizedKey] = value;
          inputDecisions[normalizedKey] = { 
            source: 'settings.inputs (direct UI input)',
            priority: 1
          };
        }
      });
    }
    
    // PRIORITY 2: Direct settings object values
    // Second highest priority, these come from the workflow request but not necessarily UI
    if (promptObj.settings) {
      Object.entries(promptObj.settings).forEach(([key, value]) => {
        // Skip the inputs object which we already processed
        if (key === 'inputs') return;
        
        // Normalize the key name
        const normalizedKey = key.startsWith('input_') ? key : `input_${key}`;
        
        // Only set if not already defined and value is valid
        if (normalizedInputs[normalizedKey] === undefined && value !== undefined && value !== null) {
          normalizedInputs[normalizedKey] = value;
          inputDecisions[normalizedKey] = { 
            source: 'settings (direct parameter)',
            priority: 2
          };
        }
      });
    }
    
    // PRIORITY 3: Special prompt handlers for prompt/negative
    // Handle finalPrompt specially
    if (normalizedInputs['input_prompt'] === undefined && promptObj.finalPrompt) {
      normalizedInputs['input_prompt'] = promptObj.finalPrompt;
      inputDecisions['input_prompt'] = { 
        source: 'finalPrompt (processed text)',
        priority: 3
      };
    }
    
    // Handle negative prompt specially
    if (normalizedInputs['input_negative'] === undefined && promptObj.negativePrompt) {
      // Only set if this input is requested or we'll include all inputs later
      if (requestedInputs.includes('input_negative') || requestedInputs.length === 0) {
        normalizedInputs['input_negative'] = promptObj.negativePrompt;
        inputDecisions['input_negative'] = { 
          source: 'negativePrompt',
          priority: 3
        };
      }
    }
    
    // PRIORITY 4: Direct promptObj inputs (prefixed with input_)
    // Values set on the prompt object directly
    Object.entries(promptObj).forEach(([key, value]) => {
      // Only process input_ prefixed keys
      if (key.startsWith('input_') && value !== undefined && value !== null) {
        // Only set if not already defined
        if (normalizedInputs[key] === undefined) {
          normalizedInputs[key] = value;
          inputDecisions[key] = { 
            source: 'promptObj (direct input_* property)',
            priority: 4
          };
        }
      }
    });
    
    // PRIORITY 5: Non-prefixed values from promptObj
    // Check for non-prefixed versions of needed inputs
    allPossibleInputs.forEach(inputName => {
      if (normalizedInputs[inputName] === undefined && inputName.startsWith('input_')) {
        const shortName = inputName.replace('input_', '');
        if (promptObj[shortName] !== undefined && promptObj[shortName] !== null) {
          normalizedInputs[inputName] = promptObj[shortName];
          inputDecisions[inputName] = { 
            source: `promptObj.${shortName} (non-prefixed property)`,
            priority: 5
          };
        }
      }
    });
    
    // PRIORITY 6: Default values (lowest priority)
    // Apply only if no value has been set yet
    const defaultsToAdd = {
      'input_width': promptObj.photoStats?.width || this.defaultSettings.WIDTH,
      'input_height': promptObj.photoStats?.height || this.defaultSettings.HEIGHT,
      'input_seed': -1, // Default seed is -1 (random)
      'input_batch': 1, // Default batch size
      'input_cfg': this.defaultSettings.CFG, // Default CFG
      'input_steps': this.defaultSettings.STEPS // Default steps
    };
    
    // Only apply defaults for requested inputs that are still missing values
    allPossibleInputs.forEach(inputName => {
      if (normalizedInputs[inputName] === undefined && defaultsToAdd[inputName] !== undefined) {
        normalizedInputs[inputName] = defaultsToAdd[inputName];
        inputDecisions[inputName] = { 
          source: `default value`,
          priority: 6
        };
      }
    });
    
    // STEP 3: Build the final inputs object
    // -------------------------------------
    // Create the final output based on what inputs were requested
    const finalInputs = {};
    
    // If we have explicitly requested inputs, prioritize those
    if (requestedInputs.length > 0) {
      // First, include ALL requested inputs from UI
      requestedInputs.forEach(inputName => {
        const normalizedName = inputName.startsWith('input_') ? inputName : `input_${inputName}`;
        if (normalizedInputs[normalizedName] !== undefined) {
          finalInputs[normalizedName] = normalizedInputs[normalizedName];
        }
      });
      
      // Then ensure core inputs are included even if not explicitly requested
      coreInputs.forEach(inputName => {
        if (finalInputs[inputName] === undefined && normalizedInputs[inputName] !== undefined) {
          finalInputs[inputName] = normalizedInputs[inputName];
        }
      });
    } 
    // If no specific inputs were requested, include all normalized inputs
    else {
      Object.assign(finalInputs, normalizedInputs);
    }
    
    // Log the final inputs for debugging
    console.log('FINAL INPUTS BEING SENT TO COMFYDEPLOY:', finalInputs);
    
    // Generate detailed decision audit log
    console.log('PROMPT BUILDER DECISION AUDIT:', {
      workflowType: promptObj.type,
      requestedInputs: requestedInputs,
      coreInputs: coreInputs,
      allPossibleInputs: allPossibleInputs,
      normalizedInputCount: Object.keys(normalizedInputs).length,
      finalInputsCount: Object.keys(finalInputs).length,
      inputDecisions,
      finalInputValues: finalInputs,
    });
    
    // Return the final request structure
    return {
      deployment_id: deploymentId,
      inputs: finalInputs,
      originalPrompt: promptObj,
      inputDecisions
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
    
    // Check if we have multiple deployment IDs
    if (promptObj.deploymentIds.length > 1) {
      // Use the second ID as the default (index 1)
      return promptObj.deploymentIds[1];
    } else {
      // Fallback to the first ID if only one is available
      return promptObj.deploymentIds[0];
    }
  }
}

module.exports = PromptBuilder; 