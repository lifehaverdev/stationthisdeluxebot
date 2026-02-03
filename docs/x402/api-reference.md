# x402 API Reference

**Base URL**: `/api/v1/x402`

## Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/quote` | Get cost estimate for a tool | None |
| GET | `/tools` | List available tools with pricing | None |
| POST | `/generate` | Execute a tool with payment | x402 |
| GET | `/status/:generationId` | Poll generation status | None |

---

## GET /quote

Get a cost estimate for executing a tool.

### Request

```http
GET /api/v1/x402/quote?toolId=chatgpt-free&model=gpt-4
```

**Query Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| toolId | string | Yes | Tool identifier |
| model | string | No | Model variant (for tools with multiple) |
| size | string | No | Size parameter (e.g., "1024x1024") |
| quality | string | No | Quality tier (e.g., "hd") |

### Response

```json
{
  "toolId": "chatgpt-free",
  "baseCostUsd": 0.01,
  "markupUsd": 0.002,
  "totalCostUsd": 0.012,
  "totalCostAtomic": "12000",
  "currency": "USDC",
  "network": "eip155:8453",
  "payTo": "0x428Bea9Fd786659c84b0bD62D372bb4a482aF653"
}
```

**Fields**:
| Field | Type | Description |
|-------|------|-------------|
| baseCostUsd | number | Raw provider cost |
| markupUsd | number | Platform markup (20%) |
| totalCostUsd | number | Total cost in USD |
| totalCostAtomic | string | Cost in USDC atomic units (6 decimals) |
| network | string | CAIP-2 network identifier |
| payTo | string | Payment receiver address |

---

## GET /tools

List all available tools with pricing information.

### Request

```http
GET /api/v1/x402/tools
```

### Response

```json
{
  "tools": [
    {
      "toolId": "chatgpt-free",
      "displayName": "ChatGPT",
      "description": "OpenAI GPT-3.5 chat completion",
      "category": "text",
      "baseCostUsd": 0.01,
      "totalCostUsd": 0.012
    },
    {
      "toolId": "dalle-3",
      "displayName": "DALL-E 3",
      "description": "OpenAI image generation",
      "category": "image",
      "baseCostUsd": 0.04,
      "totalCostUsd": 0.048
    }
  ],
  "network": "eip155:8453",
  "payTo": "0x428Bea9Fd786659c84b0bD62D372bb4a482aF653",
  "currency": "USDC"
}
```

---

## POST /generate

Execute a tool with x402 payment.

### Request (Without Payment)

```http
POST /api/v1/x402/generate
Content-Type: application/json

{
  "toolId": "chatgpt-free",
  "inputs": {
    "prompt": "Hello, world!"
  }
}
```

### Response (402 Payment Required)

```http
HTTP/1.1 402 Payment Required
X-PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Mn0=

{
  "error": "PAYMENT_REQUIRED",
  "message": "Payment required to execute this tool",
  "paymentRequired": {
    "x402Version": 2,
    "resource": {
      "url": "http://localhost:4000/api/v1/x402/generate",
      "description": "ChatGPT execution",
      "mimeType": "application/json"
    },
    "accepts": [{
      "scheme": "exact",
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "12000",
      "payTo": "0x428Bea9Fd786659c84b0bD62D372bb4a482aF653",
      "maxTimeoutSeconds": 300,
      "extra": {
        "name": "USD Coin",
        "version": "2"
      }
    }]
  },
  "quote": {
    "baseCostUsd": 0.01,
    "markupUsd": 0.002,
    "totalCostUsd": 0.012
  }
}
```

### Request (With Payment)

```http
POST /api/v1/x402/generate
Content-Type: application/json
X-PAYMENT: eyJ4NDAyVmVyc2lvbiI6MiwicGF5bG9hZCI6ey4uLn19

{
  "toolId": "chatgpt-free",
  "inputs": {
    "prompt": "Hello, world!"
  },
  "delivery": {
    "mode": "poll"
  }
}
```

