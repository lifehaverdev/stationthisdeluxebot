# JoyTag Image Interrogation Tool Implementation

## Objective
Implement a new static tool called "joytag" that interrogates images using HuggingFace Spaces API to provide text descriptions. This tool migrates the legacy `/interrogate` command from the archive to the modern tool system.

## Background

### Legacy Implementation
The old `/interrogate` command exists in `archive/deluxebot/utils/bot/handlers/iWork.js` (lines 618-803). It uses the HuggingFace Joy Caption API with a two-step process:
1. POST request to get an event ID
2. GET request to stream the result using that event ID

HuggingFace Space URL: `https://fancyfeast-joy-caption-pre-alpha.hf.space/call/stream_chat`

### Architecture Pattern
Follow the same pattern as OpenAI service:
- **Service**: `src/core/services/openai/openaiService.js`
- **Tool Definition**: `src/core/tools/definitions/chatgpt.js` and `dalleImage.js`
- **Execution Route**: `src/api/internal/generations/generationExecutionApi.js` (lines 309-425 for OpenAI)

## Implementation Steps

### 1. Create HuggingFace Service

**File**: `src/core/services/huggingface/huggingfaceService.js`

**Requirements**:
- Constructor accepts `{ logger }` options
- Use native `fetch` for HTTP requests (like in runManager.js)
- Implement method: `async interrogateImage({ imageUrl })`
- Handle the two-step API flow:
  1. POST to `/call/stream_chat` with `{ data: [{ path: imageUrl }] }`
  2. Extract event ID from response (see line 717 in iWork.js for extraction logic)
  3. GET to `/call/stream_chat/{eventId}` to stream result
  4. Parse Server-Sent Events format (lines 743-787 in iWork.js)
- Error handling:
  - Quota/rate limit errors (lines 689-694)
  - Invalid/empty responses (lines 772-787)
  - Network errors
- Return the interrogation text result on success

**Reference implementation from archive**:
```javascript
// Step 1: Get Event ID (lines 700-728)
const response = await fetch('https://fancyfeast-joy-caption-pre-alpha.hf.space/call/stream_chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [{ path: url }] })
});
const eventId = JSON.stringify(jsonResponse).split('"')[3];

// Step 2: Stream Result (lines 730-803)
const streamUrl = `https://fancyfeast-joy-caption-pre-alpha.hf.space/call/stream_chat/${eventId}`;
const response = await fetch(streamUrl, { method: 'GET' });
const result = await response.text();
// Parse SSE format, extract last valid JSON data
```

### 2. Create JoyTag Tool Definition

**File**: `src/core/tools/definitions/joytag.js`

**Structure**:
```javascript
const joytagTool = {
  toolId: 'joytag',
  service: 'huggingface',
  displayName: 'JoyTag',
  commandName: '/joytag',
  apiPath: '/huggingface/interrogate',
  description: 'Interrogate images to generate detailed text descriptions using AI vision models.',
  inputSchema: {
    imageUrl: {
      name: 'imageUrl',
      type: 'image',
      required: true,
      description: 'URL of the image to interrogate.'
    }
  },
  outputSchema: {
    description: {
      name: 'description',
      type: 'string',
      description: 'The generated text description of the image.'
    }
  },
  costingModel: {
    rateSource: 'static',
    staticCost: {
      amount: 0.000001, // Adjust as needed
      unit: 'request'
    }
  },
  deliveryMode: 'immediate',
  webhookStrategy: {
    expectedStatusField: 'status',
    successValue: 'completed',
    durationTracking: false,
    resultPath: ['description']
  },
  platformHints: {
    primaryInput: 'image',
    supportsFileCaption: false,
    supportsReplyWithCommand: false
  },
  category: 'interrogate', // Valid category for image interrogation
  visibility: 'public',
  humanDefaults: {},
  metadata: {
    provider: 'HuggingFace',
    model: 'joy-caption-pre-alpha'
  }
};

