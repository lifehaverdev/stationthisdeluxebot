const { SessionAdapter, createSessionAdapter } = require('../../src/adapters/sessionAdapter');

describe('SessionAdapter', () => {
  let mockSessionManager;
  let sessionAdapter;

  beforeEach(() => {
    // Create mock for SessionManager
    mockSessionManager = {
      getUserSession: jest.fn(),
      getUserSessions: jest.fn()
    };
    
    // Initialize the adapter with mock
    sessionAdapter = new SessionAdapter({ sessionManager: mockSessionManager });
  });

  describe('getUserAnalyticsData', () => {
    it('should return analytics data for a valid user ID', async () => {
      // Setup mock data
      const userId = '123456789';
      const mockSessionData = {
        joinedChats: ['-100123456789', '-100987654321'],
        verificationStatus: { verified: true, timestamp: Date.now() },
        actions: [{ type: 'join', chatId: '-100123456789', timestamp: Date.now() }]
      };
      
      // Setup mock implementation
      mockSessionManager.getUserSession.mockResolvedValue(mockSessionData);
      
      // Execute the method
      const result = await sessionAdapter.getUserAnalyticsData(userId);
      
      // Assertions
      expect(mockSessionManager.getUserSession).toHaveBeenCalledWith(userId);
      expect(result).toEqual(mockSessionData);
    });
    
    it('should return null when no session data is found', async () => {
      // Setup user ID
      const userId = 'nonexistent-user';
      
      // Setup mock to return null (no session found)
      mockSessionManager.getUserSession.mockResolvedValue(null);
      
      // Execute the method
      const result = await sessionAdapter.getUserAnalyticsData(userId);
      
      // Assertions
      expect(mockSessionManager.getUserSession).toHaveBeenCalledWith(userId);
      expect(result).toBeNull();
    });
  });
  
  describe('factory function', () => {
    it('should create a SessionAdapter instance', () => {
      // Setup
      const adapter = createSessionAdapter({ sessionManager: mockSessionManager });
      
      // Assertions
      expect(adapter).toBeInstanceOf(SessionAdapter);
    });
    
    it('should throw error when sessionManager is not provided', () => {
      // Assertions
      expect(() => createSessionAdapter({})).toThrow('sessionManager is required');
    });
  });
}); 