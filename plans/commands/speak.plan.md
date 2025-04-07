# speak.js Plan

## Current Purpose
`speak.js` provides text-to-speech functionality for the bot, converting user text input into audio files using the ElevenLabs API. It handles processing text input, optional custom filename specification, making the API request, and saving the resulting audio file for the bot to send.

## Exported Functions/Classes
- **Main Functions**:
  - `main(message, voiceModel, voiceName, customFileNames)` - Processes text and generates speech audio
  - `txt2Speech(message, voiceModel, voiceName, customFileNames)` - External-facing wrapper for speech generation

## Dependencies and Integrations
- External API services:
  - ElevenLabs API for text-to-speech generation
- Node modules:
  - http for making requests
  - fs for file operations
- Global state:
  - References `lobby` from bot module for user preferences
- Environment variables:
  - ELEVEN_LABS for API key

## Identified Issues
- Direct dependency on global `lobby` object
- Hard-coded API endpoint and parameters
- No abstraction for different TTS providers
- Limited error handling for API failures
- Synchronous file operations that could block the event loop
- No validation for inputs (text length, etc.)
- Hard-coded temporary file paths
- No file cleanup mechanism
- Limited configuration options for voice parameters
- No caching of common voice generations

## Migration Plan
1. Create `src/core/speech/`:
   - `service.js` - Core speech generation functionality
   - `model.js` - Data models for speech operations
   - `validator.js` - Input validation logic

2. Create `src/services/elevenlabs/`:
   - `client.js` - Abstracted ElevenLabs API client
   - `mapper.js` - Maps internal parameters to API format
   - `config.js` - Service-specific configuration

3. Create `src/core/file/`:
   - `storage.js` - Abstract file storage operations
   - `naming.js` - File naming utilities
   - `cleanup.js` - Temporary file management

4. Implement `src/api/speech.js`:
   - Internal API for speech operations
   - Service-agnostic interfaces
   - Request/response validation

5. Suggested improvements:
   - Implement proper temporary file management
   - Add validation for input text (length, content)
   - Create a more flexible voice configuration system
   - Support different output formats (MP3, WAV, etc.)
   - Add caching for common phrases
   - Implement asynchronous file operations
   - Add support for streaming audio responses
   - Create voice preview functionality
   - Add logging for tracking API usage
   - Implement rate limiting and quota management
   - Add support for multiple TTS providers
   - Create a voice selection UI helper 