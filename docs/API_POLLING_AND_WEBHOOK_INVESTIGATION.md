# API Polling and Webhook Investigation Report

**Date:** 2025-01-27  
**Scope:** Complete investigation of polling and webhook capabilities for tool executions and spell casts  
**Objective:** Document current state, identify implementation gaps, and provide recommendations

---

## Executive Summary

This investigation reveals that:

1. **Polling endpoints exist and are functional** for both tool executions and spell casts
2. **Webhook mode is accepted** in the tool execution API but **not implemented** - no webhook delivery occurs
3. **Spell casts have no webhook support** - no webhook parameters or delivery mechanism
4. **Infrastructure exists** for incoming webhooks (from services) but not for outgoing webhooks (to API users)

---

## 1. Tool Execution API - Polling Endpoints

### 1.1 Execute Tool Endpoint

**Endpoint:** `POST /api/v1/generations/execute`  
**Location:** `src/api/external/generations/generationsApi.js:13-138`  
**Authentication:** API Key (via `apiKeyAuth` middleware)

**Request Format:**
```json
{
  "toolId": "string",
  "inputs": {
    // Tool-specific input parameters
  },
  "delivery": {
    "mode": "poll" | "webhook"
  }
}
```

**Response Format (202 Accepted):**
```json
{
  "status": "accepted",
  "message": "Your request has been accepted and is being processed.",
  "toolId": "string",
  "generationId": "string (ObjectId)",
  "runId": "string",
  "delivery": {
    "mode": "poll" | "webhook"
  }
}
```

**Key Behaviors:**
- Creates generation record with `notificationPlatform: 'webhook'` if `delivery.mode === 'webhook'`
- Creates generation record with `notificationPlatform: 'none'` if `delivery.mode === 'poll'`
- Returns immediately with `generationId` for polling
- Does NOT validate or store webhook URL when webhook mode is requested

### 1.2 Single Generation Status Endpoint

**Endpoint:** `GET /api/v1/generations/status/:generationId`  
**Location:** `src/api/external/generations/generationsApi.js:140-174`  
**Authentication:** API Key (via `apiKeyAuth` middleware)

**Request:**
- Path parameter: `generationId` (ObjectId string)

**Response Format (200 OK):**
```json
{
  "generationId": "string",
  "status": "pending" | "processing" | "completed" | "failed",
  "deliveryStatus": "pending" | "sent" | "failed" | "dropped" | "skipped" | "none",
  "outputs": [
    {
      "type": "image" | "text" | "video" | "audio",
      "data": {}
    }
  ],
  "responsePayload": {
    // Service-specific response data
    // Contains error details if status is "failed"
  }
}
```

**Error Responses:**
- `400 BAD_REQUEST`: Missing `generationId`
- `404 NOT_FOUND`: Generation not found or user doesn't own it
- `500 INTERNAL_SERVER_ERROR`: Server error

**Security:**
- Validates that `generationRecord.masterAccountId === user.masterAccountId`
- Returns 404 (not 403) to avoid leaking existence of generation IDs

### 1.3 Batch Status Endpoint

**Endpoint:** `POST /api/v1/generations/status`  
**Location:** `src/api/external/generations/generationsApi.js:177-216`  
**Authentication:** API Key (via `apiKeyAuth` middleware)

**Request Format:**
```json
{
  "generationIds": ["string (ObjectId)", ...]
}
```

**Response Format (200 OK):**
```json
{
  "generations": [
    {
      "_id": "string",
      "generationId": "string",
      "status": "pending" | "processing" | "completed" | "failed",
      "deliveryStatus": "pending" | "sent" | "failed" | "dropped" | "skipped" | "none",
      "outputs": [],
      "responsePayload": {},
      // ... other generation record fields
    }
  ]
}
```

**Key Behaviors:**
- Validates all IDs belong to the authenticated user
- Returns array of generation records matching the provided IDs
- Useful for polling multiple generations in a single request

---

## 2. Spell Cast API - Polling Endpoints

### 2.1 Cast Spell Endpoint

