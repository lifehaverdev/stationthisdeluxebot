# Make Workflow Migration Plan

## Overview
This document outlines the detailed plan for enhancing the existing makeWorkflow to support all image generation types and user interactions currently handled by the legacy code in `commands/make.js` and `utils/bot/handlers/iMake.js`.

## Current State

The `src/core/workflow/workflows/makeWorkflow.js` is partially implemented with a basic workflow structure, but lacks:
1. Support for all generation types with specialized options
2. Handling of image inputs for styles, control networks, etc.
3. Integration with points/balance system
4. Robust validation and error handling for each step

## Implementation Tasks

### 1. Core Workflow Structure Enhancement

#### 1.1 Create Base Workflow Factory
- Refactor current makeWorkflow into a factory pattern
- Support for creating workflows with different configurations
- Common state management and error handling

```javascript
// Enhancement to makeWorkflow.js
function createBaseMakeWorkflow(options = {}) {
  // Extract options with defaults
  const {
    pointsService,
    comfyDeployService,
    settingsManager,
    defaultType = 'MAKE',
    inputRequirements = {},
    steps = {}
  } = options;
  
  // Create the workflow definition
  return {
    id: `make-${defaultType.toLowerCase()}`,
    name: `${defaultType} Image Generation`,
    description: `Generate images using ${defaultType}`,
    
    // Initialize workflow state
    initialize: (context) => {
      return {
        ...context,
        type: defaultType,
        status: 'initialized',
        startedAt: Date.now(),
        inputRequirements
      };
    },
    
    // Define the workflow steps
    steps: {
      // Common entry point
      start: {
        id: 'start',
        description: 'Initialize generation workflow',
        process: processStartStep,
        nextStep: 'prompt'
      },
      
      // Prompt entry step
      prompt: {
        id: 'prompt',
        description: 'Enter your prompt',
        validate: validatePromptStep,
        process: processPromptStep,
        nextStep: determineNextStep,
        ...steps.prompt
      },
      
      // Settings configuration step
      settings: {
        id: 'settings',
        description: 'Configure generation settings',
        validate: validateSettingsStep,
        process: processSettingsStep,
        nextStep: 'confirm',
        ...steps.settings
      },
      
      // Confirmation step
      confirm: {
        id: 'confirm',
        description: 'Confirm and start generation',
        validate: validateConfirmStep,
        process: processConfirmStep,
        nextStep: 'generate',
        ...steps.confirm
      },
      
      // Generation step
      generate: {
        id: 'generate',
        description: 'Generate the image',
        validate: validateGenerateStep,
        process: processGenerateStep,
        nextStep: 'complete',
        ...steps.generate
      },
      
      // Completion step
      complete: {
        id: 'complete',
        description: 'Generation complete',
        process: processCompleteStep,
        nextStep: null,
        ...steps.complete
      },
      
      // Additional common steps
      ...steps
    }
  };
}
```

#### 1.2 Step Processing Functions
- Create reusable step processors
- Support for different generation types
- Handle state transitions

```javascript
// Step processor functions
async function processStartStep(input, state) {
  // Initialize generation context
  return {
    ...state,
    status: 'started',
    generationType: state.type,
    startedAt: Date.now()
  };
}

async function validatePromptStep(input, state) {
  // Validate prompt based on generation type
  if (!input || typeof input !== 'string' || input.trim().length < 3) {
    throw new Error('Please enter a more detailed prompt (at least 3 characters)');
  }
  
  // Additional type-specific validation
  if (state.type === 'MAKE_PLUS' && input.length > 1000) {
    throw new Error('Prompt is too long, please keep it under 1000 characters for MAKE_PLUS');
  }
  
  return true;
}

async function processPromptStep(input, state) {
  // Store prompt in context
  return {
    ...state,
    prompt: input.trim(),
    status: 'prompt_received'
  };
}

function determineNextStep(state) {
  // Determine the next step based on generation type
  if (state.type.includes('I2I') && !state.inputImage) {
    return 'image_input';
  }
  
  if (state.type.includes('STYLE') && !state.styleImage) {
    return 'style_input';
  }
  
  if (state.type.includes('POSE') && !state.poseImage) {
    return 'pose_input';
  }
  
  // Default path
  return 'settings';
}

// Additional step processors...
```

