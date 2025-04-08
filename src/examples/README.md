# SessionAdapter Examples

This directory contains comprehensive examples demonstrating how to use the SessionAdapter with various common patterns and use cases. Each example showcases a different way to utilize session management in your application.

## Important Note

**These examples are reference implementations** intended to demonstrate patterns and usage scenarios for the SessionAdapter. They are not meant to be executed directly in the current codebase structure as they:

1. Import modules that may not yet exist in your project structure (`../adapters/sessionAdapter`, `../services/sessionManager`)
2. Use interfaces that match the design specifications but may differ from current implementations
3. Serve as documentation and design patterns rather than executable code

When implementing these patterns in your actual codebase, you'll need to:
- Adjust import paths to reflect your project structure
- Ensure dependencies like SessionAdapter and SessionManager are properly implemented
- Modify the examples to work with your specific session implementation

## Available Examples

### 1. Command Handler Example (`commandHandlerExample.js`)

A command pattern implementation showing how to:
- Register and manage commands with a handler system
- Track command usage in user sessions
- Implement built-in commands that access session data
- Handle command authentication and permissions
- Use events to notify other parts of the application

**Key classes:**
- `CommandHandler` - Manages command registration and execution

### 2. Webhook Handler Example (`webhookHandlerExample.js`)

A webhook processing system showing how to:
- Validate incoming webhook requests with signatures
- Process different types of external events
- Update user sessions based on third-party service data
- Track webhook delivery for analytics
- Handle common webhook scenarios (payments, subscriptions, etc.)

**Key classes:**
- `WebhookHandler` - Processes incoming webhooks and updates sessions

### 3. Rate Limiter Example (`rateLimiterExample.js`)

A flexible rate limiting system showing how to:
- Define different rate limits for different actions
- Track and enforce per-user rate limits
- Store rate limit data in user sessions
- Reset limits and analyze usage patterns
- Handle edge cases and errors gracefully

**Key classes:**
- `RateLimiter` - Tracks and enforces rate limits using session data

### 4. Preferences Manager Example (`preferencesManagerExample.js`)

A user preferences system showing how to:
- Define preference schemas with validation rules
- Store and retrieve user preferences
- Apply default values for new users
- Validate preference values against schemas
- Support batch operations and preference resets
- Emit events when preferences change

**Key classes:**
- `PreferencesManager` - Manages user preferences with validation

### 5. Feature Flags Example (`featureFlagsExample.js`)

A feature flag implementation showing how to:
- Define feature flags with various configurations
- Implement percentage-based gradual rollouts
- Create rule-based feature enabling logic
- Override features for specific users
- Track feature flag usage in analytics

**Key classes:**
- `FeatureFlagsManager` - Handles feature flag evaluation and tracking

## Adapting For Your Project

To adapt these examples for your project:

1. Create the necessary files in your project structure:
   - Implement the `SessionAdapter` and `SessionManager` classes
   - Ensure they follow the interface patterns shown in these examples

2. Update import paths in the examples to match your project structure

3. Modify the example implementations as needed to work with your specific requirements

## Implementation Details

Each example implements a different pattern but follows similar principles:

1. They all use the SessionAdapter for managing user data
2. They demonstrate both reading and writing session data
3. They track activity for analytics purposes
4. They handle errors gracefully
5. They include realistic use cases and examples

## Best Practices Demonstrated

These examples showcase several best practices:

- **Separation of concerns** - Each class has a single responsibility
- **Dependency injection** - Services are passed in rather than created internally
- **Error handling** - All async operations are properly handled
- **Activity tracking** - User actions are logged for analytics
- **Validation** - Input data is validated before being processed
- **Event emission** - Changes trigger events for other parts of the system
- **Defensive programming** - Code handles edge cases and unexpected scenarios

## Using Examples as Design Patterns

You can use these examples as starting points for your own implementations. Each class demonstrates design patterns that you can adapt to your specific needs in the ongoing Phase 2 refactoring process.

---

## Recent Project Progress

As part of Phase 2 of the refactoring effort, we've recently completed the implementation of the `StateContainer` class in `src/core/shared/state.js`. This general-purpose immutable state container can be used with the SessionAdapter to ensure data integrity and controlled state mutations. 

These examples will be adapted to work with the actual implementation of the SessionAdapter once it's integrated into the codebase. The StateContainer's event system and immutable state pattern align perfectly with the design patterns shown in these examples.