module.exports = joytagTool;
```

### 3. Initialize Service

**File**: `src/core/services/index.js`

**Changes**:
1. Import the service (around line 10):
   ```javascript
   const HuggingFaceService = require('./huggingface/huggingfaceService');
   ```

2. Initialize service (around line 73, after openAIService):
   ```javascript
   const huggingfaceService = new HuggingFaceService({ logger });
   ```

3. Add to returned services object (around line 295):
   ```javascript
   huggingface: huggingfaceService,
   ```

4. Export in module.exports (around line 323):
   ```javascript
   HuggingFaceService,
   ```

### 4. Add Execution Route

**File**: `src/api/internal/generations/generationExecutionApi.js`

**Location**: Add new case after the 'openai' case (after line 680)

**Implementation Pattern** (follow OpenAI image pattern from lines 327-424):

```javascript
case 'huggingface': {
  const { masterAccountId } = user;
  const imageUrl = inputs.imageUrl;
  
  if (!imageUrl || typeof imageUrl !== 'string') {
    return res.status(400).json({ 
      error: { code: 'INVALID_INPUT', message: 'Missing or invalid imageUrl for JoyTag.' } 
    });
  }

  const initialDeliveryStatus = (user.platform && user.platform !== 'none') ? 'pending' : 'skipped';
  const generationParams = {
    masterAccountId: new ObjectId(masterAccountId),
    ...(sessionId && { sessionId: new ObjectId(sessionId) }),
    ...(eventId && { initiatingEventId: new ObjectId(eventId) }),
    serviceName: tool.service,
    toolId: tool.toolId,
    toolDisplayName: tool.displayName || tool.name || tool.toolId,
    requestPayload: { imageUrl },
    status: 'processing',
    deliveryStatus: initialDeliveryStatus,
    notificationPlatform: user.platform || 'none',
    pointsSpent: 0,
    protocolNetPoints: 0,
    costUsd: null,
    metadata: {
      ...tool.metadata,
      ...metadata,
      costRate: costRateInfo,
      platformContext: user.platformContext,
      ...(user.platform === 'web-sandbox' ? { notificationContext: { platform: 'web-sandbox' } } : {})
    }
  };

  const createResponse = await db.generationOutputs.createGenerationOutput(generationParams);
  generationRecord = createResponse;

  // --- Submit asynchronous HuggingFace interrogation ---
  (async () => {
    try {
      const description = await huggingfaceService.interrogateImage({ imageUrl });
      
      await db.generationOutputs.updateGenerationOutput(generationRecord._id, {
        status: 'completed',
        responsePayload: { description },
        outputs: [ { data: { description } } ]
      });

      // --- Points debit (follow OpenAI pattern lines 371-391) ---
      try {
        const costRate = generationRecord.metadata?.costRate;
        const costUsd = (costRate && typeof costRate.amount === 'number') ? costRate.amount : null;

        if (costUsd != null && costUsd > 0) {
          const usdPerPoint = 0.000337;
          const pointsToSpend = Math.max(1, Math.round(costUsd / usdPerPoint));
          const spendPayload = { pointsToSpend, spendContext: { generationId: generationRecord._id.toString(), toolId: generationRecord.toolId } };
          const headers = { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB };
          const internalApiClient = require('../../../utils/internalApiClient');
          await internalApiClient.post(`/internal/v1/data/users/${generationRecord.masterAccountId}/economy/spend`, spendPayload, { headers });
          await db.generationOutputs.updateGenerationOutput(generationRecord._id, {
            pointsSpent: pointsToSpend,
            protocolNetPoints: pointsToSpend,
            costUsd
          });
        }
      } catch (spendErr) {
        logger.error(`[Execute] Points debit failed for JoyTag interrogation ${generationRecord._id}: ${spendErr.message}`);
      }

      // Emit generationUpdated event (lines 394-400)
      try {
        const notificationEvents = require('../../../core/events/notificationEvents');
        const updatedRecord = await db.generationOutputs.findGenerationById(generationRecord._id);
        notificationEvents.emit('generationUpdated', updatedRecord);
      } catch(eventErr) {
        logger.warn(`[Execute] Failed to emit generationUpdated for JoyTag ${generationRecord._id}: ${eventErr.message}`);
      }
    } catch (err) {
      logger.error(`[Execute] HuggingFace interrogation error for tool '${toolId}' (async): ${err.message}`);
      const cleanMsg = (err?.message || '').slice(0, 180);
      await db.generationOutputs.updateGenerationOutput(generationRecord._id, {
        status: 'failed',
        statusReason: cleanMsg || 'Interrogation failed',
        'metadata.error': {
          message: err.message,
          stack: err.stack,
          step: 'huggingface_interrogation'
        }
      });
      try {
        const notificationEvents = require('../../../core/events/notificationEvents');
        const updatedRecord = await db.generationOutputs.findGenerationById(generationRecord._id);
        notificationEvents.emit('generationUpdated', updatedRecord);
      } catch(eventErr) {
        logger.warn(`[Execute] Failed to emit generationUpdated after error for JoyTag ${generationRecord._id}: ${eventErr.message}`);
      }
    }
  })();

  const estSeconds = 15; // Interrogation is typically faster than generation
  return res.status(202).json({ 
    generationId: generationRecord._id.toString(), 
    status: 'processing', 
    estimatedDurationSeconds: estSeconds, 
    message: 'Image interrogation started. Poll status endpoint for completion.' 
  });
}
```

**Important**: 
- Add `huggingfaceService` to the dependencies destructure at line 6:
  ```javascript
  const { logger, db, toolRegistry, comfyUIService, openaiService, huggingfaceService, internalApiClient, loraResolutionService, stringService, webSocketService: websocketServer } = dependencies;
  ```
- Update the dependency check at line 10 if needed

### 5. Testing

**Manual Test Steps**:
1. Restart the application to load the new service and tool
2. Verify tool appears in tool registry: `GET /api/v1/tools/registry`
3. Test execution via internal API:
   ```bash
   POST /internal/v1/data/execute
   {
     "toolId": "joytag",
     "inputs": { "imageUrl": "https://example.com/test-image.jpg" },
     "user": { 
       "masterAccountId": "TEST_ACCOUNT_ID",
       "platform": "web-sandbox" 
     }
   }
   ```
4. Check generation output status and verify description is returned
5. Test via Telegram (if applicable) - command should auto-register as `/joytag`

## Validation Checklist

- [ ] HuggingFace service created and properly handles 2-step API flow
- [ ] Service has proper error handling for quota, network, and parsing errors
- [ ] Tool definition follows the pattern with all required fields
- [ ] Category is set to 'interrogate' (valid category)
- [ ] Service is initialized in `src/core/services/index.js`
- [ ] Execution route added to `generationExecutionApi.js`
- [ ] huggingfaceService added to dependencies
- [ ] Async execution pattern matches OpenAI (create record, async process, update record)
- [ ] Points debit implemented
- [ ] generationUpdated events emitted on success and failure
- [ ] Tool appears in registry API
- [ ] Tool execution completes successfully
- [ ] Proper response format returned to user

## Notes

- The HuggingFace Space API is free but may have rate limits - handle quota errors gracefully
- The event ID extraction from legacy code uses string parsing - verify this still works with current API
- Consider adding timeout handling for the streaming request (typically 30-60 seconds)
- The tool should work across all platforms (Telegram, Discord, Web) automatically once implemented
- Image URLs must be publicly accessible for HuggingFace to fetch them

## Reference Files

- Legacy implementation: `archive/deluxebot/utils/bot/handlers/iWork.js` (lines 618-803)
- OpenAI service pattern: `src/core/services/openai/openaiService.js`
- OpenAI tool definitions: `src/core/tools/definitions/chatgpt.js` and `dalleImage.js`
- OpenAI execution route: `src/api/internal/generations/generationExecutionApi.js` (lines 309-425)
- Service initialization: `src/core/services/index.js`
- Tool registry validation: `src/core/tools/ToolRegistry.js` (line 185 for valid categories)

