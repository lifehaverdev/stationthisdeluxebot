/**
 * Workflows Service
 * 
 * Manages access to workflow templates and their configurations.
 * Uses ComfyUI Deploy API as the primary and authoritative source of truth.
 * No database dependencies - all workflows are retrieved directly from the API.
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const path = require('path');

// Import configuration
const { 
  DEFAULT_TIMEOUT,
  DEFAULT_CACHE_TTL,
  COMFY_DEPLOY_API_URL,
  API_ENDPOINTS
} = require('./config');

// Import utilities
const {
  standardizeWorkflowName,
  parseWorkflowStructure,
  createDefaultInputPayload,
  validateInputPayload,
  mergeWithDefaultInputs,
  prepareWorkflowPayload
} = require('./workflowUtils');

// Import actions
const {
  createDeployment: createDeploymentAction,
  uploadWorkflow: uploadWorkflowAction,
  reloadWorkflows: reloadWorkflowsAction,
  invalidateWorkflowCache: invalidateWorkflowCacheAction
} = require('./workflowActions');

// Import the new Cache Manager
const WorkflowCacheManager = require('./workflowCacheManager');

const DEBUG_LOGGING_ENABLED = false; // Set to true to enable detailed logging

class WorkflowsService {
  /**
   * Initialize Workflows Service
   * 
   * @param {Object} options - Configuration options
   * @param {string} options.apiUrl - ComfyUI Deploy API URL (optional)
   * @param {string} options.apiKey - ComfyUI Deploy API key (optional)
   * @param {Object} options.cache - Cache configuration (optional)
   * @param {boolean} options.cache.enabled - Whether to enable caching (default: true)
   * @param {number} options.cache.ttl - Cache TTL in milliseconds (default: 5 minutes)
   * @param {Function} options.logger - Logger function (optional)
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || COMFY_DEPLOY_API_URL;
    this.apiKey = options.apiKey || process.env.COMFY_DEPLOY_API_KEY;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.logger = options.logger || console.log;
    
    // Instantiate the Cache Manager, passing relevant options
    this.cacheManager = new WorkflowCacheManager({
      apiUrl: this.apiUrl,
      apiKey: this.apiKey,
      timeout: this.timeout,
      logger: this.logger,
      cacheConfig: options.cache // Pass the cache config sub-object
    });
    
    // Load machine routing configuration
    try {
      const configPath = path.resolve(process.cwd(), 'config/workflow-machine-routing.js');
      this.routingConfig = require(configPath);
      if (DEBUG_LOGGING_ENABLED) this.logger.info(`Loaded machine routing configuration with ${Object.keys(this.routingConfig.routingRules).length} rules`);
    } catch (error) {
      this.logger.warn(`Could not load machine routing configuration: ${error.message}`);
      this.routingConfig = {
        routingRules: {},
        defaultMachine: null
      };
    }
    
    // Validate API key
    if (!this.apiKey) {
      this.logger.warn('ComfyUI Deploy API key not configured. Service will be inoperable.');
    }
  }

  /**
   * Initialize the service by loading all workflows from ComfyUI Deploy
   * (Delegates actual loading to the Cache Manager)
   * 
   * @returns {Promise<Array>} - Loaded workflows
   */
  async initialize() {
    if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowsService] Initialize called. Delegating to Cache Manager...');
    // Just delegate to the cache manager's initialize method
    return this.cacheManager.initialize();
  }

  /**
   * Get all available workflows
   * 
   * @returns {Promise<Array>} - List of all workflows
   */
  async getWorkflows() {
    // Ensure cache manager is initialized before accessing data
    await this.cacheManager.ensureInitialized(); 
    
    // Access cache via manager
    return this.cacheManager.cache.workflows; 
  }

  /**
   * Get a workflow by its name
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<Object|null>} - Workflow object or null if not found
   */
  async getWorkflowByName(name) {
    await this.cacheManager.ensureInitialized();
    
    // Standardize the workflow name using the utility function
    const standardName = standardizeWorkflowName(name);
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[getWorkflowByName] Looking up standard name: "${standardName}" (from original: "${name}")`);
    
    // Try to find by standardized name first using the manager's cache
    let workflow = this.cacheManager.cache.byName.get(standardName);
    
    // Log cache keys for comparison if not found initially
    if (!workflow) {
        const availableKeys = Array.from(this.cacheManager.cache.byName.keys());
        if (DEBUG_LOGGING_ENABLED) this.logger.warn(`[getWorkflowByName] Workflow with standard name "${standardName}" not found directly in byName cache. Available keys: ${availableKeys.join(", ")}`);
    }
    
    // If not found by standardized name, try original name as fallback
    if (!workflow && name !== standardName) {
      // Access cache via manager
      workflow = this.cacheManager.cache.byName.get(name); 
      
      if (workflow) {
        if (DEBUG_LOGGING_ENABLED) this.logger.info(`Found workflow using original name "${name}" instead of standardized name "${standardName}"`);
      }
    }
    
    return workflow || null;
  }

  /**
   * Get required inputs for a specific workflow (retrieved from cached data)
   * 
   * @param {string} name - Name of the workflow 
   * @returns {Promise<Array>} - Array of required inputs with their types and default values
   */
  async getWorkflowRequiredInputs(name) {
    const workflow = await this.getWorkflowByName(name);
    
    if (!workflow) {
      this.logger.warn(`[getWorkflowRequiredInputs] Workflow "${name}" not found in cache.`);
      return [];
    }
    
    // The initialize() method should have already populated this.
    if (workflow.requiredInputs && Array.isArray(workflow.requiredInputs)) {
      // this.logger.info(`[getWorkflowRequiredInputs] Returning cached inputs for "${name}".`); // Optionally keep for debugging
      return workflow.requiredInputs;
    } else {
      // This case should ideally not happen if initialization is successful.
      this.logger.warn(`[getWorkflowRequiredInputs] Required inputs not found in cache for "${name}". Initialization might have failed or workflow structure is missing.`);
      return [];
    }
  }

  /**
   * Get the output type for a specific workflow (retrieved from cached data)
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<string>} - Type of output (image, video, animation, unknown)
   */
  async getWorkflowOutputType(name) {
    const workflow = await this.getWorkflowByName(name);
    
    // The initialize() method should have already populated this.
    return workflow?.outputType || 'unknown';
  }

  /**
   * Check if a workflow supports LoRA loading (retrieved from cached data)
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<boolean>} - True if workflow supports LoRA, false otherwise
   */
  async hasLoraLoaderSupport(name) {
    const workflow = await this.getWorkflowByName(name);
    
    // The initialize() method should have already populated this.
    return workflow?.hasLoraLoader || false;
  }

  /**
   * Get deployment IDs associated with a specific workflow (retrieved from cached data)
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<Array|null>} - Array of deployment IDs or null if none found
   */
  async getDeploymentIdsByName(name) {
    const workflow = await this.getWorkflowByName(name);
    
    if (!workflow) {
      this.logger.warn(`[getDeploymentIdsByName] Workflow "${name}" not found in cache.`);
      return null;
    }

    // The initialize() and _buildIndexes() methods should have populated this.
    // We expect an array (possibly empty) if the workflow exists.
    // Return null only if the workflow itself wasn't found.
    return workflow.deploymentIds || []; 
  }

  /**
   * Get a specific deployment by ID directly from ComfyUI Deploy
   * 
   * @param {string} deploymentId - Deployment ID
   * @param {boolean} forceRefresh - Whether to force a refresh from the API
   * @returns {Promise<Object|null>} - Deployment object or null if not found
   */
  async getDeploymentById(deploymentId, forceRefresh = false) {
    await this.cacheManager.ensureInitialized(); // Ensure base cache might be loaded

    // Try cache first unless forced refresh (access via manager)
    if (!forceRefresh && this.cacheManager.cache.byDeploymentId.has(deploymentId)) {
      return this.cacheManager.cache.byDeploymentId.get(deploymentId);
    }

    try {
      // Get directly from the API
      const response = await fetch(`${this.apiUrl}/deployment/${deploymentId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to get deployment: ${response.status}`);
      }

      const deployment = await response.json();
      
      // Update cache via manager
      this.cacheManager.cache.byDeploymentId.set(deploymentId, deployment);
      
      return deployment;
    } catch (error) {
      this.logger.error(`Error fetching deployment ${deploymentId}: ${error.message}`);
      // Fall back to cache if available (access via manager)
      return this.cacheManager.cache.byDeploymentId.get(deploymentId) || null;
    }
  }

  /**
   * Get required inputs for a specific workflow
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<Array|null>} - Array of required input names or null if not found
   */
  async getWorkflowInputs(name) {
    const workflow = await this.getWorkflowByName(name);
    return workflow ? workflow.inputs : null;
  }

  /**
   * Check if workflow exists
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<boolean>} - True if workflow exists
   */
  async hasWorkflow(name) {
    return await this.getWorkflowByName(name) !== null;
  }

  /**
   * Get a workflow version by its ID directly from ComfyUI Deploy
   * 
   * @param {string} versionId - Workflow version ID
   * @param {boolean} skipCache - Whether to skip the cache
   * @returns {Promise<Object|null>} - Workflow version object or null if not found
   */
  async getWorkflowVersion(versionId, skipCache = false) {
    if (!this.apiKey) {
      throw new Error('ComfyUI Deploy API key not configured');
    }
    
    // Ensure cache manager *might* have run once, but fetch logic handles API call
    // No strict requirement to wait for full initialization here if just fetching version
    // await this.cacheManager.ensureInitialized(); // Optional: Uncomment if version lookup should wait for full init

    // Check cache first (access via manager)
    if (!skipCache && this.cacheManager.cache.versions.has(versionId)) {
      return this.cacheManager.cache.versions.get(versionId);
    }
    
    try {
      const response = await fetch(`${this.apiUrl}/workflow/${versionId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to get workflow version: ${response.status}`);
      }
      
      const workflow = await response.json();
      
      // Update cache (access via manager)
      this.cacheManager.cache.versions.set(versionId, workflow);
      
      return workflow;
    } catch (error) {
      this.logger.error(`Error fetching workflow version ${versionId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get all available machines
   * 
   * @param {boolean} forceRefresh - Whether to force a refresh from the API
   * @returns {Promise<Array>} - List of all machines
   */
  async getMachines(forceRefresh = false) {
    // Access cache via manager
    // If forcing refresh OR machines aren't cached, delegate fetch to manager
    if (forceRefresh || !this.cacheManager.cache.machines || this.cacheManager.cache.machines.length === 0) {
      try {
          await this.cacheManager._fetchMachines(); // Delegate fetch
      } catch (error) {
          // Log error but potentially continue with stale cache if available
          this.logger.error(`Failed to force-refresh machines: ${error.message}`);
      }
    }
    
    return this.cacheManager.cache.machines; // Return potentially updated cache
  }
  
  /**
   * Get a machine by its ID
   * 
   * @param {string} machineId - Machine ID
   * @returns {Promise<Object|null>} - Machine object or null if not found
   */
  async getMachineById(machineId) {
    const machines = await this.getMachines();
    return machines.find(machine => machine.id === machineId) || null;
  }

  /**
   * Create a new deployment in ComfyUI Deploy
   * 
   * @param {Object} options - Deployment options
   * @param {string} options.workflowVersionId - Workflow version ID to deploy
   * @param {string} options.machineId - Machine ID to deploy to
   * @param {string} options.name - (Optional) Name for the deployment
   * @returns {Promise<Object>} - The created deployment
   */
  async createDeployment(options = {}) {
    return createDeploymentAction(this, options);
  }

  /**
   * Upload a workflow to ComfyUI Deploy
   * 
   * @param {Object} options - Workflow options
   * @param {Object} options.workflow - The workflow definition
   * @param {Object} options.workflowApi - API definition for the workflow (optional)
   * @param {string} options.workflowName - Name for the workflow (optional)
   * @param {string} options.workflowId - Existing workflow ID to update (optional)
   * @returns {Promise<Object>} - Workflow ID and version
   */
  async uploadWorkflow(options = {}) {
    return uploadWorkflowAction(this, options);
  }

  /**
   * Force a reload of all workflows from ComfyUI Deploy
   * 
   * @returns {Promise<Array>} - Updated list of workflows
   */
  async reloadWorkflows() {
    return reloadWorkflowsAction(this);
  }

  /**
   * Invalidate cache for a specific workflow
   * 
   * @param {string} name - Name of the workflow to invalidate
   */
  invalidateWorkflowCache(name) {
    // Call the action, passing the instance
    // This action might need updating later if it directly manipulates cache
    invalidateWorkflowCacheAction(this, name);
  }

  /**
   * Get a fully processed workflow object from the cache by its name.
   * Ensures the service is initialized before retrieving from cache.
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<Object|null>} - Processed workflow object from cache or null if not found.
   */
  async getWorkflowWithDetails(name) {
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[getWorkflowWithDetails] Retrieving cached details for workflow name: ${name}`);
    // Ensure cache is loaded before attempting retrieval
    await this.cacheManager.ensureInitialized(); 

    const standardName = standardizeWorkflowName(name);
    const workflow = this.cacheManager.cache.byName.get(standardName);
    
    if (!workflow) {
      this.logger.warn(`[getWorkflowWithDetails] Workflow with standardized name "${standardName}" (from original: "${name}") not found in cache.`);
      return null;
    }
    
    // The object in the cache should already be fully processed by _fetchAndProcessWorkflowDetails
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[getWorkflowWithDetails] Found cached workflow: ${workflow.name} (ID: ${workflow.id})`);
    return workflow;
  }

  /**
   * Create a default input payload for a workflow using the default values from ComfyUIDeployExternal nodes
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<Object>} - Default input payload with all required inputs pre-populated
   */
  async createDefaultInputPayload(name) {
    // Call the utility function, passing the instance (this)
    return createDefaultInputPayload(this, name);
  }

  /**
   * Validates if an input payload has all required inputs for a workflow
   * 
   * @param {string} name - Name of the workflow
   * @param {Object} inputPayload - The input payload to validate
   * @returns {Promise<Object>} - Object with isValid flag and any missing or invalid inputs
   */
  async validateInputPayload(name, inputPayload) {
     // Call the utility function, passing the instance (this)
    return validateInputPayload(this, name, inputPayload);
  }

  /**
   * Merges user-provided inputs with defaults for any missing required inputs
   * 
   * @param {string} name - Name of the workflow
   * @param {Object} userInputs - User-provided input values
   * @returns {Promise<Object>} - Complete input payload with defaults for missing values
   */
  async mergeWithDefaultInputs(name, userInputs = {}) {
    // Call the utility function, passing the instance (this)
    return mergeWithDefaultInputs(this, name, userInputs);
  }

  /**
   * Prepare a complete payload for workflow execution with validation
   * 
   * @param {string} name - Name of the workflow
   * @param {Object} userInputs - Optional user-provided inputs
   * @returns {Promise<Object>} - Object with payload, validation info, and workflow info
   */
  async prepareWorkflowPayload(name, userInputs = {}) {
    // Call the utility function, passing the instance (this)
    return prepareWorkflowPayload(this, name, userInputs);
  }
}

module.exports = WorkflowsService; 