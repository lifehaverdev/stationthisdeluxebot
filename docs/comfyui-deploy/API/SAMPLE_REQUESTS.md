# Sample API Requests

This document provides example API requests and responses for the ComfyUI Deploy API.

## Authentication

Before making any authenticated requests, you need to obtain an API key from the ComfyUI Deploy dashboard.

### Headers

Include your API key in the Authorization header:

```
Authorization: Bearer your_api_key_here
```

## Workflow Execution

### Creating a Run

**Request:**
```bash
curl -X POST https://your-comfydeploy-instance.com/api/run \
  -H "Authorization: Bearer your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "deployment_id": "12345678-1234-1234-1234-123456789012",
    "inputs": {
      "prompt": "a beautiful sunset over mountains",
      "seed": 42
    }
  }'
```

**Response:**
```json
{
  "run_id": "87654321-4321-4321-4321-210987654321"
}
```

### Getting Run Output

**Request:**
```bash
curl -X GET "https://your-comfydeploy-instance.com/api/run?run_id=87654321-4321-4321-4321-210987654321" \
  -H "Authorization: Bearer your_api_key_here"
```

**Response:**
```json
{
  "id": "87654321-4321-4321-4321-210987654321",
  "created_at": "2023-04-01T12:34:56.789Z",
  "updated_at": "2023-04-01T12:35:10.123Z",
  "status": "success",
  "workflow_inputs": {
    "prompt": "a beautiful sunset over mountains",
    "seed": 42
  },
  "workflow_outputs": {
    "images": [
      {
        "filename": "output_00001.png",
        "url": "https://your-storage-cdn.com/outputs/output_00001.png",
        "type": "image"
      }
    ]
  },
  "error": null
}
```

## File Upload

### Getting Upload URL

**Request:**
```bash
curl -X POST https://your-comfydeploy-instance.com/api/upload-url \
  -H "Authorization: Bearer your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "input_image.png",
    "content_type": "image/png"
  }'
```

**Response:**
```json
{
  "upload_url": "https://your-storage-service.com/presigned-url-for-upload",
  "file_url": "https://your-storage-cdn.com/uploads/input_image.png",
  "expires_at": "2023-04-01T13:34:56.789Z"
}
```

### Uploading the File

```bash
curl -X PUT "https://your-storage-service.com/presigned-url-for-upload" \
  -H "Content-Type: image/png" \
  --data-binary "@./path/to/your/input_image.png"
```

## Workflow Management

### Uploading a Workflow

**Request:**
```bash
curl -X POST https://your-comfydeploy-instance.com/api/workflow \
  -H "Authorization: Bearer your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Text to Image Workflow",
    "workflow": {
      "nodes": [...],
      "links": [...]
    }
  }'
```

**Response:**
```json
{
  "id": "12345678-1234-1234-1234-123456789012",
  "name": "My Text to Image Workflow",
  "version": 1,
  "created_at": "2023-04-01T12:00:00.000Z",
  "updated_at": "2023-04-01T12:00:00.000Z"
}
```

### Getting a Workflow Version

**Request:**
```bash
curl -X GET "https://your-comfydeploy-instance.com/api/workflow-version/12345678-1234-1234-1234-123456789012" \
  -H "Authorization: Bearer your_api_key_here"
```

**Response:**
```json
{
  "id": "12345678-1234-1234-1234-123456789012",
  "version": 1,
  "workflow": {
    "nodes": [...],
    "links": [...]
  },
  "created_at": "2023-04-01T12:00:00.000Z",
  "updated_at": "2023-04-01T12:00:00.000Z"
}
```

## Integration Example

Here's a complete example of using the API to run a workflow and get the results:

```javascript
// Example JavaScript code
async function runWorkflow() {
  const API_KEY = 'your_api_key_here';
  const API_BASE = 'https://your-comfydeploy-instance.com/api';
  
  // Step 1: Create a run
  const runResponse = await fetch(`${API_BASE}/run`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      deployment_id: '12345678-1234-1234-1234-123456789012',
      inputs: {
        prompt: 'a beautiful sunset over mountains',
        seed: 42
      }
    })
  });
  
  const { run_id } = await runResponse.json();
  console.log(`Run created with ID: ${run_id}`);
  
  // Step 2: Poll for results
  let complete = false;
  let result;
  
  while (!complete) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    
    const outputResponse = await fetch(`${API_BASE}/run?run_id=${run_id}`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });
    
    result = await outputResponse.json();
    
    if (['success', 'failed'].includes(result.status)) {
      complete = true;
    } else {
      console.log(`Current status: ${result.status}`);
    }
  }
  
  console.log('Final result:', result);
  
  if (result.status === 'success') {
    // Process output images
    const images = result.workflow_outputs.images;
    console.log(`Generated ${images.length} images:`);
    images.forEach(img => console.log(img.url));
  } else {
    console.error('Workflow failed:', result.error);
  }
}

runWorkflow().catch(console.error);
``` 