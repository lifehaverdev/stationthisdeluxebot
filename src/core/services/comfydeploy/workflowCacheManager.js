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
  parseWorkflowStructure 
} = require('./workflowUtils');

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

    } catch (listError) {
        this.logger.error(`[WorkflowCacheManager] Error fetching workflow list from API: ${listError.message}`);
        // If we can't get the list, we can't proceed with fetching details.
        throw listError; // Re-throw to halt initialization if the list fails
    }
    
    const processedWorkflows = [];
    const fetchPromises = [];

    for (const workflowSummary of workflowsList) {
        // Call the helper function (now part of this class) for each summary
        fetchPromises.push(
            this._fetchAndProcessWorkflowDetails(workflowSummary) 
                .then(processedWorkflow => {
                    if (processedWorkflow) {
                        processedWorkflows.push(processedWorkflow);
                    } else {
                         this.logger.warn(`[WorkflowCacheManager:_fetchWorkflows] Failed to process details for workflow summary: ${JSON.stringify(workflowSummary.name || workflowSummary.id)}`);
                    }
                })
        );
    }

    // Wait for all detail fetching and processing to complete
    const results = await Promise.allSettled(fetchPromises); 
    
    const fulfilledCount = results.filter(r => r.status === 'fulfilled').length;
    const rejectedCount = results.filter(r => r.status === 'rejected').length;
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_fetchWorkflows] Detail processing settled. Fulfilled: ${fulfilledCount}, Rejected: ${rejectedCount}, Total Processed Objects: ${processedWorkflows.length}`);

    // Update the cache managed by this instance
    this.cache.workflows = processedWorkflows;
    this.cache.lastUpdated = Date.now(); // Update timestamp after successful fetch & process
    
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_fetchWorkflows] Finished processing workflow details. Stored ${this.cache.workflows.length} workflows in cache.`);
    
    // Return the processed workflows (caller might use it, e.g., initialize)
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
    const workflowId = workflowSummary.id;
    const originalName = workflowSummary.name;
    const standardName = standardizeWorkflowName(originalName); // Use imported utility
    
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_fetchAndProcessWorkflowDetails] Starting for: ${originalName} (ID: ${workflowId}, Standard: ${standardName})`);

    if (!workflowId || !originalName) {
        this.logger.warn(`[WorkflowCacheManager:_fetchAndProcessWorkflowDetails] Skipping due to missing ID or name in summary: ${JSON.stringify(workflowSummary)}`);
        return null;
    }

    try {
        const processedWorkflow = {
            id: workflowId,
            name: originalName, 
            standardName: standardName,
            displayName: workflowSummary.display_name || originalName,
            description: workflowSummary.description || '',
            inputs: [],
            deploymentIds: [], // Populated later by _buildIndexes
            versions: [],
            createdAt: workflowSummary.created_at,
            updatedAt: workflowSummary.updated_at,
            workflow_json: {},
            requiredInputs: [],
            outputType: 'unknown',
            hasLoraLoader: false,
            rawSummary: workflowSummary
        };
      
      if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_fetchAndProcessWorkflowDetails] Calling _getWorkflowJsonStructure for ID: ${workflowId}`);
      const { workflowJson, versions } = await this._getWorkflowJsonStructure(workflowId);
      if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_fetchAndProcessWorkflowDetails] Received from _getWorkflowJsonStructure for ID: ${workflowId}. Has JSON: ${!!(workflowJson && workflowJson.nodes)}, Versions: ${versions.length}`);

      processedWorkflow.versions = versions || [];

      if (workflowJson && workflowJson.nodes) {
            if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_fetchAndProcessWorkflowDetails] Parsing workflow structure for ${standardName} (ID: ${workflowId})`);
            try {
              const structureInfo = parseWorkflowStructure(workflowJson); // Use imported utility
                processedWorkflow.requiredInputs = structureInfo.externalInputNodes;
                processedWorkflow.outputType = structureInfo.outputType;
                processedWorkflow.hasLoraLoader = structureInfo.hasLoraLoader;
                processedWorkflow.inputs = processedWorkflow.requiredInputs.map(i => i.inputName); 
                if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_fetchAndProcessWorkflowDetails] Successfully parsed structure for ${standardName}. Inputs: ${processedWorkflow.requiredInputs.length}, Output: ${processedWorkflow.outputType}, LoRA: ${processedWorkflow.hasLoraLoader}`);
            } catch(parseError) {
                this.logger.error(`[WorkflowCacheManager:_fetchAndProcessWorkflowDetails] Error parsing workflow structure for ${standardName} (ID: ${workflowId}): ${parseError.message}`);
                processedWorkflow.inputs = [];
            }
        } else {
            this.logger.warn(`[WorkflowCacheManager:_fetchAndProcessWorkflowDetails] Workflow details fetched for ${standardName}, but no usable workflow_json found. Cannot parse structure. ID: ${workflowId}`);
             processedWorkflow.inputs = [];
        }

        if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_fetchAndProcessWorkflowDetails] Finished processing for: ${originalName} (ID: ${workflowId})`);
        return processedWorkflow;

    } catch (error) {
      this.logger.error(`[WorkflowCacheManager:_fetchAndProcessWorkflowDetails] Unexpected error processing workflow ${originalName} (ID: ${workflowId}): ${error.message}`, { stack: error.stack });
      return null;
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
    this.cache.byDeploymentId.clear(); // Clear deployment ID index too
    
    // Index raw deployments by ID first
    this.cache.deployments.forEach(deployment => {
      if (deployment && deployment.id) {
        this.cache.byDeploymentId.set(deployment.id, deployment);
      } else {
        this.logger.warn(`[WorkflowCacheManager:_buildIndexes] Skipping deployment indexing due to missing ID: ${JSON.stringify(deployment)}`);
      }
    });
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_buildIndexes] Indexed ${this.cache.byDeploymentId.size} deployments by ID.`);

    // Reset deployment IDs on all cached workflows before linking
    this.cache.workflows.forEach(workflow => {
        workflow.deploymentIds = []; 
    });

    // Index workflows by standardized name
    this.cache.workflows.forEach(workflow => {
      if (workflow && workflow.standardName) { 
        const standardName = workflow.standardName; 
        
        if (this.cache.byName.has(standardName)) {
            const existingWorkflow = this.cache.byName.get(standardName);
            this.logger.warn(`[WorkflowCacheManager:_buildIndexes] Workflow name collision detected for standardized name "${standardName}". Original names: "${existingWorkflow.name}" (ID: ${existingWorkflow.id}) and "${workflow.name}" (ID: ${workflow.id}). Overwriting with the latter.`);
        }
        this.cache.byName.set(standardName, workflow);
      } else {
         this.logger.warn(`[WorkflowCacheManager:_buildIndexes] Skipping workflow indexing due to missing standardName or object: ${JSON.stringify(workflow)}`);
      }
    });
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_buildIndexes] Indexed ${this.cache.byName.size} workflows by standardized name.`);

    // Link Deployments (already indexed by ID) to Workflows (indexed by name)
    if (DEBUG_LOGGING_ENABLED) this.logger.info('[WorkflowCacheManager:_buildIndexes] Linking deployments to workflows...');
    let linkedCount = 0;
    this.cache.deployments.forEach(deployment => {
        if (!deployment || !deployment.workflow_id || !deployment.id) {
            return; // Skip if essential info is missing
        }

        // Find the corresponding workflow in the cache.workflows array
        const targetWorkflow = this.cache.workflows.find(wf => wf.id === deployment.workflow_id);

        if (targetWorkflow) {
            // Ensure deploymentIds array exists (should be initialized in _fetchAndProcessWorkflowDetails)
            if (!targetWorkflow.deploymentIds) {
                this.logger.warn(`[WorkflowCacheManager:_buildIndexes] Initializing missing deploymentIds array for workflow "${targetWorkflow.name}" (ID: ${targetWorkflow.id}) during linking.`);
                targetWorkflow.deploymentIds = [];
            }
            
            if (!targetWorkflow.deploymentIds.includes(deployment.id)) {
              targetWorkflow.deploymentIds.push(deployment.id);
              linkedCount++;
            }
        } else {
             // This might happen if a deployment points to a workflow not returned by the /workflows endpoint
             this.logger.warn(`[WorkflowCacheManager:_buildIndexes] Could not find workflow with ID "${deployment.workflow_id}" in cache to link deployment "${deployment.id}" (Name: ${deployment.name || 'N/A'}).`);
        }
    });
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[WorkflowCacheManager:_buildIndexes] Successfully linked ${linkedCount} deployment IDs to workflows.`);
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
      await this._fetchWorkflows(); // Fetches list and processes details
      
      // Build indexes using the fetched data in the cache
      this._buildIndexes(); 
      
      // Mark as initialized *after* all steps succeed
      this.isInitialized = true;
      this._hasInitializedOnce = true; 
      this.cache.lastUpdated = Date.now(); // Ensure timestamp is set after full successful init

      this.logger.info(`[WorkflowCacheManager] Cache initialized successfully. Found ${this.cache.workflows.length} workflows, ${this.cache.deployments.length} deployments, ${this.cache.machines.length} machines.`);
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

}

module.exports = WorkflowCacheManager; 