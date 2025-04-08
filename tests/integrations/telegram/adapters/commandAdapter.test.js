/**
 * Tests for the Telegram command adapter
 */

const { executeCommand } = require('../../../../src/integrations/telegram/adapters/commandAdapter');
const { SessionManager } = require('../../../../src/services/sessionManager');
const statusCommand = require('../../../../src/commands/statusCommand');
const { AppError } = require('../../../../src/core/shared/errors');

// Mock dependencies
jest.mock('../../../../src/services/sessionManager');
jest.mock('../../../../src/commands/statusCommand');

describe('Telegram Command Adapter', () => {
  let mockSessionManager;
  let mockStatusInfo;
  let mockFormattedResponse;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup mock status info
    mockStatusInfo = {
      runtime: { seconds: 3600, formatted: '1h' },
      session: { id: 'test-session', version: 1, createdAt: 123456789, lastActivity: 987654321 },
      tasks: { active: [], waiting: [], completed: [] },
      system: { useNewSessionManager: true, timestamp: Date.now() }
    };
    
    // Setup mock formatted response
    mockFormattedResponse = {
      text: '📊 *Bot Status*\n\nTest message',
      format: 'markdown',
      refreshable: true
    };
    
    // Mock the status command
    statusCommand.getStatusInfo = jest.fn().mockResolvedValue(mockStatusInfo);
    statusCommand.formatStatusResponse = jest.fn().mockReturnValue(mockFormattedResponse);
    
    // Setup session manager mock
    mockSessionManager = new SessionManager();
    global.sessionManager = mockSessionManager;
    
    // Set a mock startup time
    global.startup = Date.now() - 3600000; // 1 hour ago
    
    // Set test environment flag
    process.env.NODE_ENV = 'test';
  });
  
  afterEach(() => {
    // Clean up global mocks
    delete global.sessionManager;
    delete global.startup;
  });
  
  describe('executeCommand', () => {
    it('should execute the status command', async () => {
      // Arrange
      const message = {
        from: { id: 123456789, username: 'testuser' },
        chat: { id: 987654321 }
      };
      
      // Act
      const result = await executeCommand('status', message);
      
      // Assert
      expect(statusCommand.getStatusInfo).toHaveBeenCalledWith(expect.objectContaining({
        sessionManager: expect.any(Object),
        startupTime: expect.any(Number),
        taskService: expect.any(Object),
        userId: '123456789'
      }));
      
      expect(statusCommand.formatStatusResponse).toHaveBeenCalledWith(
        mockStatusInfo,
        expect.objectContaining({
          isAdmin: expect.any(Boolean),
          format: 'markdown'
        })
      );
      
      expect(result).toEqual({
        chatId: 987654321,
        text: '📊 *Bot Status*\n\nTest message',
        options: {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🔄', callback_data: 'refresh' }]]
          }
        }
      });
    });
    
    it('should handle unknown commands with the proper error response', async () => {
      // Arrange
      const message = {
        from: { id: 123456789 },
        chat: { id: 987654321 }
      };
      
      // Act
      const result = await executeCommand('unknown', message);
      
      // Assert
      expect(result).toEqual({
        chatId: 987654321,
        text: expect.stringContaining('Error'),
        options: { parse_mode: 'Markdown' }
      });
    });
    
    it('should handle errors in command execution and provide user-friendly responses', async () => {
      // Arrange
      const message = {
        from: { id: 123456789 },
        chat: { id: 987654321 }
      };
      
      // Force an error
      const testError = new Error('Test error');
      statusCommand.getStatusInfo.mockRejectedValue(testError);
      
      // Act
      const result = await executeCommand('status', message);
      
      // Assert
      expect(result).toEqual({
        chatId: 987654321,
        text: expect.stringContaining('Error'),
        options: { parse_mode: 'Markdown' }
      });
      
      // Verify it doesn't expose detailed error info to users
      expect(result.text).not.toContain(testError.stack);
    });
  });
}); 