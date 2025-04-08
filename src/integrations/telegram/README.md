# Telegram Integration

This module provides adapters and integrations between the new core architecture and the legacy Telegram bot code.

## Overview

The Telegram integration layer serves as a bridge between platform-agnostic core functionality and Telegram-specific implementation details. It follows the adapter pattern, allowing our core business logic to remain decoupled from Telegram while maintaining compatibility with the existing bot code.

## Components

### Command Adapter

The command adapter (`adapters/commandAdapter.js`) translates between our new platform-agnostic commands and the Telegram bot API. It:

- Converts Telegram message objects to a standardized context object
- Executes the appropriate command from our core implementation
- Formats the response for Telegram (with proper markdown, inline keyboards, etc.)
- Handles errors and provides proper error responses

### Command Integrations

Each command integration (like `statusCommandIntegration.js`) replaces a specific command in the legacy command registry with a new implementation that leverages our core architecture. These integrations:

- Use feature flags to toggle between legacy and new implementations
- Maintain backward compatibility with existing code
- Provide a smooth transition path for migrating command handlers

### Integration Index

The main entry point (`index.js`) centralizes all Telegram integrations and provides a clean interface for the bootstrap process. It:

- Initializes the SessionManager instance
- Sets up adapters and integration points
- Registers command handlers with the legacy command registry
- Exposes services for other components to use

## Usage

To use the Telegram integration, import the bootstrap module in your application:

```javascript
// In app.js
require('./src/bootstrap');
```

This will automatically initialize all integrations and connect them to the legacy code.

You can also manually initialize the integration if needed:

```javascript
const { bootstrap } = require('./src/bootstrap');
const { bot, commandRegistry } = require('./utils/bot/bot');

// Initialize with explicit dependencies
bootstrap({ bot, commandRegistry });
```

## Feature Flags

The integration uses feature flags to control which components are active. You can toggle these flags in `src/config/featureFlags.js`:

```javascript
// Enable the new SessionManager implementation
featureFlags.enable('useNewSessionManager');

// Disable it if issues occur
featureFlags.disable('useNewSessionManager');
```

## Testing

Each component in the integration layer has corresponding test files in the `tests/` directory. Run the tests with:

```bash
npm test -- --testPathPattern=integrations/telegram
```

## Adding New Command Integrations

To add a new command integration:

1. Create a core implementation in `src/commands/`
2. Create a Telegram adapter in `src/integrations/telegram/adapters/` if needed
3. Create a command integration file in `src/integrations/telegram/`
4. Register the integration in `src/integrations/telegram/index.js` 