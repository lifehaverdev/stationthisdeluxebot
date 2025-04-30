# ComfyUI Deploy Integration Demo Scripts

This project contains demo scripts to test and demonstrate the integration with ComfyUI Deploy API, which has been updated to use the correct endpoints from the official OpenAPI specification.

## Available Demo Scripts

1. **API Integration Demo** (`demo-comfyui-api.js`)
   - Demonstrates connectivity to ComfyUI Deploy API
   - Lists available workflows, deployments, and machines
   - Shows how to simulate workflow submission
   - Tests the updated API endpoints

2. **Workflow Execution Demo** (`demo-workflow-execution.js`)
   - Shows how to search for workflows
   - Demonstrates running a workflow execution
   - Tracks progress and displays results
   - Supports simulation or actual execution

## Prerequisites

- Node.js installed (v14+)
- ComfyUI Deploy API key
- Access to ComfyUI Deploy API

## Running the Demos

### Using PowerShell Scripts (Recommended)

We've included PowerShell scripts to make running the demos easier:

#### API Integration Demo

```powershell
.\run-comfyui-demo.ps1 -ApiKey "your-api-key" [-ApiUrl "https://custom-api-url"]
```

#### Workflow Execution Demo

```powershell
.\run-workflow-demo.ps1 -ApiKey "your-api-key" -Workflow "text2img" -Prompt "your prompt" -Execute $false
```

Parameters:
- `ApiKey`: Your ComfyUI Deploy API key (required)
- `ApiUrl`: Custom API URL (optional, defaults to https://api.comfydeploy.com)
- `Workflow`: Workflow name pattern to search for (optional, defaults to "text2img")
- `Prompt`: Prompt text to use for generation (optional)
- `Execute`: Set to $true to perform actual execution, or $false for simulation (optional, defaults to $false)

### Manual Execution

If you prefer to run the scripts directly:

```bash
# Set environment variables
$env:COMFY_DEPLOY_API_KEY = "your-api-key"
$env:COMFY_DEPLOY_API_URL = "https://api.comfydeploy.com"  # Optional

# Run API integration demo
node demo-comfyui-api.js

# Run workflow execution demo
node demo-workflow-execution.js --workflow="text2img" --prompt="your prompt" --execute=false
```

## API Endpoints

The demo scripts use the following updated ComfyUI Deploy API endpoints:

- `/run/deployment/queue` - Queue a workflow run
- `/run/{run_id}` - Check run status
- `/run/{run_id}/cancel` - Cancel a run
- `/deployments` - List deployments
- `/workflows` - List workflows
- `/machines` - List machines
- `/file/upload` - File upload endpoint

## Troubleshooting

If you encounter issues:

1. Verify your API key has the correct permissions
2. Check if the API URL is correct
3. Ensure you have network access to the ComfyUI Deploy API
4. Try running the API integration demo first to verify connectivity
5. Look at the detailed logs for specific error messages

## Next Steps

After verifying that the integration works:

1. Try running actual workflow executions with `-Execute $true`
2. Test more complex workflows with different inputs
3. Integrate the updated API client into your application 