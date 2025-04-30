# ComfyUI Deploy API Endpoints (Updated)

This document provides a comprehensive list of all available API endpoints in the ComfyUI Deploy platform, based on the official OpenAPI specification.

## Authentication

Authentication is handled via bearer tokens. Include the token in the Authorization header:

```
Authorization: Bearer your_api_key
```

API keys can be created in the ComfyUI Deploy dashboard under the API Keys section.

## Primary Endpoints

### Run Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/run/{run_id}` | Get run status and results |
| POST   | `/run/deployment/queue` | Queue a run with a deployment |
| POST   | `/run/deployment/sync` | Run synchronously with a deployment |
| POST   | `/run/deployment/stream` | Stream run results with a deployment |
| POST   | `/run/{run_id}/cancel` | Cancel a run |

### Workflow Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/workflows` | Get all workflows |
| GET    | `/workflow/{workflow_id}` | Get a specific workflow |
| PATCH  | `/workflow/{workflow_id}` | Update a workflow |
| DELETE | `/workflow/{workflow_id}` | Delete a workflow |
| POST   | `/workflow` | Create a new workflow |
| POST   | `/workflow/{workflow_id}/clone` | Clone a workflow |
| GET    | `/workflow/{workflow_id}/versions` | Get workflow versions |
| GET    | `/workflow/{workflow_id}/version/{version}` | Get a specific workflow version |
| GET    | `/workflow-version/{version}` | Get workflow version by ID |

### Deployment Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/deployments` | Get all deployments |
| POST   | `/deployment` | Create a deployment |
| GET    | `/deployment/{deployment_id}` | Get a specific deployment |
| PATCH  | `/deployment/{deployment_id}` | Update a deployment |
| DELETE | `/deployment/{deployment_id}` | Delete a deployment |
| POST   | `/deployment/{deployment_id}/deactivate` | Deactivate a deployment |

### Machine Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/machines` | Get all machines |
| GET    | `/machine/{machine_id}` | Get a specific machine |
| DELETE | `/machine/{machine_id}` | Delete a machine |
| POST   | `/machine/create` | Create a machine |
| POST   | `/machine/serverless` | Create a serverless machine |
| POST   | `/machine/custom` | Create a custom machine |

### File Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/file/upload` | Get upload URL for a file |
| POST   | `/file` | Add a file |
| POST   | `/file/{file_id}/rename` | Rename a file |
| GET    | `/assets` | List assets |
| POST   | `/assets/upload` | Upload an asset |
| GET    | `/assets/{asset_id}` | Get an asset |
| DELETE | `/assets/{asset_id}` | Delete an asset |

## Endpoint Details

### Run Execution

#### GET /run/{run_id}

Gets output from a workflow run.

**Path Parameters**:
- `run_id`: ID of the run to get output for

**Query Parameters**:
- `queue_position` (Optional): Get queue position information

**Response**: Workflow run data including status and outputs

#### POST /run/deployment/queue

Creates a new workflow execution run (asynchronously).

**Request Body**:
```json
{
  "deployment_id": "string",
  "inputs": {
    "key1": "value1",
    "key2": "value2"
  },
  "webhook_url": "string (optional)"
}
```

**Response**:
```json
{
  "run_id": "string"
}
```

#### POST /run/{run_id}/cancel

Cancels a running workflow execution.

**Path Parameters**:
- `run_id`: ID of the run to cancel

### Deployments

#### GET /deployments

Gets all deployments available to the current user.

**Query Parameters**:
- `environment` (Optional): Filter by environment
- `is_fluid` (Optional): Filter by fluid status

**Response**: Array of deployment objects

#### POST /deployment

Creates a new deployment.

**Request Body**:
```json
{
  "workflow_id": "string",
  "version_id": "string",
  "name": "string",
  "machine_id": "string"
}
```

**Response**: Created deployment object

### File Management

#### POST /file/upload

Get a pre-signed URL for file uploads.

**Request Body**:
```json
{
  "type": "string",
  "file_size": number
}
```

**Response**:
```json
{
  "upload_url": "string",
  "file_id": "string",
  "download_url": "string"
}
```

## Additional API Documentation

The OpenAPI documentation for the API is available at the `/api/doc` endpoint, which provides a more interactive way to explore the API. 