**Headers**:
| Header | Type | Required | Description |
|--------|------|----------|-------------|
| X-PAYMENT | string | Yes | Base64-encoded payment payload |

**Body Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| toolId | string | Yes | Tool to execute |
| inputs | object | Yes | Tool-specific inputs |
| delivery | object | No | Delivery preferences |
| delivery.mode | string | No | "poll" (default) or "webhook" |
| delivery.url | string | No | Webhook URL (required if mode=webhook) |
| delivery.secret | string | No | Webhook signing secret |

**Delivery Modes**:

| Mode | Description | Best For |
|------|-------------|----------|
| `poll` | Returns immediately, use `/status` endpoint to poll | Simple integrations, testing |
| `webhook` | Sends HTTP POST to your URL when complete | Production integrations |

> **Note on Webhook Delivery**: For async tools (ComfyUI, Flux, etc.), webhooks only receive the **final result** (completed/failed). Intermediate progress updates (queued, running, uploading) are NOT sent to webhooks. Use polling for progress tracking.

### Response (200 Success)

```http
HTTP/1.1 200 OK
X-PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJ0cmFuc2FjdGlvbiI6IjB4Li4uIn0=

{
  "generationId": "69821ce536d6148ae2b1a9cc",
  "status": "completed",
  "final": true,
  "outputs": {
    "type": "text",
    "data": {
      "text": ["Hello! How can I assist you today?"]
    }
  },
  "toolId": "chatgpt-free",
  "service": "openai",
  "costUsd": 0.000023,
  "response": "Hello! How can I assist you today?",
  "x402": {
    "settled": true,
    "transaction": "0x73ca7f5ff04a7d32deb4f52c3b72cb7b7c130f1be35d70475173bb35684ddc0f",
    "network": "eip155:8453",
    "payer": "0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6",
    "costUsd": 0.012
  }
}
```

**Response Fields**:
| Field | Type | Description |
|-------|------|-------------|
| generationId | string | Unique generation identifier |
| status | string | "completed", "processing", or "failed" |
| final | boolean | Whether execution is complete |
| outputs | object | Tool output data |
| x402.settled | boolean | Whether payment was settled on-chain |
| x402.transaction | string | On-chain transaction hash |
| x402.network | string | Network where settled |
| x402.payer | string | Payer wallet address |
| x402.costUsd | number | Amount charged |

### Response (202 Accepted - Async)

For async tools (ComfyUI, etc.):

```json
{
  "generationId": "69821ce536d6148ae2b1a9cc",
  "status": "processing",
  "runId": "run_abc123",
  "toolId": "flux-dev",
  "queuedAt": "2026-02-03T16:05:55.000Z",
  "message": "Your request has been accepted and is being processed.",
  "x402": {
    "settled": true,
    "transaction": "0x...",
    "payer": "0x1821BD18..."
  }
}
```

---

## GET /status/:generationId

Poll the status of an async generation.

### Request

```http
GET /api/v1/x402/status/69821ce536d6148ae2b1a9cc
```

### Response (Processing)

```json
{
  "generationId": "69821ce536d6148ae2b1a9cc",
  "status": "processing",
  "toolId": "flux-dev",
  "createdAt": "2026-02-03T16:05:55.000Z",
  "updatedAt": "2026-02-03T16:05:55.000Z"
}
```

### Response (Completed)

```json
{
  "generationId": "69821ce536d6148ae2b1a9cc",
  "status": "completed",
  "toolId": "flux-dev",
  "createdAt": "2026-02-03T16:05:55.000Z",
  "updatedAt": "2026-02-03T16:06:23.000Z",
  "outputs": {
    "type": "image",
    "data": {
      "images": [
        { "url": "https://cdn.example.com/output.png" }
      ]
    }
  }
}
```

### Response (Failed)

```json
{
  "generationId": "69821ce536d6148ae2b1a9cc",
  "status": "failed",
  "toolId": "flux-dev",
  "createdAt": "2026-02-03T16:05:55.000Z",
  "updatedAt": "2026-02-03T16:06:23.000Z",
  "error": {
    "message": "GPU timeout exceeded"
  }
}
```

