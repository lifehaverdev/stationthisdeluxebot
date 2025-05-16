/**
 * Unit Tests for Account Commands
 * 
 * Tests the functionality of the account commands in isolation
 * with mocked dependencies.
 */

const {
  createPointsCommand,
  createAccountCommand,
  registerAccountCommands
} = require('../../src/commands/accountCommands');

// Mock workflow module
jest.mock('../../src/core/workflow/workflows/AccountWorkflow', () => {
  return {
    createAccountPointsWorkflow: jest.fn(() => ({
      createWorkflow: jest.fn(() => ({
        id: 'mock-workflow-123',
        getCurrentStep: jest.fn(() => ({ 
          id: 'view_points',
          ui: { type: 'loading', message: 'Fetching your points balance...' }
        })),
        processInput: jest.fn().mockResolvedValue({
          success: true,
          nextStep: 'points_options'
        }),
        serialize: jest.fn(() => ({ id: 'mock-workflow-123', currentStep: 'view_points' })),
        getCurrentStepId: jest.fn(() => 'view_points'),
        deserialize: jest.fn(() => ({
          id: 'mock-workflow-123',
          getCurrentStep: jest.fn(() => ({ id: 'points_options' })),
          getCurrentStepId: jest.fn(() => 'points_options'),
          processInput: jest.fn().mockResolvedValue({ nextStep: 'points_history' }),
          serialize: jest.fn(() => ({ id: 'mock-workflow-123', currentStep: 'points_history' }))
        }))
      }))
    })),
    createAccountSettingsWorkflow: jest.fn(() => ({
      createWorkflow: jest.fn(() => ({
        id: 'mock-workflow-123',
        getCurrentStep: jest.fn(() => ({ 
          id: 'settings_menu',
          ui: { type: 'options', message: 'Account Settings' }
        })),
        processInput: jest.fn().mockResolvedValue({
          success: true,
          nextStep: 'edit_profile'
        }),
        serialize: jest.fn(() => ({ id: 'mock-workflow-123', currentStep: 'settings_menu' })),
        getCurrentStepId: jest.fn(() => 'settings_menu'),
        deserialize: jest.fn(() => ({
          id: 'mock-workflow-123',
          getCurrentStep: jest.fn(() => ({ id: 'edit_profile' })),
          getCurrentStepId: jest.fn(() => 'edit_profile'),
          processInput: jest.fn().mockResolvedValue({ nextStep: 'profile_options' }),
          serialize: jest.fn(() => ({ id: 'mock-workflow-123', currentStep: 'profile_options' }))
        }))
      }))
    }))
  };
});

// Mock UUID
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-1234')
}));

