/**
 * @type {import('../ToolDefinition').ToolDefinition}
 */
const chatGptTool = {
  toolId: 'chatgpt-free',
  service: 'openai',
  displayName: 'ChatGPT',
  commandName: '/chat',
  apiPath: '/llm/chat',
  description: 'A general-purpose conversational AI. Use it to ask questions, get explanations, or generate text.',
  inputSchema: {
    prompt: {
      name: 'prompt',
      type: 'string',
      required: true,
      description: 'The text prompt to send to the AI.'
    },
    instructions: {
      name: 'instructions',
      type: 'string',
      required: true,
      description: 'System or user instructions that guide the assistant.',
      default:
        'You are a helpful SDXL prompt engineer assistant. Create comma-separated word lists that work well with SDXL. Focus on descriptive terms, artistic styles, and atmospheric elements.'
    },
    temperature: {
      name: 'temperature',
      type: 'number',
      required: false,
      default: 0.7,
      description: 'Controls randomness. Lower is more deterministic.'
    }
  },
  outputSchema: {
      response: {
          name: 'response',
          type: 'string',
          description: 'The text response from the AI.'
      }
  },
  costingModel: {
    rateSource: 'static',
    staticCost: {
      amount: 0.000002, // Example cost per token
      unit: 'token'
    }
  },
  deliveryMode: 'immediate',
  webhookStrategy: {
      expectedStatusField: 'status',
      successValue: 'completed',
      durationTracking: false, // Not time-based
      resultPath: ['choices[0].message.content']
  },
  platformHints: {
    primaryInput: 'text',
    supportsFileCaption: false,
    supportsReplyWithCommand: false
  },
  category: 'text-to-text', // This is not right, but it's one of the validated ones.
  visibility: 'public',
  humanDefaults: {},
  metadata: {
    provider: 'OpenAI',
    model: 'gpt-3.5-turbo'
  }
};

module.exports = chatGptTool; 