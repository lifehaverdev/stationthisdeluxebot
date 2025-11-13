# Platform Abstraction Layer

This directory contains the platform abstraction layer that allows platform-agnostic code to work with both Telegram and Discord.

## Structure

- `PlatformAdapter.js` - Abstract base class that all platform adapters must implement
- `types.js` - JSDoc type definitions for platform-agnostic operations
- `index.js` - Module exports

## Usage

### Creating an Adapter

**Telegram:**
```javascript
const TelegramAdapter = require('../telegram/adapter');
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(token, { polling: true });
const adapter = new TelegramAdapter(bot, { logger });
```

**Discord:**
```javascript
const DiscordAdapter = require('../discord/adapter');
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [...] });
await client.login(token);
const adapter = new DiscordAdapter(client, { logger, token });
```

### Using the Adapter

```javascript
// Send a message (works on both platforms)
await adapter.sendMessage(channelId, 'Hello!', {
  replyToMessageId: originalMessageId,
  buttons: [
    [
      { text: 'Button 1', action: 'action:param1' },
      { text: 'Button 2', action: 'action:param2' }
    ]
  ]
});

// Send a photo
await adapter.sendPhoto(channelId, photoBuffer, {
  caption: 'Check this out!',
  buttons: [[{ text: 'Like', action: 'like:123' }]]
});

// Edit a message
await adapter.editMessage(channelId, messageId, 'Updated text', {
  buttons: [[{ text: 'New Button', action: 'new:action' }]]
});

// Set a reaction
await adapter.setReaction(channelId, messageId, '👍');

// Check if user is admin
const isAdmin = await adapter.isAdmin(channelId, userId);
```

## Platform-Specific Notes

### Discord
- Interactions must be responded to within 3 seconds (use `storeInteraction()` and `answerCallback()`)
- Button limit: 5 rows × 5 buttons (25 total)
- Uses slash commands instead of text commands
- File size limit: 25MB

### Telegram
- No hard button limit (but UI limits apply)
- Uses text commands (`/command`)
- File size limits vary by file type
- Reactions have limited emoji set

## Next Steps

1. Integrate adapters into existing platform initialization
2. Refactor component managers to use adapters
3. Create shared menu builders
4. Migrate dispatchers to work with adapters

