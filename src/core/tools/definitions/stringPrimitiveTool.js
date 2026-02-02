const stringPrimitiveTool = {
  toolId: 'string-primitive',
  service: 'string',
  displayName: 'String Primitive',
  commandName: '/string',
  apiPath: '/string/primitive',
  description: 'Perform basic string operations like concat and replace.',
  inputSchema: {
    operation: {
      name: 'operation',
      type: 'enum',
      required: true,
      description: 'Operation to perform',
      enum: ['concat', 'replace']
    },
    // Shared input field
    inputText: {
      name: 'inputText',
      type: 'string',
      required: true,
      description: 'The main text input.'
    },
    // Concat-specific
    appendText: {
      name: 'appendText',
      type: 'string',
      required: true,
      description: 'Text to append after the input text.',
      visibleIf: { field: 'operation', values: ['concat'] }
    },
    // Replace-specific
    searchText: {
      name: 'searchText',
      type: 'string',
      required: true,
      description: 'The text to search for (will be replaced).',
      visibleIf: { field: 'operation', values: ['replace'] }
    },
    replacementText: {
      name: 'replacementText',
      type: 'string',
      required: true,
      description: 'Text to replace matches with (leave empty to delete).',
      visibleIf: { field: 'operation', values: ['replace'] }
    }
  },
  outputSchema: {
    result: {
      name: 'result',
      type: 'string',
      description: 'The resulting string after operation.'
    }
  },
  costingModel: {
    rateSource: 'static',
    staticCost: {
      amount: 0,
      unit: 'token'
    }
  },
  deliveryMode: 'immediate',
  webhookStrategy: {
    expectedStatusField: 'status',
    successValue: 'completed',
    durationTracking: false,
    resultPath: ['result']
  },
  platformHints: {
    primaryInput: 'text',
    supportsFileCaption: false,
    supportsReplyWithCommand: false
  },
  category: 'text-to-text',
  visibility: 'public',
  humanDefaults: {},
  metadata: {
    provider: 'Local',
    model: 'string-primitive'
    , hideFromLanding: true
  }
};

module.exports = stringPrimitiveTool;
