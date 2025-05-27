const DEBUG_LOGGING_ENABLED = false; // Set to true to enable detailed logging

const { 
  DEFAULT_TIMEOUT, // Keep for potential future use within manager
  DEFAULT_CACHE_TTL,
  COMFY_DEPLOY_API_URL, // Keep for potential future use within manager
  API_ENDPOINTS // Keep for potential future use within manager
} = require('./config');

// Import fetch for API calls
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Import utilities needed for parsing
const { 
  standardizeWorkflowName, 
  parseWorkflowStructure,
  extractNotes // geniusoverhaul: Added extractNotes
} = require('./workflowUtils');

// geniusoverhaul: Added ToolRegistry import and changed to .js
const { ToolRegistry } = require('../../tools/ToolRegistry.js');

// Import ComfyUIService needed temporarily for detail fetching
// We might refactor this later to avoid circular dependencies or pass methods directly
let ComfyUIService; // Lazy load to potentially help with circular deps

// Define GPU costs (dollars per second)
const GPU_COST_PER_SECOND = {
  'T4': 0.00018,
  'L4': 0.00032,
  'A10G': 0.000337,
  'L40S': 0.000596,
  'A100': 0.00114,
  'A100-80GB': 0.001708,
  'H100': 0.002338,
  'CPU': 0.000042 // Default/fallback cost
};

const KNOWN_STRING_SELECTOR_KEYWORDS = ['checkpoint', 'lora', 'vae', 'sampler', 'scheduler', 'model', 'clip_skip', 'hypernetwork'];

function mapComfyTypeToToolType(comfyType, inputName) {
  if (inputName) {
    const lowerInputName = inputName.toLowerCase();
    for (const keyword of KNOWN_STRING_SELECTOR_KEYWORDS) {
      if (lowerInputName.includes(keyword)) {
        return 'string';
      }
    }
  }

  if (!comfyType) return 'string';
  const lowerType = comfyType.toLowerCase();
  if (lowerType.includes('image')) return 'image';
  if (lowerType.includes('int') || lowerType.includes('float') || lowerType.includes('number')) return 'number';
  if (lowerType.includes('boolean')) return 'boolean';
  return 'string';
}

function generateCommandName(displayName) {
  // TODO: Implement robust command name generation (sanitize, ensure uniqueness etc.)
  if (!displayName) return 'unknown_command';
  return '/' + displayName.replace(/\s+/g, '').toLowerCase();
}

