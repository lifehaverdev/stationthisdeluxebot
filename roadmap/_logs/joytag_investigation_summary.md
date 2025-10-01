# JoyTag Investigation Summary

## Date
2025-10-01

## Objective
Investigate how to add a new static tool called "joytag" for image interrogation using HuggingFace Spaces API, migrating functionality from the legacy `/interrogate` command.

## Investigation Findings

### 1. Legacy Implementation Analysis

**Location**: `archive/deluxebot/utils/bot/handlers/iWork.js` (lines 618-803)

**Architecture**:
- Used HuggingFace Joy Caption API: `https://fancyfeast-joy-caption-pre-alpha.hf.space`
- Two-step process:
  1. POST to `/call/stream_chat` with image URL → receives event ID
  2. GET to `/call/stream_chat/{eventId}` → streams result via Server-Sent Events

**Key Features**:
- Error handling for quota/rate limits
- SSE response parsing
- Image URL handling via Telegram photo API

### 2. Modern Tool System Architecture

**Tool Definition Pattern**:
- Location: `src/core/tools/definitions/`
- Structure: Tool object with metadata, input/output schemas, costing model
- Auto-registration: Files loaded automatically by ToolRegistry
- Valid categories: text-to-image, img2img, image-to-image, upscale, inpaint, video, **interrogate**, text-to-text

**Service Pattern**:
- Location: `src/core/services/{provider}/`
- Example: `openai/openaiService.js`
- Constructor: Accepts `{ logger }` options
- Methods: Service-specific operations (e.g., `interrogateImage()`)
- Error handling: Sanitized error messages

**Execution Flow**:
1. Tool registry loads definitions on startup (`src/core/services/index.js`)
2. Services initialized and added to dependencies
3. Execution routed by `service` field in tool definition
4. Switch statement in `src/api/internal/generations/generationExecutionApi.js`
5. Service method called asynchronously
6. Generation record created/updated
7. Notification events emitted

### 3. OpenAI Service Pattern (Reference)

**Service** (`src/core/services/openai/openaiService.js`):
- Constructor initializes API client from env vars
- Methods: `executeChatCompletion()`, `generateImage()`
- Error sanitization (removes API keys from error messages)

**Tool Definitions**:
- `chatgpt.js`: Text-to-text LLM
- `dalleImage.js`: Text-to-image generation

**Execution Route** (lines 309-425):
```javascript
case 'openai': {
  // 1. Validate inputs
  // 2. Create generation record
  // 3. Async execution block
  //    - Call service method
  //    - Update generation record
  //    - Debit points
  //    - Emit events
  // 4. Return 202 Accepted with generation ID
}
```

### 4. Implementation Requirements

**New Files Needed**:
1. `src/core/services/huggingface/huggingfaceService.js` - Service implementation
2. `src/core/tools/definitions/joytag.js` - Tool definition

**File Modifications**:
1. `src/core/services/index.js` - Initialize and export service
2. `src/api/internal/generations/generationExecutionApi.js` - Add execution case

**Key Considerations**:
- Category: `'interrogate'` (valid for image-to-text tools)
- Service name: `'huggingface'`
- Tool ID: `'joytag'`
- Command: `/joytag`
- Input: Image URL (type: 'image', required: true)
- Output: Description text (type: 'string')
- Async execution pattern matches OpenAI
- Points debit using USD_PER_POINT = 0.000337
- Event emission for notification dispatcher

### 5. API Flow Details

**HuggingFace API Pattern**:
```javascript
// Step 1: Submit image for processing
POST https://fancyfeast-joy-caption-pre-alpha.hf.space/call/stream_chat
Body: { data: [{ path: imageUrl }] }
Response: { event_id: "..." }

// Step 2: Stream result
GET https://fancyfeast-joy-caption-pre-alpha.hf.space/call/stream_chat/{event_id}
Response: Server-Sent Events format
  event: generating
  data: null
  
  event: complete  
  data: ["Generated description text"]
```

**Response Parsing**:
- Split response by newlines
- Track error events
- Extract last valid JSON data event
- Parse and return first array element

### 6. Tool Registration Flow

1. **Startup**: `app.js` → `initializeServices()` → `toolRegistry.loadStaticTools()`
2. **Loading**: ToolRegistry scans `src/core/tools/definitions/` for .js/.json files
3. **Validation**: Checks required fields (toolId, service, category, etc.)
4. **Registration**: Tools added to registry Map
5. **API Exposure**: Available via `/api/v1/tools/registry` endpoint
6. **Platform Integration**: 
   - Telegram: Auto-creates commands from `commandName`
   - Web: Shows in tool selection UI
   - Discord: Available via tool registry

### 7. Execution Dependencies

**Required in generationExecutionApi.js**:
```javascript
const { 
  logger, 
  db, 
  toolRegistry, 
  comfyUIService, 
  openaiService, 
  huggingfaceService,  // ADD THIS
  internalApiClient, 
  loraResolutionService, 
  stringService, 
  webSocketService 
} = dependencies;
```

**Generation Record Fields**:
- `masterAccountId`: User's account ID (ObjectId)
- `serviceName`: 'huggingface'
- `toolId`: 'joytag'
- `requestPayload`: { imageUrl }
- `status`: 'processing' → 'completed' or 'failed'
- `responsePayload`: { description }
- `outputs`: [{ data: { description } }] (legacy format)
- `metadata`: Tool metadata + cost rate + platform context

## Recommendations

1. **Service Implementation**:
   - Use native `fetch` for HTTP requests
   - Implement robust SSE parsing
   - Handle quota/rate limit errors gracefully
   - Add timeout protection (30-60s)

2. **Error Handling**:
   - Network errors
   - Invalid event IDs
   - Empty/malformed responses
   - Rate limit exceeded
   - Quota exhausted

3. **Testing Strategy**:
   - Unit test service methods
   - Integration test via internal API
   - End-to-end test via Telegram/Web
   - Verify generation record updates
   - Check notification delivery

4. **Future Enhancements**:
   - Support multiple HuggingFace models
   - Add model selection parameter
   - Implement caching for repeated interrogations
   - Add retry logic for transient failures

## Next Steps

1. Review the implementation prompt: `agent_prompts/joytag_implementation_prompt.md`
2. Implement the HuggingFace service
3. Create the joytag tool definition
4. Add service initialization
5. Add execution route
6. Test thoroughly
7. Document any API changes or issues encountered

## References

- **Legacy Code**: `archive/deluxebot/utils/bot/handlers/iWork.js:618-803`
- **Service Pattern**: `src/core/services/openai/openaiService.js`
- **Tool Pattern**: `src/core/tools/definitions/chatgpt.js`, `dalleImage.js`
- **Execution Pattern**: `src/api/internal/generations/generationExecutionApi.js:309-425`
- **Initialization**: `src/core/services/index.js`
- **Validation**: `src/core/tools/ToolRegistry.js:185`

