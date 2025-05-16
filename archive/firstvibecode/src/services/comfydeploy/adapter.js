/**
 * ComfyDeploy Service Adapter
 * 
 * Adapts the ComfyDeployService to the ServiceAdapter interface
 * for use with the ServiceRegistry.
 */

const { ServiceAdapter } = require('../baseAdapter');
const { ComfyDeployService } = require('./service');
const { getWorkflowService } = require('./WorkflowService');
const { GenerationRequest } = require('../../core/generation/models');

/**
 * ComfyDeploy Service Adapter
 * @extends ServiceAdapter
 */
class ComfyDeployAdapter extends ServiceAdapter {
  /**
   * Create a new ComfyDeploy service adapter
   * @param {Object} options - Adapter options
   * @param {ComfyDeployService} [options.service] - Existing ComfyDeploy service instance
   * @param {Object} [options.config] - Service configuration
   */
  constructor(options = {}) {
    super({
      serviceName: 'comfydeploy', // Important: lowercase name for consistency
      config: options.config || {}
    });

    // Use provided service or create new one
    this.service = options.service || null;
    this.workflowService = null;
  }

  /**
   * Initialize the adapter
   * @returns {Promise<void>}
   */
  async init() {
    this.logger.info('Initializing ComfyDeploy adapter');

    try {
      // Get workflowService first
      this.workflowService = getWorkflowService();
      
      if (this.workflowService && (!this.workflowService.workflows || this.workflowService.workflows.length === 0)) {
        this.logger.info('Initializing WorkflowService to load workflows');
        await this.workflowService.initialize();
        this.logger.info('WorkflowService initialized, workflows loaded:', {
          count: this.workflowService.workflows?.length || 0
        });
      }

      // Create service if not provided
      if (!this.service) {
        const workflowsFromService = this.workflowService?.getAllWorkflows() || [];
        this.logger.info('Creating ComfyDeployService with workflows from WorkflowService', {
          count: workflowsFromService.length,
          workflowNames: workflowsFromService.map(w => w.name).join(', ')
        });
        
        this.service = new ComfyDeployService({
          config: this.config,
          logger: this.logger,
          workflows: workflowsFromService
        });

        // Initialize the service
        await this.service.initialize();
      }

      this.initialized = true;
      this.logger.info('ComfyDeploy adapter initialized');
    } catch (error) {
      this.logger.error('Failed to initialize ComfyDeploy adapter', { error });
      throw error;
    }
  }

  /**
   * Execute the ComfyDeploy service
   * @param {Object} params - Service parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Service response
   */
  async execute(params = {}, context = {}) {
    this._checkInitialized();

    // Log the execution request
    this.logger.debug('Executing ComfyDeploy service', {
      type: params.type,
      userId: context.userId || (context.user && context.user.id)
    });

    try {
      // Create a generation request
      const request = {
        type: params.type,
        prompt: params.prompt || '',
        negativePrompt: params.negativePrompt || '',
        settings: params.settings || {},
        inputImages: params.inputImages || {},
        userId: context.userId || (context.user && context.user.id)
      };

      // Generate the image
      const result = await this.service.generate(request, context);

      return {
        status: 'ok',
        result
      };
    } catch (error) {
      this.logger.error('ComfyDeploy execution failed', { 
        error,
        type: params.type
      });
      
      throw this._handleError(error, params, context);
    }
  }

  /**
   * Get the estimated cost of executing the service
   * @param {Object} params - Service parameters
   * @returns {Promise<number>} Estimated cost
   */
  async getEstimatedCost(params = {}) {
    this._checkInitialized();

    // Default cost
    let cost = 100;

    // Higher cost for specific models
    if (params.type === 'MS3.3') {
      cost = 1000;
    } else if (params.type === 'MS3') {
      cost = 500;
    }

    return cost;
  }

  /**
   * Validate service parameters
   * @param {Object} params - Service parameters
   * @returns {Promise<boolean>} True if parameters are valid
   */
  async validateParams(params = {}) {
    this._checkInitialized();

    // Check for required parameters
    if (!params.type) {
      throw new Error('type parameter is required');
    }

    // Check if workflow exists (if workflow service is available)
    if (this.workflowService) {
      const workflow = this.workflowService.getWorkflowByName(params.type);
      if (!workflow) {
        // Try to refresh workflows
        await this.workflowService.refreshWorkflows();
        
        // Check again
        const refreshedWorkflow = this.workflowService.getWorkflowByName(params.type);
        if (!refreshedWorkflow) {
          throw new Error(`Workflow '${params.type}' not found`);
        }
      }
    }

    return true;
  }

  /**
   * Get metadata about the service
   * @returns {Object} Service metadata
   */
  getMetadata() {
    const metadata = {
      name: this.serviceName,
      initialized: this.initialized,
      workflows: this.workflowService ? 
        (this.workflowService.getAllWorkflows() || []).length : 
        (this.service && this.service.workflows ? this.service.workflows.length : 0)
    };

    return metadata;
  }

  /**
   * Shutdown the adapter
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this.initialized && this.service) {
      this.logger.info('Shutting down ComfyDeploy adapter');
      
      // No specific shutdown method on ComfyDeployService currently
      this.initialized = false;
      
      this.logger.info('ComfyDeploy adapter shut down');
    }
  }
}

module.exports = {
  ComfyDeployAdapter
}; 