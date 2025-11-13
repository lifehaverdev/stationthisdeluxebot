# Discord-Telegram Method Mapping Quick Reference

Quick reference guide for mapping Telegram Bot API methods to Discord.js equivalents.

## Message Operations

### Send Text Message

**Telegram**:
```javascript
await bot.sendMessage(chatId, text, {
  reply_to_message_id: messageId,
  parse_mode: 'MarkdownV2',
  reply_markup: { inline_keyboard: buttons }
});
```

**Discord**:
```javascript
await channel.send({
  content: text,
  reply: { messageReference: messageId },
  components: [new ActionRowBuilder().addComponents(buttons)]
});
```

**Key Differences**:
- Discord uses `content` instead of separate `text` parameter
- Discord `reply` uses `messageReference` object
- Discord uses `components` (ActionRowBuilder) instead of `reply_markup`
- Discord markdown is different from Telegram's MarkdownV2 (need conversion)

---

### Edit Message Text

**Telegram**:
```javascript
await bot.editMessageText(text, {
  chat_id: chatId,
  message_id: messageId,
  parse_mode: 'MarkdownV2',
  reply_markup: { inline_keyboard: buttons }
});
```

**Discord**:
```javascript
await message.edit({
  content: text,
  components: [new ActionRowBuilder().addComponents(buttons)]
});
```

**Key Differences**:
- Discord edits via message object, not separate method
- Components can be updated independently

---

### Delete Message

**Telegram**:
```javascript
await bot.deleteMessage(chatId, messageId);
```

**Discord**:
```javascript
await message.delete();
```

**Key Differences**:
- Discord uses message object method
- Both are straightforward

---

## Media Operations

### Send Photo

**Telegram**:
```javascript
await bot.sendPhoto(chatId, photoBuffer, {
  caption: 'Photo caption',
  reply_to_message_id: messageId,
  parse_mode: 'MarkdownV2',
  reply_markup: { inline_keyboard: buttons }
});
```

**Discord**:
```javascript
const attachment = new AttachmentBuilder(photoBuffer, { name: 'image.png' });
await channel.send({
  files: [attachment],
  content: 'Photo caption', // or use embed for caption
  reply: { messageReference: messageId },
  components: [new ActionRowBuilder().addComponents(buttons)]
});
```

**Key Differences**:
- Discord uses `AttachmentBuilder` for files
- Discord `files` is an array (can send multiple)
- Caption goes in `content` or embed `description`
- File size limits: Discord 25MB, Telegram varies

---

### Send Video

**Telegram**:
```javascript
await bot.sendVideo(chatId, videoBuffer, {
  caption: 'Video caption',
  reply_to_message_id: messageId
});
```

**Discord**:
```javascript
const attachment = new AttachmentBuilder(videoBuffer, { name: 'video.mp4' });
await channel.send({
  files: [attachment],
  content: 'Video caption',
  reply: { messageReference: messageId }
});
```

**Key Differences**:
- Same as photo, just different file type
- Discord handles video the same as any file

---

### Send Document

**Telegram**:
```javascript
await bot.sendDocument(chatId, docBuffer, {
  caption: 'Document caption',
  filename: 'document.pdf'
});
```

**Discord**:
```javascript
const attachment = new AttachmentBuilder(docBuffer, { name: 'document.pdf' });
await channel.send({
  files: [attachment],
  content: 'Document caption'
});
```

**Key Differences**:
- Discord uses `name` in AttachmentBuilder instead of separate `filename` option

---

## Interaction Operations

### Answer Callback Query / Interaction

**Telegram**:
```javascript
await bot.answerCallbackQuery(callbackQueryId, {
  text: 'Action completed',
  show_alert: false
});
```

**Discord**:
```javascript
// Immediate response (within 3 seconds)
await interaction.reply({
  content: 'Action completed',
  ephemeral: true // Only visible to user
});

// Or update existing message
await interaction.update({
  content: 'Updated content',
  components: []
});

// Or defer for later response
await interaction.deferReply();
// ... do work ...
await interaction.editReply({ content: 'Done!' });
```

