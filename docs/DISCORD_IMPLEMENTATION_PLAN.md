# Discord Implementation Plan (No Telegram Changes)

## Strategy

**Key Principle**: Build Discord features to match Telegram functionality WITHOUT modifying any Telegram code.

- ✅ Telegram code remains untouched
- ✅ Discord features built independently using discord.js
- ✅ Use Telegram as a reference for what features to build
- ✅ Match Telegram's architecture patterns (dispatchers, component managers, etc.)
- ⏳ Future: Once Discord works, we can abstract both to use adapters

## Current Status

### ✅ Completed
1. **Discord Dispatcher System** (`src/platforms/discord/dispatcher.js`)
   - `ButtonInteractionDispatcher` - Routes button clicks (like Telegram callback queries)
   - `SelectMenuInteractionDispatcher` - Routes select menu interactions
   - `CommandDispatcher` - Routes slash commands
   - `DynamicCommandDispatcher` - Routes dynamic commands from ToolRegistry

### 📋 Next Steps (Priority Order)

#### Phase 1: Core Infrastructure
1. **Discord Utilities** (`src/platforms/discord/utils/`)
   - `messaging.js` - Message sending helpers (like Telegram's messaging.js)
   - `discordUtils.js` - Reaction helpers, file utilities
   - `replyContextManager.js` - Context management for multi-step interactions

2. **Update Discord Bot** (`src/platforms/discord/bot.js`)
   - Integrate dispatchers
   - Set up interaction handlers (button, select menu, command)
   - Register component managers

#### Phase 2: Component Managers (Match Telegram)
Build Discord versions of Telegram's component managers:

1. **Settings Menu Manager** (`src/platforms/discord/components/settingsMenuManager.js`)
   - Reference: `telegram/components/settingsMenuManager.js`
   - Discord: Use buttons/select menus instead of inline keyboards

2. **Wallet Manager** (`src/platforms/discord/components/walletManager.js`)
   - Reference: `telegram/components/walletManager.js`

3. **Tools Menu Manager** (`src/platforms/discord/components/toolsMenuManager.js`)
   - Reference: `telegram/components/toolsMenuManager.js`

4. **Dashboard Menu Manager** (`src/platforms/discord/components/dashboardMenuManager.js`)
   - Reference: `telegram/components/dashboardMenuManager.js`

5. **Buy Points Manager** (`src/platforms/discord/components/buyPointsManager.js`)
   - Reference: `telegram/components/buyPointsManager.js`

6. **Mods Menu Manager** (`src/platforms/discord/components/modsMenuManager.js`)
   - Reference: `telegram/components/modsMenuManager.js`
   - Complex: Many interactions, pagination, etc.

7. **Collection Menu Manager** (`src/platforms/discord/components/collectionMenuManager.js`)
   - Reference: `telegram/components/collectionMenuManager.js`

8. **Delivery Menu System** (`src/platforms/discord/components/deliveryMenu/`)
   - `globalMenuManager.js` - Hide menu, etc.
   - `infoManager.js` - Generation info
   - `rateManager.js` - Rating generations
   - `rerunManager.js` - Rerun generations
   - `tweakManager.js` - Tweak generations

#### Phase 3: Notification System
1. **Discord Notifier** (`src/platforms/discord/discordNotifier.js`)
   - Reference: `telegram/telegramNotifier.js`
   - Send generation results with action buttons
   - Handle multi-output generations

#### Phase 4: Dynamic Commands
1. **Dynamic Command Registration** (`src/platforms/discord/dynamicCommands.js`)
   - Reference: `telegram/dynamicCommands.js`
   - Register slash commands from ToolRegistry
   - Handle tool execution

#### Phase 5: Advanced Features
1. **Input Collector** (`src/platforms/discord/components/inputCollector.js`)
   - Reference: `telegram/components/inputCollector.js`
   - Use Discord modals for text input
   - Handle file uploads via attachments

2. **Admin Utilities** (`src/platforms/discord/utils/adminUtils.js`)
   - Reference: `telegram/utils/adminUtils.js`

## Architecture Pattern

### Telegram Pattern (Reference)
```
telegram/
├── bot.js                    # Sets up dispatchers, registers handlers
├── dispatcher.js             # Routes events to handlers
├── components/               # Feature managers register with dispatchers
│   └── settingsMenuManager.js
└── utils/                    # Platform utilities
```

### Discord Pattern (Mirror)
```
discord/
├── bot.js                    # Sets up dispatchers, registers handlers
├── dispatcher.js             # Routes interactions to handlers
├── components/               # Feature managers register with dispatchers
│   └── settingsMenuManager.js
└── utils/                    # Platform utilities
```

## Key Differences to Handle

### Interactions
- **Telegram**: Callback queries (`callback_data`)
- **Discord**: Button interactions (`custom_id`), Select menus (`custom_id` + `values`)

### Commands
- **Telegram**: Text commands (`/command`)
- **Discord**: Slash commands (structured, typed)

### Menus
- **Telegram**: Inline keyboards (unlimited buttons)
- **Discord**: Message components (max 25 buttons, 5 rows × 5 buttons)

### Reactions
- **Telegram**: Bot sets reactions (`setMessageReaction`)
- **Discord**: Bot reacts (`message.react()`)

### File Handling
- **Telegram**: File IDs, need API call to get URL
- **Discord**: Direct attachment URLs

## Implementation Notes

1. **No Telegram Changes**: All Telegram code stays as-is
2. **Copy Pattern, Not Code**: Use Telegram as reference, but write Discord-specific code
3. **Test Independently**: Test Discord features without affecting Telegram
4. **Document Differences**: Note where Discord limitations require different approaches

## Next Immediate Steps

1. ✅ Create Discord dispatcher system (DONE)
2. ⏳ Create Discord utilities (messaging, reactions)
3. ⏳ Update Discord bot.js to use dispatchers
4. ⏳ Create first component manager (Settings) as proof of concept
5. ⏳ Test end-to-end workflow

---

**Status**: Dispatcher system complete, ready to build utilities and component managers

