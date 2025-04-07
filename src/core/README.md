# Core Domain Module

This module contains the core domain logic and business rules for the application, implementing a clean architecture approach that separates concerns and provides a foundation for the refactored codebase.

## Architecture

The core module follows Domain-Driven Design principles with a layered architecture:

```
src/core/
├── user/              # User domain models and services
├── points/            # Points domain models and services
├── generation/        # Generation domain models and services
└── shared/            # Shared utilities and interfaces
    ├── events.js      # Event bus for cross-domain communication
    └── repository.js  # Generic repository interface
```

Each domain module implements:
- **Domain Models**: Business entities and value objects
- **Services**: Business logic and operations
- **Repositories**: Data access interfaces with backward compatibility

## Domain Modules

### User

The user module manages user identity, verification, preferences, and data:

- **`UserCore`**: Identity and verification
- **`UserEconomy`**: Economic data tied to a user
- **`UserPreferences`**: User preferences and settings
- **`UserService`**: User management operations
- **`UserRepository`**: Data access for user entities

[Read more about the User module](./user/README.md)

### Points

The points module manages the points economy system:

- **`UserPoints`**: Point balances for a user
- **`PointsService`**: Points management and operations
- **`PointsCalculationService`**: Point calculations and formulas
- **`PointsRepository`**: Data access for points entities

[Read more about the Points module](./points/README.md)

### Generation

The generation module manages content generation tasks:

- **`GenerationRequest`**: Request to generate content
- **`GenerationResponse`**: Response from generation
- **`GenerationTask`**: Task tracking and lifecycle
- **`GenerationService`**: Task management operations
- **`GenerationRepository`**: Data access for tasks

[Read more about the Generation module](./generation/README.md)

## Shared Components

### Event Bus

The event bus facilitates communication between domains through a publish-subscribe pattern:

```javascript
const { events } = require('./src/core');

// Subscribe to events
events.subscribe('user:created', (data) => {
  console.log(`New user created: ${data.userId}`);
});

// Publish events
events.publish('user:created', { userId: '123456789' });
```

### Repository Interface

A generic repository interface that defines standard data access methods:

```javascript
class SomeRepository extends Repository {
  async create(data) {
    // Implementation
  }
  
  async findById(id) {
    // Implementation
  }
  
  // Other methods...
}
```

## Integration & Usage

The core modules are designed to work together while maintaining separation of concerns:

```javascript
const core = require('./src/core');

// Create a user
const user = await core.user.service.createUser({
  userId: '123456789',
  // ...user data
});

// Add points
await core.points.service.addPoints(
  user.core.userId,
  100,
  core.points.PointType.POINTS,
  'welcome-bonus'
);

// Create generation task
const task = await core.generation.service.createTask({
  userId: user.core.userId,
  prompt: 'A beautiful sunset over mountains',
  // ...generation settings
});
```

## Backward Compatibility

During the migration phase, these modules maintain backward compatibility with the existing codebase through:

1. Legacy database adapters in repositories
2. Event-based communication for state changes
3. Conversion methods between new domain models and legacy data structures

## Migration Strategy

The core modules provide the foundation for the refactored application but don't directly replace existing code. Instead, they work alongside the legacy code during migration:

1. **Phase 1 (Current)**: Establish core domains with backward compatibility
2. **Phase 2**: Gradually migrate existing code to use core domains
3. **Phase 3**: Replace direct legacy database access with repository interfaces
4. **Phase 4**: Implement platform adapters for Telegram and other integrations
5. **Phase 5**: Complete the migration and remove legacy code 