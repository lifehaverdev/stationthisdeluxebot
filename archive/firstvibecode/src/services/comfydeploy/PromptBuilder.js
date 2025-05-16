/**
 * PromptBuilder for ComfyDeploy
 * 
 * Handles prompt construction for ComfyDeploy API requests.
 * Inspired by buildCommonPromptObj, promptPreProc, and imgPreProc from legacy code.
 */

const path = require('path');
const { v4: uuidv4 } = require('uuid');
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
    
    // Initialize generation type templates
    this._initTypeTemplates();
  }
  
  /**
   * Initialize generation type templates
   * @private
   */
  _initTypeTemplates() {
    // Generation type templates for different workflow types
    this.GENERATION_TYPES = {
      // Basic types
      MAKE: {
        deploymentKey: 'sdxl',
        requiresPrompt: true,
        supportsControlNet: false,
        template: 'standard'
      },
      QUICKMAKE: {
        deploymentKey: 'sdxl', // Same backend as MAKE but with different frontend workflow
        requiresPrompt: true,
        supportsControlNet: false,
        template: 'standard'
      },
      I2I: {
        deploymentKey: 'img2img',
        requiresPrompt: true,
        requiresImage: true,
        template: 'img2img'
      },
      MAKE_PLUS: {
        deploymentKey: 'sdxl_plus',
        requiresPrompt: true,
        supportsControlNet: true,
        supportsStyleTransfer: true,
        template: 'enhanced'
      },
      INPAINT: {
        deploymentKey: 'inpaint',
        requiresPrompt: true,
        requiresImage: true,
        requiresMask: true,
        template: 'inpaint'
      },
      UPSCALE: {
        deploymentKey: 'upscale',
        requiresPrompt: false,
        requiresImage: true,
        template: 'upscale'
      }
    };
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
    
    // Build type-specific prompt
    await this._buildTypeSpecificPrompt(promptObj);
    
    // Finalize request structure
    return this._finalizeRequest(promptObj);
  }
  
  /**
   * Build prompt specifically for a generation type
   * @param {string} type - Generation type (MAKE, I2I, etc.)
   * @param {Object} promptData - The prompt data
   * @returns {Promise<Object>} - Type-specific prompt object
   */
  async buildPromptForType(type, promptData) {
    // Default to MAKE if type is not specified
    const generationType = type || 'MAKE';
    
    switch (generationType) {
      case 'MAKE':
        return this._buildMakePrompt(promptData);
      case 'QUICKMAKE':
        // QUICKMAKE uses the same prompt building logic as MAKE
        // but preserves the QUICKMAKE type for workflow-specific handling
        const makePrompt = await this._buildMakePrompt(promptData);
        return {
          type: 'QUICKMAKE', 
          inputs: makePrompt.inputs
        };
      case 'I2I':
        return this._buildImageToImagePrompt(promptData);
      case 'MAKE_PLUS':
        return this._buildMakePlusPrompt(promptData);
      case 'INPAINT':
        return this._buildInpaintPrompt(promptData);
      case 'UPSCALE':
        return this._buildUpscalePrompt(promptData);
      default:
        // Default to standard MAKE if type is unknown
        console.warn(`Unknown generation type: ${generationType}, falling back to MAKE`);
        return this._buildMakePrompt(promptData);
    }
  }
  
  /**
   * Build specific prompt for MAKE generation type
   * @private
   * @param {Object} promptData - The prompt data
   * @returns {Promise<Object>} - MAKE-specific prompt
   */
  async _buildMakePrompt(promptData) {
    // Create a new output object with only required parameters
    const outputInputs = {};
    
    // Only add parameters that are explicitly provided
    if (promptData.prompt !== undefined) outputInputs.prompt = promptData.prompt;
    if (promptData.negative_prompt !== undefined) outputInputs.negative_prompt = promptData.negative_prompt;
    if (promptData.width !== undefined) outputInputs.width = promptData.width;
    if (promptData.height !== undefined) outputInputs.height = promptData.height;
    if (promptData.seed !== undefined) outputInputs.seed = promptData.seed;
    
    // Only add optional parameters if explicitly provided
    if (promptData.steps !== undefined) outputInputs.steps = promptData.steps;
    if (promptData.cfg !== undefined) outputInputs.cfg_scale = promptData.cfg;
    if (promptData.sampler !== undefined) outputInputs.sampler_name = promptData.sampler;
    if (promptData.checkpoint !== undefined) outputInputs.checkpoint_name = promptData.checkpoint;
    if (promptData.batch_size !== undefined) outputInputs.batch_size = promptData.batch_size;
    
    // Process LoRA triggers if handler is available and checkpoint is provided
    if (promptData.prompt && this.loraTriggerHandler && promptData.checkpoint) {
      try {
        outputInputs.prompt = await this.loraTriggerHandler(
          promptData.prompt, 
          promptData.checkpoint,
          promptData.balance || 0
        );
      } catch (error) {
        console.error('Error in LoRA trigger handler:', error);
      }
    }
    
    // Log what we're returning
    console.log(`_buildMakePrompt returning only explicitly provided parameters: ${JSON.stringify(Object.keys(outputInputs))}`);
    
    // Return formatted request for MAKE type
    return {
      type: 'MAKE',
      inputs: outputInputs
    };
  }
  
  /**
   * Build specific prompt for I2I (Image to Image) generation type
   * @private
   * @param {Object} promptData - The prompt data
   * @returns {Promise<Object>} - I2I-specific prompt
   */
  async _buildImageToImagePrompt(promptData) {
    // Extract required fields with defaults
    const { 
      prompt, 
      negative_prompt = this.baseNegPrompt, 
      width = this.defaultSettings.WIDTH, 
      height = this.defaultSettings.HEIGHT,
      seed = -1, 
      steps = this.defaultSettings.STEPS,
      cfg = this.defaultSettings.CFG,
      checkpoint,
      input_image,
      denoising_strength = 0.75
    } = promptData;
    
    // Validate required image
    if (!input_image) {
      throw new Error('Input image is required for I2I generation');
    }
    
    // Process LoRA triggers if handler is available
    let processedPrompt = prompt;
    if (this.loraTriggerHandler && checkpoint) {
      try {
        processedPrompt = await this.loraTriggerHandler(
          prompt, 
          checkpoint,
          promptData.balance || 0
        );
      } catch (error) {
        console.error('Error in LoRA trigger handler:', error);
      }
    }
    
    // Return formatted request for I2I type
    return {
      type: 'I2I',
      inputs: {
        prompt: processedPrompt,
        negative_prompt: negative_prompt,
        width,
        height,
        seed,
        steps,
        cfg_scale: cfg,
        sampler_name: promptData.sampler || 'DPM++ 2M Karras',
        checkpoint_name: checkpoint || 'stabilityAI/sdxl',
        denoising_strength,
        input_image,
        batch_size: promptData.batch_size || 1,
      }
    };
  }
  
  /**
   * Build specific prompt for MAKE_PLUS generation type
   * @private
   * @param {Object} promptData - The prompt data
   * @returns {Promise<Object>} - MAKE_PLUS-specific prompt
   */
  async _buildMakePlusPrompt(promptData) {
    // Start with a base MAKE prompt
    const basePrompt = await this._buildMakePrompt(promptData);
    
    // Add enhanced features for MAKE_PLUS
    return {
      type: 'MAKE_PLUS',
      inputs: {
        ...basePrompt.inputs,
        // MAKE_PLUS specific enhancements
        enhance_prompt: promptData.enhance_prompt || true,
        checkpoint_name: promptData.checkpoint || 'dreamshaper/dreamshaper_8',
        high_quality: promptData.high_quality || true,
        style_preset: promptData.style_preset || 'enhance',
        // Include other MAKE_PLUS specific parameters
      }
    };
  }
  
  /**
   * Build specific prompt for INPAINT generation type
   * @private
   * @param {Object} promptData - The prompt data
   * @returns {Promise<Object>} - INPAINT-specific prompt
   */
  async _buildInpaintPrompt(promptData) {
    // Extract required fields
    const { 
      prompt, 
      negative_prompt = this.baseNegPrompt, 
      input_image,
      mask_image,
      seed = -1, 
      steps = this.defaultSettings.STEPS,
      cfg = this.defaultSettings.CFG,
      checkpoint,
      inpaint_fill = 'fill'
    } = promptData;
    
    // Validate required images
    if (!input_image) {
      throw new Error('Input image is required for inpainting');
    }
    
    if (!mask_image) {
      throw new Error('Mask image is required for inpainting');
    }
    
    // Process LoRA triggers if handler is available
    let processedPrompt = prompt;
    if (this.loraTriggerHandler && checkpoint) {
      try {
        processedPrompt = await this.loraTriggerHandler(
          prompt, 
          checkpoint,
          promptData.balance || 0
        );
      } catch (error) {
        console.error('Error in LoRA trigger handler:', error);
      }
    }
    
    // Return formatted request for INPAINT type
    return {
      type: 'INPAINT',
      inputs: {
        prompt: processedPrompt,
        negative_prompt: negative_prompt,
        seed,
        steps,
        cfg_scale: cfg,
        sampler_name: promptData.sampler || 'DPM++ 2M Karras',
        checkpoint_name: checkpoint || 'stabilityAI/sdxl',
        input_image,
        mask_image,
        inpaint_fill,
        mask_blur: promptData.mask_blur || 4,
        inpaint_full_res: promptData.inpaint_full_res || true,
        inpaint_padding: promptData.inpaint_padding || 32,
      }
    };
  }
  
  /**
   * Build specific prompt for UPSCALE generation type
   * @private
   * @param {Object} promptData - The prompt data
   * @returns {Promise<Object>} - UPSCALE-specific prompt
   */
  async _buildUpscalePrompt(promptData) {
    // Extract required fields
    const { 
      input_image,
      scale = 2,
      upscaler = 'RealESRGAN_x4plus'
    } = promptData;
    
    // Validate required image
    if (!input_image) {
      throw new Error('Input image is required for upscaling');
    }
    
    // Return formatted request for UPSCALE type
    return {
      type: 'UPSCALE',
      inputs: {
        input_image,
        upscaler,
        scale,
        tile_size: promptData.tile_size || 512,
        tile_padding: promptData.tile_padding || 10,
      }
    };
  }
  
  /**
   * Build type-specific prompt based on the generation type
   * @private
   * @param {Object} promptObj - The prompt object
   * @returns {Promise<void>}
   */
  async _buildTypeSpecificPrompt(promptObj) {
    try {
      // Store user settings for later reference during filtering
      this._lastUserSettings = promptObj.settings || {};
      
      // Extract only explicitly provided parameters
      const explicitParams = {};
      
      // Add required parameters
      if (promptObj.finalPrompt) explicitParams.prompt = promptObj.finalPrompt;
      if (promptObj.input_width) explicitParams.width = promptObj.input_width;
      if (promptObj.input_height) explicitParams.height = promptObj.input_height;
      if (promptObj.input_seed !== undefined) explicitParams.seed = promptObj.input_seed;
      
      // Only include negative prompt if explicitly provided or it's not the default
      if (promptObj.negativePrompt && 
          (promptObj.settings?.negative_prompt || 
           promptObj.negativePrompt !== this.baseNegPrompt)) {
        explicitParams.negative_prompt = promptObj.negativePrompt;
      }
      
      // User explicitly provided parameters from settings
      if (promptObj.settings) {
        // Only include these if they were explicitly set in settings
        if (promptObj.settings.steps) explicitParams.steps = promptObj.settings.steps;
        if (promptObj.settings.cfg) explicitParams.cfg = promptObj.settings.cfg;
        if (promptObj.settings.batch) explicitParams.batch_size = promptObj.settings.batch;
        if (promptObj.settings.sampler) explicitParams.sampler = promptObj.settings.sampler;
        if (promptObj.settings.checkpoint) explicitParams.checkpoint = promptObj.settings.checkpoint;
      }
      
      // Highest priority - user inputs from settings
      if (promptObj.settings?.inputs) {
        // Direct API parameters from web UI
        if (promptObj.settings.inputs.input_steps) explicitParams.steps = promptObj.settings.inputs.input_steps;
        if (promptObj.settings.inputs.input_cfg) explicitParams.cfg = promptObj.settings.inputs.input_cfg;
        if (promptObj.settings.inputs.input_cfg_scale) explicitParams.cfg_scale = promptObj.settings.inputs.input_cfg_scale;
        if (promptObj.settings.inputs.input_batch) explicitParams.batch_size = promptObj.settings.inputs.input_batch;
        if (promptObj.settings.inputs.input_batch_size) explicitParams.batch_size = promptObj.settings.inputs.input_batch_size;
        if (promptObj.settings.inputs.input_sampler_name) explicitParams.sampler = promptObj.settings.inputs.input_sampler_name;
        if (promptObj.settings.inputs.input_checkpoint_name) explicitParams.checkpoint = promptObj.settings.inputs.input_checkpoint_name;
      }
      
      // Handle images and masks if present
      if (promptObj.input_image) explicitParams.input_image = promptObj.input_image;
      if (promptObj.mask_image) explicitParams.mask_image = promptObj.mask_image;
      
      // Now build the type-specific prompt with only explicitly provided parameters
      console.log(`Building type-specific prompt with ONLY explicit parameters: ${JSON.stringify(Object.keys(explicitParams))}`);
      
      // Get the type-specific prompt
      const typeSpecificPrompt = await this.buildPromptForType(
        promptObj.type,
        explicitParams
      );
      
      // Store the type-specific inputs
      promptObj.typeSpecificInputs = typeSpecificPrompt.inputs;
      
      // Log what was constructed
      console.log(`Type-specific inputs created: ${JSON.stringify(Object.keys(promptObj.typeSpecificInputs))}`);
    } catch (error) {
      console.error(`Error building type-specific prompt for ${promptObj.type}:`, error);
      // In case of error, create a minimal type-specific input with only essential parameters
      promptObj.typeSpecificInputs = {
        prompt: promptObj.finalPrompt
      };
      
      // Add negative prompt only if it exists and isn't default
      if (promptObj.negativePrompt && promptObj.negativePrompt !== this.baseNegPrompt) {
        promptObj.typeSpecificInputs.negative_prompt = promptObj.negativePrompt;
      }
    }
  }

  /**
   * Build common prompt object fields
   * @private
   * @param {GenerationRequest} request - Generation request
   * @param {Object} userContext - User context information
   * @returns {Object} - Basic prompt object
   */
  _buildCommonPromptObj(request, userContext) {
    // PARAMETER TRACING: Log input parameters before building prompt object
    console.log('PARAMETER TRACE [5. PromptBuilder Input]:', {
      requestType: request.type,
      hasPrompt: !!request.prompt,
      hasNegativePrompt: !!request.negativePrompt,
      settingsKeys: Object.keys(request.settings || {}),
      inputImagesCount: request.inputImages?.length || 0,
      contextKeys: Object.keys(userContext || {})
    });

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
    
    // PARAMETER TRACING: Log common prompt object structure
    console.log('PARAMETER TRACE [6. Common Prompt Object]:', {
      type: promptObj.type,
      inputPrefixedKeys: Object.keys(promptObj).filter(k => k.startsWith('input_')),
      nonPrefixedParams: Object.keys(promptObj).filter(k => !k.startsWith('input_') && 
                                                      !['userId', 'type', 'prompt', 'basePrompt', 'negativePrompt',
                                                        'username', 'balance', 'photoStats', 'timeRequested', 
                                                        'userBasePrompt', 'userPrompt', 'settings'].includes(k)),
      settingsPassthrough: Object.keys(promptObj.settings || {})
    });
    
    return promptObj;
  }

  /**
   * Apply deployment information to the prompt object
   * @private
   * @param {Object} promptObj - Prompt object
   * @param {Object} deploymentInfo - Deployment information (ids and inputs)
   */
  _applyDeploymentInfo(promptObj, deploymentInfo) {
    console.log('======= APPLYING DEPLOYMENT INFO =======');
    console.log(`Workflow Type: ${promptObj.type}`);
    console.log(`DeploymentInfo available: ${!!deploymentInfo}`);
    
    // PARAMETER TRACING: Log deployment info structure before applying
    console.log('PARAMETER TRACE [7. Deployment Info Structure]:', {
      hasIds: deploymentInfo && !!deploymentInfo.ids,
      idCount: deploymentInfo?.ids?.length || 0,
      hasInputTemplate: deploymentInfo && !!deploymentInfo.inputs,
      templateKeys: deploymentInfo?.inputs ? Object.keys(deploymentInfo.inputs) : [],
      templateHasInputPrefix: deploymentInfo?.inputs ? 
                             Object.keys(deploymentInfo.inputs).some(k => k.startsWith('input_')) : false,
      templateHasNonPrefixedKeys: deploymentInfo?.inputs ? 
                                Object.keys(deploymentInfo.inputs).some(k => !k.startsWith('input_')) : false
    });
    
    if (!deploymentInfo) {
      console.log('No deployment info provided!');
      return;
    }
    
    console.log(`DeploymentInfo.ids: ${JSON.stringify(deploymentInfo.ids || [])}`);
    
    // Store deployment IDs
    promptObj.deploymentIds = deploymentInfo.ids || [];
    
    console.log(`PromptObj.deploymentIds after assignment: ${JSON.stringify(promptObj.deploymentIds)}`);
    
    // Apply input templates if provided
    if (deploymentInfo.inputs) {
      // Simply ensure keys have input_ prefix without complex normalization
      const simplifiedTemplate = {};
      
      Object.entries(deploymentInfo.inputs).forEach(([key, value]) => {
        // Add input_ prefix if not already present
        const normalizedKey = key.startsWith('input_') ? key : `input_${key}`;
        simplifiedTemplate[normalizedKey] = value;
      });
      
      // Store the template with ensured prefixes
      promptObj.inputTemplate = simplifiedTemplate;
      
      // Log the result
      console.log('PARAMETER TRACE [7.1 Template Simplification]:', {
        originalKeys: Object.keys(deploymentInfo.inputs),
        simplifiedKeys: Object.keys(simplifiedTemplate),
        allKeysHavePrefix: Object.keys(simplifiedTemplate).every(k => k.startsWith('input_') || !isNaN(parseInt(k)))
      });
      
      console.log(`Applied input template with keys: ${Object.keys(simplifiedTemplate)}`);
    }
    
    console.log('========================================');
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
    // Determine which types don't need a prompt
    const promptlessTypes = [
      'MS3', 'MS3.2', 'UPSCALE', 'RMBG'
    ];
    
    // Skip processing for types that don't need a prompt
    if (promptlessTypes.includes(promptObj.type)) {
      promptObj.finalPrompt = promptObj.prompt || '';
      return;
    }
    
    // PRIORITY ORDER for prompt text:
    // 1. Get directly from settings.inputs.input_prompt if available
    // 2. Get from settings.prompt
    // 3. Get from promptObj.prompt
    // 4. Only if none of these exist, fall back to composition

    // Prioritize using the direct input_prompt from settings
    let promptText = '';
    
    // Check for prompt in settings with correct input_ prefix
    if (promptObj.settings?.inputs?.input_prompt) {
      console.log('Using prompt from settings.inputs.input_prompt');
      promptText = promptObj.settings.inputs.input_prompt;
    }
    // Next check for input_prompt directly in settings
    else if (promptObj.settings?.input_prompt) {
      console.log('Using prompt from settings.input_prompt');
      promptText = promptObj.settings.input_prompt;
    }
    // Check for prompt property in settings
    else if (promptObj.settings?.prompt) {
      console.log('Using prompt from settings.prompt');
      promptText = promptObj.settings.prompt;
    }
    // Fall back to promptObj.prompt
    else if (promptObj.prompt) {
      console.log('Using prompt from promptObj.prompt');
      promptText = promptObj.prompt;
    }
    // If all else fails, use the original composition method as fallback
    else {
      console.log('No direct prompt found. Using fallback composition method');
      const basepromptlessTypes = [
        'MAKE', 'I2I', 'MAKE_PLUS', 'INPAINT', 
        'MILADY', 'CHUD', 'RADBRO', 'LOSER', 
        'I2I_3', 'MAKE3', 'MS3.3'
      ];
      
      if (basepromptlessTypes.includes(promptObj.type)) {
        promptText = `${promptObj.prompt} ${promptObj.userPrompt === '-1' ? '' : ', ' + promptObj.userPrompt + ', '}`;
      } else {
        promptText = `${promptObj.prompt} ${promptObj.userPrompt === '-1' ? '' : ', ' + promptObj.userPrompt + ', '} ${this.getBasePromptByName(promptObj.basePrompt)}`;
      }
    }
    
    // Process LoRA triggers if handler is available
    if (this.loraTriggerHandler && promptObj.input_checkpoint) {
      try {
        const promptFinal = await this.loraTriggerHandler(
          promptText, 
          promptObj.input_checkpoint,
          promptObj.balance
        );
        promptObj.finalPrompt = promptFinal;
      } catch (error) {
        console.error('Error in LoRA trigger handler:', error);
        promptObj.finalPrompt = promptText;
      }
    } else {
      promptObj.finalPrompt = promptText;
    }
    
    // Add debug log for the prompt that will be used
    console.log('PROMPT TRACE: Final prompt value set to:', promptObj.finalPrompt);
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
   * Finalize the request by normalizing all parameters and preparing the final structure
   * @private
   * @param {Object} promptObj - The prompt object to finalize
   * @returns {Object} - Finalized request ready for API submission
   */
  _finalizeRequest(promptObj) {
    // Helper function for ensuring input_ prefix
    const ensureInputPrefix = (key) => {
      return key.startsWith('input_') ? key : `input_${key}`;
    };

    // Choose deployment ID
    const deploymentId = this._chooseDeploymentId(promptObj);
    
    // PARAMETER TRACING: Log selected deployment ID
    console.log('PARAMETER TRACE [8. Selected Deployment ID]:', {
      deploymentId,
      selectionSource: promptObj.deploymentIds?.length > 0 ? 'from deploymentIds array' : 'default fallback'
    });
    
    // Initialize final inputs object
    const finalInputs = {};
    
    // STEP 1: Collect all parameters from different sources
    // --------------------------------------------------
    const parameterSources = [
      // Source 1: Input template first (lowest priority)
      ...(promptObj.inputTemplate ? 
        Object.entries(promptObj.inputTemplate)
          .map(([key, value]) => ({ key, value, source: 'inputTemplate' })) 
        : []),
      
      // Source 2: Type-specific inputs
      ...(promptObj.typeSpecificInputs ? 
        Object.entries(promptObj.typeSpecificInputs)
          .map(([key, value]) => ({ key, value, source: 'typeSpecificInputs' })) 
        : []),
        
      // Source 3: Existing input_* properties in prompt object
      ...Object.entries(promptObj)
        .filter(([key]) => key.startsWith('input_'))
        .map(([key, value]) => ({ key, value, source: 'promptObj.input_*' })),
      
      // Source 4: Non-prefixed properties
      ...Object.entries(promptObj)
        .filter(([key]) => !key.startsWith('input_') && 
          !['settings', 'finalPrompt', 'negativePrompt', 'type', 'deploymentIds'].includes(key))
        .map(([key, value]) => ({ key, value, source: 'promptObj' })),
      
      // Source 5: Settings properties (from user input) - HIGH PRIORITY
      ...(promptObj.settings ? 
        Object.entries(promptObj.settings)
          .filter(([key]) => key !== 'inputs') // Filter out 'inputs' to handle separately
          .map(([key, value]) => ({ key, value, source: 'settings' })) 
        : []),
        
      // Source 6: Settings.inputs properties (from web client) - HIGHEST PRIORITY
      // Direct web client parameters that should override everything else
      ...(promptObj.settings?.inputs ? 
        Object.entries(promptObj.settings.inputs)
          .map(([key, value]) => ({ key, value, source: 'settings.inputs' })) 
        : [])
    ];
    
    // 2. Apply parameters in order of priority, ensuring input_ prefix
    parameterSources.forEach(({ key, value, source }) => {
      if (value === undefined || value === null) return;
      
      // Special handling for direct input parameters that should always take priority
      const isPrioritySetting = 
        (source === 'settings' && 
          (key === 'input_seed' || key === 'input_prompt' || 
           key === 'input_width' || key === 'input_height' ||
           key === 'input_cfg' || key === 'input_steps')) ||
        // Settings.inputs parameters should always have highest priority
        source === 'settings.inputs';
      
      // Ensure the key has input_ prefix
      const prefixedKey = ensureInputPrefix(key);
      
      // Only set if not already defined (respects priority order) OR
      // if it's a priority setting that should override existing values
      if (finalInputs[prefixedKey] === undefined || isPrioritySetting) {
        console.log(`Setting parameter ${prefixedKey} = ${value} from source ${source}`);
        finalInputs[prefixedKey] = value;
      }
    });
    
    // 3. Only apply TRULY REQUIRED default values
    // Only prompt, width, height, and seed are absolutely required
    const minimalDefaultsToAdd = {
      'input_width': promptObj.photoStats?.width || this.defaultSettings.WIDTH,
      'input_height': promptObj.photoStats?.height || this.defaultSettings.HEIGHT,
      'input_seed': -1 // Default seed is -1 (random)
    };
    
    // Add defaults ONLY for absolutely required parameters
    Object.entries(minimalDefaultsToAdd).forEach(([key, value]) => {
      if (finalInputs[key] === undefined) {
        console.log(`Applying minimal required default for ${key} = ${value}`);
        finalInputs[key] = value;
      } else {
        console.log(`Keeping user-provided value for ${key} = ${finalInputs[key]}`);
      }
    });
    
    // CRITICAL FIX: Ensure prompt is set correctly with highest priority order
    // 1. First check settings.inputs.input_prompt (direct API parameter - highest priority)
    // 2. Then check finalPrompt created by _processPromptText 
    // 3. Then check settings.prompt
    // 4. Finally use any original prompt value as fallback
    
    const originalPrompt = 
      promptObj.settings?.inputs?.input_prompt || 
      promptObj.finalPrompt || 
      promptObj.settings?.prompt ||
      promptObj.prompt || 
      '';
    
    // Log the origin of the prompt for debugging
    console.log('PROMPT ORIGIN:', {
      hasSettingsInputsPrompt: !!promptObj.settings?.inputs?.input_prompt,
      hasFinalPrompt: !!promptObj.finalPrompt,
      hasSettingsPrompt: !!promptObj.settings?.prompt,
      hasPromptField: !!promptObj.prompt,
      selectedValue: originalPrompt.substring(0, 50) + (originalPrompt.length > 50 ? '...' : '')
    });
    
    // Always set input_prompt to ensure it's included and prioritized
    finalInputs['input_prompt'] = originalPrompt;
    
    // And ensure negative prompt is also set
    if (promptObj.negativePrompt && !finalInputs['input_negative_prompt']) {
      finalInputs['input_negative_prompt'] = promptObj.negativePrompt;
    }
    
    // 4. Filter to include only parameters actually needed by the ComfyDeploy API
    const { filterPrimitiveParameters } = require('./utils/normalizeParameters');
    
    // First filter to primitive types
    const primitiveInputs = filterPrimitiveParameters(finalInputs);
    
    // Then apply type-specific parameter whitelist
    const apiInputs = this._filterToRequiredParameters(primitiveInputs, promptObj.type);
    
    // Log the final inputs for debugging
    console.log('FINAL INPUTS BEING SENT TO COMFYDEPLOY:', apiInputs);
    
    // PARAMETER TRACING: Detailed analysis of final input structure
    console.log('PARAMETER TRACE [10. Final Input Analysis]:', {
      totalInputCount: Object.keys(apiInputs).length,
      prefixedCount: Object.keys(apiInputs).filter(k => k.startsWith('input_')).length, 
      nonPrefixedCount: Object.keys(apiInputs).filter(k => !k.startsWith('input_')).length,
      prefixedKeys: Object.keys(apiInputs).filter(k => k.startsWith('input_')),
      nonPrefixedKeys: Object.keys(apiInputs).filter(k => !k.startsWith('input_')),
      primitiveFilteredCount: Object.keys(finalInputs).length - Object.keys(primitiveInputs).length,
      whitelistFilteredCount: Object.keys(primitiveInputs).length - Object.keys(apiInputs).length
    });
    
    // Log the parameter sources for debugging
    console.log('PARAMETER SOURCES TRACE:', {
      inputTemplate: promptObj.inputTemplate ? Object.keys(promptObj.inputTemplate) : [],
      typeSpecificInputs: promptObj.typeSpecificInputs ? Object.keys(promptObj.typeSpecificInputs) : [],
      promptObjInputs: Object.keys(promptObj).filter(k => k.startsWith('input_')),
      settingsParams: promptObj.settings ? Object.keys(promptObj.settings) : [],
      settingsInputsParams: promptObj.settings?.inputs ? Object.keys(promptObj.settings.inputs) : [],
      userProvidedSeed: promptObj.settings?.input_seed || promptObj.settings?.inputs?.input_seed || 'none',
      finalInputSeed: finalInputs.input_seed
    });
    
    // Return the final request object
    return {
      deployment_id: deploymentId,
      inputs: apiInputs,
      metadata: {
        type: promptObj.type,
        workflow: promptObj.workflow || 'custom',
        timestamp: Date.now()
      }
    };
  }

  /**
   * Filter inputs to only include parameters actually needed by the ComfyDeploy API
   * based on the generation type
   * @private
   * @param {Object} inputs - All collected inputs
   * @param {string} type - Generation type (MAKE, I2I, etc.)
   * @returns {Object} - Filtered inputs with only required parameters
   */
  _filterToRequiredParameters(inputs, type) {
    // We need a more aggressive approach
    // 1. Start with only truly required parameters
    const requiredParams = [
      'input_prompt', 
      'input_width',
      'input_height',
      'input_seed'
    ];
    
    // Additional required parameters based on type
    const additionalRequired = [];
    if (type === 'I2I') additionalRequired.push('input_image');
    if (type === 'INPAINT') additionalRequired.push('input_image', 'input_mask_image');
    if (type === 'UPSCALE') additionalRequired.push('input_image');
    
    // Combine required parameters
    const allRequiredParams = [...requiredParams, ...additionalRequired];
    
    // 2. Create a completely clean output object
    const filteredInputs = {};
    
    // 3. Add ONLY required parameters
    allRequiredParams.forEach(param => {
      if (inputs[param] !== undefined) {
        filteredInputs[param] = inputs[param];
      }
    });
    
    // 4. ONLY add explicitly provided optional parameters - but with stricter rules
    // Check if the param actually came from a user setting rather than a default
    
    // Get the names of all parameters where we actually had user input
    const userProvidedParams = [];
    
    // From settings.inputs - direct user API input (highest priority)
    if (this._lastUserSettings?.inputs) {
      Object.keys(this._lastUserSettings.inputs).forEach(key => {
        const normalizedKey = key.startsWith('input_') ? key : `input_${key}`;
        userProvidedParams.push(normalizedKey);
      });
    }
    
    // From settings - specific parameters (high priority)
    if (this._lastUserSettings) {
      // Only consider explicit settings parameters (not all)
      const settingsParams = ['width', 'height', 'steps', 'cfg', 'sampler', 'checkpoint', 'negative_prompt'];
      settingsParams.forEach(key => {
        if (this._lastUserSettings[key] !== undefined) {
          const normalizedKey = `input_${key}`;
          userProvidedParams.push(normalizedKey);
          // Also add alternative names
          if (key === 'cfg') userProvidedParams.push('input_cfg_scale');
          if (key === 'batch') userProvidedParams.push('input_batch_size');
        }
      });
    }
    
    // Log what parameters were actually provided by the user
    console.log(`User-provided parameters: ${JSON.stringify(userProvidedParams)}`);
    
    // List of optional parameters that might be included
    const optionalParams = [
      'input_negative_prompt',
      'input_steps',
      'input_cfg',
      'input_cfg_scale',
      'input_sampler_name',
      'input_checkpoint_name',
      'input_batch',
      'input_batch_size'
    ].concat(
      type === 'I2I' ? ['input_denoising_strength'] : [],
      type === 'INPAINT' ? ['input_inpaint_fill', 'input_mask_blur', 'input_inpaint_full_res', 'input_inpaint_padding'] : [],
      type === 'UPSCALE' ? ['input_upscaler', 'input_scale', 'input_tile_size', 'input_tile_padding'] : []
    );
    
    // Only add optional parameters if they were explicitly provided by the user
    optionalParams.forEach(param => {
      if (inputs[param] !== undefined && userProvidedParams.includes(param)) {
        filteredInputs[param] = inputs[param];
      }
    });
    
    // Log the filtered inputs
    console.log(`Parameters after strict filtering: ${JSON.stringify(Object.keys(filteredInputs))}`);
    
    return filteredInputs;
  }

  /**
   * Choose appropriate deployment ID
   * @private
   * @param {Object} promptObj - Prompt object
   * @returns {string} - Selected deployment ID
   */
  _chooseDeploymentId(promptObj) {
    console.log(`Selecting deployment ID for type: ${promptObj.type}`);
    
    // Mapping of known string identifiers to valid deployment UUIDs
    const DEPLOYMENT_ID_MAP = {
      'sdxl_default': '10f46770-f89c-47ba-8b06-57c82d3b9bfc',
      'img2img_default': '0d129bba-1d74-4f79-8808-a4e8a8a79fcf',
      'sdxl_plus_default': 'f9e045ed-90f5-420b-8253-f2cf1d91f7f9',
      'inpaint_default': '12345678-1234-5678-1234-567812345678', // Replace with actual UUID
      'upscale_default': '87654321-4321-8765-4321-876543210987'  // Replace with actual UUID
    };
    
    if (!promptObj.deploymentIds || !Array.isArray(promptObj.deploymentIds) || promptObj.deploymentIds.length === 0) {
      // If no deployment IDs available, use the default for this type
      const defaultId = DEPLOYMENT_ID_MAP['sdxl_default'];
      console.log(`No deployment IDs available for type: ${promptObj.type}, using default ID: ${defaultId}`);
      return defaultId;
    }
    
    console.log(`Available deployment IDs: ${JSON.stringify(promptObj.deploymentIds)}`);
    
    // Check if we have multiple deployment IDs
    let selectedId;
    
    // Special case for type MAKE - always use index 1 for web requests
    if (promptObj.type === 'MAKE' && promptObj.deploymentIds.length > 1) {
      selectedId = promptObj.deploymentIds[1];
      console.log(`MAKE workflow - always using second ID: ${selectedId}`);
    } else if (promptObj.deploymentIds.length > 1) {
      // Use the second ID as the default (index 1)
      selectedId = promptObj.deploymentIds[1];
      console.log(`Multiple IDs available, using second ID: ${selectedId}`);
    } else {
      // Fallback to the first ID if only one is available
      selectedId = promptObj.deploymentIds[0];
      console.log(`Single ID available, using: ${selectedId}`);
    }
    
    // Validate UUID format using a regex
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(selectedId)) {
      // Check if we have a mapping for this string identifier
      if (DEPLOYMENT_ID_MAP[selectedId]) {
        const mappedId = DEPLOYMENT_ID_MAP[selectedId];
        console.log(`Mapped string identifier ${selectedId} to UUID: ${mappedId}`);
        return mappedId;
      }
      
      // If no mapping exists, use the default for MAKE
      console.log(`No mapping found for ID: ${selectedId}, using default UUID`);
      return DEPLOYMENT_ID_MAP['sdxl_default'];
    }
    
    console.log(`Using deployment ID: ${selectedId}`);
    return selectedId;
  }
}

module.exports = PromptBuilder; 