# iBrand.js Plan

## Current Purpose
`iBrand.js` handles image branding functionalities within the bot, specifically adding watermarks to images and writing images to disc-shaped templates. It provides interfaces for users to apply branding elements to their generated or uploaded images.

## Exported Functions/Classes
- **Command Handlers**:
  - `startWatermark(message, user)` - Initiates watermark application flow
  - `startDisc(message, user)` - Initiates disc template application flow

- **Processing Functions**:
  - `handleWatermark(message, image, user, utils)` - Processes watermark application
  - `handleDiscWrite(message)` - Processes disc template application

## Dependencies and Integrations
- File system operations through `fs`
- Image processing through external functions:
  - `addWaterMark` and `writeToDisc` from waterMark module
- Telegram bot API via utility functions:
  - `sendMessage`, `sendPhoto`, etc.
- References global state objects:
  - `STATES`, `lobby`, `workspace`
- Menu handling through `iMenu.handleWatermarkMenu`

## Identified Issues
- Limited to just two branding operations (watermark and disc)
- Direct references to global state objects
- Mixed responsibilities between UI flow and image processing
- Tight coupling with Telegram-specific message format
- File management with synchronous operations
- Limited error handling
- Temporary file creation without proper cleanup guarantees
- Hard-coded messages and workflow
- No clear separation between user input handling and image processing

## Migration Plan
1. Create `src/core/branding/`:
   - `watermark.js` - Watermark application logic
   - `template.js` - Template (disc and other) application logic
   - `service.js` - Business logic for branding operations
   - `repository.js` - Watermark and template asset management

2. Create `src/core/image/`:
   - `processor.js` - Generic image processing functions
   - `storage.js` - Temporary and permanent image storage management
   - `validator.js` - Image format and size validation

3. Create `src/integrations/telegram/branding.js`:
   - Telegram-specific handlers for branding commands
   - UI components for branding workflow
   - Image extraction from Telegram messages

4. Implement `src/api/branding.js`:
   - Internal API for branding operations
   - Endpoints for watermark and template application
   - Asset management endpoints

5. Suggested improvements:
   - Implement proper temporary file management
   - Add support for additional branding templates
   - Create user-uploaded watermark support
   - Add watermark positioning and sizing options
   - Implement proper error handling and recovery
   - Create a watermark preview feature
   - Add batch processing for multiple images
   - Implement logging for branding operations
   - Create configurable branding profiles for users
   - Support transparency and different file formats 