# SessionManager

The `SessionManager` provides a simplified interface for session management throughout the application. It acts as a high-level service that leverages the core session system internally, offering easy-to-use methods for common session operations while handling errors, tracking metrics, and providing event-based feedback.

## Features

- **Simplified Session API**: Provides a clean, application-focused interface for session operations
- **Built-in Error Handling**: All methods handle errors gracefully and emit error events
- **Legacy Compatibility**: Works with both new core session system and legacy lobby
- **Default Values**: Supports application-specific defaults for new sessions
- **Metrics Tracking**: Automatically tracks usage statistics for session operations
- **Event-based Feedback**: Emits events for session lifecycle actions
- **Platform-Agnostic**: Works with any client platform (Telegram, Web, API)

## Usage

### Basic Usage

```javascript
const { createSessionManager } = require('../services/sessionManager');

// Create session manager with default options
const sessionManager = createSessionManager();

// Get user data (creates session if not exists)
const userData = await sessionManager.getUserData('user123');

// Update user data
await sessionManager.updateUserData('user123', { points: 150 });

// Create a new session with specific initial data
await sessionManager.createUserSession('newUser', { 
  name: 'New User',
  points: 50
});

// Delete a user session
await sessionManager.deleteUserSession('user123');
```

### With Legacy Lobby and Defaults

```javascript
// Create session manager with legacy lobby reference and default values
const sessionManager = createSessionManager({
  legacyLobby: global.lobby, // Legacy lobby reference
  defaults: {
    points: 0,
    preferences: {
      theme: 'system',
      notifications: true
    }
  }
});
```

### Error Handling

```javascript
// Listen for error events
sessionManager.on('error', (error) => {
  console.error('Session error:', error);
  
  // You can use the ErrorHandler to normalize errors
  const errorHandler = new ErrorHandler();
  const normalizedError = errorHandler.handleError(error, {
    component: 'SessionManager',
    context: { operation: 'example' }
  });
  
  // Log the normalized error
  console.error(`[${normalizedError.code}] ${normalizedError.message}`);
});
```

### Web Sessions

```javascript
// Create a web session with API key
const webSession = await sessionManager.createWebSession('user123');

// Access the API key
const apiKey = webSession.apiKey;

// Access the session data
const sessionData = webSession.sessionData;
```

### Performance Monitoring

```javascript
// Get metrics
const metrics = sessionManager.getMetrics();
console.log(`Session operations: ${metrics.gets} gets, ${metrics.sets} sets, ${metrics.creates} creates, ${metrics.errors} errors`);

// Cleanup expired sessions
const cleanedCount = await sessionManager.cleanup();
console.log(`Cleaned up ${cleanedCount} expired sessions`);
```

## API Reference

### Constructor

```javascript
new SessionManager(options)
```

- **options.legacyLobby** (Object): Reference to legacy lobby object for backward compatibility
- **options.persistence** (Object): Persistence options for the session repository
- **options.defaults** (Object): Default values for new sessions

### Methods

#### getUserData(userId, createIfNotExists = true)

Gets user data from a session. Creates a new session if none exists and createIfNotExists is true.

#### updateUserData(userId, updates)

Updates user data in the session with the provided updates.

#### createUserSession(userId, initialData = {})

Creates a new user session with initial data, merged with default values.

#### deleteUserSession(userId)

Deletes a user session.

#### hasUserSession(userId)

Checks if a user has an active session.

#### getAllSessions()

Returns an array of all active session data objects.

#### getSessionCount()

Returns the count of active sessions.

#### generateApiKey(userId)

Generates a new API key for a user.

#### revokeApiKey(userId)

Revokes a user's API key.

#### createWebSession(userId)

Creates a web session for a user, returning session data and API key.

#### getMetrics()

Returns performance metrics for session operations.

#### cleanup()

Cleans up expired sessions and returns the count of cleaned up sessions.

### Events

- **error**: Emitted when an error occurs in any method
- **session:created**: Emitted when a new session is created
- **session:deleted**: Emitted when a session is deleted

## Integration with Core Session System

The SessionManager is built on top of the core session system, using:

1. **SessionService**: For core session lifecycle operations
2. **SessionAdapter**: For backward-compatible data access
3. **Repository**: For direct data access when needed

The manager delegates most operations to these components, providing a simpler interface and additional functionality like error handling, event emission, and metrics tracking. 