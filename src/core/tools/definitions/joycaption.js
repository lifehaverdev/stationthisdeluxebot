const joycaptionTool = {
  toolId: 'joycaption',
  service: 'huggingface',
  displayName: 'JoyCaption',
  commandName: '/joycaption',
  apiPath: '/huggingface/interrogate',
  description: 'Caption any image using JoyCaption Beta One on HuggingFace – supports descriptive prose, MidJourney/Stability prompts, booru tag lists, art critique copy, product blurbs, and more.',
  inputSchema: {
    imageUrl: {
      name: 'imageUrl',
      type: 'image',
      required: true,
      description: 'URL of the image to interrogate.'
    },
    captionType: {
      name: 'captionType',
      type: 'string',
      required: false,
      default: 'Descriptive',
      description: 'Caption Type (Descriptive, Descriptive (Casual), Straightforward, Stable Diffusion Prompt, MidJourney, Danbooru/E621/Rule34/Booru tag lists, Art Critic, Product Listing, Social Media Post).'
    },
    captionLength: {
      name: 'captionLength',
      type: 'string',
      required: false,
      default: 'long',
      description: 'Caption length (any, very short, short, medium-length, long, very long, or a token count such as 80/120/etc).'
    },
    extraOptions: {
      name: 'extraOptions',
      type: 'string',
      required: false,
      advanced: true,
      description: 'Optional extra directives (comma/newline separated). Use the exact toggles from the JoyCaption UI (e.g., "Include information about lighting.", "Do NOT include anything sexual; keep it PG.").'
    },
    personName: {
      name: 'personName',
      type: 'string',
      required: false,
      advanced: true,
      description: 'If you enable the "{name}" extra option, provide the name to substitute.'
    },
    temperature: {
      name: 'temperature',
      type: 'number',
      required: false,
      default: 0.6,
      advanced: true,
      description: 'Generation temperature (0.0 – 2.0). Higher = more variety.'
    },
    topP: {
      name: 'topP',
      type: 'number',
      required: false,
      default: 0.9,
      advanced: true,
      description: 'Top-p / nucleus sampling cutoff (0.0 – 1.0). Lower = safer.'
    },
    maxNewTokens: {
      name: 'maxNewTokens',
      type: 'number',
      required: false,
      default: 512,
      advanced: true,
      description: 'Maximum new tokens to generate (1 – 2048).'
    },
    logPrompt: {
      name: 'logPrompt',
      type: 'boolean',
      required: false,
      default: false,
      advanced: true,
      description: 'Enable if you consent to letting JoyCaption log your prompt text to help improve the model.'
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
    model: 'joy-caption-beta-one',
    // This tool produces plain text descriptions, so mark as text for UI anchor compatibility
    outputType: 'text',
    inputType: 'image'
  }
};

module.exports = joycaptionTool;
