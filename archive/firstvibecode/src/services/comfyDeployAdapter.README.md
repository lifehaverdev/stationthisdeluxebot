# ComfyDeploy Service Adapter

This service adapter integrates ComfyDeploy with our internal API, providing a standardized interface for image generation, upscaling, background removal, and more using various AI models.

## Overview

The ComfyDeploy adapter is a black-box wrapper around the ComfyDeploy API service. It allows our application to use ComfyDeploy's powerful generation capabilities through our standardized service adapter interface, making it compatible with any interface that uses our internal API.

Key features:

- **Multiple Workflows Support**: Works with various generation workflows (txt2img, img2img, upscale, etc.)
- **Database-Driven Workflows**: Loads workflow configurations from the database, enabling updates without code changes
- **Cost Estimation**: Calculates point costs based on generation type and settings
- **Webhook Integration**: Processes asynchronous status updates from ComfyDeploy
- **Event-Driven Architecture**: Emits events for tracking generation progress and results
- **Interface Agnostic**: Same service can be used from Telegram, Web, or any other interface

## Supported Generation Types

The adapter supports multiple generation types through different ComfyDeploy workflows:

- `DEFAULT`: Standard text-to-image generation
- `FLUX`: Enhanced text-to-image generation
- `I2I`: Image-to-image transformation
- `INPAINT`: Image inpainting/editing
- `UPSCALE`: Image upscaling
- `RMBG`: Background removal
- `ANIME`: Anime-style generation
- `QR`: QR code stylization
- `ANIM`: Image animation
- `VIDEO`: Video generation

Additional workflows are dynamically loaded from the database.

## Usage

### Registration with Internal API

```javascript
// Register the service with database-driven workflows
const result = await internalAPI.registerService({
  name: 'comfydeploy',
  type: 'ComfyDeploy',
  config: {
    apiKey: process.env.COMFY_DEPLOY_API_KEY,
    baseUrl: process.env.COMFY_DEPLOY_BASE_URL,
    webhookUrl: process.env.COMFY_DEPLOY_WEBHOOK_URL,
    // No need to specify workflows - they will be loaded from the database
    workflowReloadInterval: 3600000, // Reload workflows every hour (optional)
    defaultSettings: {
      WIDTH: 1024,
      HEIGHT: 1024,
      STEPS: 30,
      CFG: 7
    }
  }
});
```

### Executing a Generation

```javascript
// Execute the service
const result = await internalAPI.executeService('comfydeploy', {
  type: 'DEFAULT', // Use any workflow name from the database
  prompt: 'a beautiful mountain landscape at sunset',
  settings: {
    width: 1024,
    height: 768,
    steps: 30,
    seed: -1
  }
}, {
  userId: 'user123'
});

// Result contains taskId and runId for status tracking
console.log(`Task ID: ${result.result.taskId}`);
console.log(`Run ID: ${result.result.runId}`);
```

### Checking Status

```javascript
// Get the service from the registry
const serviceRegistry = require('../services/registry').ServiceRegistry.getInstance();
const comfyAdapter = serviceRegistry.get('comfydeploy');

// Check status
const status = await comfyAdapter.checkStatus(taskId);

if (status.isComplete && status.status === 'completed') {
  console.log('Generation completed!');
  console.log('Output URLs:', status.result.outputs);
}
```

### Working with Webhooks

```javascript
// In your API webhook route
app.post('/api/webhooks/comfydeploy', (req, res) => {
  const { handleWebhookRequest } = require('../../core/webhook/comfyDeployHandler');
  handleWebhookRequest(req, res);
});
```

## Database Workflow Configuration

### Workflow DB Schema

Workflows are stored in the database with the following structure:

```javascript
{
  flows: [
    {
      name: "WORKFLOW_NAME",
      ids: ["deployment-id-1", "deployment-id-2"], // Multiple IDs for load balancing
      layout: "{\"nodes\":[...]}",  // Stringified JSON of the workflow layout
      active: true                  // Whether this workflow is active
    },
    // More workflows...
  ]
}
```

### Workflow Layout Structure

The layout JSON contains the workflow structure, including nodes with input parameters:

```javascript
{
  "nodes": [
    {
      "type": "ComfyUIDeploy",
      "widgets_values": [
        "input_prompt",
        "input_negative_prompt",
        "input_width",
        "input_height",
        "input_steps",
        "input_seed"
      ]
    }
  ]
}
```

