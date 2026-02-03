# NOEMA API Reference

This document provides detailed API endpoint documentation for Claude agents integrating with NOEMA.

## Base URL

```
https://noema.art
```

## Authentication

### Public Endpoints (No Auth Required)
- Tool discovery
- LoRA listing
- Status checks

### Protected Endpoints (API Key Required)
- Generation execution
- Credit balance queries
- User-specific data

**Header Format:**
```
X-API-Key: {user_api_key}
```

---

## Tool Discovery

### List All Tools (Simplified)

```http
GET /api/v1/tools
```

Returns simplified tool information for quick browsing.

**Response:**
```json
[
  {
    "toolId": "dall-e-3-image",
    "displayName": "dalleiii",
    "description": "Generate images from text prompts using OpenAI's DALL·E 3 model.",
    "commandName": "/image",
    "costingModel": {
      "rateSource": "static",
      "staticCost": { "amount": 0.04, "unit": "run" }
    },
    "metadata": {
      "avgHistoricalDurationMs": 12000
    }
  }
]
```

### List All Tools (Full Registry)

```http
GET /api/v1/tools/registry
```

Returns complete tool definitions including input schemas.

**Response:**
```json
[
  {
    "toolId": "dall-e-3-image",
    "service": "openai",
    "version": "1.0.0",
    "displayName": "dalleiii",
    "description": "Generate images from text prompts using OpenAI's DALL·E 3 model.",
    "inputSchema": {
      "prompt": {
        "name": "prompt",
        "type": "string",
        "required": true,
        "description": "The text prompt describing the desired image."
      },
      "quality": {
        "name": "quality",
        "type": "enum",
        "required": false,
        "default": "standard",
        "enum": ["standard", "hd"],
        "description": "Desired quality tier."
      },
      "size": {
        "name": "size",
        "type": "enum",
        "required": false,
        "default": "1024x1024",
        "enum": ["1024x1024", "1024x1792", "1792x1024"]
      }
    },
    "outputSchema": {
      "image": {
        "name": "image",
        "type": "string",
        "description": "URL of the generated image."
      }
    },
    "costingModel": { ... },
    "deliveryMode": "async",
    "category": "text-to-image",
    "metadata": {
      "baseModel": "dall-e-3",
      "provider": "OpenAI"
    }
  }
]
```

### Get Single Tool

```http
GET /api/v1/tools/registry/{toolId}
```

**Parameters:**
- `toolId` (path): Tool identifier

**Response:** Single tool object (same structure as registry item)

---

## LoRA Discovery

### List LoRAs

