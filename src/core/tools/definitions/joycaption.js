const joycaptionTool = {
  toolId: 'joycaption',
  service: 'huggingface',
  displayName: 'JoyCaption',
  commandName: '/joycaption',
  apiPath: '/huggingface/interrogate',
  description: 'Interrogate images to generate detailed text descriptions using AI vision models (powered by HuggingFace Joy Caption – https://huggingface.co/spaces/fancyfeast/joy-caption-pre-alpha).',
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
      amount: 0.0019, // 100 points ~ $0.0337 before, now ~0.0019 USD per request
      unit: 'request'
    }
  },
  deliveryMode: 'async',
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
  category: 'image-to-text',
  visibility: 'public',
  humanDefaults: {},
  metadata: {
    provider: 'HuggingFace',
    model: 'joy-caption-pre-alpha',
    // This tool produces plain text descriptions, so mark as text for UI anchor compatibility
    outputType: 'text',
    inputType: 'image'
  }
};

module.exports = joycaptionTool;