### Adding Workflows to Database

Use the following pattern to add or update workflows:

```javascript
const WorkflowDB = require('../../db/models/workflows');

async function addWorkflow(name, deploymentIds, inputs) {
  const workflowDB = new WorkflowDB();
  
  // Create node structure
  const workflowLayout = {
    nodes: [
      {
        type: 'ComfyUIDeploy',
        widgets_values: inputs.map(input => `input_${input}`)
      }
    ]
  };
  
  // Create workflow object
  const newWorkflow = {
    name,
    ids: deploymentIds,
    layout: JSON.stringify(workflowLayout),
    active: true
  };
  
  // Check if document exists
  const existingDoc = await workflowDB.findOne();
  
  if (existingDoc) {
    // Update existing document
    await workflowDB.updateOne(
      { _id: existingDoc._id },
      { $push: { flows: newWorkflow } }
    );
  } else {
    // Create new document
    await workflowDB.create({
      flows: [newWorkflow]
    });
  }
}
```

### Manually Reloading Workflows

You can force a workflow reload from the database:

```javascript
// Get the ComfyDeploy adapter
const serviceRegistry = require('../services/registry').ServiceRegistry.getInstance();
const comfyAdapter = serviceRegistry.get('comfydeploy');

// Reload workflows
await comfyAdapter.reloadWorkflows();
```

## Configuration

### Environment Variables

- `COMFY_DEPLOY_API_KEY`: API key for ComfyDeploy service
- `COMFY_DEPLOY_BASE_URL`: Base URL for the ComfyDeploy API
- `COMFY_DEPLOY_WEBHOOK_URL`: Webhook URL for receiving generation updates

## Cost Calculation

Costs are calculated based on the generation type and settings:

1. Base cost is determined by the generation type (e.g., DEFAULT: 10, UPSCALE: 8, VIDEO: 30)
2. Multipliers are applied based on resolution (larger images cost more)
3. Batch size affects cost proportionally

## Implementation Details

The adapter implements the following ServiceAdapter interface methods:

- `init()`: Initializes the service with configuration
- `execute(params, context)`: Executes a generation request
- `getEstimatedCost(params)`: Calculates the cost of a request
- `validateParams(params)`: Validates request parameters
- `checkStatus(taskId)`: Checks the status of a generation
- `processWebhook(webhookPayload)`: Processes webhook updates
- `cancelTask(taskId)`: Cancels an in-progress generation
- `reloadWorkflows()`: Reloads workflows from the database

## Event Handling

The adapter forwards events from the underlying ComfyDeployService:

- `task:created`: Emitted when a task is created
- `generation:completed`: Emitted when a generation completes successfully
- `generation:failed`: Emitted when a generation fails

## Examples

See the following files for usage examples:

- `examples/comfyDeploy-usage.js`: Basic usage example
- `examples/comfyDeploy-db-workflows.js`: Database-driven workflow example
- `tests/webhook-test.js`: Webhook testing example

## Integrating with Interfaces

### Web Interface

```javascript
// In a React component
async function generateImage() {
  // Fetch available workflows from API
  const workflowsResponse = await fetch('/api/services/comfydeploy/metadata');
  const workflowsData = await workflowsResponse.json();
  
  // Use a workflow from the list
  const selectedWorkflow = workflowsData.availableWorkflows[0];
  
  const response = await fetch('/api/services/comfydeploy/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      userId: user.id,
      params: {
        type: selectedWorkflow,
        prompt: promptText,
        settings: {
          width: 1024,
          height: 1024
        }
      }
    })
  });
  
  const result = await response.json();
  
  // Start polling for status or wait for webhook
  setTaskId(result.result.taskId);
}
```

### Telegram Interface

```javascript
// In a Telegram command handler
async function handleGenerateCommand(msg) {
  // Extract prompt from message
  const prompt = msg.text.replace('/generate', '').trim();
  
  // Call internal API
  const result = await internalAPI.executeService('comfydeploy', {
    type: 'DEFAULT',
    prompt
  }, {
    userId: msg.from.id
  });
  
  // Send initial response
  bot.sendMessage(msg.chat.id, `Generation started! This may take up to ${result.result.timeEstimate} seconds.`);
  
  // Task ID will be used by webhook to notify user when complete
}
``` 