### 2. Specialized Workflow Variants

#### 2.1 MAKE_STYLE Workflow
- Create a specialized workflow for style transfer
- Add steps for style image upload or selection
- Implement proper UI components

```javascript
// MAKE_STYLE workflow creation
function createMakeStyleWorkflow(options = {}) {
  const baseOptions = {
    ...options,
    defaultType: 'MAKE_STYLE',
    inputRequirements: {
      requiresStyleImage: true
    },
    steps: {
      // Add specialized style image step
      style_input: {
        id: 'style_input',
        description: 'Upload or select a style image',
        validate: validateStyleImageStep,
        process: processStyleImageStep,
        nextStep: 'settings',
        ui: {
          type: 'image_input',
          title: 'Style Image',
          message: 'Please upload or select a style image',
          acceptsImageUpload: true,
          allowsImageGallery: true
        }
      }
    }
  };
  
  return createBaseMakeWorkflow(baseOptions);
}

// Style image validation
async function validateStyleImageStep(input, state) {
  if (!input || !input.image) {
    throw new Error('Style image is required');
  }
  
  return true;
}

// Style image processing
async function processStyleImageStep(input, state) {
  return {
    ...state,
    styleImage: input.image,
    styleImageId: input.imageId,
    status: 'style_received'
  };
}
```

#### 2.2 I2I (Image to Image) Workflow
- Create specialized workflow for image-to-image generation
- Add steps for input image upload
- Support for masking and inpainting

```javascript
// I2I workflow creation
function createI2IWorkflow(options = {}) {
  const baseOptions = {
    ...options,
    defaultType: 'I2I',
    inputRequirements: {
      requiresInputImage: true
    },
    steps: {
      // Add specialized image input step
      image_input: {
        id: 'image_input',
        description: 'Upload or select an input image',
        validate: validateInputImageStep,
        process: processInputImageStep,
        nextStep: 'prompt',
        ui: {
          type: 'image_input',
          title: 'Input Image',
          message: 'Please upload or select an image to transform',
          acceptsImageUpload: true,
          allowsImageGallery: true,
          showRecentGenerations: true
        }
      },
      
      // Override prompt step to make it optional
      prompt: {
        id: 'prompt',
        description: 'Enter your prompt (optional for I2I)',
        validate: (input, state) => true, // Always valid, even empty
        process: processPromptStep,
        nextStep: 'settings'
      }
    }
  };
  
  return createBaseMakeWorkflow(baseOptions);
}

// Image input validation
async function validateInputImageStep(input, state) {
  if (!input || !input.image) {
    throw new Error('Input image is required');
  }
  
  return true;
}

// Image input processing
async function processInputImageStep(input, state) {
  return {
    ...state,
    inputImage: input.image,
    inputImageId: input.imageId,
    status: 'image_received'
  };
}
```

#### 2.3 INPAINT Workflow
- Create specialized workflow for inpainting
- Add steps for mask creation
- Support for brush tools and mask upload