---

## Error Responses

### 400 Bad Request

```json
{
  "error": "BAD_REQUEST",
  "message": "toolId is required"
}
```

### 402 Payment Required

```json
{
  "error": "PAYMENT_REQUIRED",
  "message": "Payment required to execute this tool",
  "paymentRequired": { ... }
}
```

### 402 Insufficient Payment

```json
{
  "error": "INSUFFICIENT_PAYMENT",
  "message": "Payment of $0.01 is less than required $0.012",
  "required": 0.012,
  "provided": 0.01,
  "paymentRequired": { ... }
}
```

### 400 Payment Already Used

```json
{
  "error": "PAYMENT_ALREADY_USED",
  "message": "This payment signature has already been used"
}
```

### 404 Tool Not Found

```json
{
  "error": "TOOL_NOT_FOUND",
  "message": "Tool dalle-4 not found"
}
```

### 500 Execution Failed

```json
{
  "error": "EXECUTION_FAILED",
  "message": "Generation failed. Payment was not charged.",
  "details": {
    "error": { "code": "PROVIDER_ERROR", "message": "OpenAI API error" }
  }
}
```

---

## X-PAYMENT Header Format

The payment header contains a base64-encoded JSON payload:

```javascript
// Decoded structure
{
  "x402Version": 2,
  "payload": {
    "authorization": {
      "from": "0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6",
      "to": "0x428Bea9Fd786659c84b0bD62D372bb4a482aF653",
      "value": "12000",
      "validAfter": "1770134155",
      "validBefore": "1770135055",
      "nonce": "0x01b9f3202b6e8c8083762c1b0c017adcf109eeaed10f28213cacb4ba85c851fc"
    },
    "signature": "0x9d162e611884742607f8a6d727622150b0b3b7e2c0a8f13fd3223d7288a2550e..."
  },
  "resource": {
    "url": "http://localhost:4000/api/v1/x402/generate",
    "description": "ChatGPT execution",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "exact",
    "network": "eip155:8453",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "12000",
    "payTo": "0x428Bea9Fd786659c84b0bD62D372bb4a482aF653",
    "maxTimeoutSeconds": 300,
    "extra": {
      "name": "USD Coin",
      "version": "2"
    }
  }
}
```

Use `@x402/evm` to create properly signed payments:

```javascript
import { createPaymentHeader } from '@x402/evm';

const header = await createPaymentHeader(
  signer,           // Ethers wallet or viem account
  paymentRequired,  // From 402 response
  { scheme: 'exact' }
);
// Returns base64-encoded string for X-PAYMENT header
```

---

## Webhook Delivery

When using `delivery.mode: "webhook"`, the server will send an HTTP POST to your specified URL when the generation completes.

### Webhook Request Format

```http
POST {your-webhook-url}
Content-Type: application/json
X-Webhook-Signature: sha256=abc123...

{
  "generationId": "69821ce536d6148ae2b1a9cc",
  "status": "completed",
  "toolId": "flux-dev",
  "outputs": {
    "type": "image",
    "data": {
      "images": [
        { "url": "https://cdn.example.com/output.png" }
      ]
    }
  },
  "costUsd": 0.036,
  "completedAt": "2026-02-03T16:06:23.000Z"
}
```

### Webhook Signature Verification

If you provide a `delivery.secret`, requests are signed with HMAC-SHA256:

```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// In your webhook handler
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  if (!verifySignature(req.body, signature, YOUR_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  // Process the webhook...
});
```

### Webhook Retry Policy

- **Retries**: 3 attempts with exponential backoff
- **Timeouts**: 30 second request timeout
- **Success**: HTTP 2xx response required
- **Failure**: After all retries fail, delivery status is marked as `failed`

### Webhook Limitations

| What's Sent | What's NOT Sent |
|-------------|-----------------|
| Final result (completed) | Progress updates (queued, running) |
| Error details (failed) | Intermediate status changes |

For real-time progress tracking, use the polling endpoint or consider WebSocket integration (available for authenticated web sessions).
