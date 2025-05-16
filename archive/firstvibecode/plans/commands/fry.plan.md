# fry.js Plan

## Current Purpose
`fry.js` provides image processing functionality that applies a "deep fry" effect to images. This effect includes brightness/contrast adjustments, noise addition, watermarking, and repeated JPEG compression to create a deliberately degraded, over-processed image. The module processes images provided in Telegram messages.

## Exported Functions/Classes
- **Main Functions**:
  - `cheese(message)` - Entry point function that handles Telegram message processing, extracts the image, applies effects, and sends back the processed image
- **Helper Functions** (internal):
  - `processImage(imagePath)` - Core image processing function that orchestrates the application of effects
  - `applyWatermark(img, watermarkPath, uniqueId)` - Applies a watermark to the image
  - `applyDeepfryEffect(image, uniqueId)` - Applies brightness, contrast, and noise effects
  - `applyJPEGCompression(image, uniqueId)` - Repeatedly applies JPEG compression to degrade image quality

## Dependencies and Integrations
- Image manipulation libraries:
  - Jimp for image processing
  - canvas for drawing and watermarking
- Local modules:
  - `../utils/bot/bot` for Telegram API interaction
  - `../utils/utils` for utility functions
  - `../utils/bot/gatekeep` for user authentication
- Node modules:
  - fs for file operations
  - path for path handling
- External assets:
  - Watermark image files

## Identified Issues
- Hard-coded file paths (`/tmp/`, `./watermarks/watermark_new.png`)
- Global settings object with no customization options
- Direct dependency on Telegram-specific message format
- Synchronous file operations that could block the event loop
- Temporary files not properly cleaned up in all error cases
- No input validation for images (size, format)
- No progress reporting during processing
- No separation between image processing logic and bot interaction
- Limited error handling
- No caching of processed images
- Repeated file I/O operations during processing that could be optimized

## Migration Plan
1. Create `src/core/imaging/`:
   - `effects.js` - Core image effects functionality
   - `watermark.js` - Watermarking functionality
   - `compression.js` - Image compression utilities
   - `validator.js` - Image validation logic

2. Create `src/core/imaging/effects/`:
   - `deepfry.js` - Specific implementation of the deepfry effect
   - `noise.js` - Noise generation utilities
   - `adjustment.js` - Brightness/contrast/saturation adjustments

3. Create `src/util/`:
   - `temp-files.js` - Temporary file management
   - `image-io.js` - Image input/output operations

4. Implement `src/api/imaging.js`:
   - Internal API for image processing
   - Service-agnostic interfaces
   - Request/response validation

5. Suggested improvements:
   - Create a configuration system for effect parameters
   - Implement asynchronous file operations throughout
   - Add proper temporary file cleanup mechanisms
   - Create a processing queue for handling multiple requests
   - Add input validation for image size and format
   - Implement an image preview feature for faster feedback
   - Add progress reporting during long processing operations
   - Create a caching system for recently processed images
   - Optimize the processing pipeline to reduce file I/O
   - Add support for different effect presets
   - Implement error handling with specific error types
   - Create a UI for adjusting effect parameters 