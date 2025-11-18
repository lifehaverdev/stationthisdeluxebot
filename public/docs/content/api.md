# API Guide

This guide shows practical cURL snippets and CLI examples for the StationThis Deluxe Bot REST API hosted at `https://noema.art/api/v1`.

## 1. Connect a Wallet (Magic-Amount Flow)

1. **Initiate linking** – request the magic amount you must deposit from the wallet you wish to connect.

```bash
curl -X POST "https://noema.art/api/v1/wallets/connect/initiate" \
  -H 'Content-Type: application/json' \
  -d '{"tokenAddress":"0x0000000000000000000000000000000000000000"}'
```

Typical response:
```json
{
  "requestId": "64f…",
  "magicAmount": "0.001337",
  "tokenAddress": "0x0000000000000000000000000000000000000000",
  "expiresAt": "2025-09-17T00:10:11.000Z",
  "depositToAddress": "0xABCD…"  // credit-vault contract
}
```
Deposit the exact `magicAmount` from your wallet to `depositToAddress`, then poll the status endpoint:

```bash
curl "https://noema.art/api/v1/wallets/connect/status/<requestId>"
```

On success you receive your **API key**:
```json
{
  "status": "COMPLETED",
  "apiKey": "sk_live_…",
  "message": "Wallet connected successfully. This is your API key. Store it securely, it will not be shown again."
}
```

---
## 2. Authentication

All API requests (except wallet connection) require an API key in the `x-api-key` header:

```bash
export API_KEY="sk_live_…"
```

**API Key Format:**
- Starts with `sk_live_` for production keys
- Store securely - keys are shown only once during wallet connection
- Keys can be managed via `/api/v1/user/apikeys` endpoints

**Rate Limits:**
- 100 requests per 15 minutes per IP address
- Webhook endpoints are excluded from rate limiting

---

## 3. Account Endpoints (require `x-api-key` header)

• **Profile**
```bash
curl -H "x-api-key: $API_KEY" \
     https://noema.art/api/v1/user/me
```

• **Dashboard summary**
```bash
curl -H "x-api-key: $API_KEY" \
     https://noema.art/api/v1/user/dashboard
```

• **Spending history (last month)**
```bash
curl -H "x-api-key: $API_KEY" \
     "https://noema.art/api/v1/user/history?timeUnit=month&offset=0"
```

---

## 4. Discover Available Tools

Before executing a generation, you may want to discover available tools:

**List all tools:**
```bash
curl https://noema.art/api/v1/tools
```

Response:
```json
[
  {
    "displayName": "Kontext",
    "description": "Transform images with AI",
    "toolId": "kontext",
    "commandName": "/kontext",
    "costingModel": { ... },
    "metadata": { ... }
  }
]
```

**Get tool details:**
```bash
curl https://noema.art/api/v1/tools/kontext
```

**Get full tool registry (for UI builders):**
```bash
curl https://noema.art/api/v1/tools/registry/kontext
```

---

## 5. Discover Available Spells

Browse and discover spells before casting:

**Browse public spells (marketplace):**
```bash
curl "https://noema.art/api/v1/spells/marketplace?tag=landscape&search=beautiful"
```

Response:
```json
[
  {
    "spellId": "5678…",
    "slug": "epic-landscape-vfx",
    "name": "Epic Landscape VFX",
    "description": "Creates stunning landscape images",
    "uses": 1234,
    "author": "user123",
    "tags": ["landscape", "vfx"],
    "createdAt": "2025-01-15T10:00:00.000Z"
  }
]
```

**Get spell details by slug:**
```bash
curl https://noema.art/api/v1/spells/epic-landscape-vfx
```

**Get cost estimate for a spell:**
```bash
curl -X POST https://noema.art/api/v1/spells/epic-landscape-vfx/quote \
     -H "x-api-key: $API_KEY" \
     -H 'Content-Type: application/json' \
     -d '{"sampleSize": 10}'
```

Response:
```json
{
  "totalCostPts": 150,
  "totalRuntimeMs": 45000,
  "stepBreakdown": [
    { "stepId": 1, "estimatedCostPts": 50, "estimatedRuntimeMs": 15000 },
    { "stepId": 2, "estimatedCostPts": 100, "estimatedRuntimeMs": 30000 }
  ]
}
```

