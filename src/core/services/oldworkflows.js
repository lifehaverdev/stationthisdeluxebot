/**
 * Workflows Service
 * 
 * Manages access to workflow templates and their configurations.
 * Uses ComfyUI Deploy API as the primary and authoritative source of truth.
 * No database dependencies - all workflows are retrieved directly from the API.
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const path = require('path');

// Constants
const DEFAULT_TIMEOUT = 60000; // 60 seconds
const DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const COMFY_DEPLOY_API_URL = 'https://api.comfydeploy.com';

// API Endpoints (updated based on API testing)
const API_ENDPOINTS = {
  DEPLOYMENTS: '/api/deployments',    // GET - List all deployments 
  DEPLOYMENT: '/api/deployment',      // POST - Create deployment
  WORKFLOWS: '/api/workflows',        // GET - List all workflows
  WORKFLOW: '/api/workflow',          // POST - Create workflow
  MACHINES: '/api/machines',          // GET - List all machines
  MACHINE: (id) => `/api/machine/${id}`,  // GET - Get machine by ID
  RUN_QUEUE: '/api/run/deployment/queue', // POST - Submit run
  RUN_STATUS: (id) => `/api/run/${id}`,  // GET - Check run status
};

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
    
    // Caching configuration
    this.cache = {
      enabled: options.cache?.enabled !== false,
      ttl: options.cache?.ttl || DEFAULT_CACHE_TTL,
      lastUpdated: null,
      deployments: [], // Raw deployments from API
      workflows: [],   // Processed workflows
      machines: [],    // Available machines
      versions: new Map(), // Cache for workflow versions
      byName: new Map(), // Index of workflows by name
      byDeploymentId: new Map() // Index of deployments by ID
    };
    
    // Load machine routing configuration
    try {
      const configPath = path.resolve(process.cwd(), 'config/workflow-machine-routing.js');
      this.routingConfig = require(configPath);
      this.logger.info(`Loaded machine routing configuration with ${Object.keys(this.routingConfig.routingRules).length} rules`);
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
    
    this.isInitialized = false;
    this.isLoading = false;
    this._hasInitializedOnce = false; // Add flag to track first successful initialization
  }

  /**
   * Initialize the service by loading all workflows from ComfyUI Deploy
   * 
   * @returns {Promise<Array>} - Loaded workflows
   */
  async initialize() {
    if (this.isLoading) {
      this.logger.info('Workflows already being loaded');
      return this.cache.workflows;
    }

    this.isLoading = true;
    this.logger.info('Loading workflows from ComfyUI Deploy...');

    try {
      await this._fetchAndProcessDeployments();
      await this._fetchMachines();
      await this._fetchWorkflows();
      this._buildIndexes();
      this.isInitialized = true;
      this._hasInitializedOnce = true; // Set flag only on full success
      this.logger.info(`Workflows initialized successfully. Found ${this.cache.workflows.length} workflows and ${this.cache.deployments.length} deployments.`);
      return this.cache.workflows;
    } catch (error) {
      this.logger.error(`Error initializing workflows: ${error.message}`);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Get all available workflows
   * 
   * @returns {Promise<Array>} - List of all workflows
   */
  async getWorkflows() {
    await this._ensureInitialized();
    
    // Check if cache needs refreshing
    if (this._isCacheStale()) {
      try {
        await this._fetchAndProcessDeployments();
        await this._fetchWorkflows();
      } catch (error) {
        this.logger.error(`Failed to refresh workflows: ${error.message}`);
        // Continue with cached data
      }
    }
    
    return this.cache.workflows;
  }

  /**
   * Get a workflow by its name
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<Object|null>} - Workflow object or null if not found
   */
  async getWorkflowByName(name) {
    await this._ensureInitialized();
    
    // Standardize the workflow name
    const standardName = this.standardizeWorkflowName(name);
    this.logger.info(`[getWorkflowByName] Looking up standard name: "${standardName}" (from original: "${name}")`);
    
    // Try to find by standardized name first
    let workflow = this.cache.byName.get(standardName);
    
    // Log cache keys for comparison if not found initially
    if (!workflow) {
        const availableKeys = Array.from(this.cache.byName.keys());
        this.logger.warn(`[getWorkflowByName] Workflow with standard name "${standardName}" not found directly in byName cache. Available keys: ${availableKeys.join(", ")}`);
    }
    
    // If not found by standardized name, try original name as fallback
    if (!workflow && name !== standardName) {
      workflow = this.cache.byName.get(name);
      
      if (workflow) {
        this.logger.info(`Found workflow using original name "${name}" instead of standardized name "${standardName}"`);
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
    await this._ensureInitialized();

    // Try cache first unless forced refresh
    if (!forceRefresh && this.cache.byDeploymentId.has(deploymentId)) {
      return this.cache.byDeploymentId.get(deploymentId);
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
      
      // Update cache
      this.cache.byDeploymentId.set(deploymentId, deployment);
      
      return deployment;
    } catch (error) {
      this.logger.error(`Error fetching deployment ${deploymentId}: ${error.message}`);
      // Fall back to cache if available
      return this.cache.byDeploymentId.get(deploymentId) || null;
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
    
    // Check cache first
    if (!skipCache && this.cache.versions.has(versionId)) {
      return this.cache.versions.get(versionId);
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
      
      // Update cache
      this.cache.versions.set(versionId, workflow);
      
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
    if (forceRefresh || !this.cache.machines || this.cache.machines.length === 0) {
      await this._fetchMachines();
    }
    
    return this.cache.machines;
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
   * Standardize workflow names from any source to consistent internal format
   * 
   * @param {string} workflowName - Original workflow name from any source
   * @returns {string} - Standardized workflow name for internal use
   */
  standardizeWorkflowName(workflowName) {
    if (!workflowName) return '';
    
    // Convert to lowercase
    const lowerName = workflowName.toLowerCase();
    
    // Direct mapping for known workflows based on the mapping document
    const nameMap = {
      // API source names mapping to standardized names
      'text2img': 'text2img',
      'inpaint': 'inpaint',
      'controlnet': 'controlnet',
      'img2img': 'img2img',
      'upscale': 'upscale',
      'lora_train': 'lora_train',
      'toon': 'toon',
      'img2vid': 'img2vid',
      
      // Database source names mapping to standardized names
      'makeimage': 'text2img',
      'train': 'lora_train',
      'tooncraft': 'toon', 
      'video': 'img2vid'
    };
    
    // Return mapped name if it exists
    if (nameMap[lowerName]) {
      return nameMap[lowerName];
    }
    
    // Apply standardization rules for unknown names
    return lowerName
      .replace(/[\s-]+/g, '_')     // Replace spaces and hyphens with underscores
      .replace(/[^a-z0-9_]/g, '')  // Remove any non-alphanumeric or underscore characters
      .replace(/_+/g, '_');        // Replace multiple consecutive underscores with a single one
  }
  
  /**
   * Get appropriate machine for specific workflow based on routing rules
   * 
   * @param {string} workflowName - Name of the workflow
   * @returns {Promise<string|null>} - Machine ID or null if no suitable machine found
   */
  async getMachineForWorkflow(workflowName) {
    const standardizedName = this.standardizeWorkflowName(workflowName);
    
    // Check if we have a specific rule for this workflow
    if (this.routingConfig?.routingRules && this.routingConfig.routingRules[standardizedName]) {
      const machineId = this.routingConfig.routingRules[standardizedName];
      
      // Verify that the machine exists and is ready
      const machine = await this.getMachineById(machineId);
      if (machine && machine.status === 'ready') {
        this.logger.info(`Routing workflow "${standardizedName}" to machine: ${machine.name} (${machineId})`);
        return machineId;
      } else {
        this.logger.info(`Configured machine for "${standardizedName}" (${machineId}) is not available, falling back to default`);
      }
    }
    
    // If no specific rule or the machine isn't available, use default machine
    if (this.routingConfig?.defaultMachine) {
      const defaultMachine = await this.getMachineById(this.routingConfig.defaultMachine);
      if (defaultMachine && defaultMachine.status === 'ready') {
        this.logger.info(`Using default machine for workflow "${standardizedName}": ${defaultMachine.name} (${this.routingConfig.defaultMachine})`);
        return this.routingConfig.defaultMachine;
      }
    }
    
    // If default machine isn't available either, find any ready machine
    const machines = await this.getMachines();
    const readyMachine = machines.find(machine => machine.status === 'ready');
    
    if (readyMachine) {
      this.logger.info(`Using fallback ready machine for workflow "${standardizedName}": ${readyMachine.name} (${readyMachine.id})`);
      return readyMachine.id;
    }
    
    this.logger.info(`No suitable machine found for workflow "${standardizedName}"`);
    return null;
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
    const { workflowVersionId, machineId, name } = options;
    
    if (!workflowVersionId) {
      throw new Error('Workflow version ID is required');
    }
    
    if (!machineId) {
      throw new Error('Machine ID is required');
    }
    
    try {
      const payload = {
        workflow_version_id: workflowVersionId,
        machine_id: machineId
      };
      
      if (name) {
        payload.name = name;
      }
      
      const response = await fetch(`${this.apiUrl}/deployment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create deployment: ${response.status}, message: ${errorText}`);
      }
      
      const deployment = await response.json();
      
      // Update the cache
      await this._fetchAndProcessDeployments();
      
      return deployment;
    } catch (error) {
      this.logger.error(`Error creating deployment: ${error.message}`);
      throw error;
    }
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
    const { workflow, workflowApi, workflowName, workflowId } = options;
    
    if (!workflow) {
      throw new Error('Workflow definition is required');
    }
    
    try {
      const payload = {
        workflow
      };
      
      if (workflowApi) {
        payload.workflow_api = workflowApi;
      }
      
      if (workflowName) {
        payload.workflow_name = workflowName;
      }
      
      if (workflowId) {
        payload.workflow_id = workflowId;
      }
      
      const response = await fetch(`${this.apiUrl}/api/workflow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to upload workflow: ${response.status}, message: ${errorText}`);
      }
      
      const result = await response.json();
      
      // Clear relevant cache entries
      if (workflowName) {
        this.invalidateWorkflowCache(workflowName);
      }
      
      return {
        workflowId: result.workflow_id,
        version: result.version
      };
    } catch (error) {
      this.logger.error(`Error uploading workflow: ${error.message}`);
      throw error;
    }
  }

  /**
   * Force a reload of all workflows from ComfyUI Deploy
   * 
   * @returns {Promise<Array>} - Updated list of workflows
   */
  async reloadWorkflows() {
    this._clearCache();
    return await this._fetchAndProcessDeployments();
  }

  /**
   * Invalidate cache for a specific workflow
   * 
   * @param {string} name - Name of the workflow to invalidate
   */
  invalidateWorkflowCache(name) {
    if (name && this.cache.byName.has(name)) {
      const workflow = this.cache.byName.get(name);
      
      // Remove from byName index
      this.cache.byName.delete(name);
      
      // Remove from workflows array
      const index = this.cache.workflows.findIndex(w => w.name === name);
      if (index !== -1) {
        this.cache.workflows.splice(index, 1);
      }
      
      // Remove deployment IDs from byDeploymentId
      if (workflow.deploymentIds) {
        workflow.deploymentIds.forEach(id => {
          this.cache.byDeploymentId.delete(id);
        });
      }
    }
  }

  /**
   * Clear all cache data
   * @private
   */
  _clearCache() {
    this.cache.lastUpdated = null;
    this.cache.deployments = [];
    this.cache.workflows = [];
    this.cache.machines = [];
    this.cache.versions.clear();
    this.cache.byName.clear();
    this.cache.byDeploymentId.clear();
    this.isInitialized = false;
  }

  /**
   * Attempt to get workflow JSON from available deployments
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object|null>} - Workflow JSON if found, otherwise null
   * @private
   */
  async _getWorkflowJsonFromDeployments(workflowId) {
    this.logger.info(`[_getWorkflowJsonFromDeployments] Attempting for workflow ID: ${workflowId}`);
    
    try {
       // Get all deployments (use the cached raw deployments)
       const deployments = this.cache.deployments;
       
       // First look for deployments specifically for this workflow
       const matchingDeployments = deployments.filter(deployment => {
         return deployment.workflow_version && 
                deployment.workflow_version.workflow && 
                deployment.workflow_version.workflow.id === workflowId;
       });
       
       this.logger.info(`[_getWorkflowJsonFromDeployments] Found ${matchingDeployments.length} deployments linked to workflow ID: ${workflowId}`);
       
       if (matchingDeployments.length > 0) {
         // Sort by newest first
         const sortedDeployments = matchingDeployments.sort((a, b) => {
           return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
         });
         
         // Try to extract workflow JSON from each deployment
         for (const deployment of sortedDeployments) {
           if (deployment.workflow_version && 
               deployment.workflow_version.workflow_json && 
               deployment.workflow_version.workflow_json.nodes) {
             this.logger.info(`[_getWorkflowJsonFromDeployments] Found workflow_json in deployment ${deployment.id}`);
             return deployment.workflow_version.workflow_json;
           }
           
           if (deployment.workflow_version && 
               deployment.workflow_version.workflow_data && 
               deployment.workflow_version.workflow_data.nodes) {
             this.logger.info(`[_getWorkflowJsonFromDeployments] Found workflow_data in deployment ${deployment.id}`);
             return deployment.workflow_version.workflow_data;
           }
           
           if (deployment.workflow_version && 
               deployment.workflow_version.version_id) {
             // Try to get the version
             this.logger.info(`[_getWorkflowJsonFromDeployments] Trying to get version details for version ID: ${deployment.workflow_version.version_id}`);
             // Use a temporary ComfyUIService instance, passing the logger
             const ComfyUIService = require('./comfyui'); 
             const comfyui = new ComfyUIService({ logger: this.logger });
             
             try {
               const versionDetails = await comfyui.getWorkflowVersion(deployment.workflow_version.version_id);
               if (versionDetails && versionDetails.workflow_json && versionDetails.workflow_json.nodes) {
                 this.logger.info(`[_getWorkflowJsonFromDeployments] Found workflow_json in fetched version: ${deployment.workflow_version.version_id}`);
                 return versionDetails.workflow_json;
               }
             } catch (error) {
               this.logger.warn(`[_getWorkflowJsonFromDeployments] Error getting version details for ${deployment.workflow_version.version_id}: ${error.message}`);
             }
           }
         }
       }
       
       // If we get here, try a broader approach - look at all deployments to find similar workflows
       // This fallback logic is less reliable now that we fetch workflows directly.
       // Consider removing or refining if it causes issues.
       this.logger.info(`[_getWorkflowJsonFromDeployments] No direct match found in deployments. Fallback search by name is less reliable and might be removed.`);
       
       // We don't have the workflow name readily available here if only ID is passed.
       // Skip the name-based fallback for now as it depends on the main workflow cache.
       /* 
       const workflow = await this.getWorkflowByName(workflowId); // This depends on the main cache being ready
       if (!workflow) {
         this.logger.warn(`[_getWorkflowJsonFromDeployments] Could not find workflow with ID ${workflowId} in cache to perform name-based fallback.`);
         return null;
       }
       
       const workflowName = workflow.name.toLowerCase();
       const similarDeployments = deployments.filter(deployment => {
         const deploymentName = (deployment.name || '').toLowerCase();
         const workflowVersionName = (deployment.workflow_version?.workflow?.name || '').toLowerCase();
         
         return deploymentName.includes(workflowName) || workflowVersionName.includes(workflowName);
       });
       
       this.logger.info(`[_getWorkflowJsonFromDeployments] Found ${similarDeployments.length} deployments with potentially similar names.`);
       
       // Try to extract workflow JSON from similar deployments
       for (const deployment of similarDeployments) {
         if (deployment.workflow_version && 
             deployment.workflow_version.workflow_json && 
             deployment.workflow_version.workflow_json.nodes) {
           this.logger.info(`[_getWorkflowJsonFromDeployments] Found workflow_json in similarly named deployment: ${deployment.id}`);
           return deployment.workflow_version.workflow_json;
         }
       } 
       */
    } catch (error) {
      this.logger.error(`[_getWorkflowJsonFromDeployments] Error during process for workflow ID ${workflowId}: ${error.message}`);
    }
    
    return null;
  }

  /**
   * Get a fully processed workflow object from the cache by its name.
   * Ensures the service is initialized before retrieving from cache.
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<Object|null>} - Processed workflow object from cache or null if not found.
   */
  async getWorkflowWithDetails(name) {
    this.logger.info(`[getWorkflowWithDetails] Retrieving cached details for workflow name: ${name}`);
    // Ensure cache is loaded before attempting retrieval
    await this._ensureInitialized(); 

    const standardName = this.standardizeWorkflowName(name);
    const workflow = this.cache.byName.get(standardName);
    
    if (!workflow) {
      this.logger.warn(`[getWorkflowWithDetails] Workflow with standardized name "${standardName}" (from original: "${name}") not found in cache.`);
      return null;
    }
    
    // The object in the cache should already be fully processed by _fetchAndProcessWorkflowDetails
    this.logger.info(`[getWorkflowWithDetails] Found cached workflow: ${workflow.name} (ID: ${workflow.id})`);
    return workflow;
  }

  /**
   * Parse a workflow object from ComfyUI Deploy API data
   * 
   * @param {Object} workflow - Raw workflow data from API
   * @returns {Object} - Parsed workflow object
   * @private
   */
  _parseWorkflow(workflow) {
    // Extract workflow name, defaulting to ID if not available
    const name = workflow.name || workflow.id;
    
    // Extract workflow API for inputs
    const workflowApi = workflow.workflow_api || {};
    
    // Parse inputs from the workflow API
    const inputs = Object.keys(workflowApi.inputs || {});
    
    // Get deployment IDs
    const deploymentIds = Array.isArray(workflow.deployments) 
      ? workflow.deployments.map(d => d.id)
      : [];
    
    // Get versions
    const versions = Array.isArray(workflow.workflow_versions)
      ? workflow.workflow_versions.map(v => ({
          id: v.id,
          created_at: v.created_at,
          version_number: v.version_number
        }))
      : [];
    
    // Extract the workflow JSON structure if available
    const workflowJson = workflow.workflow_json || workflow.workflow_data || {};
    
    return {
      id: workflow.id,
      name,
      displayName: workflow.display_name || name,
      description: workflow.description || '',
      inputs,
      deploymentIds,
      versions,
      createdAt: workflow.created_at,
      updatedAt: workflow.updated_at,
      workflow_json: workflowJson,  // Include the workflow JSON structure
      raw: workflow // Include the raw data for reference
    };
  }

  /**
   * PRIVATE: Fetches full details for a single workflow summary, parses it, 
   * and prepares it for caching. Does NOT use ensureInitialized or getWorkflowByName.
   * This is intended for use ONLY during the initial loading process.
   * 
   * @param {Object} workflowSummary - Raw workflow summary object from the API list.
   * @returns {Promise<Object|null>} - Fully processed workflow object ready for caching, or null on failure.
   * @private
   */
  async _fetchAndProcessWorkflowDetails(workflowSummary) {
    const workflowId = workflowSummary.id;
    const originalName = workflowSummary.name;
    const standardName = this.standardizeWorkflowName(originalName);
    
    this.logger.info(`[_fetchAndProcessWorkflowDetails] Starting for: ${originalName} (ID: ${workflowId}, Standard: ${standardName})`);

    if (!workflowId || !originalName) {
        this.logger.warn(`[_fetchAndProcessWorkflowDetails] Skipping due to missing ID or name in summary: ${JSON.stringify(workflowSummary)}`);
        return null;
    }

    try {
        const ComfyUIService = require('./comfyui');
        const comfyui = new ComfyUIService({ logger: this.logger }); // Pass the service logger
      
        // Base structure for the workflow object to be cached
        const processedWorkflow = {
            id: workflowId,
            name: originalName, 
            standardName: standardName, // Store the standardized name
            displayName: workflowSummary.display_name || originalName,
            description: workflowSummary.description || '',
            inputs: [], // Will be replaced by requiredInputs later
            deploymentIds: [], // Will be populated by _buildIndexes
            versions: [],
            createdAt: workflowSummary.created_at,
            updatedAt: workflowSummary.updated_at,
            workflow_json: {}, // Will be populated below
            requiredInputs: [],
            outputType: 'unknown',
            hasLoraLoader: false,
            rawSummary: workflowSummary // Keep original summary for reference if needed
        };
      
        // --- Fetching Logic (adapted from old getWorkflowWithDetails) ---

        // 1. Try comfyui.getWorkflowDetails
        this.logger.info(`[_fetchAndProcessWorkflowDetails] Attempting comfyui.getWorkflowDetails for ID: ${workflowId}`);
        let workflowDetails = null;
        try {
            workflowDetails = await comfyui.getWorkflowDetails(workflowId);
            this.logger.info(`[_fetchAndProcessWorkflowDetails] Completed comfyui.getWorkflowDetails for ID: ${workflowId}`);
        } catch (detailsError) {
             this.logger.warn(`[_fetchAndProcessWorkflowDetails] Error during comfyui.getWorkflowDetails for ID ${workflowId}: ${detailsError.message}`);
             // Continue, we might find JSON elsewhere
        }

        if (workflowDetails) {
            processedWorkflow.versions = workflowDetails.workflow_versions || [];
            // Check if we already have a usable workflow JSON
            if (workflowDetails.workflow_json && workflowDetails.workflow_json.nodes) {
                this.logger.info(`[_fetchAndProcessWorkflowDetails] Found workflow_json in getWorkflowDetails response for ${workflowId}.`);
                processedWorkflow.workflow_json = workflowDetails.workflow_json;
            }
        }
      
        // 2. If no JSON yet, try comfyui.getWorkflowContent
        if (!processedWorkflow.workflow_json || !processedWorkflow.workflow_json.nodes) {
            this.logger.info(`[_fetchAndProcessWorkflowDetails] No workflow_json yet, attempting comfyui.getWorkflowContent for ID: ${workflowId}`);
            let workflowContent = null;
            try {
                 workflowContent = await comfyui.getWorkflowContent(workflowId);
                 this.logger.info(`[_fetchAndProcessWorkflowDetails] Completed comfyui.getWorkflowContent for ID: ${workflowId}`);
            } catch (contentError) {
                 this.logger.warn(`[_fetchAndProcessWorkflowDetails] Error during comfyui.getWorkflowContent for ID ${workflowId}: ${contentError.message}`);
                 // Continue
            }
           
            if (workflowContent && workflowContent.nodes) {
                this.logger.info(`[_fetchAndProcessWorkflowDetails] Found workflow_json via getWorkflowContent for ${workflowId}.`);
                processedWorkflow.workflow_json = workflowContent;
            }
        }
      
        // 3. If still no JSON, try getting it from deployments (using ID directly)
        if (!processedWorkflow.workflow_json || !processedWorkflow.workflow_json.nodes) {
            this.logger.info(`[_fetchAndProcessWorkflowDetails] Still no workflow_json, attempting _getWorkflowJsonFromDeployments for ID: ${workflowId}`);
            let workflowJsonFromDeployments = null;
            try {
                 workflowJsonFromDeployments = await this._getWorkflowJsonFromDeployments(workflowId); // Pass ID directly
                 this.logger.info(`[_fetchAndProcessWorkflowDetails] Completed _getWorkflowJsonFromDeployments for ID: ${workflowId}`);
            } catch (deploymentsError) {
                 this.logger.warn(`[_fetchAndProcessWorkflowDetails] Error during _getWorkflowJsonFromDeployments for ID ${workflowId}: ${deploymentsError.message}`);
                 // Continue
            }

            if (workflowJsonFromDeployments && workflowJsonFromDeployments.nodes) {
                this.logger.info(`[_fetchAndProcessWorkflowDetails] Found workflow_json via _getWorkflowJsonFromDeployments for ${workflowId}.`);
                processedWorkflow.workflow_json = workflowJsonFromDeployments;
            } else {
                this.logger.warn(`[_fetchAndProcessWorkflowDetails] Could not retrieve workflow_json structure from any source for ${workflowId}.`);
            }
        }

        // --- Parsing Logic ---
        if (processedWorkflow.workflow_json && processedWorkflow.workflow_json.nodes) {
            this.logger.info(`[_fetchAndProcessWorkflowDetails] Parsing workflow structure for ${standardName} (ID: ${workflowId})`);
            try {
                const structureInfo = this.parseWorkflowStructure(processedWorkflow.workflow_json);
                processedWorkflow.requiredInputs = structureInfo.externalInputNodes;
                processedWorkflow.outputType = structureInfo.outputType;
                processedWorkflow.hasLoraLoader = structureInfo.hasLoraLoader;
                // Replace legacy 'inputs' with structured requiredInputs
                processedWorkflow.inputs = processedWorkflow.requiredInputs.map(i => i.inputName); 
                this.logger.info(`[_fetchAndProcessWorkflowDetails] Successfully parsed structure for ${standardName}. Inputs: ${processedWorkflow.requiredInputs.length}, Output: ${processedWorkflow.outputType}, LoRA: ${processedWorkflow.hasLoraLoader}`);
            } catch(parseError) {
                this.logger.error(`[_fetchAndProcessWorkflowDetails] Error parsing workflow structure for ${standardName} (ID: ${workflowId}): ${parseError.message}`);
                // Keep defaults: requiredInputs=[], outputType='unknown', hasLoraLoader=false
                processedWorkflow.inputs = [];
            }
        } else {
            this.logger.warn(`[_fetchAndProcessWorkflowDetails] Workflow details fetched for ${standardName}, but no usable workflow_json found. Cannot parse structure. ID: ${workflowId}`);
            // Keep defaults
             processedWorkflow.inputs = [];
        }
      
        // We don't need to store the potentially huge workflow_json in the main cache object
        // It was only needed temporarily for parsing. The raw deployments cache might still hold it.
        // delete processedWorkflow.workflow_json; // Consider removing if memory becomes an issue

        this.logger.info(`[_fetchAndProcessWorkflowDetails] Finished processing for: ${originalName} (ID: ${workflowId})`);
        return processedWorkflow;

    } catch (error) {
      // Catch any unexpected errors during the process for this specific workflow
      this.logger.error(`[_fetchAndProcessWorkflowDetails] Unexpected error processing workflow ${originalName} (ID: ${workflowId}): ${error.message}`, { stack: error.stack });
      return null; // Return null to indicate failure for this specific workflow
    }
  }

  /**
   * Fetch direct workflow information from ComfyUI Deploy API
   * 
   * @returns {Promise<Array>} - List of workflows
   * @private
   */
  async _fetchWorkflows() {
    this.logger.info('Fetching workflows list...');
    
    let workflowsList = [];
    try {
        const response = await fetch(`${this.apiUrl}${API_ENDPOINTS.WORKFLOWS}`, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json'
          },
          timeout: this.timeout
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to fetch workflows list: ${response.status} - ${errorText}`);
        }
        
        workflowsList = await response.json();
        this.logger.info(`Fetched ${workflowsList.length} workflow summaries.`);

    } catch (listError) {
        this.logger.error(`Error fetching workflow list from API: ${listError.message}`);
        // If we can't get the list, we can't proceed with fetching details.
        throw listError; // Re-throw to halt initialization if the list fails
    }
    
    const processedWorkflows = [];
    const fetchPromises = [];

    for (const workflowSummary of workflowsList) {
        // Call the new helper function for each summary
        fetchPromises.push(
            this._fetchAndProcessWorkflowDetails(workflowSummary) 
                .then(processedWorkflow => {
                    if (processedWorkflow) {
                        // Add the successfully processed workflow to our list
                        processedWorkflows.push(processedWorkflow);
                    } else {
                         // Logging for failure is handled inside _fetchAndProcessWorkflowDetails
                         this.logger.warn(`[_fetchWorkflows] Failed to process details for workflow summary: ${JSON.stringify(workflowSummary.name || workflowSummary.id)}`);
                    }
                })
                // We catch unexpected errors within the helper now, 
                // so we don't strictly need a catch here unless the helper itself throws.
                // .catch(error => { // Example if helper could throw directly
                //     this.logger.error(`[_fetchWorkflows] Unexpected error processing workflow summary ${workflowSummary.id}: ${error.message}`);
                // })
        );
    }

    // Wait for all detail fetching and processing to complete
    const results = await Promise.allSettled(fetchPromises); 
    
    // Optional: Log summary of settled promises
    const fulfilledCount = results.filter(r => r.status === 'fulfilled').length;
    const rejectedCount = results.filter(r => r.status === 'rejected').length;
    this.logger.info(`[_fetchWorkflows] Detail processing settled. Fulfilled: ${fulfilledCount}, Rejected: ${rejectedCount}, Total Processed Objects: ${processedWorkflows.length}`);


    // Update the main workflow cache with the successfully processed workflows
    this.cache.workflows = processedWorkflows;
    
    // NOTE: _buildIndexes() is called separately at the end of initialize()
    
    this.logger.info(`[_fetchWorkflows] Finished processing workflow details. Stored ${this.cache.workflows.length} workflows in cache.`);
}

  /**
   * Fetch all deployments from ComfyUI Deploy and process them
   * 
   * @returns {Promise<Array>} - Processed workflows
   * @private
   */
  async _fetchAndProcessDeployments() {
    try {
      this.logger.info('Fetching deployments from ComfyUI Deploy API...');
      
      // Use the correct API endpoint
      const url = `${this.apiUrl}${API_ENDPOINTS.DEPLOYMENTS}`;
      this.logger.info(`Using API URL: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch deployments (${response.status}): ${errorText}`);
      }
      
      const deployments = await response.json();
      this.logger.info(`Fetched ${deployments.length} deployments successfully`);
      
      // Store raw deployments
      this.cache.deployments = deployments;
      
      // Return the raw deployments, not processed workflows
      return deployments;
    } catch (error) {
      this.logger.error(`Error fetching deployments: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch all machines from ComfyUI Deploy
   * 
   * @returns {Promise<Array>} - List of machines
   * @private
   */
  async _fetchMachines() {
    try {
      this.logger.info('Fetching machines from ComfyUI Deploy API...');
      
      // Use the correct API endpoint
      const url = `${this.apiUrl}${API_ENDPOINTS.MACHINES}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch machines (${response.status}): ${errorText}`);
      }
      
      const machines = await response.json();
      this.logger.info(`Fetched ${machines.length} machines successfully`);
      
      // Update cache
      this.cache.machines = machines;
      
      return machines;
    } catch (error) {
      this.logger.error(`Error fetching machines: ${error.message}`);
      return this.cache.machines; // Return existing cached machines if available
    }
  }

  /**
   * Process raw deployments into workflow objects
   * 
   * @param {Array} deployments - Raw deployments from API
   * @returns {Promise<Array>} - Processed workflows
   * @private
   */
  async _processDeployments(deployments) {
    this.logger.info(`Processing ${deployments.length} deployments...`);
    this.cache.deployments = deployments; // Store raw deployments
    
    // Clear existing deployment index before processing
    this.cache.byDeploymentId.clear(); 

    for (const deployment of deployments) {
      if (deployment && deployment.id) {
          // Index deployment by its ID
          this.cache.byDeploymentId.set(deployment.id, deployment);
      } else {
          this.logger.warn(`Skipping deployment due to missing ID: ${JSON.stringify(deployment)}`);
      }
    }
    this.logger.info(`Indexed ${this.cache.byDeploymentId.size} deployments by ID.`);

    // Note: Linking deployments to workflows (populating workflow.deploymentIds)
    // now happens within _buildIndexes, which runs after both deployments 
    // and workflows (with details) are fetched.
  }

  /**
   * Build indexes for fast lookups
   * @private
   */
  _buildIndexes() {
    this.logger.info('Building workflow indexes...');
    this.cache.byName.clear();
    
    // Reset deployment IDs on all cached workflows first
    this.cache.workflows.forEach(workflow => {
        workflow.deploymentIds = []; 
    });

    // Index workflows by standardized name
    this.cache.workflows.forEach(workflow => {
      // Use the standardName field that was pre-calculated during _fetchAndProcessWorkflowDetails
      if (workflow && workflow.standardName) { 
        const standardName = workflow.standardName; // Use the cached standard name
        
        // Handle potential name collisions - log a warning
        if (this.cache.byName.has(standardName)) {
            const existingWorkflow = this.cache.byName.get(standardName);
            this.logger.warn(`Workflow name collision detected for standardized name "${standardName}". Original names: "${existingWorkflow.name}" (ID: ${existingWorkflow.id}) and "${workflow.name}" (ID: ${workflow.id}). Overwriting with the latter.`);
        }
        this.cache.byName.set(standardName, workflow);
        
        // Initialize deploymentIds array if it doesn't exist (should be redundant now)
        // if (!workflow.deploymentIds) {
        //   workflow.deploymentIds = [];
        // }

      } else {
         this.logger.warn(`Skipping workflow indexing due to missing standardName or object: ${JSON.stringify(workflow)}`);
      }
    });
    
    this.logger.info(`Indexed ${this.cache.byName.size} workflows by standardized name.`);

    // Link Deployments to Workflows
    this.logger.info('Linking deployments to workflows...');
    let linkedCount = 0;
    this.cache.deployments.forEach(deployment => {
        if (!deployment || !deployment.workflow_id || !deployment.id) {
            // this.logger.warn(`Skipping deployment linking: Missing workflow_id or deployment.id. Deployment: ${JSON.stringify(deployment)}`);
            return; // Skip if essential info is missing
        }

        // Find the corresponding workflow in the cache (using the main cache `workflows` array)
        const targetWorkflow = this.cache.workflows.find(wf => wf.id === deployment.workflow_id);

        if (targetWorkflow) {
            // Ensure deploymentIds array exists (should be initialized already)
            if (!targetWorkflow.deploymentIds) {
                this.logger.warn(`Initializing missing deploymentIds array for workflow "${targetWorkflow.name}" (ID: ${targetWorkflow.id}) during linking.`);
                targetWorkflow.deploymentIds = [];
            }
            
            // Add the deployment ID if not already present
            if (!targetWorkflow.deploymentIds.includes(deployment.id)) {
              targetWorkflow.deploymentIds.push(deployment.id);
              linkedCount++;
            }
        } else {
             this.logger.warn(`Could not find workflow with ID "${deployment.workflow_id}" in cache to link deployment "${deployment.id}" (Name: ${deployment.name || 'N/A'}).`);
        }
    });
    this.logger.info(`Successfully linked ${linkedCount} deployment IDs to workflows.`);
  }

  /**
   * Check if the cache is stale and needs refreshing
   * 
   * @returns {boolean} - True if cache is stale
   * @private
   */
  _isCacheStale() {
    if (!this.cache.lastUpdated) {
      return true;
    }
    
    const now = Date.now();
    const age = now - this.cache.lastUpdated;
    
    return age > this.cache.ttl;
  }

  /**
   * Ensure the service is initialized
   * 
   * @returns {Promise<void>}
   * @private
   */
  async _ensureInitialized() {
    // Only attempt initialization if it has *never* completed successfully before
    // and we are not currently loading.
    if (!this.isInitialized && !this.isLoading && !this._hasInitializedOnce) { 
      await this.initialize();
    } else if (this.isLoading) {
      // Wait for initialization to complete
      while (this.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Parse workflow JSON structure to extract useful information about nodes
   * 
   * @param {Object} workflowJson - The complete workflow JSON structure
   * @returns {Object} - Parsed workflow structure information
   */
  parseWorkflowStructure(workflowJson) {
    if (!workflowJson || typeof workflowJson !== 'object' || !workflowJson.nodes) {
      return {
        nodeCount: 0,
        nodeTypes: [],
        hasPromptNode: false,
        hasKSamplerNode: false,
        inputNodes: [],
        outputNodes: [],
        externalInputNodes: [], // Added specifically for ComfyUIDeployExternal nodes
        hasLoraLoader: false    // Flag for MultiLoraLoader presence
      };
    }
    
    const nodeTypes = new Set();
    const inputNodes = [];
    const outputNodes = [];
    const externalInputNodes = []; // Store ComfyUIDeployExternal nodes
    let hasPromptNode = false;
    let hasKSamplerNode = false;
    let hasLoraLoader = false;   // Flag for MultiLoraLoader
    let outputType = 'unknown';  // Default output type
    
    // Process all nodes
    Object.entries(workflowJson.nodes).forEach(([nodeId, node]) => {
      // More robust node type inference
      let nodeType = node.class_type;
      
      // Check if node has a type property directly
      if (!nodeType && node.type) {
        nodeType = node.type;
      }
      
      // Check inputs for type information if class_type is missing
      if (!nodeType && node.inputs) {
        const inputNames = Object.values(node.inputs)
          .map(input => typeof input === 'object' ? input.name : null)
          .filter(Boolean);
        
        // Check for common node patterns
        if (inputNames.includes('noise_seed') && inputNames.includes('steps')) {
          nodeType = 'KSampler';
          hasKSamplerNode = true;
        }
        else if (inputNames.includes('text') && inputNames.includes('clip')) {
          nodeType = 'CLIPTextEncode';
          hasPromptNode = true;
        }
        else if (inputNames.includes('samples') && inputNames.includes('vae')) {
          nodeType = 'VAEDecode';
        }
        else if (inputNames.includes('images') && inputNames.includes('filename_prefix')) {
          nodeType = 'SaveImage';
        }
        else if (inputNames.includes('model') && inputNames.includes('clip')) {
          nodeType = 'CheckpointLoader';
        }
        else if (inputNames.includes('width') && inputNames.includes('height') && inputNames.includes('batch_size')) {
          nodeType = 'EmptyLatentImage';
        }
        else if (inputNames.includes('conditioning_1') && inputNames.includes('conditioning_2')) {
          nodeType = 'ConditioningCombine';
        }
        
        // Create a summary of input types if still no match
        if (!nodeType) {
          const inputTypes = Object.values(node.inputs)
            .map(input => typeof input === 'object' ? input.type : null)
            .filter(Boolean);
          
          if (inputTypes.length > 0) {
            nodeType = `Node_With_${inputTypes.join('_')}`;
          }
        }
      }
      
      // Use node ID as fallback if type is still not determined
      nodeType = nodeType || `Unknown_${nodeId}`;
      
      // Add to node types set
      nodeTypes.add(nodeType);
      
      // Detect MultiLoraLoader nodes for loraTrigger system
      if (nodeType.includes('MultiLoraLoader') || 
          (node.type && node.type.includes('MultiLoraLoader'))) {
        hasLoraLoader = true;
      }
      
      // Check for ComfyUIDeployExternal input nodes
      if (nodeType.startsWith('ComfyUIDeployExternal') || 
          (node.type && node.type.startsWith('ComfyUIDeployExternal'))) {
        // Extract the specific input type and details
        const inputType = nodeType.replace('ComfyUIDeployExternal', '').toLowerCase();
        const widgetValues = node.widgets_values || [];
        const inputName = widgetValues[0] || `input_${nodeId}`;
        const defaultValue = widgetValues[1] || null;
        
        externalInputNodes.push({
          id: nodeId,
          type: nodeType,
          inputType, 
          inputName,
          defaultValue
        });
      }
      
      // Check for input nodes based on the determined type
      if (nodeType === 'CLIPTextEncode' || nodeType.includes('TextEncode')) {
        hasPromptNode = true;
        inputNodes.push({
          id: nodeId,
          type: nodeType,
          inputs: node.inputs || {}
        });
      }
      else if (nodeType === 'CheckpointLoader' || nodeType.includes('ModelLoader')) {
        inputNodes.push({
          id: nodeId,
          type: nodeType,
          inputs: node.inputs || {}
        });
      }
      else if (nodeType === 'EmptyLatentImage') {
        inputNodes.push({
          id: nodeId,
          type: nodeType,
          inputs: node.inputs || {}
        });
      }
      
      // Check for sampler nodes
      if (nodeType === 'KSampler' || nodeType.includes('Sampler')) {
        hasKSamplerNode = true;
      }
      
      // Identify nodes that likely produce output and determine workflow type
      if (nodeType === 'SaveImage' || nodeType.includes('SaveImage')) {
        outputType = 'image';
        outputNodes.push({
          id: nodeId,
          type: nodeType,
          outputType: 'image',
          inputs: node.inputs || {}
        });
      }
      else if (nodeType === 'VHS_VideoCombine' || nodeType.includes('VideoCombine')) {
        outputType = 'video';
        outputNodes.push({
          id: nodeId,
          type: nodeType,
          outputType: 'video',
          inputs: node.inputs || {}
        });
      }
      else if (nodeType.includes('SaveGIF') || nodeType.includes('AnimateDiff')) {
        outputType = 'animation';
        outputNodes.push({
          id: nodeId,
          type: nodeType,
          outputType: 'animation',
          inputs: node.inputs || {}
        });
      }
      else if (
        nodeType === 'PreviewImage' ||
        nodeType.includes('Preview') ||
        nodeType.includes('LoadImage') ||
        nodeType === 'VAEDecode'
      ) {
        outputNodes.push({
          id: nodeId,
          type: nodeType,
          outputType: 'image',
          inputs: node.inputs || {}
        });
      }
    });
    
    return {
      nodeCount: Object.keys(workflowJson.nodes || {}).length,
      nodeTypes: Array.from(nodeTypes),
      hasPromptNode,
      hasKSamplerNode,
      hasLoraLoader,
      outputType,
      inputNodes,
      outputNodes,
      externalInputNodes,
      // Don't store the full workflow json to save memory
      // workflow: workflowJson  
    };
  }

  /**
   * Create a default input payload for a workflow using the default values from ComfyUIDeployExternal nodes
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<Object>} - Default input payload with all required inputs pre-populated
   */
  async createDefaultInputPayload(name) {
    // First try to get the cached inputs
    let requiredInputs = await this.getWorkflowRequiredInputs(name);
    
    // If we don't have any inputs yet, try to get them from the workflow JSON directly
    if (!requiredInputs || requiredInputs.length === 0) {
      // Get detailed workflow information
      const workflowWithDetails = await this.getWorkflowWithDetails(name);
      
      if (workflowWithDetails && workflowWithDetails.workflow_json && workflowWithDetails.workflow_json.nodes) {
        // Parse the workflow structure to find external input nodes
        const workflowStructure = this.parseWorkflowStructure(workflowWithDetails.workflow_json);
        requiredInputs = workflowStructure.externalInputNodes;
        
        // Store the input nodes for future use
        if (workflowWithDetails && !workflowWithDetails.requiredInputs) {
          workflowWithDetails.requiredInputs = requiredInputs;
          workflowWithDetails.outputType = workflowStructure.outputType;
          workflowWithDetails.hasLoraLoader = workflowStructure.hasLoraLoader;
        }
      }
    }
    
    if (!requiredInputs || requiredInputs.length === 0) {
      return {};
    }
    
    // Build the input payload using default values
    const payload = {};
    
    requiredInputs.forEach(input => {
      // Use the input name as the key
      const inputName = input.inputName;
      
      // Use the default value if available, otherwise provide type-appropriate defaults
      if (input.defaultValue !== null && input.defaultValue !== undefined) {
        payload[inputName] = input.defaultValue;
      } else {
        // Provide sensible defaults based on input type
        switch (input.inputType.toLowerCase()) {
          case 'text':
            payload[inputName] = '';
            break;
          case 'number':
            payload[inputName] = 1.0;
            break;
          case 'numberint':
            payload[inputName] = 1;
            break;
          case 'boolean':
            payload[inputName] = false;
            break;
          case 'image':
            payload[inputName] = null; // No default for images
            break;
          default:
            payload[inputName] = null;
        }
      }
    });
    
    return payload;
  }

  /**
   * Validates if an input payload has all required inputs for a workflow
   * 
   * @param {string} name - Name of the workflow
   * @param {Object} inputPayload - The input payload to validate
   * @returns {Promise<Object>} - Object with isValid flag and any missing or invalid inputs
   */
  async validateInputPayload(name, inputPayload) {
    const requiredInputs = await this.getWorkflowRequiredInputs(name);
    const requiredInputMap = new Map(requiredInputs.map(i => [i.inputName, i]));

    if (!requiredInputs) {
      // Should ideally not happen if getWorkflowRequiredInputs works, but handle defensively
      return { isValid: true, missingInputs: [], invalidInputs: [], unknownInputs: [] };
    }
    
    const missingRequiredInputs = [];
    const invalidTypeInputs = [];
    const unknownInputs = [];
    
    // 1. Check inputs provided by the user
    for (const inputName in inputPayload) {
      const value = inputPayload[inputName];
      
      // Check if the provided input is actually defined in the workflow
      if (!requiredInputMap.has(inputName)) {
        unknownInputs.push(inputName);
        continue; // Skip type validation for unknown inputs
      }
      
      // Input is known, proceed with type validation
      const inputDefinition = requiredInputMap.get(inputName);
      let typeValid = true;
      let reason = '';

      switch (inputDefinition.inputType.toLowerCase()) {
        case 'text':
          // Text is generally always valid unless we add constraints
          break;
        case 'number':
          if (typeof value !== 'number' && (value === null || value === undefined || isNaN(parseFloat(value)))) {
            typeValid = false;
            reason = 'Must be a valid number';
          }
          break;
        case 'numberint':
          if (typeof value !== 'number' && (value === null || value === undefined || isNaN(parseInt(value)))) {
            typeValid = false;
            reason = 'Must be a valid integer';
          } else if (typeof value === 'number' && !Number.isInteger(value)) {
            typeValid = false;
            reason = 'Must be an integer, not a decimal number';
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean') {
            typeValid = false;
            reason = 'Must be a boolean (true/false)';
          }
          break;
        case 'image':
          // Add specific image validation if needed (e.g., URL format)
          break;
        // Add other types as needed
      }
      
      if (!typeValid) {
        invalidTypeInputs.push({ name: inputName, reason });
      }
    }

    // 2. Check if any truly required inputs (those without defaults) are missing
    for (const input of requiredInputs) {
      const inputName = input.inputName;
      const hasDefault = input.defaultValue !== null && input.defaultValue !== undefined;
      
      // If the input has NO default AND it wasn't provided by the user...
      if (!hasDefault && !(inputName in inputPayload)) {
        missingRequiredInputs.push(inputName);
      }
    }
    
    return {
      isValid: missingRequiredInputs.length === 0 && invalidTypeInputs.length === 0 && unknownInputs.length === 0,
      missingRequiredInputs, // Inputs required by workflow (no default) but not provided
      invalidTypeInputs,   // Inputs provided but with wrong type
      unknownInputs        // Inputs provided but not defined in workflow
    };
  }

  /**
   * Merges user-provided inputs with defaults for any missing required inputs
   * 
   * @param {string} name - Name of the workflow
   * @param {Object} userInputs - User-provided input values
   * @returns {Promise<Object>} - Complete input payload with defaults for missing values
   */
  async mergeWithDefaultInputs(name, userInputs = {}) {
    const defaultPayload = await this.createDefaultInputPayload(name);
    
    // Start with the default payload
    const mergedPayload = { ...defaultPayload };
    
    // Override with user inputs where provided
    if (userInputs && typeof userInputs === 'object') {
      Object.keys(userInputs).forEach(key => {
        if (userInputs[key] !== undefined && userInputs[key] !== null) {
          mergedPayload[key] = userInputs[key];
        }
      });
    }
    
    return mergedPayload;
  }

  /**
   * Prepare a complete payload for workflow execution with validation
   * 
   * @param {string} name - Name of the workflow
   * @param {Object} userInputs - Optional user-provided inputs
   * @returns {Promise<Object>} - Object with payload, validation info, and workflow info
   */
  async prepareWorkflowPayload(name, userInputs = {}) {
    // Get workflow details
    const workflow = await this.getWorkflowByName(name);
    
    if (!workflow) {
      return {
        success: false,
        error: `Workflow "${name}" not found`,
        payload: null,
        validation: null,
        workflow: null
      };
    }
    
    // Get the output type and lora support
    const outputType = await this.getWorkflowOutputType(name);
    const hasLoraSupport = await this.hasLoraLoaderSupport(name);
    
    // Merge with default values
    const payload = await this.mergeWithDefaultInputs(name, userInputs);
    
    // Validate the payload
    const validation = await this.validateInputPayload(name, payload);
    
    // Prepare result object
    const result = {
      success: validation.isValid,
      error: validation.isValid ? null : 'Invalid payload',
      payload,
      validation,
      workflow: {
        id: workflow.id,
        name: workflow.name,
        displayName: workflow.displayName,
        deploymentIds: workflow.deploymentIds,
        outputType,
        hasLoraSupport
      }
    };
    
    // If the workflow has deploymentIds, include the recommended deployment
    if (workflow.deploymentIds && workflow.deploymentIds.length > 0) {
      result.workflow.recommendedDeploymentId = workflow.deploymentIds[0];
    }
    
    // Include a recommended machine if available
    const machineId = await this.getMachineForWorkflow(name);
    if (machineId) {
      result.workflow.recommendedMachineId = machineId;
    }
    
    return result;
  }
}

module.exports = WorkflowsService; 