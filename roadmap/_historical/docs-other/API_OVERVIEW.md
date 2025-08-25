> Imported from docs/comfyui-deploy/API/API_OVERVIEW.md on 2025-08-21

# ComfyUI Deploy API Overview

ComfyUI Deploy offers a comprehensive REST API for managing workflows, machines, deployments, and runs. The API allows developers to programmatically interact with the platform, enabling workflow deployment, execution, and monitoring.

## Key API Areas

1. **Workflow Management** - Upload, retrieve, update, and delete ComfyUI workflows
2. **Deployment Management** - Create, configure, and manage workflow deployments
3. **Machine Management** - Register, configure, and monitor ComfyUI machines
4. **Execution Management** - Create and monitor workflow execution runs
5. **Authentication** - Secure API access with API keys and JWT authentication

The API follows RESTful principles and generally communicates using JSON format for both requests and responses. Most endpoints require authentication through either API keys or JWT tokens.

See [ENDPOINTS_LIST.md](./ENDPOINTS_LIST.md) for a detailed breakdown of all available endpoints. 