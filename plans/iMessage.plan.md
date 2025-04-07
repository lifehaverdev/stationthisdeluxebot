# iMessage.js Plan

## Current Purpose
`iMessage.js` handles message processing, command routing, and interaction flow within the bot. It serves as the main entry point for all incoming messages, deciding how to process them based on message type, user state, and content.

## Exported Functions/Classes
- **Message Processing Functions**:
  - `handleMessage(message)` - Main entry point for message processing
  - `handleTextMessage(message)` - Processes text messages
  - `handlePhotoMessage(message)` - Processes photo messages
  - `handleFileMessage(message)` - Processes file messages
  - `handleBotCommand(message)` - Processes bot commands

- **State Management Functions**:
  - `handleState(message)` - Routes message based on user state
  - `setState(userId, state)` - Sets user state
  - `clearState(userId)` - Clears user state

- **Command Processing Functions**:
  - `processCommand(message, command)` - Processes command
  - `routeCommand(message, commandName)` - Routes to appropriate command handler
  - `getCommandParams(text)` - Extracts command parameters

- **Callback Query Handling**:
  - `handleCallbackQuery(callback)` - Processes callback queries
  - `routeCallbackAction(callback, action)` - Routes callback to handler

## Dependencies and Integrations
- Telegram bot API for message handling
- References global state via `lobby`, `STATES`, etc.
- Command registry from bot module
- Various handler files for specific commands
- Utility functions for message sending, state management

## Identified Issues
- Tightly coupled with Telegram-specific message formats
- Heavy reliance on global state objects
- Complex routing logic with many conditional branches
- No clear separation between message parsing and command execution
- Mixed responsibilities: routing, state management, message parsing
- Lacks structured error handling
- Hard to test due to tight coupling with external dependencies

## Migration Plan
1. Create `src/core/messaging/`:
   - `router.js` - Core routing logic for messages
   - `processor.js` - Message processing functions
   - `state.js` - State management functions
   - `parser.js` - Message parsing functions

2. Create `src/integrations/telegram/message.js`:
   - Telegram-specific message handling
   - Message format adaptation
   - Telegram update processing

3. Implement `src/api/message.js`:
   - Internal API for message operations
   - Webhook endpoint for message receiving
   - Message sending API

4. Create `src/core/command/`:
   - `registry.js` - Command registration and lookup
   - `executor.js` - Command execution logic
   - `parser.js` - Command parsing utilities

5. Suggested improvements:
   - Implement a proper command registry with dependency injection
   - Create a message pipeline for consistent processing
   - Add middleware support for cross-cutting concerns
   - Implement proper error handling and recovery
   - Add monitoring and logging for message flow
   - Create a state machine for managing conversation flow
   - Implement rate limiting and abuse prevention 