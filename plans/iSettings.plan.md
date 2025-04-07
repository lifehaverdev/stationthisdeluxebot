# iSettings.js Plan

## Current Purpose
`iSettings.js` manages the configuration and settings for the image generation process. It handles user interaction for setting various parameters like image size, batch count, CFG scale, prompts, and other generation settings. It supports both individual user settings and group-specific configurations.

## Exported Functions/Classes
- **Main Handler Functions**:
  - `startSet(message, user)` - Main entry point for settings commands
  - `handleSet(message)` - Processes user responses to setting changes

- **Calculation Functions**:
  - `calcSize(message)` - Calculates maximum allowed image size
  - `calcBatch(message)` - Calculates maximum allowed batch size
  - `calcSteps(message)` - Calculates maximum allowed steps

- **Helper Functions**:
  - `buildOptionalInline(type, justBack)` - Builds inline keyboard for settings
  - `sendOrEditMessage(text, reply_markup)` - Sends or edits messages
  - `processSettingChange(message, settingKey, converter)` - Processes setting changes

- **Image Processing Functions**:
  - `resizeIfNeeded(imagePath, maxSize)` - Resizes images if they exceed limits
  - `processImage(message, settingKey)` - Processes and saves uploaded images

## Dependencies and Integrations
- References global state objects like `workspace`, `STATES`, `lobby`
- Uses mapping constants like `SETTER_TO_STATE`, `STATE_TO_LOBBYPARAM`
- Telegram bot API via utility functions
- Image processing via Jimp library
- Menu handling through `iMenu`
- Group context via `getGroup` from iGroup
- Keyboard models from userKeyboards

## Identified Issues
- Direct references to global state objects
- Complex mapping between commands, states, and lobby parameters
- Mixed responsibilities: UI, parameter validation, and state management
- Hard-coded limits and calculations
- Tight coupling with Telegram-specific message format
- Limited error handling for invalid inputs
- Complex conditionals for handling different settings types
- No clear separation between parameter validation and UI
- Duplicate code for handling different setting types

## Migration Plan
1. Create `src/core/settings/`:
   - `model.js` - Core settings data models
   - `validation.js` - Parameter validation and limits
   - `calculator.js` - Calculations for resource-based limits
   - `repository.js` - Settings storage and retrieval

2. Create `src/core/image/`:
   - `processor.js` - Generic image processing functions
   - `validator.js` - Image format and size validation

3. Create `src/integrations/telegram/settings.js`:
   - Telegram-specific settings command handler
   - Settings menu UI components
   - Input validation and error messaging

4. Implement `src/api/settings.js`:
   - Internal API for settings management
   - Parameter validation and application
   - User and group settings endpoints

5. Suggested improvements:
   - Create a configuration system for setting types and limits
   - Implement proper validation with clear error messages
   - Add preset management for quick settings changes
   - Create a visual settings editor for complex parameters
   - Implement settings history and restore points
   - Add validation for parameter combinations
   - Create a settings export/import feature
   - Implement analytics for tracking settings usage
   - Create user preferences for default settings
   - Add detailed documentation for each setting 