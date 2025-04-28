# ComfyUI Deploy API Endpoints

This document provides a comprehensive list of all available API endpoints in the ComfyUI Deploy platform, categorized by their source and confidence level.

## Authentication

Authentication is handled via JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer your_jwt_token
```

JWT tokens can be created in the ComfyUI Deploy dashboard under `/api-keys`.

## Endpoints by Category

### Statically Confirmed Endpoints

These endpoints are confirmed through explicit declarations in the codebase:

| Method | Endpoint | Description | Source File |
|--------|----------|-------------|------------|
| GET    | `/api/run` | Get workflow run output | registerGetOutputRoute.ts |
| POST   | `/api/run` | Run a workflow via deployment_id | registerCreateRunRoute.ts |
| GET    | `/api/upload-url` | Generate a pre-signed URL for file uploads | registerUploadRoute.ts |
| POST   | `/api/workflow` | Upload a workflow definition | registerWorkflowUploadRoute.ts |
| GET    | `/api/workflow-version/:id` | Get workflow version by ID | registerGetWorkflow.ts |
| GET    | `/api/auth-response/:request_id` | Get an API Key with code | registerGetAuthResponse.ts |

### Dynamically Registered Endpoints

These endpoints are registered dynamically or were detected through more complex patterns:

| Method | Endpoint | Description | Registration |
|--------|----------|-------------|-------------|
| OPTIONS | `/api/*` | CORS pre-flight requests for all API routes | App Router |
| POST   | `/api/update-run` | Update the status of a workflow run | NextJS route handler |

### Manual Additions

These endpoints were manually documented or confirmed through additional sources:

| Method | Endpoint | Description | Source |
|--------|----------|-------------|--------|
| GET    | `/api-key` | List API keys | curdApiKeys.ts |
| POST   | `/api-key` | Create an API key | curdApiKeys.ts |
| DELETE | `/api-key/:id` | Delete an API key | curdApiKeys.ts |
| GET    | `/deployment` | List deployments | curdDeploments.ts |
| POST   | `/deployment` | Create a deployment | curdDeploments.ts | 
| DELETE | `/deployment/:id` | Delete a deployment | curdDeploments.ts |
| PUT    | `/deployment/:id` | Update a deployment | curdDeploments.ts |
| POST   | `/file` | File upload endpoint | internal_api |
| GET    | `/internal` | Internal API documentation | internal_api |
| GET    | `/machine` | List registered machines | curdMachine.ts |
| POST   | `/machine` | Register a new machine | curdMachine.ts |
| DELETE | `/machine/:id` | Delete a machine | curdMachine.ts |
| PUT    | `/machine/:id` | Update a machine | curdMachine.ts |
| POST   | `/volume/model` | Volume model endpoint | internal_api |

## API Endpoint Details

### Workflow Execution

#### GET /api/run

Gets output from a workflow run.

**Authentication**: Required

**Query Parameters**:
- `run_id`: ID of the run to get output for

**Response (200)**: Workflow run data including status and outputs
```json
{
  "id": "string",
  "created_at": "string",
  "updated_at": "string",
  "status": "string",
  "workflow_inputs": {
    "input_text": "some external text input",
    "input_image": "https://somestatic.png"
  },
  "workflow_outputs": {},
  "error": null
}
```

#### POST /api/run

Creates a new workflow execution run.

**Authentication**: Required

**Request Body**:
```json
{
  "deployment_id": "string",
  "inputs": {
    "key1": "value1",
    "key2": "value2"
  }
}
```

- `deployment_id`: ID of the deployment to run
- `inputs`: (Optional) Key-value pairs of inputs to the workflow

**Response (200)**:
```json
{
  "run_id": "string"
}
```

### File Management

#### GET /api/upload-url

Generates a pre-signed URL for file uploads.

**Authentication**: Required

**Query Parameters**:
- `type`: File MIME type (e.g., "image/png", "image/jpeg")
- `file_size`: Size of file in bytes

**Response (200)**:
```json
{
  "upload_url": "string",
  "file_id": "string",
  "download_url": "string"
}
```

### Workflow Management

#### POST /api/workflow

Uploads a workflow definition.

**Authentication**: Required

**Request Body**:
```json
{
  "workflow_id": "string (optional)",
  "workflow_name": "string (optional)",
  "workflow": "object",
  "workflow_api": "object",
  "snapshot": "object"
}
```

**Response (200)**:
```json
{
  "workflow_id": "string",
  "version": "string"
}
```

#### GET /api/workflow-version/:id

Gets a specific version of a workflow.

**Authentication**: Required

**Path Parameters**:
- `id`: ID of the workflow version to retrieve

## Additional API Documentation

The OpenAPI documentation for the API is available at the `/api/doc` endpoint, which provides a more interactive way to explore the API. 