```javascript
// INPAINT workflow creation
function createInpaintWorkflow(options = {}) {
  const baseOptions = {
    ...options,
    defaultType: 'INPAINT',
    inputRequirements: {
      requiresInputImage: true,
      requiresMask: true
    },
    steps: {
      // Add specialized image input step
      image_input: {
        id: 'image_input',
        description: 'Upload or select an input image',
        validate: validateInputImageStep,
        process: processInputImageStep,
        nextStep: 'mask_input'
      },
      
      // Add mask input step
      mask_input: {
        id: 'mask_input',
        description: 'Create or upload a mask',
        validate: validateMaskStep,
        process: processMaskStep,
        nextStep: 'prompt',
        ui: {
          type: 'mask_editor',
          title: 'Create Mask',
          message: 'Draw on the areas you want to modify',
          tools: ['brush', 'eraser', 'clear'],
          acceptsMaskUpload: true
        }
      }
    }
  };
  
  return createBaseMakeWorkflow(baseOptions);
}

// Mask validation
async function validateMaskStep(input, state) {
  if (!input || !input.mask) {
    throw new Error('Mask is required');
  }
  
  return true;
}

// Mask processing
async function processMaskStep(input, state) {
  return {
    ...state,
    mask: input.mask,
    maskId: input.maskId,
    status: 'mask_received'
  };
}
```

### 3. Points Integration

#### 3.1 Points Calculation
- Add points calculation logic to settings step
- Support for different pricing tiers
- Handle balance checks and rejections

```javascript
// Enhancement to settings step
async function processSettingsStep(input, state, { pointsService }) {
  // Get user settings with defaults
  const settings = {
    width: 1024,
    height: 1024,
    steps: 30,
    seed: -1,
    ...input
  };
  
  // Calculate points cost based on settings and type
  const cost = await pointsService.calculateGenerationCost({
    type: state.type,
    settings,
    user: {
      id: state.userId,
      balance: state.balance
    }
  });
  
  // Return updated state
  return {
    ...state,
    settings,
    cost,
    status: 'settings_configured'
  };
}

// Enhancement to confirm step
async function validateConfirmStep(input, state, { pointsService }) {
  // Skip if confirmation is explicitly false
  if (input === false) {
    return false;
  }
  
  // Check user's balance
  const hasBalance = await pointsService.checkBalance(state.userId, state.cost);
  
  if (!hasBalance) {
    throw new Error(`Insufficient points for this generation. Required: ${state.cost}`);
  }
  
  return true;
}

async function processConfirmStep(input, state, { pointsService }) {
  // Create a pending transaction to lock points for this generation
  const transaction = await pointsService.createPendingTransaction(
    state.userId,
    state.cost,
    `Generation: ${state.type}`
  );
  
  return {
    ...state,
    transaction,
    confirmed: true,
    status: 'confirmed'
  };
}
```

### 4. Generation and Delivery

#### 4.1 Generate Step
- Implement image generation through ComfyDeployService
- Handle run status tracking
- Support for cancellation

```javascript
// Enhancement to generate step
async function processGenerateStep(input, state, { comfyDeployService }) {
  try {
    // Prepare generation request
    const request = {
      type: state.type,
      prompt: state.prompt,
      settings: state.settings,
      
      // Add conditional elements
      ...(state.inputImage && { inputImage: state.inputImage }),
      ...(state.styleImage && { styleImage: state.styleImage }),
      ...(state.poseImage && { poseImage: state.poseImage }),
      ...(state.mask && { mask: state.mask })
    };
    
    // Start generation
    const result = await comfyDeployService.generate(request, {
      userId: state.userId,
      username: state.username,
      balance: state.balance
    });
    
    // Update state with generation result
    return {
      ...state,
      runId: result.runId,
      generationStarted: true,
      status: 'generating'
    };
  } catch (error) {
    // Handle generation failure
    return {
      ...state,
      error: error.message,
      status: 'generation_failed'
    };
  }
}
```

#### 4.2 Result Delivery
- Create result delivery mechanism
- Support platform-specific delivery
- Handle failed generations and retries

