# Account Management Module

This module implements account management functionality using the clean architecture approach, separating core business logic from platform-specific implementations.

## Components

### Core Components
- **commands.js**: Platform-agnostic command handlers for account management operations
- **service.js**: Core business logic for account operations
- **points.js**: Points management functionality

### Workflows
- **AccountWorkflow.js**: Multi-step workflow implementation for account management operations

## Commands

The module implements the following commands:

1. **Account Command** (`/account`)
   - Platform-agnostic implementation for accessing account settings
   - Provides access to profile, preferences, and API key management

2. **Points Command** (`/points`)
   - Displays user's points balance
   - Allows viewing transaction history and refreshing balance

3. **Subcommands**
   - **Profile**: Manage user profile information
   - **Preferences**: Manage user preferences (notifications, language, theme)
   - **API Keys**: Manage API keys (create, delete)
   - **Delete Account**: Safely delete user account with confirmation

## Integration

To use these commands in your application:

1. Import the core command factories and registration function:
   ```javascript
   const {
     createAccountCommand,
     createPointsCommand,
     registerAccountCommands
   } = require('./core/account/commands');
   ```

2. Register the commands with your command registry:
   ```javascript
   registerAccountCommands(commandRegistry, {
     accountService,
     pointsService,
     sessionManager,
     analyticsService,
     workflowEngine,
     uiManager
   });
   ```

3. For platform-specific integration, use platform adapters:
   ```javascript
   // For Telegram
   const { registerTelegramAccountCommands } = require('./integrations/telegram/commands/account');
   registerTelegramAccountCommands(telegramBot, dependencies);
   ```

## Testing

The module includes comprehensive tests:

- Unit tests for core command handlers
- Integration tests for platform-specific adapters
- End-to-end tests for complete workflows

Run the tests with:
```
npm test -- --testPathPattern=core/account
```

## Dependencies

The account commands depend on the following services:

- **AccountService**: Core service for account operations
- **PointsService**: Service for points management
- **SessionManager**: Session management for workflow persistence
- **UIManager**: UI rendering for displaying menus and messages
- **WorkflowEngine**: Engine for executing multi-step workflows
- **AnalyticsService**: Optional service for tracking events 