---

## 6. Request a Generation (Kontext tool)

```bash
cat > kontext.json <<'EOF'
{
  "toolId": "kontext",
  "inputs": {
    "input_image": "https://miladymaker.net/milady/4985.png",
    "input_prompt": "turn the character so that she is facing the viewer and looking directly at them"
  }
}
EOF

curl -X POST https://noema.art/api/v1/generations/execute \
     -H "x-api-key: $API_KEY" \
     -H 'Content-Type: application/json' \
     -d @kontext.json
```

Sample response:
```json
{
  "generationId": "6541…",
  "status": "processing",
  "estimatedDurationSeconds": 45,
  "checkAfterMs": 45000,
  "message": "Your request has been accepted and is being processed."
}
```

Wait at least `checkAfterMs` and then poll for completion:
```bash
curl -H "x-api-key: $API_KEY" \
     https://noema.art/api/v1/generations/status/<generationId>
```
Completed example:
```json
{
  "generationId": "6541…",
  "status": "completed",
  "outputs": [ { "data": { "images": [ { "url": "https://…/output.png" } ] } } ]
}
```

**Batch status check** (check multiple generations at once):
```bash
curl -X POST https://noema.art/api/v1/generations/status \
     -H "x-api-key: $API_KEY" \
     -H 'Content-Type: application/json' \
     -d '{"generationIds": ["6541…", "6542…", "6543…"]}'
```

Response:
```json
{
  "generations": [
    {
      "generationId": "6541…",
      "status": "completed",
      "outputs": [ ... ]
    },
    {
      "generationId": "6542…",
      "status": "processing",
      ...
    }
  ]
}
```

---

## 7. Cast a Spell

Cast a spell (multi-step workflow):

```bash
cat > spell-cast.json <<'EOF'
{
  "slug": "epic-landscape-vfx",
  "context": {
    "parameterOverrides": {
      "input_prompt": "create a beautiful sunset landscape"
    }
  }
}
EOF

curl -X POST https://noema.art/api/v1/spells/cast \
     -H "x-api-key: $API_KEY" \
     -H 'Content-Type: application/json' \
     -d @spell-cast.json
```

Response:
```json
{
  "castId": "6789…",
  "status": "running"
}
```

**Poll for spell completion:**
```bash
curl -H "x-api-key: $API_KEY" \
     https://noema.art/api/v1/spells/casts/6789…
```

Response:
```json
{
  "_id": "6789…",
  "spellId": "5678…",
  "status": "completed",
  "stepGenerationIds": ["6541…", "6542…", "6543…"],
  "costUsd": 0.0075,
  "startedAt": "2025-01-27T12:30:00.000Z",
  "completedAt": "2025-01-27T12:34:56.789Z"
}
```

---

## 8. Webhook Delivery (Alternative to Polling)

Instead of polling for results, you can provide a webhook URL to receive completion notifications automatically. Webhooks are delivered via HTTP POST requests to your specified endpoint.

### 8.1 Tool Execution with Webhook

Request a generation with webhook delivery:

```bash
cat > kontext-webhook.json <<'EOF'
{
  "toolId": "kontext",
  "inputs": {
    "input_image": "https://miladymaker.net/milady/4985.png",
    "input_prompt": "turn the character so that she is facing the viewer"
  },
  "delivery": {
    "mode": "webhook",
    "url": "https://your-domain.com/webhooks/generation-complete",
    "secret": "your-webhook-secret-optional"
  }
}
EOF

curl -X POST https://noema.art/api/v1/generations/execute \
     -H "x-api-key: $API_KEY" \
     -H 'Content-Type: application/json' \
     -d @kontext-webhook.json
```

Response (202 Accepted):
```json
{
  "status": "accepted",
  "message": "Your request has been accepted and is being processed.",
  "toolId": "kontext",
  "generationId": "6541…",
  "runId": "run_abc123",
  "delivery": {
    "mode": "webhook",
    "url": "https://your-domain.com/webhooks/generation-complete"
  }
}
```

