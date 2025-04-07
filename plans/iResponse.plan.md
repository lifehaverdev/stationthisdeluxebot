# iResponse.js Plan

## Current Purpose
`iResponse.js` provides a structured framework for handling conversational flows and multi-step interactions within the bot. It implements two main classes: `StarterFunction` for initiating workflows, and `CallAndResponse` for managing complex multi-step sequences. These classes help standardize interaction patterns across different bot functionalities.

## Exported Functions/Classes
- **StarterFunction Class**:
  - `constructor(state, customMessage, balanceThreshold, preconditions)` - Creates a new starter
  - `start(message, user)` - Main entry point to start the workflow
  - `applyPreconditions(user)` - Applies preconditions to user settings
  - `forwardToStateHandler(replyMessage, userId)` - Routes to state handler
  - `editMessage(message)` - Edits message for inline responses
  - `sendMessage(message)` - Sends new message
  - `setUserState(message)` - Sets user state
  - `gated(message)` - Handles insufficient balance

- **CallAndResponse Class**:
  - `constructor(initialState, steps)` - Creates multi-step workflow
  - `start(message, user)` - Starts the workflow
  - `processStep(message, user, stepIndex)` - Processes a step
  - `handleImage(message, processFunction)` - Handles image input
  - `handlePrompt(message, processFunction)` - Handles text input
  - `tokenGate(message)` - Checks if user has sufficient balance
  - `controlNetStyleTransferCheck(message)` - Validates settings

- **Pre-configured Starters**:
  - Various starter instances for different interaction flows:
    - `ms2Starter` - For img2img operations
    - `make3Starter` - For SD3 generation
    - `rmbgStarter` - For background removal
    - And multiple others for different functionalities

## Dependencies and Integrations
- References global state via `STATES`, `lobby`, `stateHandlers`
- Relies on utility functions from `../../utils`
- Integrates with state handlers to process user inputs
- Assumes existence of various global functions and objects
- Uses message-based interaction patterns from Telegram

## Identified Issues
- Direct references to global state objects
- Tight coupling with Telegram message format
- Hard-coded balance thresholds and validations
- Assumes existence of externally defined state handlers
- Limited error handling within flow steps
- No persistent storage for workflow state
- Complex control flow with implicit dependencies
- No clear separation between UI and business logic

## Migration Plan
1. Create `src/core/workflow/`:
   - `starter.js` - Core starter pattern implementation
   - `sequence.js` - Multi-step sequence implementation
   - `state.js` - Workflow state management
   - `precondition.js` - Precondition handling and validation

2. Create `src/core/interaction/`:
   - `prompt.js` - Text prompt handling
   - `media.js` - Media input handling
   - `validation.js` - Input validation

3. Create `src/integrations/telegram/workflow.js`:
   - Telegram-specific workflow adapters
   - Message formatting and handling
   - Error message presentation

4. Implement `src/api/workflow.js`:
   - Internal API for workflow management
   - Workflow definition and registration
   - Workflow state persistence

5. Suggested improvements:
   - Implement proper state persistence for workflows
   - Create a workflow registry for centralized management
   - Add proper error handling and recovery
   - Implement logging for workflow progression
   - Create a more flexible precondition system
   - Add support for branching workflows
   - Implement timeouts and expiry for long-running workflows
   - Create analytics for workflow completion rates
   - Support for platform-agnostic workflows
   - Add proper documentation and visualization for complex workflows 