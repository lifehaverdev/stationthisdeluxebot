# Discord Message Reference Documentation

This document contains reference information about Discord's Message Reference system, extracted from the official Discord API documentation.

## Message Reference Interface

```typescript
interface MessageReference {
  channelId: Snowflake;
  guildId?: Snowflake;
  messageId?: Snowflake;
  type: MessageReferenceType;
}
```

### Properties

- **channelId**: The channel id that was referenced
- **guildId**: The guild id that was referenced (optional)
- **messageId**: The message id that was referenced (optional)
- **type**: The type of message reference

## Message Reference Types

| Type | Value | Description |
|------|-------|-------------|
| DEFAULT | 0 | A standard reference used by replies |
| FORWARD | 1 | Reference used to point to a message at a point in time |

## Message Reference Content Attribution

Message references are generic attribution on a message. There are multiple message types that have a `message_reference` object.

### Replies (Type 19)

These are messages replying to a previous message.

- These messages have `message_id` and `channel_id`, and `guild_id` if it is in a guild
- The `channel_id` and `guild_id` will be the same as the reply
- **These messages can have the referenced message resolved in the `referenced_message` field**

This is the key insight: When receiving a reply message, Discord may already include the referenced message in the `referenced_message` field, eliminating the need to fetch it separately.

### Other Message Types with References

- **Crosspost messages**: Have all three fields pointing to the original message
- **Channel Follow Add messages** (type 12): Have `channel_id` and `guild_id`
- **Pin messages** (type 6): Have `message_id`, `channel_id`, and optionally `guild_id`
- **Forwards**: Have `message_snapshot` objects containing a copy of the original message
- **Thread Created messages** (type 18): Have `channel_id` and `guild_id`
- **Thread starter messages** (type 21): Can have `referenced_message` resolved
- **Context Menu Command messages** (type 23): Can have `referenced_message` resolved

## Message Reference Object Structure

```json
{
  "type": 0,
  "message_id": "306588351130107906",
  "channel_id": "278325129692446722",
  "guild_id": "278325129692446720",
  "fail_if_not_exists": true
}
```

### Fields

- **type?**: Type of reference (integer)
- **message_id?**: ID of the originating message (snowflake)
- **channel_id?**: ID of the originating message's channel (snowflake)
- **guild_id?**: ID of the originating message's guild (snowflake)
- **fail_if_not_exists?**: When sending, whether to error if the referenced message doesn't exist (default: true)

## Key Insights for Implementation

1. **Referenced Message May Be Resolved**: When receiving a reply message, check for `message.referencedMessage` (Discord.js) or `message.referenced_message` (raw API) - the referenced message may already be included!

2. **Channel ID is Always Present**: When receiving a message with a reference, `channel_id` will always be present, even if optional when sending.

3. **Guild ID for Guild Channels**: `guild_id` is present for guild channels, absent for DMs.

4. **Unknown Message Errors**: If a message returns "Unknown Message" (error code 10008), it may be:
   - Deleted
   - Too old (outside cache/accessible range)
   - In a different channel/server without proper permissions
   - The message reference wasn't resolved in the original message

## Discord.js Implementation Notes

In Discord.js, message references are accessed via:
- `message.reference` - The MessageReference object
- `message.reference.messageId` - The referenced message ID
- `message.reference.channelId` - The referenced channel ID
- `message.reference.guildId` - The referenced guild ID (if in a guild)
- `message.referencedMessage` - **The resolved referenced message (if available)**

## Fetching Referenced Messages

### Method 1: Check if Already Resolved (Recommended)

```javascript
if (message.referencedMessage) {
  // Message is already resolved, use it directly
  const referencedMessage = message.referencedMessage;
}
```

### Method 2: Fetch by ID

```javascript
const referencedMessageId = message.reference.messageId;
const referencedChannelId = message.reference.channelId || message.channel.id;

try {
  const channel = await client.channels.fetch(referencedChannelId);
  const referencedMessage = await channel.messages.fetch(referencedMessageId);
} catch (error) {
  // Message might be deleted, too old, or inaccessible
  console.error('Could not fetch referenced message:', error);
}
```

### Method 3: Check in Batch Fetch

```javascript
// When fetching recent messages, check if referenced message is in the batch
const messages = await channel.messages.fetch({ limit: 100 });
const referencedMessage = messages.get(message.reference.messageId);
```

## Error Handling

When fetching referenced messages, handle these cases:

1. **Unknown Message (10008)**: Message doesn't exist, was deleted, or is inaccessible
2. **Missing Permissions**: Bot doesn't have VIEW_CHANNEL or READ_MESSAGE_HISTORY
3. **Cross-Channel References**: Message might be in a different channel
4. **Message Age**: Messages older than 2 weeks may not be accessible via bulk delete, but individual fetch should work if permissions allow

## Best Practices

1. **Always check `message.referencedMessage` first** before attempting to fetch
2. **Use the channel ID from the reference** when fetching, not the current channel
3. **Handle cross-channel references** by fetching the correct channel first
4. **Implement fallback mechanisms** for when referenced messages can't be fetched
5. **Check message age** - very old messages may not be accessible
6. **Respect rate limits** when fetching multiple messages

## References

- [Discord API Documentation - Message Reference](https://discord.com/developers/docs/resources/channel#message-object-message-reference-structure)
- [Discord.js Guide - Message References](https://discordjs.guide/)
- [Discord API - Message Types](https://discord.com/developers/docs/resources/channel#message-object-message-types)

