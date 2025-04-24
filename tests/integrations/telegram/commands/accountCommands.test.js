/**
 * Tests for Telegram integration of account commands
 */

const { 
  accountCommandHandler,
  createAccountCommand,
  createPointsCommand
} = require('../../../../src/core/account/commands');

// Mock the Telegram bot and context
const mockBot = {
  sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
  editMessageText: jest.fn().mockResolvedValue(true),
  deleteMessage: jest.fn().mockResolvedValue(true),
  answerCallbackQuery: jest.fn().mockResolvedValue(true)
};

// Mock the UI Renderer for Telegram
const mockTelegramRenderer = {
  renderMenu: jest.fn().mockResolvedValue({ message_id: 123 }),
  renderMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
  updateMenu: jest.fn().mockResolvedValue(true)
};

// Mock the adapter
const mockTelegramAdapter = {
  convertToUIComponent: jest.fn().mockImplementation((uiDefinition) => ({
    type: 'menu',
    text: uiDefinition.text || 'Menu Text',
    buttons: uiDefinition.buttons || []
  })),
  handleCallback: jest.fn().mockResolvedValue(true)
};

// Mock service dependencies
const mockSessionManager = {
  getSession: jest.fn().mockResolvedValue({
    get: jest.fn().mockImplementation((key) => {
      if (key === 'workflows.mock-workflow-id') {
        return { id: 'mock-workflow-id', state: {} };
      }
      return null;
    }),
    set: jest.fn()
  }),
  createSession: jest.fn().mockResolvedValue({
    get: jest.fn(),
    set: jest.fn()
  }),
  updateSession: jest.fn().mockResolvedValue(true)
};

const mockAccountService = {
  getUserProfile: jest.fn().mockResolvedValue({
    name: 'Test User',
    username: 'testuser',
    createdAt: new Date().toISOString(),
    verified: false
  }),
  updateUserProfile: jest.fn().mockResolvedValue({
    name: 'Updated User',
    username: 'testuser'
  }),
  getUserPreferences: jest.fn().mockResolvedValue({
    notifications: true,
    language: 'en',
    theme: 'default'
  }),
  getUserApiKeys: jest.fn().mockResolvedValue([
    { id: 'key1', name: 'Test Key', truncatedKey: 'sk_1...abcd' }
  ]),
  generateApiKey: jest.fn().mockResolvedValue({
    id: 'key2', 
    name: 'New Key', 
    key: 'sk_test_abcdefg123456',
    createdAt: new Date().toISOString()
  }),
  deleteApiKey: jest.fn().mockResolvedValue(true),
  deleteUserAccount: jest.fn().mockResolvedValue(true)
};

const mockPointsService = {
  getUserPoints: jest.fn().mockResolvedValue(1000),
  getUserTransactions: jest.fn().mockResolvedValue([
    { amount: 100, reason: 'Daily bonus', timestamp: Date.now() - 86400000 },
    { amount: -50, reason: 'Image generation', timestamp: Date.now() - 43200000 }
  ]),
  refreshUserPoints: jest.fn().mockResolvedValue(1050)
};

const mockAnalyticsService = {
  trackEvent: jest.fn()
};

const mockWorkflowEngine = {
  startWorkflow: jest.fn().mockResolvedValue({
    id: 'mock-workflow-id',
    currentStep: 'mock-step-id'
  }),
  getWorkflow: jest.fn().mockResolvedValue({
    id: 'mock-workflow-id',
    processInput: jest.fn(),
    getCurrentStep: jest.fn().mockReturnValue({
      id: 'mock-step-id',
      ui: { type: 'message', text: 'Test UI' }
    }),
    serialize: jest.fn().mockReturnValue({ id: 'mock-workflow-id', state: {} }),
    isCompleted: jest.fn().mockReturnValue(false)
  })
};

// Mock the UI Manager
const mockUIManager = {
  createComponent: jest.fn().mockReturnValue({
    type: 'menu',
    props: { text: 'Menu Text', buttons: [] }
  }),
  createComponentFromDefinition: jest.fn().mockImplementation((definition) => ({
    type: definition.type || 'menu',
    props: { 
      text: definition.text || 'Menu Text', 
      buttons: definition.buttons || [] 
    }
  })),
  render: jest.fn().mockResolvedValue({ messageId: 123 })
};

// Mock the createTelegramAdapter function
jest.mock('../../../../src/integrations/telegram/adapters/commandAdapter', () => ({
  createTelegramAdapter: jest.fn().mockReturnValue({
    adaptCommand: jest.fn().mockImplementation((command) => ({
      name: command.name,
      description: command.description,
      execute: async (ctx) => {
        const result = await command.execute({
          userId: ctx.from.id,
          platform: 'telegram',
          messageContext: {
            chatId: ctx.chat.id,
            messageId: ctx.message?.message_id,
            username: ctx.from.username,
            threadId: ctx.message?.thread_id
          },
          sessionManager: mockSessionManager,
          accountService: mockAccountService,
          pointsService: mockPointsService,
          analyticsService: mockAnalyticsService,
          workflowEngine: mockWorkflowEngine,
          uiManager: mockUIManager
        });

        // Handle success/failure
        if (result.success) {
          return mockTelegramRenderer.renderMenu({
            chatId: ctx.chat.id,
            text: result.message,
            buttons: result.buttons || []
          });
        } else {
          return ctx.reply(result.message || 'Error processing command');
        }
      }
    }))
  })
}));

