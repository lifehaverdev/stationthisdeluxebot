# Troubleshooting "Unknown Message" Errors

## Current Situation

- ✅ `MESSAGE_CONTENT` intent is enabled in code
- ✅ `MESSAGE_CONTENT` intent is enabled in Developer Portal
- ❌ Messages still return "Unknown Message" when fetching

## Possible Causes & Solutions

### 1. Bot Needs Restart

**Issue**: After enabling the intent in Developer Portal, the bot needs to be restarted to pick up the change.

**Solution**: 
- Stop the bot completely
- Restart the bot
- Test again

### 2. Bot Needs Re-invitation

**Issue**: If the bot was already in the server before enabling the intent, it may need to be re-invited.

**Solution**:
1. Remove the bot from the server
2. Generate a new invite URL with the intent enabled
3. Re-invite the bot
4. Test again

### 3. Messages Are Outside Fetch Window

**Issue**: The messages you're replying to might be older than the 100-message window we're fetching.

**Solution**: The fallback mechanism should handle this, but check logs to see if messages are being found in the batch.

### 4. Permission Issues

**Issue**: Bot might not have `ViewChannel` or `ReadMessageHistory` permissions in the specific channel.

**Solution**: 
- Check server settings → Roles → Bot role
- Ensure bot has:
  - ✅ View Channels
  - ✅ Read Message History
  - ✅ Send Messages
  - ✅ Attach Files

### 5. Message Content Intent Not Actually Working

**Issue**: Even though intent is enabled, Discord.js might not be receiving message content.

**Diagnostic**: Check the new logs for:
```
[Discord Utils] Intent diagnostic: Found X user messages in batch, Y have readable content
```

If `Y` is 0 but `X` > 0, the intent is not working.

### 6. Messages Were Deleted

**Issue**: The messages you're replying to might have been deleted.

**Solution**: Check if the messages still exist in Discord. Deleted messages will always return "Unknown Message".

### 7. Cross-Channel References

**Issue**: If you're replying to a message in a different channel, the bot might not have access.

**Solution**: Check logs for "Cross-channel reference detected" messages.

## Diagnostic Steps

1. **Check Intent is Working**:
   - Look for log: `Intent diagnostic: Found X user messages in batch, Y have readable content`
   - If Y = 0 and X > 0, intent is not working

2. **Check Permissions**:
   - Look for log: `Bot permissions in channel: { hasViewChannel: true, hasReadHistory: true }`
   - If either is false, fix permissions

3. **Check Message Age**:
   - Look at the timestamps in logs
   - If messages are very old (>100 messages ago), they won't be in the batch

4. **Check Referenced Message Resolution**:
   - Look for: `✅ Referenced message already resolved on reply message!`
   - If you don't see this, Discord isn't resolving referenced messages

5. **Check Error Details**:
   - Look for: `Error details: { errorCode: ..., errorName: ... }`
   - Error code 10008 = Unknown Message (message doesn't exist or is inaccessible)

## Next Steps

After adding the diagnostic code, run the bot and check the logs. The new diagnostics will tell us:
- ✅ If the intent is actually working
- ✅ If the bot has the right permissions
- ✅ If referenced messages are being resolved
- ✅ What error codes we're getting

Share the new logs and we can pinpoint the exact issue!

