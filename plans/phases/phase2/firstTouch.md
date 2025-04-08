# First Integration: `/status` Command Refactoring

## Overview
This document tracks our first integration between the legacy bot code and the new core architecture, focusing on the `/status` command as our entry point. The goal is to successfully replace direct `lobby` access with our new `SessionManager` system, while minimizing risk and maintaining backward compatibility.

## Research Phase
I'm researching how the `/status` command is currently wired up, implemented, and what dependencies it has.

### Legacy Code Path Analysis

#### Command Registration and Routing
- The `/status` command is registered in the command registry in `utils/bot/handlers/iMessage.js`
- It maps to `iWork.handleStatus` function
- When a message comes in, the bot instance passes it to the message handler, which checks for commands
- If a command is found in the registry, it's executed directly with the message object

#### `/status` Implementation
- Located in `utils/bot/handlers/iWork.js` as `handleStatus(message)`
- Heavily coupled to Telegram message format
- Directly accesses global state like `lobby`, `taskQueue`, `waiting`, and `successors`
- Uses Telegram-specific functions like `sendMessage` and `react`
- Also accessed from callback queries through `iCallbaq.js`

#### Session Management / Gatekeeping Flow
- All commands go through `checkIn(message)` in `utils/bot/gatekeep.js` 
- `checkIn` calls `handleUserData(userId, message)` to validate user access
- `handleUserData` checks if the user exists in the lobby object
- If not, it fetches data from MongoDB:
  - `fetchUserCore(userId)` - Gets basic user data
  - `fetchFullUserData(userId)` - Gets complete user info if user exists
  - `initializeNewUser(userId)` - Creates new user if not found
- Updates user's `lastTouch` timestamp
- Sets user state to `IDLE` via `setUserState(message, STATES.IDLE)`

#### Command Execution Flow
1. User sends `/status` command to bot
2. Message handler in `iMessage.js` receives the message
3. Command is extracted and looked up in `commandRegistry`
4. Before executing command, system calls `checkIn(message)` to verify user
5. If verification passes, `iWork.handleStatus(message)` is executed
6. `handleStatus` reads global state and formats a response
7. Response is sent back to user via `sendMessage(message, msg, options)`

## Dependency Analysis
Here's a list of all files involved in the `/status` command flow:

### Direct Dependencies
1. `utils/bot/handlers/iMessage.js` - Command routing
2. `utils/bot/handlers/iWork.js` - Command implementation
3. `utils/bot/gatekeep.js` - User verification and session management
4. `utils/bot/bot.js` - Contains global state objects (`lobby`, `commandRegistry`)

### Indirect Dependencies
1. `db/operations/userFetch.js` - Database access for user data
2. `db/operations/newUser.js` - User creation
3. `utils/bot/utils.js` - Contains utility functions like `sendMessage` and `setUserState`

### Global State Dependencies
1. `lobby` - User session information
2. `taskQueue`, `waiting`, `successors` - Task processing queues
3. `STATES` - User state constants
4. `startup` - Bot startup timestamp (used for uptime calculation)

## Observations and Challenges

1. **Heavy Telegram Coupling**
   - The entire command flow assumes Telegram message format
   - Response formatting is Telegram-specific (markdown, inline keyboard)
   - Error handling is tied to Telegram reactions (`react()`)

2. **Global State Dependency**
   - Direct access to multiple global objects (`lobby`, `taskQueue`, etc.)
   - No abstraction layer between command logic and state
   - Mutation of global state throughout the flow

3. **Mixed Responsibilities**
   - Command logic mixed with presentation logic
   - Database access mixed with state management
   - No clear separation between core functionality and UI

4. **Integration Points for SessionManager**
   - Replace `lobby[userId]` access with `sessionManager.getSession(userId)`
   - Replace direct state mutations with `sessionManager.updateSession()`
   - Replace the gatekeeping check with SessionManager verification

## Implementation

Based on our research, we've implemented the following components to provide a clean integration of our new `SessionManager` with the legacy code:

### 1. Core Components

#### Feature Flags System
- Created `src/config/featureFlags.js` to control feature rollouts
- Includes ability to toggle `useNewSessionManager` flag
- Provides graceful fallback mechanism if issues occur

#### Core Status Command
- Created `src/commands/statusCommand.js` with platform-agnostic implementation
- Provides two main functions:
  - `getStatusInfo()` - Gets raw status information using SessionManager
  - `formatStatusResponse()` - Formats the information for display
- Completely decoupled from Telegram and global state
- Uses dependency injection for SessionManager and other services

#### Utility Helpers
- Created `src/utils/helpers.js` with general utilities
- Includes `convertTime()` function for formatting uptime
- Other utilities for future command refactoring

### 2. Integration Layer

#### Telegram Command Adapter
- Created `src/integrations/telegram/adapters/commandAdapter.js`
- Translates between platform-agnostic commands and Telegram
- Handles error cases with proper Telegram-formatted responses
- Uses ErrorHandler for standardized error handling

#### Status Command Integration
- Created `src/integrations/telegram/statusCommandIntegration.js`
- Provides a replacement handler for the legacy command registry
- Uses feature flags to toggle between implementations
- Maintains backward compatibility with legacy code

#### Telegram Integration Index
- Created `src/integrations/telegram/index.js`
- Centralizes Telegram integration initialization
- Manages SessionManager instance
- Provides clean interface for bootstrap process

### 3. Bootstrap Process

- Created `src/bootstrap.js` for initializing new architecture
- Connects to legacy code but maintains clean separation
- Initializes all required components and integrations
- Can be imported from app.js as a single entry point

### 4. Testing

- Unit tests for core status command
- Test cases for Telegram adapter
- Tests for various error cases and edge conditions
- Tests for feature flag behavior

## How to Test

To test this implementation:

1. Import the bootstrap module in app.js:
```javascript
// Add this line at the top of app.js
require('./src/bootstrap');
```

2. Start the bot and send `/status` command
3. The response should be generated using our new SessionManager
4. The response should include session version and last activity time
5. If the session didn't exist, it will be created
6. If an error occurs, it will fall back to the legacy implementation

## Next Steps

After confirming this implementation works:

1. **Extend the command adapter** to handle more commands
2. **Refactor the gatekeeping process** to use SessionManager
3. **Create more platform-agnostic command implementations**
4. **Add proper integration tests** for the entire flow

This first integration proves the concept and provides a template for future migrations. 