/**
 * ComfyDeploy Service Adapter
 * 
 * Adapts the ComfyDeployService to the ServiceAdapter interface.
 * Provides a standardized way to interact with ComfyDeploy through the internal API.
 */

const { ServiceAdapter } = require('./baseAdapter');
const { AppError } = require('../core/shared/errors/AppError');
const ComfyDeployService = require('./comfydeploy/ComfyDeployService');
const ComfyClient = require('./comfydeploy/ComfyClient');
const PromptBuilder = require('./comfydeploy/PromptBuilder');
const ComfyTaskMapper = require('./comfydeploy/ComfyTaskMapper');
const { getWorkflowService } = require('./comfydeploy/WorkflowService');

/**
 * ComfyDeploy service adapter
 * @extends ServiceAdapter
 */
class ComfyDeployAdapter extends ServiceAdapter {
  /**
   * Create a new ComfyDeploy service adapter
   * @param {Object} options - Adapter options
   */
  constructor(options = {}) {
    super({
      serviceName: options.serviceName || 'comfydeploy',
      config: options.config || {}
    });
    
    this.comfyService = null;
    this.taskResults = new Map(); // Store task results for later retrieval
    this.workflowService = options.workflowService || getWorkflowService({
      logger: this.logger
    });
    
    // Bind event handlers
    this._handleTaskCreated = this._handleTaskCreated.bind(this);
    this._handleGenerationCompleted = this._handleGenerationCompleted.bind(this);
    this._handleGenerationFailed = this._handleGenerationFailed.bind(this);
  }

  /**
   * Initialize the service adapter
   * @returns {Promise<void>}
   */
  async init() {
    this.logger.info('Initializing ComfyDeploy adapter', {
      service: this.serviceName
    });
    
    try {
      // Initialize workflow service if it hasn't been already
      if (!this.workflowService.lastRefresh) {
        await this.workflowService.initialize();
      }
      
      // Get workflows from the workflow service
      this.config.workflows = this.workflowService.getAllWorkflows();
      
      if (!this.config.workflows || this.config.workflows.length === 0) {
        this.logger.warn('No workflows loaded from service, using empty workflow array');
        this.config.workflows = [];
      } else {
        this.logger.info(`Loaded ${this.config.workflows.length} workflows from service`);
      }
      
      // Create ComfyDeploy service components
      const client = new ComfyClient({
        apiKey: this.config.apiKey || process.env.COMFY_DEPLOY_API_KEY,
        baseUrl: this.config.baseUrl || process.env.COMFY_DEPLOY_BASE_URL,
        webhookUrl: this.config.webhookUrl || process.env.COMFY_DEPLOY_WEBHOOK_URL
      });
      
      const promptBuilder = new PromptBuilder({
        loraTriggerHandler: this.config.loraTriggerHandler,
        getBasePromptByName: this.config.getBasePromptByName,
        defaultSettings: this.config.defaultSettings
      });
      
      const taskMapper = new ComfyTaskMapper();
      
      // Create the service
      this.comfyService = new ComfyDeployService({
        client,
        promptBuilder,
        taskMapper,
        workflows: this.config.workflows || [],
        config: this.config
      });
      
      // Attach event listeners
      this.comfyService.on('task:created', this._handleTaskCreated);
      this.comfyService.on('generation:completed', this._handleGenerationCompleted);
      this.comfyService.on('generation:failed', this._handleGenerationFailed);
      
      this.initialized = true;
      
      this.logger.info('ComfyDeploy adapter initialized', {
        service: this.serviceName
      });
    } catch (error) {
      this.logger.error('Failed to initialize ComfyDeploy adapter', {
        service: this.serviceName,
        error
      });
      
      throw new AppError('Failed to initialize ComfyDeploy adapter', {
        code: 'COMFYDEPLOY_INIT_ERROR',
        cause: error
      });
    }
  }

