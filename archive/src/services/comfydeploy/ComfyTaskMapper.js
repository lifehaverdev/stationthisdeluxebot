/**
 * ComfyTaskMapper
 * 
 * Maps webhook payloads from ComfyDeploy to internal task results.
 * Handles conversion of API-specific data to platform-agnostic formats.
 */

const { GenerationResponse } = require('../../core/generation/models');

/**
 * ComfyTaskMapper for mapping webhook payloads
 */
class ComfyTaskMapper {
  /**
   * Create a new ComfyTaskMapper
   * @param {Object} options - Mapper options
   */
  constructor(options = {}) {
    // Initialize with any needed configuration
    this.options = options;
  }

  /**
   * Map webhook payload to internal task result
   * @param {Object} webhookPayload - Raw webhook payload from ComfyDeploy
   * @param {Object} taskContext - Additional task context
   * @returns {Object} - Internal task result
   */
  mapWebhookToTaskResult(webhookPayload, taskContext = {}) {
    // Extract basic information
    const { status, run_id, outputs = [], webhook_data = {} } = webhookPayload;
    
    // Extract task and user IDs from webhook_data if available
    const taskId = webhook_data.taskId || taskContext.taskId || run_id;
    const userId = webhook_data.userId || taskContext.userId || '';
    
    // Determine if the generation was successful
    const success = status === 'success';
    
    // Extract error message if failed
    const error = webhookPayload.error || '';
    
    // Extract output URLs and metadata
    const outputResults = this._extractOutputs(webhookPayload);
    
    // Create response object
    return new GenerationResponse({
      requestId: taskId,
      userId: userId,
      outputs: outputResults.urls,
      success: success,
      error: error,
      metadata: {
        run_id,
        types: outputResults.types,
        processingTime: webhookPayload.processing_time || 0,
        ...outputResults.metadata
      },
      completedAt: new Date()
    });
  }

  /**
   * Map status response to internal task status
   * @param {Object} statusResponse - Status response from ComfyClient
   * @param {Object} taskContext - Additional task context
   * @returns {Object} - Internal task status object
   */
  mapStatusToTaskStatus(statusResponse, taskContext = {}) {
    // Extract basic information
    const { run_id, status, progress, outputs = [] } = statusResponse;
    
    // Extract task ID from context or default to run_id
    const taskId = taskContext.taskId || run_id;
    
    // Map status to standardized status
    const mappedStatus = this._mapStatusCode(status);
    
    // Determine if task is complete
    const isComplete = ['completed', 'failed', 'cancelled'].includes(mappedStatus);
    
    // If complete and successful, extract outputs
    let result = null;
    if (isComplete && mappedStatus === 'completed') {
      const outputResults = this._extractOutputs(statusResponse);
      
      result = {
        outputs: outputResults.urls,
        metadata: {
          types: outputResults.types,
          ...outputResults.metadata
        }
      };
    }
    
    // Create status object
    return {
      taskId,
      run_id,
      status: mappedStatus,
      progress: progress * 100, // Convert to percentage
      isComplete,
      result,
      error: statusResponse.error || null,
      timestamp: Date.now()
    };
  }

  /**
   * Map ComfyDeploy request to internal generation task
   * @param {Object} requestData - Request data sent to ComfyDeploy
   * @param {Object} responseData - Response data from ComfyDeploy
   * @param {Object} context - Additional context
   * @returns {Object} - Internal task object
   */
  mapRequestToTask(requestData, responseData, context = {}) {
    return {
      taskId: context.taskId || responseData.run_id,
      userId: context.userId || requestData.originalPrompt?.userId || '',
      type: requestData.originalPrompt?.type || 'DEFAULT',
      run_id: responseData.run_id,
      status: 'queued',
      prompt: requestData.originalPrompt?.prompt || '',
      requestPayload: {
        deployment_id: requestData.deployment_id,
        inputs: requestData.inputs
      },
      createdAt: new Date(),
      metadata: {
        userContext: context.userContext || {},
        webhookData: context.webhookData || {}
      }
    };
  }

  /**
   * Extract output URLs and metadata from ComfyDeploy response
   * @private
   * @param {Object} response - ComfyDeploy response
   * @returns {Object} - Extracted outputs
   */
  _extractOutputs(response) {
    const result = {
      urls: [],
      types: [],
      metadata: {}
    };
    
    // Function to process output items
    const processOutputs = (outputs) => {
      if (!outputs || !Array.isArray(outputs)) return;
      
      outputs.forEach(output => {
        // Add URL to results
        if (output.url) {
          result.urls.push(output.url);
          result.types.push(output.type || this._guessTypeFromUrl(output.url));
        }
        
        // Add metadata if available
        if (output.metadata) {
          Object.entries(output.metadata).forEach(([key, value]) => {
            // Collect all seeds if available
            if (key === 'seed') {
              if (!result.metadata.seeds) {
                result.metadata.seeds = [];
              }
              result.metadata.seeds.push(value);
            } else {
              result.metadata[key] = value;
            }
          });
        }
      });
    };
    
    // Check if the outputs are directly in the response
    if (response.outputs && Array.isArray(response.outputs)) {
      processOutputs(response.outputs);
    } 
    // Check for nested outputs structure from ComfyDeploy API
    else if (response.data && response.data.outputs) {
      processOutputs(response.data.outputs);
    }
    
    return result;
  }

  /**
   * Map ComfyDeploy status code to standardized status
   * @private
   * @param {string} status - ComfyDeploy status
   * @returns {string} - Standardized status
   */
  _mapStatusCode(status) {
    const statusMap = {
      'success': 'completed',
      'failed': 'failed',
      'running': 'processing',
      'processing': 'processing',
      'queued': 'queued',
      'not-started': 'queued',
      'in_progress': 'processing',
      'starting': 'processing',
      'uploading': 'processing',
      'started': 'processing',
      'cancelled': 'cancelled',
      'error': 'failed',
      'timeout': 'failed'
    };
    
    return statusMap[status] || 'unknown';
  }

  /**
   * Guess media type from URL
   * @private
   * @param {string} url - Media URL
   * @returns {string} - Media type
   */
  _guessTypeFromUrl(url) {
    const extension = url.split('.').pop().toLowerCase();
    
    if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) {
      return 'image';
    } else if (extension === 'gif') {
      return 'gif';
    } else if (['mp4', 'avi', 'mov', 'webm'].includes(extension)) {
      return 'video';
    } else {
      return 'unknown';
    }
  }
}

module.exports = ComfyTaskMapper; 