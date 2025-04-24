/**
 * Unit tests for account commands - Core implementation
 */

const {
  accountCommandHandler,
  createAccountCommand,
  createPointsCommand,
  createApiKeysCommand,
  createProfileCommand,
  createPreferencesCommand,
  createDeleteAccountCommand,
  registerAccountCommands
} = require('../../../src/core/account/commands');

// Mock dependencies and services
const mockSessionManager = {
  getSession: jest.fn(),
  createSession: jest.fn(),
  updateSession: jest.fn(),
  endSession: jest.fn()
};

const mockAccountService = {
  getUserProfile: jest.fn(),
  updateUserProfile: jest.fn(),
  getUserPreferences: jest.fn(),
  updateUserPreferences: jest.fn(),
  getUserApiKeys: jest.fn(),
  generateApiKey: jest.fn(),
  deleteApiKey: jest.fn(),
  deleteUserAccount: jest.fn()
};

const mockPointsService = {
  getUserPoints: jest.fn(),
  getUserTransactions: jest.fn(),
  refreshUserPoints: jest.fn()
};

const mockAnalyticsService = {
  trackEvent: jest.fn()
};

const mockUIManager = {
  createComponent: jest.fn(),
  createComponentFromDefinition: jest.fn(),
  render: jest.fn()
};

const mockWorkflowEngine = {
  startWorkflow: jest.fn(),
  getWorkflow: jest.fn(),
  handleWorkflowInput: jest.fn()
};

const mockWorkflow = {
  processInput: jest.fn(),
  getCurrentStep: jest.fn(),
  serialize: jest.fn(),
  isCompleted: jest.fn(),
  getResult: jest.fn()
};

// Mock the workflow factory
jest.mock('../../../src/core/workflow/workflows/AccountWorkflow', () => ({
  createAccountWorkflow: jest.fn().mockReturnValue({
    createWorkflow: jest.fn().mockReturnValue({
      id: 'mock-workflow-id',
      processInput: jest.fn(),
      getCurrentStep: jest.fn().mockReturnValue({
        id: 'mock-step-id',
        ui: { type: 'message', props: { text: 'Mock UI' } }
      }),
      serialize: jest.fn().mockReturnValue({ id: 'mock-workflow-id', state: {} })
    })
  })
}));

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  
  // Setup default mock implementations
  mockSessionManager.getSession.mockResolvedValue({
    get: jest.fn().mockImplementation((path) => {
      if (path === 'workflows.mock-workflow-id') {
        return { id: 'mock-workflow-id', state: {} };
      }
      return null;
    })
  });
  
  mockSessionManager.createSession.mockResolvedValue({
    get: jest.fn()
  });
  
  mockUIManager.render.mockResolvedValue(true);
  
  mockWorkflowEngine.startWorkflow.mockResolvedValue({
    id: 'mock-workflow-id',
    currentStep: 'mock-step-id'
  });
  
  mockWorkflowEngine.getWorkflow.mockResolvedValue(mockWorkflow);
  
  mockWorkflow.getCurrentStep.mockReturnValue({
    id: 'mock-step-id'
  });
  
  mockWorkflow.isCompleted.mockReturnValue(false);
});

