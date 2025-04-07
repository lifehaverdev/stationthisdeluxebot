# iMenu.js Plan

## Current Purpose
`iMenu.js` is responsible for generating and managing the UI menus and settings interfaces for the bot. It handles settings configuration, creation workflows, feature selection, and routing between different generation options. This file acts as a central hub for users to access various features and configure their generation parameters.

## Exported Functions/Classes
- **Menu Building Functions**:
  - `setMenu(message)` - Displays the main settings menu
  - `backToSet(message, user)` - Returns to the settings menu
  - `buildSetMenu(settings, group, userBalance)` - Builds settings menu UI
  - `createPromptOption(settings)` - Creates prompt selection UI
  - `getStatusIcon(setting, imageSet)` - Gets UI icon based on setting state

- **Creation Handlers**:
  - `handleCreate(message, prompt, user)` - Handles creation command routing
  - `handleUtils(message, prompt, user)` - Handles utilities menu
  - `handleEffect(message, prompt, user)` - Handles image effect application
  - `handleEffectF(message, prompt, user)` - Handles Fast effect application
  - `handleEffectXL(message, prompt, user)` - Handles XL effect application

- **Menu Handlers**:
  - `handleCheckpointMenu(message, user)` - Shows checkpoint selection menu
  - `handleWatermarkMenu(message, user, utils)` - Shows watermark selection menu
  - `handleBasePromptMenu(message, user)` - Shows base prompt selection menu
  - `handleVoiceMenu(message, user)` - Shows voice model selection menu
  - `handleInterrogateMenu(message, user)` - Shows interrogate menu
  - `handleAssistMenu(message, user)` - Shows assist menu

- **Helper Functions**:
  - `getGroup(message)` - Gets group information
  - `getSettings(message)` - Gets user/group settings
  - `extractPromptFromMessage(message)` - Extracts prompt from message
  - `generateFeatureMenu(settings, balance, context)` - Generates feature selection UI
  - `generateUtilsMenu(settings, balance, group)` - Generates utilities menu
  - `promptForFeatureValue(feature, message, user)` - Prompts for feature input
  - `determineState(createSwitch, defaultState, fluxState)` - Determines state based on context

- **Effect Workflow Functions**:
  - `routeEffectWorkflow(prompt, image, settings, message)` - Routes effect workflows
  - `handleFullCase(message, settings, image, prompt)` - Handles complete effect inputs
  - `handleMissingImageCase(message, settings, workspaceEntry, prompt)` - Handles missing image
  - `handleMissingPromptCase(message, settings, image)` - Handles missing prompt
  - `handleEffectHang(message)` - Handles effect hang state

## Dependencies and Integrations
- Tightly coupled with Telegram bot UI and message handling
- References global state via `lobby`, `rooms`, etc.
- Imports from other handler files like `iMake.js` and `iMedia.js`
- Uses menu models from:
  - `basepromptmenu.js`
  - `checkpointmenu.js`
  - `voiceModelMenu.js`
  - `watermarks.js`
- Uses utility functions like `compactSerialize`, `sendMessage`, etc.

## Identified Issues
- Telegram-specific UI mixed with core menu and settings logic
- Direct references to global state objects (`lobby`, `rooms`)
- Complex conditional logic for UI generation
- Multiple responsibilities: settings management, workflow routing, UI generation
- Lack of clear separation between data access, business logic, and presentation
- Hard-coded UI elements and workflows
- Duplicated functionality across functions
- Cross-imports with other handler files creating tight coupling

## Migration Plan
1. Create `src/core/settings/`:
   - `model.js` - Core settings data models
   - `service.js` - Business logic for settings operations
   - `validator.js` - Settings validation logic

2. Create `src/core/workflow/`:
   - `router.js` - Central workflow routing logic
   - `create.js` - Creation workflow management
   - `effect.js` - Effect workflow management
   - `utils.js` - Utility workflow management

3. Create `src/integrations/telegram/menu.js`:
   - Telegram-specific UI for menus and settings
   - Menu generation and rendering
   - Settings UI interaction handlers

4. Implement `src/api/settings.js`:
   - Internal API for settings operations
   - Settings management endpoints
   - Settings validation and persistence

5. Suggested improvements:
   - Implement a proper state machine for workflow management
   - Create a UI component system for consistent menu generation
   - Separate settings persistence from UI state
   - Create configuration-based menu definitions
   - Implement proper validation for all settings inputs
   - Add proper error handling and retry mechanisms
   - Create separate modules for each menu type 