**Endpoint:** `POST /api/v1/spells/cast`  
**Location:** `src/api/external/spells/spellsApi.js:272-342`  
**Authentication:** JWT, API Key, or Guest (via `guestOrUserAuth` middleware)

**Request Format:**
```json
{
  "slug": "string (spell slug)",
  "context": {
    "masterAccountId": "string (optional, auto-filled from auth)",
    "platform": "string (optional)",
    "parameterOverrides": {},
    "quote": {},
    "chargeUpfront": "boolean"
  }
}
```

**Response Format (200 OK):**
```json
{
  "castId": "string (ObjectId)",
  "generationId": "string (ObjectId, optional)",
  "status": "running" | "completed" | "failed"
}
```

**Key Behaviors:**
- Creates cast record via `SpellsService.castSpell()`
- Returns `castId` immediately for polling
- No webhook parameter support
- Supports guest authentication for zero-cost spells

### 2.2 Cast Status Endpoint

**Endpoint:** `GET /api/v1/spells/casts/:castId`  
**Location:** `src/api/external/spells/spellsApi.js:228-268`  
**Authentication:** JWT, API Key, or Guest (via `guestOrUserAuth` middleware)

**Request:**
- Path parameter: `castId` (ObjectId string)

**Response Format (200 OK):**
```json
{
  "_id": "string (castId)",
  "spellId": "string (ObjectId)",
  "initiatorAccountId": "string (ObjectId)",
  "status": "running" | "completed" | "failed",
  "startedAt": "ISO 8601 date string",
  "updatedAt": "ISO 8601 date string",
  "completedAt": "ISO 8601 date string (if completed)",
  "stepGenerationIds": ["string (ObjectId)", ...],
  "costUsd": "number | null",
  "metadata": {}
}
```

**Key Behaviors:**
- Returns full cast record
- Includes `stepGenerationIds` array for tracking individual step generations
- Can be polled to check spell execution progress
- No webhook support

---

## 3. Webhook Mode Acceptance (But Not Implemented)

### 3.1 Tool Execution Webhook Mode

**Location:** `src/api/external/generations/generationsApi.js:13-138`

**Current Implementation:**
```javascript
// Line 14: Accepts webhook mode
const { toolId, inputs, delivery = { mode: 'poll' } } = req.body;

// Line 53-54: Sets notificationPlatform based on delivery mode
delivery: delivery.mode === 'webhook' ? delivery : { mode: 'poll' },
notificationPlatform: delivery.mode === 'webhook' ? 'webhook' : 'none',
```

**What Happens:**
1. ✅ API accepts `delivery: { mode: 'webhook' }` parameter
2. ✅ Generation record is created with `notificationPlatform: 'webhook'`
3. ✅ Generation record stores `delivery: { mode: 'webhook' }` object
4. ❌ **NO webhook URL is stored** - `delivery` object doesn't contain `url` field
5. ❌ **NO webhook delivery occurs** - NotificationDispatcher has no webhook notifier

**Gap Analysis:**
- The `delivery` object could theoretically contain `{ mode: 'webhook', url: 'https://...' }` but:
  - No validation of webhook URL format
  - No storage of webhook URL in generation record
  - No webhook notifier service exists to send HTTP POST requests

### 3.2 Generation Record Structure

**Location:** `src/api/internal/generations/generationOutputsApi.js:138-229`

**Relevant Fields:**
- `notificationPlatform`: Set to `'webhook'` when webhook mode requested
- `deliveryStatus`: `'pending'`, `'sent'`, `'failed'`, `'dropped'`, `'skipped'`, `'none'`
- `metadata`: Can contain `notificationContext` but no webhook URL storage
- `delivery`: Stores the delivery object but not used for webhook delivery

**Current Schema:**
```javascript
{
  masterAccountId: ObjectId,
  initiatingEventId: ObjectId,
  serviceName: string,
  toolId: string,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  notificationPlatform: 'webhook' | 'none' | 'telegram' | 'websocket' | ...,
  deliveryStatus: 'pending' | 'sent' | 'failed' | ...,
  delivery: { mode: 'poll' | 'webhook' }, // Not used for actual delivery
  metadata: {
    notificationContext: {}, // Used for internal platforms
    // No webhookUrl field
  }
}
```

