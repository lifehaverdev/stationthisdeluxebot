# Discord-Telegram Parity Implementation Plan

This document outlines a comprehensive strategy for achieving feature parity between Discord and Telegram platforms, leveraging the existing Telegram architecture as a reference implementation.

## Table of Contents
1. [Current State Analysis](#current-state-analysis)
2. [Architecture Overview](#architecture-overview)
3. [Abstraction Strategy](#abstraction-strategy)
4. [Implementation Phases](#implementation-phases)
5. [Method Mapping](#method-mapping)
6. [Component Migration](#component-migration)
7. [Testing Strategy](#testing-strategy)
8. [Risk Mitigation](#risk-mitigation)

---

## Current State Analysis

### Telegram Platform (Reference Implementation)
**Strengths**:
- ✅ Complete dispatcher pattern (CallbackQueryDispatcher, MessageReplyDispatcher, CommandDispatcher, DynamicCommandDispatcher)
- ✅ Comprehensive component managers (20+ menu managers)
- ✅ Dynamic command registration from ToolRegistry
- ✅ Reply context management for multi-step interactions
- ✅ Keyboard/menu systems (inline keyboards, reply keyboards)
- ✅ Media handling with adapters
- ✅ Notification system (TelegramNotifier)
- ✅ Admin utilities and command management
- ✅ Input collection system for complex workflows
- ✅ Delivery menu system for generation results

**Architecture**:
```
telegram/
├── bot.js                    # Bot initialization & event handlers
├── index.js                  # Platform entry point
├── dispatcher.js             # Event routing system
├── dynamicCommands.js        # Tool-based command registration
├── telegramNotifier.js       # Notification delivery
├── mediaAdapter.js           # Media handling abstraction
├── components/               # Feature-specific managers
│   ├── settingsMenuManager.js
│   ├── modsMenuManager.js
│   ├── walletManager.js
│   ├── deliveryMenu/
│   └── ...
└── utils/                    # Platform utilities
    ├── messaging.js          # Escaped message helpers
    ├── telegramUtils.js      # Reaction & file utilities
    ├── adminUtils.js         # Admin operations
    ├── replyContextManager.js
    └── keyboardContextManager.js
```

### Discord Platform (Current State)
**Strengths**:
- ✅ Basic slash command registration
- ✅ Simple command handlers (make, upscale, settings, train, status)
- ✅ Button and select menu interaction handling
- ✅ Client initialization with proper intents

**Gaps**:
- ❌ No dispatcher pattern
- ❌ No component managers (menu systems)
- ❌ No dynamic command registration
- ❌ No reply context management
- ❌ No notification system
- ❌ No media adapter abstraction
- ❌ No admin utilities
- ❌ No input collection system
- ❌ No delivery menu system
- ❌ Limited error handling patterns
- ❌ No feature parity with Telegram components

**Architecture**:
```
discord/
├── bot.js                    # Basic bot setup
├── index.js                  # Platform entry point
├── commands/                 # Individual command handlers
│   ├── upscaleCommand.js
│   ├── settingsCommand.js
│   └── ...
└── mediaAdapter.js           # Basic media adapter (exists but minimal)
```

---

## Architecture Overview

### Target Architecture: Platform Abstraction Layer

```
┌─────────────────────────────────────────────────────────────┐
│                    Core Services Layer                       │
│  (WorkflowExecutionService, ToolRegistry, InternalAPI, etc) │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │
┌─────────────────────────────────────────────────────────────┐
│              Platform Abstraction Interface                 │
│  (Common methods: sendMessage, editMessage, handleMenu, etc)│
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
┌───────────────────┐                  ┌───────────────────┐
│  Telegram Adapter │                  │  Discord Adapter   │
│  (Implementation) │                  │  (Implementation)  │
└───────────────────┘                  └───────────────────┘
```

### Key Principles

1. **Platform-Agnostic Core**: Business logic should not depend on platform specifics
2. **Adapter Pattern**: Each platform implements a common interface
3. **Shared Components**: Menu managers, dispatchers, and utilities should work across platforms
4. **Platform-Specific Adapters**: Handle platform differences (e.g., inline keyboards vs message components)
5. **Progressive Enhancement**: Start with core features, add platform-specific optimizations later

---

## Abstraction Strategy

### Phase 1: Create Platform Abstraction Interface

**File**: `src/platforms/common/PlatformAdapter.js`

```javascript
/**
 * Platform Adapter Interface
 * All platform implementations must implement these methods
 */
class PlatformAdapter {
  // Message Operations
  async sendMessage(channelId, text, options) {}
  async editMessage(channelId, messageId, text, options) {}
  async deleteMessage(channelId, messageId) {}
  
  // Media Operations
  async sendPhoto(channelId, photo, options) {}
  async sendVideo(channelId, video, options) {}
  async sendDocument(channelId, document, options) {}
  
  // Interaction Operations
  async answerCallback(callbackId, options) {}
  async setReaction(channelId, messageId, emoji) {}
  
  // Menu/Component Operations
  async sendMenu(channelId, text, buttons, options) {}
  async editMenu(channelId, messageId, text, buttons, options) {}
  
  // File Operations
  async getFileUrl(fileId) {}
  
  // Chat Operations
  async getChatInfo(channelId) {}
  async getChatMember(channelId, userId) {}
  async isAdmin(channelId, userId) {}
  
  // Command Operations
  async registerCommands(commands) {}
  async deleteCommands() {}
}
```

### Phase 2: Platform-Specific Implementations

**Telegram Adapter**: `src/platforms/telegram/adapter.js`
- Wraps existing Telegram bot methods
- Maps to PlatformAdapter interface
- Maintains backward compatibility

**Discord Adapter**: `src/platforms/discord/adapter.js`
- Implements PlatformAdapter interface using discord.js
- Handles Discord-specific concepts (components, embeds, etc.)

### Phase 3: Shared Component Layer

**Shared Dispatchers**: `src/platforms/common/dispatchers/`
- Abstract dispatcher logic
- Platform adapters provide event sources

**Shared Menu Managers**: `src/platforms/common/components/`
- Menu logic that works with PlatformAdapter
- Platform-specific rendering handled by adapters

---

## Implementation Phases

### Phase 0: Foundation & Planning ✅
- [x] Document all Telegram methods
- [x] Analyze current Discord implementation
- [x] Create implementation plan
- [ ] Review discord.js documentation for key APIs
- [ ] Set up testing infrastructure

### Phase 1: Core Abstraction Layer (Week 1-2)

**Goal**: Create platform abstraction interface and basic adapters

**Tasks**:
1. **Create Platform Adapter Interface**
   - [ ] Define `PlatformAdapter` base class/interface
   - [ ] Document all required methods
   - [ ] Create TypeScript/JSDoc types

2. **Implement Telegram Adapter**
   - [ ] Wrap existing Telegram bot in adapter
   - [ ] Map all Telegram methods to adapter interface
   - [ ] Maintain backward compatibility
   - [ ] Test with existing Telegram code

3. **Implement Discord Adapter (Basic)**
   - [ ] Create Discord adapter skeleton
   - [ ] Implement core message methods (sendMessage, editMessage)
   - [ ] Implement basic interaction handling
   - [ ] Test basic functionality

4. **Create Shared Types**
   - [ ] Define common message types
   - [ ] Define common menu/button types
   - [ ] Define common error types

**Deliverables**:
- `src/platforms/common/PlatformAdapter.js`
- `src/platforms/telegram/adapter.js`
- `src/platforms/discord/adapter.js`
- `src/platforms/common/types.js`

---

### Phase 2: Messaging & Media Parity (Week 2-3)

**Goal**: Achieve messaging and media feature parity

**Tasks**:
1. **Message Sending**
   - [ ] Implement `sendMessage` with reply support
   - [ ] Implement message formatting (MarkdownV2 → Discord markdown)
   - [ ] Handle message threading (Discord threads vs Telegram forums)
   - [ ] Error handling and retries

2. **Message Editing**
   - [ ] Implement `editMessage` for text updates
   - [ ] Implement `editMessageCaption` for media captions
   - [ ] Handle message component updates (Discord)

3. **Media Handling**
   - [ ] Implement `sendPhoto` (Discord: attachments)
   - [ ] Implement `sendVideo` (Discord: attachments)
   - [ ] Implement `sendDocument` (Discord: attachments)
   - [ ] Handle file size limits (Discord: 25MB, Telegram: varies)
   - [ ] Implement `getFileUrl` for both platforms

4. **Reactions**
   - [ ] Implement `setReaction` (Discord: `message.react()`)
   - [ ] Handle emoji differences (Telegram: limited set, Discord: any emoji)
   - [ ] Fallback strategies for unsupported emojis

**Deliverables**:
- Complete messaging methods in both adapters
- Media handling parity
- Message formatting utilities

---

### Phase 3: Interaction & Menu Systems (Week 3-5)

**Goal**: Implement interactive menu systems for Discord

**Tasks**:
1. **Callback Query / Interaction Handling**
   - [ ] Implement `answerCallback` for Discord (interaction.reply/update)
   - [ ] Create interaction dispatcher for Discord
   - [ ] Map Telegram callback_data to Discord custom_id
   - [ ] Handle interaction timeouts (Discord: 3 seconds for initial response)

2. **Menu System Abstraction**
   - [ ] Create `MenuBuilder` class for platform-agnostic menus
   - [ ] Map inline keyboards → Discord message components
   - [ ] Handle button limits (Telegram: unlimited, Discord: 5 rows × 5 buttons)
   - [ ] Implement pagination for large menus

3. **Component Managers (Shared)**
   - [ ] Refactor Telegram component managers to use PlatformAdapter
   - [ ] Create shared base classes for menu managers
   - [ ] Implement first menu manager for Discord (e.g., SettingsMenuManager)
   - [ ] Test menu navigation on both platforms

4. **Reply Context Management**
   - [ ] Port reply context manager to work with Discord
   - [ ] Handle Discord's ephemeral messages vs Telegram's private chats
   - [ ] Implement context cleanup

**Deliverables**:
- Working menu system on Discord
- Shared component managers
- Interaction handling parity

---

### Phase 4: Command System Parity (Week 5-6)

**Goal**: Achieve command registration and handling parity

**Tasks**:
1. **Command Registration**
   - [ ] Implement `registerCommands` for Discord (slash commands)
   - [ ] Map Telegram text commands → Discord slash commands
   - [ ] Handle command descriptions and options
   - [ ] Implement command scoping (global vs guild)

2. **Dynamic Commands**
   - [ ] Port dynamic command registration from ToolRegistry
   - [ ] Handle Discord slash command limits (100 commands per app)
   - [ ] Implement command grouping/namespacing if needed
   - [ ] Test with existing tool registry

3. **Command Dispatchers**
   - [ ] Port CommandDispatcher to work with Discord
   - [ ] Port DynamicCommandDispatcher for Discord
   - [ ] Handle command argument parsing differences
   - [ ] Implement command aliases

4. **Admin Commands**
   - [ ] Port admin utilities to Discord
   - [ ] Implement permission checking (Discord roles vs Telegram admin flag)
   - [ ] Port admin command handlers

**Deliverables**:
- Dynamic command registration working on Discord
- Command dispatcher parity
- Admin command support

---

### Phase 5: Component Managers Migration (Week 6-8)

**Goal**: Migrate all Telegram component managers to shared implementation

**Priority Order** (based on usage/complexity):
1. **Settings Menu Manager** (Simple, high usage)
2. **Wallet Manager** (Medium complexity)
3. **Tools Menu Manager** (Medium complexity)
4. **Dashboard Menu Manager** (Medium complexity)
5. **Buy Points Manager** (Medium complexity)
6. **Collection Menu Manager** (Complex)
7. **Mods Menu Manager** (Very complex, many interactions)
8. **Spell Menu Manager** (Complex, if enabled)
9. **Training Menu Manager** (Complex, if enabled)
10. **Delivery Menu System** (Complex, critical for UX)
    - Global Menu Manager
    - Info Manager
    - Rate Manager
    - Rerun Manager
    - Tweak Manager

**Tasks for Each Manager**:
- [ ] Refactor to use PlatformAdapter
- [ ] Test on Telegram (ensure no regressions)
- [ ] Test on Discord
- [ ] Handle platform-specific UI differences
- [ ] Document any platform limitations

**Deliverables**:
- All component managers working on both platforms
- Shared menu manager base classes
- Platform-specific rendering adapters

---

### Phase 6: Notification & Delivery System (Week 8-9)

**Goal**: Implement notification delivery parity

**Tasks**:
1. **Notification System**
   - [ ] Create `PlatformNotifier` base class
   - [ ] Port TelegramNotifier to use PlatformAdapter
   - [ ] Implement DiscordNotifier
   - [ ] Handle notification context (reply-to, threading)

2. **Delivery Menu Integration**
   - [ ] Port delivery menu system to Discord
   - [ ] Handle Discord embeds for generation info
   - [ ] Implement action buttons (rate, rerun, tweak, info)
   - [ ] Handle multi-output generations (Discord: multiple messages vs Telegram: single with multiple media)

3. **Media Delivery**
   - [ ] Handle large files (Discord: upload to CDN if needed)
   - [ ] Implement progress indicators
   - [ ] Handle delivery failures and retries

**Deliverables**:
- Working notification system on Discord
- Delivery menu parity
- Media delivery parity

---

### Phase 7: Advanced Features (Week 9-10)

**Goal**: Implement advanced features and optimizations

**Tasks**:
1. **Input Collection System**
   - [ ] Port InputCollector to Discord
   - [ ] Handle Discord modals for text input
   - [ ] Handle file uploads via Discord attachments
   - [ ] Implement timeout handling

2. **Group/Server Features**
   - [ ] Port group menu manager (Discord: server settings)
   - [ ] Handle Discord server permissions
   - [ ] Implement server-specific command scoping
   - [ ] Handle Discord server sponsorship (similar to Telegram groups)

3. **Admin Utilities**
   - [ ] Port all admin utilities
   - [ ] Implement Discord-specific admin features
   - [ ] Handle permission management

4. **Error Handling & Resilience**
   - [ ] Implement consistent error handling patterns
   - [ ] Add retry logic for rate limits
   - [ ] Handle platform-specific errors gracefully
   - [ ] Implement fallback strategies

**Deliverables**:
- Complete feature parity
- Robust error handling
- Platform-specific optimizations

---

### Phase 8: Testing & Documentation (Week 10-11)

**Goal**: Comprehensive testing and documentation

**Tasks**:
1. **Unit Tests**
   - [ ] Test all adapter methods
   - [ ] Test component managers on both platforms
   - [ ] Test error handling

2. **Integration Tests**
   - [ ] Test full user workflows on both platforms
   - [ ] Test command registration and execution
   - [ ] Test menu navigation
   - [ ] Test notification delivery

3. **Documentation**
   - [ ] Document platform differences
   - [ ] Create migration guide for adding new features
   - [ ] Document Discord-specific considerations
   - [ ] Update architecture diagrams

**Deliverables**:
- Test suite with good coverage
- Complete documentation
- Migration guides

---

## Method Mapping

### Message Operations

| Telegram Method | Discord Equivalent | Notes |
|----------------|-------------------|-------|
| `bot.sendMessage(chatId, text, options)` | `channel.send({ content, ...options })` | Discord uses embeds for rich content |
| `bot.editMessageText(text, options)` | `message.edit({ content, ...options })` | Similar, but Discord can edit components |
| `bot.deleteMessage(chatId, messageId)` | `message.delete()` | Similar |
| `bot.sendPhoto(chatId, photo, options)` | `channel.send({ files: [attachment] })` | Discord uses AttachmentBuilder |
| `bot.sendVideo(chatId, video, options)` | `channel.send({ files: [attachment] })` | Same as photo |
| `bot.sendDocument(chatId, doc, options)` | `channel.send({ files: [attachment] })` | Same as photo |

### Interaction Operations

| Telegram Method | Discord Equivalent | Notes |
|----------------|-------------------|-------|
| `bot.answerCallbackQuery(id, options)` | `interaction.reply()` / `interaction.update()` | Discord requires response within 3s |
| `bot.setMessageReaction(chatId, msgId, emoji)` | `message.react(emoji)` | Discord: user-initiated, bot can react |
| `bot.editMessageReplyMarkup(...)` | `interaction.update({ components })` | Discord: update message components |

### Menu Systems

| Telegram Concept | Discord Equivalent | Notes |
|-----------------|-------------------|-------|
| Inline Keyboard (buttons) | Message Components (ActionRow + Button) | Discord: max 5 rows, 5 buttons/row |
| `callback_data` | `custom_id` | Discord: max 100 chars, must be unique |
| Button with URL | Button with `url` style | Similar |
| Select Menu | StringSelectMenu / UserSelectMenu | Discord has more menu types |

### Commands

| Telegram Concept | Discord Equivalent | Notes |
|-----------------|-------------------|-------|
| Text commands (`/command`) | Slash Commands (`/command`) | Discord: structured, typed arguments |
| `bot.onText(regex, handler)` | `interactionCreate` event + command name | Discord: command registration required |
| Command descriptions | Slash command `description` | Required in Discord |
| Command arguments | Slash command `options` | Discord: typed, validated |

### File Operations

| Telegram Method | Discord Equivalent | Notes |
|----------------|-------------------|-------|
| `bot.getFile(fileId)` | `attachment.url` | Discord: direct URL access |
| File URL construction | Direct `attachment.url` | No construction needed in Discord |

### Chat Operations

| Telegram Method | Discord Equivalent | Notes |
|----------------|-------------------|-------|
| `bot.getChat(chatId)` | `guild.fetch()` / `channel.fetch()` | Discord: separate guild/channel |
| `bot.getChatMember(chatId, userId)` | `guild.members.fetch(userId)` | Discord: member object |
| `bot.getChatAdministrators(chatId)` | `guild.members.cache.filter(...)` | Discord: check permissions |

---

## Component Migration

### Migration Strategy for Each Component Manager

1. **Extract Platform-Specific Code**
   - Identify all direct bot API calls
   - Identify platform-specific UI elements
   - Document dependencies

2. **Create Shared Base Class**
   - Define common interface
   - Implement shared logic
   - Define abstract methods for platform-specific parts

3. **Implement Platform Adapters**
   - Telegram: Wrap existing code
   - Discord: Implement using discord.js

4. **Test on Both Platforms**
   - Ensure feature parity
   - Handle platform limitations gracefully
   - Document differences

### Example: Settings Menu Manager Migration

**Before (Telegram-specific)**:
```javascript
async function showSettingsMenu(bot, message, dependencies) {
  const keyboard = [
    [{ text: 'Setting 1', callback_data: 'settings:setting1' }],
    [{ text: 'Setting 2', callback_data: 'settings:setting2' }]
  ];
  
  await bot.sendMessage(message.chat.id, 'Settings:', {
    reply_markup: { inline_keyboard: keyboard }
  });
}
```

**After (Platform-agnostic)**:
```javascript
async function showSettingsMenu(platform, context, dependencies) {
  const buttons = [
    [{ text: 'Setting 1', action: 'settings:setting1' }],
    [{ text: 'Setting 2', action: 'settings:setting2' }]
  ];
  
  await platform.sendMenu(context.channelId, 'Settings:', buttons, {
    replyTo: context.messageId
  });
}
```

---

## Testing Strategy

### Unit Tests
- Test each adapter method independently
- Mock platform APIs
- Test error handling
- Test edge cases (rate limits, timeouts, etc.)

### Integration Tests
- Test full workflows on both platforms
- Test command registration and execution
- Test menu navigation
- Test notification delivery

### Manual Testing Checklist
For each feature:
- [ ] Works on Telegram (regression test)
- [ ] Works on Discord (new feature test)
- [ ] Error handling works correctly
- [ ] UI/UX is acceptable on both platforms
- [ ] Performance is acceptable

---

## Risk Mitigation

### Risk 1: Discord Rate Limits
**Mitigation**:
- Implement rate limit handling in Discord adapter
- Use exponential backoff
- Queue operations if needed
- Monitor rate limit usage

### Risk 2: Discord Interaction Timeouts
**Mitigation**:
- Always defer interactions immediately
- Use `interaction.deferReply()` for long operations
- Implement proper error handling for expired interactions

### Risk 3: Platform-Specific Limitations
**Mitigation**:
- Document all limitations clearly
- Implement graceful degradation
- Provide fallback UI/UX
- Test edge cases thoroughly

### Risk 4: Breaking Changes in Telegram
**Mitigation**:
- Maintain backward compatibility in Telegram adapter
- Test Telegram functionality after each change
- Use feature flags if needed

### Risk 5: Complexity of Menu Systems
**Mitigation**:
- Start with simple menus
- Gradually migrate complex menus
- Use shared base classes to reduce duplication
- Comprehensive testing at each step

---

## Success Criteria

### Phase 1 Success
- ✅ Platform adapter interface defined
- ✅ Basic adapters implemented and tested
- ✅ Can send/edit messages on both platforms

### Phase 2 Success
- ✅ Media handling works on both platforms
- ✅ Reactions work on both platforms
- ✅ Message formatting is consistent

### Phase 3 Success
- ✅ Menu systems work on Discord
- ✅ Interactions are handled correctly
- ✅ At least one component manager works on both platforms

### Phase 4 Success
- ✅ Dynamic commands work on Discord
- ✅ Command dispatchers work on both platforms
- ✅ Admin commands work on Discord

### Phase 5 Success
- ✅ All component managers work on both platforms
- ✅ No regressions on Telegram
- ✅ Feature parity achieved

### Final Success
- ✅ 100% feature parity between Discord and Telegram
- ✅ All tests passing
- ✅ Documentation complete
- ✅ Ready for production use

---

## Timeline Summary

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| Phase 0 | 1 day | Planning & documentation ✅ |
| Phase 1 | 1-2 weeks | Platform abstraction layer |
| Phase 2 | 1 week | Messaging & media parity |
| Phase 3 | 2 weeks | Interaction & menu systems |
| Phase 4 | 1-2 weeks | Command system parity |
| Phase 5 | 2 weeks | Component managers migration |
| Phase 6 | 1 week | Notification & delivery |
| Phase 7 | 1-2 weeks | Advanced features |
| Phase 8 | 1 week | Testing & documentation |
| **Total** | **10-12 weeks** | **Full parity** |

---

## Next Steps

1. **Review discord.js Documentation**
   - Focus on: Interactions, Components, Slash Commands, Embeds
   - Identify any APIs we'll need that aren't in current implementation

2. **Set Up Development Environment**
   - Create Discord test server
   - Set up test bot token
   - Configure development tooling

3. **Start Phase 1 Implementation**
   - Create PlatformAdapter interface
   - Implement basic Telegram adapter wrapper
   - Implement basic Discord adapter

4. **Establish Testing Infrastructure**
   - Set up test framework
   - Create mock platform adapters for unit tests
   - Set up integration test environment

---

## Notes

- This plan assumes discord.js v14+ (latest stable)
- Some features may need to be adapted based on Discord's limitations
- We should prioritize features based on user demand and usage patterns
- Consider creating a feature flag system to enable/disable Discord features during development
- Regular sync meetings to review progress and adjust plan as needed

---

**Last Updated**: 2025-01-XX
**Status**: Planning Phase Complete, Ready for Implementation

