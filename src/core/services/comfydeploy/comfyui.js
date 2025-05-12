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
const resourceFetcher = require('./resourceFetcher'); // Import resource fetcher
const { APIError } = require('../../../utils/errors'); // Assuming errors utility

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

/**
 * ComfyUI Service Class
 */
class ComfyUIService {
  // Define machine cost rates here. Keys should be the GPU identifier (e.g., 'A10G').
  // Values are { amount: number, currency: string, unit: string (e.g., 'second') }
  // These keys MUST match the expected value from the machine object's gpu_type (or similar) field.
  static MACHINE_COST_RATES = {
    'A10G': { amount: 0.000337, currency: 'USD', unit: 'second' },
    'T4': { amount: 0.00018, currency: 'USD', unit: 'second' },
    'CPU': { amount: 0.00004, currency: 'USD', unit: 'second' }, 
    'L4': { amount: 0.00032, currency: 'USD', unit: 'second' },
    'L40S': { amount: 0.000596, currency: 'USD', unit: 'second' },
    'A100': { amount: 0.00114, currency: 'USD', unit: 'second' },
    'A100-80GB': { amount: 0.001708, currency: 'USD', unit: 'second' }, // Ensure key matches API if distinct
    'H100': { amount: 0.002338, currency: 'USD', unit: 'second' },
    // Add/verify other machine types and their rates based on API response
  };

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