describe('Account Commands Tests', () => {
  // Common mocks for all tests
  let mockPointsService;
  let mockUserService;
  let mockSessionManager;
  let mockUIManager;
  let mockAnalyticsService;
  let mockSession;
  let mockRegistry;
  
  // Setup common mocks before each test
  beforeEach(() => {
    // Create mocks
    mockPointsService = {
      getPointsBalance: jest.fn().mockResolvedValue({
        total: 100,
        breakdown: {
          points: 50,
          qoints: 50
        }
      }),
      getRecentTransactions: jest.fn().mockResolvedValue([
        { id: 'txn-1', amount: 10, type: 'debit', timestamp: Date.now() - 1000 },
        { id: 'txn-2', amount: 20, type: 'credit', timestamp: Date.now() - 2000 }
      ])
    };
    
    mockUserService = {
      getUserProfile: jest.fn().mockResolvedValue({
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
        settings: {
          language: 'en',
          notifications: true
        }
      }),
      updateUserProfile: jest.fn().mockResolvedValue(true),
      getUserApiKeys: jest.fn().mockResolvedValue([
        { id: 'key-1', name: 'Test Key', created: Date.now() - 1000 }
      ]),
      createApiKey: jest.fn().mockResolvedValue({
        id: 'key-new',
        name: 'New Key',
        key: 'ak_123456789',
        created: Date.now()
      }),
      deleteUserAccount: jest.fn().mockResolvedValue(true)
    };
    
    mockSession = {
      get: jest.fn((key) => {
        if (key === 'points.balance') return 100;
        if (key === 'username') return 'testuser';
        if (key === 'locale') return 'en';
        if (key === 'workflows.mock-workflow-123') return { id: 'mock-workflow-123', currentStep: 'view_points' };
        return null;
      }),
      set: jest.fn()
    };
    
    mockSessionManager = {
      getSession: jest.fn().mockResolvedValue(mockSession),
      createSession: jest.fn().mockResolvedValue(mockSession),
      updateSession: jest.fn().mockResolvedValue(true)
    };
    
    mockUIManager = {
      createComponent: jest.fn().mockReturnValue({ type: 'loading', props: {} }),
      render: jest.fn().mockResolvedValue({ messageId: 'msg-123' })
    };
    
    mockAnalyticsService = {
      trackEvent: jest.fn()
    };
    
    mockRegistry = {
      register: jest.fn()
    };
  });
  
  describe('Command Creation Tests', () => {
    test('should create points command with correct metadata', () => {
      const command = createPointsCommand({});
      
      expect(command.name).toBe('points');
      expect(command.description).toBe('Check your current point balance');
      expect(command.category).toBe('account');
      expect(command.aliases).toContain('balance');
      expect(typeof command.execute).toBe('function');
      expect(typeof command.handleInput).toBe('function');
    });
    
    test('should create account command with correct metadata', () => {
      const command = createAccountCommand({});
      
      expect(command.name).toBe('account');
      expect(command.description).toBe('Manage your account settings');
      expect(command.category).toBe('account');
      expect(command.aliases).toContain('profile');
      expect(typeof command.execute).toBe('function');
      expect(typeof command.handleInput).toBe('function');
    });
  });
  
  describe('Command Registration Tests', () => {
    test('should register all account commands with registry', () => {
      registerAccountCommands(mockRegistry, {});
      
      // Should register 2 commands
      expect(mockRegistry.register).toHaveBeenCalledTimes(2);
    });
    
    test('should throw error if registry is not provided', () => {
      expect(() => registerAccountCommands(null, {})).toThrow('Command registry is required');
    });
  });
  
  describe('Points Command Tests', () => {
    test('should start points workflow successfully', async () => {
      // Create command
      const command = createPointsCommand({
        pointsService: mockPointsService,
        sessionManager: mockSessionManager,
        uiManager: mockUIManager,
        analyticsService: mockAnalyticsService
      });
      
      // Execute command
      const result = await command.execute({
        userId: 'user-123',
        platform: 'telegram',
        messageContext: {
          chatId: 'chat-123',
          username: 'testuser'
        }
      });
      
      // Check result
      expect(result.success).toBe(true);
      expect(result.workflowId).toBe('mock-workflow-123');
      
      // Verify session was updated
      expect(mockSessionManager.updateSession).toHaveBeenCalled();
      
      // Verify analytics were tracked
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('command:account:initiated', expect.any(Object));
    });
    
    test('should handle missing userId error', async () => {
      // Create command
      const command = createPointsCommand({
        pointsService: mockPointsService,
        sessionManager: mockSessionManager,
        uiManager: mockUIManager,
        analyticsService: mockAnalyticsService
      });
      
      // Execute command with missing userId
      await expect(command.execute({
        platform: 'telegram',
        messageContext: {}
      })).rejects.toThrow('User ID is required');
    });
    
    test('should handle missing points service error', async () => {
      // Create command without points service
      const command = createPointsCommand({
        sessionManager: mockSessionManager,
        uiManager: mockUIManager,
        analyticsService: mockAnalyticsService
      });
      
      // Execute command
      await expect(command.execute({
        userId: 'user-123',
        platform: 'telegram',
        messageContext: {}
      })).rejects.toThrow('Points service is required');
    });
    
    test('should process input to points workflow', async () => {
      // Create command
      const command = createPointsCommand({
        pointsService: mockPointsService,
        sessionManager: mockSessionManager,
        analyticsService: mockAnalyticsService
      });
      
      // Process input
      const result = await command.handleInput('refresh', {
        userId: 'user-123',
        workflowId: 'mock-workflow-123',
        sessionManager: mockSessionManager
      });
      
      // Check result
      expect(result.success).toBe(true);
      expect(result.stepId).toBe('points_options');
      
      // Verify session was updated
      expect(mockSessionManager.updateSession).toHaveBeenCalled();
    });
  });
  
  describe('Account Command Tests', () => {
    test('should start account workflow successfully', async () => {
      // Create command
      const command = createAccountCommand({
        userService: mockUserService,
        sessionManager: mockSessionManager,
        uiManager: mockUIManager,
        analyticsService: mockAnalyticsService
      });
      
      // Execute command
      const result = await command.execute({
        userId: 'user-123',
        platform: 'telegram',
        messageContext: {
          chatId: 'chat-123',
          username: 'testuser'
        }
      });
      
      // Check result
      expect(result.success).toBe(true);
      expect(result.workflowId).toBe('mock-workflow-123');
      
      // Verify session was updated
      expect(mockSessionManager.updateSession).toHaveBeenCalled();
      
      // Verify analytics were tracked
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('command:account:initiated', expect.any(Object));
    });
    
    test('should handle missing user service error', async () => {
      // Create command without user service
      const command = createAccountCommand({
        sessionManager: mockSessionManager,
        uiManager: mockUIManager,
        analyticsService: mockAnalyticsService
      });
      
      // Execute command
      await expect(command.execute({
        userId: 'user-123',
        platform: 'telegram',
        messageContext: {}
      })).rejects.toThrow('User service is required');
    });
    
    test('should process input to account workflow', async () => {
      // Create command
      const command = createAccountCommand({
        userService: mockUserService,
        sessionManager: mockSessionManager,
        analyticsService: mockAnalyticsService
      });
      
      // Process input
      const result = await command.handleInput('profile', {
        userId: 'user-123',
        workflowId: 'mock-workflow-123',
        sessionManager: mockSessionManager
      });
      
      // Check result
      expect(result.success).toBe(true);
      expect(result.stepId).toBe('edit_profile');
      
      // Verify session was updated
      expect(mockSessionManager.updateSession).toHaveBeenCalled();
    });
    
    test('should handle missing session in handleInput', async () => {
      // Create command
      const command = createAccountCommand({
        userService: mockUserService,
        sessionManager: mockSessionManager
      });
      
      // Mock session not found
      mockSessionManager.getSession.mockResolvedValueOnce(null);
      
      // Process input
      const result = await command.handleInput('profile', {
        userId: 'user-123',
        workflowId: 'mock-workflow-123',
        sessionManager: mockSessionManager
      });
      
      // Check result
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('SESSION_NOT_FOUND');
    });
  });
}); 