**Webhook Requirements:**
- URL must use HTTPS (except `localhost` in development)
- Your endpoint should respond with `200 OK` to acknowledge receipt
- Webhooks are retried up to 3 times with exponential backoff (1s, 5s, 30s)

### 8.2 Spell Cast with Webhook

Cast a spell with webhook delivery:

```bash
cat > spell-webhook.json <<'EOF'
{
  "slug": "my-spell-slug",
  "context": {
    "webhookUrl": "https://your-domain.com/webhooks/spell-complete",
    "webhookSecret": "your-webhook-secret-optional",
    "parameterOverrides": {
      "input_prompt": "create a beautiful landscape"
    }
  }
}
EOF

curl -X POST https://noema.art/api/v1/spells/cast \
     -H "x-api-key: $API_KEY" \
     -H 'Content-Type: application/json' \
     -d @spell-webhook.json
```

Response:
```json
{
  "castId": "6789…",
  "status": "running"
}
```

### 8.3 Webhook Payload Format

**Tool Execution Webhook:**

When a tool execution completes, your webhook endpoint will receive:

```json
{
  "event": "generation.completed",
  "generationId": "6541…",
  "toolId": "kontext",
  "status": "completed",
  "outputs": [
    {
      "type": "image",
      "data": {
        "images": [
          {
            "url": "https://cdn.noema.art/outputs/6541.png"
          }
        ]
      }
    }
  ],
  "costUsd": 0.0025,
  "timestamp": "2025-01-27T12:34:56.789Z",
  "signature": "sha256_hex_signature_if_secret_provided"
}
```

**Spell Cast Webhook:**

When a spell cast completes, your webhook endpoint will receive:

```json
{
  "event": "spell.completed",
  "castId": "6789…",
  "spellId": "5678…",
  "spellSlug": "my-spell-slug",
  "status": "completed",
  "generationIds": ["6541…", "6542…", "6543…"],
  "finalOutputs": [
    {
      "type": "image",
      "data": {
        "images": [
          {
            "url": "https://cdn.noema.art/outputs/6543.png"
          }
        ]
      }
    }
  ],
  "costUsd": 0.0075,
  "startedAt": "2025-01-27T12:30:00.000Z",
  "completedAt": "2025-01-27T12:34:56.789Z",
  "signature": "sha256_hex_signature_if_secret_provided"
}
```

**Failed Execution:**

If execution fails, the webhook includes error details:

```json
{
  "event": "generation.failed",
  "generationId": "6541…",
  "toolId": "kontext",
  "status": "failed",
  "error": {
    "code": "GENERATION_FAILED",
    "message": "Service timeout after 120 seconds"
  },
  "costUsd": null,
  "timestamp": "2025-01-27T12:36:00.000Z",
  "signature": "sha256_hex_signature_if_secret_provided"
}
```

### 8.4 Webhook Signature Verification

If you provide a `secret` when requesting webhook delivery, we include an HMAC-SHA256 signature in the payload and `X-Webhook-Signature` header. Verify the signature to ensure the webhook is authentic:

**Node.js Example:**
```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  // Remove signature from payload before verifying (it's added after signing)
  const payloadWithoutSignature = { ...payload };
  delete payloadWithoutSignature.signature;
  
  const payloadString = JSON.stringify(payloadWithoutSignature);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// In your webhook handler
app.post('/webhooks/generation-complete', express.json(), (req, res) => {
  const signature = req.headers['x-webhook-signature']?.replace('sha256=', '');
  const secret = process.env.WEBHOOK_SECRET;
  
  if (secret && signature) {
    if (!verifyWebhookSignature(req.body, signature, secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }
  
  // Process webhook
  console.log('Received webhook:', req.body);
  res.status(200).json({ received: true });
});
```