```http
GET /api/v1/loras/list
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `checkpoint` | string | `All` | Filter by base model: `FLUX`, `SDXL`, `SD1.5`, `SD3`, `All` |
| `q` | string | - | Search query (searches name, description, tags) |
| `filterType` | string | `recent` | `popular`, `recent`, `favorites`, `type_category` |
| `category` | string | - | Filter by tag category |
| `limit` | number | 20 | Results per page |
| `page` | number | 1 | Page number |
| `sort` | string | `recent` | `recent`, `popular`, `rating_desc`, `price_asc` |

**Response:**
```json
{
  "loras": [
    {
      "_id": "abc123",
      "name": "Ghibli Style",
      "slug": "ghibli_style",
      "triggerWords": ["GHIBLI"],
      "cognates": [
        { "word": "studio ghibli", "replaceWith": "GHIBLI" }
      ],
      "description": "Apply Studio Ghibli anime aesthetic",
      "checkpoint": "SDXL",
      "defaultWeight": 0.8,
      "tags": ["style", "anime"],
      "previewImages": ["https://..."],
      "visibility": "public",
      "uses": 1523
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 20
}
```

### Get Single LoRA

```http
GET /api/v1/loras/{loraIdentifier}
```

**Parameters:**
- `loraIdentifier` (path): LoRA slug or MongoDB ObjectId

### List Categories

```http
GET /api/v1/loras/categories
```

Returns all available LoRA tag categories.

---

## Generation Execution

### Cast (Execute Generation)

```http
POST /api/v1/generation/cast
```

**Headers:**
```
X-API-Key: {api_key}
Content-Type: application/json
```

**Body:**
```json
{
  "toolId": "dall-e-3-image",
  "parameters": {
    "prompt": "A serene landscape with mountains",
    "quality": "hd",
    "size": "1024x1024"
  },
  "deliveryMode": "webhook"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `toolId` | string | Yes | Tool identifier from registry |
| `parameters` | object | Yes | Tool-specific parameters matching inputSchema |
| `deliveryMode` | string | No | `immediate`, `webhook`, `async` |
| `webhookUrl` | string | No | Callback URL for webhook delivery |

**Response (Async/Webhook):**
```json
{
  "generationId": "gen_abc123xyz",
  "status": "pending",
  "estimatedDuration": 15000,
  "createdAt": "2026-02-02T10:30:00Z"
}
```

**Response (Immediate):**
```json
{
  "generationId": "gen_abc123xyz",
  "status": "completed",
  "result": {
    "image": "https://storage.noema.ai/outputs/abc123.png"
  },
  "duration": 12500,
  "cost": {
    "amount": 0.04,
    "currency": "USD",
    "pointsDeducted": 120
  }
}
```

### Check Generation Status

```http
GET /api/v1/generation/status/{generationId}
```

**Headers:**
```
X-API-Key: {api_key}
```

**Response:**
```json
{
  "generationId": "gen_abc123xyz",
  "status": "completed",
  "progress": 100,
  "result": {
    "image": "https://storage.noema.ai/outputs/abc123.png"
  },
  "duration": 12500,
  "cost": {
    "amount": 0.04,
    "currency": "USD",
    "pointsDeducted": 120
  },
  "createdAt": "2026-02-02T10:30:00Z",
  "completedAt": "2026-02-02T10:30:12Z"
}
```

**Status Values:**

| Status | Description |
|--------|-------------|
| `pending` | Queued, waiting for worker |
| `processing` | Currently generating |
| `completed` | Done, result available |
| `failed` | Error occurred |
| `cancelled` | User cancelled |

---

## User & Credits

### Get Credit Balance

```http
GET /api/v1/points
```

**Headers:**
```
X-API-Key: {api_key}
```

**Response:**
```json
{
  "balance": 5000,
  "currency": "points",
  "usdEquivalent": 1.68
}
```

### Get User Info

```http
GET /api/v1/user/me
```

**Headers:**
```
X-API-Key: {api_key}
```

**Response:**
```json
{
  "userId": "user_abc123",
  "username": "creator",
  "email": "creator@example.com",
  "createdAt": "2025-06-15T00:00:00Z",
  "tier": "pro"
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing API key |
| `PAYMENT_REQUIRED` | 402 | Insufficient credits |
| `FORBIDDEN` | 403 | Access denied to resource |
| `NOT_FOUND` | 404 | Tool/LoRA/Generation not found |
| `VALIDATION_ERROR` | 400 | Invalid parameters |
| `RATE_LIMITED` | 429 | Too many requests |
| `BAD_GATEWAY` | 502 | Backend service unavailable |

---

## Rate Limits

| Endpoint Type | Limit |
|---------------|-------|
| Discovery (public) | 100 req/min |
| Generation (authenticated) | 30 req/min |
| Status polling | 120 req/min |

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1706871600
```

---

## Webhook Delivery

When using `deliveryMode: "webhook"`, results are POSTed to your `webhookUrl`:

```json
{
  "event": "generation.completed",
  "generationId": "gen_abc123xyz",
  "status": "completed",
  "result": {
    "image": "https://storage.noema.ai/outputs/abc123.png"
  },
  "duration": 12500,
  "timestamp": "2026-02-02T10:30:12Z"
}
```

**Webhook Signature:**
Requests include `X-Webhook-Signature` header for verification.