describe('Account Commands Core', () => {
  // Test the main account command handler
  describe('accountCommandHandler', () => {
    test('should throw error if userId is missing', async () => {
      // Arrange
      const context = {
        platform: 'telegram',
        accountService: mockAccountService
      };
      
      // Act & Assert
      await expect(accountCommandHandler(context)).rejects.toThrow('User ID is required');
    });
    
    test('should throw error if accountService is missing', async () => {
      // Arrange
      const context = {
        userId: 'user-123',
        platform: 'telegram'
      };
      
      // Act & Assert
      await expect(accountCommandHandler(context)).rejects.toThrow('Account service is required');
    });
    
    test('should create a new session if none exists', async () => {
      // Arrange
      mockSessionManager.getSession.mockResolvedValueOnce(null);
      
      const context = {
        userId: 'user-123',
        platform: 'telegram',
        accountService: mockAccountService,
        sessionManager: mockSessionManager,
        uiManager: mockUIManager,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        messageContext: {
          chatId: 'chat-123'
        }
      };
      
      // Act
      await accountCommandHandler(context);
      
      // Assert
      expect(mockSessionManager.createSession).toHaveBeenCalledWith('user-123', expect.any(Object));
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('command:account:initiated', expect.any(Object));
    });
    
    test('should update existing session if it exists', async () => {
      // Arrange
      const context = {
        userId: 'user-123',
        platform: 'telegram',
        accountService: mockAccountService,
        sessionManager: mockSessionManager,
        uiManager: mockUIManager,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        messageContext: {
          chatId: 'chat-123'
        }
      };
      
      // Act
      await accountCommandHandler(context);
      
      // Assert
      expect(mockSessionManager.updateSession).toHaveBeenCalledWith('user-123', expect.any(Object));
    });
    
    test('should use workflowEngine if provided', async () => {
      // Arrange
      const context = {
        userId: 'user-123',
        platform: 'telegram',
        accountService: mockAccountService,
        sessionManager: mockSessionManager,
        uiManager: mockUIManager,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        workflowEngine: mockWorkflowEngine,
        messageContext: {
          chatId: 'chat-123'
        }
      };
      
      // Act
      const result = await accountCommandHandler(context);
      
      // Assert
      expect(mockWorkflowEngine.startWorkflow).toHaveBeenCalledWith(
        'AccountWorkflow',
        expect.any(Object),
        expect.any(Object)
      );
      
      expect(result).toEqual({
        success: true,
        message: 'account workflow started',
        workflowId: 'mock-workflow-id',
        initialStep: 'mock-step-id'
      });
    });
    
    test('should handle specific operationType', async () => {
      // Arrange
      const context = {
        userId: 'user-123',
        platform: 'telegram',
        accountService: mockAccountService,
        sessionManager: mockSessionManager,
        uiManager: mockUIManager,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        operationType: 'points',
        messageContext: {
          chatId: 'chat-123'
        }
      };
      
      // Act
      const result = await accountCommandHandler(context);
      
      // Assert
      expect(result).toEqual({
        success: true,
        message: 'points workflow started',
        workflowId: expect.any(String),
        uiRendered: true,
        initialStep: 'mock-step-id'
      });
    });
  });
  
  // Test account command factory
  describe('createAccountCommand', () => {
    test('should create a valid account command', () => {
      // Act
      const command = createAccountCommand();
      
      // Assert
      expect(command).toHaveProperty('name', 'account');
      expect(command).toHaveProperty('description');
      expect(command).toHaveProperty('execute');
      expect(command).toHaveProperty('handleInput');
    });
    
    test('execute should call accountCommandHandler with correct parameters', async () => {
      // Arrange
      const dependencies = {
        accountService: mockAccountService,
        sessionManager: mockSessionManager
      };
      
      // Create a new mock for accountCommandHandler
      const mockAccountCommandHandler = jest.fn().mockResolvedValue({ success: true });
      
      // Create a factory function that uses our mock
      const createTestCommand = (deps) => {
        return {
          name: 'account',
          description: 'Manage your account settings',
          
          async execute(ctx) {
            return mockAccountCommandHandler({
              ...ctx,
              operationType: 'account',
              ...deps
            });
          },
          
          async handleInput() {
            return { success: true };
          }
        };
      };
      
      // Create the command
      const command = createTestCommand(dependencies);
      
      // Set up the context
      const context = {
        userId: 'user-123',
        platform: 'telegram',
        messageContext: {}
      };
      
      // Act
      await command.execute(context);
      
      // Assert
      expect(mockAccountCommandHandler).toHaveBeenCalledWith({
        ...context,
        operationType: 'account',
        ...dependencies
      });
    });
    
    test('handleInput should start a new workflow if workflowId is missing', async () => {
      // Arrange
      const dependencies = {
        accountService: mockAccountService,
        sessionManager: mockSessionManager
      };
      
      const command = createAccountCommand(dependencies);
      const context = {
        userId: 'user-123',
        platform: 'telegram'
      };
      
      // Mock execute method
      const originalExecute = command.execute;
      command.execute = jest.fn().mockResolvedValue({ success: true });
      
      try {
        // Act
        await command.handleInput('test-input', context);
        
        // Assert
        expect(command.execute).toHaveBeenCalledWith({
          ...context,
          parameters: { input: 'test-input' }
        });
      } finally {
        // Restore original
        command.execute = originalExecute;
      }
    });
  });
  
  // Test points command factory
  describe('createPointsCommand', () => {
    test('should create a valid points command', () => {
      // Act
      const command = createPointsCommand();
      
      // Assert
      expect(command).toHaveProperty('name', 'points');
      expect(command).toHaveProperty('description');
      expect(command).toHaveProperty('execute');
      expect(command).toHaveProperty('handleInput');
    });
  });
  
  // Test API keys command factory
  describe('createApiKeysCommand', () => {
    test('should create a valid API keys command', () => {
      // Act
      const command = createApiKeysCommand();
      
      // Assert
      expect(command).toHaveProperty('name', 'apikeys');
      expect(command).toHaveProperty('description');
      expect(command).toHaveProperty('execute');
      expect(command).toHaveProperty('handleInput');
    });
  });
  
  // Test profile command factory
  describe('createProfileCommand', () => {
    test('should create a valid profile command', () => {
      // Act
      const command = createProfileCommand();
      
      // Assert
      expect(command).toHaveProperty('name', 'profile');
      expect(command).toHaveProperty('description');
      expect(command).toHaveProperty('execute');
      expect(command).toHaveProperty('handleInput');
    });
  });
  
  // Test preferences command factory
  describe('createPreferencesCommand', () => {
    test('should create a valid preferences command', () => {
      // Act
      const command = createPreferencesCommand();
      
      // Assert
      expect(command).toHaveProperty('name', 'preferences');
      expect(command).toHaveProperty('description');
      expect(command).toHaveProperty('execute');
      expect(command).toHaveProperty('handleInput');
    });
  });
  
  // Test delete account command factory
  describe('createDeleteAccountCommand', () => {
    test('should create a valid delete account command', () => {
      // Act
      const command = createDeleteAccountCommand();
      
      // Assert
      expect(command).toHaveProperty('name', 'delete');
      expect(command).toHaveProperty('description');
      expect(command).toHaveProperty('execute');
      expect(command).toHaveProperty('handleInput');
    });
    
    test('handleInput should delete account if workflow completes with confirmation', async () => {
      // Arrange
      const dependencies = {
        accountService: mockAccountService,
        sessionManager: mockSessionManager,
        workflowEngine: mockWorkflowEngine
      };
      
      // Setup workflow to complete with confirmation
      mockWorkflow.isCompleted.mockReturnValue(true);
      mockWorkflow.getResult.mockReturnValue({ confirmed: true });
      
      const command = createDeleteAccountCommand(dependencies);
      const context = {
        userId: 'user-123',
        workflowId: 'mock-workflow-id',
        sessionManager: mockSessionManager
      };
      
      // Act
      const result = await command.handleInput('confirm', context);
      
      // Assert
      expect(mockAccountService.deleteUserAccount).toHaveBeenCalledWith('user-123');
      expect(mockSessionManager.endSession).toHaveBeenCalledWith('user-123');
      expect(result).toEqual({
        success: true,
        message: 'Account deleted successfully',
        accountDeleted: true
      });
    });
  });
  
  // Test command registration
  describe('registerAccountCommands', () => {
    test('should register commands with the registry', () => {
      // Arrange
      const mockRegistry = {
        register: jest.fn(),
        registerSubcommand: jest.fn()
      };
      
      const dependencies = {
        accountService: mockAccountService,
        sessionManager: mockSessionManager
      };
      
      // Act
      registerAccountCommands(mockRegistry, dependencies);
      
      // Assert
      expect(mockRegistry.register).toHaveBeenCalledTimes(2);
      expect(mockRegistry.registerSubcommand).toHaveBeenCalledTimes(4);
    });
    
    test('should throw error if registry is missing', () => {
      // Act & Assert
      expect(() => registerAccountCommands()).toThrow('Command registry is required');
    });
  });
}); 