**Python Example:**
```python
import hmac
import hashlib
import json

def verify_webhook_signature(payload, signature, secret):
    # Remove signature from payload before verifying (it's added after signing)
    payload_without_signature = {k: v for k, v in payload.items() if k != 'signature'}
    # Use same JSON serialization as server (no sorting, default separators)
    payload_string = json.dumps(payload_without_signature, separators=(',', ':'))
    expected_signature = hmac.new(
        secret.encode('utf-8'),
        payload_string.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(signature, expected_signature)

# In your webhook handler (Flask example)
@app.route('/webhooks/generation-complete', methods=['POST'])
def handle_webhook():
    signature = request.headers.get('X-Webhook-Signature', '').replace('sha256=', '')
    secret = os.environ.get('WEBHOOK_SECRET')
    
    if secret and signature:
        if not verify_webhook_signature(request.json, signature, secret):
            return jsonify({'error': 'Invalid signature'}), 401
    
    # Process webhook
    print('Received webhook:', request.json)
    return jsonify({'received': True}), 200
```

### 8.5 Webhook Best Practices

1. **Always verify signatures** when a secret is provided
2. **Respond quickly** - return `200 OK` within 5 seconds to acknowledge receipt
3. **Idempotency** - Check `generationId` or `castId` to avoid processing duplicates
4. **Error handling** - Log failures but return `200 OK` to prevent retries for permanent errors
5. **HTTPS only** - Webhook URLs must use HTTPS (except localhost in development)

### 8.6 Polling vs Webhooks

| Feature | Polling | Webhooks |
|---------|---------|----------|
| **Latency** | Depends on poll interval | Immediate delivery |
| **Server Load** | Higher (repeated requests) | Lower (push notifications) |
| **Complexity** | Simple (just GET requests) | Requires webhook endpoint |
| **Reliability** | You control retry logic | Automatic retries (3 attempts) |
| **Use Case** | Simple integrations, testing | Production applications |

**Recommendation:** Use webhooks for production applications where low latency matters. Use polling for simple scripts, testing, or when you can't expose a public endpoint.

---

## 9. Error Handling

### Common HTTP Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| `200` | OK | Request succeeded |
| `202` | Accepted | Request accepted for processing (async operations) |
| `400` | Bad Request | Invalid request parameters |
| `401` | Unauthorized | Missing or invalid API key |
| `403` | Forbidden | Insufficient permissions |
| `404` | Not Found | Resource not found |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Internal Server Error | Server error |
| `502` | Bad Gateway | Upstream service error |
| `503` | Service Unavailable | Service temporarily unavailable |

### Error Response Format

All errors follow this format:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

### Common Error Codes

- `BAD_REQUEST` - Invalid input parameters
- `UNAUTHORIZED` - Missing or invalid API key
- `NOT_FOUND` - Resource not found (tool, spell, generation, etc.)
- `TOO_MANY_REQUESTS` - Rate limit exceeded
- `JOB_SUBMISSION_FAILED` - Failed to submit generation job
- `SPELL_CAST_FAILED` - Failed to cast spell
- `INTERNAL_SERVER_ERROR` - Server-side error

### Example Error Responses

**Invalid API Key:**
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid API key."
  }
}
```

**Tool Not Found:**
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Tool with ID 'invalid-tool' not found."
  }
}
```

**Rate Limit Exceeded:**
```json
{
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "You have sent too many requests in a given amount of time. Please try again later."
  }
}
```

---

## 10. Quick Reference

### Endpoints Summary

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/wallets/connect/initiate` | POST | None | Start wallet connection |
| `/wallets/connect/status/:requestId` | GET | None | Check connection status |
| `/user/me` | GET | API Key | Get user profile |
| `/user/dashboard` | GET | API Key | Get dashboard summary |
| `/user/history` | GET | API Key | Get spending history |
| `/tools` | GET | None | List all tools |
| `/tools/:toolId` | GET | None | Get tool details |
| `/tools/registry` | GET | None | Get full tool registry |
| `/spells/marketplace` | GET | None | Browse public spells |
| `/spells/:slug` | GET | None | Get spell details |
| `/spells/:slug/quote` | POST | API Key | Get spell cost estimate |
| `/spells/cast` | POST | API Key | Cast a spell |
| `/spells/casts/:castId` | GET | API Key | Get cast status |
| `/generations/execute` | POST | API Key | Execute a tool |
| `/generations/status/:generationId` | GET | API Key | Get generation status |
| `/generations/status` | POST | API Key | Batch status check |

### Request Headers

- `x-api-key: sk_live_...` - Required for authenticated endpoints
- `Content-Type: application/json` - Required for POST/PUT requests