```javascript
// Enhancement to complete step
async function processCompleteStep(input, state, { pointsService, deliveryService }) {
  // Check if we have a valid result
  if (!state.generationResult || !state.generationResult.mediaUrls) {
    // Handle missing result
    await pointsService.refundTransaction(state.transaction.id);
    
    return {
      ...state,
      status: 'delivery_failed',
      error: 'No generation result available'
    };
  }
  
  try {
    // Finalize points transaction
    await pointsService.finalizeTransaction(state.transaction.id);
    
    // Deliver results to user
    const deliveryResult = await deliveryService.deliverMedia({
      userId: state.userId,
      media: state.generationResult.mediaUrls,
      prompt: state.prompt,
      settings: state.settings,
      platform: state.platform
    });
    
    // Update state with delivery result
    return {
      ...state,
      deliveryResult,
      completedAt: Date.now(),
      status: 'completed'
    };
  } catch (error) {
    // Handle delivery failure but keep transaction
    return {
      ...state,
      error: `Delivery failed: ${error.message}`,
      completedAt: Date.now(),
      status: 'delivery_failed'
    };
  }
}
```

### 5. Progress Tracking and Webhooks

#### 5.1 Webhook Event Handler
- Create webhook event handlers for generation progress
- Update workflow state based on generation status
- Handle completion and delivery

```javascript
// Webhook event handler
function setupComfyWebhookHandlers(workflowEngine, comfyDeployService) {
  // Listen for generation progress events
  comfyDeployService.on('generation:progress', async (event) => {
    const { runId, progress, status } = event;
    
    // Find workflow by runId
    const workflow = await workflowEngine.findWorkflowByProperty('runId', runId);
    
    if (workflow) {
      // Update workflow state with progress
      await workflowEngine.updateWorkflowState(workflow.id, {
        progress,
        status: `generating_${status}`,
        lastUpdated: Date.now()
      });
    }
  });
  
  // Listen for generation completion events
  comfyDeployService.on('generation:completed', async (event) => {
    const { runId, mediaUrls } = event;
    
    // Find workflow by runId
    const workflow = await workflowEngine.findWorkflowByProperty('runId', runId);
    
    if (workflow) {
      // Move workflow to completion step with generation result
      await workflowEngine.updateWorkflowState(workflow.id, {
        generationResult: {
          mediaUrls,
          completedAt: Date.now()
        },
        status: 'generation_complete'
      });
      
      // Move to next step (complete)
      await workflowEngine.progressWorkflow(workflow.id);
    }
  });
  
  // Listen for generation failure events
  comfyDeployService.on('generation:failed', async (event) => {
    const { runId, error } = event;
    
    // Find workflow by runId
    const workflow = await workflowEngine.findWorkflowByProperty('runId', runId);
    
    if (workflow) {
      // Update workflow state with error
      await workflowEngine.updateWorkflowState(workflow.id, {
        error,
        status: 'generation_failed',
        lastUpdated: Date.now()
      });
    }
  });
}
```

### 6. User Interface Components

#### 6.1 UI Component Mapping
- Create UI components for each workflow step
- Support for platform-specific rendering
- Implement interactive components for settings

```javascript
// UI component mapping
const workflowUIComponents = {
  // Prompt step UI
  prompt: {
    type: 'form',
    title: 'Generate an Image',
    components: [
      {
        type: 'text_input',
        id: 'prompt',
        label: 'What would you like to generate?',
        placeholder: 'Enter your detailed prompt here...',
        multiline: true,
        required: true
      }
    ],
    actions: [
      {
        id: 'next',
        label: 'Continue',
        action: 'next'
      },
      {
        id: 'cancel',
        label: 'Cancel',
        action: 'cancel'
      }
    ]
  },
  
  // Settings step UI
  settings: {
    type: 'form',
    title: 'Generation Settings',
    components: [
      {
        type: 'text',
        value: 'Prompt: {{prompt}}',
        style: 'heading'
      },
      {
        type: 'number_input',
        id: 'width',
        label: 'Width',
        min: 512,
        max: 2048,
        step: 64,
        defaultValue: 1024
      },
      {
        type: 'number_input',
        id: 'height',
        label: 'Height',
        min: E512,
        max: 2048,
        step: 64,
        defaultValue: 1024
      },
      {
        type: 'number_input',
        id: 'seed',
        label: 'Seed (-1 for random)',
        min: -1,
        max: 9999999999,
        defaultValue: -1
      }
    ],
    actions: [
      {
        id: 'next',
        label: 'Continue',
        action: 'next'
      },
      {
        id: 'back',
        label: 'Back',
        action: 'back'
      },
      {
        id: 'cancel',
        label: 'Cancel',
        action: 'cancel'
      }
    ]
  },
  
  // Additional UI components for specialized steps...
};
```

