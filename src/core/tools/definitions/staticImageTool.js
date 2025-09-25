/**
 * @type {import('../ToolDefinition').ToolDefinition}
 */
const staticImageTool = {
  toolId: 'static-image',
  service: 'static',
  displayName: 'Static Image',
  commandName: '/staticimage',
  apiPath: '/static/image',
  description: 'Displays a static test image for UI testing.',
  inputSchema: {},
  outputSchema: {
    imageUrl: {
      name: 'imageUrl',
      type: 'string',
      description: 'URL of the static test image.'
    }
  },
  costingModel: {
    rateSource: 'static',
    staticCost: {
      amount: 0,
      unit: 'request'
    }
  },
  deliveryMode: 'immediate',
  webhookStrategy: {
    expectedStatusField: 'status',
    successValue: 'completed',
    durationTracking: false,
    resultPath: ['imageUrl']
  },
  platformHints: {
    primaryInput: 'image',
    supportsFileCaption: false,
    supportsReplyWithCommand: false
  },
  category: 'image-to-image',
  visibility: 'public',
  humanDefaults: {},
  metadata: {
    provider: 'Local',
    model: 'static-image'
    , hideFromLanding: true
  }
};

module.exports = staticImageTool; 