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
const crypto = require('crypto'); // Import crypto module for generating unique IDs

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
  // Static properties for shared cache and initialization state
  static S_MACHINES_CACHE = null;
  static S_DEPLOYMENTS_CACHE = null;
  static S_IS_INITIALIZED = false;
  static S_INITIALIZATION_IN_PROGRESS = false;
  static S_ACTIVE_INITIALIZE_PROMISE = null;

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
    'H200': { amount: 0.001891, currency: 'USD', unit: 'second' },
    'B200': { amount: 0.002604, currency: 'USD', unit: 'second' },
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
    this.instanceId = crypto.randomBytes(4).toString('hex'); // Add a unique ID
    //this.logger.info(`[ComfyUIService INSTANCE ${this.instanceId}] CREATED`); // Moved down

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
    
    //this.logger.info(`[ComfyUIService INSTANCE ${this.instanceId}] CREATED`); // Moved here

    // Validate API key (use logger.warn)
    if (!this.apiKey) {
      this.logger.warn(`[ComfyUIService INSTANCE ${this.instanceId}] ComfyUI Deploy API key not configured. Service will be inoperable.`);
    }

    // Call the static initialize method.
    // It's "fire-and-forget" from constructor, but promise is stored statically.
    // _ensureInitialized will await this promise if needed.
    ComfyUIService.initialize(this.logger, this._getInstanceData.bind(this));
  }

  /**
   * Initializes the service statically, e.g., by fetching and caching machines.
   * @param {Object} loggerInstance - Logger from the calling instance
   * @param {Function} getInstanceDataFn - Function to get instance-specific data (apiKey, etc.)
   */
  static async initialize(loggerInstance, getInstanceDataFn) {
    //loggerInstance.info(`[ComfyUIService STATIC .initialize_ENTRY] Current state - S_IS_INITIALIZED: ${ComfyUIService.S_IS_INITIALIZED}, S_INITIALIZATION_IN_PROGRESS: ${ComfyUIService.S_INITIALIZATION_IN_PROGRESS}, S_ACTIVE_INITIALIZE_PROMISE exists: ${!!ComfyUIService.S_ACTIVE_INITIALIZE_PROMISE}`);

    if (ComfyUIService.S_IS_INITIALIZED) {
      return;
    }

    if (ComfyUIService.S_INITIALIZATION_IN_PROGRESS) {
      return ComfyUIService.S_ACTIVE_INITIALIZE_PROMISE;
    }

    //loggerInstance.info(`[ComfyUIService STATIC .initialize_PROCEEDING] Starting new static initialization logic...`);
    ComfyUIService.S_INITIALIZATION_IN_PROGRESS = true;
    //loggerInstance.info(`[ComfyUIService STATIC .initialize_STATUS_UPDATE] Set S_INITIALIZATION_IN_PROGRESS: ${ComfyUIService.S_INITIALIZATION_IN_PROGRESS}`);
    
    ComfyUIService.S_ACTIVE_INITIALIZE_PROMISE = (async () => {
      //loggerInstance.info(`[ComfyUIService STATIC .initialize_IIFE_START]`);
      try {
        const instanceData = getInstanceDataFn(); // Get data (apiKey, etc.) from the triggering instance
        
        // Fetch machines
        const machines = await resourceFetcher.getMachines(instanceData);
        ComfyUIService.S_MACHINES_CACHE = machines.reduce((acc, machine) => {
          if (machine && machine.id) {
            acc[machine.id] = machine;
            if (!machine.gpu) { 
              loggerInstance.warn(`[ComfyUIService STATIC Cache] Machine ID ${machine.id} ('${machine.name}') fetched from API is missing expected 'gpu' field used for costing. Full object: ${JSON.stringify(machine)}`);
            }
          } else {
            loggerInstance.warn(`[ComfyUIService STATIC Cache] Machine fetched from API is missing 'id'. Full object: ${JSON.stringify(machine)}`);
          }
          return acc;
        }, {});
        loggerInstance.info(`[ComfyUIService STATIC Cache] Cached ${Object.keys(ComfyUIService.S_MACHINES_CACHE).length} machines.`);

        // Fetch deployments
        const deployments = await resourceFetcher.getDeployments(instanceData);
        ComfyUIService.S_DEPLOYMENTS_CACHE = deployments.reduce((acc, deployment) => {
          if (deployment.id) {
            acc[deployment.id] = deployment;
            if (!deployment.machine_id) {
              loggerInstance.warn(`[ComfyUIService STATIC Cache] Deployment ID ${deployment.id} ('${deployment.name}') is missing 'machine_id'. Full object: ${JSON.stringify(deployment)}`);
            }
          } else {
            loggerInstance.warn('[ComfyUIService STATIC Cache] Deployment found without an ID during caching.', deployment);
          }
          return acc;
        }, {});
        loggerInstance.info(`[ComfyUIService STATIC Cache] Cached ${Object.keys(ComfyUIService.S_DEPLOYMENTS_CACHE).length} deployments.`);

        ComfyUIService.S_IS_INITIALIZED = true;
        //loggerInstance.info(`[ComfyUIService STATIC .initialize_IIFE_SUCCESS] Set S_IS_INITIALIZED: ${ComfyUIService.S_IS_INITIALIZED}. Static Initialization complete.`);
      } catch (error) {
        loggerInstance.error(`[ComfyUIService STATIC .initialize_IIFE_ERROR] Failed to initialize statically: `, error.message);
        ComfyUIService.S_IS_INITIALIZED = false; // Explicitly set to false on error
        loggerInstance.info(`[ComfyUIService STATIC .initialize_IIFE_ERROR_STATUS] Set S_IS_INITIALIZED: ${ComfyUIService.S_IS_INITIALIZED} due to error.`);
      } finally {
        ComfyUIService.S_INITIALIZATION_IN_PROGRESS = false;
        loggerInstance.info(`[ComfyUIService STATIC .initialize_IIFE_FINALLY] Set S_INITIALIZATION_IN_PROGRESS: ${ComfyUIService.S_INITIALIZATION_IN_PROGRESS}. Active static promise exists: ${!!ComfyUIService.S_ACTIVE_INITIALIZE_PROMISE}`);
      }
    })();
    
    loggerInstance.info(`[ComfyUIService STATIC .initialize_EXIT] Returning S_ACTIVE_INITIALIZE_PROMISE (exists: ${!!ComfyUIService.S_ACTIVE_INITIALIZE_PROMISE})`);
    return ComfyUIService.S_ACTIVE_INITIALIZE_PROMISE;
  }

  /**
   * Ensures the service is statically initialized before proceeding.
   */
  async _ensureInitialized() {
    //this.logger.info(`[ComfyUIService INSTANCE ${this.instanceId} ._ensureInitialized_ENTRY] Current static state - S_IS_INITIALIZED: ${ComfyUIService.S_IS_INITIALIZED}`);
    if (!ComfyUIService.S_IS_INITIALIZED) {
      //this.logger.info(`[ComfyUIService INSTANCE ${this.instanceId} ._ensureInitialized_NEEDS_STATIC_INIT] Calling static ComfyUIService.initialize(). Current static state - S_INITIALIZATION_IN_PROGRESS: ${ComfyUIService.S_INITIALIZATION_IN_PROGRESS}`);
      await ComfyUIService.initialize(this.logger, this._getInstanceData.bind(this)); 
      //this.logger.info(`[ComfyUIService INSTANCE ${this.instanceId} ._ensureInitialized_POST_AWAIT_STATIC_INIT] Finished awaiting static initialize(). Current static state - S_IS_INITIALIZED: ${ComfyUIService.S_IS_INITIALIZED}`);
    } else {
      // No log needed here if already initialized
    }
  }

  /**
   * Get the cost rate for a given deployment ID.
   * Looks up deployment -> machine -> machine details -> GPU type -> cost rate.
   * @param {string} deploymentId - The ID of the deployment.
   * @returns {Promise<Object|string>} - Cost rate object { amount, currency, unit } or an error string.
   */
  async getCostRateForDeployment(deploymentId) {
    await this._ensureInitialized(); // Ensure static caches are populated

    if (!ComfyUIService.S_DEPLOYMENTS_CACHE || !ComfyUIService.S_MACHINES_CACHE) {
      this.logger.error(`[ComfyUIService INSTANCE ${this.instanceId} .getCostRateForDeployment] Service static caches not initialized.`);
      return "error: service static caches not initialized";
    }

    this.logger.info(`[ComfyUIService INSTANCE ${this.instanceId} .getCostRateForDeployment] Getting cost rate for deployment ID: ${deploymentId}`);

    try {
      // 1. Find the deployment object in the static cache
      const deployment = ComfyUIService.S_DEPLOYMENTS_CACHE[deploymentId];
      if (!deployment) {
        this.logger.warn(`[ComfyUIService INSTANCE ${this.instanceId} .getCostRateForDeployment] Deployment ID ${deploymentId} not found in static cache.`);
        return `error: deployment ${deploymentId} not found`;
      }

      // 2. Extract the machine_id
      const machineId = deployment.machine_id;
      if (!machineId) {
        this.logger.error(`[ComfyUIService INSTANCE ${this.instanceId} .getCostRateForDeployment] 'machine_id' not found in cached deployment object for deployment ID ${deploymentId}. Deployment data: ${JSON.stringify(deployment)}`);
        return `error: machine_id not found for deployment ${deploymentId}`;
      }
      this.logger.debug(`[ComfyUIService INSTANCE ${this.instanceId} .getCostRateForDeployment] Found machine_id ${machineId} for deployment ${deploymentId}`);

      // 3. Find the machine details in the static machines cache
      const machine = ComfyUIService.S_MACHINES_CACHE[machineId];
      if (!machine) {
        this.logger.warn(`[ComfyUIService INSTANCE ${this.instanceId} .getCostRateForDeployment] Machine details for ID ${machineId} (from deployment ${deploymentId}) not found in static machine cache.`);
        return `error: machine details not found for machine ID ${machineId}`;
      }
      this.logger.debug(`[ComfyUIService INSTANCE ${this.instanceId} .getCostRateForDeployment] Found machine details for machine ID ${machineId}: ${JSON.stringify(machine)}`);

      // 4. Extract the GPU identifier from the machine object
      //    Prioritize the 'gpu' field. Convert to uppercase for matching.
      const gpuIdentifier = machine.gpu?.toUpperCase(); 
      if (!gpuIdentifier) {
        this.logger.error(`[ComfyUIService INSTANCE ${this.instanceId} .getCostRateForDeployment] Could not determine GPU identifier (checked 'gpu' field) for machine ID ${machineId}. Machine Name: '${machine.name}'. Machine Data: ${JSON.stringify(machine)}`);
        return `error: gpu identifier not found for machine ${machineId}`;
      }
      this.logger.debug(`[ComfyUIService INSTANCE ${this.instanceId} .getCostRateForDeployment] Determined GPU identifier for machine ${machineId} ('${machine.name}') from 'gpu' field: ${gpuIdentifier}`);

      // 5. Look up the cost rate using the GPU identifier
      const costRate = ComfyUIService.MACHINE_COST_RATES[gpuIdentifier];
      if (costRate === undefined) {
        this.logger.warn(`[ComfyUIService INSTANCE ${this.instanceId} .getCostRateForDeployment] Cost rate not defined in MACHINE_COST_RATES for GPU identifier: '${gpuIdentifier}' (Machine ID: ${machineId}, Deployment ID: ${deploymentId})`);
        return `error: cost rate unknown for GPU ${gpuIdentifier}`;
      }

      this.logger.info(`[ComfyUIService INSTANCE ${this.instanceId} .getCostRateForDeployment] Determined cost rate for deployment ${deploymentId} (Machine: ${machine.name}, GPU: ${gpuIdentifier}): ${JSON.stringify(costRate)}`);
      return costRate; // Return the rate object { amount, currency, unit }

    } catch (error) {
      this.logger.error(`[ComfyUIService INSTANCE ${this.instanceId} .getCostRateForDeployment] Unexpected error getting cost rate for deployment ${deploymentId}: ${error.message}`, error);
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

    let finalWebhookUrl = this.webhookUrl;
    this.logger.info(`[ComfyUIService] Initial this.webhookUrl: "${this.webhookUrl}"`);

    if (finalWebhookUrl && typeof finalWebhookUrl === 'string') {
      // Trim leading/trailing whitespace as a defensive measure
      finalWebhookUrl = finalWebhookUrl.trim();
      this.logger.info(`[ComfyUIService] After trim: "${finalWebhookUrl}"`);

      // Normalize: remove trailing slash if present
      const baseWebhookUrl = finalWebhookUrl.endsWith('/') ? finalWebhookUrl.slice(0, -1) : finalWebhookUrl;
      this.logger.info(`[ComfyUIService] baseWebhookUrl (no trailing slash): "${baseWebhookUrl}"`);

      // Ensure it ends with the correct, new path
      const correctPath = '/api/v1/webhook/comfydeploy';
      if (!baseWebhookUrl.endsWith(correctPath)) {
        // Check if it ends with the OLD path and remove it if so, to avoid duplication if .env is not updated yet
        const oldPath = '/api/v1/webhook';
        let urlToAppendTo = baseWebhookUrl;
        if (baseWebhookUrl.endsWith(oldPath)) {
          urlToAppendTo = baseWebhookUrl.substring(0, baseWebhookUrl.length - oldPath.length);
          // Remove trailing slash again if any resulted from substring
          if (urlToAppendTo.endsWith('/')) {
            urlToAppendTo = urlToAppendTo.slice(0, -1);
          }
        }
        finalWebhookUrl = urlToAppendTo + correctPath;
        this.logger.info(`[ComfyUIService] Appended ${correctPath}: "${finalWebhookUrl}"`);
      } else {
        this.logger.info(`[ComfyUIService] Webhook URL already ends with ${correctPath}. No change: "${finalWebhookUrl}"`);
      }

      this.logger.info(`[ComfyUIService] Before http check, finalWebhookUrl: "${finalWebhookUrl}"`);
      const startsWithHttp = finalWebhookUrl.startsWith('http://');
      const startsWithHttps = finalWebhookUrl.startsWith('https://');
      this.logger.info(`[ComfyUIService] Current finalWebhookUrl startsWithHttp: ${startsWithHttp}, startsWithHttps: ${startsWithHttps}`);

      if (!startsWithHttp && !startsWithHttps) {
        this.logger.info(`[ComfyUIService] Prepending https:// to "${finalWebhookUrl}"`);
        finalWebhookUrl = `https://${finalWebhookUrl}`;
        this.logger.info(`[ComfyUIService] After prepending https://: "${finalWebhookUrl}"`);
      } else {
        this.logger.info(`[ComfyUIService] Scheme (http/https) already present, not prepending.`);
      }
    } else {
      this.logger.warn(`[ComfyUIService] this.webhookUrl is not a valid string or is empty: "${this.webhookUrl}"`);
    }
    
    this.logger.info(`[ComfyUIService] FINAL finalWebhookUrl for runManagerOptions: "${finalWebhookUrl}"`);

    const runManagerOptions = {
      ...options, // Spread the original options (deploymentId, inputs, workflowName)
      webhook: finalWebhookUrl // Use the potentially modified URL
    };

    return submitRequestAction(instanceData, runManagerOptions);
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
    await this._ensureInitialized();
    // Use static cache
    if (ComfyUIService.S_DEPLOYMENTS_CACHE && Object.keys(ComfyUIService.S_DEPLOYMENTS_CACHE).length > 0) {
      this.logger.debug(`[ComfyUIService INSTANCE ${this.instanceId} .getDeployments] Returning statically cached deployments.`);
      return Object.values(ComfyUIService.S_DEPLOYMENTS_CACHE);
    }
    // Fallback: This should ideally not be reached if _ensureInitialized works correctly and populates the cache.
    // If static init failed, this might be hit.
    this.logger.info(`[ComfyUIService INSTANCE ${this.instanceId} .getDeployments] Static cache empty or not populated, fetching fresh deployments (fallback).`);
    const deployments = await resourceFetcher.getDeployments(this._getInstanceData());
    // Attempt to populate static cache if it was empty, indicating a potential issue in initial static load
    if (!ComfyUIService.S_DEPLOYMENTS_CACHE || Object.keys(ComfyUIService.S_DEPLOYMENTS_CACHE).length === 0 && deployments.length > 0) {
        ComfyUIService.S_DEPLOYMENTS_CACHE = deployments.reduce((acc, dep) => { if (dep.id) acc[dep.id] = dep; return acc; }, {});
        this.logger.info(`[ComfyUIService INSTANCE ${this.instanceId} .getDeployments] Populated static deployments cache via fallback.`);
    }
    return deployments;
  }

  /**
   * Get list of workflows from ComfyUI Deploy API
   * @returns {Promise<Array>} - List of workflows
   */
  async getWorkflows() {
    await this._ensureInitialized();
    return resourceFetcher.getWorkflows(this._getInstanceData());
  }

  /**
   * Get list of machines available in ComfyUI Deploy
   * @returns {Promise<Array>} - List of machines
   */
  async getMachines() {
    await this._ensureInitialized();
    // Use static cache
    if (ComfyUIService.S_MACHINES_CACHE && Object.keys(ComfyUIService.S_MACHINES_CACHE).length > 0) {
      this.logger.debug(`[ComfyUIService INSTANCE ${this.instanceId} .getMachines] Returning statically cached machines.`);
      return Object.values(ComfyUIService.S_MACHINES_CACHE);
    }
    // Fallback, similar to getDeployments
    this.logger.info(`[ComfyUIService INSTANCE ${this.instanceId} .getMachines] Static cache empty or not populated, fetching fresh machines (fallback).`);
    const machines = await resourceFetcher.getMachines(this._getInstanceData());
    if (!ComfyUIService.S_MACHINES_CACHE || Object.keys(ComfyUIService.S_MACHINES_CACHE).length === 0 && machines.length > 0) {
        ComfyUIService.S_MACHINES_CACHE = machines.reduce((acc, m) => { if (m.id) acc[m.id] = m; return acc; }, {});
        this.logger.info(`[ComfyUIService INSTANCE ${this.instanceId} .getMachines] Populated static machines cache via fallback.`);
    }
    return machines;
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
    await this._ensureInitialized();
    if (!versionId) {
      this.logger.error('[ComfyUIService.getWorkflowVersion] Version ID is required.');
      throw new APIError('Version ID is required for getWorkflowVersion', 400);
    }
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
    await this._ensureInitialized(); // Ensures caches are populated if needed by resourceFetcher or subsequent logic
    this.logger.debug(`[ComfyUIService.getWorkflowDetails] Fetching details for workflow ID: ${workflowId}`);
    if (!workflowId) {
      this.logger.error('[ComfyUIService.getWorkflowDetails] Workflow ID is required.');
      throw new APIError('Workflow ID is required for getWorkflowDetails', 400);
    }
    // Pass this service's getWorkflowVersion method to resourceFetcher.getWorkflowDetails
    // so it can use the already initialized ComfyUIService instance for recursive calls if necessary.
    const instanceData = {
      ...this._getInstanceData(),
      // This is a bit circular, but resourceFetcher.getWorkflowDetails might call getWorkflowVersion
      // and we want it to call *this* instance's getWorkflowVersion.
      getWorkflowVersion: (vId) => this.getWorkflowVersion(vId) 
    };
    return resourceFetcher.getWorkflowDetails(instanceData, workflowId);
  }

  /**
   * Attempt to fetch a workflow's content/JSON directly from various API endpoints
   * This is a more aggressive approach that tries multiple potential endpoints
   * @param {string} workflowId - The workflow ID
   * @returns {Promise<Object|null>} - Returns workflow JSON structure or null if not found
   */
  async getWorkflowContent(workflowId) {
    await this._ensureInitialized();
    this.logger.debug(`[ComfyUIService.getWorkflowContent] Fetching content for workflow ID: ${workflowId}`);
    if (!workflowId) {
      this.logger.error('[ComfyUIService.getWorkflowContent] Workflow ID is required.');
      throw new APIError('Workflow ID is required for getWorkflowContent', 400);
    }
    const instanceData = {
      ...this._getInstanceData(),
      getWorkflowVersion: (vId) => this.getWorkflowVersion(vId),
      getWorkflowDetails: (wId) => this.getWorkflowDetails(wId) // Pass getWorkflowDetails as well
    };
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