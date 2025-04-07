# iTrain.js Plan

## Current Purpose
`iTrain.js` handles all aspects of LoRA model training within the bot, including collection of training images, caption generation, training configuration, and model management. It allows users to create custom AI models by training on their own images or collections.

## Exported Functions/Classes
- **Training Flow Functions**:
  - `handleTraining(message)` - Main entry point for training
  - `startTrainingFlow(message, user)` - Starts the training flow
  - `resumeTrainingFlow(message, trainingId)` - Resumes interrupted training

- **Image Collection Functions**:
  - `handleImageCollection(message)` - Handles image collection
  - `addImageToTraining(message, image, training)` - Adds image to training set
  - `processCollectedImages(training)` - Processes collected images

- **Caption Management Functions**:
  - `handleCaptioning(message, training)` - Handles caption generation
  - `generateCaption(image, training)` - Generates caption for image
  - `updateCaption(trainingId, imageIndex, caption)` - Updates image caption

- **Training Configuration Functions**:
  - `setTrainingName(message, training)` - Sets training name
  - `setTrainingType(message, training)` - Sets training type
  - `setTrainingParameters(message, training)` - Sets training parameters
  - `validateTrainingConfig(training)` - Validates training configuration

- **Model Management Functions**:
  - `startTrainingJob(training)` - Starts the training job
  - `trackTrainingProgress(trainingId)` - Tracks training progress
  - `handleTrainingCompletion(training)` - Handles training completion
  - `listUserTrainings(message, userId)` - Lists user's trainings

- **UI Functions**:
  - `showTrainingMenu(message, user)` - Shows training menu
  - `showTrainingStatus(message, trainingId)` - Shows training status
  - `showTrainingDetail(message, trainingId)` - Shows training details
  - `buildTrainingUI(training)` - Builds training UI

## Dependencies and Integrations
- Telegram bot API for message handling and UI
- Database operations for training data storage
- External APIs for model training
- Image processing libraries
- Caption generation models
- File system operations for image storage
- Queue system for training jobs

## Identified Issues
- Telegram-specific UI mixed with core training logic
- Direct references to global state objects
- Complex workflows with many steps and states
- Mixed responsibilities: image collection, caption generation, training
- Hard-coded parameters and configurations
- Limited error handling for external service failures
- Training progress tracking tightly coupled with UI
- Lack of clear separation between data processing and user interaction

## Migration Plan
1. Create `src/core/training/`:
   - `model.js` - Core training data models
   - `service.js` - Business logic for training operations
   - `image.js` - Image collection and processing
   - `caption.js` - Caption generation and management
   - `config.js` - Training configuration and validation
   - `job.js` - Training job management and progress tracking

2. Create `src/integrations/telegram/training.js`:
   - Telegram-specific UI for training
   - Training flow management
   - Image collection from Telegram
   - Progress reporting UI

3. Implement `src/api/training.js`:
   - Internal API for training operations
   - Job management endpoints
   - Progress monitoring endpoints
   - Configuration endpoints

4. Create `src/core/model/`:
   - `repository.js` - Model storage and retrieval
   - `validator.js` - Model validation

5. Suggested improvements:
   - Implement a proper workflow engine for training steps
   - Create a job scheduler for long-running training jobs
   - Add robust error handling and recovery for external services
   - Implement proper logging and monitoring for training jobs
   - Create a storage abstraction for training data
   - Implement caching for frequently accessed data
   - Add validation for all user inputs
   - Create a clear separation between training configuration and execution 