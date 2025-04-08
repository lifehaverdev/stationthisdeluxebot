/**
 * Tests for the status command
 */

const { getStatusInfo, formatStatusResponse } = require('../../src/commands/statusCommand');
const { SessionManager } = require('../../src/services/sessionManager');

// Mock dependencies
jest.mock('../../src/services/sessionManager');

describe('Status Command', () => {
  let mockSessionManager;
  let mockSession;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock session
    mockSession = {
      id: 'test-session-123',
      version: 1,
      get: jest.fn((key) => {
        const mockData = {
          'createdAt': Date.now() - 3600000, // 1 hour ago
          'lastActivity': Date.now() - 600000, // 10 minutes ago
          'username': 'testuser'
        };
        return mockData[key];
      })
    };
    
    // Setup session manager mock
    mockSessionManager = new SessionManager();
    mockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
    mockSessionManager.updateSession = jest.fn().mockResolvedValue(mockSession);
    mockSessionManager.createSession = jest.fn().mockResolvedValue(mockSession);
  });
  
  describe('getStatusInfo', () => {
    it('should get status information using SessionManager', async () => {
      // Arrange
      const context = {
        sessionManager: mockSessionManager,
        startupTime: Date.now() - 86400000, // 1 day ago
        taskService: {
          getTasksForUser: jest.fn().mockResolvedValue({
            active: [],
            waiting: [],
            completed: []
          })
        },
        userId: '123456789'
      };
      
      // Act
      const result = await getStatusInfo(context);
      
      // Assert
      expect(mockSessionManager.getSession).toHaveBeenCalledWith('123456789');
      expect(mockSessionManager.updateSession).toHaveBeenCalledWith('123456789', expect.objectContaining({
        lastActivity: expect.any(Number),
        lastCommand: '/status'
      }));
      
      expect(result).toEqual(expect.objectContaining({
        runtime: expect.objectContaining({
          seconds: expect.any(Number),
          formatted: expect.any(String)
        }),
        session: expect.objectContaining({
          id: 'test-session-123',
          version: 1
        }),
        tasks: expect.objectContaining({
          active: expect.any(Array),
          waiting: expect.any(Array),
          completed: expect.any(Array)
        }),
        system: expect.objectContaining({
          useNewSessionManager: true,
          timestamp: expect.any(Number)
        })
      }));
    });
    
    it('should create a new session if one does not exist', async () => {
      // Arrange
      mockSessionManager.getSession = jest.fn().mockResolvedValue(null);
      
      const context = {
        sessionManager: mockSessionManager,
        startupTime: Date.now() - 86400000, // 1 day ago
        userId: '123456789'
      };
      
      // Act
      await getStatusInfo(context);
      
      // Assert
      expect(mockSessionManager.getSession).toHaveBeenCalledWith('123456789');
      expect(mockSessionManager.createSession).toHaveBeenCalledWith('123456789', expect.objectContaining({
        createdAt: expect.any(Number),
        lastActivity: expect.any(Number)
      }));
    });
    
    it('should throw an error if sessionManager is not provided', async () => {
      // Arrange
      const context = {
        startupTime: Date.now(),
        userId: '123456789'
      };
      
      // Act & Assert
      await expect(getStatusInfo(context)).rejects.toThrow('SessionManager is required');
    });
  });
  
  describe('formatStatusResponse', () => {
    it('should format status information for regular users', () => {
      // Arrange
      const statusInfo = {
        runtime: {
          seconds: 86400,
          formatted: '1d'
        },
        session: {
          id: 'test-session-123',
          createdAt: Date.now() - 3600000,
          lastActivity: Date.now() - 600000,
          version: 1
        },
        tasks: {
          active: [],
          waiting: [],
          completed: []
        },
        system: {
          useNewSessionManager: true,
          timestamp: Date.now()
        }
      };
      
      // Act
      const result = formatStatusResponse(statusInfo);
      
      // Assert
      expect(result.text).toContain('Bot Status');
      expect(result.text).toContain('1d');
      expect(result.text).toContain('Session Information');
      
      // Should not contain admin information
      expect(result.text).not.toContain('System Information');
      expect(result.format).toBe('markdown');
      expect(result.refreshable).toBe(true);
    });
    
    it('should include system information for admins', () => {
      // Arrange
      const statusInfo = {
        runtime: {
          seconds: 86400,
          formatted: '1d'
        },
        session: {
          id: 'test-session-123',
          createdAt: Date.now() - 3600000,
          lastActivity: Date.now() - 600000,
          version: 1
        },
        tasks: {
          active: [],
          waiting: [],
          completed: []
        },
        system: {
          useNewSessionManager: true,
          timestamp: Date.now()
        }
      };
      
      // Act
      const result = formatStatusResponse(statusInfo, { isAdmin: true });
      
      // Assert
      expect(result.text).toContain('System Information');
      expect(result.text).toContain('Using new SessionManager: Yes');
    });
    
    it('should format task information when available', () => {
      // Arrange
      const statusInfo = {
        runtime: {
          seconds: 86400,
          formatted: '1d'
        },
        session: {
          id: 'test-session-123',
          createdAt: Date.now() - 3600000,
          lastActivity: Date.now() - 600000,
          version: 1
        },
        tasks: {
          active: [{ type: 'TEST_TASK', status: 'running' }],
          waiting: [{ type: 'WAITING_TASK', status: 'pending' }],
          completed: []
        },
        system: {
          useNewSessionManager: true,
          timestamp: Date.now()
        }
      };
      
      // Act
      const result = formatStatusResponse(statusInfo);
      
      // Assert
      expect(result.text).toContain('Active Tasks');
      expect(result.text).toContain('TEST_TASK');
      expect(result.text).toContain('Waiting Tasks');
      expect(result.text).toContain('WAITING_TASK: pending');
    });
  });
}); 