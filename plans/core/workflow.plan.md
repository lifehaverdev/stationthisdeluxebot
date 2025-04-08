# Workflow System Plan

## Current Implementation Analysis

### Multi-step Interaction Locations

After analyzing the codebase, I've identified several key areas where multi-step interactions currently exist:

#### 1. `iMake.js` - Image Generation Workflows
- Uses a combination of state tracking via `STATES` enum
- State transitions via `setUserState(message, STATES.X)`
- Multi-step workflows for different generation types (quick make, flux, etc.)
- Uses callback handlers (`prefixHandlers`) for button interactions
- Example flow: `/make` → prompt input state → task creation → result display
- **Note**: This implementation is the first iteration and has proven to be clunky and problematic

#### 2. `iTrain.js` - LoRA Training Workflows
- Complex multi-stage interaction for model training
- Uses local instantiation to store state between user inputs
- State is more closely tied to the relevant code (superior approach)
- Uses `locked` state to prevent concurrent edits
- Multiple entry points via callbacks and message handlers
- User moves through stages: name → add training images → add captions → submit training

#### 3. `iRiff.js` - Variation Generation
- Similar to iTrain, uses local state storage
- State is managed closer to the relevant code
- Provides better maintainability and readability

#### 4. `iWallet.js` - Wallet Management
- Multiple states for connecting wallets, verifying ownership
- Chain selection → wallet address input → verification → confirmation

#### 5. `iMedia.js` - Media Processing
- Multi-step workflows for uploading and processing images
- State transitions based on user uploads and text inputs

### Current State Management Patterns

1. **Global State Enum + Handlers** (First Iteration - iMake.js)
   - Uses global `STATES` enum in `../bot`
   - Each state has a corresponding handler in `stateHandlers[STATE]`
   - State transitions via `setUserState(message, STATES.X)`
   - **Note**: This approach is more clunky and causes headaches

2. **Local State Management** (Preferred Approach - iTrain.js, iRiff.js)
   - Uses local instantiation to store state
   - State is tied to the relevant code, making it easier to maintain
   - More modular and cleaner to work with
   - Better encapsulation of workflow-specific state

3. **Mutable Global State**
   - Uses global `lobby` and `workspace` objects
   - Direct mutation of objects: `lobby[userId].property = value`
   - No immutability or state tracking

4. **Callback-Based Transitions**
   - Uses `prefixHandlers` for button callbacks
   - Each callback triggers a state transition or action

5. **Platform-Specific Logic**
   - Directly interacts with Telegram API (message sending, editing)
   - UI rendering and business logic are tightly coupled

## Workflow System Design

### Core Components

#### 1. `workflow.state.js`

A state container specifically designed for workflows with:
- Immutable state transitions
- Event emissions on state changes
- History tracking
- Ability to serialize/deserialize for persistence
- Platform-agnostic state representation
- **Key Improvement**: Will follow the local instantiation pattern from iTrain.js and iRiff.js rather than global state enums

#### 2. `workflow.sequence.js` 

Defines step-by-step interaction models with:
- Step definitions with validation rules
- Conditional transitions between steps
- Event hooks for steps (beforeStep, afterStep)
- Error handling and recovery
- Support for branching flows
- **Focus**: Localized, workflow-specific state management

### Key Abstractions

1. **WorkflowState**
   - Extends `StateContainer` from core/shared/state.js
   - Adds workflow-specific properties (current step, inputs, errors)
   - Provides methods for state transitions that validate inputs
   - Designed for local instantiation rather than global state management

2. **WorkflowStep**
   - Represents a single interaction in a workflow
   - Contains validation rules, rendering info, and transition logic
   - Platform-agnostic definition of what happens in each step

3. **WorkflowSequence**
   - Defines the sequence of steps and transitions
   - Supports linear, branching, and conditional flows
   - Handles step navigation (next, back, jump to step)
   - Self-contained, workflow-specific logic

4. **WorkflowRenderer**
   - Interface for rendering workflow UI
   - Platform-specific implementations (Telegram, web)
   - Separates UI concerns from workflow logic

5. **WorkflowContext**
   - Contains all data needed for a specific workflow instance
   - Follows the local instantiation pattern from iTrain/iRiff
   - Avoids global state where possible

## Integration Strategy

### Phase 1: Core Framework

1. Implement `workflow.state.js` based on existing `StateContainer`
2. Implement `workflow.sequence.js` for defining workflow steps
3. Create platform-agnostic event system for workflow transitions
4. Develop testing utilities for workflow validation

### Phase 2: First Command Migration

1. Identify simple multi-step command to migrate (e.g., `/status` with refresh)
2. Implement platform adapters for Telegram
3. Create separation between business logic and UI rendering
4. Test workflow with real users via feature flags

### Phase 3: Complex Workflow Migration

1. Migrate more complex workflows (image generation, training)
2. Implement session persistence for long-running workflows
3. Add validation framework for all inputs
4. Create comprehensive error handling and recovery

## Target Commands for Conversion

1. **Image Generation (iMake.js)**
   - `/create` and variants - High priority
   - Style transfer workflows
   - Control net and other specialized generation

2. **LoRA Training (iTrain.js)**
   - Complete training workflow - High priority
   - Training slot management
   - Image upload and caption flows

3. **Wallet Management (iWallet.js)**
   - Connect wallet flow
   - Token verification
   - Wallet switching

4. **Media Processing (iMedia.js)**
   - Image upload and processing workflows
   - Inpainting and upscaling flows

## Next Steps

1. Implement `workflow.state.js` with workflow-specific extensions to `StateContainer`
2. Implement `workflow.sequence.js` with step definition and transition logic
3. Document patterns for defining workflows
4. Create first example workflow with simple command
5. Identify integration points with existing session management 