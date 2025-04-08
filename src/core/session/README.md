# Session Management System

The Session Management System is a core component that provides immutable state management for user sessions. It replaces the global `lobby` object with a structured, testable, and predictable system.

## Core Components

### `SessionState`
Immutable representation of session data at a point in time, containing:
- User verification status
- Chat participation status
- Points balance (points, doints, qoints, boints)
- Generation preferences
- Workflows in progress
- Available commands

```javascript
const state = new SessionState({
  userId: '123',
  points: 100,
  doints: 50
});
```

The session state is immutable - once created, it cannot be changed. Instead, call `withUpdates()` to create a new state:

```javascript
const newState = state.withUpdates({ points: 150 });
// state.points is still 100
// newState.points is 150
```

### `SessionModel`
Complete session entity with metadata and lifecycle management:
- User ID linking
- Session creation and expiration timestamps
- Version tracking
- Access to immutable state

```javascript
const session = new SessionModel({
  userId: '123',
  state: new SessionState({ points: 100 })
});
```

### `SessionRepository`
Data access layer for session entities:
- CRUD operations for sessions
- In-memory storage (will be replaced with persistent storage)
- Session lookup by user ID or session ID

```javascript
const repository = new SessionRepository();
await repository.create(session);
const retrieved = await repository.findByUserId('123');
```

### `SessionService`
Business logic layer for session management:
- Session lifecycle operations (create, update, end)
- Chat participation management
- Automatic session cleanup
- User-friendly API

```javascript
const service = new SessionService();
await service.createSession('123', { points: 100 });
await service.updateSession('123', { points: 150 });
await service.endSession('123');
```

### `SessionAdapter`
Compatibility layer for integrating with legacy code:
- Bi-directional sync with legacy `lobby` object
- Forward-compatible API
- Migration utilities

```javascript
const adapter = new SessionAdapter({ legacyLobby: lobby });
await adapter.getSession('123'); // Tries new system, then legacy
await adapter.updateSession('123', { points: 150 }); // Updates both
```

## Usage Examples

### Creating a New Session

```javascript
const { SessionService } = require('../core/session');

const sessionService = new SessionService();
const session = await sessionService.createSession('user123', { 
  points: 100,
  verified: true
});
```

### Updating Session State

```javascript
// Update multiple properties
await sessionService.updateSession('user123', {
  points: 150,
  doints: 75
});

// Add to a chat
await sessionService.addUserToChat('user123', 'chat456');
```

### Migrating from Legacy Lobby

```javascript
const { createSessionAdapter } = require('../core/session');

// Get reference to legacy lobby
const lobby = require('../../utils/bot/bot').lobby;

// Create adapter with reference to legacy lobby
const sessionAdapter = createSessionAdapter(lobby);

// Use adapter to work with either system
const userSession = await sessionAdapter.getSession('user123');
console.log(userSession.points); 

// Updates both new and legacy systems
await sessionAdapter.setSessionProperty('user123', 'points', 200);
```

## Integration with Other Modules

### User Module

The Session system works with the User module:
- `UserService` provides persistent user data
- `SessionService` provides temporary session state
- Sessions reference users by `userId`

```javascript
const { UserService } = require('../core/user');
const { SessionService } = require('../core/session');

const userService = new UserService();
const sessionService = new SessionService();

// Create or get user
const user = await userService.getOrCreateUser('user123');

// Create session for user
const session = await sessionService.createSession(user.getId());
```

## Testing

The Session module is designed to be easily testable:
- Immutable state prevents side effects
- Repository can be mocked or replaced
- Service layer uses dependency injection
- All operations return new objects

```javascript
// Create a mock repository for testing
const mockRepository = {
  findByUserId: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn()
};

// Inject mock into service
const sessionService = new SessionService({ 
  sessionRepository: mockRepository 
});

// Test service operations
test('should create a session', async () => {
  // Arrange
  mockRepository.findByUserId.mockResolvedValueOnce(null);
  mockRepository.create.mockImplementationOnce(session => Promise.resolve(session));
  
  // Act
  const result = await sessionService.createSession('test-user');
  
  // Assert
  expect(result.userId).toBe('test-user');
  expect(mockRepository.create).toHaveBeenCalledTimes(1);
});
```

## Migration Strategy

The session system is designed to be gradually adopted:

1. Use `SessionAdapter` to work with both systems
2. Replace direct `lobby[userId]` access with adapter calls
3. Migrate core features one by one
4. Eventually remove legacy lobby system 