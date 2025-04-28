# iCallbaq.js Plan

## Current Purpose
`iCallbaq.js` serves as the central hub for handling all callback queries from Telegram's inline buttons. It routes button interactions to appropriate handler functions, manages callback state, and orchestrates the flow between different UI components. It essentially connects user button clicks to the corresponding bot actions.

## Exported Functions/Classes
- **Main Handler Function**:
  - `handleCallback(ctx)` - Main entry point for processing callback queries

- **Parsing Functions**:
  - `parseCallbackData(callbackQuery)` - Extracts action and context from callback data

- **Setting Handlers**:
  - `handleSetAction(action, message, user)` - Handles general setting actions
  - `handleSetBasePrompt(message, selectedName, userId)` - Sets base prompt
  - `handleSetCheckpoint(message, selectedName, userId)` - Sets checkpoint
  - `handleSetVoice(message, selectedName, userId)` - Sets voice model
  - `handleSetWatermark(message, selectedName, userId, utils)` - Sets watermark

- **Action Map**:
  - Extensive set of callback handlers mapped to specific actions:
    - Image generation actions (`regen`, `make`, `ms2`, etc.)
    - Utility actions (`upscale`, `rmbg`, `interrogate`, etc.)
    - Menu navigation actions (`backToSet`, `voiceMenu`, etc.)
    - Account actions (`account`, `wallet`, `qointsRefresh`, etc.)
    - UI actions (`cancel`, `noop`, etc.)

## Dependencies and Integrations
- Strong dependencies on nearly all other handler modules:
  - `iResponse`, `iMenu`, `iGroup`, `iAccount`, `iWork`, etc.
- References to global objects:
  - `actionMap`, `prefixHandlers`, `lobby`, `STATES`, etc.
- External resources:
  - Voice model menu, base prompt menu
- Bot instance for direct interaction with Telegram API
- Database operations via `AnalyticsEvents`
- Queue system via `enqueueTask`

## Identified Issues
- Acts as a massive routing hub with dependencies on almost all modules
- Direct references to numerous global objects
- Strong coupling with Telegram's callback query format
- Mixed responsibilities: parsing, routing, and handling
- Massive action map with inline function definitions
- Lack of organized structure for related callback handlers
- No clear error handling strategy for callback failures
- Hard-coded UI texts and response formats
- Complex state management across multiple handlers

## Migration Plan
1. Create `src/core/interaction/`:
   - `router.js` - Core callback routing logic
   - `parser.js` - Callback data parsing functions
   - `registry.js` - Callback handler registration

2. Create structured handler modules in `src/core/handlers/`:
   - `settings.js` - Settings-related callbacks
   - `generation.js` - Generation-related callbacks
   - `utility.js` - Utility-related callbacks
   - `navigation.js` - Menu navigation callbacks

3. Create `src/integrations/telegram/callback.js`:
   - Telegram-specific callback handling
   - Callback formatting and response generation
   - Error handling and retry mechanisms

4. Implement `src/api/interaction.js`:
   - Internal API for handling interactive elements
   - Action mapping and routing
   - State management for interactions

5. Suggested improvements:
   - Implement a proper callback registry with dependency injection
   - Create a middleware system for callback processing
   - Add proper error handling and recovery
   - Implement logging for callback flow and errors
   - Create a consistent approach to callback data formats
   - Add security validations for callback authenticity
   - Implement rate limiting for callback processing
   - Create a callback response formatter for consistent UI
   - Develop a testing framework for callback handlers 