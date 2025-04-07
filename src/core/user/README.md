# User Core Module

This module provides the core user domain model and services for the application. It manages user identity, preferences, and economy, following a clean architecture approach with separation of concerns.

## Components

### Models

- **`User`**: Complete user model that combines core identity, economy, and preferences
- **`UserCore`**: Contains identity and verification-related information (userId, wallet, verified status, etc.)
- **`UserEconomy`**: Contains points, currency, and asset-related information
- **`UserPreferences`**: Contains user preferences and settings for generation and UI

### Services

- **`UserService`**: Business logic for user operations such as:
  - User creation and initialization
  - User retrieval and updates
  - Wallet verification
  - API key management
  - User activity tracking

### Repository

- **`UserRepository`**: Data access for user entities
  - Implements the generic Repository interface
  - Maintains backward compatibility with the legacy database structure
  - Emits events for user actions

## Usage Examples

### Creating a User

```javascript
const { service } = require('./src/core/user');

// Initialize a new user
const user = await service.initializeNewUser('123456789', {
  wallet: 'user-wallet-address'
});
```

### Retrieving User Data

```javascript
const { service } = require('./src/core/user');

// Get user by ID
const user = await service.getUserById('123456789');

if (user) {
  // Access user properties
  console.log(`User ID: ${user.core.userId}`);
  console.log(`Verified: ${user.core.verified}`);
  console.log(`Points: ${user.economy.points}`);
  console.log(`Settings: ${JSON.stringify(user.preferences.generationSettings)}`);
}
```

### Updating User Data

```javascript
const { service } = require('./src/core/user');

// Update user properties
const updatedUser = await service.updateUser('123456789', {
  points: 100,
  doints: 50,
  'preferences.generationSettings.input_steps': 40
});
```

### Verifying a User's Wallet

```javascript
const { service } = require('./src/core/user');

// Verify user wallet
await service.verifyUserWallet('123456789', 'wallet-address');
```

## Events

The user module emits the following events through the event bus:

- **`user:created`**: When a new user is created
- **`user:updated`**: When a user is updated
- **`user:deleted`**: When a user is deleted

You can subscribe to these events:

```javascript
const eventBus = require('./src/core/shared/events');

eventBus.subscribe('user:created', (data) => {
  console.log(`New user created: ${data.userId}`);
});
```

## Migration Notes

This module is designed to work with both the new architecture and the legacy database structure. The `UserRepository` acts as an adapter between the domain models and the existing database, allowing for a gradual migration process without disrupting the existing functionality.

During the migration phase, this module will:

1. Interface with the legacy database using the existing DB models
2. Transform data between the new domain models and legacy structures
3. Maintain backward compatibility for all critical operations
4. Emit events for other modules to react to user actions 