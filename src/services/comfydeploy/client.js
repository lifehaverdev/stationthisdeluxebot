/**
 * ComfyDeploy API client
 * 
 * Handles communication with the ComfyDeploy service for image generation.
 */

const fetch = require('node-fetch');
const { EventEmitter } = require('events');

class ComfyDeployClient extends EventEmitter {
  /**
   * Create a new ComfyDeploy client
   * @param {Object} options - Configuration options
   * @param {string} options.apiKey - ComfyDeploy API key
   * @param {string} [options.baseUrl='https://www.comfydeploy.com/api'] - Base URL for the API
   * @param {string} [options.webhookUrl] - Webhook URL for callbacks
   */
  constructor(options = {}) {
    super();
    
    this.apiKey = options.apiKey || process.env.COMFY_DEPLOY_API_KEY;
    this.baseUrl = options.baseUrl || 'https://www.comfydeploy.com/api';
    this.webhookUrl = options.webhookUrl;
    
    if (!this.apiKey) {
      throw new Error('ComfyDeploy API key is required');
    }
  }

  /**
   * Generate content using ComfyDeploy
   * @param {Object} params - Generation parameters
   * @param {string} params.deployment_id - ComfyDeploy deployment ID
   * @param {Object} params.inputs - Generation inputs
   * @param {string} [params.webhook_url] - Webhook URL to receive completion notifications
   * @returns {Promise<Object>} - Generation response with run_id
   */
  async generate(params) {
    try {
      const { deployment_id, inputs } = params;
      
      if (!deployment_id) {
        throw new Error('deployment_id is required');
      }
      
      if (!inputs || typeof inputs !== 'object') {
        throw new Error('inputs object is required');
      }
      
      const response = await fetch(`${this.baseUrl}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          deployment_id,
          inputs,
          webhook_url: params.webhook_url || this.webhookUrl
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ComfyDeploy API error (${response.status}): ${errorText}`);
      }
      
      const data = await response.json();
      
      this.emit('generation:started', {
        run_id: data.run_id,
        deployment_id,
        timestamp: Date.now()
      });
      
      return data;
    } catch (error) {
      this.emit('generation:error', {
        error: error.message,
        timestamp: Date.now()
      });
      throw error;
    }
  }

  /**
   * Get the status of a generation run
   * @param {string} run_id - ComfyDeploy run ID
   * @returns {Promise<Object>} - Run status information
   */
  async getStatus(run_id) {
    try {
      if (!run_id) {
        throw new Error('run_id is required');
      }
      
      const response = await fetch(`${this.baseUrl}/run?run_id=${run_id}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ComfyDeploy API error (${response.status}): ${errorText}`);
      }
      
      const data = await response.json();
      
      // Extract output URLs from the response
      const output = this._extractOutputs(data);
      
      // Emit events based on status
      this._emitStatusEvents(run_id, data, output);
      
      return {
        ...data,
        output
      };
    } catch (error) {
      this.emit('status:error', {
        run_id,
        error: error.message,
        timestamp: Date.now()
      });
      throw error;
    }
  }

  /**
   * Extract output URLs from the ComfyDeploy response
   * @private
   * @param {Object} data - ComfyDeploy response data
   * @returns {Object} - Extracted output information
   */
  _extractOutputs(data) {
    const output = {
      progress: data.progress,
      status: data.status,
      outputs: []
    };
    
    if (data.outputs && data.outputs.length > 0) {
      data.outputs.forEach(outputItem => {
        // Check for images, gifs, and videos
        ['images', 'gifs', 'videos'].forEach(type => {
          if (outputItem.data && outputItem.data[type] && outputItem.data[type].length > 0) {
            outputItem.data[type].forEach(mediaItem => {
              output.outputs.push({
                type: this._getMediaType(mediaItem.url),
                url: mediaItem.url,
                metadata: mediaItem.metadata || {}
              });
            });
          }
        });
      });
    }
    
    return output;
  }

  /**
   * Determine media type from URL
   * @private
   * @param {string} url - Media URL
   * @returns {string} - Media type (image, gif, video)
   */
  _getMediaType(url) {
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
   * Emit events based on status
   * @private
   * @param {string} run_id - ComfyDeploy run ID
   * @param {Object} data - ComfyDeploy response data
   * @param {Object} output - Extracted output data
   */
  _emitStatusEvents(run_id, data, output) {
    this.emit('status:update', {
      run_id,
      status: data.status,
      progress: data.progress,
      timestamp: Date.now()
    });
    
    // Emit specific events based on status
    if (data.status === 'success') {
      this.emit('generation:completed', {
        run_id,
        outputs: output.outputs,
        timestamp: Date.now()
      });
    } else if (data.status === 'failed') {
      this.emit('generation:failed', {
        run_id,
        error: data.error || 'Generation failed',
        timestamp: Date.now()
      });
    }
  }
}

module.exports = ComfyDeployClient; 