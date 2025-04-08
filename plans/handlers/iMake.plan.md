# iMake.js Refactoring Plan

## Current Implementation Analysis

`iMake.js` is responsible for handling image generation tasks in the bot. It manages the creation of prompts, handling user inputs, managing different generation types, and queueing image generation tasks.

### Current Structure

The current implementation has several issues:

1. **Tightly Coupled with Telegram**: Uses Telegram-specific message objects directly
2. **Global State Dependencies**: Relies on global `lobby` and `workspace` objects
3. **Mutable State Transitions**: Directly modifies state objects
4. **Hardcoded State Handling**: Uses global `STATES` enum
5. **Mixed Concerns**: Business logic mixed with UI rendering
6. **Limited Validation**: Basic input validation without proper error handling

### Key Functions to Refactor

1. **handleMake(message)**: Entry point for quick image generation
2. **handleFlux(message)**: More advanced image generation flow
3. **handleFluxPrompt(message)**: Handles prompt input state
4. **handleInpaintPrompt(message)**: Handles inpainting workflow
5. **handleTask(message, taskType, defaultState, ...)**: Core task processing logic

### Multi-step Flows

The current implementation has several multi-step interactions:

1. **Basic Generation Flow**:
   - Command → Ask for prompt → Process prompt → Queue generation → Show result

2. **Style Transfer Flow**:
   - Set style image → Command → Ask for prompt → Process with style → Show result

3. **Inpainting Flow**:
   - Upload image → Mark area → Add prompt → Process → Show result

## Refactoring Approach

### 1. Define Workflows 

Create workflow definitions for each generation type:

```javascript
// Example workflow for basic image generation
const basicGenerationWorkflow = createLinearWorkflow({
  name: 'BasicImageGeneration',
  steps: [
    {
      id: 'prompt',
      name: 'Prompt Input',
      validate: validatePrompt,
      ui: {
        type: 'text_input',
        message: 'What is the prompt for your creation?'
      }
    },
    {
      id: 'processing',
      name: 'Image Generation',
      process: processImageGeneration,
      ui: {
        type: 'progress',
        message: 'Generating your image...'
      }
    },
    {
      id: 'result',
      name: 'Result Display',
      ui: {
        type: 'image_display',
        message: 'Here is your creation:'
      }
    }
  ]
});
```

### 2. Separation of Concerns

1. **Core Business Logic**: Create a `GenerationService` that handles the actual image generation
2. **Workflow Definitions**: Define workflows in a separate file
3. **Command Handlers**: Create platform-agnostic command handlers
4. **Platform Adapters**: Create Telegram-specific adapters

### 3. State Management

1. Use the new `WorkflowState` for tracking multi-step interactions
2. Store workflow instances in the user's session
3. Use immutable state transitions
4. Emit events for integrations

### 4. Input Validation

1. Create validation rules for image generation inputs
2. Implement proper error handling and user feedback
3. Add validation middleware to workflows

## Migration Strategy

### Phase 1: Core Logic Extraction

1. Extract core business logic to a platform-agnostic service
2. Keep existing handlers working with the legacy system
3. Create unit tests for the extracted logic

### Phase 2: Workflow Implementation

1. Define workflows for each generation type
2. Implement platform-agnostic command handlers
3. Create basic Telegram adapter

### Phase 3: Integration

1. Connect workflows to the command router
2. Implement full Telegram integration
3. Add feature flags for controlled rollout

## New Structure

```
src/
  └── core/
      ├── generation/
      │   ├── service.js           // Business logic
      │   ├── validators.js        // Input validation
      │   ├── workflows/
      │   │   ├── basic.js         // Basic generation workflow
      │   │   ├── styleTransfer.js // Style transfer workflow
      │   │   └── inpainting.js    // Inpainting workflow
      │   └── index.js             // Public API
      └── workflow/
          └── ... (already implemented)
  └── commands/
      ├── generation/
      │   ├── createCommand.js     // Platform-agnostic command handler
      │   └── index.js
      └── index.js                 // Command registry
  └── integrations/
      └── telegram/
          ├── handlers/
          │   └── makeHandler.js   // Telegram-specific adapter
          └── index.js
```

## Next Steps

1. Create the `GenerationService` with core business logic
2. Define the workflow for basic image generation
3. Implement a simple command handler
4. Create a Telegram adapter for testing 