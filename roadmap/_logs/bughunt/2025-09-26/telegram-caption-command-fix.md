# Bug Hunt Log: Telegram Caption Command Fix

**Date**: 2025-09-26  
**Severity**: S2 (Major feature broken)  
**Status**: FIXED  

## Problem Description

When users send a Telegram message with a photo and include a command in the caption (e.g., `/effect make it pretty` as a photo caption), the command fails to execute. However, when users reply to a photo message with text containing the command, it works correctly.

**Working case**:
```
[message 1, includes photo]
[message 2, replies to message 1, text: "/effect make it pretty"]
```

**Failing case**:
```
[message 1, includes photo, caption: "/effect make it pretty"]
```

## Root Cause Analysis

The issue was in the `CommandDispatcher.handle` method in `src/platforms/telegram/dispatcher.js` at line 139. The method was only checking `message.text` for command matching:

```javascript
const match = message.text.match(regex);
```

However, when a user sends a photo with a caption containing a command, Telegram puts the command text in `message.caption`, not `message.text`. This caused a `TypeError: Cannot read properties of undefined (reading 'match')` error.

The `DynamicCommandDispatcher` was already correctly handling both cases:
```javascript
const result = this.commandRegistry.findHandler(message.text || message.caption);
```

## Solution

**Issue 1**: Updated the `CommandDispatcher.handle` method to check both `message.text` and `message.caption`:

```javascript
const match = (message.text || message.caption || '').match(regex);
```

**Issue 2**: The old message filter was too aggressive (2 minutes), causing photo caption commands to be filtered out. Increased the filter to 15 minutes:

```javascript
const MESSAGE_AGE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes in milliseconds
```

## Files Modified

- `src/platforms/telegram/dispatcher.js` (line 139) - Fixed caption handling
- `src/platforms/telegram/bot.js` (line 130) - Increased message age limit

## Verification

The fix ensures that:
1. Commands in photo captions are properly matched and executed
2. Commands in text messages continue to work as before
3. No breaking changes to existing functionality

## Impact

- **Before**: Photo + caption commands failed with TypeError
- **After**: Photo + caption commands work identically to reply commands
- **User Experience**: Users can now use commands in photo captions seamlessly

## Related Issues

This fix resolves the discrepancy between reply-based commands and caption-based commands for image processing workflows.
