/**
 * ComfyDeploy Configuration
 * 
 * Provides configuration and deployment information for ComfyDeploy
 */

/**
 * Get deployment information by type
 * @param {string} type - Generation type (e.g., 'FLUX', 'MAKE', etc.)
 * @param {Array} workflows - Available workflow definitions
 * @returns {Object} - Deployment information with IDs and input structure
 * @throws {Error} - If deployment information not found
 */
function getDeploymentInfo(type, workflows) {
  if (!workflows || !Array.isArray(workflows)) {
    throw new Error('Workflows array is required');
  }
  
  // Find the workflow matching the given type
  const workflow = workflows.find(flow => flow.name === type);
  
  if (!workflow) {
    throw new Error(`Deployment info not found for type: ${type}`);
  }
  
  return {
    ids: workflow.ids || [],
    inputs: workflow.inputs || {}
  };
}

/**
 * Get base webhook URL for ComfyDeploy callbacks
 * @returns {string} - Webhook URL
 */
function getWebhookUrl() {
  // Primary webhook URL
  const webhookUrl = process.env.COMFY_DEPLOY_WEBHOOK_URL;
  
  // Fallback to constructed URL from host environment variable
  if (!webhookUrl && process.env.HOST) {
    return `http://${process.env.HOST}/api/webhook`;
  }
  
  return webhookUrl;
}

/**
 * Default negative prompt used for all requests
 * @returns {string} - Default negative prompt
 */
function getDefaultNegativePrompt() {
  return process.env.DEFAULT_NEGATIVE_PROMPT || 'embedding:easynegative';
}

/**
 * Get type mappings for common generation types
 * Maps type identifiers to ComfyDeploy-specific settings
 * @returns {Object} - Type mappings
 */
function getTypeMappings() {
  return {
    // Text-to-image base types
    MAKE: {
      checkpoint: 'zavychromaxl_v60',
      sampler: 'DPM++ 2M Karras',
      steps: 30,
      cfg: 7
    },
    FLUX: {
      checkpoint: 'zavychromaxl_v60',
      sampler: 'DPM++ 2M Karras',
      steps: 30,
      cfg: 7
    },
    MS3: {
      // MS3-specific settings
      checkpoint: 'ms3_v30',
      sampler: 'DPM++ SDE Karras',
      steps: 25,
      cfg: 6
    },
    
    // Image-to-image types
    I2I: {
      checkpoint: 'zavychromaxl_v60',
      sampler: 'DPM++ 2M Karras',
      strength: 0.75,
      steps: 30,
      cfg: 7
    },
    INPAINT: {
      checkpoint: 'zavychromaxl_v60',
      sampler: 'DPM++ 2M Karras',
      strength: 1.0,
      steps: 30,
      cfg: 7
    },
    
    // Media processing types
    RMBG: {
      model: 'rmbg-1.4',
      // No additional settings needed
    },
    UPSCALE: {
      model: 'RealESRGAN_x4plus',
      scale: 2
    },
    INTERROGATE: {
      model: 'deepdanbooru',
      threshold: 0.5
    },
    
    // Video/animation generation
    ANIMATE: {
      checkpoint: 'sd_xl_turbo_1.0_fp16.safetensors',
      sampler: 'Euler a',
      steps: 15,
      frames: 16,
      fps: 8,
      motion_scale: 1.0
    },
    VIDEO: {
      checkpoint: 'sd_xl_turbo_1.0_fp16.safetensors',
      sampler: 'Euler a',
      steps: 15,
      frames: 24,
      fps: 8
    },
    
    // Style modifiers
    STYLE: {
      // Style-specific settings
      lora_weights: { 'lora:styleJojo_v10': 0.8 }
    },
    POSE: {
      // Pose-specific settings
      controlnet: true,
      controlnet_strength: 0.8
    }
  };
}

/**
 * Get default settings for media operations
 * @param {string} operationType - Type of media operation
 * @returns {Object} - Default settings for the operation
 */
function getMediaOperationDefaults(operationType) {
  const defaults = {
    'image-to-image': {
      strength: 0.75,
      width: 1024,
      height: 1024,
      steps: 30,
      cfg: 7,
      seed: -1
    },
    'background-removal': {
      format: 'png',
      alpha_matting: true,
      alpha_matting_foreground_threshold: 240,
      alpha_matting_background_threshold: 10
    },
    'upscale': {
      scale: 2,
      face_enhance: true
    },
    'interrogate': {
      threshold: 0.5,
      caption: true
    },
    'animate': {
      frames: 16,
      fps: 8,
      motion_scale: 1.0,
      loop: true
    },
    'video': {
      frames: 24,
      fps: 8,
      width: 512,
      height: 512
    }
  };
  
  return defaults[operationType] || {};
}

/**
 * Get cost for a specific operation type
 * @param {string} operationType - Type of operation
 * @returns {number} - Cost in points
 */
function getOperationCost(operationType) {
  const costs = {
    // Text-to-image
    'MAKE': 100,
    'FLUX': 100,
    'MS3': 500,
    
    // Image-to-image
    'I2I': 125,
    'INPAINT': 150,
    
    // Media processing
    'background-removal': 50,
    'upscale': 75,
    'interrogate': 25,
    
    // Video/animation
    'animate': 350,
    'video': 500
  };
  
  return costs[operationType] || 100; // Default cost
}

module.exports = {
  getDeploymentInfo,
  getWebhookUrl,
  getDefaultNegativePrompt,
  getTypeMappings,
  getMediaOperationDefaults,
  getOperationCost
}; 