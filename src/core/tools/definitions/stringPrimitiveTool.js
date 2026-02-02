const stringPrimitiveTool = {
  toolId: 'string-primitive',
  service: 'string',
  version: '2.0.0',
  displayName: 'String Primitive',
  commandName: '/string',
  apiPath: '/string/primitive',
  description: 'Perform basic string operations like concat and replace.',

  // Migration definitions for upgrading spells from older tool versions
  migrations: {
    '1.0.0': {
      parameters: {
        'stringA': 'inputText',
        'stringB': {
          default: 'appendText',
          when: { field: 'operation', value: 'replace', use: 'replacementText' }
        },
        'searchValue': 'searchText'
      }
    }
  },

  inputSchema: {
    operation: {
      name: 'Operation',
      type: 'enum',
      required: true,
      description: 'Operation to perform',
      enum: ['concat', 'replace'],
      order: 0
    },
    // Shared input field
    inputText: {
      name: 'Input Text',
      type: 'string',
      required: true,
      description: 'The main text input.',
      order: 1
    },
    // Concat-specific
    appendText: {
      name: 'Append Text',
      type: 'string',
      required: true,
      description: 'Text to append after the input text.',
      visibleIf: { field: 'operation', values: ['concat'] },
      order: 2
    },
    // Replace-specific
    searchText: {
      name: 'Search For',
      type: 'string',
      required: true,
      description: 'The text to search for (will be replaced).',
      visibleIf: { field: 'operation', values: ['replace'] },
      order: 2
    },
    replacementText: {
      name: 'Replace With',
      type: 'string',
      required: true,
      description: 'Text to replace matches with (leave empty to delete).',
      visibleIf: { field: 'operation', values: ['replace'] },
      order: 3
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
