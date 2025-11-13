# Telegram Platform Methods Inventory

This document provides a comprehensive list of all Telegram Bot API methods used in the codebase, organized by category. This inventory is essential for creating an analogous Discord platform implementation and abstracting Telegram-specific methods.

## Table of Contents
1. [Message Sending Methods](#message-sending-methods)
2. [Message Editing Methods](#message-editing-methods)
3. [Message Deletion Methods](#message-deletion-methods)
4. [Callback Query Methods](#callback-query-methods)
5. [Reaction Methods](#reaction-methods)
6. [File Operations](#file-operations)
7. [Chat Operations](#chat-operations)
8. [Bot Commands Management](#bot-commands-management)
9. [Event Listeners](#event-listeners)
10. [Keyboard/Menu Systems](#keyboardmenu-systems)
11. [Message Formatting](#message-formatting)
12. [Utility Patterns](#utility-patterns)

---

## Message Sending Methods

### `bot.sendMessage(chatId, text, options)`
**Purpose**: Send a text message to a chat.

**Options Used**:
- `reply_to_message_id`: Reply to a specific message
- `parse_mode`: Text formatting ('MarkdownV2', 'Markdown', 'HTML')
- `reply_markup`: Inline keyboard or reply keyboard
- `message_thread_id`: For forum threads

**Usage Examples**:
- Basic messages with error handling
- Reply-to-message functionality
- Messages with inline keyboards attached
- Admin notifications

**Files**: `bot.js`, `index.js`, `dispatcher.js`, `telegramNotifier.js`, `adminUtils.js`, `walletManager.js`, `dynamicCommands.js`, and all component managers

---

### `bot.sendPhoto(chatId, photo, options)`
**Purpose**: Send a photo/image to a chat.

**Options Used**:
- `caption`: Photo caption (with MarkdownV2 escaping)
- `reply_to_message_id`: Reply to a specific message
- `parse_mode`: 'MarkdownV2' for caption formatting
- `reply_markup`: Inline keyboard for photo actions

**Usage Examples**:
- Sending generation results as images
- Mod/LoRA preview images
- Profile pictures or avatars

**Files**: `telegramNotifier.js`, `mediaAdapter.js`, `messaging.js`, `modsMenuManager.js`

---

### `bot.sendAnimation(chatId, animation, options)`
**Purpose**: Send an animation (GIF, MP4) to a chat.

**Options Used**:
- `caption`: Animation caption (with MarkdownV2 escaping)
- `reply_to_message_id`: Reply to a specific message
- `parse_mode`: 'MarkdownV2' for caption formatting
- `reply_markup`: Inline keyboard

**Usage Examples**:
- Sending animated generation results
- GIF previews

**Files**: `telegramNotifier.js`, `mediaAdapter.js`, `messaging.js`

---

### `bot.sendVideo(chatId, video, options)`
**Purpose**: Send a video file to a chat.

**Options Used**:
- `caption`: Video caption (with MarkdownV2 escaping)
- `reply_to_message_id`: Reply to a specific message
- `parse_mode`: 'MarkdownV2' for caption formatting
- `reply_markup`: Inline keyboard

**Usage Examples**:
- Sending video generation results
- Video file outputs from tools

**Files**: `telegramNotifier.js`, `mediaAdapter.js`, `messaging.js`

---

### `bot.sendDocument(chatId, document, options)`
**Purpose**: Send a document/file to a chat.

**Options Used**:
- `caption`: Document caption (with MarkdownV2 escaping)
- `reply_to_message_id`: Reply to a specific message
- `parse_mode`: 'MarkdownV2' for caption formatting
- `reply_markup`: Inline keyboard
- `filename`: Filename for the document

**Special Behavior**:
- In group chats, documents can be redirected to user's private chat
- Used for large files that shouldn't be sent as photos

**Usage Examples**:
- Sending large image files as documents
- Text file outputs
- Any file that exceeds photo size limits

**Files**: `telegramNotifier.js`, `mediaAdapter.js`, `messaging.js`

---

## Message Editing Methods

### `bot.editMessageText(text, options)`
**Purpose**: Edit the text of an existing message.

**Required Options**:
- `chat_id`: Chat ID where message exists
- `message_id`: ID of message to edit

**Additional Options**:
- `parse_mode`: 'MarkdownV2' for text formatting
- `reply_markup`: Update inline keyboard

**Usage Examples**:
- Updating menu displays
- Refreshing status messages
- Modifying interactive messages

**Files**: `messaging.js`, `walletManager.js`, `modsMenuManager.js`, `deliveryMenu/*.js`, and all menu managers

---

### `bot.editMessageCaption(caption, options)`
**Purpose**: Edit the caption of a media message.

**Required Options**:
- `chat_id`: Chat ID where message exists
- `message_id`: ID of message to edit

**Additional Options**:
- `parse_mode`: 'MarkdownV2' for caption formatting
- `reply_markup`: Update inline keyboard

**Usage Examples**:
- Updating photo/video captions
- Modifying media message metadata

**Files**: `messaging.js`

---

### `bot.editMessageMedia(media, options)`
**Purpose**: Edit the media content of a message.

**Required Options**:
- `chat_id`: Chat ID where message exists
- `message_id`: ID of message to edit

**Media Object**:
- `type`: 'photo', 'video', 'animation', etc.
- `media`: File ID or URL
- `caption`: Optional caption (with MarkdownV2 escaping)

**Usage Examples**:
- Replacing media in a message
- Updating media with new caption

**Files**: `messaging.js`

---

### `bot.editMessageReplyMarkup(replyMarkup, options)`
**Purpose**: Edit only the inline keyboard of a message without changing text/media.

**Required Options**:
- `chat_id`: Chat ID where message exists
- `message_id`: ID of message to edit

**Reply Markup**:
- `inline_keyboard`: Array of button rows (can be empty array `[]` to remove keyboard)

**Usage Examples**:
- Hiding menus (setting to empty keyboard)
- Updating button states
- Removing inline keyboards

**Files**: `globalMenuManager.js`, various menu managers

---

## Message Deletion Methods

### `bot.deleteMessage(chatId, messageId)`
**Purpose**: Delete a message from a chat.

**Usage Examples**:
- Removing temporary messages
- Cleaning up old menus
- Deleting error messages after handling

**Files**: `modsMenuManager.js`, `inputCollector.js`

---

## Callback Query Methods

### `bot.answerCallbackQuery(callbackQueryId, options)`
**Purpose**: Answer a callback query from an inline keyboard button press.

**Options Used**:
- `text`: Short text to show user (max 200 chars)
- `show_alert`: Boolean - if true, shows as alert popup instead of notification
- `url`: URL to open (rarely used)
- `cache_time`: Cache answer for N seconds

**Usage Patterns**:
- **Silent acknowledgment**: `bot.answerCallbackQuery(query.id)` - no text, just acknowledge
- **Notification**: `bot.answerCallbackQuery(query.id, { text: 'Action completed' })` - shows notification
- **Alert**: `bot.answerCallbackQuery(query.id, { text: 'Error!', show_alert: true })` - shows popup alert

**Usage Examples**:
- Confirming button presses
- Showing loading states
- Displaying error messages
- Providing feedback for actions

**Files**: All component managers, `bot.js`, `dispatcher.js`, `walletManager.js`, `modsMenuManager.js`, `deliveryMenu/*.js`

---

## Reaction Methods

### `bot.setMessageReaction(chatId, messageId, options)`
**Purpose**: Set or remove reactions on a message.

**Options**:
- `reaction`: Array of reaction objects
  - `type`: 'emoji' or 'custom_emoji'
  - `emoji`: Emoji string (must be from Telegram's allowed list)

**Allowed Emojis**:
Telegram only accepts specific emojis for reactions:
- 👍, 👎, ❤, 🔥, 🥰, 👏, 😁, 🤔, 🤯, 😱, 🤬, 😢, 🎉, 🤩, 🤮, 💩, 🙏, 👌, 🕊, 🤡, 🥱, 🥴, 😍, 🐳, ❤‍🔥, 🌚, 🌭, 💯, 🤣, ⚡, 🍌, 🏆, 💔, 🤨, 😐, 🍓, 🍾, 💋, 🖕, 😈, 😴, 😭, 🤓, 👻, 👨‍💻, 👀, 🎃, 🙈, 😇, 😨, 🤝, ✍, 🤗, 🫡, 🎅, 🎄, ☃, 💅, 🤪, 🗿, 🆒, 💘, 🙉, 🦄, 😘, 💊, 🙊, 😎, 👾, 🤷‍♂, 🤷, 🤷‍♀, 😡

**Usage Examples**:
- Setting initial reaction: `🤔` (thinking)
- Success reaction: `👌` (OK)
- Error reaction: `😨` (fear/error)
- Feedback reactions: `📝` (writing), `👌` (OK)

**Files**: `telegramUtils.js`, `index.js`, `dynamicCommands.js`, all command handlers

---

## File Operations

### `bot.getFile(fileId)`
**Purpose**: Get information about a file by its file ID.

**Returns**:
- `file_id`: The file ID
- `file_unique_id`: Unique file identifier
- `file_size`: File size in bytes
- `file_path`: Path on Telegram servers (for constructing download URL)

**Usage Examples**:
- Getting file URLs from Telegram file IDs
- Downloading user-uploaded images
- Processing media attachments

**Files**: `telegramUtils.js`, `mediaAdapter.js`, `dynamicCommands.js`

**URL Construction**:
```javascript
const fileInfo = await bot.getFile(fileId);
const url = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;
```

---

## Chat Operations

### `bot.getChat(chatId)`
**Purpose**: Get information about a chat.

**Returns**:
- Chat type (private, group, supergroup, channel)
- Chat title, description
- `all_members_are_administrators`: Boolean flag for groups

**Usage Examples**:
- Checking if chat is a group
- Getting group information
- Verifying bot permissions

**Files**: `adminUtils.js`, `dynamicCommands.js`, `index.js`

---

### `bot.getChatMember(chatId, userId)`
**Purpose**: Get information about a member of a chat.

**Returns**:
- `status`: 'creator', 'administrator', 'member', 'restricted', 'left', 'kicked'
- User information
- Permissions (for admins)

**Usage Examples**:
- Checking if user is admin
- Verifying user permissions
- Getting member status

**Files**: `adminUtils.js`

---

### `bot.getChatAdministrators(chatId)`
**Purpose**: Get a list of administrators in a chat.

**Returns**: Array of chat member objects with admin status

**Usage Examples**:
- Checking if user is admin in group
- Listing group administrators
- Verifying admin permissions for group sponsorship

**Files**: `dynamicCommands.js`, `index.js`

---

## Bot Commands Management

### `bot.setMyCommands(commands, options)`
**Purpose**: Set the list of bot commands shown in the command menu.

**Parameters**:
- `commands`: Array of `{ command: string, description: string }` objects
- `options`: Optional scope and language settings
  - `scope`: `{ type: 'default'|'all_private_chats'|'all_group_chats'|'all_chat_administrators'|... }`
  - `language_code`: Language code for localized commands

**Usage Examples**:
- Setting canonical commands at bot startup
- Registering dynamic commands from tool registry
- Updating commands for specific scopes

**Files**: `bot.js`, `index.js`, `adminUtils.js`, `dynamicCommands.js`

---

### `bot.deleteMyCommands(options)`
**Purpose**: Delete the list of bot commands.

**Options**:
- `scope`: Optional scope object
- `language_code`: Optional language code

**Usage Examples**:
- Clearing all commands before setting new ones
- Removing commands from specific scopes
- Admin command management

**Files**: `adminUtils.js`, `index.js`

---

### `bot.getMyCommands(options)`
**Purpose**: Get the current list of bot commands.

**Options**:
- `scope`: Optional scope object
- `language_code`: Optional language code

**Returns**: Array of command objects

**Usage Examples**:
- Inspecting current command configuration
- Debugging command registration issues
- Admin diagnostics

**Files**: `adminUtils.js`, `index.js`

---

## Event Listeners

### `bot.on(eventName, handler)`
**Purpose**: Register an event listener for Telegram events.

**Event Types Used**:
- `'callback_query'`: Inline keyboard button presses
- `'message'`: Text messages
- `'photo'`: Photo messages
- `'document'`: Document/file messages
- `'polling_error'`: Polling errors

**Usage Examples**:
- Main callback query handler
- Message processing pipeline
- Photo/document handling
- Error logging

**Files**: `bot.js`, `index.js`, `inputCollector.js`

---

### `bot.onText(regex, handler)`
**Purpose**: Register a text command handler with regex matching.

**Parameters**:
- `regex`: Regular expression to match command text
- `handler`: Function `(msg, match) => {}`

**Regex Patterns Used**:
- `/^\/command(?:@\w+)?$/` - Simple command (with optional bot mention)
- `/^\/command(?:@\w+)?\s+(.+)$/` - Command with arguments

**Usage Examples**:
- `/feedback` command
- `/again` command
- `/resetKeyboard` admin command
- `/updateCommands` admin command
- `/gift` admin command

**Files**: `index.js`

---

## Keyboard/Menu Systems

### Inline Keyboards (`inline_keyboard`)
**Purpose**: Create interactive button menus attached to messages.

**Structure**:
```javascript
{
  reply_markup: {
    inline_keyboard: [
      [
        { text: 'Button 1', callback_data: 'action:param1:param2' },
        { text: 'Button 2', callback_data: 'action:param3' }
      ],
      [
        { text: 'Back', callback_data: 'menu:back' }
      ]
    ]
  }
}
```

**Button Properties**:
- `text`: Button label (displayed text)
- `callback_data`: Data sent when button is pressed (max 64 bytes)
- `url`: Optional URL to open (instead of callback_data)
- `web_app`: Optional web app to open
- `switch_inline_query`: For inline query switching

**Callback Data Patterns**:
- `prefix:action:param1:param2` - Hierarchical action system
- Examples:
  - `mods:category:type_character:All:1` - Mod category browsing
  - `rate_gen:${generationId}:beautiful` - Rating generations
  - `wallet:view:${address}` - Viewing wallet details
  - `hide_menu` - Hiding menu

**Usage Examples**:
- Menu navigation systems
- Action buttons (like, favorite, delete)
- Pagination controls
- Confirmation dialogs
- Rating systems

**Files**: All menu managers, `telegramNotifier.js`, `walletManager.js`, `modsMenuManager.js`, `deliveryMenu/*.js`

---

### Reply Keyboards (`keyboard`)
**Purpose**: Create persistent keyboard buttons below the text input.

**Structure**:
```javascript
{
  reply_markup: {
    keyboard: [
      [
        { text: '/account' },
        { text: '/status' },
        { text: '/settings' },
        { text: '/tools' }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: 'Select an option...'
  }
}
```

**Properties**:
- `keyboard`: Array of button rows
- `resize_keyboard`: Automatically resize to fit screen
- `one_time_keyboard`: Hide after one use
- `input_field_placeholder`: Placeholder text in input field
- `selective`: Show only to mentioned users (groups)

**Usage Examples**:
- Main menu persistent keyboard
- Quick action buttons
- Command shortcuts

**Files**: `keyboardContextManager.js`

---

### Remove Keyboard (`remove_keyboard`)
**Purpose**: Remove a persistent reply keyboard.

**Structure**:
```javascript
{
  reply_markup: {
    remove_keyboard: true,
    selective: false  // Optional: only remove for specific users
  }
}
```

**Usage Examples**:
- Cleaning up stuck keyboards
- Removing keyboards after actions
- Resetting chat state

**Files**: `keyboardContextManager.js`, `adminUtils.js`

---

## Message Formatting

### Parse Modes

#### MarkdownV2
**Purpose**: Advanced Markdown formatting with escaping requirements.

**Features**:
- Bold: `*bold*`
- Italic: `_italic_`
- Code: `` `code` ``
- Links: `[text](url)`
- Requires escaping of special characters: `_`, `*`, `[`, `]`, `(`, `)`, `` ` ``, `~`, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`

**Usage**: Primary parse mode used throughout codebase for consistency.

**Files**: `messaging.js` (all escaped message functions)

---

#### Markdown (Legacy)
**Purpose**: Simpler Markdown formatting (deprecated by Telegram).

**Features**:
- Less strict escaping requirements
- Not used in current codebase

---

#### HTML
**Purpose**: HTML formatting (not used in current codebase).

---

### Escaping Utilities
**Purpose**: Automatically escape MarkdownV2 special characters.

**Functions**:
- `escapeMarkdownV2(text)`: Escapes all special characters
- Used in all messaging helper functions

**Files**: `messaging.js`, `utils/stringUtils.js`

---

## Utility Patterns

### Reply Context Management
**Purpose**: Track context for messages expecting user replies.

**Methods**:
- `addContext(sentMessage, context, ttl)`: Store context for a message
- `getContext(repliedToMessage)`: Retrieve context from reply
- `removeContext(repliedToMessage)`: Clear context after use

**Usage Examples**:
- LoRA import URL collection
- Input collection workflows
- Multi-step interactions

**Files**: `replyContextManager.js`, `inputCollector.js`

---

### Keyboard Context Management
**Purpose**: Ensure users have correct persistent keyboards.

**Methods**:
- `ensureCleanKeyboard(bot, message, deps)`: Check and update keyboard version
- `mainMenuKeyboard`: Canonical main menu keyboard definition

**Usage Examples**:
- Keyboard versioning and updates
- Ensuring consistent UI across users

**Files**: `keyboardContextManager.js`

---

### Message Age Filtering
**Purpose**: Filter out old messages when bot restarts.

**Pattern**:
```javascript
const botStartupTime = Date.now();
const MESSAGE_AGE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes

const messageTime = message.date * 1000;
const messageAge = Date.now() - messageTime;

if (messageAge > MESSAGE_AGE_LIMIT_MS) {
  return; // Ignore old message
}
```

**Usage Examples**:
- Preventing processing of queued messages after restart
- Avoiding duplicate processing

**Files**: `bot.js`

---

### Dispatcher Pattern
**Purpose**: Route events to appropriate handlers based on prefixes/patterns.

**Dispatchers**:
- `CallbackQueryDispatcher`: Routes callback queries by prefix
- `MessageReplyDispatcher`: Routes message replies by context type
- `CommandDispatcher`: Routes commands by regex pattern
- `DynamicCommandDispatcher`: Routes dynamic commands from registry

**Usage Examples**:
- Modular handler registration
- Feature-based organization
- Decoupled event handling

**Files**: `dispatcher.js`, all component managers

---

### Media Adapter Pattern
**Purpose**: Platform-agnostic media handling interface.

**Methods**:
- `getFileUrl(fileId)`: Get download URL from file ID
- `sendPhoto(message, filePath, options)`: Send photo
- `sendDocument(message, filePath, options)`: Send document
- `sendAnimation(message, filePath, options)`: Send animation
- `sendVideo(message, filePath, options)`: Send video

**Usage Examples**:
- Abstracting platform-specific media handling
- Preparing for multi-platform support

**Files**: `mediaAdapter.js`

---

## Summary Statistics

### Method Usage Counts (Approximate)
- `sendMessage`: ~50+ occurrences
- `editMessageText`: ~30+ occurrences
- `answerCallbackQuery`: ~100+ occurrences
- `sendPhoto`: ~20+ occurrences
- `setMessageReaction`: ~30+ occurrences
- `getFile`: ~5+ occurrences
- `getChat`: ~5+ occurrences
- `getChatAdministrators`: ~3+ occurrences
- `setMyCommands`: ~5+ occurrences
- `deleteMessage`: ~5+ occurrences

### Event Listeners
- `callback_query`: 2 main handlers (bot.js, index.js) + component handlers
- `message`: 1 main handler (bot.js)
- `photo`: 2 handlers (bot.js, inputCollector.js)
- `document`: 1 handler (inputCollector.js)
- `polling_error`: 1 handler (bot.js)
- `onText`: 10+ command handlers (index.js)

### Keyboard Systems
- Inline keyboards: Used in all menu systems (~20+ menu managers)
- Reply keyboards: 1 main menu keyboard
- Remove keyboard: Used in cleanup/admin operations

---

## Discord Equivalents (Planning Reference)

### Message Sending
- `sendMessage` → Discord: `channel.send()` or `message.reply()`
- `sendPhoto` → Discord: `channel.send({ files: [...] })`
- `sendVideo` → Discord: `channel.send({ files: [...] })`
- `sendDocument` → Discord: `channel.send({ files: [...] })`

### Message Editing
- `editMessageText` → Discord: `message.edit()`
- `editMessageReplyMarkup` → Discord: `message.edit()` (update components)

### Callback Queries
- `answerCallbackQuery` → Discord: `interaction.reply()` or `interaction.update()`
- Inline keyboards → Discord: Message components (buttons, select menus)

### Reactions
- `setMessageReaction` → Discord: `message.react(emoji)`

### Commands
- `setMyCommands` → Discord: Application commands (slash commands)
- `onText` → Discord: `client.on('messageCreate')` or slash command handlers

### File Operations
- `getFile` → Discord: Attachment URLs (direct access)

### Chat Operations
- `getChat` → Discord: `guild.fetch()` or `channel.fetch()`
- `getChatMember` → Discord: `guild.members.fetch()`
- `getChatAdministrators` → Discord: `guild.members.cache.filter(m => m.permissions.has('ADMINISTRATOR'))`

---

## Notes for Discord Implementation

1. **Message Components**: Discord uses message components (buttons, select menus) instead of inline keyboards. Need to map callback_data to custom_id.

2. **Reactions**: Discord reactions are user-initiated, not bot-set. May need to use emoji reactions or embed indicators.

3. **Commands**: Discord uses slash commands (application commands) which are more structured than Telegram's text commands.

4. **File Handling**: Discord attachments are URLs, not file IDs. Simpler than Telegram's file system.

5. **Menus**: Discord supports ephemeral messages and component interactions that can be updated/deleted more easily.

6. **Thread Support**: Discord has native thread support (similar to Telegram forums) but with different API.

7. **Permissions**: Discord has more granular permission system than Telegram's admin/member distinction.

8. **Rate Limiting**: Both platforms have rate limits, but Discord's are more complex (per-route, per-bucket).

---

## Last Updated
Generated: 2025-01-XX
Codebase Version: Current main branch
Total Methods Documented: 20+ core methods + patterns

