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
      this.isInitialized = true;
      this.logger.info(`Workflows loaded successfully. Found ${this.cache.workflows.length} workflows.`);
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
    
    // Try to find by standardized name first
    let workflow = this.cache.byName.get(standardName);
    
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
   * Get deployment IDs for a specific workflow type
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<Array|null>} - Array of deployment IDs or null if not found
   */
  async getDeploymentIdsByName(name) {
    const workflow = await this.getWorkflowByName(name);
    return workflow ? workflow.deploymentIds : null;
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
   * Parse a raw workflow to extract needed properties
   * 
   * @param {Object} workflow - Raw workflow data
   * @returns {Object} - Parsed workflow
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
      raw: workflow // Include the raw data for reference
    };
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
      
      // Process the deployments into workflows
      const workflows = await this._processDeployments(deployments);
      
      // Update cache
      this.cache.workflows = workflows;
      this.cache.lastUpdated = Date.now();
      
      // Rebuild indexes
      this._buildIndexes();
      
      return workflows;
    } catch (error) {
      this.logger.error(`Error fetching deployments: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch direct workflow information from ComfyUI Deploy API
   * 
   * @returns {Promise<Array>} - List of workflows
   * @private
   */
  async _fetchWorkflows() {
    try {
      this.logger.info('Fetching direct workflow information from ComfyUI Deploy API...');
      
      // Use the correct API endpoint
      const url = `${this.apiUrl}${API_ENDPOINTS.WORKFLOWS}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch workflows (${response.status}): ${errorText}`);
      }
      
      const apiWorkflows = await response.json();
      this.logger.info(`Fetched ${apiWorkflows.length} workflows directly from API`);
      
      // Add or update workflow information
      for (const apiWorkflow of apiWorkflows) {
        // Try to find existing workflow by ID
        const existingIndex = this.cache.workflows.findIndex(w => w.id === apiWorkflow.id);
        
        if (existingIndex >= 0) {
          // Update existing workflow with additional information
          this.cache.workflows[existingIndex] = {
            ...this.cache.workflows[existingIndex],
            name: apiWorkflow.name || this.cache.workflows[existingIndex].name,
            displayName: apiWorkflow.display_name || apiWorkflow.name || this.cache.workflows[existingIndex].displayName,
            description: apiWorkflow.description || this.cache.workflows[existingIndex].description,
            createdAt: apiWorkflow.created_at || this.cache.workflows[existingIndex].createdAt,
            updatedAt: apiWorkflow.updated_at || this.cache.workflows[existingIndex].updatedAt,
            apiData: apiWorkflow // Store the raw API data
          };
        } else {
          // Add new workflow if not found in processed deployments
          const newWorkflow = {
            id: apiWorkflow.id,
            name: apiWorkflow.name || `workflow-${apiWorkflow.id.substring(0, 8)}`,
            displayName: apiWorkflow.display_name || apiWorkflow.name || `Workflow ${apiWorkflow.id.substring(0, 8)}`,
            description: apiWorkflow.description || '',
            inputs: [],  // Will need to be populated if we get version details
            deploymentIds: [], // May need to be populated from deployments
            versions: [],
            createdAt: apiWorkflow.created_at,
            updatedAt: apiWorkflow.updated_at,
            apiData: apiWorkflow
          };
          
          this.cache.workflows.push(newWorkflow);
        }
      }
      
      // Rebuild indexes with updated information
      this._buildIndexes();
      
      return this.cache.workflows;
    } catch (error) {
      this.logger.error(`Error fetching workflows directly: ${error.message}`);
      // Continue with existing data if available
      return this.cache.workflows;
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
    try {
      // Extract unique workflow IDs from deployments
      const workflowMap = new Map();
      
      // First pass: collect basic info about each workflow
      for (const deployment of deployments) {
        // Ensure we have the required data
        if (!deployment.workflow_version || !deployment.workflow_version.workflow) {
          continue;
        }
        
        const { workflow } = deployment.workflow_version;
        
        // Skip if we don't have an ID
        if (!workflow.id) {
          continue;
        }
        
        // Create or update workflow entry
        if (!workflowMap.has(workflow.id)) {
          const parsedWorkflow = this._parseWorkflow(workflow);
          workflowMap.set(workflow.id, parsedWorkflow);
        }
        
        // Add deployment ID to the workflow
        const parsedWorkflow = workflowMap.get(workflow.id);
        if (!parsedWorkflow.deploymentIds.includes(deployment.id)) {
          parsedWorkflow.deploymentIds.push(deployment.id);
        }
        
        // Add deployment to byDeploymentId index
        this.cache.byDeploymentId.set(deployment.id, deployment);
      }
      
      // Convert map to array
      return Array.from(workflowMap.values());
    } catch (error) {
      this.logger.error(`Error processing deployments: ${error.message}`);
      return [];
    }
  }

  /**
   * Build indexes for fast lookups
   * @private
   */
  _buildIndexes() {
    // Clear existing indexes
    this.cache.byName.clear();
    
    // Build name index
    for (const workflow of this.cache.workflows) {
      this.cache.byName.set(workflow.name, workflow);
      
      // Also index by display name if different from name
      if (workflow.displayName && workflow.displayName !== workflow.name) {
        this.cache.byName.set(workflow.displayName, workflow);
      }
    }
    
    this.logger.info(`Built indexes for ${this.cache.workflows.length} workflows`);
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
    if (!this.isInitialized && !this.isLoading) {
      await this.initialize();
    } else if (this.isLoading) {
      // Wait for initialization to complete
      while (this.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
}

module.exports = WorkflowsService; 