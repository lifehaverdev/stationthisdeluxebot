# Discord Message Context Menu Solution

## The Problem

**Slash commands (`/effect`) don't have access to message references.** When a user replies to a message and then uses a slash command, Discord doesn't provide the replied-to message in the interaction.

## The Solution: Message Context Menu Commands

Discord supports **Message Context Menu Commands** (type 3) which ARE designed for this exact use case. When a user right-clicks a message and selects a command, the interaction includes `interaction.targetId` which is the ID of the message they right-clicked.

## Discord Application Command Types

| Type | Name | Description |
|------|------|-------------|
| 1 | CHAT_INPUT | Slash commands (what we currently use) |
| 2 | USER | User context menu (right-click user) |
| 3 | MESSAGE | Message context menu (right-click message) ← **This is what we need** |

## Implementation Strategy

### Option 1: Replace Slash Commands with Message Context Menu Commands

**Pros:**
- Precise - always knows which message the user selected
- No guessing or fallback logic needed
- Better UX for image-based commands

**Cons:**
- Different user interaction pattern (right-click vs typing `/effect`)
- Users need to learn new workflow

### Option 2: Support Both (Recommended)

**Pros:**
- Backward compatible with existing slash commands
- Users can choose their preferred method
- Slash commands can still work with fallback logic for non-reply cases

**Cons:**
- More code to maintain
- Need to register both command types

## What to Search For

When researching Discord's documentation, search for:

1. **"Discord application command types"** - Understanding the different command types
2. **"Discord message context menu command"** - How to register and handle type 3 commands
3. **"Discord.js interaction.isMessageContextMenuCommand"** - How to detect message context menu interactions
4. **"Discord.js interaction.targetId"** - How to access the target message ID
5. **"Discord API register message context menu"** - Official API documentation

## Key Discord.js Methods

```javascript
// Check if interaction is a message context menu command
interaction.isMessageContextMenuCommand()

// Get the target message ID
interaction.targetId

// Fetch the target message
const targetMessage = await interaction.channel.messages.fetch(interaction.targetId);
```

## Current Code Status

✅ **Already implemented:** The code in `discordUtils.js` already checks for `interaction.targetId`:
```javascript
const referencedMessageId = interaction.messageReference?.messageId || interaction.targetId;
```

❌ **Missing:** 
- Registration of message context menu commands (type 3)
- Handler for `interaction.isMessageContextMenuCommand()`
- Routing message context menu commands to existing handlers

## Next Steps

1. **Research:** Search Discord.js documentation for message context menu command examples
2. **Implement:** Add message context menu command registration alongside slash commands
3. **Handle:** Add interaction handler for message context menu commands
4. **Test:** Verify that right-clicking a message and selecting "Apply Effect" works correctly

## References

- [Discord API Application Command Types](https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-types)
- [Discord.js Message Context Menu Guide](https://discordjs.guide/interactions/context-menus.html#message-context-menus)
- Our own `DISCORD_MESSAGE_REFERENCE_DOCS.md` mentions: "Context Menu Command messages (type 23): Can have referenced_message resolved"

