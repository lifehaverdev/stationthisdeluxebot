# Bug Hunt: Telegram Bot Processing Old Messages on Startup

**Date**: 2025-09-26  
**Severity**: S3 (Minor issue with workaround)  
**Status**: FIXED

## Problem Description
The Telegram bot was processing old messages when it started up, instead of only honoring messages sent within the last 15 minutes. This could cause the bot to respond to stale commands or process outdated requests.

## Root Cause
The bot's message handlers (`bot.on('message')` and `bot.on('photo')`) were processing all incoming messages without checking their age relative to the bot's startup time.

## Solution Implemented
Added timestamp filtering to both message handlers in `src/platforms/telegram/bot.js`:

1. **Startup Time Tracking**: Added `botStartupTime` variable to track when the bot initializes
2. **Message Age Limit**: Set `MESSAGE_AGE_LIMIT_MS` to 15 minutes (900,000ms)
3. **Age Filtering**: Added age check in both text and photo message handlers:
   - Convert Telegram timestamp to milliseconds
   - Calculate message age from current time
   - Skip processing if message is older than 15 minutes
   - Log debug message for filtered old messages

## Code Changes
```javascript
// Track bot startup time to filter old messages
const botStartupTime = Date.now();
const MESSAGE_AGE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes in milliseconds

// In message handlers:
const messageTime = message.date * 1000; // Convert Telegram timestamp to milliseconds
const messageAge = Date.now() - messageTime;

if (messageAge > MESSAGE_AGE_LIMIT_MS) {
  logger.debug(`[Bot] Ignoring old message (age: ${Math.round(messageAge / 1000)}s, limit: ${MESSAGE_AGE_LIMIT_MS / 1000}s)`);
  return;
}
```

## Verification Steps
1. Start the bot
2. Send a message to the bot
3. Wait 16+ minutes
4. Restart the bot
5. Verify the old message is not processed (check logs for debug message)

## Files Modified
- `src/platforms/telegram/bot.js` - Added timestamp filtering to message and photo handlers

## Follow-up Tasks
- [ ] Test the fix in production environment
- [ ] Monitor logs for any unexpected behavior
- [ ] Consider making the 15-minute limit configurable if needed
