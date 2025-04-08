# iTrain.js Refactoring Plan

## Current Implementation Analysis

`iTrain.js` handles all aspects of LoRA model training within the bot, including collection of training images, caption generation, training configuration, and model management. It allows users to create and manage personalized AI models.

### Current Structure

The current implementation demonstrates a more modular approach compared to `iMake.js`:

1. **Local State Instantiation**: Uses local variables to store state between interactions
   ```javascript
   // Example from iTrain.js
   const thisLora = {
     loraId: hashId,
     name,
     userId,
     iter: '1.0',
     version: '',
     images: new Array(20).fill(''),
     captions: new Array(20).fill(''),
     initiated: Date.now(),
     status: 'incomplete'
   }
   
   // Store in workspace for the specific user
   workspace[userId][thisLora.loraId] = thisLora
   ```

2. **State Closer to Relevant Code**: State is managed closer to where it's used
3. **Multi-step Flow Management**: Uses different handlers for each step in the process
4. **Locking Mechanism**: Prevents concurrent edits with a `locked` state

### Positive Patterns to Preserve

1. **Local State Management**: State objects are created and managed locally
2. **User-Specific Contexts**: Each workflow has its own context data
3. **Step-by-Step Progress Tracking**: Clearly defined steps with progress indicators
4. **Menu-Driven UI**: UI is generated based on current state

### Key Functions to Refactor

1. **createLora(message)**: Creates a new LoRA training instance
2. **addLoraSlotImage(message)**: Adds a training image to a slot
3. **trainMenu(message, user, loraId)**: Displays training menu with current progress
4. **buildTrainingMenu(userId, loraId)**: Generates UI based on current state

### Multi-step Flows

The current implementation has a complex multi-step interaction:

1. **LoRA Creation and Training Flow**:
   - Create LoRA (name) → Add training images → Add captions → Configure training → Start training → Monitor progress

## Refactoring Approach

### 1. Preserve Local State Pattern

Create a workflow that mirrors the existing local state pattern:

```javascript
// Example workflow for LoRA training
const loraTrainingWorkflow = createWorkflow({
  name: 'LoRATraining',
  steps: {
    'name': {
      id: 'name',
      name: 'LoRA Name',
      validate: validateLoraName,
      nextStep: 'images',
      ui: {
        type: 'text_input',
        message: 'What is the name of the LoRA?'
      }
    },
    'images': {
      id: 'images',
      name: 'Training Images',
      // Dynamic nextStep based on completion
      transitions: (input, state) => {
        const images = state.getState().loraData.images || [];
        return images.filter(Boolean).length >= 4 ? 'captions' : 'images';
      },
      ui: {
        type: 'image_collection',
        message: 'Upload training images (minimum 4)'
      }
    },
    // Additional steps...
  },
  initialStep: 'name'
});
```

### 2. Workflow Context Design

Create a rich workflow context that holds all necessary data:

```javascript
// When creating the workflow instance
const workflowInstance = loraTrainingWorkflow.createWorkflow({
  userId,
  loraData: {
    loraId: generateId(),
    name: '',
    images: new Array(20).fill(''),
    captions: new Array(20).fill(''),
    initiated: Date.now(),
    status: 'incomplete'
  }
});
```

### 3. Local Instance Management

1. Store workflow instances in the session
2. Use immutable updates for workflow state changes
3. Implement locking mechanism with the workflow context

### 4. UI Separation

1. Create a UI renderer specifically for LoRA training
2. Move menu generation logic to platform-specific adapters
3. Keep business logic separate from UI rendering

## Migration Strategy

### Phase 1: Core Domain Model

1. Create a `LoraTrainingService` with the core business logic
2. Define domain models for LoRAs, training slots, etc.
3. Implement repository for persistence

### Phase 2: Workflow Implementation

1. Define the complete LoRA training workflow
2. Implement step validation and processing logic
3. Create a session-based workflow storage system

### Phase 3: UI Integration

1. Create platform-agnostic UI interfaces
2. Implement Telegram-specific rendering
3. Connect to existing buttons and callbacks

## New Structure

```
src/
  └── core/
      ├── training/
      │   ├── service.js         // Business logic
      │   ├── models.js          // Domain models
      │   ├── repository.js      // Data access
      │   ├── validators.js      // Validation rules
      │   └── workflows/
      │       └── loraTraining.js // LoRA training workflow
      └── workflow/
          └── ... (already implemented)
  └── commands/
      ├── training/
      │   ├── trainingCommand.js  // Platform-agnostic command
      │   └── index.js
      └── index.js
  └── integrations/
      └── telegram/
          ├── handlers/
          │   └── trainingHandler.js // Telegram adapter
          └── renderers/
              └── loraMenuRenderer.js // LoRA menu generation
```

## Lessons from iTrain.js

1. **Local Context vs Global State**
   - Keep all workflow state in a local context
   - Use immutable state containers instead of direct mutation
   - Pass state objects explicitly rather than relying on globals

2. **Progressive Step Management**
   - Define clear steps with validation and transitions
   - Support both linear and non-linear flows
   - Allow skipping or revisiting steps when appropriate

3. **UI Based on State**
   - Generate UI elements based on current workflow state
   - Separate UI rendering from business logic
   - Support different platforms with the same workflow

## Next Steps

1. Create core domain models for LoRA training
2. Define the workflow with proper validation rules
3. Implement a basic command handler
4. Create a Telegram adapter that preserves current functionality 