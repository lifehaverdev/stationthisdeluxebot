const DEBUG_LOGGING_ENABLED = false; // Set to true to enable detailed logging within ComfyUIService

/**
 * ComfyUI Service
 * 
 * Handles interactions with ComfyUI Deploy API for image generation.
 * This is the authoritative source for all ComfyUI Deploy interactions.
 * 
 * UPDATED: Based on API testing, endpoints should use the '/api/' prefix.
 */
// Add this near the other require statements
const WorkflowsService = require('./workflows');
const { getMachineForWorkflow } = require('./workflowUtils');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const path = require('path');
const fs = require('fs');

// Import configuration
const { 
  DEFAULT_TIMEOUT, 
  DEFAULT_RETRY_ATTEMPTS, 
  DEFAULT_RETRY_DELAY, 
  COMFY_DEPLOY_API_URL, 
  WEBHOOK_URL,
  API_ENDPOINTS
} = require('./config');

// Import file manager utilities
const { 
    getUploadUrl: getUploadUrlAction,
    uploadFile: uploadFileAction 
} = require('./fileManager');

// Import run manager utilities
const {
    submitRequest: submitRequestAction,
    checkStatus: checkStatusAction,
    getResults: getResultsAction,
    cancelRequest: cancelRequestAction
} = require('./runManager');

