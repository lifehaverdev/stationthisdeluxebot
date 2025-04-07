# iMake.js Plan

## Current Purpose
`iMake.js` is responsible for handling image generation tasks in the bot. It manages the creation of prompts, handling user inputs, managing different generation types, and queueing image generation tasks. The file acts as the core interface between user commands and the actual image generation backend.

## Exported Functions/Classes
- **Core Generation Functions**:
  - `handleTask(message, taskType, defaultState, needsTypeCheck, minTokenAmount)` - Main task handler
  - `getSettings(userId, group)` - Gets unified settings for user/group
  - `checkAndSetType(type, settings, message, group, userId)` - Sets task type with modifiers
  - `tokenGate(group, userId, message)` - Checks if user has enough tokens
  - `startTaskPrompt(message, taskType, state, user, balanceCheck)` - Prompts for task input

- **Generation Command Handlers**:
  - `handleMake(message)` - Handles QUICKMAKE generation
  - `handleMake3(message)` - Handles SD3 generation
  - `handleMog(message)` - Handles MOG generation
  - `handleDegod(message)` - Handles DEGOD generation
  - `handleMilady(message)` - Handles MILADY generation
  - `handleLoser(message)` - Handles LOSER generation
  - `handleFlux(message)` - Handles FLUX generation
  - `handleRegen(message, user)` - Handles regeneration
  - `handleHipFire(message, user)` - Handles hip fire generation
  - `handleAgain(message)` - Handles regeneration with same params

- **Prompt Handlers**:
  - `handleMs2Prompt(message)` - Handles MS2 prompt input
  - `handleSD3ImgPrompt(message)` - Handles SD3 prompt input
  - `handleFluxPrompt(message)` - Handles FLUX prompt input
  - `handleInpaintPrompt(message)` - Handles inpainting prompt input
  - `handleInpaintTarget(message)` - Handles inpainting target selection

## Dependencies and Integrations
- Relies on global state through `STATES`, `lobby`, `rooms`, `flows`, `workspace`
- Uses utility functions from `../../utils`
- Queue integration via `enqueueTask`
- Group functionality from `iGroup.js`
- Prompt building from `../prompt.js`

## Identified Issues
- Heavy reliance on global state (`lobby`, `workspace`, etc.)
- Mixed responsibilities: settings management, task handling, prompt processing
- Tight coupling with Telegram message format
- Duplicated logic across different handler functions
- Complex conditional logic for determining task types
- No clear separation between core generation logic and platform-specific code
- Hard-coded values for token gates and other thresholds
- Limited error handling and retry mechanisms

## Migration Plan
1. Create `src/core/generation/`:
   - `service.js` - Core generation business logic
   - `settings.js` - Settings management for generation tasks
   - `validator.js` - Input validation and token gating
   - `types.js` - Task type definition and management

2. Create `src/integrations/telegram/generation.js`:
   - Telegram-specific handlers for generation commands
   - Message parsing and prompt extraction
   - User interaction flows

3. Create `src/api/generation.js`:
   - Internal API for generation operations
   - Task queuing and status management
   - Settings application and validation

4. Create `src/core/queue/`:
   - `service.js` - Queue management and task processing
   - `task.js` - Task definition and lifecycle management

5. Suggested improvements:
   - Implement proper task scheduling and prioritization
   - Create a settings resolver that applies settings hierarchically
   - Add robust error handling and retry mechanisms
   - Implement proper logging for task lifecycle
   - Create a task history and results storage system
   - Add validation for all user inputs
   - Replace global state with proper dependency injection
   - Create clear interfaces between modules 