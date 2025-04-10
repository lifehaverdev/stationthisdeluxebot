/**
 * ComfyClient
 * 
 * Handles API interactions with the ComfyDeploy service.
 * Wraps fetch/axios request logic with retry support and proper error handling.
 */

const { EventEmitter } = require('events');
const fetch = require('node-fetch');
const { AppError, ERROR_SEVERITY } = require('../../core/shared/errors');

/**
 * ComfyClient for interacting with ComfyDeploy API
 * @extends EventEmitter
 */
class ComfyClient extends EventEmitter {
  /**
   * Create a new ComfyClient
   * @param {Object} options - Client options
   * @param {string} options.apiKey - ComfyDeploy API key
   * @param {string} [options.baseUrl] - Base URL for API requests
   * @param {string} [options.webhookUrl] - Webhook URL for callbacks
   * @param {number} [options.maxRetries=3] - Maximum number of retries
   * @param {number} [options.retryDelay=2000] - Delay between retries in ms
   */
  constructor(options = {}) {
    super();
    
    this.apiKey = options.apiKey || process.env.COMFY_DEPLOY_API_KEY;
    this.baseUrl = options.baseUrl || 'https://www.comfydeploy.com/api';
    this.webhookUrl = options.webhookUrl || process.env.COMFY_DEPLOY_WEBHOOK_URL;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 2000;
    
    if (!this.apiKey) {
      throw new AppError('ComfyDeploy API key is required', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'COMFY_API_KEY_MISSING'
      });
    }
  }

  /**
   * Send generation request to ComfyDeploy
   * @param {Object} requestData - Request data
   * @param {string} requestData.deployment_id - Deployment ID
   * @param {Object} requestData.inputs - Input parameters
   * @param {Object} [options] - Request options
   * @param {string} [options.webhookUrl] - Override default webhook URL
   * @param {Object} [options.webhookData] - Additional data to include in webhook
   * @returns {Promise<Object>} - Response with run_id
   */
  async sendRequest(requestData, options = {}) {
    if (!requestData.deployment_id) {
      throw new AppError('Deployment ID is required', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'COMFY_DEPLOYMENT_ID_MISSING'
      });
    }
    
    if (!requestData.inputs || typeof requestData.inputs !== 'object') {
      throw new AppError('Inputs object is required', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'COMFY_INPUTS_MISSING'
      });
    }
    
    // Prepare the request payload
    const payload = {
      deployment_id: requestData.deployment_id,
      inputs: requestData.inputs,
      webhook_url: options.webhookUrl || this.webhookUrl
    };
    
    // Add webhook data if provided
    if (options.webhookData) {
      payload.webhook_data = options.webhookData;
    }
    
    try {
      // Emit request event
      this.emit('request:start', {
        deployment_id: requestData.deployment_id,
        timestamp: Date.now()
      });
      
      // Send the request with retry support
      const response = await this._fetchWithRetry(`${this.baseUrl}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(payload)
      });
      
      // Parse the response
      const data = await response.json();
      
      // Emit success event
      this.emit('request:success', {
        run_id: data.run_id,
        deployment_id: requestData.deployment_id,
        timestamp: Date.now()
      });
      
      return data;
    } catch (error) {
      // Emit error event
      this.emit('request:error', {
        error: error.message,
        deployment_id: requestData.deployment_id,
        timestamp: Date.now()
      });
      
      // Rethrow as AppError
      throw new AppError('Failed to send ComfyDeploy request', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'COMFY_REQUEST_FAILED',
        cause: error
      });
    }
  }

  /**
   * Get status of a generation run
   * @param {string} runId - Run ID
   * @returns {Promise<Object>} - Status and output information
   */
  async getStatus(runId) {
    if (!runId) {
      throw new AppError('Run ID is required', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'COMFY_RUN_ID_MISSING'
      });
    }
    
    try {
      // Emit status check event
      this.emit('status:check', {
        run_id: runId,
        timestamp: Date.now()
      });
      
      // Send the request with retry support
      const response = await this._fetchWithRetry(`${this.baseUrl}/run?run_id=${runId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      // Parse the response
      const data = await response.json();
      
      // Extract outputs
      const outputs = this._extractOutputs(data);
      
      // Emit status events
      this._emitStatusEvents(runId, data, outputs);
      
      return {
        run_id: runId,
        status: data.status,
        progress: data.progress,
        outputs,
        data // Include the full response data
      };
    } catch (error) {
      // Emit error event
      this.emit('status:error', {
        run_id: runId,
        error: error.message,
        timestamp: Date.now()
      });
      
      // Rethrow as AppError
      throw new AppError('Failed to check ComfyDeploy status', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'COMFY_STATUS_CHECK_FAILED',
        cause: error
      });
    }
  }

  /**
   * Cancel a generation run
   * @param {string} runId - Run ID to cancel
   * @returns {Promise<Object>} - Cancellation result
   */
  async cancelRun(runId) {
    if (!runId) {
      throw new AppError('Run ID is required', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'COMFY_RUN_ID_MISSING'
      });
    }
    
    try {
      // Emit cancel event
      this.emit('run:cancel', {
        run_id: runId,
        timestamp: Date.now()
      });
      
      // Send the request with retry support
      const response = await this._fetchWithRetry(`${this.baseUrl}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ run_id: runId })
      });
      
      // Parse the response
      const data = await response.json();
      
      // Emit cancel success event
      this.emit('run:cancelled', {
        run_id: runId,
        timestamp: Date.now()
      });
      
      return data;
    } catch (error) {
      // Emit error event
      this.emit('run:cancel:error', {
        run_id: runId,
        error: error.message,
        timestamp: Date.now()
      });
      
      // Rethrow as AppError
      throw new AppError('Failed to cancel ComfyDeploy run', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'COMFY_CANCEL_FAILED',
        cause: error
      });
    }
  }

  /**
   * Fetch with retry support
   * @private
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>} - Fetch response
   */
  async _fetchWithRetry(url, options) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);
        
        if (!response.ok) {
          // Try to get error text
          const errorText = await response.text();
          throw new Error(`HTTP error ${response.status}: ${errorText}`);
        }
        
        return response;
      } catch (error) {
        lastError = error;
        
        // If this is not the last attempt, wait before retrying
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }
    
    // If we get here, all attempts failed
    throw lastError;
  }

  /**
   * Extract outputs from response data
   * @private
   * @param {Object} data - Response data
   * @returns {Array<Object>} - Extracted outputs
   */
  _extractOutputs(data) {
    const outputs = [];
    
    if (data.outputs && data.outputs.length > 0) {
      data.outputs.forEach(outputItem => {
        // Check for images, gifs, and videos
        ['images', 'gifs', 'videos'].forEach(type => {
          if (outputItem.data && outputItem.data[type] && outputItem.data[type].length > 0) {
            outputItem.data[type].forEach(dataItem => {
              outputs.push({
                type: this._extractMediaType(dataItem.url),
                url: dataItem.url,
                metadata: dataItem.metadata || {}
              });
            });
          }
        });
      });
    }
    
    return outputs;
  }

  /**
   * Extract media type from URL
   * @private
   * @param {string} url - Media URL
   * @returns {string} - Media type
   */
  _extractMediaType(url) {
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

  /**
   * Emit status events based on status data
   * @private
   * @param {string} runId - Run ID
   * @param {Object} data - Status data
   * @param {Array<Object>} outputs - Extracted outputs
   */
  _emitStatusEvents(runId, data, outputs) {
    // Emit general status update
    this.emit('status:update', {
      run_id: runId,
      status: data.status,
      progress: data.progress,
      timestamp: Date.now()
    });
    
    // Emit specific events based on status
    if (data.status === 'success') {
      this.emit('generation:completed', {
        run_id: runId,
        outputs,
        timestamp: Date.now()
      });
    } else if (data.status === 'failed') {
      this.emit('generation:failed', {
        run_id: runId,
        error: data.error || 'Generation failed',
        timestamp: Date.now()
      });
    } else if (data.status === 'running' || data.status === 'processing') {
      this.emit('generation:processing', {
        run_id: runId,
        progress: data.progress,
        timestamp: Date.now()
      });
    }
  }
}

module.exports = ComfyClient; 