**Key Differences**:
- Discord requires response within 3 seconds (use `deferReply()` for long operations)
- Discord has `reply()`, `update()`, `deferReply()`, `editReply()`, `followUp()`
- Discord `ephemeral` makes response only visible to user (like Telegram private chat)
- Telegram `show_alert` → Discord: use `ephemeral: true` or regular reply

---

### Set Reaction

**Telegram**:
```javascript
await bot.setMessageReaction(chatId, messageId, {
  reaction: [{ type: 'emoji', emoji: '👍' }]
});
```

**Discord**:
```javascript
await message.react('👍');
// Or with custom emoji
await message.react('1234567890123456789'); // Custom emoji ID
```

**Key Differences**:
- Discord reactions are simpler (just emoji string or ID)
- Discord supports custom emojis via ID
- Telegram has limited emoji set, Discord supports any emoji
- Discord reactions are user-initiated by default, bot can react

---

## Menu Systems

### Inline Keyboard → Message Components

**Telegram**:
```javascript
const keyboard = [
  [
    { text: 'Button 1', callback_data: 'action:param1' },
    { text: 'Button 2', callback_data: 'action:param2' }
  ],
  [
    { text: 'Back', callback_data: 'menu:back' }
  ]
];

await bot.sendMessage(chatId, 'Menu:', {
  reply_markup: { inline_keyboard: keyboard }
});
```

**Discord**:
```javascript
const row1 = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('action:param1')
      .setLabel('Button 1')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('action:param2')
      .setLabel('Button 2')
      .setStyle(ButtonStyle.Primary)
  );

const row2 = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('menu:back')
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
  );

await channel.send({
  content: 'Menu:',
  components: [row1, row2]
});
```

**Key Differences**:
- Discord uses builder pattern (ActionRowBuilder, ButtonBuilder)
- Discord `custom_id` replaces Telegram `callback_data`
- Discord has button styles (Primary, Secondary, Success, Danger, Link)
- Discord limits: 5 ActionRows, 5 buttons per row (25 total)
- Telegram has no hard limit (but UI limits apply)

---

### Edit Menu (Update Components)

**Telegram**:
```javascript
await bot.editMessageReplyMarkup(
  { inline_keyboard: newKeyboard },
  { chat_id: chatId, message_id: messageId }
);
```

**Discord**:
```javascript
await interaction.update({
  components: [newRow1, newRow2]
});

// Or edit message directly
await message.edit({
  components: [newRow1, newRow2]
});
```

**Key Differences**:
- Discord can update via interaction or message edit
- Components are updated the same way as initial send

---

### Select Menu

**Telegram**: Not natively supported (use inline keyboard with many buttons)

**Discord**:
```javascript
const selectMenu = new StringSelectMenuBuilder()
  .setCustomId('menu:select')
  .setPlaceholder('Choose an option')
  .addOptions(
    { label: 'Option 1', value: 'opt1', description: 'First option' },
    { label: 'Option 2', value: 'opt2', description: 'Second option' }
  );

const row = new ActionRowBuilder().addComponents(selectMenu);

await channel.send({
  content: 'Select an option:',
  components: [row]
});
```

**Key Differences**:
- Discord has native select menus (StringSelectMenu, UserSelectMenu, etc.)
- Telegram would need to simulate with many buttons
- Discord select menus are better for many options

---

## Command Operations

### Register Commands

**Telegram**:
```javascript
const commands = [
  { command: 'start', description: 'Start the bot' },
  { command: 'help', description: 'Show help' }
];

await bot.setMyCommands(commands, {
  scope: { type: 'all_private_chats' }
});
```