---

## 4. Notification System Architecture

### 4.1 NotificationDispatcher

**Location:** `src/core/services/notificationDispatcher.js`

**Current Flow:**
1. Listens for `generationUpdated` events
2. Routes to platform-specific notifiers based on `notificationPlatform`
3. Updates `deliveryStatus` after successful/failed delivery

**Supported Platforms:**
- `telegram`: TelegramNotifier
- `websocket`: WebSocketService
- `web-sandbox`: WebSandboxNotifier
- `cook`: CookNotifier
- `none`: No notification (skipped)

**Missing Platform:**
- `webhook`: **NO WebhookNotifier exists**

**Current Implementation:**
```javascript
// Line 226: Gets notifier for platform
const notifier = this.platformNotifiers[record.notificationPlatform];

// Line 227-236: If no notifier found, marks as 'dropped'
if (!notifier || typeof notifier.sendNotification !== 'function') {
  this.logger.warn(`No notifier found for platform: '${record.notificationPlatform}'`);
  // Sets deliveryStatus to 'dropped'
  return;
}
```

**Impact:**
- When `notificationPlatform === 'webhook'`, no notifier exists
- NotificationDispatcher logs warning and sets `deliveryStatus: 'dropped'`
- No HTTP POST request is sent to external webhook URL

### 4.2 Platform Notifiers

**Location:** `src/core/services/notification/` (various files)

**Existing Notifiers:**
- `TelegramNotifier`: Sends Telegram messages
- `WebSandboxNotifier`: Sends WebSocket messages to web clients
- `CookNotifier`: Handles cook-specific notifications

**Missing Notifier:**
- `WebhookNotifier`: Should send HTTP POST requests to external URLs

---

## 5. Spell Cast Execution Flow

### 5.1 Execution Flow

**Entry Point:** `POST /api/v1/spells/cast`  
**Service:** `SpellsService.castSpell()`  
**Orchestrator:** `WorkflowExecutionService.execute()`

**Flow:**
1. User calls `POST /api/v1/spells/cast` with spell slug
2. `SpellsService.castSpell()` creates cast record
3. `WorkflowExecutionService.execute()` starts spell execution
4. `SpellExecutor.execute()` executes first step
5. `StepExecutor.executeStep()` creates generation record for step
6. Tool execution happens (async or immediate)
7. When step completes, `NotificationDispatcher` receives `generationUpdated` event
8. If `deliveryStrategy === 'spell_step'`, `NotificationDispatcher` calls `WorkflowExecutionService.continueExecution()`
9. `StepContinuator.continue()` processes output and triggers next step
10. Process repeats until all steps complete
11. Final step triggers `deliveryStrategy === 'spell_final'` notification

**Key Files:**
- `src/core/services/SpellsService.js:17-142` - Spell casting
- `src/core/services/WorkflowExecutionService.js:93-106` - Execution orchestration
- `src/core/services/workflow/execution/SpellExecutor.js` - Spell-level logic
- `src/core/services/workflow/execution/StepExecutor.js` - Step execution
- `src/core/services/workflow/continuation/StepContinuator.js` - Step continuation

### 5.2 Cast Record Structure

**Location:** `src/core/services/db/castsDb.js`

**Schema:**
```javascript
{
  _id: ObjectId, // castId
  spellId: ObjectId,
  initiatorAccountId: ObjectId,
  status: 'running' | 'completed' | 'failed',
  startedAt: Date,
  updatedAt: Date,
  completedAt: Date (if completed),
  stepGenerationIds: [ObjectId, ...], // Array of generation IDs for each step
  costUsd: number | null,
  metadata: {}
}
```

**Missing Fields:**
- No `webhookUrl` field
- No `delivery` field
- No webhook-related metadata

### 5.3 Webhook Integration Points

**Where Webhooks Should Be Triggered:**

1. **Final Spell Completion:**
   - Location: `src/core/services/workflow/continuation/StepContinuator.js`
   - When: Last step completes and spell is finalized
   - Should: Send webhook with final spell results