Next steps involve replacing actual `lobby[userId]` instances with SessionAdapter in the production code, following the patterns demonstrated in these examples.

## Command Handler Example

The `commandHandlerExample.js` file demonstrates how to implement a command handler system that uses the SessionAdapter pattern. This is a key architectural pattern in our new system that decouples command processing from the specific platform (e.g., Telegram).

### Key Features

- **SessionAdapter Integration**: Uses SessionAdapter for tracking user state without direct lobby access
- **Command Registration System**: Provides a flexible way to register and manage commands
- **Event-Based Architecture**: Uses EventEmitter for notification of command execution
- **Session State Tracking**: Tracks command usage in user sessions
- **Mock Implementation**: Includes a mock implementation for demonstration purposes
- **Persistent Data Storage**: Demonstrates storing data (reminders) in user session

### Running the Example

To run the example, execute:

```bash
node src/examples/runCommandExample.js
```

### Example Output

The example will simulate executing multiple commands and show their output:

```
Starting command handler example...

Executing help command:
[CommandHandler] User testuser (12345) executed command: help
Available commands:

help: Show available commands
stats: Show your usage statistics
profile: Show your profile information
remind: Set and manage reminders. Usage: remind <text> or just remind to list all

Command executed: help by testuser at Fri Apr 09 2023 12:00:00 GMT+0000 (Coordinated Universal Time)

Executing stats command:
[CommandHandler] User testuser (12345) executed command: stats
Your command usage stats:

help: 1 times

Command executed: stats by testuser at Fri Apr 09 2023 12:00:00 GMT+0000 (Coordinated Universal Time)

Executing profile command:
[CommandHandler] User testuser (12345) executed command: profile
User Profile:
User ID: 12345
Username: testuser
Last Active: 4/9/2023, 12:00:00 PM
Commands Used: 2

Command executed: profile by testuser at Fri Apr 09 2023 12:00:00 GMT+0000 (Coordinated Universal Time)

Setting a reminder:
[CommandHandler] User testuser (12345) executed command: remind
Reminder added: Call Mom at 5pm

Command executed: remind by testuser at Fri Apr 09 2023 12:00:00 GMT+0000 (Coordinated Universal Time)

Listing all reminders:
[CommandHandler] User testuser (12345) executed command: remind
Your reminders:

1. Call Mom at 5pm (4/9/2023, 12:00:00 PM)

Command executed: remind by testuser at Fri Apr 09 2023 12:00:00 GMT+0000 (Coordinated Universal Time)

Example completed successfully
```

### Key Command Examples

#### Basic Commands
- **help**: Lists all available commands with descriptions
- **stats**: Shows command usage statistics stored in the session
- **profile**: Displays user profile information from session data

#### Advanced Commands
- **remind**: Demonstrates persistent data storage within a session
  - With arguments: `remind Call Mom at 5pm` - Adds a new reminder
  - Without arguments: `remind` - Lists all stored reminders

### Using in Your Code

To use the CommandHandler in your own code:

```javascript
const { CommandHandler, createMockSessionAdapter } = require('./commandHandlerExample');

// Create a session adapter (real or mock)
const sessionAdapter = createMockSessionAdapter();

// Create the command handler
const commandHandler = new CommandHandler({ sessionAdapter });

// Register a custom command
commandHandler.registerCommand('greeting', async (message, args, session) => {
  return `Hello, ${message.from.username}!`;
}, 'Send a friendly greeting');

// Process commands
const response = await commandHandler.processCommand(message, 'greeting', '');
console.log(response); // "Hello, username!"
```

### Integration with Real SessionAdapter

When ready to integrate with the real SessionAdapter:

```javascript
const { createSessionAdapter } = require('../core/session/adapter');
const { CommandHandler } = require('./commandHandlerExample');

// Create a real session adapter
const sessionAdapter = createSessionAdapter();

// Create the command handler with the real adapter
const commandHandler = new CommandHandler({ sessionAdapter });

// ... register commands and process as before
```

### Benefits of This Approach

1. **Decoupled Architecture**: Commands are processed independently of the delivery mechanism (Telegram, web, etc.)
2. **Testability**: Easy to test command logic without complex dependencies
3. **State Management**: User state is managed consistently through the SessionAdapter
4. **Extensibility**: New commands can be easily added without changing core logic
5. **Consistency**: Commands follow a standard pattern for registration and execution
6. **Analytics**: Command usage can be easily tracked via event listeners