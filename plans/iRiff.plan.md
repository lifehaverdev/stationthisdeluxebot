# iRiff.js Plan

## Current Purpose
`iRiff.js` implements the prompt engineering assistant functionality of the bot, enabling users to develop detailed image generation prompts through a guided conversation. It uses AI to ask relevant questions about the user's initial concept, builds on their responses, and eventually generates a comprehensive prompt suitable for image generation.

## Exported Functions/Classes
- **Command Handlers**:
  - `/riff` handler - Initiates a new prompt development session

- **State Handlers**:
  - `stateHandlers['riff']` - Processes user responses during the riff session

- **Action Handlers**:
  - `actionMap['riff_skip']` - Skips remaining questions and finalizes the prompt
  - `actionMap['riff_create']` - Creates an image using the generated prompt
  - `actionMap['riff_tweak']` - Allows the user to manually adjust the prompt
  - `actionMap['riff_reset']` - Restarts the riff session with the same seed

- **Helper Functions**:
  - Various utility functions for processing AI responses
  - Session management for tracking conversation state

## Dependencies and Integrations
- Reliance on global `ledger` object for session state management
- References to global objects like `lobby`, `commandRegistry`, etc.
- External AI capabilities via `gptAssist` from assist module
- Image generation via `handleFlux` from iMake.js
- Telegram-specific UI through buttons and message handling
- Utility functions for message sending and state management

## Identified Issues
- Uses a global `ledger` object instead of proper session storage
- Direct coupling with Telegram message format
- Tight integration with specific AI models like GPT-4
- Hard-coded prompts and system messages
- Limited error handling and recovery options
- No persistence of riff sessions beyond runtime
- Complex state management within the handlers
- No separation between conversation logic and UI

## Migration Plan
1. Create `src/core/prompt/`:
   - `engine.js` - Core prompt engineering logic
   - `conversation.js` - Conversational flow management
   - `repository.js` - Session storage and retrieval
   - `templates.js` - System prompts and templates

2. Create `src/core/ai/`:
   - `client.js` - Generic AI client interface
   - `formatter.js` - Response formatting utilities
   - `evaluator.js` - Prompt quality assessment

3. Create `src/integrations/telegram/riff.js`:
   - Telegram-specific command handler
   - UI components for the riff flow
   - Button actions and callback handling

4. Implement `src/api/prompt.js`:
   - Internal API for prompt engineering
   - Session management endpoints
   - Prompt generation and evaluation endpoints

5. Suggested improvements:
   - Implement proper database storage for riff sessions
   - Create a configurable template system for prompts
   - Add support for different AI models and providers
   - Implement proper error handling and recovery
   - Create a session timeout and cleanup mechanism
   - Add analytics for tracking prompt quality
   - Implement user feedback collection for prompts
   - Create a shareable prompt library
   - Add support for prompt categories and styles 