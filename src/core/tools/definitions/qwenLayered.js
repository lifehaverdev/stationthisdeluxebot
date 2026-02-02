const qwenLayeredTool = {
  toolId: 'qwen-layered',
  service: 'huggingface',
  version: '1.0.0',
  displayName: 'Qwen Image Layered',
  commandName: '/qwenlayered',
  apiPath: '/huggingface/qwen-layered',
  description: 'Decompose an image into multiple transparent layers using Qwen Image Layered on HuggingFace. Returns layer images, a PPTX, and a ZIP archive.',
  inputSchema: {
    imageUrl: {
      name: 'imageUrl',
      type: 'image',
      required: true,
      description: 'URL of the image to decompose into layers.'
    },
    prompt: {
      name: 'prompt',
      type: 'string',
      required: false,
      default: '',
      description: 'Optional prompt to guide layer decomposition.'
    },
    negativePrompt: {
      name: 'negativePrompt',
      type: 'string',
      required: false,
      default: '',
      advanced: true,
      description: 'Negative prompt for things to avoid.'
    },
    layers: {
      name: 'layers',
      type: 'number',
      required: false,
      default: 4,
      description: 'Number of layers to decompose into.'
    },
    guidanceScale: {
      name: 'guidanceScale',
      type: 'number',
      required: false,
      default: 4,
      advanced: true,
      description: 'Guidance scale for generation (higher = stronger adherence to prompt).'
    },
    inferenceSteps: {
      name: 'inferenceSteps',
      type: 'number',
      required: false,
      default: 50,
      advanced: true,
      description: 'Number of inference steps.'
    },
    seed: {
      name: 'seed',
      type: 'number',
      required: false,
      default: 0,
      advanced: true,
      description: 'Random seed for reproducibility.'
    },
    randomizeSeed: {
      name: 'randomizeSeed',
      type: 'boolean',
      required: false,
      default: true,
      advanced: true,
      description: 'Randomize the seed on each generation.'
    },
    enableCfgNorm: {
      name: 'enableCfgNorm',
      type: 'boolean',
      required: false,
      default: true,
      advanced: true,
      description: 'Enable CFG normalization.'
    },
    autoCaptionEnglish: {
      name: 'autoCaptionEnglish',
      type: 'boolean',
      required: false,
      default: true,
      advanced: true,
      description: 'Automatically caption in English.'
    }
  },
  outputSchema: {
    files: {
      name: 'files',
      type: 'string',
      description: 'Array of file URLs (layer images, PPTX, ZIP).'
    }
  },
  costingModel: {
    rateSource: 'static',
    staticCost: {
      amount: 0.035, // ~80s GPU × $0.000444/s (HF ZeroGPU with 2× platform markup)
      unit: 'request'
    }
  },
  deliveryMode: 'async',
  webhookStrategy: {
    expectedStatusField: 'status',
    successValue: 'completed',
    durationTracking: false,
    resultPath: ['files']
  },
  platformHints: {
    primaryInput: 'image',
    supportsFileCaption: false,
    supportsReplyWithCommand: false
  },
  deliveryHints: {
    telegram: { 'send-as': 'document', filename: 'layer.png' }
  },
  category: 'image-to-image',
  visibility: 'public',
  humanDefaults: {},
  metadata: {
    provider: 'HuggingFace',
    model: 'qwen-image-layered',
    outputType: 'file',
    inputType: 'image',
    estimatedGpuSeconds: 80,
    defaultAdapterParams: {
      toolId: 'qwen-layered',
      spaceUrl: 'https://qwen-qwen-image-layered.hf.space'
    }
  }
};

module.exports = qwenLayeredTool;
