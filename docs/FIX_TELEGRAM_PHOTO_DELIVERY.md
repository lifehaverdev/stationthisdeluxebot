# Fix Telegram Photo Delivery for ComfyUI Images

## Problem Statement

ComfyUI tools output PNG images that should be delivered on Telegram using `sendPhoto`, but they are currently being sent as documents using `sendDocument`. This is a regression - it used to work correctly before the output normalization system was implemented.

**Evidence from logs:**
```
[TelegramNotifier] Successfully fetched 1022792 bytes for document from https://comfy-deploy-output.s3.us-east-2.amazonaws.com/outputs/runs/.../stbflux_00003_.png. Sending to Telegram.
```

The URL clearly ends in `.png`, indicating it's an image, but it's being treated as a document.

## Current Architecture

### Output Normalization System

The system uses a centralized `ResponsePayloadNormalizer` located at:
- `src/core/services/notifications/ResponsePayloadNormalizer.js`

**Key Methods:**
1. `normalize(responsePayload, options)` - Converts any format to normalized array format
2. `extractMedia(normalizedPayload)` - Extracts media and determines type ('photo', 'video', 'document', etc.)

### Flow

1. **ComfyUI Webhook** (`src/core/services/comfydeploy/webhookProcessor.js`)
   - Receives webhook payload with `outputs` field
   - Sets `responsePayload: outputs` on generation record (line 304)
   - ComfyUI sends outputs as: `{ "3": ["https://...image.png"], "4": ["https://...image2.png"] }` (node IDs as keys, URL arrays as values)

2. **TelegramNotifier** (`src/platforms/telegram/telegramNotifier.js`)
   - Calls `ResponsePayloadNormalizer.normalize()` on `generationRecord.responsePayload` (line 82-85)
   - Calls `ResponsePayloadNormalizer.extractMedia()` to get media items (line 89)
   - Processes media items and sends via Telegram (lines 96-143)

3. **ResponsePayloadNormalizer.normalize()**
   - Should detect ComfyUI format (object with numeric keys containing URL arrays)
   - Should convert to `{ type: 'file', data: { files: [...] } }` format
   - Recent fix added Format 11 detection for ComfyUI format

4. **ResponsePayloadNormalizer.extractMedia()**
   - Processes normalized payload
   - For `item.data.files` arrays, determines media type
   - Should detect PNG URLs and set `mediaType = 'photo'`
   - Recent fix added URL-based detection as fallback when format/filename/subfolder are missing

## Expected Behavior

1. ComfyUI webhook sends: `{ "3": ["https://...image.png"] }`
2. `normalize()` detects ComfyUI format and converts to: `[{ type: 'file', data: { files: [{ url: "https://...image.png" }] } }]`
3. `extractMedia()` processes files array, detects `.png` in URL, returns: `[{ type: 'photo', url: "https://...image.png" }]`
4. TelegramNotifier receives `media.type === 'photo'` and sends via `sendPhotoWithEscapedCaption()`

## Actual Behavior

1. ComfyUI webhook sends: `{ "3": ["https://...image.png"] }`
2. `normalize()` may or may not detect ComfyUI format correctly
3. `extractMedia()` returns `media.type === 'document'` instead of `'photo'`
4. TelegramNotifier sends via `sendDocumentWithEscapedCaption()`

## Investigation Tasks

### Task 1: Verify ComfyUI Output Format
1. Check what format ComfyUI actually sends in the webhook payload
2. Add logging in `webhookProcessor.js` line 304 to log the exact `outputs` format
3. Verify if it's `{ "3": ["url"] }` or a different format

### Task 2: Trace Normalization Flow
1. Add debug logging in `ResponsePayloadNormalizer.normalize()` to show:
   - What format was detected
   - What normalized output was produced
2. Add debug logging in `ResponsePayloadNormalizer.extractMedia()` to show:
   - What media items were extracted
   - What type was assigned to each item
   - Why each type was chosen (which condition matched)

### Task 3: Check TelegramNotifier Processing
1. Verify the debug logs at line 92-93 are showing correct media types
2. Check if `sendAsDocument` flag is incorrectly set (line 76)
3. Verify the media processing loop (lines 96-143) is handling photos correctly

### Task 4: Fix the Issue
Based on investigation results, fix one or more of:
- ComfyUI format detection in `normalize()`
- URL-based image detection in `extractMedia()`
- Media type handling in TelegramNotifier
- Any other issue discovered

## Key Files to Modify

1. `src/core/services/notifications/ResponsePayloadNormalizer.js`
   - `normalize()` method - Format 11 ComfyUI detection (around line 162-180)
   - `extractMedia()` method - URL-based image detection (around line 298-313)

2. `src/platforms/telegram/telegramNotifier.js`
   - Media extraction and processing (lines 81-143)
   - Debug logging (lines 92-93, 99)

3. `src/core/services/comfydeploy/webhookProcessor.js`
   - Output format logging (around line 304)

## Testing

After fixing:
1. Trigger a ComfyUI tool execution
2. Check logs for:
   - `[ResponsePayloadNormalizer]` logs showing format detection
   - `[TelegramNotifier]` logs showing media type as 'photo'
   - Telegram delivery using `sendPhoto` instead of `sendDocument`
3. Verify image appears as photo in Telegram (not as downloadable document)

## Notes

- The normalization system was recently refactored to centralize output handling
- Previous ad-hoc logic in TelegramNotifier was replaced with centralized normalizer
- This change may have broken ComfyUI image detection
- The fix should work within the normalization system architecture, not bypass it

## Success Criteria

- ComfyUI PNG images are sent as photos (`sendPhoto`) on Telegram
- Logs show `media.type === 'photo'` for PNG images
- No regression for other tool types (ChatGPT, DALL-E, etc.)
- Code follows the normalization system architecture

