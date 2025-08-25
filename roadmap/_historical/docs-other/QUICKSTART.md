> Imported from docs/comfyui-deploy/API/QUICKSTART.md on 2025-08-21

# ComfyUI Deploy API Integration Quickstart

This guide helps you get started with the ComfyUI Deploy API integration.

## Prerequisites

1. Node.js v14+ installed
2. ComfyUI Deploy API key obtained from [https://www.comfydeploy.com/api-keys](https://www.comfydeploy.com/api-keys)

## Setup

1. Clone the repository:
   ```powershell
   git clone https://github.com/your-org/your-repo.git
   cd your-repo
   ```

2. Install dependencies:
   ```powershell
   npm install
   ```

3. Create a `.env` file in the project root:
   ```
   COMFY_DEPLOY_API_KEY=your_api_key_here
   COMFY_DEPLOY_API_URL=https://api.comfydeploy.com
   WEBHOOK_URL=http://localhost:3000/api/webhook
   ```

## Running the Demo

The project includes demonstration scripts to test the API integration:

### API Integration Demo

Shows how to fetch workflows, deployments, and machines:

```powershell
node run-demo.js api
```

### Workflow Execution Demo

Shows how to execute workflows and retrieve results:

```powershell
node run-demo.js workflow
```

### API Exploration Mode

Tests API connectivity and identifies working endpoints:

```powershell
node run-demo.js api --explore
```

## Using the Services in Your Code

### WorkflowsService

```javascript
const WorkflowsService = require('./src/core/services/workflows');

// Initialize the service
const workflows = new WorkflowsService({
  apiUrl: process.env.COMFY_DEPLOY_API_URL,
  apiKey: process.env.COMFY_DEPLOY_API_KEY
});

// Get all workflows
const allWorkflows = await workflows.getWorkflows();

// Get a specific workflow by name
const workflow = await workflows.getWorkflowByName('text2img');

// Get deployment details
const deployment = await workflows.getDeploymentById(deploymentId);
```

### ComfyUIService

```javascript
const ComfyUIService = require('./src/core/services/comfyui');

// Initialize the service
const comfyui = new ComfyUIService({
  apiUrl: process.env.COMFY_DEPLOY_API_URL,
  apiKey: process.env.COMFY_DEPLOY_API_KEY
});

// Submit a workflow execution request
const runId = await comfyui.submitRequest({
  deploymentId: deploymentId,
  inputs: {
    prompt: "a beautiful landscape",
    negative_prompt: "ugly, blurry"
  }
});

// Check execution status
const status = await comfyui.checkStatus(runId);

// Get the results when complete
const results = await comfyui.getResults(runId);
```

## Next Steps

After exploring the demo, you can:

1. Read the [Database-Free Implementation](DATABASE_FREE_IMPLEMENTATION.md) documentation
2. Check the [API Testing Notes](API_TESTING_NOTES.md) for behavior details
3. Review the [API Endpoints List](OPENAPI_ENDPOINTS_LIST.md) for comprehensive API reference

## Troubleshooting

If you encounter issues:

1. **API Key Problems**: Ensure your API key is valid and correctly added to the `.env` file
2. **Connection Issues**: Check if the API URL is correct and your network can reach it
3. **Endpoint Errors**: Some endpoints require the `/api` prefix - check the error response
4. **Webhook Issues**: The webhook URL must be publicly accessible from the internet

For API-specific errors, see the error message returned by the API or check the [ComfyUI Deploy documentation](https://www.comfydeploy.com/docs). 