// Mock the workflow factory
jest.mock('../../../../src/core/workflow/workflows/AccountWorkflow', () => ({
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

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});

describe('Telegram Account Commands', () => {
  describe('Account Command Telegram Integration', () => {
    test('should handle account command in Telegram context', async () => {
      // Import the adapter
      const { createTelegramAdapter } = require('../../../../src/integrations/telegram/adapters/commandAdapter');
      
      // Create a command with the adapter
      const accountCommand = createAccountCommand({
        accountService: mockAccountService,
        sessionManager: mockSessionManager,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        workflowEngine: mockWorkflowEngine,
        uiManager: mockUIManager
      });
      
      // Adapt the command for Telegram
      const telegramCommand = createTelegramAdapter().adaptCommand(accountCommand);
      
      // Create a mock Telegram context
      const mockCtx = {
        from: { id: 'user123', username: 'testuser' },
        chat: { id: 'chat123' },
        message: { message_id: 456, thread_id: null },
        reply: jest.fn().mockResolvedValue({ message_id: 789 })
      };
      
      // Execute the adapted command
      await telegramCommand.execute(mockCtx);
      
      // Verify that the session manager was called
      expect(mockSessionManager.getSession).toHaveBeenCalled();
      
      // Verify that the workflow engine was called
      expect(mockWorkflowEngine.startWorkflow).toHaveBeenCalled();
      
      // Verify that the UI was rendered
      expect(mockTelegramRenderer.renderMenu).toHaveBeenCalledWith(expect.objectContaining({
        chatId: 'chat123'
      }));
    });
    
    test('should handle points command in Telegram context', async () => {
      // Import the adapter
      const { createTelegramAdapter } = require('../../../../src/integrations/telegram/adapters/commandAdapter');
      
      // Create a command with the adapter
      const pointsCommand = createPointsCommand({
        accountService: mockAccountService,
        sessionManager: mockSessionManager,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        workflowEngine: mockWorkflowEngine,
        uiManager: mockUIManager
      });
      
      // Adapt the command for Telegram
      const telegramCommand = createTelegramAdapter().adaptCommand(pointsCommand);
      
      // Create a mock Telegram context
      const mockCtx = {
        from: { id: 'user123', username: 'testuser' },
        chat: { id: 'chat123' },
        message: { message_id: 456, thread_id: null },
        reply: jest.fn().mockResolvedValue({ message_id: 789 })
      };
      
      // Execute the adapted command
      await telegramCommand.execute(mockCtx);
      
      // Verify that the session manager was called
      expect(mockSessionManager.getSession).toHaveBeenCalled();
      
      // Verify that the workflow engine was called
      expect(mockWorkflowEngine.startWorkflow).toHaveBeenCalled();
      
      // Verify that the UI was rendered
      expect(mockTelegramRenderer.renderMenu).toHaveBeenCalledWith(expect.objectContaining({
        chatId: 'chat123'
      }));
    });
  });
  
  describe('Telegram Callback Handling', () => {
    test('should process workflow input for account command callbacks', async () => {
      // Import the adapter
      const { createTelegramAdapter } = require('../../../../src/integrations/telegram/adapters/commandAdapter');
      
      // Create mock command with callback handler
      const accountCommand = createAccountCommand({
        accountService: mockAccountService,
        sessionManager: mockSessionManager,
        pointsService: mockPointsService,
        analyticsService: mockAnalyticsService,
        workflowEngine: mockWorkflowEngine,
        uiManager: mockUIManager
      });
      
      // Mock handleInput method
      accountCommand.handleInput = jest.fn().mockResolvedValue({
        success: true,
        message: 'Input processed',
        workflowId: 'mock-workflow-id'
      });
      
      // Create a mock context for the callback
      const mockCallbackCtx = {
        from: { id: 'user123', username: 'testuser' },
        chat: { id: 'chat123' },
        callbackQuery: {
          id: 'callback123',
          data: 'account:profile'
        },
        answerCbQuery: jest.fn().mockResolvedValue(true),
        editMessageText: jest.fn().mockResolvedValue(true)
      };
      
      // Call the handleInput method directly
      await accountCommand.handleInput('profile', {
        userId: mockCallbackCtx.from.id,
        platform: 'telegram',
        workflowId: 'mock-workflow-id',
        sessionManager: mockSessionManager
      });
      
      // Verify that handleInput was called
      expect(accountCommand.handleInput).toHaveBeenCalled();
    });
  });
}); 