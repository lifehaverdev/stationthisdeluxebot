# iGroup.js Plan

## Current Purpose
`iGroup.js` manages all group chat functionalities within the bot, including group initialization, administration, settings management, gatekeeping, custom commands, and group-specific configurations. It serves as the central handler for group-specific interactions and settings, allowing group administrators to customize the bot's behavior in their groups.

## Exported Functions/Classes
- **Group Management Functions**:
  - `buildGroupSettingsHeader(groupChatId, title)` - Creates header for group settings
  - `initializeGroup(message, user, groupChatId)` - Initializes a new group
  - `groupMenu(message)` - Shows the main group settings menu
  - `privateGroupMenu(message, user, groupChatId)` - Shows settings menu in private chat
  - `buildGroupSettingsMenu(groupChatId, isDms)` - Builds group settings UI

- **Group Settings Handlers**:
  - `handleGroupMenu(message, user, groupChatId, menuType)` - Routes to specific settings menus
  - `groupGatekeepMenu(message, user, groupChatId)` - Shows gatekeeping settings
  - `groupCommandMenu(message, user, groupChatId)` - Shows command settings
  - `groupPromptMenu(message, user, groupChatId)` - Shows prompt settings
  - `groupUnlockMenu(message, user, groupChatId)` - Shows unlock options
  - `backToGroupSettingsMenu(message, user, groupChatId)` - Returns to main settings

- **Gatekeeping Functions**:
  - `groupGatekeepTypeMenu(message, user, groupChatId)` - Shows gatekeeping type options
  - `groupGatekeepTypeSelect(message, user, groupChatId, type)` - Selects gatekeeping type
  - `groupPointAccountingTypeMenu(message, user, groupChatId)` - Shows point accounting options
  - `groupGatekeepPointAccountingSelect(message, user, groupChatId, type)` - Selects accounting type

- **Command Management Functions**:
  - `groupCommandListMenu(message, page, user, groupChatId)` - Shows command list
  - `buildGCommandListMenu(message, page, group, pageSize)` - Builds command list UI
  - `buildGCommandButtons(group, command, index)` - Creates command buttons
  - `handleCommandListEdit(message, user, index, command, groupChatId)` - Edits commands
  - `groupCustomCommandMenu(message, user, groupChatId)` - Shows custom command menu
  - `groupCustomCommandTaskMenu(message, user, task, groupChatId, command)` - Handles command tasks
  - `groupCustomCommandSet(message, user, command, groupChatId)` - Sets custom command

- **Utility Functions**:
  - `generateInlineKeyboard(buttons)` - Creates inline keyboard
  - `setGroupFlag(group, flagType, user, message_id)` - Sets group state flag
  - `clearGroupFlag(group)` - Clears group state flag
  - `capitalizeFirstLetter(string)` - Capitalizes first letter
  - `saveGroupRQ(group)` - Saves group with required words and qoints

- **Settings Type Functions**:
  - `groupSettingsTypeMenu(message, user, groupChatId)` - Shows settings type menu
  - `groupSettingsTypeSelect(message, user, groupChatId, type)` - Selects settings type
  - `mustHavesMenu(message, user, groupChatId)` - Shows required settings menu
  - `buildMustHaveKeyboard(groupChatId)` - Builds required settings keyboard
  - `mustHaveSelect(message, user, groupChatId, mustHave)` - Selects required setting

- **Classes**:
  - `GroupSettingHandler` - Handles group setting input/output flow

## Dependencies and Integrations
- Telegram bot UI and message handling through `sendMessage`, `editMessage`, etc.
- References global objects like `rooms`, `lobby`, etc.
- Database operations through `FloorplanDB`
- Default user data from `defaultUserData.js`
- Bot instance through `getBotInstance`
- Shared functions `getGroup` and `getGroupById`

## Identified Issues
- Telegram-specific UI mixed with core group logic
- Direct references to global state objects
- Complex conditional logic for UI generation
- Multiple responsibilities: group management, gatekeeping, command handling
- Lack of clear separation between data access, business logic, and presentation
- Hard-coded UI elements and workflows
- Limited error handling
- Tight coupling with database operations

## Migration Plan
1. Create `src/core/group/`:
   - `model.js` - Core group data models
   - `service.js` - Business logic for group operations
   - `gatekeeping.js` - Gatekeeping logic
   - `commands.js` - Custom command management
   - `settings.js` - Group settings management

2. Create `src/integrations/telegram/group.js`:
   - Telegram-specific UI for group management
   - Group command handlers
   - Group menu generation and callbacks

3. Implement `src/api/group.js`:
   - Internal API for group operations
   - Group management endpoints
   - Group settings and permissions

4. Suggested improvements:
   - Implement proper permission system for group actions
   - Create a UI component system for consistent menu generation
   - Separate group data persistence from UI state
   - Create configuration-based menu definitions
   - Implement proper validation for all group settings
   - Add proper error handling and recovery mechanisms
   - Create separate modules for each group feature
   - Implement logging for group operations
   - Add analytics for group usage patterns 