const dalleImageTool = {
  toolId: 'dall-e-3-image',
  service: 'openai',
  displayName: 'dalleiii',
  commandName: '/image',
  apiPath: '/llm/image',
  description: 'Generate images from text prompts using OpenAI\'s DALL·E 3 model.',
  inputSchema: {
    prompt: {
      name: 'prompt',
      type: 'string',
      required: true,
      description: 'The text prompt describing the desired image.'
    },
    model: {
      name: 'model',
      type: 'enum',
      required: false,
      default: 'dall-e-3',
      enum: ['gpt-image-1', 'dall-e-3', 'dall-e-2'],
      description: 'Image generation model to use.'
    },
    quality: {
      name: 'quality',
      type: 'enum',
      required: false,
      default: 'standard',
      enum: ['low', 'medium', 'high', 'standard', 'hd'],
      description: 'Desired quality tier (varies by model).'
    },
    size: {
      name: 'size',
      type: 'enum',
      required: false,
      default: '1024x1024',
      enum: ['256x256', '512x512', '1024x1024', '1024x1536', '1536x1024', '1024x1792', '1792x1024'],
      description: 'Resolution of the output image.'
    },
    responseFormat: {
      name: 'responseFormat',
      type: 'string',
      required: false,
      default: 'url',
      description: 'Format of the image returned ("url" or "b64_json").'
    }
  },
  outputSchema: {
    image: {
      name: 'image',
      type: 'string',
      description: 'The URL or base64 string of the generated image.'
    }
  },
  costingModel: {
    rateSource: 'static',
    // base cost will be looked up from metadata.costTable
    staticCost: {
      amount: 0,
      unit: 'run'
    }
  },
  deliveryMode: 'async',
  webhookStrategy: {
    expectedStatusField: 'status',
    successValue: 'completed',
    durationTracking: false,
    resultPath: ['data[0].url']
  },
  platformHints: {
    primaryInput: 'text',
    supportsFileCaption: false,
    supportsReplyWithCommand: false
  },
  category: 'text-to-image',
  visibility: 'public',
  humanDefaults: {},
  metadata: {
    provider: 'OpenAI',
    model: 'dall-e-3',
    defaultAdapterParams: { action: 'image' },
    // Detailed cost table based on OpenAI pricing docs (USD)
    costTable: {
      'gpt-image-1': {
        '1024x1024': { low: 0.011, medium: 0.042, high: 0.167 },
        '1024x1536': { low: 0.016, medium: 0.063, high: 0.25 },
        '1536x1024': { low: 0.016, medium: 0.063, high: 0.25 }
      },
      'dall-e-3': {
        '1024x1024': { standard: 0.04, hd: 0.08 },
        '1024x1792': { standard: 0.08, hd: 0.12 },
        '1792x1024': { standard: 0.08, hd: 0.12 }
      },
      'dall-e-2': {
        '256x256': { standard: 0.016 },
        '512x512': { standard: 0.018 },
        '1024x1024': { standard: 0.02 }
      }
    }
  }
};

module.exports = dalleImageTool;
