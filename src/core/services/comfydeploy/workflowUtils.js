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
function parseWorkflowStructure(workflowJson) {
  if (!workflowJson || typeof workflowJson !== 'object' || !workflowJson.nodes) {
    return {
      nodeCount: 0,
      nodeTypes: [],
      hasPromptNode: false,
      hasKSamplerNode: false,
      hasLoraLoader: false,
      outputType: 'unknown',
      toolCategory: 'unknown',
      primaryInput: 'none',
      requiredInputs: [],
      inputSchema: {},
      externalInputNodes: [],
      inputNodes: [],
      outputNodes: [],
      hasRequiredImageOrVideoInput: false, // legacy flag (main image required)
      mainImageRequired: false, // new explicit flag
      supportingImageInputs: [], // store names of supporting images like style/control etc.
      hasSupportingImages: false
    };
  }

  const nodeTypes = new Set();
  const inputNodes = [];
  const outputNodes = [];
  const externalInputNodes = [];
  const inputTypeCount = { text: 0, image: 0, model: 0, integer: 0, float: 0 };
  let hasPromptNode = false;
  let hasKSamplerNode = false;
  let hasLoraLoader = false;
  let outputType = 'unknown';
  const inputSchema = {};
  const requiredInputs = [];
  let hasRequiredImageOrVideoInput = false; // legacy flag (main image required)
  let mainImageRequired = false; // new explicit flag
  const supportingImageInputs = []; // store names of supporting images like style/control etc.

  const isEffectivelyEmpty = (val) => val === null || val === undefined || (typeof val === 'string' && val.trim() === '');

  Object.entries(workflowJson.nodes).forEach(([nodeId, node]) => {
    let nodeType = node.class_type || node.type || `Unknown_${nodeId}`;
    nodeTypes.add(nodeType);

    if (nodeType.includes('MultiLoraLoader')) hasLoraLoader = true;

    if (nodeType.startsWith('ComfyUIDeployExternal')) {
      let inputType = nodeType.replace('ComfyUIDeployExternal', '').toLowerCase();
      const widgetValues = node.widgets_values || [];
      const inputName = widgetValues[0] || `input_${nodeId}`;
      const defaultValue = widgetValues.length > 1 ? widgetValues[1] : null;
      const description = widgetValues.length > 2 ? widgetValues[2] : '';

      // Normalize inputType
      if (inputType === 'numberint') inputType = 'integer';
      if (inputType === 'numberfloat') inputType = 'float';

      inputTypeCount[inputType] = (inputTypeCount[inputType] || 0) + 1;

      const isRequired = isEffectivelyEmpty(defaultValue);
      if (inputType === 'image') {
        const lowerName = inputName.toLowerCase();
        const isMainImage = ['input_image', 'init_image', 'inputimage', 'initimage'].includes(lowerName);
        const isSupportingImage = !isMainImage; // everything else treated as supporting image

        if (isMainImage && isRequired) {
          mainImageRequired = true;
          hasRequiredImageOrVideoInput = true; // keep legacy field in sync
        } else if (isSupportingImage) {
          supportingImageInputs.push(inputName);
        }
      } else if (isRequired && inputType === 'video') {
        hasRequiredImageOrVideoInput = true;
      }

      externalInputNodes.push({
        id: nodeId,
        type: nodeType,
        inputType,
        inputName,
        defaultValue,
        description
      });

      inputSchema[inputName] = {
        name: inputName,
        type: inputType,
        default: defaultValue,
        description,
        required: isRequired
      };

      if (isRequired) {
        requiredInputs.push(inputName);
      }
    }

    if (nodeType.includes('TextEncode')) {
      hasPromptNode = true;
      inputNodes.push({ id: nodeId, type: nodeType, inputs: node.inputs || {} });
    }
    if (nodeType.includes('Sampler')) {
      hasKSamplerNode = true;
    }

    if (nodeType.includes('SaveImage') || nodeType === 'VAEDecode') {
      outputType = 'image';
      outputNodes.push({ id: nodeId, type: nodeType, outputType: 'image' });
    } else if (nodeType.includes('VideoCombine')) {
      outputType = 'video';
      outputNodes.push({ id: nodeId, type: nodeType, outputType: 'video' });
    } else if (nodeType.includes('GIF') || nodeType.includes('AnimateDiff')) {
      outputType = 'animation';
      outputNodes.push({ id: nodeId, type: nodeType, outputType: 'animation' });
    }
  });

  // === Tool Category Logic ===
  let toolCategory = 'unknown';
  const inputTypes = Object.keys(inputTypeCount).filter(k => inputTypeCount[k] > 0);
  const hasText = inputTypeCount.text > 0;
  const hasImage = inputTypeCount.image > 0;

  if (hasText && hasImage && outputType === 'image') {
    toolCategory = 'img2img';
  } else if (hasText && outputType === 'image') {
    toolCategory = 'text-to-image';
  } else if (hasImage && outputType === 'image') {
    toolCategory = 'img2img';
  } else if (outputType === 'video') {
    toolCategory = 'video';
  } else if (inputTypes.includes('model')) {
    toolCategory = 'interrogate';
  } else if (outputType === 'image' && inputTypes.length === 0) {
    toolCategory = 'interrogate';
  }

  let primaryInput = 'none';

  // Prefer required inputs first
  const requiredInputTypes = Object.values(inputSchema)
    .filter(i => i.required)
    .map(i => i.type);

  if (requiredInputTypes.includes('image')) primaryInput = 'image';
  else if (requiredInputTypes.includes('video')) primaryInput = 'video';
  else if (requiredInputTypes.includes('text')) primaryInput = 'text';
  else if (inputTypeCount.text > 0) primaryInput = 'text';
  else if (inputTypeCount.image > 0) primaryInput = 'image';
  else if (inputTypeCount.video > 0) primaryInput = 'video';

  return {
    nodeCount: Object.keys(workflowJson.nodes).length,
    nodeTypes: Array.from(nodeTypes),
    hasPromptNode,
    hasKSamplerNode,
    hasLoraLoader,
    outputType,
    toolCategory,
    primaryInput,
    requiredInputs,
    inputSchema,
    externalInputNodes,
    inputNodes,
    outputNodes,
    hasRequiredImageOrVideoInput,
    mainImageRequired,
    supportingImageInputs,
    hasSupportingImages: supportingImageInputs.length > 0
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

// BEGIN ADDITION: Directive parsing helper
/**
 * Parse @bot directive lines from workflow notes.
 * Syntax: "@bot <scope> <key>=<value>[,<key>=<value>...]"
 * Example: "@bot telegram send-as=document,filename=rmbg.png"
 *
 * @param {string[]} notes Array of note strings extracted via extractNotes().
 * @returns {object} Map of scopes to key/value pairs, e.g. { telegram: { 'send-as': 'document' } }
 */
function parseNoteDirectives(notes = []) {
  const directives = {};
  const directiveRegex = /^@bot\s+(\w+)\s+(.+)$/i;

  for (const note of notes) {
    if (typeof note !== 'string') continue;
    const trimmed = note.trim();
    const match = trimmed.match(directiveRegex);
    if (!match) continue;

    const scope = match[1].toLowerCase();
    const kvPart = match[2];
    if (!directives[scope]) directives[scope] = {};

    // Split by comma to get key=value pairs
    kvPart.split(',').forEach(pair => {
      const [rawKey, ...rest] = pair.split('=');
      if (!rawKey) return;
      const key = rawKey.trim();
      const value = rest.join('=')?.trim(); // allow = in value
      if (key) {
        directives[scope][key] = value ?? true; // if no value provided, set true
      }
    });
  }

  return directives;
}
// END ADDITION

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
      logger.debug(`Routing workflow "${standardizedName}" to machine: ${machine.name} (${machineId})`);
      return machineId;
    } else {
      logger.debug(`Configured machine for "${standardizedName}" (${machineId}) is not available, falling back to default`);
    }
  }
  
  // If no specific rule or the machine isn't available, use default machine
  if (routingConfig?.defaultMachine) {
    const defaultMachine = await serviceInstance.getMachineById(routingConfig.defaultMachine);
    if (defaultMachine && defaultMachine.status === 'ready') {
      logger.debug(`Using default machine for workflow "${standardizedName}": ${defaultMachine.name} (${routingConfig.defaultMachine})`);
      return routingConfig.defaultMachine;
    }
  }
  
  // If default machine isn't available either, find any ready machine using the instance method
  const machines = await serviceInstance.getMachines(); // Use instance method
  const readyMachine = machines.find(machine => machine.status === 'ready');
  
  if (readyMachine) {
    logger.debug(`Using fallback ready machine for workflow "${standardizedName}": ${readyMachine.name} (${readyMachine.id})`);
    return readyMachine.id;
  }
  
  logger.debug(`No suitable machine found for workflow "${standardizedName}"`);
  return null;
}

module.exports = {
  standardizeWorkflowName,
  parseWorkflowStructure,
  extractNotes,
  parseNoteDirectives, // added export
  getMachineForWorkflow
}; 