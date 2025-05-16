/**
 * ComfyDeployService
 * 
 * Platform-agnostic service for generating images using ComfyDeploy.
 * Accepts structured prompt input, sends generation request to ComfyDeploy API,
 * and returns a run_id for downstream tracking.
 */

const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const { AppError, ERROR_SEVERITY } = require('../../core/shared/errors');
const { GenerationRequest } = require('../../core/generation/models');

const ComfyClient = require('./ComfyClient');
const PromptBuilder = require('./PromptBuilder');
const ComfyTaskMapper = require('./ComfyTaskMapper');

/**
 * ComfyDeployService for image generation
 * @extends EventEmitter
 */
class ComfyDeployService extends EventEmitter {
  /**
   * Create a new ComfyDeployService
   * @param {Object} options - Service configuration
   * @param {Object} [options.client] - Optional pre-configured ComfyClient
   * @param {Object} [options.promptBuilder] - Optional pre-configured PromptBuilder
   * @param {Object} [options.taskMapper] - Optional pre-configured ComfyTaskMapper
   * @param {Object} [options.config] - Service configuration
   * @param {Function} [options.getDeploymentInfo] - Function to get deployment IDs and inputs
   * @param {Function} [options.loraTriggerHandler] - Function to process LoRA triggers
   * @param {Function} [options.getBasePromptByName] - Function to get base prompts
   * @param {Object} [options.defaultSettings] - Default generation settings
   * @param {Array} [options.workflows] - Available workflow definitions
   */
  constructor(options = {}) {
    super();
    
    // Initialize client
    this.client = options.client || new ComfyClient({
      apiKey: options.config?.apiKey,
      baseUrl: options.config?.baseUrl,
      webhookUrl: options.config?.webhookUrl
    });
    
    // Initialize prompt builder
    this.promptBuilder = options.promptBuilder || new PromptBuilder({
      loraTriggerHandler: options.loraTriggerHandler,
      getBasePromptByName: options.getBasePromptByName,
      defaultSettings: options.config?.defaultSettings
    });
    
    // Initialize task mapper
    this.taskMapper = options.taskMapper || new ComfyTaskMapper();
    
    // Store workflows and configuration
    this.workflows = options.workflows || [];
    this.getDeploymentInfo = options.getDeploymentInfo || this._defaultGetDeploymentInfo.bind(this);
    
    // Forward client events
    this._setupEventForwarding();
  }