2. **Individual Step Completion (Optional):**
   - Location: `src/core/services/notificationDispatcher.js:_handleSpellStep()`
   - When: Each step completes
   - Should: Optionally send webhook for step progress (if configured)

3. **Spell Failure:**
   - Location: `src/core/services/workflow/continuation/StepContinuator.js`
   - When: Step fails and spell cannot continue
   - Should: Send webhook with error details

---

## 6. Webhook URL Storage Options

### 6.1 Option 1: Store in Generation Record

**Pros:**
- Per-execution webhook URLs (flexible)
- Can have different webhooks for different tools/spells
- No schema changes needed (use `metadata.webhookUrl`)

**Cons:**
- For spells, need to store webhook URL in cast record, not generation record
- Multiple generation records per spell cast (one per step)
- Need to propagate webhook URL from cast to all step generations

**Implementation:**
```javascript
// In generation record
metadata: {
  webhookUrl: 'https://example.com/webhook',
  webhookSecret: 'optional-secret-for-signing'
}
```

### 6.2 Option 2: Store in User Settings

**Pros:**
- Single webhook URL per user (simpler)
- Can be configured once and reused
- Centralized management

**Cons:**
- Less flexible (can't override per-execution)
- Requires user settings API changes
- May not want same webhook for all operations

**Implementation:**
```javascript
// In userCore document
apiSettings: {
  defaultWebhookUrl: 'https://example.com/webhook',
  defaultWebhookSecret: 'optional-secret'
}
```

### 6.3 Option 3: Separate Webhook Registry

**Pros:**
- Most flexible (multiple webhooks per user)
- Can have webhook templates/patterns
- Can track webhook delivery history separately

**Cons:**
- Most complex to implement
- Requires new database collection
- Overkill for current needs

**Implementation:**
```javascript
// New collection: webhookRegistrations
{
  _id: ObjectId,
  masterAccountId: ObjectId,
  name: string,
  url: string,
  secret: string,
  active: boolean,
  createdAt: Date
}
```

### 6.4 Recommendation

**For Tool Executions:** Option 1 (store in generation record metadata)
- Pass webhook URL in `delivery.url` parameter
- Store in `metadata.webhookUrl` for easy access

**For Spell Casts:** Option 1 (store in cast record metadata)
- Pass webhook URL in `context.webhookUrl` parameter
- Store in cast record `metadata.webhookUrl`
- Propagate to final generation record for webhook delivery

---

## 7. Webhook Payload Format

### 7.1 Recommended Payload Structure

**For Tool Executions:**
```json
{
  "event": "generation.completed" | "generation.failed",
  "generationId": "string (ObjectId)",
  "toolId": "string",
  "status": "completed" | "failed",
  "outputs": [
    {
      "type": "image" | "text" | "video" | "audio",
      "data": {}
    }
  ],
  "error": {
    "code": "string",
    "message": "string"
  } // Only present if status is "failed",
  "costUsd": "number | null",
  "timestamp": "ISO 8601 date string",
  "signature": "string (HMAC-SHA256 signature, optional)"
}
```

**For Spell Casts:**
```json
{
  "event": "spell.completed" | "spell.failed",
  "castId": "string (ObjectId)",
  "spellId": "string (ObjectId)",
  "spellSlug": "string",
  "status": "completed" | "failed",
  "generationIds": ["string (ObjectId)", ...],
  "finalOutputs": [
    {
      "type": "image" | "text" | "video" | "audio",
      "data": {}
    }
  ],
  "error": {
    "code": "string",
    "message": "string"
  } // Only present if status is "failed",
  "costUsd": "number | null",
  "startedAt": "ISO 8601 date string",
  "completedAt": "ISO 8601 date string",
  "signature": "string (HMAC-SHA256 signature, optional)"
}
```

### 7.2 Webhook Signature

**Purpose:** Verify webhook authenticity

**Algorithm:** HMAC-SHA256

**Implementation:**
```javascript
const crypto = require('crypto');

function signWebhook(payload, secret) {
  const payloadString = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');
  return signature;
}

// Include in webhook payload
payload.signature = signWebhook(payload, webhookSecret);
```

**Header:** `X-Webhook-Signature: sha256=<signature>`

---

## 8. Security Requirements

### 8.1 Webhook URL Validation

**Requirements:**
- Must be HTTPS (except for localhost in development)
- Must be valid URL format
- Should validate URL is reachable (optional health check)

**Implementation:**
```javascript
function validateWebhookUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !parsed.hostname.includes('localhost')) {
      throw new Error('Webhook URLs must use HTTPS');
    }
    return true;
  } catch (error) {
    throw new Error(`Invalid webhook URL: ${error.message}`);
  }
}
```

### 8.2 Webhook Secret Management

**Requirements:**
- Optional secret for signing webhooks
- Should be stored securely (hashed if stored in database)
- User-provided secret should be passed in request, not stored

**Implementation:**
- Store secret in `metadata.webhookSecret` (encrypted at rest)
- Use secret only for signing, never in logs
- Allow user to provide secret per-execution or use default

### 8.3 Rate Limiting

**Requirements:**
- Prevent webhook spam
- Limit retry attempts
- Exponential backoff on failures

**Implementation:**
- Max 3 delivery attempts (already implemented in NotificationDispatcher)
- Exponential backoff: 1s, 5s, 30s
- After max attempts, mark as `deliveryStatus: 'dropped'`

### 8.4 Authentication

**Requirements:**
- Webhook signature verification (if secret provided)
- Optional API key in webhook payload for user identification

**Implementation:**
- Include signature in payload and header
- User can verify signature on their end
- No additional authentication needed (signature is proof)

---

## 9. Retry Logic

### 9.1 Current Retry Implementation

**Location:** `src/core/services/notificationDispatcher.js:268-297`

**Current Behavior:**
- Max 3 delivery attempts
- Updates `deliveryAttempts` counter
- Sets `deliveryStatus: 'dropped'` after max attempts
- Stores `deliveryError` message

**Gap:**
- No exponential backoff
- No retry queue
- Immediate retries on failure

### 9.2 Recommended Retry Logic

**For Webhook Delivery:**
```javascript
const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s

async function deliverWebhook(url, payload, attempt = 0) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 10000 // 10 second timeout
    });
    
    if (response.ok) {
      return { success: true };
    }
    
    throw new Error(`Webhook returned ${response.status}`);
  } catch (error) {
    if (attempt < RETRY_DELAYS.length) {
      await sleep(RETRY_DELAYS[attempt]);
      return deliverWebhook(url, payload, attempt + 1);
    }
    throw error;
  }
}
```

---

## 10. Implementation Gaps Summary

### 10.1 Critical Gaps

1. **No WebhookNotifier Service**
   - Missing: `src/core/services/notification/WebhookNotifier.js`
   - Impact: Webhooks never delivered even when requested

2. **No Webhook URL Storage**
   - Missing: Storage mechanism for webhook URLs
   - Impact: Cannot store webhook URLs provided by API users

3. **No Webhook Support for Spell Casts**
   - Missing: Webhook parameter in spell cast endpoint
   - Impact: Spell casts can only be polled, not webhooked

4. **No Webhook Payload Format**
   - Missing: Standardized webhook payload structure
   - Impact: Inconsistent webhook delivery (when implemented)

5. **No Webhook Signature Implementation**
   - Missing: HMAC-SHA256 signature generation
   - Impact: Cannot verify webhook authenticity

### 10.2 Medium Priority Gaps

6. **No Webhook URL Validation**
   - Missing: Validation of webhook URL format and HTTPS requirement
   - Impact: Invalid URLs accepted, potential security issues

7. **No Retry Queue**
   - Missing: Exponential backoff and retry queue for failed webhooks
   - Impact: Failed webhooks retry immediately, may overwhelm endpoints

8. **No Webhook Delivery Tracking**
   - Missing: Separate tracking of webhook delivery attempts
   - Impact: Cannot distinguish webhook failures from other notification failures

### 10.3 Low Priority Gaps

9. **No Webhook Health Checks**
   - Missing: Validation that webhook URL is reachable
   - Impact: Invalid URLs only discovered on first delivery attempt

10. **No Webhook Templates**
    - Missing: Reusable webhook configurations
    - Impact: Users must provide webhook URL for each execution

---

## 11. Recommendations

### 11.1 Immediate Actions

1. **Implement WebhookNotifier Service**
   - Create `src/core/services/notification/WebhookNotifier.js`
   - Implement HTTP POST delivery with retry logic
   - Register in NotificationDispatcher platform notifiers

2. **Add Webhook URL Storage**
   - Store webhook URL in `metadata.webhookUrl` for generation records
   - Store webhook URL in cast record `metadata.webhookUrl` for spells
   - Validate webhook URL format (HTTPS required)

3. **Add Webhook Support to Spell Casts**
   - Accept `webhookUrl` in `context` parameter
   - Store in cast record metadata
   - Trigger webhook on spell completion/failure

4. **Implement Webhook Signatures**
   - Generate HMAC-SHA256 signatures
   - Include signature in webhook payload and header
   - Document signature verification for API users

### 11.2 Short-Term Improvements

5. **Standardize Webhook Payload Format**
   - Define payload structure for tool executions
   - Define payload structure for spell casts
   - Document payload format in API documentation

6. **Implement Retry Logic**
   - Add exponential backoff (1s, 5s, 30s)
   - Implement retry queue for failed webhooks
   - Track retry attempts separately

7. **Add Webhook URL Validation**
   - Validate HTTPS requirement (except localhost)
   - Validate URL format
   - Optional: Health check endpoint

### 11.3 Long-Term Enhancements

8. **Webhook Delivery Tracking**
   - Separate collection/table for webhook delivery logs
   - Track delivery attempts, success/failure, response codes
   - Analytics dashboard for webhook delivery metrics

9. **Webhook Templates**
   - Allow users to create reusable webhook configurations
   - Store in user settings or separate registry
   - Support webhook URL patterns/variables

10. **Webhook Testing**
    - Test webhook endpoint for validation
    - Webhook delivery simulator
    - Webhook replay functionality

---

## 12. Files Requiring Changes

### 12.1 New Files to Create

1. `src/core/services/notification/WebhookNotifier.js` - Webhook delivery service
2. `docs/API_WEBHOOK_GUIDE.md` - API documentation for webhooks
3. `tests/services/notification/WebhookNotifier.test.js` - Unit tests

### 12.2 Files to Modify

1. `src/api/external/generations/generationsApi.js`
   - Add webhook URL validation
   - Store webhook URL in generation record metadata

2. `src/api/external/spells/spellsApi.js`
   - Accept `webhookUrl` in context parameter
   - Store webhook URL in cast record

3. `src/core/services/notificationDispatcher.js`
   - Register WebhookNotifier in platform notifiers
   - Handle webhook delivery failures

4. `src/core/services/workflow/continuation/StepContinuator.js`
   - Trigger webhook on spell completion
   - Include webhook URL from cast record

5. `src/core/services/db/castsDb.js`
   - Add webhook URL to cast record schema (optional, can use metadata)

6. `src/api/internal/generations/generationOutputsApi.js`
   - Accept `metadata.webhookUrl` in generation record creation
   - Validate webhook URL format

---

## 13. Conclusion

The investigation reveals that while polling endpoints are fully functional, webhook support is only partially implemented. The API accepts webhook mode but does not deliver webhooks. Spell casts have no webhook support at all.

**Key Findings:**
- ✅ Polling works for both tool executions and spell casts
- ⚠️ Webhook mode accepted but not implemented for tool executions
- ❌ No webhook support for spell casts
- ❌ No webhook delivery infrastructure exists

**Next Steps:**
1. Implement WebhookNotifier service
2. Add webhook URL storage and validation
3. Add webhook support to spell casts
4. Implement webhook signatures and retry logic
5. Document webhook API for external users

---

**Report Generated:** 2025-01-27  
**Investigation Completed By:** AI Assistant  
**Status:** Complete