#### 6.2 Platform-Specific Renderers
- Create adapters for Telegram UI rendering
- Support for Web UI rendering
- Implement progress indicators

```javascript
// Platform-specific UI adapters
const platformUIAdapters = {
  // Telegram UI adapter
  telegram: {
    renderPromptStep: (step, context) => {
      return {
        text: 'What would you like to generate?',
        reply_markup: {
          force_reply: true
        }
      };
    },
    
    renderSettingsStep: (step, context) => {
      return {
        text: `Configure your generation settings:\n\nPrompt: ${context.prompt.substring(0, 50)}${context.prompt.length > 50 ? '...' : ''}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Width: 1024', callback_data: 'width:1024' },
              { text: 'Height: 1024', callback_data: 'height:1024' }
            ],
            [
              { text: 'Random Seed', callback_data: 'seed:-1' }
            ],
            [
              { text: 'Continue', callback_data: 'next' },
              { text: 'Back', callback_data: 'back' },
              { text: 'Cancel', callback_data: 'cancel' }
            ]
          ]
        }
      };
    },
    
    // Additional step renderers...
  },
  
  // Web UI adapter
  web: {
    // Web UI specific renderers...
  }
};
```

### 7. Workflow Factory and Registration

#### 7.1 Workflow Factory
- Create factory for all workflow variants
- Support for configuration and options
- Export factory functions

```javascript
// Workflow factory module
const MakeWorkflowFactory = {
  // Standard MAKE workflow
  createMakeWorkflow: (options) => createBaseMakeWorkflow({
    ...options,
    defaultType: 'MAKE'
  }),
  
  // Style transfer workflow
  createMakeStyleWorkflow,
  
  // Image to image workflow
  createI2IWorkflow,
  
  // Inpainting workflow
  createInpaintWorkflow,
  
  // Additional specialized workflows...
};

module.exports = MakeWorkflowFactory;
```

#### 7.2 Workflow Registration
- Register workflows with the workflow engine
- Map command inputs to workflow types
- Handle workflow instances

```javascript
// Workflow registration
function registerImageGenerationWorkflows(workflowEngine, dependencies) {
  // Register base workflow
  workflowEngine.registerWorkflow(
    'MakeImageWorkflow',
    MakeWorkflowFactory.createMakeWorkflow(dependencies)
  );
  
  // Register style transfer workflow
  workflowEngine.registerWorkflow(
    'MakeStyleWorkflow',
    MakeWorkflowFactory.createMakeStyleWorkflow(dependencies)
  );
  
  // Register I2I workflow
  workflowEngine.registerWorkflow(
    'I2IWorkflow',
    MakeWorkflowFactory.createI2IWorkflow(dependencies)
  );
  
  // Register inpainting workflow
  workflowEngine.registerWorkflow(
    'InpaintWorkflow',
    MakeWorkflowFactory.createInpaintWorkflow(dependencies)
  );
  
  // Register additional workflows...
}
```

## Testing Plan

### 1. Unit Tests

- Test each step processor function
- Test workflow transitions and validation
- Test UI component generation

### 2. Integration Tests

- Test workflow execution with mocked services
- Test event handling and webhook processing
- Test UI rendering across platforms

### 3. User Flow Tests

- Test complete user journeys for each workflow type
- Test error handling and recovery paths
- Test cancellation and restart

## Implementation Timeline

1. **Day 1-2**: Implement core workflow structure
2. **Day 3-4**: Create specialized workflow variants
3. **Day 5-6**: Implement points integration and generation
4. **Day 7-8**: Create UI components and platform renderers
5. **Day 9-10**: Test and debug workflows 