# iStart.js Plan

## Current Purpose
`iStart.js` is responsible for managing the tutorial/onboarding experience for new users. It implements a step-by-step tutorial that introduces users to the bot's functionality, gradually unlocking commands as users progress through each step.

## Exported Functions/Classes
- `tutorialSteps` - Object containing all the steps in the tutorial flow
- `CHECKPOINTS` - Constants for tracking user progress
- `TutorialManager` - Class with static methods for managing tutorial state:
  - `initializeProgress(userId)` - Sets up initial tutorial state for a user
  - `progressToNextStep(message)` - Advances user to next tutorial step
  - `isCommandAllowed(userId, command)` - Checks if a command is allowed for user
  - `getCurrentStep(userId)` - Gets current tutorial step for a user
  - `checkpointReached(userId, checkpointType, context)` - Updates progress when user reaches a checkpoint

## Dependencies and Integrations
- Tightly coupled with Telegram bot API via message objects
- References `lobby` object from the bot module to store user state
- Uses the `commandRegistry` to register commands
- External integrations:
  - References LoRA triggers
  - Uses `sendPrivateMessage` and `escapeMarkdown` utility functions
  - Uses `AnalyticsEvents` model for tracking
  - Uses `refreshLoraCache` for LoRA functionality
  - Uses `Loras` database model

## Identified Issues
- Tight coupling with Telegram-specific data structures and APIs
- Mixes tutorial logic with Telegram-specific messaging
- Uses global state through `lobby` object for user progress tracking
- Hard-coded checkpoints and tutorial steps with limited extensibility
- Business logic not properly separated from integration code
- No clear error handling or retry mechanisms

## Migration Plan
1. Move to `src/core/onboarding/tutorial.js`:
   - Extract core tutorial logic and step progression
   - Create platform-agnostic tutorial step definitions
   - Implement proper state management interfaces

2. Create `src/integrations/telegram/tutorial.js`:
   - Implement Telegram-specific message handling and command registration
   - Connect Telegram events to core tutorial functionality

3. Implement `src/api/tutorial.js`:
   - Define internal API for tutorial progression and state management
   - Create endpoints for frontend applications to interact with tutorial system

4. Suggested improvements:
   - Use a proper state machine for tutorial progression
   - Store tutorial state in database instead of in-memory
   - Create configuration-based tutorial steps that can be modified without code changes
   - Implement analytics tracking separate from core tutorial logic
   - Add proper error handling and recovery mechanisms 