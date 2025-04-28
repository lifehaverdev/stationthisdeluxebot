# Interface-Agnostic Architecture for StationThis

This codebase follows a clean, interface-agnostic architecture that separates business logic from user interfaces. This allows us to provide consistent functionality across multiple platforms (Telegram, Web) while maintaining a single source of truth for all business rules.

## Core Architecture

The system is built around three key layers:

1. **Core Domain Layer** (`/core`)
   - Platform-agnostic business logic
   - User management, authentication, and authorization
   - Credit/points system
   - Internal API for all functionality

2. **Service Adapters Layer** (`/services`)
   - Black-box wrappers for external services
   - Standardized interfaces for all service integrations
   - Cost tracking and error handling
   - Service registry for discovery

3. **Interface Adapters Layer** (`/integrations`)
   - Platform-specific adapters (Telegram, Web)
   - Translates platform interactions to internal API calls
   - UI component rendering system
   - Session management

## Key Components

### Internal API

The `internalAPI.js` file serves as the primary interface between platform adapters and core business logic. All functionality is exposed through this API, ensuring consistent behavior across all platforms.

```javascript
// Example of using the internal API
const result = await internalAPI.runCommand('make', {
  prompt: 'a cat wearing a hat'
}, {
  userId: '123',
  platform: { type: 'telegram' }
});
```

### Service Adapters

Service adapters provide a consistent interface to external services, hiding implementation details behind a standardized API.

```javascript
// Example of a service adapter
class ImageGenerationAdapter extends ServiceAdapter {
  async execute(params, context) {
    // Implementation details hidden from consumers
  }
  
  async getEstimatedCost(params) {
    return 10; // Cost in points
  }
}
```

### Interface Adapters

Interface adapters connect platform-specific code to the internal API, handling the translation between platform interactions and internal commands.

```javascript
// Example of an interface adapter
class TelegramAdapter {
  async handleCommand(command, args, context) {
    // Translate to internal API call
    return internalAPI.runCommand(command, args, context);
  }
}
```

## Design Principles

1. **Separation of Concerns**
   - Business logic is completely separated from interfaces
   - Data access is abstracted through repositories
   - Services are treated as black boxes

2. **Interface Agnosticism**
   - Core functionality works without knowledge of interfaces
   - Platform-specific code is isolated in adapters
   - All commands route through the internal API

3. **Standard Patterns**
   - Service adapters follow adapter pattern
   - Command handling uses command pattern
   - Sessions use repository pattern

## Development Process

When adding new features or extending the system:

1. First, implement core business logic in the appropriate domain module
2. Create or update service adapters if external service integration is needed
3. Define commands in the internal API layer
4. Create UI components independent of platform
5. Implement platform-specific rendering in interface adapters

This approach ensures that functionality is consistent across all interfaces while allowing for platform-specific presentation.

## Testing

The clean architecture facilitates testing by isolating components:

- Core business logic can be tested without interfaces
- Service adapters can be mocked for testing
- Interface adapters can be tested with mock API responses

## Directory Structure

```
src/
├── api/                  # REST API endpoints
├── bootstrap.js          # Application initialization
├── commands/             # Command definitions
├── core/                 # Core business logic
│   ├── account/          # User account management
│   ├── command/          # Command processing system
│   ├── internalAPI.js    # Central API layer
│   ├── points/           # Credit system
│   ├── session/          # Session management
│   └── ...               # Other domain modules
├── db/                   # Database access layer
├── integrations/         # Platform adapters
│   ├── telegram/         # Telegram bot integration
│   └── web/              # Web interface
├── services/             # Service adapters
│   ├── baseAdapter.js    # Base adapter class
│   ├── registry.js       # Service registry
│   └── ...               # Service-specific adapters
└── utils/                # Shared utilities
```

## Getting Started

To add a new feature to the system:

1. Define the business logic in the appropriate core module
2. Create an internal API method to expose the functionality
3. Implement service adapters if needed
4. Connect platform-specific code through interface adapters

This ensures that all features maintain the clean, interface-agnostic design of the system. 