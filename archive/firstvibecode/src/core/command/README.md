# Command Router System

The Command Router system provides a platform-agnostic way to define, register, and execute commands in the application.

## Core Components

### Command Registry
- Central registry for all commands
- Provides discovery and metadata management
- Supports command categorization and grouping

### Command Router
- Routes command requests to appropriate handlers
- Manages command execution lifecycle
- Applies middleware for cross-cutting concerns

### Middleware System
- Pre and post-command execution hooks
- Common middleware for validation, logging, etc.
- Customizable middleware pipeline

### Platform Adapters
- Abstract command interface
- Platform-specific command interpreters
- Context mapping between platforms

## Usage

### Defining a Command

```javascript
// commands/myCommand.js
function execute(context) {
  // Command implementation
  return { result: 'Success' };
}

module.exports = {
  name: 'myCommand',
  description: 'Example command',
  execute,
  metadata: {
    category: 'utility',
    requiresAuth: true
  }
};
```

### Registering Commands

```javascript
const { CommandRegistry } = require('../core/command');
const myCommand = require('./commands/myCommand');

// Get or create registry
const registry = CommandRegistry.getInstance();

// Register commands
registry.register(myCommand);
```

### Executing Commands

```javascript
const { CommandRouter } = require('../core/command');

// Create a command router
const router = new CommandRouter();

// Execute a command
const result = await router.execute('myCommand', {
  userId: '123',
  parameters: { option: 'value' }
});
```

### Adding Middleware

```javascript
const { CommandRouter } = require('../core/command');
const loggingMiddleware = require('./middleware/logging');

// Create a command router
const router = new CommandRouter();

// Add middleware
router.use(loggingMiddleware);

// Execute with middleware applied
const result = await router.execute('myCommand', context);
```

### Creating Platform Adapters

```javascript
const { CommandRouter, AbstractCommandAdapter } = require('../core/command');

class TelegramAdapter extends AbstractCommandAdapter {
  convertRequest(telegramMessage) {
    // Convert Telegram message to command format
    return {
      command: 'myCommand',
      context: {
        userId: telegramMessage.from.id,
        parameters: {}
      }
    };
  }
  
  convertResponse(response, telegramMessage) {
    // Convert command response to Telegram format
    return {
      chatId: telegramMessage.chat.id,
      text: response.result
    };
  }
}
```

## Advanced Features

- **Command Permissions**: Control who can execute commands
- **Rate Limiting**: Prevent command abuse
- **Command Events**: Monitor command execution lifecycle
- **Command Groups**: Organize commands into logical groups
- **Help Documentation**: Automatically generate help from metadata

## Best Practices

1. **Platform Independence**: Keep command logic free from platform details
2. **Clear Separation of Concerns**: Use middleware for cross-cutting concerns
3. **Consistent Interfaces**: Follow the defined patterns for commands
4. **Test Coverage**: Write tests for both command logic and integration
5. **Error Handling**: Use the error system for consistent error responses 