// Import resource fetcher utilities
const {
    getDeployments: getDeploymentsAction,
    getWorkflows: getWorkflowsAction,
    getMachines: getMachinesAction,
    getWorkflowVersion: getWorkflowVersionAction,
    getWorkflowDetails: getWorkflowDetailsAction,
    getWorkflowContent: getWorkflowContentAction
} = require('./resourceFetcher');

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
   * @param {boolean} options.useWebhooks - Whether to use webhooks for status updates
   * @param {string} options.webhookUrl - Webhook URL for receiving status updates
   * @param {Function} options.logger - Logger function (optional)
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || COMFY_DEPLOY_API_URL;
    this.apiKey = options.apiKey || process.env.COMFY_DEPLOY_API_KEY;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries || DEFAULT_RETRY_ATTEMPTS;
    this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
    this.useWebhooks = options.useWebhooks !== undefined ? options.useWebhooks : true;
    this.webhookUrl = options.webhookUrl || WEBHOOK_URL;
    
    // Ensure logger is an object with expected methods
    const defaultLogger = {
      info: console.log,
      warn: console.warn,
      error: console.error,
      debug: console.debug || console.log // Fallback for debug
    };
    this.logger = (options.logger && typeof options.logger === 'object' && 
                   typeof options.logger.info === 'function') 
                  ? options.logger 
                  : defaultLogger;
    
    // Validate API key (use logger.warn)
    if (!this.apiKey) {
      this.logger.warn('ComfyUI Deploy API key not configured. Service will be inoperable.');
    }
  }

  /**
   * Submit a workflow execution request
   * 
   * @param {Object} options - Request options
   * @param {string} options.deploymentId - Deployment ID
   * @param {string} options.machineId - Machine ID (optional, will be determined from workflow if not provided)
   * @param {Object} options.inputs - Workflow inputs
   * @param {Object} options.workflowName - Name of the workflow (optional, for machine routing)
   * @param {string} options.webhookUrl - Webhook URL for status notifications (optional)
   * @returns {Promise<string>} - Run ID
   */
  async submitRequest(options = {}) {
    const instanceData = {
        apiUrl: this.apiUrl,
        apiKey: this.apiKey,
        logger: this.logger,
        API_ENDPOINTS: API_ENDPOINTS, // Pass the endpoints object
        WorkflowsService: WorkflowsService, // Pass the class constructor
        getMachineForWorkflow: getMachineForWorkflow // Pass the function
    };
    return submitRequestAction(instanceData, options);
  }

  /**
   * Check the status of a generation request
   * @param {string} runId - The run ID to check
   * @returns {Promise<Object>} - Returns status information
   */
  async checkStatus(runId) {
    const instanceData = {
        apiUrl: this.apiUrl,
        apiKey: this.apiKey,
        logger: this.logger,
        API_ENDPOINTS: API_ENDPOINTS
    };
    return checkStatusAction(instanceData, runId);
  }

  /**
   * Get the results of a completed generation
   * @param {string} runId - The run ID to get results for
   * @returns {Promise<Object>} - Returns generation results
   */
  async getResults(runId) {
    const instanceData = {
        apiUrl: this.apiUrl,
        apiKey: this.apiKey,
        logger: this.logger,
        API_ENDPOINTS: API_ENDPOINTS
    };
    return getResultsAction(instanceData, runId);
  }

  /**
   * Cancel a running generation request
   * @param {string} runId - The run ID to cancel
   * @returns {Promise<Object>} - Returns cancellation result
   */
  async cancelRequest(runId) {
    const instanceData = {
        apiUrl: this.apiUrl,
        apiKey: this.apiKey,
        logger: this.logger,
        API_ENDPOINTS: API_ENDPOINTS
    };
    return cancelRequestAction(instanceData, runId);
  }

  /**
   * Get all deployments available to the current user
   * @returns {Promise<Array>} - Returns array of deployments
   */
  async getDeployments() {
    // Call the extracted action
    const instanceData = {
        logger: this.logger,
        API_ENDPOINTS: API_ENDPOINTS,
        _makeApiRequest: this._makeApiRequest.bind(this) // Pass bound method
    };
    return getDeploymentsAction(instanceData);
  }

  /**
   * Get list of workflows from ComfyUI Deploy API
   * @returns {Promise<Array>} - List of workflows
   */
  async getWorkflows() {
    // Call the extracted action
    const instanceData = {
        logger: this.logger,
        API_ENDPOINTS: API_ENDPOINTS,
        _makeApiRequest: this._makeApiRequest.bind(this) // Pass bound method
    };
    return getWorkflowsAction(instanceData);
  }

  /**
   * Get list of machines available in ComfyUI Deploy
   * @returns {Promise<Array>} - List of machines
   */
  async getMachines() {
    // Call the extracted action
    const instanceData = {
        logger: this.logger,
        API_ENDPOINTS: API_ENDPOINTS,
        _makeApiRequest: this._makeApiRequest.bind(this) // Pass bound method
    };
    return getMachinesAction(instanceData);
  }

  /**
   * Get a pre-signed URL for file uploads
   * @param {Object} options - Options for getting upload URL
   * @returns {Promise<Object>} - Upload URL and file information
   */
  async getUploadUrl(options = {}) {
    // Call the extracted action, passing necessary instance data
    const instanceData = { 
        apiUrl: this.apiUrl, 
        apiKey: this.apiKey, 
        logger: this.logger 
    };
    return getUploadUrlAction(instanceData, options);
  }

  /**
   * Upload a file to ComfyUI Deploy
   * @param {Object} options - Upload options
   * @param {string} options.filePath - Path to the file to upload
   * @param {string} options.fileType - MIME type of the file (optional, detected from file)
   * @returns {Promise<Object>} - Information about the uploaded file
   */
  async uploadFile(options = {}) {
    // Call the extracted action, passing necessary instance data
    const instanceData = { 
        apiUrl: this.apiUrl, 
        apiKey: this.apiKey, 
        logger: this.logger 
        // Note: fileManager.js uses global fs and path, so no need to pass them explicitly
    };
    return uploadFileAction(instanceData, options);
  }

  /**
   * Get a workflow version from ComfyUI Deploy
   * @param {string} versionId - The workflow version ID
   * @returns {Promise<Object>} - Returns workflow version
   */
  async getWorkflowVersion(versionId) {
    // Call the extracted action
    const instanceData = {
        logger: this.logger,
        API_ENDPOINTS: API_ENDPOINTS,
        _makeApiRequest: this._makeApiRequest.bind(this) // Pass bound method
    };
    return getWorkflowVersionAction(instanceData, versionId);
  }

  /**
   * Get detailed workflow information including complete workflow JSON structure
   * @param {string} workflowId - The workflow ID
   * @returns {Promise<Object>} - Returns workflow details with complete JSON structure
   */
  async getWorkflowDetails(workflowId) {
    // Call the extracted action
    const instanceData = {
        logger: this.logger,
        API_ENDPOINTS: API_ENDPOINTS,
        _makeApiRequest: this._makeApiRequest.bind(this) // Pass bound method
        // Note: getWorkflowDetailsAction itself calls getWorkflowVersionAction, so 
        // _makeApiRequest needs to be available to it indirectly through the instanceData 
        // passed down in resourceFetcher.js
    };
    return getWorkflowDetailsAction(instanceData, workflowId);
  }

  /**
   * Attempt to fetch a workflow's content/JSON directly from various API endpoints
   * This is a more aggressive approach that tries multiple potential endpoints
   * @param {string} workflowId - The workflow ID
   * @returns {Promise<Object|null>} - Returns workflow JSON structure or null if not found
   */
  async getWorkflowContent(workflowId) {
    // Call the extracted action
    const instanceData = {
        logger: this.logger,
        API_ENDPOINTS: API_ENDPOINTS,
        _makeApiRequest: this._makeApiRequest.bind(this)
        // Pass getWorkflowDetails and getWorkflowVersion for fallback logic within resourceFetcher
        // We need to ensure these wrappers call the *actions* correctly
        // getWorkflowDetails: this.getWorkflowDetails.bind(this),
        // getWorkflowVersion: this.getWorkflowVersion.bind(this)
    };
    // Re-check how resourceFetcher uses these fallbacks. It passes instanceData recursively.
    // So we only need to pass _makeApiRequest primarily.
    return getWorkflowContentAction(instanceData, workflowId);
  }

  /**
   * Make an API request to ComfyUI Deploy
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>} - Fetch response
   * @private
   */
  async _makeApiRequest(endpoint, options = {}) {
    const url = endpoint.startsWith('http') 
      ? endpoint 
      : `${this.apiUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    
    let attempt = 0;
    let lastError = null;

    // Prepare headers, merging existing options.headers if provided
    const headers = {
      'Accept': 'application/json', // Default Accept header
      'Authorization': `Bearer ${this.apiKey}`, // Add Authorization header
      ...(options.headers || {}) // Merge any headers passed in options
    };
    
    while (attempt < this.maxRetries) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        // Make the request with updated headers
        const response = await fetch(url, {
          ...options,
          headers: headers, // Use the combined headers
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        return response;
      } catch (error) {
        lastError = error;
        attempt++;
        
        // Check if we should retry
        if (attempt < this.maxRetries) {
          // Exponential backoff with jitter
          const delay = this.retryDelay * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5);
          console.warn(`Request to ${url} failed, retrying in ${Math.round(delay)}ms (attempt ${attempt}/${this.maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError || new Error(`Request to ${url} failed after ${this.maxRetries} attempts`);
  }
}

module.exports = ComfyUIService; 