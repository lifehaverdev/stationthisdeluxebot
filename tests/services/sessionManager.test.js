/**
 * SessionManager Tests
 * 
 * Test suite for the SessionManager class that verifies its functionality
 * and integration with the core session system.
 */

const { SessionManager, createSessionManager } = require('../../src/services/sessionManager');
const { ErrorHandler } = require('../../src/core/shared/errors/ErrorHandler');

// Mock the session system
jest.mock('../../src/core/session', () => {
  // Create mock implementation of the core session components
  const mockSessionService = {
    createSession: jest.fn().mockImplementation((userId, data) => {
      return Promise.resolve({
        userId,
        sessionId: `session_${userId}`,
        state: { userId, ...data }
      });
    }),
    getSessionByUserId: jest.fn(),
    updateSession: jest.fn(),
    endSession: jest.fn(),
    listActiveSessions: jest.fn(),
    countActiveSessions: jest.fn(),
    generateApiKey: jest.fn(),
    revokeApiKey: jest.fn(),
    createWebSession: jest.fn(),
    cleanupExpiredSessions: jest.fn()
  };
  
  const mockSessionAdapter = {
    getSession: jest.fn(),
    updateSession: jest.fn()
  };
  
  const mockRepository = {
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    listActive: jest.fn(),
    countActive: jest.fn(),
    cleanupExpired: jest.fn()
  };
  
  return {
    createSessionSystem: jest.fn().mockImplementation(() => {
      return {
        service: mockSessionService,
        adapter: mockSessionAdapter,
        repository: mockRepository
      };
    })
  };
});