  /**
   * Initialize the service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Try to get workflows from the WorkflowService first
      const { getWorkflowService } = require('./WorkflowService');
      const workflowService = getWorkflowService();
      
      if (workflowService) {
        // If WorkflowService exists, try to get workflows from it
        if (!workflowService.workflows || workflowService.workflows.length === 0) {
          // Initialize the WorkflowService if needed
          console.log('Initializing WorkflowService to load workflows');
          await workflowService.initialize();
        }
        
        // Get workflows from the service
        const serviceWorkflows = workflowService.getAllWorkflows();
        if (serviceWorkflows && serviceWorkflows.length > 0) {
          console.log(`Using ${serviceWorkflows.length} workflows from WorkflowService`);
          this.workflows = serviceWorkflows;
        } else {
          console.warn('No workflows found in WorkflowService, using defaults');
          this._setDefaultWorkflows();
        }
      } else {
        console.warn('WorkflowService not available, using default workflows');
        this._setDefaultWorkflows();
      }
      
      // Connect to the client
      await this.client.connect();
      
      return true;
    } catch (error) {
      console.error('Failed to initialize ComfyDeployService:', error);
      throw error;
    }
  }

  /**
   * Set default workflows if none are available from other sources
   * @private
   */
  _setDefaultWorkflows() {
    // Only set defaults if no workflows are available
    if (!this.workflows || this.workflows.length === 0) {
      this.workflows = [
        {
          name: 'DEFAULT',
          description: 'Basic text-to-image generation',
          inputs: {
            prompt: { 
              type: 'text', 
              label: 'Prompt',
              description: 'Describe what you want to generate',
              required: true,
              default: ''
            },
            negative_prompt: { 
              type: 'text', 
              label: 'Negative Prompt',
              description: 'Things you want to avoid in the image',
              required: false,
              default: ''
            },
            width: { 
              type: 'number', 
              label: 'Width',
              min: 512,
              max: 2048,
              step: 64,
              default: 1024
            },
            height: { 
              type: 'number', 
              label: 'Height',
              min: 512,
              max: 2048,
              step: 64,
              default: 1024
            }
          }
        },
        {
          name: 'UPSCALE',
          description: 'Upscale an existing image',
          inputs: {
            image: { 
              type: 'file', 
              label: 'Image',
              description: 'Image to upscale',
              required: true
            },
            scale: { 
              type: 'number', 
              label: 'Scale Factor',
              min: 1,
              max: 4,
              step: 1,
              default: 2
            }
          }
        },
        {
          name: 'MAKE',
          description: 'Generate an image from text prompt',
          inputs: {
            prompt: { 
              type: 'text', 
              label: 'Prompt',
              description: 'Describe what you want to generate',
              required: true,
              default: ''
            },
            negative_prompt: { 
              type: 'text', 
              label: 'Negative Prompt',
              description: 'Things you want to avoid in the image',
              required: false,
              default: ''
            },
            width: { 
              type: 'number', 
              label: 'Width',
              min: 512,
              max: 2048,
              step: 64,
              default: 1024
            },
            height: { 
              type: 'number', 
              label: 'Height',
              min: 512,
              max: 2048,
              step: 64,
              default: 1024
            }
          }
        }
      ];
    }
  }

