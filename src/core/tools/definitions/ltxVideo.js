const ltxVideoTool = {
  toolId: 'ltx-video',
  service: 'huggingface',
  displayName: 'LTX Video',
  commandName: '/ltxvideo',
  apiPath: '/huggingface/ltx-video',
  description: 'Generate short videos from text prompts or image+text using LTX-2-Distilled on HuggingFace. Supports text-to-video and image-to-video modes.',
  inputSchema: {
    prompt: {
      name: 'prompt',
      type: 'string',
      required: true,
      description: 'Text prompt describing the video to generate.'
    },
    imageUrl: {
      name: 'imageUrl',
      type: 'image',
      required: true,
      description: 'Reference image for image-to-video generation.'
    },
    duration: {
      name: 'duration',
      type: 'number',
      required: false,
      default: 2,
      description: 'Video duration in seconds.'
    },
    height: {
      name: 'height',
      type: 'number',
      required: false,
      default: 512,
      advanced: true,
      description: 'Video height in pixels.'
    },
    width: {
      name: 'width',
      type: 'number',
      required: false,
      default: 768,
      advanced: true,
      description: 'Video width in pixels.'
    },
    enhancePrompt: {
      name: 'enhancePrompt',
      type: 'boolean',
      required: false,
      default: true,
      advanced: true,
      description: 'Let the model enhance/rewrite the prompt for better results.'
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
    }
  },
  outputSchema: {
    video: {
      name: 'video',
      type: 'string',
      description: 'URL of the generated video file.'
    }
  },
  costingModel: {
    rateSource: 'static',
    staticCost: {
      amount: 0.024, // ~55s GPU × $0.000444/s (HF ZeroGPU with 2× platform markup)
      unit: 'request'
    }
  },
  deliveryMode: 'async',
  webhookStrategy: {
    expectedStatusField: 'status',
    successValue: 'completed',
    durationTracking: false,
    resultPath: ['videoUrl']
  },
  platformHints: {
    primaryInput: 'text',
    supportsFileCaption: false,
    supportsReplyWithCommand: false
  },
  category: 'video',
  visibility: 'public',
  humanDefaults: {},
  metadata: {
    provider: 'HuggingFace',
    model: 'ltx-2-distilled',
    outputType: 'video',
    inputType: 'text',
    estimatedGpuSeconds: 55,
    defaultAdapterParams: {
      toolId: 'ltx-video',
      spaceUrl: 'https://lightricks-ltx-2-distilled.hf.space'
    }
  }
};

module.exports = ltxVideoTool;
