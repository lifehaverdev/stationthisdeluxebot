/**
 * Workflow Utilities
 * 
 * Helper functions extracted from WorkflowsService for better organization.
 */

/**
 * Standardize workflow names from any source to consistent internal format
 * 
 * @param {string} workflowName - Original workflow name from any source
 * @returns {string} - Standardized workflow name for internal use
 */
function standardizeWorkflowName(workflowName) {
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
 * Parse workflow JSON structure to extract useful information about nodes
 * 
 * @param {Object} workflowJson - The complete workflow JSON structure
 * @returns {Object} - Parsed workflow structure information
 */
function parseWorkflowStructure(workflowJson) {
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
 * @param {WorkflowsService} serviceInstance - The instance of the WorkflowsService
 * @param {string} name - Name of the workflow
 * @returns {Promise<Object>} - Default input payload with all required inputs pre-populated
 */
async function createDefaultInputPayload(serviceInstance, name) {
  // First try to get the cached inputs
  let requiredInputs = await serviceInstance.getWorkflowRequiredInputs(name);
  
  // If we don't have any inputs yet, try to get them from the workflow JSON directly
  if (!requiredInputs || requiredInputs.length === 0) {
    // Get detailed workflow information
    const workflowWithDetails = await serviceInstance.getWorkflowWithDetails(name);
    
    if (workflowWithDetails && workflowWithDetails.workflow_json && workflowWithDetails.workflow_json.nodes) {
      // Parse the workflow structure to find external input nodes
      const workflowStructure = parseWorkflowStructure(workflowWithDetails.workflow_json);
      requiredInputs = workflowStructure.externalInputNodes;
      
      // Store the input nodes for future use (Modify the instance cache directly - careful!)
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
 * @param {WorkflowsService} serviceInstance - The instance of the WorkflowsService
 * @param {string} name - Name of the workflow
 * @param {Object} inputPayload - The input payload to validate
 * @returns {Promise<Object>} - Object with isValid flag and any missing or invalid inputs
 */
async function validateInputPayload(serviceInstance, name, inputPayload) {
  const requiredInputs = await serviceInstance.getWorkflowRequiredInputs(name);
  const requiredInputMap = new Map((requiredInputs || []).map(i => [i.inputName, i])); // Handle case where requiredInputs might be null/undefined initially

  if (!requiredInputs) {
    // Should ideally not happen if getWorkflowRequiredInputs works, but handle defensively
    serviceInstance.logger.warn(`[validateInputPayload] Could not get required inputs for workflow: ${name}. Assuming valid.`);
    return { isValid: true, missingRequiredInputs: [], invalidTypeInputs: [], unknownInputs: [] };
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
 * @param {WorkflowsService} serviceInstance - The instance of the WorkflowsService
 * @param {string} name - Name of the workflow
 * @param {Object} userInputs - User-provided input values
 * @returns {Promise<Object>} - Complete input payload with defaults for missing values
 */
async function mergeWithDefaultInputs(serviceInstance, name, userInputs = {}) {
  // Use the utility function (passing the instance)
  const defaultPayload = await createDefaultInputPayload(serviceInstance, name); 
  
  // Start with the default payload
  const mergedPayload = { ...defaultPayload };
  
  // Override with user inputs where provided
  if (userInputs && typeof userInputs === 'object') {
    Object.keys(userInputs).forEach(key => {
      // Only override if the user provided a non-null/undefined value, 
      // AND if the key exists in the default payload (meaning it's a known input)
      if (userInputs[key] !== undefined && userInputs[key] !== null && key in defaultPayload) { 
        mergedPayload[key] = userInputs[key];
      }
    });
  }
  
  return mergedPayload;
}

/**
 * Prepare a complete payload for workflow execution with validation
 * 
 * @param {WorkflowsService} serviceInstance - The instance of the WorkflowsService
 * @param {string} name - Name of the workflow
 * @param {Object} userInputs - Optional user-provided inputs
 * @returns {Promise<Object>} - Object with payload, validation info, and workflow info
 */
async function prepareWorkflowPayload(serviceInstance, name, userInputs = {}) {
  // Get workflow details using the instance method
  const workflow = await serviceInstance.getWorkflowByName(name);
  
  if (!workflow) {
    return {
      success: false,
      error: `Workflow "${name}" not found`,
      payload: null,
      validation: null,
      workflow: null
    };
  }
  
  // Get the output type and lora support using instance methods
  const outputType = await serviceInstance.getWorkflowOutputType(name);
  const hasLoraSupport = await serviceInstance.hasLoraLoaderSupport(name);
  
  // Merge with default values using the utility function
  const payload = await mergeWithDefaultInputs(serviceInstance, name, userInputs);
  
  // Validate the payload using the utility function
  const validation = await validateInputPayload(serviceInstance, name, payload);
  
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
  
  // Include a recommended machine if available using the *utility* function
  const machineId = await getMachineForWorkflow(serviceInstance, name);
  if (machineId) {
    result.workflow.recommendedMachineId = machineId;
  }
  
  return result;
}

/**
 * Get appropriate machine for specific workflow based on routing rules
 * 
 * @param {WorkflowsService} serviceInstance - The instance of the WorkflowsService
 * @param {string} workflowName - Name of the workflow
 * @returns {Promise<string|null>} - Machine ID or null if no suitable machine found
 */
async function getMachineForWorkflow(serviceInstance, workflowName) {
  const standardizedName = standardizeWorkflowName(workflowName);
  const logger = serviceInstance.logger; // Get logger from instance
  const routingConfig = serviceInstance.routingConfig; // Get routing config from instance

  // Check if we have a specific rule for this workflow
  if (routingConfig?.routingRules && routingConfig.routingRules[standardizedName]) {
    const machineId = routingConfig.routingRules[standardizedName];
    
    // Verify that the machine exists and is ready using the instance method
    const machine = await serviceInstance.getMachineById(machineId);
    if (machine && machine.status === 'ready') {
      logger.info(`Routing workflow "${standardizedName}" to machine: ${machine.name} (${machineId})`);
      return machineId;
    } else {
      logger.info(`Configured machine for "${standardizedName}" (${machineId}) is not available, falling back to default`);
    }
  }
  
  // If no specific rule or the machine isn't available, use default machine
  if (routingConfig?.defaultMachine) {
    const defaultMachine = await serviceInstance.getMachineById(routingConfig.defaultMachine);
    if (defaultMachine && defaultMachine.status === 'ready') {
      logger.info(`Using default machine for workflow "${standardizedName}": ${defaultMachine.name} (${routingConfig.defaultMachine})`);
      return routingConfig.defaultMachine;
    }
  }
  
  // If default machine isn't available either, find any ready machine using the instance method
  const machines = await serviceInstance.getMachines(); // Use instance method
  const readyMachine = machines.find(machine => machine.status === 'ready');
  
  if (readyMachine) {
    logger.info(`Using fallback ready machine for workflow "${standardizedName}": ${readyMachine.name} (${readyMachine.id})`);
    return readyMachine.id;
  }
  
  logger.info(`No suitable machine found for workflow "${standardizedName}"`);
  return null;
}

module.exports = {
  standardizeWorkflowName,
  parseWorkflowStructure,
  createDefaultInputPayload,
  validateInputPayload,
  mergeWithDefaultInputs,
  prepareWorkflowPayload,
  getMachineForWorkflow
}; 