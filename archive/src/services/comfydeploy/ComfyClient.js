/**
 * ComfyClient
 * 
 * Handles API interactions with the ComfyDeploy service.
 * Wraps fetch/axios request logic with retry support and proper error handling.
 */

const { EventEmitter } = require('events');
// Replace node-fetch with a conditional import for native fetch or a simple fetch function
// const fetch = require('node-fetch');
// Use native fetch if available, otherwise create a minimal implementation
const fetch = (...args) => {
  // If we're in Node 18+ or a browser, use native fetch
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(...args);
  }
  
  // Very simple implementation for older Node versions - for testing only
  // In production, you should use a proper polyfill or update to Node 18+
  console.warn('Using fetch polyfill - consider upgrading to Node 18+ or installing node-fetch@2');
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error('Fetch is not available in this environment. Please use Node 18+ or install node-fetch@2'));
    }, 10);
  });
};

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
    
    // Create a filtered copy of the inputs with only primitive values
    const filteredInputs = {};
    Object.entries(requestData.inputs).forEach(([key, value]) => {
      // Only keep strings and numbers
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        filteredInputs[key] = value;
      } else {
        // Log objects that are being filtered out
        console.log(`Filtering out non-primitive parameter: ${key} (${typeof value})`);
      }
    });
    
    // Prepare the request payload with filtered inputs
    const payload = {
      deployment_id: requestData.deployment_id,
      inputs: filteredInputs,
      webhook_url: options.webhookUrl || this.webhookUrl
    };
    
    // Add webhook data if provided
    if (options.webhookData) {
      payload.webhook_data = options.webhookData;
    }
    
    // Add detailed logging for debugging
    console.log('======= COMFY API REQUEST =======');
    console.log(`Deployment ID: ${payload.deployment_id}`);
    console.log(`Deployment ID Type: ${typeof payload.deployment_id}`);
    console.log(`Is Valid UUID? ${/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.deployment_id)}`);
    console.log('=================================');
    
    console.log('FINAL REQUEST TO COMFYDEPLOY API:', {
      deployment_id: payload.deployment_id,
      inputs: payload.inputs,
      originalInputs: requestData.originalPrompt?.settings?.inputs || {},
      inputDecisions: requestData.inputDecisions || {}
    });
    
    // Full pre-flight check of the payload for any null/undefined values
    console.log('COMFY CLIENT PRE-FLIGHT CHECK:', {
      input_keys: Object.keys(payload.inputs),
      null_values: Object.entries(payload.inputs)
        .filter(([k, v]) => v === null || v === undefined)
        .map(([k]) => k),
      empty_strings: Object.entries(payload.inputs)
        .filter(([k, v]) => v === '')
        .map(([k]) => k),
      value_types: Object.entries(payload.inputs)
        .map(([k, v]) => `${k}: ${typeof v}${Array.isArray(v) ? ' (array)' : ''}`)
    });
    
    // PARAMETER TRACING: Log the actual API request being sent with focus on parameter structure
    console.log('PARAMETER TRACE [11. API Request]:', {
      endpoint: `${this.baseUrl}/run`,
      deployment_id: payload.deployment_id,
      inputCount: Object.keys(payload.inputs || {}).length,
      inputPrefixCount: Object.keys(payload.inputs || {}).filter(k => k.startsWith('input_')).length,
      nonPrefixedCount: Object.keys(payload.inputs || {}).filter(k => !k.startsWith('input_')).length,
      apiExpectsInputPrefix: true, // Set based on ComfyDeploy API requirements
      sampleInputs: Object.keys(payload.inputs || {}).slice(0, 5),
      filteredOutCount: Object.keys(requestData.inputs).length - Object.keys(filteredInputs).length
    });
    
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
          Authorization: this.apiKey ? `Bearer ${this.apiKey}` : undefined
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
      
      // PARAMETER TRACING: Log the response
      console.log('PARAMETER TRACE [12. API Response]:', {
        status: 'success',
        run_id: data.run_id,
        estimated_completion: data.estimated_completion
      });
      
      return data;
    } catch (error) {
      // PARAMETER TRACING: Log the error
      console.log('PARAMETER TRACE [12. API Error]:', {
        status: 'error',
        message: error.message,
        response: error.response?.data || error.responseText
      });
      
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
  async getRunStatus(runId) {
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
      
      // Extract outputs if available
      let outputs = null;
      if (data.status === 'success' && data.outputs) {
        outputs = this._extractOutputs(data);
      }
      
      // Emit status events based on run state
      this._emitStatusEvents(runId, data, outputs);
      
      return {
        run_id: runId,
        status: data.status,
        progress: data.progress || 0,
        outputs,
        raw: data // Include the full response data for debugging/advanced usage
      };
    } catch (error) {
      // Emit error event
      this.emit('status:error', {
        run_id: runId,
        error: error.message,
        timestamp: Date.now()
      });
      
      // Transform to AppError with detailed information
      throw new AppError(`Failed to check status for run ${runId}`, {
        severity: ERROR_SEVERITY.ERROR,
        code: 'COMFY_STATUS_CHECK_FAILED',
        cause: error,
        context: { runId }
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
      
      // Emit success event
      this.emit('run:cancelled', {
        run_id: runId,
        timestamp: Date.now()
      });
      
      return {
        run_id: runId,
        status: 'cancelled',
        message: data.message || 'Generation cancelled successfully',
        timestamp: Date.now()
      };
    } catch (error) {
      // Emit error event
      this.emit('cancel:error', {
        run_id: runId,
        error: error.message,
        timestamp: Date.now()
      });
      
      // Transform to AppError with detailed information
      throw new AppError(`Failed to cancel run ${runId}`, {
        severity: ERROR_SEVERITY.ERROR,
        code: 'COMFY_CANCEL_FAILED',
        cause: error,
        context: { runId }
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

  /**
   * Test connection to the ComfyDeploy API
   * @returns {Promise<boolean>} - True if connection is successful
   */
  async connect() {
    try {
      // In development mode with a dev-key, just log a message and return success
      if (process.env.NODE_ENV === 'development' && this.apiKey === 'dev-key') {
        console.log('🧪 Running in development mode with mock ComfyDeploy API');
        this.emit('connection:success', {
          timestamp: Date.now(),
          mock: true
        });
        return true;
      }
      
      // Emit connection attempt event
      this.emit('connection:attempt', {
        timestamp: Date.now()
      });
      
      // Send a simple HEAD request to the API
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'HEAD',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      if (response.ok) {
        // Emit connection success event
        this.emit('connection:success', {
          timestamp: Date.now()
        });
        
        return true;
      } else {
        throw new Error(`API returned ${response.status}`);
      }
    } catch (error) {
      // Emit connection error event
      this.emit('connection:error', {
        error: error.message,
        timestamp: Date.now()
      });
      
      // In development mode, don't throw to allow fallback to mock workflows
      if (process.env.NODE_ENV === 'development') {
        console.warn('Failed to connect to ComfyDeploy API (using mock workflows):', error.message);
        return false;
      }
      
      // In production, throw as AppError
      throw new AppError('Failed to connect to ComfyDeploy API', {
        severity: ERROR_SEVERITY.ERROR,
        code: 'COMFY_CONNECTION_FAILED',
        cause: error
      });
    }
  }
}

module.exports = ComfyClient; 