# ComfyDeployService

A platform-agnostic service for generating images through the ComfyDeploy API. This service is part of the core generation system and provides a clean, testable interface for requesting image generation.

## Overview

The ComfyDeployService accepts structured prompt inputs, sends generation requests to the ComfyDeploy API, and returns run IDs for downstream tracking. It is designed to be:

- **Platform-agnostic**: No coupling with Telegram or any other platform
- **Testable**: Clean composition with dependency injection
- **Event-driven**: Uses EventEmitter for tracking progress and status changes
- **Adaptable**: Supports various generation types and workflows

## Architecture

The service is composed of several key components:

1. **ComfyDeployService** - The main service that orchestrates the generation process
2. **PromptBuilder** - Handles prompt construction and preprocessing
3. **ComfyClient** - Manages API communication with ComfyDeploy
4. **ComfyTaskMapper** - Maps API responses to internal domain models

## Usage

### Basic Usage

```javascript
const { ComfyDeployService } = require('./services/comfydeploy');

// Create service with workflows
const service = new ComfyDeployService({
  workflows: [
    {
      name: 'FLUX',
      ids: ['flux-deployment-id'],
      inputs: {
        prompt: '',
        negative_prompt: '',
        width: 1024,
        height: 1024
      }
    }
  ]
});

// Generate an image
const result = await service.generate(
  {
    userId: 'user123',
    type: 'FLUX',
    prompt: 'a beautiful landscape',
    settings: {
      width: 1024,
      height: 1024,
      seed: -1
    }
  },
  {
    userId: 'user123',
    username: 'johndoe',
    balance: 1000
  }
);

// Result contains runId for status tracking
console.log(`Generation started with run ID: ${result.runId}`);

// Check status
const status = await service.checkStatus(result.runId);
```

### Event Handling

```javascript
// Listen for events
service.on('task:created', (task) => {
  console.log(`Task created: ${task.taskId}`);
});

service.on('generation:completed', (data) => {
  console.log(`Generation completed: ${data.run_id}`);
  console.log(`Outputs: ${data.outputs.join(', ')}`);
});

service.on('generation:failed', (data) => {
  console.error(`Generation failed: ${data.error}`);
});
```

### Webhook Processing

```javascript
// In your webhook handler
app.post('/api/webhook', (req, res) => {
  const webhookPayload = req.body;
  
  // Process webhook
  const result = service.processWebhook(webhookPayload);
  
  // Handle result (service already emits appropriate events)
  if (result.isSuccessful()) {
    // Do something with the outputs
    console.log(`Generation successful: ${result.outputs.join(', ')}`);
  }
  
  res.status(200).json({ success: true });
});
```

## Key Features

- **LoRA Trigger Processing**: Supports LoRA trigger words via the PromptBuilder
- **Deployment Selection**: Selects appropriate deployment IDs for different generation types
- **Error Handling**: Comprehensive error handling with retries for API requests
- **Webhooks**: First-class support for webhook-based status updates
- **Status Mapping**: Unified status codes across different API responses
- **Testability**: Designed for easy mocking and testing

## Differences from Legacy Implementation

- **No Global State**: Uses dependency injection instead of global arrays
- **Platform Independence**: No direct Telegram integration
- **Clean Separation**: Distinct components with single responsibilities
- **Event-Driven**: Events for tracking progress instead of polling
- **Error Handling**: Comprehensive error handling with typed AppError objects
- **Immutable Data**: Data models with validation and immutable state

## Testing

The service includes comprehensive tests that verify its functionality:

```bash
npm test -- src/services/comfydeploy
``` 