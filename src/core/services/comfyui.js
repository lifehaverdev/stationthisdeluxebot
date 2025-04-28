/**
 * ComfyUI Service
 * 
 * Handles interactions with ComfyUI API for image generation.
 * Extracted from functionality in utils/bot/queue.js and archive/src/core/generation
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const path = require('path');
const fs = require('fs');

// Constants
const DEFAULT_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY = 6000;
const COMFY_DEPLOY_API_URL = 'https://api.comfydeploy.com/api';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhook';

/**
 * ComfyUI Service Class
 */
class ComfyUIService {
  /**
   * Constructor for ComfyUI service
   * @param {Object} options - Service configuration options
   * @param {string} options.apiUrl - ComfyUI Deploy API URL
   * @param {string} options.apiKey - API key for ComfyDeploy
   * @param {number} options.timeout - Request timeout in milliseconds
   * @param {number} options.maxRetries - Maximum number of retry attempts
   * @param {number} options.retryDelay - Delay between retries in milliseconds
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || COMFY_DEPLOY_API_URL;
    this.apiKey = options.apiKey || process.env.COMFY_DEPLOY_API_KEY;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries || DEFAULT_RETRY_ATTEMPTS;
    this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
    this.activeRequests = new Map();
    
    // Validate API key
    if (!this.apiKey) {
      console.warn('ComfyUI Deploy API key not configured. Service will be inoperable.');
    }
  }

  /**
   * Submit a generation request to ComfyUI Deploy
   * @param {Object} options - The run options
   * @param {string} options.deploymentId - Deployment ID to use
   * @param {Object} options.inputs - Input parameters for the workflow
   * @returns {Promise<string>} - Returns the run ID if successful, or throws an error
   */
  async submitRequest(options = {}) {
    const { deploymentId, inputs = {} } = options;
    
    if (!deploymentId) {
      throw new Error('No deployment ID provided');
    }
    
    try {
      // Prepare the payload for ComfyUI Deploy
      const payload = {
        deployment_id: deploymentId,
        inputs: inputs
      };
      
      // Make the API request
      const response = await this._makeApiRequest('/run', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ComfyUI Deploy request failed with status: ${response.status}, message: ${errorText}`);
      }
      
      const data = await response.json();
      const runId = data.run_id;
      
      if (!runId) {
        throw new Error('No run_id returned from API');
      }
      
      // Store the request in active requests
      this.activeRequests.set(runId, {
        options,
        timestamp: Date.now(),
        status: 'processing'
      });
      
      console.log(`Submitted generation request with ID: ${runId}`);
      return runId;
    } catch (error) {
      console.error('Error submitting ComfyUI Deploy request:', error);
      throw error;
    }
  }

  /**
   * Check the status of a generation request
   * @param {string} runId - The run ID to check
   * @returns {Promise<Object>} - Returns status information
   */
  async checkStatus(runId) {
    try {
      if (!runId) {
        return { status: 'error', error: 'Invalid run ID' };
      }
      
      // Make the API request to get run status
      const response = await this._makeApiRequest(`/run?run_id=${runId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return { 
          status: 'error', 
          error: `Failed to check status: ${response.status}, message: ${errorText}` 
        };
      }
      
      const data = await response.json();
      
      // Update active request status if we're tracking it
      if (this.activeRequests.has(runId)) {
        const request = this.activeRequests.get(runId);
        request.status = data.status;
        this.activeRequests.set(runId, request);
      }
      
      // Map ComfyUI Deploy status to our status format
      let mappedStatus = data.status;
      let progress = 0;
      
      if (data.status === 'running' && data.progress) {
        progress = data.progress;
      } else if (data.status === 'success') {
        mappedStatus = 'completed';
      }
      
      return {
        status: mappedStatus,
        progress: progress,
        outputs: data.workflow_outputs || {},
        error: data.error || null,
        raw: data
      };
    } catch (error) {
      console.error(`Error checking status for run ${runId}:`, error);
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Get the results of a completed generation
   * @param {string} runId - The run ID to get results for
   * @returns {Promise<Object>} - Returns generation results
   */
  async getResults(runId) {
    try {
      const status = await this.checkStatus(runId);
      
      if (status.status === 'error') {
        return { success: false, error: status.error };
      }
      
      if (status.status !== 'completed' && status.status !== 'success') {
        return { 
          success: false, 
          error: 'Generation not completed',
          progress: status.progress || 0,
          status: status.status
        };
      }
      
      // Process and return the results
      return { 
        success: true,
        outputs: status.outputs,
        images: this._extractImageOutputs(status.outputs)
      };
    } catch (error) {
      console.error(`Error getting results for run ${runId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cancel a running request
   * @param {string} runId - The run ID to cancel
   * @returns {Promise<boolean>} - True if successful, false otherwise
   */
  async cancelRequest(runId) {
    try {
      // Currently ComfyUI Deploy doesn't have a direct cancel endpoint
      // We can mark it as cancelled in our tracking
      if (this.activeRequests.has(runId)) {
        const request = this.activeRequests.get(runId);
        request.status = 'cancelled';
        this.activeRequests.set(runId, request);
      }
      
      return true;
    } catch (error) {
      console.error(`Error cancelling run ${runId}:`, error);
      return false;
    }
  }

  /**
   * Get all active requests
   * @returns {Array<Object>} - List of active requests
   */
  getActiveRequests() {
    this._cleanupStaleRequests();
    
    return Array.from(this.activeRequests.entries()).map(([runId, request]) => {
      return {
        runId,
        status: request.status,
        timestamp: request.timestamp,
        age: Date.now() - request.timestamp
      };
    });
  }

  /**
   * Extract image outputs from the workflow outputs
   * @private
   * @param {Object} outputs - The workflow outputs
   * @returns {Array<string>} - Array of image URLs
   */
  _extractImageOutputs(outputs) {
    const images = [];
    
    // Process different output formats
    if (outputs && typeof outputs === 'object') {
      // Look for known image output keys
      const imageKeys = ['images', 'image', 'output_images', 'generated_images'];
      
      for (const key of Object.keys(outputs)) {
        if (imageKeys.includes(key) || key.includes('image')) {
          const value = outputs[key];
          
          if (Array.isArray(value)) {
            // Handle array of images
            for (const item of value) {
              if (typeof item === 'object' && item.url) {
                images.push(item.url);
              } else if (typeof item === 'string' && (item.startsWith('http') || item.startsWith('data:'))) {
                images.push(item);
              }
            }
          } else if (typeof value === 'object' && value.url) {
            // Handle single image object
            images.push(value.url);
          } else if (typeof value === 'string' && (value.startsWith('http') || value.startsWith('data:'))) {
            // Handle string URL
            images.push(value);
          }
        }
      }
    }
    
    return images;
  }

  /**
   * Make an API request with retry logic
   * @private
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>} - Fetch response
   */
  async _makeApiRequest(endpoint, options = {}) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const url = `${this.apiUrl}${endpoint}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        options.signal = options.signal || controller.signal;
        
        const response = await fetch(url, options);
        clearTimeout(timeoutId);
        
        return response;
      } catch (error) {
        lastError = error;
        console.warn(`API request attempt ${attempt} failed:`, error.message);
        
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }
    
    throw new Error(`API request failed after ${this.maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Remove stale requests from tracking
   * @private
   */
  _cleanupStaleRequests() {
    const now = Date.now();
    const maxAge = this.timeout * 2;
    
    for (const [runId, request] of this.activeRequests.entries()) {
      if (now - request.timestamp > maxAge) {
        this.activeRequests.delete(runId);
      }
    }
  }
}

module.exports = ComfyUIService; 