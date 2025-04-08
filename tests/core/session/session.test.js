/**
 * Session module tests
 */

// Mock modules
jest.mock('../../../src/core/shared/events', () => {
  const eventMock = {
    publish: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn()
  };
  return {
    // Default export
    __esModule: true,
    default: eventMock,
    // Named exports
    events: eventMock,
    publish: eventMock.publish,
    subscribe: eventMock.subscribe,
    unsubscribe: eventMock.unsubscribe
  };
});

// Define test data
const testUserId = 'test-user-123';
const testChatId = 'telegram-chat-456';
const testClientData = {
  ip: '127.0.0.1',
  userAgent: 'Test Browser'
};

// Create mock store
class MockStore extends Map {
  constructor() {
    super();
  }
}

// Mock crypto.randomBytes
jest.mock('crypto', () => ({
  randomBytes: jest.fn().mockReturnValue({
    toString: jest.fn().mockReturnValue('test-api-key')
  })
}));

// Import after mocking
const { 
  SessionService, 
  SessionRepository, 
  SessionModel, 
  SessionState,
  ClientType,
  createSessionAdapter
} = require('../../../src/core/session');

const eventBus = require('../../../src/core/shared/events').default;

describe('Session Module', () => {
  let mockStore;
  let sessionRepository;
  let sessionService;
  let sessionAdapter;
  let legacyLobby;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock store and repository
    mockStore = new MockStore();
    sessionRepository = new SessionRepository({ store: mockStore });
    sessionService = new SessionService(sessionRepository);
    
    // Create a mock legacy lobby
    legacyLobby = {};
    
    // Create adapter with mock lobby
    sessionAdapter = createSessionAdapter(legacyLobby, sessionService);
  });
  
  describe('SessionState', () => {
    test('should create immutable state object with defaults', () => {
      // Act
      const state = new SessionState({ userId: testUserId });
      
      // Assert
      expect(state.userId).toBe(testUserId);
      expect(state.points).toBe(0);
      expect(state.stationedIn).toEqual({});
      expect(state.clientConnections).toEqual({});
      expect(state.verified).toBe(false);
      
      // Test immutability using Object.isFrozen
      expect(Object.isFrozen(state)).toBe(true);
      
      // Test nested objects are also frozen
      expect(Object.isFrozen(state.stationedIn)).toBe(true);
      expect(Object.isFrozen(state.clientConnections)).toBe(true);
    });
    
    test('should update state immutably with withUpdates', () => {
      // Arrange
      const state = new SessionState({ userId: testUserId, points: 50 });
      
      // Act
      const newState = state.withUpdates({ points: 100 });
      
      // Assert
      expect(state.points).toBe(50); // Original unchanged
      expect(newState.points).toBe(100); // New value in new object
      expect(newState.userId).toBe(testUserId); // Preserved original values
    });
    
    test('should check client connections correctly', () => {
      // Arrange
      const clientConnections = {
        'telegram_123': { type: ClientType.TELEGRAM, chatId: '123' },
        'web_456': { type: ClientType.WEB }
      };
      
      const state = new SessionState({ 
        userId: testUserId,
        clientConnections,
        activeClientType: ClientType.WEB,
        activeClientId: 'web_456'
      });
      
      // Act & Assert
      expect(state.hasActiveClient('telegram_123')).toBe(true);
      expect(state.hasActiveClient('web_456')).toBe(true);
      expect(state.hasActiveClient('unknown')).toBe(false);
      
      expect(state.getClientType('telegram_123')).toBe(ClientType.TELEGRAM);
      expect(state.getClientType('web_456')).toBe(ClientType.WEB);
      expect(state.getClientType('unknown')).toBeNull();
      
      expect(state.isWebSession()).toBe(true);
      expect(state.isTelegramSession()).toBe(true);
      expect(state.isApiSession()).toBe(false);
    });
  });
  
  describe('SessionModel', () => {
    test('should create session model with default state', () => {
      // Act
      const session = new SessionModel({ userId: testUserId });
      
      // Assert
      expect(session.userId).toBe(testUserId);
      expect(session.sessionId).toContain('session_test-user-123');
      expect(session.state).toBeInstanceOf(SessionState);
      expect(session.state.userId).toBe(testUserId);
    });
    
    test('should update state immutably', () => {
      // Arrange
      const session = new SessionModel({ userId: testUserId });
      
      // Act
      const updatedSession = session.updateState({ points: 100 });
      
      // Assert
      expect(session.state.points).toBe(0); // Original unchanged
      expect(updatedSession.state.points).toBe(100); // New value
      expect(updatedSession.version).toBe(2); // Version incremented
      expect(session.version).toBe(1); // Original version unchanged
    });
    
    test('should convert from legacy lobby data', () => {
      // Arrange
      const lobbyData = {
        points: 100,
        doints: 50,
        verified: true,
        stationed: { 'chat-123': true, 'chat-456': true },
        commandList: [{ command: 'test', description: 'Test command' }]
      };
      
      // Act
      const session = SessionModel.fromLobby(testUserId, lobbyData);
      
      // Assert
      expect(session.userId).toBe(testUserId);
      expect(session.state.points).toBe(100);
      expect(session.state.doints).toBe(50);
      expect(session.state.verified).toBe(true);
      expect(session.state.stationedIn).toEqual({ 'chat-123': true, 'chat-456': true });
      expect(session.state.commandList).toEqual([{ command: 'test', description: 'Test command' }]);
      
      // Check client connections were created
      expect(session.state.clientConnections).toHaveProperty('telegram_chat-123');
      expect(session.state.clientConnections).toHaveProperty('telegram_chat-456');
      expect(session.state.clientConnections['telegram_chat-123'].type).toBe(ClientType.TELEGRAM);
      expect(session.state.activeClientType).toBe(ClientType.TELEGRAM);
    });
  });
  
  describe('SessionRepository', () => {
    test('should create and retrieve a session', async () => {
      // Arrange
      const session = new SessionModel({ userId: testUserId });
      
      // Act
      const createdSession = await sessionRepository.create(session);
      const retrievedSession = await sessionRepository.findByUserId(testUserId);
      
      // Assert
      expect(createdSession).toBe(session);
      expect(retrievedSession).toBe(session);
      expect(retrievedSession.userId).toBe(testUserId);
    });
    
    test('should update a session', async () => {
      // Arrange
      const session = new SessionModel({ userId: testUserId });
      await sessionRepository.create(session);
      
      // Act
      const updatedSession = await sessionRepository.update(testUserId, { 
        points: 100 
      });
      
      // Assert
      expect(updatedSession).not.toBe(session); // New object
      expect(updatedSession.state.points).toBe(100);
      expect(updatedSession.version).toBeGreaterThan(session.version);
      
      // Check the store was updated
      const storedSession = await sessionRepository.findByUserId(testUserId);
      expect(storedSession.state.points).toBe(100);
    });
    
    test('should delete a session', async () => {
      // Arrange
      const session = new SessionModel({ userId: testUserId });
      await sessionRepository.create(session);
      
      // Act
      const result = await sessionRepository.delete(testUserId);
      const retrievedSession = await sessionRepository.findByUserId(testUserId);
      
      // Assert
      expect(result).toBe(true);
      expect(retrievedSession).toBeNull();
    });
  });
  
  describe('SessionService', () => {
    test('should create a session', async () => {
      // Act
      const createdSession = await sessionService.createSession(testUserId, { points: 100 });
      
      // Assert
      expect(createdSession.userId).toBe(testUserId);
      expect(createdSession.state.points).toBe(100);
      expect(eventBus.publish).toHaveBeenCalledWith(
        'session:created', 
        expect.objectContaining({ userId: testUserId })
      );
    });
    
    test('should get or create a session', async () => {
      // Act - First call creates
      const session1 = await sessionService.getOrCreateSession(testUserId);
      
      // Assert
      expect(session1.userId).toBe(testUserId);
      
      // Act - Second call retrieves
      const session2 = await sessionService.getOrCreateSession(testUserId);
      
      // Assert - Same session instance
      expect(session2).toBe(session1);
    });
    
    test('should update a session', async () => {
      // Arrange
      await sessionService.createSession(testUserId);
      
      // Act
      const updatedSession = await sessionService.updateSession(testUserId, { points: 200 });
      
      // Assert
      expect(updatedSession.state.points).toBe(200);
      expect(eventBus.publish).toHaveBeenCalledWith(
        'session:updated', 
        expect.objectContaining({ userId: testUserId })
      );
    });
    
    test('should add a user to a chat (legacy)', async () => {
      // Arrange
      await sessionService.createSession(testUserId);
      
      // Act
      const updatedSession = await sessionService.addUserToChat(testUserId, testChatId);
      
      // Assert
      expect(updatedSession.state.stationedIn[testChatId]).toBe(true);
      expect(updatedSession.state.currentChatId).toBe(testChatId);
      
      // Check client connections
      const clientId = `telegram_${testChatId}`;
      expect(updatedSession.state.clientConnections[clientId]).toBeDefined();
      expect(updatedSession.state.clientConnections[clientId].type).toBe(ClientType.TELEGRAM);
      expect(updatedSession.state.activeClientId).toBe(clientId);
      expect(updatedSession.state.activeClientType).toBe(ClientType.TELEGRAM);
    });
    
    test('should add a client connection', async () => {
      // Arrange
      await sessionService.createSession(testUserId);
      const clientId = 'web_12345';
      
      // Act
      const updatedSession = await sessionService.addClientConnection(
        testUserId, 
        clientId,
        ClientType.WEB,
        testClientData
      );
      
      // Assert
      expect(updatedSession.state.clientConnections[clientId]).toBeDefined();
      expect(updatedSession.state.clientConnections[clientId].type).toBe(ClientType.WEB);
      expect(updatedSession.state.clientConnections[clientId].ip).toBe('127.0.0.1');
      expect(updatedSession.state.activeClientId).toBe(clientId);
      expect(updatedSession.state.activeClientType).toBe(ClientType.WEB);
    });
    
    test('should create a web session', async () => {
      // Act
      const result = await sessionService.createWebSession(testUserId, testClientData);
      
      // Assert
      expect(result.session.userId).toBe(testUserId);
      expect(result.apiKey).toBe('test-api-key');
      expect(result.session.state.apiKey).toBe('test-api-key');
      
      // Check client connection
      const clientId = Object.keys(result.session.state.clientConnections)[0];
      expect(clientId).toContain('web_');
      expect(result.session.state.clientConnections[clientId].type).toBe(ClientType.WEB);
      expect(result.session.state.clientConnections[clientId].ip).toBe('127.0.0.1');
      expect(result.session.state.activeClientType).toBe(ClientType.WEB);
    });
    
    test('should find a session by API key', async () => {
      // Arrange
      const result = await sessionService.createWebSession(testUserId);
      
      // Act
      const foundSession = await sessionService.getSessionByApiKey('test-api-key');
      
      // Assert
      expect(foundSession.userId).toBe(testUserId);
    });
  });
  
  describe('SessionAdapter', () => {
    test('should get session from new system or legacy lobby', async () => {
      // Arrange - Session in new system
      await sessionService.createSession(testUserId, { points: 100 });
      
      // Act
      const session1 = await sessionAdapter.getSession(testUserId);
      
      // Assert
      expect(session1.points).toBe(100);
      
      // Arrange - Session only in legacy lobby
      const legacyUserId = 'legacy-user';
      legacyLobby[legacyUserId] = { points: 200 };
      
      // Act
      const session2 = await sessionAdapter.getSession(legacyUserId);
      
      // Assert - Should be migrated and retrieved
      expect(session2.points).toBe(200);
    });
    
    test('should update session and sync with legacy lobby', async () => {
      // Arrange
      await sessionService.createSession(testUserId);
      
      // Act
      await sessionAdapter.updateSession(testUserId, { points: 300 });
      
      // Assert - Check both new system and legacy lobby
      const newSession = await sessionService.getSessionByUserId(testUserId);
      expect(newSession.state.points).toBe(300);
      expect(legacyLobby[testUserId].points).toBe(300);
      
      // Test that client-specific fields are not synced to legacy lobby
      await sessionAdapter.updateSession(testUserId, { 
        clientConnections: { 'test': { type: 'web' } }
      });
      expect(legacyLobby[testUserId].clientConnections).toBeUndefined();
    });
    
    test('should create web session and generate API key', async () => {
      // Act
      const result = await sessionAdapter.createWebSession(testUserId);
      
      // Assert
      expect(result.state.userId).toBe(testUserId);
      expect(result.apiKey).toBe('test-api-key');
      expect(result.state.apiKey).toBe('test-api-key');
      
      // Check that the session is using web
      const isWeb = await sessionAdapter.isWebSession(testUserId);
      expect(isWeb).toBe(true);
    });
    
    test('should get session property with fallback', async () => {
      // Arrange - Property in new system
      await sessionService.createSession(testUserId, { points: 100 });
      
      // Act
      const points1 = await sessionAdapter.getSessionProperty(testUserId, 'points');
      
      // Assert
      expect(points1).toBe(100);
      
      // Arrange - Property only in legacy lobby
      const legacyUserId = 'legacy-user-2';
      legacyLobby[legacyUserId] = { customField: 'test-value' };
      
      // Act
      const customValue = await sessionAdapter.getSessionProperty(legacyUserId, 'customField');
      
      // Assert
      expect(customValue).toBe('test-value');
      
      // Act - Property doesn't exist
      const missing = await sessionAdapter.getSessionProperty(testUserId, 'nonexistent', 'default');
      
      // Assert
      expect(missing).toBe('default');
    });
  });
}); 