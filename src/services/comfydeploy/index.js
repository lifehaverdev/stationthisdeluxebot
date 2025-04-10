/**
 * ComfyDeploy Service
 * 
 * Provides a unified interface for generating content using ComfyDeploy
 */

const ComfyDeployClient = require('./client');
const ComfyDeployMapper = require('./mapper');
const config = require('./config');

/**
 * ComfyDeploy Service
 * Coordinates interactions with the ComfyDeploy API
 */
class ComfyDeployService {
  /**
   * @param {Object} options - Service options
   * @param {Array} options.workflows - Available workflow definitions
   * @param {string} [options.apiKey] - ComfyDeploy API key (falls back to env var)
   * @param {string} [options.webhookUrl] - Webhook URL for callbacks
   */
  constructor(options = {}) {
    this.client = new ComfyDeployClient({
      apiKey: options.apiKey,
      webhookUrl: options.webhookUrl || config.getWebhookUrl()
    });
    
    this.mapper = new ComfyDeployMapper();
    this.workflows = options.workflows || [];
    
    // Set up event forwarding
    this._setupEventForwarding();
  }

  /**
   * Generate content using internal generation request
   * @param {Object} params - Generation parameters
   * @param {string} params.type - Generation type (e.g., 'FLUX', 'MAKE')
   * @param {Object} params.request - Generation request
   * @param {string} params.taskId - Task ID (for tracking)
   * @returns {Promise<Object>} - Generation response with run_id
   */
  async generate(params) {
    try {
      const { type, request, taskId } = params;
      
      // Get deployment info for this type
      const deploymentInfo = config.getDeploymentInfo(type, this.workflows);
      
      // Map request to ComfyDeploy format
      const comfyRequest = this.mapper.mapToComfyDeployRequest(request, deploymentInfo);
      
      // Add webhook parameters if needed
      if (params.callbackUrl) {
        comfyRequest.webhook_url = params.callbackUrl;
      }
      
      // Store task ID in callback data for tracking
      if (comfyRequest.webhook_url) {
        comfyRequest.webhook_data = {
          taskId,
          userId: request.userId
        };
      }
      
      // Generate using ComfyDeploy client
      const response = await this.client.generate(comfyRequest);
      
      return {
        run_id: response.run_id,
        deploymentId: comfyRequest.deployment_id,
        status: 'queued'
      };
    } catch (error) {
      console.error('ComfyDeploy generation error:', error);
      throw error;
    }
  }

  /**
   * Check status of a generation run
   * @param {Object} params - Status check parameters
   * @param {string} params.run_id - ComfyDeploy run ID
   * @param {string} params.taskId - Internal task ID for tracking
   * @param {string} params.userId - User ID
   * @returns {Promise<Object>} - Status information
   */
  async checkStatus(params) {
    try {
      const { run_id, taskId, userId } = params;
      
      // Get status from ComfyDeploy
      const response = await this.client.getStatus(run_id);
      
      // Map to internal response format if complete
      if (response.status === 'success' || response.status === 'failed') {
        const mappedResponse = this.mapper.mapFromComfyDeployResponse(
          response, 
          taskId, 
          userId
        );
        
        return {
          run_id,
          status: response.status,
          progress: response.progress,
          complete: true,
          response: mappedResponse
        };
      }
      
      // Return progress information for in-progress tasks
      return {
        run_id,
        status: response.status,
        progress: response.progress,
        complete: false
      };
    } catch (error) {
      console.error('ComfyDeploy status check error:', error);
      throw error;
    }
  }

  /**
   * Build a generation request with appropriate defaults
   * @param {Object} options - Request options
   * @param {string} options.type - Generation type (e.g., 'FLUX')
   * @param {string} options.prompt - User prompt
   * @param {string} [options.negativePrompt] - Negative prompt
   * @param {Object} [options.settings] - Generation settings
   * @param {Object} [options.user] - User information
   * @returns {Object} - Prepared request
   */
  buildRequest(options) {
    const { type, prompt, user = {} } = options;
    
    // Get type-specific defaults
    const typeMappings = config.getTypeMappings();
    const typeDefaults = typeMappings[type] || {};
    
    // Build request with defaults
    const request = {
      userId: user.id || '',
      type: type,
      prompt: prompt || '',
      negativePrompt: options.negativePrompt || config.getDefaultNegativePrompt(),
      settings: {
        width: 1024,
        height: 1024,
        steps: typeDefaults.steps || 30,
        cfg: typeDefaults.cfg || 7,
        seed: options.settings?.seed || -1,
        batch: options.settings?.batch || 1,
        checkpoint: typeDefaults.checkpoint || 'zavychromaxl_v60',
        sampler: typeDefaults.sampler || 'DPM++ 2M Karras',
        ...options.settings
      },
      metadata: {
        username: user.username || '',
        ...options.metadata
      }
    };
    
    return request;
  }

  /**
   * Set up forwarding of client events
   * @private
   */
  _setupEventForwarding() {
    const eventTypes = [
      'generation:started',
      'generation:completed',
      'generation:failed',
      'generation:error',
      'status:update',
      'status:error'
    ];
    
    eventTypes.forEach(eventType => {
      this.client.on(eventType, (data) => {
        // Forward event with service identifier
        this.emit(eventType, {
          ...data,
          service: 'comfydeploy'
        });
      });
    });
  }

  /**
   * Emit an event (placeholder for EventEmitter implementation)
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  emit(event, data) {
    // This is just a placeholder
    // In a real implementation, this class would extend EventEmitter
    console.log(`Event: ${event}`, data);
  }
}

module.exports = ComfyDeployService; 