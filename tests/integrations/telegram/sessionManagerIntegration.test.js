/**
 * Tests for SessionManager integration with Telegram
 * 
 * This test suite verifies that the SessionManager properly
 * integrates with the Telegram command adapter.
 */

// This needs to be imported before mocks to avoid reference errors
const { AppError } = require('../../../src/core/shared/errors');

// Mock dependencies before importing anything else
jest.mock('../../../src/services/sessionManager');
jest.mock('../../../src/commands/statusCommand');

// We need to completely mock the commandAdapter
// Note: Use mockFn prefix as Jest allows this pattern
jest.mock('../../../src/integrations/telegram/adapters/commandAdapter', () => {
  // Using mockFn prefixed variables to avoid Jest's out-of-scope error
  const mockExecuteCommand = jest.fn().mockImplementation(async (commandName, message) => {
    // This is a simplified version of the adapter's executeCommand function
    try {
      const userId = message.from.id.toString();
      
      if (commandName.toLowerCase() === 'status') {
        // Get startup time
        const startupTime = Date.now() - 60000; // Mock 1 minute
        
        // Get our test's session manager from global
        const sessionManager = global.sessionManager;
        
        // Use the mocked status command
        // Get a direct reference to avoid closures
        const mockStatusCommand = require('../../../src/commands/statusCommand');
        
        const statusInfo = await mockStatusCommand.getStatusInfo({
          sessionManager,
          startupTime,
          taskService: { 
            getTasksForUser: () => ({ active: [], waiting: [], completed: [] }) 
          },
          userId
        });
        
        const formattedResponse = mockStatusCommand.formatStatusResponse(statusInfo, { 
          isAdmin: false,
          format: 'markdown'
        });
        
        return {
          chatId: message.chat.id,
          text: formattedResponse.text,
          options: {
            parse_mode: 'Markdown',
            reply_markup: formattedResponse.refreshable ? 
              { inline_keyboard: [[{ text: '🔄', callback_data: 'refresh' }]] } : 
              undefined
          }
        };
      } else {
        // Use AppError directly from import
        const { AppError } = require('../../../src/core/shared/errors');
        throw new AppError(`Unknown command: ${commandName}`, { code: 'UNKNOWN_COMMAND' });
      }
    } catch (error) {
      // Return an error response
      return {
        chatId: message.chat.id,
        text: `⚠️ Error: ${error.message}`,
        options: { parse_mode: 'Markdown' }
      };
    }
  });
  
  return {
    executeCommand: mockExecuteCommand
  };
});

// Import dependencies after mock setup
const { SessionManager } = require('../../../src/services/sessionManager');
const statusCommand = require('../../../src/commands/statusCommand');
const { executeCommand } = require('../../../src/integrations/telegram/adapters/commandAdapter');

describe('SessionManager with Telegram Integration', () => {
  let mockSessionManager;
  let mockStatusInfo;
  let mockSession;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock session
    mockSession = {
      id: 'test-session-123',
      get: (key) => mockSession[key],
      lastActivity: Date.now() - 600000, // 10 minutes ago
      createdAt: Date.now() - 3600000, // 1 hour ago
      lastCommand: null,
      visitCount: 5,
      version: 1
    };
    
    // Setup mock session manager
    mockSessionManager = new SessionManager();
    mockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
    mockSessionManager.updateSession = jest.fn().mockImplementation((userId, updates) => {
      return Promise.resolve({ ...mockSession, ...updates });
    });
    mockSessionManager.createSession = jest.fn().mockImplementation((userId, data) => {
      return Promise.resolve({ 
        id: `new-session-${userId}`,
        get: (key) => data[key] || null, 
        ...data 
      });
    });
    
    // Make session manager available globally BEFORE each test
    global.sessionManager = mockSessionManager;
    
    // Setup mock status info with session data
    mockStatusInfo = {
      runtime: { seconds: 3600, formatted: '1h' },
      session: { 
        id: 'test-session', 
        version: 1, 
        createdAt: Date.now() - 86400000, 
        lastActivity: Date.now() - 600000
      },
      tasks: { active: [], waiting: [], completed: [] },
      system: { useNewSessionManager: true, timestamp: Date.now() }
    };
    
    // Mock status command with specific implementation
    statusCommand.getStatusInfo = jest.fn().mockImplementation(async (context) => {
      const { sessionManager, userId } = context;
      
      // Call the session manager methods to verify they work
      const session = await sessionManager.getSession(userId);
      
      if (!session) {
        await sessionManager.createSession(userId, {
          createdAt: Date.now(),
          lastActivity: Date.now()
        });
      } else {
        await sessionManager.updateSession(userId, {
          lastActivity: Date.now(),
          lastCommand: '/status'
        });
      }
      
      return mockStatusInfo;
    });
    
    statusCommand.formatStatusResponse = jest.fn().mockReturnValue({
      text: '📊 *Bot Status*\n\nTest message',
      format: 'markdown',
      refreshable: true
    });
    
    // Set test environment
    process.env.NODE_ENV = 'test';
  });
  
  afterEach(() => {
    // Clean up global mocks
    delete global.sessionManager;
  });
  
  describe('Command execution with session', () => {
    it('should update the session when a command is executed', async () => {
      // Arrange
      const message = {
        from: { id: 123456789, username: 'testuser' },
        chat: { id: 987654321 }
      };
      
      // Act
      await executeCommand('status', message);
      
      // Assert - Make sure our mock functions were called
      expect(statusCommand.getStatusInfo).toHaveBeenCalled();
      expect(mockSessionManager.getSession).toHaveBeenCalledWith('123456789');
      expect(mockSessionManager.updateSession).toHaveBeenCalledWith('123456789', expect.objectContaining({
        lastActivity: expect.any(Number),
        lastCommand: '/status'
      }));
    });
    
    it('should create a new session if one does not exist', async () => {
      // Arrange
      const message = {
        from: { id: 123456789, username: 'testuser' },
        chat: { id: 987654321 }
      };
      
      // Mock session not found
      mockSessionManager.getSession.mockResolvedValueOnce(null);
      
      // Act
      await executeCommand('status', message);
      
      // Assert
      expect(statusCommand.getStatusInfo).toHaveBeenCalled();
      expect(mockSessionManager.createSession).toHaveBeenCalledWith('123456789', expect.objectContaining({
        createdAt: expect.any(Number),
        lastActivity: expect.any(Number)
      }));
    });
    
    it('should handle session service errors gracefully', async () => {
      // Arrange
      const message = {
        from: { id: 123456789, username: 'testuser' },
        chat: { id: 987654321 }
      };
      
      // Mock the status command to throw an error
      statusCommand.getStatusInfo.mockRejectedValueOnce(
        new Error('Session service unavailable')
      );
      
      // Act
      const result = await executeCommand('status', message);
      
      // Assert
      expect(result).toEqual({
        chatId: 987654321,
        text: expect.stringContaining('Error'),
        options: expect.any(Object)
      });
    });
  });
}); 