  /**
   * Shutdown the service adapter
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.logger.info('Shutting down ComfyDeploy adapter', {
      service: this.serviceName
    });
    
    // Remove event listeners
    if (this.comfyService) {
      this.comfyService.removeListener('task:created', this._handleTaskCreated);
      this.comfyService.removeListener('generation:completed', this._handleGenerationCompleted);
      this.comfyService.removeListener('generation:failed', this._handleGenerationFailed);
    }
    
    this.initialized = false;
    
    this.logger.info('ComfyDeploy adapter shut down', {
      service: this.serviceName
    });
  }

  /**
   * Execute a ComfyDeploy generation request
   * @param {Object} params - Service parameters
   * @param {string} params.type - Generation type (workflow)
   * @param {string} params.prompt - Generation prompt
   * @param {Object} params.settings - Generation settings
   * @param {Object} params.inputImages - Input images for img2img, inpaint, etc.
   * @param {Object} context - Execution context
   * @param {Object} context.user - User information
   * @returns {Promise<Object>} - Service response
   */
  async execute(params = {}, context = {}) {
    this._checkInitialized();
    
    // Check if workflows need to be reloaded
    await this._checkAndReloadWorkflows();
    
    this.logger.info('Executing ComfyDeploy request', {
      service: this.serviceName,
      type: params.type,
      userId: context.user?.id
    });
    
    try {
      // Validate parameters
      await this.validateParams(params);
      
      // Build user context for ComfyDeploy service
      const userContext = {
        userId: context.user?.id,
        username: context.user?.username || 'unknown',
        balance: context.user?.credits?.points || 0,
        basePrompt: params.basePrompt || '',
        ...context.userPreferences
      };
      
      // Execute generation request
      const result = await this.comfyService.generate(
        {
          userId: context.user?.id,
          type: params.type,
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          inputImages: params.inputImages,
          settings: params.settings
        },
        userContext,
        {
          taskId: params.taskId || `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          webhookData: {
            userId: context.user?.id,
            platform: context.platform?.type || 'api'
          }
        }
      );
      
      // Return the result
      return {
        taskId: result.taskId,
        runId: result.runId,
        status: result.status,
        message: `Generation request submitted for ${params.type}`,
        timeEstimate: this._getTimeEstimate(params.type),
        cost: await this.getEstimatedCost(params)
      };
    } catch (error) {
      const appError = this._handleError(error, params, context);
      throw appError;
    }
  }

  /**
   * Get the estimated cost of executing the service with the given parameters
   * @param {Object} params - Service parameters
   * @param {string} params.type - Generation type
   * @returns {Promise<number>} - Estimated cost in points
   */
  async getEstimatedCost(params = {}) {
    this._checkInitialized();
    
    // Cost mapping based on generation type
    const costMap = {
      DEFAULT: 10,
      FLUX: 15,
      QR: 20,
      ANIME: 10,
      I2I: 12,
      MAKE: 10,
      MAKE_PLUS: 15,
      INPAINT: 15,
      UPSCALE: 8,
      RMBG: 5,
      ANIM: 25,
      VIDEO: 30
    };
    
    // Get cost from map or use default
    const baseCost = costMap[params.type] || 10;
    
    // Apply multipliers based on settings
    let multiplier = 1.0;
    
    // Adjust cost based on resolution
    if (params.settings) {
      const area = (params.settings.width || 1024) * (params.settings.height || 1024);
      const standardArea = 1024 * 1024;
      
      if (area > standardArea) {
        multiplier *= Math.sqrt(area / standardArea);
      }
      
      // Adjust for batch size
      if (params.settings.batch && params.settings.batch > 1) {
        multiplier *= params.settings.batch;
      }
    }
    
    // Calculate total cost
    const totalCost = Math.ceil(baseCost * multiplier);
    
    this.logger.debug('Calculated cost for ComfyDeploy service', {
      service: this.serviceName,
      type: params.type,
      baseCost,
      multiplier,
      totalCost
    });
    
    return totalCost;
  }

  /**
   * Validate service parameters
   * @param {Object} params - Service parameters
   * @returns {Promise<boolean>} - True if parameters are valid
   * @throws {AppError} - If parameters are invalid
   */
  async validateParams(params = {}) {
    this._checkInitialized();
    
    // Check if workflows need to be reloaded
    await this._checkAndReloadWorkflows();
    
    const requiredParams = ['type'];
    const missingParams = requiredParams.filter(param => !params[param]);
    
    if (missingParams.length > 0) {
      throw new AppError(`Missing required parameters: ${missingParams.join(', ')}`, {
        code: 'MISSING_PARAMETERS'
      });
    }
    
    // Check that type is a valid workflow
    const validTypes = this.config.workflows.map(w => w.name);
    if (!validTypes.includes(params.type) && params.type !== 'DEFAULT') {
      throw new AppError(`Invalid generation type: ${params.type}`, {
        code: 'INVALID_GENERATION_TYPE',
        details: {
          validTypes
        }
      });
    }
    
    // Find the workflow to check required inputs
    const workflow = this.config.workflows.find(w => w.name === params.type);
    
    // Validate that prompt is provided for types that need it
    const promptlessTypes = ['UPSCALE', 'RMBG'];
    if (!promptlessTypes.includes(params.type) && !params.prompt) {
      throw new AppError('Prompt is required for this generation type', {
        code: 'MISSING_PROMPT'
      });
    }
    
    // Validate input images for types that need them
    const imgRequiredTypes = ['I2I', 'INPAINT', 'UPSCALE', 'RMBG'];
    if (imgRequiredTypes.includes(params.type) && (!params.inputImages || params.inputImages.length === 0)) {
      throw new AppError('Input images are required for this generation type', {
        code: 'MISSING_INPUT_IMAGES'
      });
    }
    
    return true;
  }

  /**
   * Check status of a generation task
   * @param {string} taskId - Task ID to check
   * @returns {Promise<Object>} - Task status
   */
  async checkStatus(taskId) {
    this._checkInitialized();
    
    // Check if we have the result in memory
    if (this.taskResults.has(taskId)) {
      return this.taskResults.get(taskId);
    }
    
    try {
      // Get the run ID associated with this task ID
      // This would typically be stored in a database
      // For now, we assume taskId = runId for simplicity
      const runId = taskId;
      
      // Check status through ComfyDeployService
      const status = await this.comfyService.checkStatus(runId);
      
      return {
        taskId,
        runId,
        status: status.status,
        progress: status.progress,
        isComplete: status.isComplete,
        result: status.result,
        error: status.error,
        timestamp: status.timestamp
      };
    } catch (error) {
      throw new AppError('Failed to check task status', {
        code: 'STATUS_CHECK_FAILED',
        cause: error
      });
    }
  }

  /**
   * Process a webhook from ComfyDeploy
   * @param {Object} webhookPayload - The webhook payload
   * @returns {Object} - Processed result
   */
  processWebhook(webhookPayload) {
    if (!this.initialized) {
      throw new AppError('ComfyDeploy adapter is not initialized', {
        code: 'SERVICE_NOT_INITIALIZED'
      });
    }
    
    try {
      const result = this.comfyService.processWebhook(webhookPayload);
      return result;
    } catch (error) {
      throw new AppError('Failed to process webhook', {
        code: 'WEBHOOK_PROCESSING_FAILED',
        cause: error
      });
    }
  }

  /**
   * Cancel a generation task
   * @param {string} taskId - The task ID to cancel
   * @returns {Promise<Object>} - Cancellation result
   */
  async cancelTask(taskId) {
    this._checkInitialized();
    
    try {
      // Get the run ID associated with this task ID
      // This would typically be stored in a database
      // For now, we assume taskId = runId for simplicity
      const runId = taskId;
      
      // Cancel through ComfyDeployService
      const result = await this.comfyService.cancelGeneration(runId);
      
      return {
        taskId,
        runId,
        status: 'cancelled',
        message: 'Generation cancelled successfully',
        timestamp: Date.now()
      };
    } catch (error) {
      throw new AppError('Failed to cancel task', {
        code: 'TASK_CANCELLATION_FAILED',
        cause: error
      });
    }
  }

  /**
   * Reload workflows from workflow service
   * @returns {Promise<boolean>} - True if reload was successful
   */
  async reloadWorkflows() {
    try {
      // Use the workflow service to refresh workflows
      const refreshed = await this.workflowService.refreshWorkflows();
      
      if (refreshed) {
        // Update adapter's workflows
        this.config.workflows = this.workflowService.getAllWorkflows();
        
        // Update service's workflows if available
        if (this.comfyService) {
          this.comfyService.workflows = this.config.workflows;
        }
        
        this.logger.info('Workflows reloaded successfully', {
          count: this.config.workflows.length
        });
      }
      
      return refreshed;
    } catch (error) {
      this.logger.error('Failed to reload workflows', { error });
      return false;
    }
  }

  /**
   * Get metadata about the service
   * @returns {Object} - Service metadata
   */
  getMetadata() {
    const baseMetadata = super.getMetadata();
    
    return {
      ...baseMetadata,
      availableWorkflows: this.config.workflows?.map(w => w.name) || [],
      workflowLastLoaded: this.workflowService.lastRefresh,
      capabilities: this.getCapabilities()
    };
  }

  /**
   * Get service capabilities
   * @returns {Object} - Service capabilities
   */
  getCapabilities() {
    return {
      maxConcurrentRequests: 5,
      supportsAsyncExecution: true,
      supportsBatchRequests: true,
      supportedGenerationTypes: this.config.workflows?.map(w => w.name) || [],
      supportsWebhooks: true
    };
  }

  /**
   * Check if workflows should be reloaded and do so if needed
   * @private
   * @returns {Promise<void>}
   */
  async _checkAndReloadWorkflows() {
    try {
      // Use the workflow service to check and refresh workflows
      const refreshed = await this.workflowService.checkAndRefreshIfNeeded();
      
      if (refreshed) {
        // Update adapter's workflows
        this.config.workflows = this.workflowService.getAllWorkflows();
        
        // Update service's workflows if available
        if (this.comfyService) {
          this.comfyService.workflows = this.config.workflows;
        }
      }
    } catch (error) {
      this.logger.error('Error checking workflow refresh', { error });
    }
  }

  /**
   * Handle task creation event
   * @private
   * @param {Object} task - Task data
   */
  _handleTaskCreated(task) {
    this.logger.info('Task created', {
      service: this.serviceName,
      taskId: task.taskId,
      userId: task.userId
    });
  }

  /**
   * Handle generation completed event
   * @private
   * @param {Object} data - Completion data
   */
  _handleGenerationCompleted(data) {
    this.logger.info('Generation completed', {
      service: this.serviceName,
      taskId: data.taskId,
      runId: data.run_id
    });
    
    // Store result
    this.taskResults.set(data.taskId, {
      taskId: data.taskId,
      runId: data.run_id,
      status: 'completed',
      isComplete: true,
      result: {
        outputs: data.outputs,
        timestamp: data.timestamp
      },
      timestamp: data.timestamp
    });
  }

  /**
   * Handle generation failed event
   * @private
   * @param {Object} data - Failure data
   */
  _handleGenerationFailed(data) {
    this.logger.error('Generation failed', {
      service: this.serviceName,
      taskId: data.taskId,
      runId: data.run_id,
      error: data.error
    });
    
    // Store result
    this.taskResults.set(data.taskId, {
      taskId: data.taskId,
      runId: data.run_id,
      status: 'failed',
      isComplete: true,
      error: data.error,
      timestamp: data.timestamp
    });
  }

  /**
   * Get estimated time based on generation type
   * @private
   * @param {string} type - Generation type
   * @returns {number} - Estimated time in seconds
   */
  _getTimeEstimate(type) {
    const timeMap = {
      DEFAULT: 30,
      FLUX: 45,
      QR: 60,
      ANIME: 30,
      I2I: 35,
      MAKE: 30,
      MAKE_PLUS: 45,
      INPAINT: 40,
      UPSCALE: 20,
      RMBG: 15,
      ANIM: 90,
      VIDEO: 120
    };
    
    return timeMap[type] || 30;
  }
}

module.exports = {
  ComfyDeployAdapter
}; 