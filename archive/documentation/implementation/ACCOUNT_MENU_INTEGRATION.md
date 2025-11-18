# Account Menu Integration - Platform Linking

## Summary

Platform linking functionality has been successfully integrated into the `/account` menu for both Telegram and Discord platforms. Users can now access platform linking through:

1. **Direct command**: `/link <walletAddress>` (both platforms)
2. **Account menu**: `/account` → "🔗 Link Platform" button (both platforms)

## Implementation Details

### Telegram Integration

**File:** `src/platforms/telegram/components/dashboardMenuManager.js`

**Changes:**
- Added "🔗 Link Platform" button to main account menu
- Shows count of linked platforms: `🔗 Link Platform (2 linked)`
- Added `displayLinkPlatformMenu()` function
- Added `handleLinkPlatformCallback()` for sub-actions
- Added `displayPendingRequests()` function
- Added `displayLinkedPlatforms()` function

**Menu Flow:**
1. User runs `/account`
2. Sees "🔗 Link Platform" button (with count if platforms linked)
3. Clicks button → Shows platform linking menu
4. Options:
   - "🔗 Link New Platform" → Prompts for `/link <wallet>` command
   - "📬 View Requests (N)" → Shows pending approval requests
   - "📋 View Linked Platforms" → Lists all linked platforms
   - "← Back" → Returns to main account menu

### Discord Integration

**Files Created:**
- `src/platforms/discord/commands/accountCommand.js` - `/account` command handler
- `src/platforms/discord/components/accountMenuManager.js` - Account menu interactions
- `src/platforms/discord/components/linkManager.js` - `/link` command handler

**Features:**
- `/account` command shows account info with "🔗 Link Platform" button
- `/link <wallet>` command for direct linking
- Same menu flow as Telegram
- Uses Discord embeds and buttons for better UX

**Menu Flow:**
1. User runs `/account`
2. Sees embed with account info and "🔗 Link Platform" button
3. Clicks button → Shows platform linking menu (embed)
4. Same options as Telegram (buttons instead of inline keyboard)

## User Experience

### Telegram Flow
```
/account
  ↓
[Account Dashboard]
  ↓
[🔗 Link Platform (2 linked)] ← Click
  ↓
[Platform Linking Menu]
  - 🔗 Link New Platform
  - 📬 View Requests (1)
  - 📋 View Linked Platforms
  - ← Back
```

### Discord Flow
```
/account
  ↓
[Account Embed with buttons]
  ↓
[🔗 Link Platform (2 linked)] ← Click
  ↓
[Platform Linking Embed]
  - 🔗 Link New Platform
  - 📬 View Requests (1)
  - 📋 View Linked Platforms
  - ← Back
```

## Testing Checklist

- [x] Telegram `/account` command shows link platform button
- [x] Telegram link platform menu displays correctly
- [x] Telegram can view pending requests from account menu
- [x] Telegram can view linked platforms from account menu
- [x] Discord `/account` command works
- [x] Discord link platform button appears in account menu
- [x] Discord link platform menu displays correctly
- [x] Discord can view pending requests from account menu
- [x] Discord can view linked platforms from account menu
- [ ] End-to-end test: Request link from Telegram, approve from Discord
- [ ] End-to-end test: Request link from Discord, approve from Telegram

## Files Modified

### Telegram
- `src/platforms/telegram/components/dashboardMenuManager.js` - Added platform linking menu

### Discord
- `src/platforms/discord/bot.js` - Registered account and link commands
- `src/platforms/discord/commands/accountCommand.js` - NEW - Account command handler
- `src/platforms/discord/components/accountMenuManager.js` - NEW - Account menu manager
- `src/platforms/discord/components/linkManager.js` - NEW - Link command handler

## Next Steps

1. Test both platforms end-to-end
2. Verify cross-platform approval flow works
3. Add notification sending when requests are created/approved
4. Implement expiration service for old requests

