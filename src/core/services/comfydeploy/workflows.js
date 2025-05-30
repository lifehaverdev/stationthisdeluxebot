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
  extractNotes
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

// geniusoverhaul: Import ToolRegistry
const { ToolRegistry } = require('../../tools/ToolRegistry.js');

// BEGIN ADDITION: Import LoRA Resolution Service
const loraResolutionService = require('../loraResolutionService'); // Path from comfydeploy/workflows.js to services/loraResolutionService.js
// END ADDITION

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
    
    // geniusoverhaul: Get ToolRegistry instance
    this.toolRegistry = ToolRegistry.getInstance();
    
    // Instantiate the Cache Manager, passing relevant options
    this.cacheManager = new WorkflowCacheManager({
      apiUrl: this.apiUrl,
      apiKey: this.apiKey,
      timeout: this.timeout,
      logger: this.logger,
      cacheConfig: options.cache // Pass the cache config sub-object
    });
    
    //DEPRECATED / HALLUCINATED
    // Load machine routing configuration
    // try {
    //   const configPath = path.resolve(process.cwd(), 'config/workflow-machine-routing.js');
    //   this.routingConfig = require(configPath);
    //   if (DEBUG_LOGGING_ENABLED) this.logger.info(`Loaded machine routing configuration with ${Object.keys(this.routingConfig.routingRules).length} rules`);
    // } catch (error) {
    //   this.logger.warn(`Could not load machine routing configuration: ${error.message}`);
    //   this.routingConfig = {
    //     routingRules: {},
    //     defaultMachine: null
    //   };
    // }
    
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
    
    // Access cache via manager - this now returns ToolDefinition[]
    return this.cacheManager.cache.workflows; 
  }

  /**
   * Get a tool by its display name (standardized).
   * @param {string} displayName - Display name of the tool.
   * @returns {Promise<ToolDefinition|null>} - ToolDefinition object or null if not found.
   */
  async getToolByDisplayName(displayName) { // Renamed from getWorkflowByName for clarity
    await this.cacheManager.ensureInitialized();
    
    const standardName = standardizeWorkflowName(displayName);
    if (DEBUG_LOGGING_ENABLED) this.logger.info(`[getToolByDisplayName] Looking up standard display name: "${standardName}" (from original: "${displayName}")`);
    
    let tool = this.cacheManager.cache.byName.get(standardName); // byName is keyed by sanitized displayName
    
    if (!tool && displayName !== standardName) {
      tool = this.cacheManager.cache.byName.get(displayName); 
      if (tool && DEBUG_LOGGING_ENABLED) this.logger.info(`Found tool using original displayName "${displayName}"`);
    }
    
    if (!tool && DEBUG_LOGGING_ENABLED) {
        const availableKeys = Array.from(this.cacheManager.cache.byName.keys());
        this.logger.warn(`[getToolByDisplayName] Tool with display name "${standardName}" not found. Available byName keys: ${availableKeys.join(", ")}`);
    }
    return tool || null;
  }

  /**
   * Get a tool by its ID.
   * @param {string} toolId - The ID of the tool (e.g., comfy-xxxxxxxx).
   * @returns {Promise<ToolDefinition|null>} - ToolDefinition object or null if not found.
   */
  async getToolById(toolId) {
    await this.cacheManager.ensureInitialized();
    // The cacheManager's byName map is also indexed by toolId as per its _buildIndexes method
    return this.cacheManager.cache.byName.get(toolId) || null;
  }
  
  /**
   * Get required inputs for a specific tool.
   * @param {string} toolId - The ID of the tool.
   * @returns {Promise<Array>} - Array of required input objects { name, type, default, required, description, advanced }.
   */
  async getToolRequiredInputs(toolId) {
    const tool = await this.getToolById(toolId);

    if (!tool) {
      this.logger.warn(`[getToolRequiredInputs] Tool with ID "${toolId}" not found.`);
      return [];
    }
    
    if (!tool.inputSchema) {
      this.logger.warn(`[getToolRequiredInputs] Tool "${toolId}" has no inputSchema defined.`);
      return [];
    }

    const requiredInputs = [];
    for (const inputName in tool.inputSchema) {
      const fieldSchema = tool.inputSchema[inputName];
      if (fieldSchema.required) {
        requiredInputs.push({
          name: inputName, // fieldSchema.name is already the key
          type: fieldSchema.type,
          default: fieldSchema.default,
          required: fieldSchema.required,
          description: fieldSchema.description || '',
          advanced: fieldSchema.advanced || false,
        });
      }
    }
    return requiredInputs;
  }

  /**
   * Get the output type for a specific workflow (retrieved from cached data)
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<string>} - Type of output (image, video, animation, unknown)
   */
  async getWorkflowOutputType(name) { // name here is displayName
    const tool = await this.getToolByDisplayName(name); // Changed to use getToolByDisplayName
    
    // Output type isn't directly on ToolDefinition yet.
    // This might need to be inferred or added to ToolDefinition.metadata if still needed.
    // For now, return unknown or a placeholder based on category if possible.
    if (tool && tool.category) {
        if (tool.category.includes('image')) return 'image';
        if (tool.category.includes('video')) return 'video';
    }
    return tool?.metadata?.outputType || 'unknown'; // Assuming it might be in metadata
  }

  /**
   * Check if a tool supports LoRA loading (retrieved from cached data)
   * @param {string} name - Display name of the tool
   * @returns {Promise<boolean>} - True if tool supports LoRA, false otherwise
   */
  async hasLoraLoaderSupport(name) { // name here is displayName
    const tool = await this.getToolByDisplayName(name); // Changed to use getToolByDisplayName
    
    // LoRA support isn't directly on ToolDefinition.
    // This might be inferred from inputSchema (e.g., has a 'lora_name' input)
    // or stored in tool.metadata.
    // For now, default to false or check metadata.
    return tool?.metadata?.hasLoraLoader || false; 
  }

  /**
   * Get deployment IDs associated with a specific tool (by display name).
   * @param {string} displayName - Display name of the tool.
   * @returns {Promise<Array|null>} - Array of deployment IDs or null if tool not found.
   */
  async getDeploymentIdsByToolDisplayName(displayName) { // Renamed for clarity
    const tool = await this.getToolByDisplayName(displayName); 
    
    if (!tool) {
      this.logger.warn(`[getDeploymentIdsByToolDisplayName] Tool with displayName "${displayName}" not found.`);
      return null; // Keep null if tool itself not found, as per original logic for getDeploymentIdsByName
    }

    if (tool.metadata) {
        if (Array.isArray(tool.metadata.deploymentIds) && tool.metadata.deploymentIds.length > 0) {
            return tool.metadata.deploymentIds;
        }
        if (tool.metadata.deploymentId) {
            // Ensure it's the raw deployment_id, not the toolId like "comfy-..."
            const rawDeploymentId = tool.metadata.deploymentId.startsWith('comfy-') 
                ? tool.metadata.deploymentId.substring(6) 
                : tool.metadata.deploymentId;
            return [rawDeploymentId];
        }
    }
    
    this.logger.warn(`[getDeploymentIdsByToolDisplayName] No deploymentId(s) found in metadata for tool "${tool.toolId}".`);
    return []; // Return empty array if tool exists but no IDs, consistent with old logic
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
  async getWorkflowInputs(name) { // name is displayName
    const tool = await this.getToolByDisplayName(name); // Changed to use getToolByDisplayName
    if (!tool || !tool.inputSchema) {
        this.logger.warn(`[getWorkflowInputs] Tool "${name}" not found or no inputSchema.`);
        return [];
    }
    // Convert inputSchema object to an array of { name, type, default, required, ... }
    return Object.entries(tool.inputSchema).map(([inputName, fieldSchema]) => ({
        name: inputName,
        type: fieldSchema.type,
        default: fieldSchema.default,
        required: fieldSchema.required,
        description: fieldSchema.description,
        advanced: fieldSchema.advanced
    }));
  }

  /**
   * Check if workflow exists
   * 
   * @param {string} name - Name of the workflow
   * @returns {Promise<boolean>} - True if workflow exists
   */
  async hasWorkflow(name) { // name is displayName
    const tool = await this.getToolByDisplayName(name); // Changed to use getToolByDisplayName
    return !!tool;
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
   * Creates a default input payload for a given tool ID or display name.
   * @param {string} toolIdentifier - The tool's ID or display name.
   * @returns {Promise<Object>} - Default input payload.
   */
  async createDefaultToolInputPayload(toolIdentifier) {
    let tool = await this.getToolById(toolIdentifier);
    if (!tool) {
      tool = await this.getToolByDisplayName(toolIdentifier);
    }

    if (!tool || !tool.inputSchema) {
      this.logger.warn(`[createDefaultToolInputPayload] Tool "${toolIdentifier}" not found or has no inputSchema.`);
      return {};
    }

    const payload = {};
    for (const inputName in tool.inputSchema) {
      const fieldSchema = tool.inputSchema[inputName];
      if (fieldSchema.default !== undefined) {
        payload[inputName] = fieldSchema.default;
      }
      // No warning for required fields without defaults here, as per previous createDefaultInputPayload structure
    }
    return payload;
  }

  /**
   * Validates an input payload against a tool's inputSchema.
   * @param {string} toolIdentifier - The tool's ID or display name.
   * @param {Object} inputPayload - The user-provided inputs.
   * @returns {Promise<{isValid: boolean, errors: string[], validatedPayload: Object}>}
   */
  async validateToolInputPayload(toolIdentifier, inputPayload) {
    let tool = await this.getToolById(toolIdentifier);
    if (!tool) {
      tool = await this.getToolByDisplayName(toolIdentifier);
    }

    if (!tool) {
      return { isValid: false, errors: [`Tool "${toolIdentifier}" not found.`], validatedPayload: inputPayload };
    }
    if (!tool.inputSchema) {
      return { isValid: false, errors: [`Tool "${tool.toolId}" has no inputSchema.`], validatedPayload: inputPayload };
    }

    const errors = [];
    const validatedPayload = { ...inputPayload }; 

    for (const inputName in tool.inputSchema) {
      const fieldSchema = tool.inputSchema[inputName];

      if (fieldSchema.required && !(inputName in validatedPayload) && fieldSchema.default === undefined) {
        errors.push(`Missing required input: "${inputName}" for tool "${tool.toolId}".`);
      }
      
      if (!(inputName in validatedPayload) && fieldSchema.default !== undefined) {
        validatedPayload[inputName] = fieldSchema.default; // Apply default if missing
      }
      
      // Simple Type Checking (can be expanded)
      if (inputName in validatedPayload) {
        const value = validatedPayload[inputName];
        if (fieldSchema.type === 'number' && typeof value !== 'number') {
          // Attempt coercion for strings that are numbers
          const numValue = Number(value);
          if (isNaN(numValue)) {
            errors.push(`Input "${inputName}" for tool "${tool.toolId}" must be a number. Received: ${typeof value}`);
          } else {
            validatedPayload[inputName] = numValue; // Use coerced value
          }
        } else if (fieldSchema.type === 'string' && typeof value !== 'string') {
          errors.push(`Input "${inputName}" for tool "${tool.toolId}" must be a string. Received: ${typeof value}`);
        } else if (fieldSchema.type === 'boolean' && typeof value !== 'boolean') {
          errors.push(`Input "${inputName}" for tool "${tool.toolId}" must be a boolean. Received: ${typeof value}`);
        }
        // Add more type checks as needed (image, video, file might need different validation)
      }
    }
    
    // Optional: Check for extraneous inputs
    // for (const keyInPayload in validatedPayload) {
    //   if (!(keyInPayload in tool.inputSchema)) {
    //     errors.push(`Unknown input field "${keyInPayload}" provided for tool "${tool.toolId}".`);
    //   }
    // }

    return { isValid: errors.length === 0, errors, validatedPayload };
  }

  /**
   * Merges user inputs with the default values from a tool's inputSchema.
   * @param {string} toolIdentifier - The tool's ID or display name.
   * @param {Object} userInputs - The user-provided inputs.
   * @returns {Promise<Object>} - The merged payload.
   */
  async mergeToolWithDefaultInputs(toolIdentifier, userInputs = {}) {
    let tool = await this.getToolById(toolIdentifier);
    if (!tool) {
      tool = await this.getToolByDisplayName(toolIdentifier);
    }

    if (!tool || !tool.inputSchema) {
      this.logger.warn(`[mergeToolWithDefaultInputs] Tool "${toolIdentifier}" not found or has no inputSchema. Returning user inputs as is.`);
      return { ...userInputs };
    }

    const finalPayload = { ...userInputs }; // Start with user inputs

    for (const inputName in tool.inputSchema) {
      const fieldSchema = tool.inputSchema[inputName];
      // Apply default only if the input is NOT provided by the user
      if (!(inputName in finalPayload) && fieldSchema.default !== undefined) {
        finalPayload[inputName] = fieldSchema.default;
      }
    }
    return finalPayload;
  }

  /**
   * Prepares the final payload for running a ComfyUI workflow using a tool.
   * This now uses toolId primarily and relies on the refactored methods.
   * @param {string} toolId - The ID of the tool.
   * @param {Object} userInputs - User-provided input values.
   * @param {string} masterAccountId - The master account ID of the user invoking the tool.
   * @returns {Promise<Object|null>} - Prepared payload or null if error.
   */
  async prepareToolRunPayload(toolId, userInputs = {}, masterAccountId) { 
    const tool = await this.getToolById(toolId);
    if (!tool) {
        this.logger.error(`[WorkflowsService-prepareToolRunPayload] Tool with ID "${toolId}" not found.`);
        // Return null or throw an error based on desired error handling strategy
        // For consistency with original apparent logic, returning null if tool not found by getToolById
        // which itself might return null.
        throw new Error(`Tool with ID "${toolId}" not found.`); 
    }
    // Original check for comfyui service type - this is important if this service only handles comfyui tools
    if (tool.service !== 'comfyui') {
        this.logger.error(`[WorkflowsService-prepareToolRunPayload] Tool "${toolId}" is not a comfyui service tool. Service: ${tool.service}`);
        throw new Error(`Tool "${toolId}" is not a ComfyUI service tool.`);
    }

    let currentInputs = { ...userInputs }; // Work with a copy of user inputs
    let appliedLoras = [];
    let loraWarnings = [];
    let rawPrompt = null;

    // BEGIN LoRA Resolution Logic Integration
    if (tool.metadata && tool.metadata.hasLoraLoader && currentInputs.input_prompt && typeof currentInputs.input_prompt === 'string') {
      if (!masterAccountId) {
        this.logger.warn(`[WorkflowsService-prepareToolRunPayload] masterAccountId not provided for LoRA resolution on tool ${toolId}. LoRA resolution might be incomplete or fail if private LoRAs are involved.`);
        // Consider throwing if masterAccountId is absolutely critical: 
        // throw new Error('masterAccountId is required for LoRA-enabled tools when preparing payload.');
      }
      
      this.logger.info(`[WorkflowsService-prepareToolRunPayload] Tool ${toolId} has LoRA loader. Attempting to resolve LoRAs for prompt.`);
      rawPrompt = currentInputs.input_prompt; // Store original prompt before modification
      try {
        const resolutionResult = await loraResolutionService.resolveLoraTriggers(rawPrompt, masterAccountId);
        currentInputs.input_prompt = resolutionResult.modifiedPrompt; // Modify the working copy of inputs
        appliedLoras = resolutionResult.appliedLoras || [];
        loraWarnings = resolutionResult.warnings || [];
        
        if (DEBUG_LOGGING_ENABLED || (tool.metadata.hasLoraLoader && currentInputs.input_prompt !== rawPrompt)) {
            this.logger.info(`[WorkflowsService-prepareToolRunPayload] LoRA resolution for ${toolId}. Raw: "${rawPrompt}", Modified: "${currentInputs.input_prompt}"`);
        }
        if (appliedLoras.length > 0) {
          this.logger.info(`[WorkflowsService-prepareToolRunPayload] Applied LoRAs for ${toolId}: ${JSON.stringify(appliedLoras)}`);
        }
        if (loraWarnings.length > 0) {
          this.logger.warn(`[WorkflowsService-prepareToolRunPayload] LoRA resolution warnings for ${toolId}: ${JSON.stringify(loraWarnings)}`);
        }
      } catch (error) {
        this.logger.error(`[WorkflowsService-prepareToolRunPayload] Error during LoRA resolution for tool ${toolId}: ${error.message}`, error);
        loraWarnings.push(`LoRA resolution failed: ${error.message}. Proceeding with original prompt.`);
        // currentInputs.input_prompt remains rawPrompt if error occurs
      }
    } else if (tool.metadata && tool.metadata.hasLoraLoader && (!currentInputs.input_prompt || typeof currentInputs.input_prompt !== 'string')) {
        this.logger.warn(`[WorkflowsService-prepareToolRunPayload] Tool ${toolId} has LoRA loader, but input_prompt is missing or not a string.`);
    }
    // END LoRA Resolution Logic Integration

    // Proceed with validation using the potentially modified currentInputs
    const { isValid, errors, validatedPayload } = await this.validateToolInputPayload(toolId, currentInputs);

    if (!isValid) {
      this.logger.error(`[WorkflowsService-prepareToolRunPayload] Invalid input payload for tool "${toolId}" after LoRA processing (if any): ${errors.join(', ')}`);
      // Consider throwing an error or returning a more structured error response
      throw new Error(`Invalid input payload for tool "${toolId}": ${errors.join(', ')}`);
    }
    
    // Merge with defaults, using the validated (and potentially LoRA-modified) payload
    const finalInputsForComfy = await this.mergeToolWithDefaultInputs(toolId, validatedPayload);

    // Construct the final payload structure
    const finalComfyPayload = {
      deployment_id: tool.metadata.deploymentId, 
      inputs: finalInputsForComfy, // These are the direct inputs for the ComfyUI workflow
      // Attach LoRA resolution metadata for our system's logging/downstream use
      loraResolutionData: {
        rawPrompt: rawPrompt, // Original prompt if LoRA processing was attempted
        modifiedPrompt: finalInputsForComfy.input_prompt, // The actual prompt text sent to ComfyUI
        appliedLoras: appliedLoras,
        warnings: loraWarnings
      }
    };

    if (DEBUG_LOGGING_ENABLED) {
        this.logger.info(`[WorkflowsService-prepareToolRunPayload] Prepared payload for tool ${toolId}: ${JSON.stringify(finalComfyPayload).substring(0, 1000)}...`);
    }

    return finalComfyPayload;
  }
}

module.exports = WorkflowsService; 