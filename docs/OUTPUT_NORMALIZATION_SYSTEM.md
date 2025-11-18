# Output Normalization System

## Overview

The Output Normalization System ensures that spell outputs from different tools and services are consistently formatted and delivered across all platforms (Telegram, Discord, Web). This prevents outputs from being dropped due to format mismatches.

## Problem Solved

Previously, different tools/services returned outputs in various formats:
- `{ result: "text" }` (ChatGPT, etc.)
- `[{ type: 'text', data: { text: ["..."] } }]` (normalized array format)
- `{ images: [...] }` (image format)
- `{ text: "..." }` (simple text)
- And many more variations...

Each platform notifier (Telegram, Discord, Web) had its own conversion logic, leading to:
- Inconsistent handling across platforms
- Missing format conversions (Discord didn't handle `{ result: "text" }`)
- Duplicate conversion code
- Outputs being dropped when formats didn't match expectations

## Solution

Created a centralized `ResponsePayloadNormalizer` utility that:
1. **Normalizes** all output formats into a consistent array structure
2. **Extracts** text and media from normalized payloads
3. **Converts** to platform-specific formats when needed

## Architecture

### Core Component: `ResponsePayloadNormalizer`

**Location:** `src/core/services/notifications/ResponsePayloadNormalizer.js`

**Key Methods:**
- `normalize(responsePayload, options)` - Converts any format to normalized array format
- `extractText(normalizedPayload)` - Extracts all text outputs
- `extractMedia(normalizedPayload)` - Extracts all media (images, videos, files)
- `toWebFormat(normalizedPayload)` - Converts to web-friendly format

### Normalized Format

All outputs are normalized to:
```javascript
[
  {
    type: 'text' | 'image' | 'video' | 'file' | 'unknown',
    data: {
      text: string[] | undefined,
      images: Array<{ url: string, ... }> | undefined,
      files: Array<{ url: string, format?: string, ... }> | undefined
    }
  }
]
```

### Supported Input Formats

The normalizer handles these input formats:

1. **Array format** (already normalized)
   ```javascript
   [{ type: 'text', data: { text: ["..."] } }]
   ```

2. **Simple result** (ChatGPT, etc.)
   ```javascript
   { result: "text" }
   ```

3. **Text fields**
   ```javascript
   { text: "..." }
   { response: "..." }
   { description: "..." }
   ```

4. **Images**
   ```javascript
   { images: [...] }
   { imageUrl: "..." }
   { image: "..." }
   { artifactUrls: [...] }
   ```

5. **Videos**
   ```javascript
   { videoUrl: "..." }
   { video: "..." }
   ```

6. **Files**
   ```javascript
   { files: [...] }
   ```

7. **String**
   ```javascript
   "text"
   ```

8. **Legacy formats**
   ```javascript
   { outputs: [...] }
   ```

## Platform Integration

### WebSandboxNotifier

**Changes:**
- Uses `ResponsePayloadNormalizer.normalize()` to normalize payloads
- Uses `ResponsePayloadNormalizer.toWebFormat()` to convert to web-friendly format
- Ensures consistent format delivery to frontend

**Before:**
```javascript
outputs: generationRecord.responsePayload  // Raw, unnormalized
```

**After:**
```javascript
const normalizedPayload = ResponsePayloadNormalizer.normalize(
  generationRecord.responsePayload,
  { logger: this.logger }
);
const webOutputs = ResponsePayloadNormalizer.toWebFormat(normalizedPayload);
outputs: webOutputs  // Normalized and web-friendly
```

### TelegramNotifier

**Changes:**
- Refactored to use shared normalizer instead of custom conversion logic
- Uses `extractText()` and `extractMedia()` helper methods
- Maintains Telegram-specific formatting (documents, captions, etc.)

**Before:**
```javascript
// Custom conversion logic for { result: "text" }
if (generationRecord.responsePayload.result) {
  payloadArray = [{ data: { text: [generationRecord.responsePayload.result] } }];
}
// ... many more format-specific conversions
```

**After:**
```javascript
const normalizedPayload = ResponsePayloadNormalizer.normalize(
  generationRecord.responsePayload,
  { logger: this.logger }
);
const textOutputs = ResponsePayloadNormalizer.extractText(normalizedPayload);
const extractedMedia = ResponsePayloadNormalizer.extractMedia(normalizedPayload);
```

### DiscordNotifier

**Changes:**
- Added missing `{ result: "text" }` format handling
- Uses shared normalizer instead of custom logic
- Consistent with TelegramNotifier implementation

**Before:**
```javascript
// Missing { result: "text" } handling - outputs were dropped!
let payloadArray = Array.isArray(generationRecord.responsePayload)
  ? generationRecord.responsePayload
  : null;
```

**After:**
```javascript
const normalizedPayload = ResponsePayloadNormalizer.normalize(
  generationRecord.responsePayload,
  { logger: this.logger }
);
// Now handles ALL formats including { result: "text" }
```

### Frontend (websocketHandlers.js)

**Changes:**
- Added fallback handling for `{ result: "text" }` format
- Improved text array handling (joins multiple text items)
- Better error handling for unknown formats

**Before:**
```javascript
// Missing { result: "text" } handling
else if (outputs.text) {
  outputData = { type: 'text', text: outputs.text, generationId };
}
```

**After:**
```javascript
else if (outputs.text) {
  outputData = { type: 'text', text: outputs.text, generationId };
} else if (outputs.result) {
  // Fallback for { result: "text" } (should be normalized by backend)
  outputData = { type: 'text', text: outputs.result, generationId };
}
```

## Benefits

1. **Consistency**: All platforms handle outputs the same way
2. **Reliability**: No outputs dropped due to format mismatches
3. **Maintainability**: Single source of truth for format conversion
4. **Extensibility**: Easy to add support for new formats
5. **Testing**: Can test normalization logic independently

## Testing Checklist

- [ ] Cast a spell with async adapter tool (e.g., JoyCaption) on web sandbox
- [ ] Verify output displays correctly in SpellWindow
- [ ] Verify cost displays correctly (not NaN)
- [ ] Cast the same spell on Telegram
- [ ] Verify Telegram output still works
- [ ] Cast the same spell on Discord
- [ ] Verify Discord output works (previously broken for `{ result: "text" }`)
- [ ] Test with different output types (text, images, videos)
- [ ] Test with multi-step spells
- [ ] Test with immediate tools vs async tools
- [ ] Test with ChatGPT-style `{ result: "text" }` format
- [ ] Test with ComfyDeploy image outputs
- [ ] Test with file outputs

## Migration Notes

### For Developers

When adding new tools/services:
1. Output formats will be automatically normalized
2. No need to worry about platform-specific formatting
3. If a new format isn't recognized, it will be wrapped in `{ type: 'unknown', data: ... }`

### For Tool Developers

Tools can return outputs in any format - the normalizer will handle conversion. However, for best results, use the normalized array format:

```javascript
[
  {
    type: 'text',
    data: { text: ["Your text here"] }
  }
]
```

Or for images:
```javascript
[
  {
    type: 'image',
    data: { images: [{ url: "https://..." }] }
  }
]
```

## Related Files

- `src/core/services/notifications/ResponsePayloadNormalizer.js` - Core normalizer
- `src/platforms/web/webSandboxNotifier.js` - Web platform notifier
- `src/platforms/telegram/telegramNotifier.js` - Telegram notifier
- `src/platforms/discord/discordNotifier.js` - Discord notifier
- `src/platforms/web/client/src/sandbox/node/websocketHandlers.js` - Frontend handler
- `docs/SPELL_OUTPUT_FORMAT_DISCREPANCY.md` - Original problem documentation

## Future Improvements

1. **Type Safety**: Add TypeScript or JSDoc types for better IDE support
2. **Validation**: Add runtime validation for normalized formats
3. **Metrics**: Track which formats are most common
4. **Documentation**: Auto-generate format documentation from normalizer code
5. **Testing**: Add unit tests for each supported format