describe('SessionManager', () => {
  let sessionManager;
  let errorHandler;
  
  // Sample user data for testing
  const sampleUserId = 'user123';
  const sampleUserData = {
    name: 'Test User',
    points: 100
  };
  
  beforeEach(() => {
    // Create a new session manager before each test
    sessionManager = createSessionManager({
      legacyLobby: {
        [sampleUserId]: sampleUserData
      }
    });
    
    errorHandler = new ErrorHandler();
    
    // Reset all mocks before each test
    jest.clearAllMocks();
  });
  
  describe('constructor', () => {
    it('should create a SessionManager instance', () => {
      expect(sessionManager).toBeInstanceOf(SessionManager);
    });
    
    it('should initialize with default options when none provided', () => {
      const defaultManager = createSessionManager();
      expect(defaultManager).toBeInstanceOf(SessionManager);
    });
  });
  
  describe('getUserData', () => {
    it('should retrieve user data from session adapter', async () => {
      // Setup
      sessionManager.sessionAdapter.getSession.mockResolvedValue(sampleUserData);
      
      // Execute
      const result = await sessionManager.getUserData(sampleUserId);
      
      // Verify
      expect(sessionManager.sessionAdapter.getSession).toHaveBeenCalledWith(sampleUserId, true);
      expect(result).toEqual(sampleUserData);
      expect(sessionManager.metrics.gets).toBe(1);
    });
    
    it('should return empty object when session not found and not creating', async () => {
      // Setup
      sessionManager.sessionAdapter.getSession.mockResolvedValue(null);
      
      // Execute
      const result = await sessionManager.getUserData(sampleUserId, false);
      
      // Verify
      expect(sessionManager.sessionAdapter.getSession).toHaveBeenCalledWith(sampleUserId, false);
      expect(result).toEqual({});
      expect(sessionManager.metrics.gets).toBe(1);
    });
    
    it('should handle errors and return empty object', async () => {
      // Setup
      const testError = new Error('Test error');
      sessionManager.sessionAdapter.getSession.mockRejectedValue(testError);
      
      // Spy on emit to check for error events
      const emitSpy = jest.spyOn(sessionManager, 'emit');
      
      // Execute
      const result = await sessionManager.getUserData(sampleUserId);
      
      // Verify
      expect(sessionManager.sessionAdapter.getSession).toHaveBeenCalled();
      expect(result).toEqual({});
      expect(emitSpy).toHaveBeenCalledWith('error', testError);
      expect(sessionManager.metrics.errors).toBe(1);
    });
  });
  
  describe('updateUserData', () => {
    it('should update user data through session adapter', async () => {
      // Setup
      const updates = { points: 150 };
      const updatedData = { ...sampleUserData, ...updates };
      sessionManager.sessionAdapter.updateSession.mockResolvedValue(updatedData);
      
      // Execute
      const result = await sessionManager.updateUserData(sampleUserId, updates);
      
      // Verify
      expect(sessionManager.sessionAdapter.updateSession).toHaveBeenCalledWith(sampleUserId, updates);
      expect(result).toEqual(updatedData);
      expect(sessionManager.metrics.sets).toBe(1);
    });
    
    it('should handle errors and return null', async () => {
      // Setup
      const testError = new Error('Update error');
      sessionManager.sessionAdapter.updateSession.mockRejectedValue(testError);
      
      // Spy on emit to check for error events
      const emitSpy = jest.spyOn(sessionManager, 'emit');
      
      // Execute
      const result = await sessionManager.updateUserData(sampleUserId, { points: 150 });
      
      // Verify
      expect(result).toBeNull();
      expect(emitSpy).toHaveBeenCalledWith('error', testError);
      expect(sessionManager.metrics.errors).toBe(1);
    });
  });
  
  describe('createUserSession', () => {
    it('should create a new user session with merged defaults', async () => {
      // Setup
      const initialData = { name: 'New User' };
      const defaults = { points: 0, notifications: true };
      
      // Create manager with defaults
      const managerWithDefaults = createSessionManager({
        defaults
      });
      
      // Mock the session creation
      managerWithDefaults.sessionService.createSession.mockResolvedValue({
        userId: 'newUser',
        sessionId: 'session_newUser',
        state: { userId: 'newUser', ...defaults, ...initialData }
      });
      
      // Spy on emit to check for events
      const emitSpy = jest.spyOn(managerWithDefaults, 'emit');
      
      // Execute
      const result = await managerWithDefaults.createUserSession('newUser', initialData);
      
      // Verify
      expect(managerWithDefaults.sessionService.createSession).toHaveBeenCalledWith(
        'newUser',
        { ...defaults, ...initialData }
      );
      expect(result).toEqual({ userId: 'newUser', ...defaults, ...initialData });
      expect(emitSpy).toHaveBeenCalledWith('session:created', {
        userId: 'newUser',
        sessionId: 'session_newUser'
      });
      expect(managerWithDefaults.metrics.creates).toBe(1);
    });
    
    it('should handle errors and return null', async () => {
      // Setup
      const testError = new Error('Creation error');
      sessionManager.sessionService.createSession.mockRejectedValue(testError);
      
      // Spy on emit to check for error events
      const emitSpy = jest.spyOn(sessionManager, 'emit');
      
      // Execute
      const result = await sessionManager.createUserSession('newUser', { name: 'New User' });
      
      // Verify
      expect(result).toBeNull();
      expect(emitSpy).toHaveBeenCalledWith('error', testError);
      expect(sessionManager.metrics.errors).toBe(1);
    });
  });
  
  describe('deleteUserSession', () => {
    it('should delete a user session', async () => {
      // Setup
      sessionManager.sessionService.endSession.mockResolvedValue(true);
      
      // Spy on emit to check for events
      const emitSpy = jest.spyOn(sessionManager, 'emit');
      
      // Execute
      const result = await sessionManager.deleteUserSession(sampleUserId);
      
      // Verify
      expect(sessionManager.sessionService.endSession).toHaveBeenCalledWith(sampleUserId);
      expect(result).toBe(true);
      expect(emitSpy).toHaveBeenCalledWith('session:deleted', { userId: sampleUserId });
    });
    
    it('should return false when deletion fails', async () => {
      // Setup
      sessionManager.sessionService.endSession.mockResolvedValue(false);
      
      // Execute
      const result = await sessionManager.deleteUserSession(sampleUserId);
      
      // Verify
      expect(sessionManager.sessionService.endSession).toHaveBeenCalledWith(sampleUserId);
      expect(result).toBe(false);
    });
    
    it('should handle errors and return false', async () => {
      // Setup
      const testError = new Error('Deletion error');
      sessionManager.sessionService.endSession.mockRejectedValue(testError);
      
      // Spy on emit to check for error events
      const emitSpy = jest.spyOn(sessionManager, 'emit');
      
      // Execute
      const result = await sessionManager.deleteUserSession(sampleUserId);
      
      // Verify
      expect(result).toBe(false);
      expect(emitSpy).toHaveBeenCalledWith('error', testError);
      expect(sessionManager.metrics.errors).toBe(1);
    });
  });
  
  describe('getAllSessions', () => {
    it('should return all active sessions', async () => {
      // Setup
      const mockSessions = [
        { sessionId: 'session1', state: { userId: 'user1', name: 'User 1' } },
        { sessionId: 'session2', state: { userId: 'user2', name: 'User 2' } }
      ];
      sessionManager.sessionService.listActiveSessions.mockResolvedValue(mockSessions);
      
      // Execute
      const result = await sessionManager.getAllSessions();
      
      // Verify
      expect(sessionManager.sessionService.listActiveSessions).toHaveBeenCalled();
      expect(result).toEqual([
        { userId: 'user1', name: 'User 1' },
        { userId: 'user2', name: 'User 2' }
      ]);
    });
    
    it('should handle errors and return empty array', async () => {
      // Setup
      const testError = new Error('List error');
      sessionManager.sessionService.listActiveSessions.mockRejectedValue(testError);
      
      // Spy on emit to check for error events
      const emitSpy = jest.spyOn(sessionManager, 'emit');
      
      // Execute
      const result = await sessionManager.getAllSessions();
      
      // Verify
      expect(result).toEqual([]);
      expect(emitSpy).toHaveBeenCalledWith('error', testError);
      expect(sessionManager.metrics.errors).toBe(1);
    });
  });
  
  describe('getMetrics', () => {
    it('should return current metrics', async () => {
      // Setup - Perform some operations to update metrics
      sessionManager.metrics.gets = 5;
      sessionManager.metrics.sets = 3;
      sessionManager.metrics.creates = 2;
      sessionManager.metrics.errors = 1;
      
      // Execute
      const metrics = sessionManager.getMetrics();
      
      // Verify
      expect(metrics).toEqual({
        gets: 5,
        sets: 3,
        creates: 2,
        errors: 1
      });
      
      // Check that metrics is a copy, not a reference
      metrics.gets = 100;
      expect(sessionManager.metrics.gets).toBe(5);
    });
  });
}); 