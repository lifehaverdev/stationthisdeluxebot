/**
 * VastMake GPU Tool Definition
 * User-facing tool for executing AI workflows on VastAI GPU infrastructure.
 *
 * @type {import('../ToolDefinition').ToolDefinition}
 */
const vastmakeTool = {
  toolId: 'vastmake',
  service: 'vastai',
  version: '1.0.0',
  displayName: 'VastMake GPU',
  commandName: '/vastmake',
  apiPath: '/api/internal/run/vastmake',
  description: 'Execute AI workflows on GPU. Supports ComfyUI workflows, LoRA inference, image generation, and custom scripts.',

  inputSchema: {
    workflow: {
      name: 'Workflow',
      type: 'string',
      required: true,
      description: 'The workflow to execute (e.g., flux-gen, flux-dev-gen, sdxl-gen, sd15-gen, custom).'
    },
    prompt: {
      name: 'Prompt',
      type: 'string',
      required: false,
      description: 'Text prompt for image generation.'
    },
    imageUrl: {
      name: 'Input Image',
      type: 'image',
      required: false,
      description: 'URL of input image for img2img or other image-based workflows.'
    },
    loraId: {
      name: 'LoRA Model',
      type: 'string',
      required: false,
      description: 'ID of the LoRA model to apply during generation.'
    },
    loraStrength: {
      name: 'LoRA Strength',
      type: 'number',
      required: false,
      default: 0.8,
      advanced: true,
      description: 'Strength of the LoRA effect (0.0 - 1.0).'
    },
    baseModel: {
      name: 'Base Model',
      type: 'enum',
      required: false,
      default: 'flux-schnell',
      enum: ['flux-schnell', 'flux-dev', 'sdxl', 'sd15'],
      description: 'Base model to use for generation.'
    },
    width: {
      name: 'Width',
      type: 'number',
      required: false,
      default: 1024,
      advanced: true,
      description: 'Output image width in pixels.'
    },
    height: {
      name: 'Height',
      type: 'number',
      required: false,
      default: 1024,
      advanced: true,
      description: 'Output image height in pixels.'
    },
    steps: {
      name: 'Steps',
      type: 'number',
      required: false,
      default: 4,
      advanced: true,
      description: 'Number of inference steps.'
    },
    seed: {
      name: 'Seed',
      type: 'seed',
      required: false,
      advanced: true,
      description: 'Random seed for reproducible generation.'
    },
    negativePrompt: {
      name: 'Negative Prompt',
      type: 'string',
      required: false,
      advanced: true,
      description: 'Negative prompt to exclude unwanted elements.'
    },
    customScript: {
      name: 'Custom Script',
      type: 'text',
      required: false,
      advanced: true,
      visibleIf: { field: 'workflow', values: ['custom'] },
      description: 'Custom script to execute (only for custom workflow).'
    },
    privateMode: {
      name: 'Private Mode',
      type: 'boolean',
      required: false,
      default: false,
      advanced: true,
      description: 'Enable private mode to prevent result caching and logging.'
    }
  },

  outputSchema: {
    imageUrl: {
      name: 'Result Image',
      type: 'string',
      description: 'URL of generated image.'
    },
    videoUrl: {
      name: 'Result Video',
      type: 'string',
      description: 'URL of generated video.'
    },
    metadata: {
      name: 'Metadata',
      type: 'object',
      description: 'Generation metadata including timing, model info, and parameters used.'
    }
  },

  costingModel: {
    rateSource: 'machine',  // Rate determined from VastAI instance at runtime
    unit: 'second'
  },

  deliveryMode: 'async',

  webhookStrategy: {
    expectedStatusField: 'status',
    successValue: 'COMPLETED',
    durationTracking: true,
    resultPath: ['outputs']
  },

  platformHints: {
    primaryInput: 'text',
    supportsFileCaption: true,
    supportsReplyWithCommand: true
  },

  category: 'text-to-image',
  visibility: 'public',

  humanDefaults: {
    workflow: 'flux-gen',
    baseModel: 'flux-schnell',
    steps: 4
  },

  metadata: {
    provider: 'VastAI',
    instanceTypes: ['comfy-worker', 'custom-runner'],
    warmPoolEnabled: true,
    modelAffinityScheduling: true,
    workflowModels: {
      'flux-gen': 'flux-schnell',
      'flux-dev-gen': 'flux-dev',
      'sdxl-gen': 'sdxl',
      'sd15-gen': 'sd15'
    }
  }
};

module.exports = vastmakeTool;