    this.machinesCache = null; // Initialize cache
    this.deploymentsCache = null; // Cache for deployment details (deploymentId -> deploymentObject)
    this.isInitialized = false;
    this.initializePromise = this.initialize(); // Start initialization
  }

  /**
   * Initializes the service, e.g., by fetching and caching machines.
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }
    if (this.initializePromise && typeof this.initializePromise.then === 'function') {
        // Initialization is already in progress
        return this.initializePromise;
    }

    this.logger.info('[ComfyUIService] Initializing...');
    try {
      const instanceData = this._getInstanceData();
      // Fetch machines
      const machines = await resourceFetcher.getMachines(instanceData);
      this.machinesCache = machines.reduce((acc, machine) => {
        if (machine && machine.id) {
          acc[machine.id] = machine;
          // Check for the primary field 'gpu' used for costing
          if (!machine.gpu) { 
            this.logger.warn(`[ComfyUIService Cache] Machine ID ${machine.id} ('${machine.name}') fetched from API is missing expected 'gpu' field used for costing. Full object: ${JSON.stringify(machine)}`);
          }
        } else {
          this.logger.warn(`[ComfyUIService Cache] Machine fetched from API is missing 'id'. Full object: ${JSON.stringify(machine)}`);
        }
        return acc;
      }, {});
      this.logger.info(`[ComfyUIService] Cached ${Object.keys(this.machinesCache).length} machines.`);

      // Fetch deployments
      const deployments = await resourceFetcher.getDeployments(instanceData);
      this.deploymentsCache = deployments.reduce((acc, deployment) => {
        if (deployment.id) {
          // Store deployment, ensuring machine_id is present
          acc[deployment.id] = deployment;
           if (!deployment.machine_id) {
               this.logger.warn(`[ComfyUIService Cache] Deployment ID ${deployment.id} ('${deployment.name}') is missing 'machine_id'. Full object: ${JSON.stringify(deployment)}`);
           }
        } else {
          this.logger.warn('[ComfyUIService Cache] Deployment found without an ID during caching.', deployment);
        }
        return acc;
      }, {});
      this.logger.info(`[ComfyUIService] Cached ${Object.keys(this.deploymentsCache).length} deployments.`);

      this.isInitialized = true;
      this.logger.info('[ComfyUIService] Initialization complete.');
    } catch (error) {
      this.logger.error('[ComfyUIService] Failed to initialize (fetch machines): ', error.message);
      // Depending on policy, could re-throw or allow service to run in a degraded state
      // For now, we'll allow it but log the error. Cost fetching might fail.
      this.machinesCache = {}; // Ensure it's an object even on failure
      this.deploymentsCache = {}; // Ensure deployments cache is empty on failure
    }
    this.initializePromise = null; // Clear the promise once settled
  }

  /**
   * Ensures the service is initialized before proceeding.
   */
  async _ensureInitialized() {
    if (!this.isInitialized) {
      if (this.initializePromise) {
        await this.initializePromise;
      } else {
        // Should not happen if constructor calls initialize(), but as a fallback:
        await this.initialize();
      }
    }
  }

  /**
   * Get the cost rate for a given deployment ID.
   * Looks up deployment -> machine -> machine details -> GPU type -> cost rate.
   * @param {string} deploymentId - The ID of the deployment.
   * @returns {Promise<Object|string>} - Cost rate object { amount, currency, unit } or an error string.
   */
  async getCostRateForDeployment(deploymentId) {
    await this._ensureInitialized(); // Ensure caches are populated

    if (!this.deploymentsCache || !this.machinesCache) {
      this.logger.error('[ComfyUIService.getCostRateForDeployment] Service caches not initialized.');
      return "error: service caches not initialized";
    }

    this.logger.info(`[ComfyUIService.getCostRateForDeployment] Getting cost rate for deployment ID: ${deploymentId}`);

    try {
      // 1. Find the deployment object in the cache
      const deployment = this.deploymentsCache[deploymentId];
      if (!deployment) {
        this.logger.warn(`[ComfyUIService.getCostRateForDeployment] Deployment ID ${deploymentId} not found in cache.`);
        return `error: deployment ${deploymentId} not found`;
      }

      // 2. Extract the machine_id
      const machineId = deployment.machine_id;
      if (!machineId) {
        this.logger.error(`[ComfyUIService.getCostRateForDeployment] 'machine_id' not found in cached deployment object for deployment ID ${deploymentId}. Deployment data: ${JSON.stringify(deployment)}`);
        return `error: machine_id not found for deployment ${deploymentId}`;
      }
      this.logger.debug(`[ComfyUIService.getCostRateForDeployment] Found machine_id ${machineId} for deployment ${deploymentId}`);

      // 3. Find the machine details in the machines cache
      const machine = this.machinesCache[machineId];
      if (!machine) {
        this.logger.warn(`[ComfyUIService.getCostRateForDeployment] Machine details for ID ${machineId} (from deployment ${deploymentId}) not found in machine cache.`);
        return `error: machine details not found for machine ID ${machineId}`;
      }
      this.logger.debug(`[ComfyUIService.getCostRateForDeployment] Found machine details for machine ID ${machineId}: ${JSON.stringify(machine)}`); // Log the whole machine object for inspection

      // 4. Extract the GPU identifier from the machine object
      //    Prioritize the 'gpu' field. Convert to uppercase for matching.
      const gpuIdentifier = machine.gpu?.toUpperCase(); 
      if (!gpuIdentifier) {
        this.logger.error(`[ComfyUIService.getCostRateForDeployment] Could not determine GPU identifier (checked 'gpu' field) for machine ID ${machineId}. Machine Name: '${machine.name}'. Machine Data: ${JSON.stringify(machine)}`);
        return `error: gpu identifier not found for machine ${machineId}`;
      }
      this.logger.debug(`[ComfyUIService.getCostRateForDeployment] Determined GPU identifier for machine ${machineId} ('${machine.name}') from 'gpu' field: ${gpuIdentifier}`);

      // 5. Look up the cost rate using the GPU identifier
      const costRate = ComfyUIService.MACHINE_COST_RATES[gpuIdentifier];
      if (costRate === undefined) {
        this.logger.warn(`[ComfyUIService.getCostRateForDeployment] Cost rate not defined in MACHINE_COST_RATES for GPU identifier: '${gpuIdentifier}' (Machine ID: ${machineId}, Deployment ID: ${deploymentId})`);
        return `error: cost rate unknown for GPU ${gpuIdentifier}`;
      }

      this.logger.info(`[ComfyUIService.getCostRateForDeployment] Determined cost rate for deployment ${deploymentId} (Machine: ${machine.name}, GPU: ${gpuIdentifier}): ${JSON.stringify(costRate)}`);
      return costRate; // Return the rate object { amount, currency, unit }

    } catch (error) {
      this.logger.error(`[ComfyUIService.getCostRateForDeployment] Unexpected error getting cost rate for deployment ${deploymentId}: ${error.message}`, error);
      return "error: unexpected error during cost rate calculation";
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
    return resourceFetcher.getDeployments(instanceData);
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
    return resourceFetcher.getWorkflows(instanceData);
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
    return resourceFetcher.getMachines(instanceData);
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
    return resourceFetcher.getWorkflowVersion(instanceData, versionId);
  }

  /**
   * Get detailed workflow information including complete workflow JSON structure
   * @param {string} workflowId - The workflow ID
   * @returns {Promise<Object>} - Returns workflow details with complete JSON structure
   */
  async getWorkflowDetails(workflowId) {
    if (!this.isInitialized) { // Check initialization if needed for context, maybe not strictly required here
      this.logger.warn('[ComfyUIService.getWorkflowDetails] Called before initialization, proceeding but cache might be unavailable.');
      // Consider if initialization is a hard requirement for this method too
    }
    this.logger.info(`[ComfyUIService.getWorkflowDetails] Fetching details for workflow ID: ${workflowId}`);
    try {
      const instanceData = this._getInstanceData();
      // Use the specific resourceFetcher function
      const workflowDetails = await resourceFetcher.getWorkflowDetails(instanceData, workflowId);
      // The resourceFetcher function should handle parsing the response JSON
      // Check if resourceFetcher returns null or throws on error/not found
      if (!workflowDetails) { // Adjust check based on how resourceFetcher signals 'not found'
        this.logger.warn(`[ComfyUIService.getWorkflowDetails] Workflow ${workflowId} not found or fetcher returned null.`);
        return null;
      }
      this.logger.info(`[ComfyUIService.getWorkflowDetails] Successfully fetched details for workflow ${workflowId}.`);
      return workflowDetails; // Return the detailed object
    } catch (error) {
      // Log the error but maybe return null instead of throwing, depending on expected usage
      this.logger.error(`[ComfyUIService.getWorkflowDetails] Error fetching details for workflow ${workflowId}: ${error.message}`, error);
      // Decide whether to return null or re-throw based on how callers handle errors
      // If 404 is common/expected, returning null might be better.
      if (error instanceof APIError && error.statusCode === 404) {
        return null; // Gracefully handle 'Not Found'
      }
      throw error; // Re-throw other errors
    }
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
    return resourceFetcher.getWorkflowContent(instanceData, workflowId);
  }

  /**
   * Make an API request to ComfyUI Deploy
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>} - Fetch response
   * @private
   */
  async _makeApiRequest(endpoint, options = {}, isRetry = false) {
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

  // Helper to bundle instance data for resourceFetcher
  _getInstanceData() {
    return {
      apiKey: this.apiKey,
      logger: this.logger,
      API_ENDPOINTS: API_ENDPOINTS,
      _makeApiRequest: this._makeApiRequest.bind(this) // Ensure correct 'this' context
    };
  }
}

module.exports = ComfyUIService; 