**Discord**:
```javascript
const commands = [
  {
    name: 'start',
    description: 'Start the bot',
    type: ApplicationCommandType.ChatInput
  },
  {
    name: 'help',
    description: 'Show help',
    type: ApplicationCommandType.ChatInput
  }
];

const rest = new REST({ version: '10' }).setToken(token);
await rest.put(
  Routes.applicationCommands(clientId),
  { body: commands }
);
```

**Key Differences**:
- Discord requires REST API for registration (not client method)
- Discord commands have more structure (name, description, options, etc.)
- Discord has command types (ChatInput, User, Message)
- Discord commands are global or per-guild
- Telegram commands are simpler (just name + description)

---

### Handle Commands

**Telegram**:
```javascript
bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
  await bot.sendMessage(msg.chat.id, 'Hello!');
});
```

**Discord**:
```javascript
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  if (interaction.commandName === 'start') {
    await interaction.reply({ content: 'Hello!' });
  }
});
```

**Key Differences**:
- Discord uses `interactionCreate` event
- Discord commands are typed and validated
- Discord requires `interaction.reply()` (can't just send message)
- Telegram text commands are regex-based

---

### Command Arguments

**Telegram**:
```javascript
bot.onText(/^\/make\s+(.+)$/, async (msg, match) => {
  const prompt = match[1]; // Manual parsing
  // ...
});
```

**Discord**:
```javascript
// Command definition
{
  name: 'make',
  description: 'Generate an image',
  options: [
    {
      name: 'prompt',
      description: 'Image prompt',
      type: ApplicationCommandOptionType.String,
      required: true
    }
  ]
}

// Handler
if (interaction.commandName === 'make') {
  const prompt = interaction.options.getString('prompt');
  // ...
}
```

**Key Differences**:
- Discord has typed, validated options
- Telegram requires manual regex parsing
- Discord options can have choices, min/max values, etc.

---

## File Operations

### Get File URL

**Telegram**:
```javascript
const fileInfo = await bot.getFile(fileId);
const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
```

**Discord**:
```javascript
// Direct URL access (no API call needed)
const url = attachment.url;
// Or for message attachments
const url = message.attachments.first()?.url;
```

**Key Differences**:
- Discord attachments have direct URLs (no API call)
- Telegram requires API call to get file path
- Discord URLs are permanent (until attachment deleted)
- Telegram file URLs expire after some time

---

## Chat Operations

### Get Chat Info

**Telegram**:
```javascript
const chat = await bot.getChat(chatId);
// Returns: { id, type, title, username, ... }
```

**Discord**:
```javascript
// For channels
const channel = await client.channels.fetch(channelId);
// Returns: TextChannel, VoiceChannel, etc.

// For guilds
const guild = await client.guilds.fetch(guildId);
// Returns: Guild object
```

**Key Differences**:
- Discord separates channels and guilds (servers)
- Telegram has unified chat concept
- Discord has more channel types (text, voice, stage, forum, etc.)

---

### Get Chat Member

**Telegram**:
```javascript
const member = await bot.getChatMember(chatId, userId);
// Returns: { status: 'member'|'administrator'|'creator', ... }
```

**Discord**:
```javascript
const member = await guild.members.fetch(userId);
// Returns: GuildMember object
// Check permissions: member.permissions.has('ADMINISTRATOR')
```

**Key Differences**:
- Discord uses permission system (more granular)
- Telegram has simple admin/member distinction
- Discord permissions are bitfield-based
- Telegram admin status is boolean

---

### Check if Admin

**Telegram**:
```javascript
const admins = await bot.getChatAdministrators(chatId);
const isAdmin = admins.some(a => a.user.id === userId);
```

**Discord**:
```javascript
const member = await guild.members.fetch(userId);
const isAdmin = member.permissions.has('ADMINISTRATOR') || 
                member.permissions.has('MANAGE_GUILD');
```

**Key Differences**:
- Discord has multiple admin-like permissions
- Telegram has single admin status
- Discord permissions are more flexible

---

## Event Handling

### Message Events

**Telegram**:
```javascript
bot.on('message', async (message) => {
  if (message.text) {
    // Handle text message
  }
});

bot.on('photo', async (message) => {
  // Handle photo message
});
```

**Discord**:
```javascript
client.on('messageCreate', async (message) => {
  if (message.content) {
    // Handle text message
  }
  
  if (message.attachments.size > 0) {
    // Handle attachments (photos, files, etc.)
  }
});
```

**Key Differences**:
- Discord has single `messageCreate` event (not separate for media)
- Check `message.attachments` for files/photos
- Discord messages can have both content and attachments

---

### Callback Query / Interaction Events

**Telegram**:
```javascript
bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data; // 'action:param1:param2'
  await bot.answerCallbackQuery(callbackQuery.id);
  // Handle callback
});
```

**Discord**:
```javascript
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    const customId = interaction.customId; // 'action:param1:param2'
    await interaction.deferUpdate(); // Or reply/update
    // Handle button
  }
  
  if (interaction.isStringSelectMenu()) {
    const values = interaction.values; // Array of selected values
    await interaction.deferUpdate();
    // Handle select menu
  }
});
```

**Key Differences**:
- Discord has separate interaction types (button, select menu, modal, etc.)
- Discord requires response (defer/reply/update) within 3 seconds
- Telegram callback_data is string, Discord custom_id is string but can have values array for selects

---

## Common Patterns

### Error Handling

**Telegram**:
```javascript
try {
  await bot.sendMessage(chatId, text);
} catch (error) {
  if (error.response?.body?.error_code === 429) {
    // Rate limit
  }
  logger.error('Telegram error:', error);
}
```

**Discord**:
```javascript
try {
  await channel.send({ content: text });
} catch (error) {
  if (error.code === 50035) {
    // Invalid form body
  } else if (error.status === 429) {
    // Rate limit
    const retryAfter = error.requestData.json.retry_after;
  }
  logger.error('Discord error:', error);
}
```

---

### Rate Limiting

**Telegram**:
- Rate limits are per-bot, per-endpoint
- Usually 30 messages/second
- Errors return 429 with retry_after

**Discord**:
- Rate limits are per-route, per-bucket
- More complex (different limits for different endpoints)
- Errors return 429 with retry_after in seconds
- discord.js handles rate limits automatically (with retries)

---

## Utility Functions

### Markdown Conversion

**Telegram MarkdownV2** → **Discord Markdown**:
- `*bold*` → `**bold**`
- `_italic_` → `*italic*`
- `` `code` `` → `` `code` `` (same)
- `[text](url)` → `[text](url)` (same)
- Need to escape differently (Telegram: more characters)

**Conversion Function**:
```javascript
function telegramToDiscordMarkdown(text) {
  // Convert MarkdownV2 to Discord markdown
  return text
    .replace(/\*([^*]+)\*/g, '**$1**') // Bold
    .replace(/_([^_]+)_/g, '*$1*')    // Italic
    // Handle escaping differences
    // ...
}
```

---

## Summary Table

| Feature | Telegram | Discord | Notes |
|---------|----------|---------|-------|
| **Text Messages** | `sendMessage()` | `channel.send()` | Similar |
| **Edit Messages** | `editMessageText()` | `message.edit()` | Similar |
| **Delete Messages** | `deleteMessage()` | `message.delete()` | Similar |
| **Media** | `sendPhoto()`, `sendVideo()` | `channel.send({ files: [] })` | Discord unified |
| **Buttons** | Inline keyboard | Message components | Discord more structured |
| **Interactions** | Callback queries | Interactions | Discord requires 3s response |
| **Commands** | Text commands | Slash commands | Discord more structured |
| **Reactions** | `setMessageReaction()` | `message.react()` | Similar |
| **File URLs** | API call required | Direct URL | Discord simpler |
| **Permissions** | Admin flag | Permission bitfield | Discord more granular |
| **Rate Limits** | Per-bot | Per-route/bucket | Discord more complex |

---

**Last Updated**: 2025-01-XX

