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
      type: 'string',
      required: true,
      description: 'Operation to perform',
      enum: ['concat', 'replace']
    },
    stringA: {
      name: 'stringA',
      type: 'string',
      required: true,
      description: 'Primary string input.'
    },
    stringB: {
      name: 'stringB',
      type: 'string',
      required: false,
      description: 'Secondary string input or replacement value.'
    },
    searchValue: {
      name: 'searchValue',
      type: 'string',
      required: false,
      description: 'Substring or regex to search for (used in replace).'
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
    rate: 0,
    unit: 'call',
    rateSource: 'static'
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
  }
};

module.exports = stringPrimitiveTool;
