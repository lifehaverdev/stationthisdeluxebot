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
 * Extracts text content from all "Note" nodes in a workflow.
 * @param {object} workflowJson The workflow JSON object.
 * @returns {string[]} An array of strings, where each string is the content of a Note node.
 */
function extractNotes(workflowJson) {
  if (!workflowJson || !workflowJson.nodes || typeof workflowJson.nodes !== 'object') {
    return [];
  }

  const notes = [];
  for (const nodeId in workflowJson.nodes) {
    const node = workflowJson.nodes[nodeId];
    if (node.type === 'Note' || node.class_type === 'Note') {
      // Notes often store their text in widget_values or a similar property
      // This might need adjustment based on the exact structure of Note nodes
      if (node.widgets_values && Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
        if (typeof node.widgets_values[0] === 'string') {
          notes.push(node.widgets_values[0].trim());
        }
      } else if (node.properties && typeof node.properties.text === 'string') { // Another common pattern
        notes.push(node.properties.text.trim());
      } else if (typeof node.title === 'string' && (node.type === 'Note' || node.class_type === 'Note')){
        // Sometimes the note content is in the title if it's a simple note node.
        // Check type again to be sure it's a note node and not some other node with a title. 
        notes.push(node.title.trim());
      }
    }
  }
  return notes;
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
  extractNotes,
  getMachineForWorkflow
}; 