  /**
   * Generate an image using ComfyDeploy
   * @param {GenerationRequest|Object} promptObj - Generation request or prompt object
   * @param {Object} userContext - User context information
   * @param {Object} [options] - Additional generation options
   * @param {string} [options.taskId] - Custom task ID (defaults to generated UUID)
   * @param {Object} [options.webhookData] - Additional webhook data
   * @param {string} [options.callbackUrl] - Custom webhook URL for this request
   * @returns {Promise<Object>} - Generation result with run_id
   */
  async generate(promptObj, userContext, options = {}) {
    try {
      // Import the filtering utility
      const { filterPrimitiveParameters } = require('./utils/normalizeParameters');

      // PARAMETER TRACING: Log initial user input
      console.log('PARAMETER TRACE [1. Service Entry]:', {
        type: promptObj.type,
        prompt: promptObj.prompt?.substring(0, 30) + '...',
        paramKeys: promptObj.settings ? Object.keys(promptObj.settings) : [],
        hasNestedInputs: promptObj.settings?.inputs ? true : false,
        inputKeys: promptObj.settings?.inputs ? Object.keys(promptObj.settings.inputs) : []
      });

      // Simple prefix handling for parameters early in the process
      if (promptObj.settings) {
        // Simply ensure all keys have input_ prefix
        const simplifiedParams = {};
        
        // Process all settings parameters
        Object.entries(promptObj.settings).forEach(([key, value]) => {
          // Skip the inputs object itself for separate handling
          if (key === 'inputs') return;
          
          // Add input_ prefix if not already present
          const prefixedKey = key.startsWith('input_') ? key : `input_${key}`;
          simplifiedParams[prefixedKey] = value;
        });
        
        // Handle nested inputs if they exist
        if (promptObj.settings.inputs) {
          // Store the original inputs for reference/debugging
          promptObj.settings._originalInputs = { ...promptObj.settings.inputs };
          
          // Process the inputs object
          Object.entries(promptObj.settings.inputs).forEach(([key, value]) => {
            // Skip numeric keys which are often UI mappings
            if (!isNaN(parseInt(key))) return;
            
            // Add input_ prefix if not already present
            const prefixedKey = key.startsWith('input_') ? key : `input_${key}`;
            simplifiedParams[prefixedKey] = value;
          });
        }
        
        // Replace with simplified parameters
        promptObj.settings.inputs = simplifiedParams;
        
        // PARAMETER TRACING: Log simplified parameters
        console.log('PARAMETER TRACE [2. Parameter Simplification]:', {
          paramCount: Object.keys(simplifiedParams).length,
          allParamsHavePrefix: Object.keys(simplifiedParams).every(k => k.startsWith('input_')),
          paramKeys: Object.keys(simplifiedParams)
        });
      }

      // Handle different formats of userId in userContext
      const userId = userContext.userId || 
                    (userContext.user && userContext.user.id) || 
                    (promptObj && promptObj.userId);
      
      if (!userId) {
        throw new AppError('userId is required for generation', {
          severity: ERROR_SEVERITY.ERROR,
          code: 'MISSING_USER_ID'
        });
      }
      
      // Ensure userId is available in promptObj for the GenerationRequest constructor
      if (promptObj && !promptObj.userId) {
        promptObj.userId = userId;
      }
      
      // Ensure promptObj is a GenerationRequest
      const request = promptObj instanceof GenerationRequest
        ? promptObj
        : new GenerationRequest(promptObj);
      
      // Double-check userId is set in the request
      if (!request.userId && userId) {
        request.userId = userId;
      }
      
      // PARAMETER TRACING: Log structured request after normalization
      console.log('PARAMETER TRACE [2. Normalized Request]:', {
        type: request.type,
        parameterKeys: Object.keys(request.settings || {}),
        hasInputImagesArray: request.inputImages ? true : false,
        inputImageCount: request.inputImages ? request.inputImages.length : 0
      });
      
      // Log generation request information
      console.log('Generation request prepared:', {
        userId: request.userId,
        type: request.type,
        contextUserId: userId
      });
      
      // Validate request
      const validationResult = request.validate();
      if (!validationResult.isValid) {
        throw new AppError('Invalid generation request', {
          severity: ERROR_SEVERITY.ERROR,
          code: 'INVALID_GENERATION_REQUEST',
          details: validationResult.errors
        });
      }
      
      // Generate task ID if not provided
      const taskId = options.taskId || uuidv4();
      
      // Get deployment information for this type
      const deploymentInfo = await this.getDeploymentInfo(request.type);
      
      // PARAMETER TRACING: Log deployment info with template parameters
      console.log('PARAMETER TRACE [3. Deployment Info]:', {
        deploymentIds: deploymentInfo.ids,
        hasInputTemplate: deploymentInfo.inputs ? true : false,
        templateInputKeys: deploymentInfo.inputs ? Object.keys(deploymentInfo.inputs) : [],
        templateRequiresInputPrefix: Object.keys(deploymentInfo.inputs || {}).some(key => key.startsWith('input_'))
      });
      
      // Build prompt object for ComfyDeploy
      const comfyRequest = await this.promptBuilder.build(
        request,
        userContext,
        deploymentInfo
      );
      
      // PARAMETER TRACING: Log final ComfyDeploy request structure
      console.log('PARAMETER TRACE [4. Final API Request]:', {
        deployment_id: comfyRequest.deployment_id,
        inputCount: Object.keys(comfyRequest.inputs || {}).length,
        inputKeys: Object.keys(comfyRequest.inputs || {}),
        inputPrefixCount: Object.keys(comfyRequest.inputs || {}).filter(k => k.startsWith('input_')).length,
        nonPrefixedCount: Object.keys(comfyRequest.inputs || {}).filter(k => !k.startsWith('input_')).length,
        nonPrefixedKeys: Object.keys(comfyRequest.inputs || {}).filter(k => !k.startsWith('input_'))
      });
      
      // Prepare webhook data
      const webhookData = {
        taskId,
        userId: request.userId,
        ...options.webhookData
      };
      
      // Send request to ComfyDeploy
      const response = await this.client.sendRequest(comfyRequest, {
        webhookUrl: options.callbackUrl,
        webhookData
      });
      
      // Map request and response to task
      const task = this.taskMapper.mapRequestToTask(comfyRequest, response, {
        taskId,
        userId: request.userId,
        userContext
      });
      
      // Emit task created event
      this.emit('task:created', task);
      
      // Return result with run_id and context
      return {
        taskId,
        runId: response.run_id,
        status: 'queued',
        requestPayload: {
          deployment_id: comfyRequest.deployment_id,
          inputs: comfyRequest.inputs
        },
        userContext: {
          userId: request.userId,
          type: request.type,
          prompt: request.prompt
        },
        timestamp: Date.now()
      };
    } catch (error) {
      // Emit error event
      this.emit('generation:error', {
        error: error.message,
        userId: promptObj.userId || userContext.userId,
        prompt: promptObj.prompt || '',
        timestamp: Date.now()
      });
      
      // Rethrow error
      throw error instanceof AppError ? error : new AppError('Failed to generate image', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'GENERATION_FAILED',
        cause: error
      });
    }
  }

  /**
   * Check the status of a generation task
   * @param {string} runId - ComfyDeploy run ID
   * @param {Object} [context] - Additional context information
   * @returns {Promise<Object>} - Task status
   */
  async checkStatus(runId, context = {}) {
    try {
      // Get status from ComfyDeploy
      const statusResponse = await this.client.getStatus(runId);
      
      // Map status to internal format
      return this.taskMapper.mapStatusToTaskStatus(statusResponse, context);
    } catch (error) {
      // Rethrow as AppError
      throw error instanceof AppError ? error : new AppError('Failed to check generation status', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'STATUS_CHECK_FAILED',
        cause: error
      });
    }
  }

  /**
   * Process webhook payload from ComfyDeploy
   * @param {Object} webhookPayload - Raw webhook payload
   * @returns {Object} - Processed webhook result
   */
  processWebhook(webhookPayload) {
    try {
      // Extract run_id and webhook data
      const { run_id, webhook_data = {} } = webhookPayload;
      
      // Map webhook payload to task result
      const result = this.taskMapper.mapWebhookToTaskResult(webhookPayload, webhook_data);
      
      // Emit appropriate events based on result
      if (result.isSuccessful()) {
        this.emit('generation:completed', {
          taskId: result.requestId,
          run_id,
          outputs: result.outputs,
          timestamp: Date.now()
        });
      } else {
        this.emit('generation:failed', {
          taskId: result.requestId,
          run_id,
          error: result.error,
          timestamp: Date.now()
        });
      }
      
      return result;
    } catch (error) {
      console.error('Error processing webhook:', error);
      
      // Rethrow as AppError
      throw error instanceof AppError ? error : new AppError('Failed to process webhook', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'WEBHOOK_PROCESSING_FAILED',
        cause: error
      });
    }
  }

  /**
   * Cancel a generation task
   * @param {string} runId - ComfyDeploy run ID
   * @returns {Promise<Object>} - Cancellation result
   */
  async cancelGeneration(runId) {
    try {
      // Cancel the run through ComfyDeploy
      return await this.client.cancelRun(runId);
    } catch (error) {
      // Rethrow as AppError
      throw error instanceof AppError ? error : new AppError('Failed to cancel generation', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'CANCEL_FAILED',
        cause: error
      });
    }
  }

  /**
   * Default implementation of getDeploymentInfo to use when custom one is not provided
   * @private
   * @param {string} type - Generation type (MAKE, I2I, etc.)
   * @returns {Object} - Deployment IDs and inputs for the type
   */
  _defaultGetDeploymentInfo(type) {
    console.log(`======= DEFAULT GET DEPLOYMENT INFO =======`);
    console.log(`Looking up deployment info for type: ${type}`);
    
    // Map of generation types to deployment IDs
    const typeToDeployment = this.GENERATION_TYPES || this._initGenerationTypes();
    
    // Get type info
    const typeInfo = typeToDeployment[type] || typeToDeployment['MAKE'];
    console.log(`Type info found: ${JSON.stringify(typeInfo)}`);
    
    // Return deployment IDs and inputs
    const result = {
      ids: [typeInfo.deploymentId || 'default_deployment_id'],
      inputs: typeInfo.inputTemplate || {}
    };
    
    console.log(`Returning deployment info: ${JSON.stringify(result)}`);
    console.log(`==========================================`);
    
    return result;
  }
  
  /**
   * Initialize and return generation types mapping
   * @private
   * @returns {Object} - Generation types mapping
   */
  _initGenerationTypes() {
    // Store the generation types mapping
    this.GENERATION_TYPES = {
      // Basic types
      MAKE: {
        deploymentId: process.env.COMFY_DEPLOY_SDXL_ID || 'sdxl_default',
        requiresPrompt: true,
        supportsControlNet: false,
        inputTemplate: {
          prompt: '',
          negative_prompt: '',
          width: 1024,
          height: 1024,
          steps: 30,
          cfg_scale: 7,
          sampler_name: 'DPM++ 2M Karras',
          checkpoint_name: 'stabilityAI/sdxl',
          batch_size: 1
        }
      },
      QUICKMAKE: {
        deploymentId: process.env.COMFY_DEPLOY_SDXL_ID || 'sdxl_default', // Using same deployment as MAKE
        requiresPrompt: true,
        supportsControlNet: false,
        inputTemplate: {
          prompt: '',
          negative_prompt: '',
          width: 1024,
          height: 1024,
          steps: 30,
          cfg_scale: 7,
          sampler_name: 'DPM++ 2M Karras',
          checkpoint_name: 'stabilityAI/sdxl',
          batch_size: 1
        }
      },
      I2I: {
        deploymentId: process.env.COMFY_DEPLOY_IMG2IMG_ID || 'img2img_default',
        requiresPrompt: true,
        requiresImage: true,
        inputTemplate: {
          prompt: '',
          negative_prompt: '',
          width: 1024,
          height: 1024,
          steps: 30,
          cfg_scale: 7,
          sampler_name: 'DPM++ 2M Karras',
          checkpoint_name: 'stabilityAI/sdxl',
          denoising_strength: 0.75,
          input_image: null
        }
      },
      MAKE_PLUS: {
        deploymentId: process.env.COMFY_DEPLOY_SDXL_PLUS_ID || 'sdxl_plus_default',
        requiresPrompt: true,
        supportsControlNet: true,
        supportsStyleTransfer: true,
        inputTemplate: {
          prompt: '',
          negative_prompt: '',
          width: 1024,
          height: 1024,
          steps: 30,
          cfg_scale: 7,
          sampler_name: 'DPM++ 2M Karras',
          checkpoint_name: 'dreamshaper/dreamshaper_8',
          enhance_prompt: true,
          high_quality: true,
          style_preset: 'enhance'
        }
      },
      INPAINT: {
        deploymentId: process.env.COMFY_DEPLOY_INPAINT_ID || 'inpaint_default',
        requiresPrompt: true,
        requiresImage: true,
        requiresMask: true,
        inputTemplate: {
          prompt: '',
          negative_prompt: '',
          steps: 30,
          cfg_scale: 7,
          sampler_name: 'DPM++ 2M Karras',
          checkpoint_name: 'stabilityAI/sdxl',
          input_image: null,
          mask_image: null,
          inpaint_fill: 'fill',
          mask_blur: 4,
          inpaint_full_res: true,
          inpaint_padding: 32
        }
      },
      UPSCALE: {
        deploymentId: process.env.COMFY_DEPLOY_UPSCALE_ID || 'upscale_default',
        requiresPrompt: false,
        requiresImage: true,
        inputTemplate: {
          input_image: null,
          upscaler: 'RealESRGAN_x4plus',
          scale: 2,
          tile_size: 512,
          tile_padding: 10
        }
      }
    };
    
    return this.GENERATION_TYPES;
  }

  /**
   * Validates if a generation type is supported and has required inputs
   * @param {string} type - Generation type
   * @param {Object} inputs - Generation inputs
   * @returns {boolean} - True if valid, throws error if not
   */
  validateGenerationType(type, inputs = {}) {
    // Get type info
    const typeInfo = (this.GENERATION_TYPES || this._initGenerationTypes())[type];
    
    // Check if type exists
    if (!typeInfo) {
      throw new AppError(`Unsupported generation type: ${type}`, {
        severity: ERROR_SEVERITY.ERROR,
        code: 'UNSUPPORTED_GENERATION_TYPE'
      });
    }
    
    // Check if required prompt is present
    if (typeInfo.requiresPrompt && (!inputs.prompt || inputs.prompt.trim() === '')) {
      throw new AppError('Prompt is required for this generation type', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'MISSING_REQUIRED_PROMPT'
      });
    }
    
    // Check if required image is present
    if (typeInfo.requiresImage && !inputs.input_image) {
      throw new AppError('Input image is required for this generation type', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'MISSING_REQUIRED_IMAGE'
      });
    }
    
    // Check if required mask is present
    if (typeInfo.requiresMask && !inputs.mask_image) {
      throw new AppError('Mask image is required for this generation type', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'MISSING_REQUIRED_MASK'
      });
    }
    
    return true;
  }

  /**
   * Get capabilities for a generation type
   * @param {string} type - Generation type
   * @returns {Object} - Type capabilities
   */
  getTypeCapabilities(type) {
    // Get type info
    const typeInfo = (this.GENERATION_TYPES || this._initGenerationTypes())[type];
    
    if (!typeInfo) {
      return {
        supported: false,
        capabilities: {}
      };
    }
    
    return {
      supported: true,
      capabilities: {
        requiresPrompt: typeInfo.requiresPrompt || false,
        requiresImage: typeInfo.requiresImage || false,
        requiresMask: typeInfo.requiresMask || false,
        supportsControlNet: typeInfo.supportsControlNet || false,
        supportsStyleTransfer: typeInfo.supportsStyleTransfer || false,
        deploymentId: typeInfo.deploymentId,
        inputTemplate: typeInfo.inputTemplate || {}
      }
    };
  }
  
  /**
   * Get all supported generation types
   * @returns {Array<string>} - List of supported generation types
   */
  getSupportedGenerationTypes() {
    return Object.keys(this.GENERATION_TYPES || this._initGenerationTypes());
  }

  /**
   * Set up event forwarding from client
   * @private
   */
  _setupEventForwarding() {
    const forwardedEvents = [
      'request:start',
      'request:success',
      'request:error',
      'status:update',
      'status:error',
      'generation:completed',
      'generation:failed',
      'generation:processing',
      'run:cancel',
      'run:cancelled',
      'run:cancel:error'
    ];
    
    forwardedEvents.forEach(eventName => {
      this.client.on(eventName, (data) => {
        this.emit(eventName, {
          ...data,
          source: 'comfydeploy'
        });
      });
    });
  }

  /**
   * Get available workflows
   * @returns {Array} - List of available workflows
   */
  getAvailableWorkflows() {
    try {
      // Return the workflows with minimal information needed by the frontend
      return this.workflows.map(workflow => ({
        id: workflow.name,
        name: workflow.name,
        description: workflow.description || workflow.name,
        parameters: workflow.inputs || {}
      }));
    } catch (error) {
      console.error('Error getting available workflows:', error);
      return [];
    }
  }
}

module.exports = ComfyDeployService; 