class WorkflowCacheManager {
  /**
   * Initialize Workflow Cache Manager
   * 
   * @param {Object} options - Configuration options from WorkflowsService
   * @param {string} options.apiUrl - ComfyUI Deploy API URL
   * @param {string} options.apiKey - ComfyUI Deploy API key
   * @param {number} options.timeout - Request timeout
   * @param {Function} options.logger - Logger function
   * @param {Object} options.cacheConfig - Cache specific configuration
   * @param {boolean} options.cacheConfig.enabled - Whether caching is enabled
   * @param {number} options.cacheConfig.ttl - Cache TTL in milliseconds
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl; // Store for potential use in fetch methods
    this.apiKey = options.apiKey; // Store for potential use in fetch methods
    this.timeout = options.timeout; // Store for potential use in fetch methods
    this.logger = options.logger;
    // geniusoverhaul: Get ToolRegistry instance
    this.toolRegistry = ToolRegistry.getInstance();
    
    // Caching configuration and state
    this.cache = {
      enabled: options.cacheConfig?.enabled !== false,
      ttl: options.cacheConfig?.ttl || DEFAULT_CACHE_TTL,
      lastUpdated: null,
      deployments: [], // Raw deployments from API
      workflows: [],   // Processed workflows
      machines: [],    // Available machines
      versions: new Map(), // Cache for workflow versions
      byName: new Map(), // Index of workflows by name
      byDeploymentId: new Map() // Index of deployments by ID
    };

    // Initialization state - will be managed here later
    this.isInitialized = false;
    this.isLoading = false;
    this._hasInitializedOnce = false; 
  }

  /**
   * Clear all cache data
   * @private
   */
  _clearCache() {
    if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager] Clearing cache data...');
    this.cache.lastUpdated = null;
    this.cache.deployments = [];
    this.cache.workflows = [];
    this.cache.machines = [];
    this.cache.versions.clear();
    this.cache.byName.clear();
    this.cache.byDeploymentId.clear();
    this.isInitialized = false; // Reset initialization status on clear
  }

  /**
   * Check if the cache is stale and needs refreshing
   * 
   * @returns {boolean} - True if cache is stale
   * @private
   */
  _isCacheStale() {
    if (!this.cache.enabled) {
      if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager] Cache disabled, considering stale.');
      return true; // Always refresh if cache is disabled
    }
    if (!this.cache.lastUpdated) {
       if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager] Cache never updated, considering stale.');
      return true; // Stale if never updated
    }
    
    const now = Date.now();
    const age = now - this.cache.lastUpdated;
    const isStale = age > this.cache.ttl;
    
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager] Cache check. Is stale: ${isStale}, Age: ${age}ms, TTL: ${this.cache.ttl}ms`);

    return isStale;
  }

  // --- Fetching Methods --- 

  /**
   * Fetch all deployments from ComfyUI Deploy and process them
   * 
   * @returns {Promise<Array>} - Raw deployments list
   * @private
   */
  async _fetchAndProcessDeployments() {
    // Renamed from original in WorkflowsService, only fetches now
    try {
      if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager] Fetching deployments from ComfyUI Deploy API...');
      
      const url = `${this.apiUrl}${API_ENDPOINTS.DEPLOYMENTS}`;
      if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager] Using API URL for deployments: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        },
        timeout: this.timeout // Use timeout stored in constructor
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`[WorkflowCacheManager] Failed to fetch deployments (${response.status}): ${errorText}`);
      }
      
      const deployments = await response.json();
      if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager] Fetched ${deployments.length} deployments successfully`);
      
      // Store raw deployments in the cache managed by this instance
      this.cache.deployments = deployments;
      this.cache.lastUpdated = Date.now(); // Update timestamp after successful fetch
      
      // Return the raw deployments
      return deployments;
    } catch (error) {
      this.logger.error(`[WorkflowCacheManager] Error fetching deployments: ${error.message}`);
      throw error; // Re-throw to be handled by the caller (e.g., initialize)
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
      if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager] Fetching machines from ComfyUI Deploy API...');
      
      const url = `${this.apiUrl}${API_ENDPOINTS.MACHINES}`;
      if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager] Using API URL for machines: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        },
         timeout: this.timeout // Use timeout stored in constructor
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`[WorkflowCacheManager] Failed to fetch machines (${response.status}): ${errorText}`);
      }
      
      const rawMachines = await response.json();
      if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager] Fetched ${rawMachines.length} raw machines successfully`);
      
      // Process machines to add cost information
      const processedMachines = rawMachines.map(machine => {
        const gpuType = machine.gpu_type; // Assuming the field name is gpu_type
        let costPerSecond = GPU_COST_PER_SECOND['CPU']; // Default to CPU cost
        let foundCost = false;

        if (gpuType && GPU_COST_PER_SECOND.hasOwnProperty(gpuType)) {
          costPerSecond = GPU_COST_PER_SECOND[gpuType];
          foundCost = true;
        } else {
           if (DEBUG_LOGGING_ENABLED) {
             if (gpuType) {
               this.logger.warn(`[WorkflowCacheManager] GPU type "${gpuType}" for machine ${machine.id} not found in cost map. Defaulting to CPU cost.`);
             } else {
               this.logger.warn(`[WorkflowCacheManager] Machine ${machine.id} (${machine.name || 'N/A'}) missing 'gpu_type' field. Defaulting to CPU cost.`);
             }
           }
        }

        return {
          ...machine, // Keep all original machine properties
          cost_per_second: costPerSecond // Add the determined cost
        };
      });

      // Update cache managed by this instance with processed machines
      this.cache.machines = processedMachines;
      this.cache.lastUpdated = Date.now(); 
      
      return this.cache.machines; // Return the processed machines
    } catch (error) {
      this.logger.error(`[WorkflowCacheManager] Error fetching machines: ${error.message}`);
      // Don't return cached machines here, let initialize handle the error
      throw error; // Re-throw error
    }
  }

  // --- Workflow Fetching & Processing --- 

  /**
   * Fetch direct workflow information from ComfyUI Deploy API
   * (Includes fetching list and processing details for each)
   * 
   * @returns {Promise<Array>} - List of processed workflows
   * @private
   */
  async _fetchWorkflows() {
    if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager] Fetching workflows list...');
    
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
          throw new Error(`[WorkflowCacheManager] Failed to fetch workflows list: ${response.status} - ${errorText}`);
        }
        
        workflowsList = await response.json();
        if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager] Fetched ${workflowsList.length} workflow summaries.`);

    } catch (error) {
      this.logger.error(`[WorkflowCacheManager] Error fetching workflow list: ${error.message}`);
      // If fetching list fails, we might not want to proceed or use cached if available and not stale
      throw error; // Re-throw for initialize to handle
    }
    
    const processedWorkflows = [];
    if (workflowsList && workflowsList.length > 0) {
      // Before processing, ensure deployments and machines are fetched for context (especially for costing and IDs)
      if (!this.cache.deployments || this.cache.deployments.length === 0) {
        this.logger.warn('[WorkflowCacheManager] Deployments cache is empty. Fetching before processing workflows.');
        await this._fetchAndProcessDeployments(); // Ensure deployments are loaded
      }
      if (!this.cache.machines || this.cache.machines.length === 0) {
         this.logger.warn('[WorkflowCacheManager] Machines cache is empty. Fetching before processing workflows for costing.');
         await this._fetchMachines(); // Ensure machines are loaded for costing
      }

    for (const workflowSummary of workflowsList) {
        // workflowSummary here is an item from the /workflows API endpoint.
        // It might contain { id, name, deployment_id, workflow_json (sometimes), inputs }
        // We need to ensure it has enough data, or fetch more.
        // The `_fetchAndProcessWorkflowDetails` will now create and register the ToolDefinition.
        const processedWorkflowOrToolDef = await this._fetchAndProcessWorkflowDetails(workflowSummary);
        if (processedWorkflowOrToolDef) {
          // If `_fetchAndProcessWorkflowDetails` now returns the ToolDefinition,
          // we might store that or a derivative in `this.cache.workflows`.
          // For now, let's assume we just add it.
          processedWorkflows.push(processedWorkflowOrToolDef); 
        }
      }
    }
    
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager] Processed ${processedWorkflows.length} workflows.`);
    
    // This function originally updated `this.cache.workflows`.
    // We should maintain that if other parts of the class rely on it.
    // The content of `this.cache.workflows` might now be ToolDefinitions or objects compatible with old structure.
    // For now, let's assume `processedWorkflows` contains the ToolDefinitions.
    this.cache.workflows = processedWorkflows;
    this.cache.lastUpdated = Date.now(); // Also update timestamp here as we've processed new data
    
    return this.cache.workflows; 
  }

  /**
   * PRIVATE: Fetches full details for a single workflow summary, parses it, 
   * and prepares it for caching.
   * 
   * @param {Object} workflowSummary - Raw workflow summary object from the API list.
   * @returns {Promise<Object|null>} - Fully processed workflow object ready for caching, or null on failure.
   * @private
   */
  async _fetchAndProcessWorkflowDetails(workflowSummary) {
    // workflowSummary is expected to be an item from the list fetched by _fetchWorkflows
    // It should have at least an 'id' (workflow_id) and 'name'
    const isFluxGeneral = workflowSummary.name === 'fluxgeneral'; // Flag for targeted logging

    if (DEBUG_LOGGING_ENABLED) {
      // This log will now only show if DEBUG_LOGGING_ENABLED is true, 
      // but will still include -FLUXGENERAL if relevant
      this.logger.info(`[WorkflowCacheManager${isFluxGeneral ? "-FLUXGENERAL" : ""}] Processing details for workflow: ${workflowSummary.name} (WorkflowAPI_ID: ${workflowSummary.id})`);
      if (isFluxGeneral) { // JSON.stringify logs already conditional on DEBUG_LOGGING_ENABLED from previous step
        this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Full workflowSummary: ${JSON.stringify(workflowSummary)}`);
      }
    } else if (isFluxGeneral) {
      // If not debug logging, but it IS flux general, we might still want a very brief, non-JSON log or nothing.
      // For now, let's silence it completely if not DEBUG_LOGGING_ENABLED to minimize logs.
      // If you need to know it's processing fluxgeneral even when debug is off, we can add a minimal log here.
    }

    try {
      const deploymentIdFromSummary = workflowSummary.deployment_id;
      const workflowApiId = workflowSummary.id;

      let deploymentData = null;

      if (deploymentIdFromSummary) {
        if (isFluxGeneral) this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Attempting to find deploymentData using workflowSummary.deployment_id: '${deploymentIdFromSummary}'`);
        deploymentData = this.cache.deployments.find(d => d.id === deploymentIdFromSummary);
        if (deploymentData && isFluxGeneral) {
          this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Found deploymentData via workflowSummary.deployment_id. Deployment ID: ${deploymentData.id}`);
        } else if (!deploymentData && isFluxGeneral) {
          this.logger.warn(`[WorkflowCacheManager-FLUXGENERAL] Did NOT find deploymentData using workflowSummary.deployment_id: '${deploymentIdFromSummary}'`);
        }
      } else if (isFluxGeneral) {
        this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] workflowSummary.deployment_id is not present.`);
      }

      if (!deploymentData) {
        if (isFluxGeneral) this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Attempting to find deploymentData by linking workflowApiId ('${workflowApiId}') to deployment.workflow_id or deployment.versions[...].workflow_id`);
        deploymentData = this.cache.deployments.find(d => {
          const topLevelMatch = d.workflow_id === workflowApiId;
          const versionMatch = d.versions && d.versions.some(v => v.workflow_id === workflowApiId);
          if (isFluxGeneral && (topLevelMatch || versionMatch)) {
            this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Potential match in find: Deployment ID: ${d.id}, topLevelMatch: ${topLevelMatch}, versionMatch: ${versionMatch}. Deployment workflow_id: ${d.workflow_id}, Versions: ${JSON.stringify(d.versions?.map(v=>v.workflow_id))}`);
          }
          return topLevelMatch || versionMatch;
        });
        if (deploymentData && isFluxGeneral) {
          this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Found deploymentData via workflowApiId link. Deployment ID: ${deploymentData.id}`);
        } else if (!deploymentData && isFluxGeneral) {
          this.logger.warn(`[WorkflowCacheManager-FLUXGENERAL] Did NOT find deploymentData via workflowApiId link ('${workflowApiId}').`);
        }
      }
      
      // If no deploymentData found, tool creation might be partial.
      // For fluxgeneral, we expect deploymentData to be found.
      const effectiveDeploymentIdForTool = deploymentData ? deploymentData.id : (workflowSummary.deployment_id || workflowSummary.id);

      if (!deploymentData) {
          this.logger.warn(`[WorkflowCacheManager${isFluxGeneral ? "-FLUXGENERAL" : ""}] Could not find matching deployment data for workflow ${workflowSummary.name} (WorkflowAPI_ID: ${workflowApiId}). ToolDefinition will be based on workflow summary, and costing may be inaccurate or missing. Using ID '${effectiveDeploymentIdForTool}' for tool construction.`);
          if (isFluxGeneral) {
            const sampleDeploymentWorkflowIds = this.cache.deployments.slice(0, 5).map(d => ({ id: d.id, wfId: d.workflow_id, versionsWfIds: d.versions?.map(v=>v.workflow_id) }));
            this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Sample of deployment linking IDs from cache: ${JSON.stringify(sampleDeploymentWorkflowIds)}`);
          }
      }

      // Fetch workflowJson using workflowApiId (workflowSummary.id)
      let actualWorkflowGraph = workflowSummary.workflow_json || workflowSummary.workflow; // Prefer workflow_json if available on summary

      if (!actualWorkflowGraph || typeof actualWorkflowGraph !== 'object' || !actualWorkflowGraph.nodes) {
        if (isFluxGeneral) this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Workflow JSON not on summary or invalid for ${workflowSummary.name}. Fetching...`);
        const workflowDetailsContainer = await this._getWorkflowJsonStructure(workflowApiId); // This returns { workflowJson: GRAPH, versions: V }
        actualWorkflowGraph = workflowDetailsContainer ? workflowDetailsContainer.workflowJson : null; // Extract the GRAPH

         if (!actualWorkflowGraph || !actualWorkflowGraph.nodes) { // Check again after fetching
            this.logger.error(`[WorkflowCacheManager${isFluxGeneral ? "-FLUXGENERAL" : ""}] Critical: Could not retrieve workflow JSON graph for ${workflowSummary.name} (WorkflowAPI_ID: ${workflowApiId}). Cannot create ToolDefinition.`);
            return null; // Cannot proceed without workflow JSON
        }
        if (isFluxGeneral) this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Successfully fetched workflow graph for ${workflowSummary.name}.`);
        } else {
        if (isFluxGeneral) this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Using workflow JSON from summary for ${workflowSummary.name}.`);
      }
      
      // Pass the actual deploymentData (can be null if not found) and the actualWorkflowGraph.
      // createToolDefinitionFromWorkflow needs to handle potentially null deploymentData gracefully for some fields.
      const toolDef = await this.createToolDefinitionFromWorkflow(deploymentData, actualWorkflowGraph, workflowSummary);
      
      if (toolDef) {
        this.toolRegistry.registerTool(toolDef);
        if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager] Registered tool: ${toolDef.toolId}`);
      }

      // The original function might have returned a processed workflow object.
      // We need to ensure this function still fulfills its original contract if it had one,
      // or adapt the calling code (e.g., in _fetchWorkflows or initialize).
      // For now, let's assume it's okay to just create and register the tool.
      // If it was building up `this.cache.workflows`, we might need to return `toolDef` or a related object.
      // Based on the plan, this function is primarily for creating ToolDefinition.
      // Let's assume it should return the processed data that would normally be cached.
      // For now, just return the toolDef or null.
      
      // Original function was likely building a "processed workflow" object for the cache.
      // We can return the toolDef itself, or a structure compatible with the old cache if needed.
      // Let's assume for now we are adapting this function to primarily create and register tools.
      // The result of this function is used in `_fetchWorkflows` to populate `processedWorkflows`.
      // So, we should return something, perhaps the `toolDef` itself or a modified version of `workflowSummary`.

      // For now, let's return the toolDef if created, or the original workflowSummary if not,
      // or null if critical error. This part needs careful integration with how `_fetchWorkflows` uses the result.
      return toolDef; // Or adapt as needed for `this.cache.workflows`

    } catch (error) {
      this.logger.error(`[WorkflowCacheManager${isFluxGeneral ? "-FLUXGENERAL" : ""}] Error processing workflow details for ${workflowSummary.name} (ID: ${workflowSummary.id}): ${error.message}`);
      this.logger.error(error.stack); // Log stack for more details
      return null; // Return null or throw, depending on desired error handling
    }
  }

  /**
   * PRIVATE: Attempts to retrieve the workflow JSON structure using various methods.
   * Instantiates a temporary ComfyUIService for API calls.
   * 
   * @param {string} workflowId - The ID of the workflow.
   * @returns {Promise<Object|null>} - The workflow JSON structure if found, otherwise null.
   * @private
   */
  async _getWorkflowJsonStructure(workflowId) {
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_getWorkflowJsonStructure] Attempting to find JSON for workflow ID: ${workflowId}`);
    let workflowJson = null;
    let workflowDetails = null; 

    // Lazy load ComfyUIService if not already loaded
    if (!ComfyUIService) {
        ComfyUIService = require('./comfyui');
    }

    try {
      // Use temporary ComfyUIService instance - pass necessary config
      const comfyui = new ComfyUIService({ 
          logger: this.logger,
          apiKey: this.apiKey, // Pass API key
          apiUrl: this.apiUrl // Pass API URL
      }); 

      // 1. Try comfyui.getWorkflowDetails
      if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_getWorkflowJsonStructure] Attempting comfyui.getWorkflowDetails for ID: ${workflowId}`);
      try {
          workflowDetails = await comfyui.getWorkflowDetails(workflowId);
          if (workflowDetails && workflowDetails.workflow_json && workflowDetails.workflow_json.nodes) {
              if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_getWorkflowJsonStructure] Found workflow_json in getWorkflowDetails response for ${workflowId}.`);
              workflowJson = workflowDetails.workflow_json;
          }
      } catch (detailsError) {
           this.logger.warn(`[WorkflowCacheManager:_getWorkflowJsonStructure] Error during comfyui.getWorkflowDetails for ID ${workflowId}: ${detailsError.message}`);
      }

      // 2. If no JSON yet, try comfyui.getWorkflowContent
      if (!workflowJson || !workflowJson.nodes) {
          if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_getWorkflowJsonStructure] No workflow_json yet, attempting comfyui.getWorkflowContent for ID: ${workflowId}`);
          try {
               const workflowContent = await comfyui.getWorkflowContent(workflowId);
               if (workflowContent && workflowContent.nodes) {
                  if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_getWorkflowJsonStructure] Found workflow_json via getWorkflowContent for ${workflowId}.`);
                  workflowJson = workflowContent;
               }
          } catch (contentError) {
               this.logger.warn(`[WorkflowCacheManager:_getWorkflowJsonStructure] Error during comfyui.getWorkflowContent for ID ${workflowId}: ${contentError.message}`);
          }
      }
      
      // 3. If still no JSON, try getting it from deployments (using ID directly)
      if (!workflowJson || !workflowJson.nodes) {
          if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_getWorkflowJsonStructure] Still no workflow_json, attempting _getWorkflowJsonFromDeployments for ID: ${workflowId}`);
          try {
               // Use the method within this class
               const workflowJsonFromDeployments = await this._getWorkflowJsonFromDeployments(workflowId); 
               if (workflowJsonFromDeployments && workflowJsonFromDeployments.nodes) {
                  if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_getWorkflowJsonStructure] Found workflow_json via _getWorkflowJsonFromDeployments for ${workflowId}.`);
                  workflowJson = workflowJsonFromDeployments;
               }
          } catch (deploymentsError) {
               this.logger.warn(`[WorkflowCacheManager:_getWorkflowJsonStructure] Error during _getWorkflowJsonFromDeployments for ID ${workflowId}: ${deploymentsError.message}`);
          }
      }

    } catch (error) {
        this.logger.error(`[WorkflowCacheManager:_getWorkflowJsonStructure] Unexpected error while trying to fetch JSON for workflow ${workflowId}: ${error.message}`);
        return { workflowJson: null, versions: [] };
    }

    const versions = (workflowDetails && workflowDetails.workflow_versions) ? workflowDetails.workflow_versions : [];

    if (!workflowJson || !workflowJson.nodes) {
        this.logger.warn(`[WorkflowCacheManager:_getWorkflowJsonStructure] Could not retrieve workflow_json structure from any source for ${workflowId}.`);
    }

    return { workflowJson, versions };
  }

  /**
   * Attempt to get workflow JSON from available deployments in the cache
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object|null>} - Workflow JSON if found, otherwise null
   * @private
   */
  async _getWorkflowJsonFromDeployments(workflowId) {
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_getWorkflowJsonFromDeployments] Attempting for workflow ID: ${workflowId}`);
    
    // Lazy load ComfyUIService if not already loaded
    if (!ComfyUIService) {
        ComfyUIService = require('./comfyui');
    }

    try {
       // Use deployments cached within this manager instance
       const deployments = this.cache.deployments; 
       
       const matchingDeployments = deployments.filter(deployment => 
         deployment.workflow_version && 
         deployment.workflow_version.workflow && 
         deployment.workflow_version.workflow.id === workflowId
       );
       
       if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_getWorkflowJsonFromDeployments] Found ${matchingDeployments.length} deployments linked to workflow ID: ${workflowId}`);
       
       if (matchingDeployments.length > 0) {
         const sortedDeployments = matchingDeployments.sort((a, b) => 
           new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)
         );
         
         for (const deployment of sortedDeployments) {
           if (deployment.workflow_version?.workflow_json?.nodes) {
             if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_getWorkflowJsonFromDeployments] Found workflow_json in deployment ${deployment.id}`);
             return deployment.workflow_version.workflow_json;
           }
           if (deployment.workflow_version?.workflow_data?.nodes) {
             if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_getWorkflowJsonFromDeployments] Found workflow_data in deployment ${deployment.id}`);
             return deployment.workflow_version.workflow_data;
           }
           if (deployment.workflow_version?.version_id) {
             if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_getWorkflowJsonFromDeployments] Trying to get version details for version ID: ${deployment.workflow_version.version_id}`);
             // Use temporary ComfyUIService instance
             const comfyui = new ComfyUIService({ 
                 logger: this.logger, 
                 apiKey: this.apiKey, 
                 apiUrl: this.apiUrl 
             });
             try {
               const versionDetails = await comfyui.getWorkflowVersion(deployment.workflow_version.version_id);
               if (versionDetails?.workflow_json?.nodes) {
                 if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_getWorkflowJsonFromDeployments] Found workflow_json in fetched version: ${deployment.workflow_version.version_id}`);
                 return versionDetails.workflow_json;
               }
             } catch (error) {
               this.logger.warn(`[WorkflowCacheManager:_getWorkflowJsonFromDeployments] Error getting version details for ${deployment.workflow_version.version_id}: ${error.message}`);
             }
           }
         }
       }
    } catch (error) {
      this.logger.error(`[WorkflowCacheManager:_getWorkflowJsonFromDeployments] Error during process for workflow ID ${workflowId}: ${error.message}`);
    }
    
    this.logger.warn(`[WorkflowCacheManager:_getWorkflowJsonFromDeployments] Could not find workflow JSON for ${workflowId} via deployments.`);
    return null;
  }

  // --- Indexing --- (Placeholder for _buildIndexes)
  /**
   * Build indexes for fast lookups (byName, byDeploymentId) and link deployments to workflows.
   * Assumes raw deployments and processed workflows are already in the cache.
   * @private
   */
  _buildIndexes() {
    if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager] Building workflow indexes...');
    this.cache.byName.clear();
    this.cache.byDeploymentId.clear();
    
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_buildIndexes] Populating byDeploymentId index from ${this.cache.deployments.length} deployments.`); // Added log
    this.cache.deployments.forEach(deployment => {
      if (deployment && deployment.id) {
        this.cache.byDeploymentId.set(deployment.id, deployment);
      } else {
        this.logger.warn(`[WorkflowCacheManager:_buildIndexes] Skipping deployment indexing due to missing ID: ${JSON.stringify(deployment)}`);
      }
    });
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_buildIndexes] Indexed ${this.cache.byDeploymentId.size} deployments by ID.`);

    // this.cache.workflows now contains ToolDefinition objects.
    // These objects don't have a standardName property directly.
    // We need to generate it from displayName.
    this.cache.workflows.forEach(tool => { // tool is a ToolDefinition
        // Ensure deploymentIds array exists on the tool object if it will be used by this linking logic
        if (!tool.metadata) tool.metadata = {}; // Ensure metadata exists
        if (!tool.metadata.deploymentIds) tool.metadata.deploymentIds = []; // Store linked deployment IDs in metadata
        
        if (tool && tool.displayName) { 
            const standardName = standardizeWorkflowName(tool.displayName);
        if (this.cache.byName.has(standardName)) {
                const existingTool = this.cache.byName.get(standardName);
                this.logger.warn(`[WorkflowCacheManager:_buildIndexes] Workflow name collision for standardized name "${standardName}". Original displayNames: "${existingTool.displayName}" (ToolID: ${existingTool.toolId}) and "${tool.displayName}" (ToolID: ${tool.toolId}). Overwriting with the latter.`);
        }
            this.cache.byName.set(standardName, tool);
      } else {
            this.logger.warn(`[WorkflowCacheManager:_buildIndexes] Skipping tool indexing by displayName due to missing displayName or object: ${JSON.stringify(tool)}`);
      }

      // ALSO INDEX BY TOOL ID
      if (tool && tool.toolId) {
        if (this.cache.byName.has(tool.toolId)) {
            const existingTool = this.cache.byName.get(tool.toolId);
            // It's possible for a displayName to be the same as a toolId if not careful with naming conventions
            // Or if a toolId was accidentally used as a displayName.
            // Log a warning if we are overwriting something that isn't the same tool object.
            if (existingTool.toolId !== tool.toolId) {
                 this.logger.warn(`[WorkflowCacheManager:_buildIndexes] Collision in byName cache for key "${tool.toolId}". This key (a toolId) is about to overwrite an existing entry that might have been a displayName. Existing tool: ${existingTool.displayName} (ID: ${existingTool.toolId}), New tool: ${tool.displayName} (ID: ${tool.toolId}).`);
            }
        }
        this.cache.byName.set(tool.toolId, tool);
      } else {
        this.logger.warn(`[WorkflowCacheManager:_buildIndexes] Skipping tool indexing by toolId due to missing toolId: ${JSON.stringify(tool)}`);
      }
    });
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_buildIndexes] Indexed ${this.cache.byName.size} tools by standardized name and toolId.`);

    if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager:_buildIndexes] Linking deployments to tools (ToolDefinition objects)...');
    let linkedCount = 0;
    this.cache.deployments.forEach(deployment => {
        if (!deployment || !deployment.workflow_id || !deployment.id) {
            return;
        }

        // Find the corresponding tool (ToolDefinition) in this.cache.workflows
        // The tool.metadata.workflowId should match deployment.workflow_id
        const targetTool = this.cache.workflows.find(t => t.metadata && t.metadata.workflowId === deployment.workflow_id);

        if (targetTool) {
            if (!targetTool.metadata.deploymentIds.includes(deployment.id)) {
              targetTool.metadata.deploymentIds.push(deployment.id);
              linkedCount++;
            }
        } else {
             this.logger.warn(`[WorkflowCacheManager:_buildIndexes] Could not find tool with metadata.workflowId "${deployment.workflow_id}" in cache to link deployment "${deployment.id}".`);
        }
    });
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_buildIndexes] Successfully linked ${linkedCount} deployment IDs to tools.`);
  }

  // --- Initialization --- (Placeholder for initialize, _ensureInitialized)
  /**
   * Initialize the cache by loading all data from ComfyUI Deploy
   * 
   * @returns {Promise<Array>} - Loaded workflows (from cache)
   */
  async initialize() {
    // Check loading state managed by this instance
    if (this.isLoading) {
      if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager] Cache initialization already in progress. Waiting...');
      // Wait for existing initialization to complete
      while (this.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.cache.workflows; // Return potentially populated cache
    }

    // Prevent multiple initializations if already done once and cache is fresh
    if (this.isInitialized && !this._isCacheStale()) {
        if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager] Cache already initialized and fresh. Skipping re-initialization.');
        return this.cache.workflows;
    }

    this.isLoading = true;
    if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager] Initializing cache: Loading data from ComfyUI Deploy...');

    try {
      // Clear potentially stale data before fetching
      this._clearCache(); // Clear everything before full reload

      // Perform fetch operations (now methods of this class)
      await this._fetchAndProcessDeployments(); 
      await this._fetchMachines(); 
      
      // geniusoverhaul: Moved _buildIndexes to be called after deployments are fetched and before workflows are processed,
      // as workflow processing might rely on the byDeploymentId index (e.g., for costing).
      this._buildIndexes(); 
      
      await this._fetchWorkflows(); // Fetches list and processes details for ToolDefinitions
      
      // Re-run _buildIndexes if ToolDefinitions in this.cache.workflows were modified in _fetchWorkflows
      // and indexing byName or other properties of ToolDefinitions is needed.
      // For now, the primary concern was byDeploymentId for costing.
      // If _fetchWorkflows modifies this.cache.workflows with ToolDefinitions and byName index needs to be on ToolDefinition.displayName,
      // then _buildIndexes (or a part of it) might need to run again or be adapted.
      // The current _buildIndexes also indexes this.cache.workflows byName based on tool.displayName.
      // So, it should run after this.cache.workflows is populated with ToolDefinitions.
      // Let's call it again to ensure byName index for tools is also up-to-date.
      this._buildIndexes(); 
      
      // Mark as initialized *after* all steps succeed
      this.isInitialized = true;
      this._hasInitializedOnce = true; 
      this.cache.lastUpdated = Date.now(); // Ensure timestamp is set after full successful init

      this.logger.info(`[WorkflowCacheManager] Cache initialized successfully. Found ${this.cache.workflows.length} tools (ToolDefinitions), ${this.cache.deployments.length} deployments, ${this.cache.machines.length} machines.`);
      // Summary Log Added:
      this.logger.info(`[WorkflowCacheManager-SUMMARY] Initialization complete. Tools registered: ${this.toolRegistry.getAllTools().filter(t => t.service === 'comfyui').length} (ComfyUI). Total tools in registry: ${this.toolRegistry.getAllTools().length}. Deployments: ${this.cache.deployments.length}. Machines: ${this.cache.machines.length}.`);

      return this.cache.workflows; // Return the populated cache data
    } catch (error) {
      this.logger.error(`[WorkflowCacheManager] Error during cache initialization: ${error.message}`);
      // Reset state flags on error to allow retry
      this.isInitialized = false; 
      // Do not clear _hasInitializedOnce, we might want to know if it ever succeeded.
      // Optionally clear cache on error? Depends on desired behavior.
      // this._clearCache(); 
      throw error; // Re-throw error to signal failure
    } finally {
      this.isLoading = false; // Ensure loading flag is reset regardless of outcome
    }
  }

  /**
   * Ensure the cache is initialized. If not, trigger initialization.
   * Use this internally before accessing cached data.
   * 
   * @returns {Promise<void>}
   * @public // Make public for WorkflowsService to call
   */
  async ensureInitialized() {
    // If already initialized and cache is fresh, return early.
    if (this.isInitialized && !this._isCacheStale()) { 
      return; 
    }
    
    // If currently loading, wait.
    if (this.isLoading) {
      if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager] ensureInitialized: Waiting for ongoing initialization...');
      while (this.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      // After waiting, check again if initialization was successful and cache is fresh
       if (this.isInitialized && !this._isCacheStale()) { 
         return; 
       }
       // If it failed or became stale immediately, fall through to re-initialize
       if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager] ensureInitialized: Initialization finished, but cache is stale or failed. Proceeding to initialize.');
    }

    // If never initialized, or if it's stale, or if previous load failed, initialize.
    // The initialize method itself handles the isLoading flag.
    await this.initialize();
  }

  // geniusoverhaul: Added helper to get cost rate for a deployment
  async getCostRateForDeployment(deploymentId) {
    const isFluxGeneralDeployment = deploymentId === '0d129bba-1d74-4f79-8808-a4e8a8a79fcf'; // fluxgeneral's actual deployment ID
    if (DEBUG_LOGGING_ENABLED) {
      this.logger.info(`[WorkflowCacheManager${isFluxGeneralDeployment ? "-FLUXGENERAL" : ""}] getCostRateForDeployment called for Deployment ID: ${deploymentId}`);
    } else if (isFluxGeneralDeployment) {
      // Silenced if not DEBUG_LOGGING_ENABLED
    }

    const deployment = this.cache.byDeploymentId.get(deploymentId);
    
    if (isFluxGeneralDeployment && DEBUG_LOGGING_ENABLED) {
      if (deployment) {
        this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Found deployment in byDeploymentId cache: ${JSON.stringify(deployment)}`);
      } else {
        this.logger.warn(`[WorkflowCacheManager-FLUXGENERAL] Deployment NOT FOUND in byDeploymentId cache for ID: ${deploymentId}`);
      }
    }

    if (!deployment) { 
        this.logger.warn(`[WorkflowCacheManager] Deployment ${deploymentId} not found in byDeploymentId cache. Cannot calculate cost.`);
        return null;
    }
    
    // Check for version_id directly on deployment, which was the original expectation from the log message
    if (!deployment.version_id) {
        const deploymentDetailsLog = DEBUG_LOGGING_ENABLED ? ` Full deployment object: ${JSON.stringify(deployment)}` : '';
        this.logger.warn(`[WorkflowCacheManager] Deployment ${deploymentId} (Name: ${deployment.name || 'N/A'}) is missing 'version_id' field. This field is often used to link to machine configurations for costing.${deploymentDetailsLog}`);
        // Continue to machine_id logic as a fallback, but log this absence.
    }

    let machineId = deployment.machine_id; // Ideal case
    
    if (isFluxGeneralDeployment && DEBUG_LOGGING_ENABLED) {
        this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Attempting to use machine_id from deployment: '${machineId}'`);
    }

    if (!machineId && deployment.versions && deployment.versions.length > 0) {
        const latestVersion = deployment.versions[0];
        machineId = latestVersion.machine_id || latestVersion.build_config?.machine_id;
        if (isFluxGeneralDeployment && DEBUG_LOGGING_ENABLED) {
            this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Fell back to machine_id from latest version: '${machineId}'`);
        }
    }

    if (machineId) {
        const machine = this.cache.machines.find(m => m.id === machineId);
        if (machine) {
            if (isFluxGeneralDeployment && DEBUG_LOGGING_ENABLED) {
                this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Found machine for ID '${machineId}': ${JSON.stringify(machine)}`);
            }
            const gpuType = machine.gpu_type || machine.gpu; // Check both gpu_type and gpu
            if (isFluxGeneralDeployment && DEBUG_LOGGING_ENABLED) {
                this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Machine GPU type: '${gpuType}'`);
            }
            if (gpuType && GPU_COST_PER_SECOND.hasOwnProperty(gpuType)) {
                const cost = GPU_COST_PER_SECOND[gpuType];
                if (isFluxGeneralDeployment && DEBUG_LOGGING_ENABLED) {
                    this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Found cost for GPU type '${gpuType}': ${cost}`);
                }
                return cost;
            } else {
                this.logger.warn(`[WorkflowCacheManager] GPU type "${gpuType}" for machine ${machineId} (linked to deployment ${deploymentId}) not found in GPU_COST_PER_SECOND map or GPU type is missing. Defaulting to CPU cost. Machine details: ${JSON.stringify(machine)}`);
            }
        } else {
            this.logger.warn(`[WorkflowCacheManager] Machine ${machineId} (linked to deployment ${deploymentId}) not found in cache. Defaulting to CPU cost.`);
        }
    } else {
         this.logger.warn(`[WorkflowCacheManager] No machine_id could be determined for deployment ${deploymentId}. Defaulting to CPU cost.`);
    }
    
    // Fallback to CPU cost if other lookups fail
    if (isFluxGeneralDeployment && DEBUG_LOGGING_ENABLED) {
        this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Defaulting to CPU cost for deployment ${deploymentId}.`);
    }
    return GPU_COST_PER_SECOND['CPU'];
  }

  async createToolDefinitionFromWorkflow(workflowData, workflowJson, workflowSummaryIfNoDeployment) {
    const toolDefinition = {};
    const actualDeploymentId = workflowData?.id || workflowSummaryIfNoDeployment?.deployment_id || workflowSummaryIfNoDeployment?.id || 'unknown-deployment';
    const baseNameForLog = workflowData?.workflow?.name || workflowData?.name || workflowSummaryIfNoDeployment?.name || '';
    const isFluxGeneralTool = baseNameForLog === 'fluxgeneral';
  
    if (DEBUG_LOGGING_ENABLED && isFluxGeneralTool) {
      this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] createToolDefinitionFromWorkflow. BaseName: ${baseNameForLog}, DeploymentID: ${actualDeploymentId}`);
      this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] workflowJson: ${workflowJson ? JSON.stringify(workflowJson).substring(0, 500) + "..." : "null"}`);
    }
  
    // Basic tool metadata
    toolDefinition.toolId = `comfy-${actualDeploymentId}`;
    toolDefinition.service = 'comfyui';
    toolDefinition.displayName = workflowData?.friendly_name || workflowData?.workflow?.name || workflowData?.name || workflowSummaryIfNoDeployment?.name || `Comfy Workflow ${actualDeploymentId}`;
    toolDefinition.commandName = generateCommandName(toolDefinition.displayName);
    toolDefinition.apiPath = `/api/internal/comfy/run/${actualDeploymentId}`;
  
    // Extract Notes
    const notes = extractNotes(workflowJson);
    toolDefinition.description = notes.join('\n') || `Runs the ${toolDefinition.displayName} workflow.`;
  
    // Parse structure
    let structureInfo = null;
    try {
      structureInfo = parseWorkflowStructure(workflowJson);
      if (DEBUG_LOGGING_ENABLED && isFluxGeneralTool) {
        this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Parsed structureInfo: ${JSON.stringify(structureInfo, null, 2)}`);
      }
    } catch (err) {
      this.logger.warn(`[WorkflowCacheManager] Failed to parse workflow structure for ${toolDefinition.toolId}:`, err);
    }
  
    // === Input Schema ===
    if (structureInfo?.inputSchema && Object.keys(structureInfo.inputSchema).length > 0) {
      toolDefinition.inputSchema = structureInfo.inputSchema;
    } else if (workflowData?.version?.input_types) {
      toolDefinition.inputSchema = {};
      for (const item of workflowData.version.input_types) {
        if (!item?.input_id) continue;
        const fieldType = mapComfyTypeToToolType(item.type, item.input_id);
        let defaultValue = item.default_value;
  
        // Try to coerce defaults
        if (fieldType === 'number') {
          const parsed = parseFloat(defaultValue);
          defaultValue = isNaN(parsed) ? undefined : parsed;
        } else if (fieldType === 'boolean') {
          if (defaultValue?.toLowerCase?.() === 'true') defaultValue = true;
          else if (defaultValue?.toLowerCase?.() === 'false') defaultValue = false;
          else defaultValue = undefined;
        }
  
        toolDefinition.inputSchema[item.input_id] = {
          name: item.input_id,
          type: fieldType,
          required: item.required ?? true,
          default: defaultValue,
          description: item.description || `Input: ${item.input_id}`,
          advanced: item.advanced || false
        };
      }
    } else {
      this.logger.warn(`[WorkflowCacheManager] No input schema could be derived for ${toolDefinition.toolId}.`);
      toolDefinition.inputSchema = {};
    }
  
    // === Metadata and Hints ===
    toolDefinition.platformHints = {
      primaryInput: structureInfo?.primaryInput || 'text',
      supportsFileCaption: structureInfo?.hasRequiredImageOrVideoInput || false,
      supportsReplyWithCommand: true
    };
  
    toolDefinition.category = structureInfo?.toolCategory || 'unknown';
  
    toolDefinition.metadata = {
      deploymentId: actualDeploymentId,
      workflowApiId: workflowSummaryIfNoDeployment?.id || workflowData?.workflow_id || null,
      outputType: structureInfo?.outputType || 'unknown',
      hasPromptNode: structureInfo?.hasPromptNode || false,
      hasKSamplerNode: structureInfo?.hasKSamplerNode || false,
      hasLoraLoader: structureInfo?.hasLoraLoader || false,
      nodeTypes: structureInfo?.nodeTypes || []
    };
  
    // === Costing Model ===
    try {
      const costRate = await this.getCostRateForDeployment(actualDeploymentId);
      if (costRate) {
        toolDefinition.costingModel = {
          rate: costRate,
          unit: 'second',
          rateSource: 'machine'
        };
      } else {
        this.logger.warn(`[WorkflowCacheManager] No cost rate found for ${toolDefinition.toolId}.`);
      }
    } catch (err) {
      this.logger.warn(`[WorkflowCacheManager] Failed to get cost rate for ${toolDefinition.toolId}:`, err);
    }
  
    // === Webhook strategy ===
    toolDefinition.webhookStrategy = {
      expectedStatusField: 'status.status_str',
      successValue: 'success',
      durationTracking: true,
      resultPath: ['output.files']
    };
  
    // === Defaults for future extensibility ===
    toolDefinition.visibility = 'public';
    toolDefinition.humanDefaults = {}; // You may populate later if needed
  
    if (DEBUG_LOGGING_ENABLED && isFluxGeneralTool) {
      this.logger.info(`[WorkflowCacheManager-FLUXGENERAL] Final ToolDefinition: ${JSON.stringify(toolDefinition, null, 2)}`);
    }
  
    return toolDefinition;
  }
  

}

module.exports = WorkflowCacheManager; 