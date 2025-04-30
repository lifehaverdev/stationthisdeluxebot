/**
 * ComfyUI Service
 * 
 * Handles interactions with ComfyUI Deploy API for image generation.
 * This is the authoritative source for all ComfyUI Deploy interactions.
 * 
 * UPDATED: Based on API testing, endpoints should use the '/api/' prefix.
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const path = require('path');
const fs = require('fs');

// Constants
const DEFAULT_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY = 6000;
const COMFY_DEPLOY_API_URL = 'https://api.comfydeploy.com';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhook';

// API Endpoints (validated through testing)
const API_ENDPOINTS = {
  DEPLOYMENTS: '/api/deployments',    // GET - List all deployments 
  DEPLOYMENT: '/api/deployment',      // POST - Create deployment
  WORKFLOWS: '/api/workflows',        // GET - List all workflows
  WORKFLOW: '/api/workflow',          // POST - Create workflow
  MACHINES: '/api/machines',          // GET - List all machines
  MACHINE: (id) => `/api/machine/${id}`,  // GET - Get machine by ID
  RUN_QUEUE: '/api/run/deployment/queue', // POST - Submit run
  RUN_STATUS: (id) => `/api/run/${id}`,   // GET - Check run status
  RUN_CANCEL: (id) => `/api/run/${id}/cancel`, // POST - Cancel run
  FILE_UPLOAD: '/api/file'            // POST - Get upload URL
};

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
    this.logger = options.logger || console.log;
    this.activeRequests = new Map();
    
    // Validate API key
    if (!this.apiKey) {
      this.logger('WARNING: ComfyUI Deploy API key not configured. Service will be inoperable.');
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
    if (!options.deploymentId) {
      throw new Error('Deployment ID is required');
    }

    // Check if we need to determine the machine ID from the workflow
    let machineId = options.machineId;
    if (!machineId && options.workflowName) {
      try {
        // If we have a WorkflowsService instance and workflowName, use it for machine routing
        const WorkflowsService = require('./workflows');
        const workflows = new WorkflowsService();
        machineId = await workflows.getMachineForWorkflow(options.workflowName);
        
        if (machineId) {
          this.logger(`Using machine ${machineId} for workflow "${options.workflowName}"`);
        } else {
          this.logger(`No suitable machine found for workflow "${options.workflowName}", using default or API-selected machine`);
        }
      } catch (error) {
        this.logger(`Error determining machine for workflow "${options.workflowName}": ${error.message}`);
        // Continue without a specific machine ID - the API will select one
      }
    }

    // Build the request payload
    const payload = {
      deployment_id: options.deploymentId,
      inputs: options.inputs || {}
    };

    // Add machine ID if specified
    if (machineId) {
      payload.machine_id = machineId;
    }

    // Add webhook URL if provided
    if (options.webhookUrl) {
      payload.webhook_url = options.webhookUrl;
    }

    try {
      this.logger(`Submitting request for deployment ${options.deploymentId}${machineId ? ` on machine ${machineId}` : ''}`);
      
      const response = await fetch(`${this.apiUrl}${API_ENDPOINTS.RUN_QUEUE}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Failed to submit request: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      const runId = result.run_id;

      this.logger(`Request submitted successfully. Run ID: ${runId}`);
      
      // Track the request
      this.activeRequests.set(runId, {
        options,
        timestamp: Date.now(),
        status: 'processing'
      });
      
      return runId;
    } catch (error) {
      this.logger(`Error submitting request: ${error.message}`);
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
      const response = await fetch(`${this.apiUrl}${API_ENDPOINTS.RUN_STATUS(runId)}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
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
      this.logger(`Error checking status for run ${runId}: ${error.message}`);
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
      this.logger(`Error getting results for run ${runId}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cancel a running generation request
   * @param {string} runId - The run ID to cancel
   * @returns {Promise<Object>} - Returns cancellation result
   */
  async cancelRequest(runId) {
    try {
      if (!runId) {
        return { success: false, error: 'Invalid run ID' };
      }
      
      // Call the ComfyUI Deploy API to cancel the run
      const response = await fetch(`${this.apiUrl}${API_ENDPOINTS.RUN_CANCEL(runId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `Failed to cancel run: ${errorText}` };
      }
      
      // Update active request status if we're tracking it
      if (this.activeRequests.has(runId)) {
        const request = this.activeRequests.get(runId);
        request.status = 'cancelled';
        this.activeRequests.set(runId, request);
      }
      
      return { success: true };
    } catch (error) {
      this.logger(`Error cancelling run ${runId}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all deployments available to the current user
   * @returns {Promise<Array>} - Returns array of deployments
   */
  async getDeployments() {
    try {
      // Use the correct endpoint
      const response = await fetch(`${this.apiUrl}${API_ENDPOINTS.DEPLOYMENTS}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get deployments: ${errorText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      this.logger(`Error getting deployments: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get list of workflows from ComfyUI Deploy API
   * @returns {Promise<Array>} - List of workflows
   */
  async getWorkflows() {
    try {
      // Use the correct endpoint
      const response = await fetch(`${this.apiUrl}${API_ENDPOINTS.WORKFLOWS}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get workflows: ${errorText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      this.logger(`Error getting workflows: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get list of machines available in ComfyUI Deploy
   * @returns {Promise<Array>} - List of machines
   */
  async getMachines() {
    try {
      // Use the correct endpoint
      const response = await fetch(`${this.apiUrl}${API_ENDPOINTS.MACHINES}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get machines: ${errorText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      this.logger(`Error getting machines: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract image outputs from the workflow outputs
   * @param {Object} outputs - Workflow outputs
   * @returns {Array} - List of image URLs
   * @private
   */
  _extractImageOutputs(outputs) {
    if (!outputs || typeof outputs !== 'object') {
      return [];
    }
    
    const images = [];
    
    // Iterate through all outputs
    Object.values(outputs).forEach(value => {
      // Check if the value is a URL string or an object with URL
      if (typeof value === 'string' && this._isImageUrl(value)) {
        images.push(value);
      } else if (value && typeof value === 'object') {
        // Check if it's an array
        if (Array.isArray(value)) {
          value.forEach(item => {
            if (typeof item === 'string' && this._isImageUrl(item)) {
              images.push(item);
            }
          });
        }
        // Check for nested objects with image URLs
        else if (value.url && typeof value.url === 'string' && this._isImageUrl(value.url)) {
          images.push(value.url);
        }
        // Check for nested arrays with image URLs
        else if (value.images && Array.isArray(value.images)) {
          value.images.forEach(img => {
            if (typeof img === 'string' && this._isImageUrl(img)) {
              images.push(img);
            } else if (img && img.url && typeof img.url === 'string' && this._isImageUrl(img.url)) {
              images.push(img.url);
            }
          });
        }
      }
    });
    
    return images;
  }

  /**
   * Determine if a URL is an image URL
   * @param {string} url - The URL to check
   * @returns {boolean} - Whether the URL is likely an image URL
   * @private
   */
  _isImageUrl(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }
    
    // Check URL extension
    const pattern = /\.(jpeg|jpg|gif|png|bmp|webp)(\?.*)?$/i;
    if (pattern.test(url)) {
      return true;
    }
    
    // Check if URL contains image-like path segments
    if (url.includes('/images/') || 
        url.includes('/image/') || 
        url.includes('/img/')) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Determine the MIME type of a file based on its extension
   * @param {string} filePath - Path to the file
   * @returns {string} - MIME type for the file
   * @private
   */
  _determineFileType(filePath) {
    // Get file extension
    const ext = path.extname(filePath).toLowerCase();
    
    // Map extensions to MIME types
    switch (ext) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.gif':
        return 'image/gif';
      case '.webp':
        return 'image/webp';
      case '.json':
        return 'application/json';
      case '.txt':
        return 'text/plain';
      case '.pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }

  /**
   * Get a pre-signed URL for file uploads
   * @param {Object} options - Options for getting upload URL
   * @param {string} options.fileType - MIME type of the file
   * @param {number} options.fileSize - Size of the file in bytes
   * @returns {Promise<Object>} - Upload URL and file information
   */
  async getUploadUrl(options = {}) {
    const { fileType, fileSize } = options;
    
    if (!fileType || !fileSize) {
      throw new Error('File type and size are required');
    }
    
    try {
      // Using the correct /api prefix
      const response = await this._makeApiRequest(API_ENDPOINTS.FILE_UPLOAD, {
        method: 'POST',
        body: JSON.stringify({
          type: fileType,
          file_size: fileSize
        }),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get upload URL: ${errorText}`);
      }
      
      const data = await response.json();
      
      return {
        uploadUrl: data.upload_url,
        fileId: data.file_id,
        downloadUrl: data.download_url
      };
    } catch (error) {
      console.error('Error getting upload URL:', error);
      throw error;
    }
  }

  /**
   * Upload a file to ComfyUI Deploy
   * @param {Object} options - Upload options
   * @param {string} options.filePath - Path to the file to upload
   * @param {string} options.fileType - MIME type of the file (optional, detected from file)
   * @returns {Promise<Object>} - Information about the uploaded file
   */
  async uploadFile(options = {}) {
    const { filePath, fileType: providedFileType } = options;
    
    if (!filePath) {
      throw new Error('File path is required');
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    try {
      // Get file stats for size
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;
      
      // Determine file type
      const fileType = providedFileType || this._determineFileType(filePath);
      
      // Get upload URL
      const { uploadUrl, fileId, downloadUrl } = await this.getUploadUrl({
        fileType,
        fileSize
      });
      
      // Read file content
      const fileContent = fs.readFileSync(filePath);
      
      // Upload to the pre-signed URL
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: fileContent,
        headers: {
          'Content-Type': fileType,
          'Content-Length': fileSize.toString()
        }
      });
      
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`File upload failed: ${errorText}`);
      }
      
      return {
        fileId,
        downloadUrl,
        success: true
      };
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  }

  /**
   * Create a new deployment
   * @param {Object} options - Deployment options
   * @param {string} options.workflowId - ID of the workflow
   * @param {string} options.versionId - Version ID of the workflow to deploy
   * @param {string} options.name - Name of the deployment
   * @param {string} options.machine - Machine to deploy to
   * @returns {Promise<Object>} - Returns created deployment
   */
  async createDeployment(options = {}) {
    const { workflowId, versionId, name, machine } = options;
    
    if (!workflowId || !versionId) {
      throw new Error('Workflow ID and version ID are required');
    }
    
    try {
      // Prepare the payload according to the updated API docs
      const payload = {
        workflow_id: workflowId,
        version_id: versionId,
        name: name || `Deployment ${new Date().toISOString()}`,
        machine_id: machine
      };
      
      // UPDATED to use correct endpoint
      const response = await this._makeApiRequest('/deployment', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create deployment: ${errorText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error creating deployment:', error);
      throw error;
    }
  }

  /**
   * Upload a workflow to ComfyUI Deploy
   * @param {Object} options - Upload options
   * @param {Object} options.workflow - The workflow JSON
   * @param {string} options.name - Workflow name
   * @param {Object} options.api - API specification for the workflow
   * @returns {Promise<Object>} - Returns created workflow
   */
  async uploadWorkflow(options = {}) {
    const { workflow, name, api } = options;
    
    if (!workflow) {
      throw new Error('Workflow JSON is required');
    }
    
    try {
      // Prepare the payload according to updated API docs
      const payload = {
        workflow_name: name || `Workflow ${new Date().toISOString()}`,
        workflow: workflow,
        workflow_api: api || {}
      };
      
      // UPDATED to use correct endpoint
      const response = await this._makeApiRequest('/workflow', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to upload workflow: ${errorText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error uploading workflow:', error);
      throw error;
    }
  }

  /**
   * Get a workflow version from ComfyUI Deploy
   * @param {string} versionId - The workflow version ID
   * @returns {Promise<Object>} - Returns workflow version
   */
  async getWorkflowVersion(versionId) {
    if (!versionId) {
      throw new Error('Version ID is required');
    }
    
    try {
      // Using the correct /api prefix
      const response = await this._makeApiRequest(API_ENDPOINTS.WORKFLOW_VERSION(versionId), {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get workflow version: ${errorText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Error getting workflow version ${versionId}:`, error);
      throw error;
    }
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
    
    while (attempt < this.maxRetries) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        // Make the request
        const response = await fetch(url, {
          ...options,
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

  /**
   * Clean up stale requests
   * @private
   */
  _cleanupStaleRequests() {
    const now = Date.now();
    const staleThreshold = this.timeout * 2; // Remove requests that are twice as old as timeout
    
    for (const [runId, request] of this.activeRequests.entries()) {
      const age = now - request.timestamp;
      
      if (age > staleThreshold || request.status === 'completed' || request.status === 'error' || request.status === 'cancelled') {
        this.activeRequests.delete(runId);
      }
    }
  }
}

module.exports = ComfyUIService; 