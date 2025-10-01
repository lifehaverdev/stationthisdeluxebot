const joytagTool = {
  toolId: 'joytag',
  service: 'huggingface',
  displayName: 'JoyTag',
  commandName: '/joytag',
  apiPath: '/huggingface/interrogate',
  description: 'Interrogate images to generate detailed text descriptions using AI vision models.',
  inputSchema: {
    imageUrl: {
      name: 'imageUrl',
      type: 'image',
      required: true,
      description: 'URL of the image to interrogate.'
    }
  },
  outputSchema: {
    description: {
      name: 'description',
      type: 'string',
      description: 'The generated text description of the image.'
    }
  },
  costingModel: {
    rateSource: 'static',
    staticCost: {
      amount: 0.0337, // 100 points (rate-limited free API)
      unit: 'request'
    }
  },
  deliveryMode: 'immediate',
  webhookStrategy: {
    expectedStatusField: 'status',
    successValue: 'completed',
    durationTracking: false,
    resultPath: ['description']
  },
  platformHints: {
    primaryInput: 'image',
    supportsFileCaption: false,
    supportsReplyWithCommand: false
  },
  category: 'interrogate',
  visibility: 'public',
  humanDefaults: {},
  metadata: {
    provider: 'HuggingFace',
    model: 'joy-caption-pre-alpha'
  }
};

module.exports = joytagTool;

