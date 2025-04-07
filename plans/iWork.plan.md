# iWork.js Plan

## Current Purpose
`iWork.js` handles various utility and operational functions for the bot, including the help command, status reporting, LoRA model listing, seed reporting, text-to-speech, interrogation (image analysis), and various assistance features. It serves as a collection of miscellaneous utilities that support the core functionalities of the bot.

## Exported Functions/Classes
- **Information Functions**:
  - `handleHelp(message)` - Displays help information
  - `handleStatus(message)` - Shows bot status, queue, and other metrics
  - `saySeed(message)` - Reports the seed used for the last generation

- **LoRA List Functions**:
  - `loraList(message)` - Lists available LoRA models
  - `featuredLoRaList(message)` - Shows featured LoRA models
  - `fluxLoraList(message)` - Lists LoRA models for Flux model
  - `sendLoRaModelFilenames(message)` - Displays LoRA model filenames

- **Assistance Functions**:
  - `shakeAssist(message, prompt, user)` - Handles prompt assistance
  - `shakeFluxAssist(message, prompt, user)` - Handles Flux-specific prompt assistance
  - `startSpeak(message, user)` - Initiates text-to-speech generation
  - `shakeSpeak(message)` - Processes text-to-speech request

- **Interrogation Functions**:
  - `startFluxInterrogate(message, user)` - Starts image interrogation
  - `shakeFluxInterrogate(message, image)` - Processes image for interrogation
  - `makeInterrogationRequest(url)` - Makes API request for interrogation
  - `getEventId(url)` - Gets event ID for interrogation
  - `streamEventResult(eventId)` - Streams results from interrogation

- **Utility Functions**:
  - `convertTime(timeInSeconds)` - Converts seconds to human-readable time
  - `seeGlorp(address)` - Checks Glorp address (purpose unclear)
  - `handleHuggingFaceQuota(error)` - Handles HuggingFace API quota errors

## Dependencies and Integrations
- File system operations via `fs` and `path`
- Telegram bot integration through global `bot` object
- References global state through `lobby`, `STATES`, etc.
- External services:
  - Text-to-speech via `txt2Speech`
  - Prompt assistance via `promptAssist`
- Database operations through `LoraDB`
- Price information via `getMS2Price` from iWallet
- Shared utilities from `../../utils`

## Identified Issues
- Disparate functionalities grouped into a single file
- Mixed responsibilities across different domains (LoRA, TTS, status, etc.)
- Direct references to global state objects
- Telegram-specific UI mixed with core functionality
- Hard-coded UI text and messages
- Limited error handling
- Lack of clear organization for related functions
- Direct database operations mixed with UI logic
- No clear separation between data access, business logic, and presentation

## Migration Plan
1. Split into multiple core modules:
   - `src/core/status/service.js` - Status reporting and monitoring
   - `src/core/lora/catalog.js` - LoRA catalog and listing functionality
   - `src/core/speech/service.js` - Text-to-speech functionality
   - `src/core/interrogation/service.js` - Image analysis and interrogation
   - `src/core/assistance/service.js` - Prompt assistance functionality

2. Create platform-specific UI components:
   - `src/integrations/telegram/status.js` - Status command and UI
   - `src/integrations/telegram/help.js` - Help command and documentation
   - `src/integrations/telegram/utilities.js` - Various utility commands

3. Implement API endpoints:
   - `src/api/status.js` - Status reporting API
   - `src/api/lora/catalog.js` - LoRA catalog API
   - `src/api/speech.js` - Text-to-speech API
   - `src/api/interrogation.js` - Image analysis API
   - `src/api/assistance.js` - Prompt assistance API

4. Suggested improvements:
   - Create proper service interfaces for each functionality
   - Implement proper error handling for external services
   - Create caching mechanisms for frequently accessed data
   - Separate configuration from implementation
   - Add proper logging and monitoring
   - Create consistent UI components and templates
   - Implement authentication and rate limiting for API endpoints
   - Add documentation for each service and API 