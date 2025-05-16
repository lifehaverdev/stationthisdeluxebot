# iMedia.js Plan

## Current Purpose
`iMedia.js` manages media processing functionalities within the bot, including image handling, video generation, media storage, and utility operations like background removal, upscaling, and interrogation. It acts as the interface between user commands and media processing services.

## Exported Functions/Classes
- **Image Processing Functions**:
  - `handleInpaint(message, prompt, mask)` - Handles inpainting operations
  - `handleBackgroundRemoval(message, image)` - Removes image backgrounds
  - `handleUpscale(message, image)` - Upscales images
  - `handleInterrogate(message, image)` - Analyzes image content

- **Video Generation Functions**:
  - `handleAnimate(message, prompt, image)` - Creates animation from image
  - `handleVideo(message, prompt)` - Generates video from prompt
  - `processVideoResults(result, message)` - Processes video generation results

- **Media Management Functions**:
  - `saveMediaToWorkspace(media, userId, type)` - Saves media to user workspace
  - `getMediaFromWorkspace(userId, type)` - Retrieves media from workspace
  - `clearUserMedia(userId)` - Clears user media from workspace
  - `handleMediaResponse(message, media)` - Handles response with media

- **Utility Functions**:
  - `getImageFromMessage(message)` - Extracts image from message
  - `validateImageSize(image)` - Validates image dimensions and size
  - `processImageForService(image, operation)` - Prepares image for processing
  - `handleImageError(error, message)` - Handles image processing errors

## Dependencies and Integrations
- Telegram bot API for message handling and media exchange
- External image processing services
- File system operations for media storage
- Queue system for processing jobs
- Workspace management for user media
- Various utility functions for media manipulation

## Identified Issues
- Telegram-specific handling mixed with core media processing
- Direct references to global state objects
- Complex workflows for different media types
- Mixed responsibilities: storage, processing, response handling
- Limited error handling for service failures
- Hard-coded parameters for media processing
- Lack of clear separation between media storage and processing
- No consistent approach to handling large media files

## Migration Plan
1. Create `src/core/media/`:
   - `image.js` - Core image processing operations
   - `video.js` - Video generation and processing
   - `storage.js` - Media storage management
   - `processor.js` - Media processing orchestration
   - `validator.js` - Media validation functions

2. Create `src/integrations/telegram/media.js`:
   - Telegram-specific media extraction
   - Media response formatting
   - Media size limitations and handling

3. Implement `src/api/media.js`:
   - Internal API for media operations
   - Media processing endpoints
   - Media storage endpoints

4. Create `src/services/`:
   - `upscaler.js` - Image upscaling service
   - `background.js` - Background removal service
   - `interrogation.js` - Image analysis service
   - `animation.js` - Animation generation service

5. Suggested improvements:
   - Implement a media pipeline for consistent processing
   - Create a caching layer for processed media
   - Add robust error handling for external services
   - Implement proper logging and monitoring for media operations
   - Create a clear separation between media extraction and processing
   - Add validation for all media inputs
   - Implement rate limiting for resource-intensive operations
   - Create a storage abstraction for different media types 