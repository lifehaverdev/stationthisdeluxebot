# tripo.js Plan

## Current Purpose
`tripo.js` provides 3D model generation functionality by interacting with the Tripo3D API. It handles uploading images, initiating model generation tasks, and monitoring task progress via WebSocket connections to create 3D models from 2D images.

## Exported Functions/Classes
- **Main Functions**:
  - `generateTripo(promptObj, processWaitlist)` - Main exported function that orchestrates the entire 3D model generation process
- **Helper Functions** (internal):
  - `uploadImage(imagePath)` - Uploads an image to the Tripo3D API
  - `generateModel(imageToken)` - Initiates a 3D model generation task with the API
  - `receiveOne(taskId, apiKey)` - WebSocket-based task monitoring function
  - `debugLog(message)` - Conditional logging for debugging

## Dependencies and Integrations
- External API services:
  - Tripo3D API for 3D model generation
- Node modules:
  - fs for file operations
  - path for path handling
  - dotenv for environment variable access
  - form-data for multipart form data creation
  - node-fetch for HTTP requests
  - ws for WebSocket connections
- Environment variables:
  - TRIPO for API key

## Identified Issues
- Hard-coded API endpoints and headers
- Limited error handling for API failures
- No input validation for image files
- Synchronous file operations in some cases
- Debugging flag (test) is globally defined
- No retry mechanism for API failures
- No rate limiting or quota management
- No caching of model results
- No structured logging
- Temporary file handling could be improved
- No option to customize model generation parameters

## Migration Plan
1. Create `src/core/models/`:
   - `service.js` - Core 3D model generation functionality
   - `validator.js` - Input validation logic
   - `types.js` - Data models and type definitions

2. Create `src/services/tripo3d/`:
   - `client.js` - Abstracted Tripo3D API client
   - `api.js` - API endpoint definitions
   - `ws-client.js` - WebSocket connection manager
   - `mapper.js` - Data structure transformation logic

3. Create `src/util/`:
   - `logging.js` - Structured logging functionality
   - `temp-files.js` - Temporary file management
   - `async-retry.js` - Retry functionality for API calls

4. Implement `src/api/models.js`:
   - Internal API for 3D model operations
   - Service-agnostic interfaces
   - Request/response validation

5. Suggested improvements:
   - Implement proper error handling with specific error types
   - Add validation for input images (format, size, content)
   - Create a more flexible parameter configuration system
   - Implement asynchronous file operations throughout
   - Add support for cancelable operations
   - Implement proper retry logic with exponential backoff
   - Add caching of results for frequently used images
   - Create a progress notification system
   - Add detailed logging for operation tracking
   - Implement rate limiting and quota management
   - Create a model preview and inspection UI helper 