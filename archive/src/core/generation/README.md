# Generation Core Module

This module provides the core generation domain models and services for the application. It manages generation requests, tasks, and responses, following a clean architecture approach with separation of concerns.

## Components

### Models

- **`GenerationRequest`**: Represents a request to generate content with:
  - Prompt and negative prompt
  - Generation settings (width, height, batch size, etc.)
  - Input images for img2img or variations
  - Cost calculation and validation

- **`GenerationResponse`**: Represents a response from a generation request with:
  - Output image paths/URLs
  - Success/failure status
  - Error messages
  - Processing time and metadata

- **`GenerationTask`**: Represents a generation task in the system with:
  - Request and response data
  - Task status and lifecycle management
  - Timestamps for creation, processing, and completion

- **`GenerationStatus`**: Enum of task statuses (PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED)

### Services

- **`GenerationService`**: Business logic for generation operations such as:
  - Creating and managing tasks
  - Starting and completing task processing
  - Handling failures and cancellations
  - Batch operations and cleanup

### Repository

- **`GenerationRepository`**: Data access for generation tasks
  - Implements the generic Repository interface
  - Currently uses in-memory storage (will be replaced with database in future)
  - Provides task querying and lifecycle management

## Usage Examples

### Creating a Generation Task

```javascript
const { service, GenerationRequest } = require('./src/core/generation');
const pointsService = require('./src/core/points').service;

// Set up with points service for balance checking
const generationService = new service.constructor({ 
  pointsService 
});

// Create a generation request
const request = new GenerationRequest({
  userId: '123456789',
  type: 'MS3',
  prompt: 'A beautiful sunset over mountains',
  negativePrompt: 'blur, haze, low quality',
  settings: {
    width: 1024,
    height: 1024,
    steps: 30,
    cfg: 7,
    batch: 1
  }
});

// Create a generation task
const task = await generationService.createTask(request);
console.log(`Task created with ID: ${task.taskId}`);
```

### Processing a Task

```javascript
const { service, GenerationStatus } = require('./src/core/generation');

// Get next pending task
const pendingTask = await service.getNextPendingTask();

if (pendingTask) {
  try {
    // Mark as processing
    await service.startProcessingTask(pendingTask.taskId);
    
    // Perform the actual generation (placeholder for external API call)
    const result = await externalGenerationAPI.generate({
      prompt: pendingTask.request.prompt,
      // ...other parameters
    });
    
    // Complete the task
    await service.completeTask(pendingTask.taskId, {
      outputs: result.images,
      success: true,
      metadata: {
        seed: result.seed
      }
    });
  } catch (error) {
    // Handle failure
    await service.failTask(pendingTask.taskId, error.message);
  }
}
```

### Getting User Tasks

```javascript
const { service } = require('./src/core/generation');

// Get recent tasks for a user
const userTasks = await service.getTasksForUser('123456789', {
  limit: 5
});

// Display task information
userTasks.forEach(task => {
  console.log(`Task ${task.taskId}: ${task.status}`);
  if (task.response) {
    console.log(`Outputs: ${task.response.outputs.join(', ')}`);
  }
});
```

## Events

The generation module emits the following events through the event bus:

- **`generation:task-created`**: When a new generation task is created
- **`generation:task-updated`**: When a task's status is updated
- **`generation:task-deleted`**: When a task is deleted

You can subscribe to these events:

```javascript
const eventBus = require('./src/core/shared/events');

eventBus.subscribe('generation:task-created', (data) => {
  console.log(`New generation task created: ${data.taskId} for user ${data.userId}`);
});
```

## Integration with Points System

The generation module integrates with the points system to:

1. Check if users have sufficient points for generation
2. Deduct points when a task starts processing
3. Refund points if a task fails

To enable this integration, pass a `pointsService` instance when creating the `GenerationService`.

## Future Improvements

In future phases of the project, this module will:

1. Replace in-memory storage with database persistence
2. Add more sophisticated queuing and priority mechanisms
3. Support additional generation types and parameters
4. Implement batching and rate limiting for external API calls 