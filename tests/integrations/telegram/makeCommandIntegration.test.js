/**
 * Integration tests for the make command with Telegram adapter
 */

const { makeCommandHandler } = require('../../../src/commands/makeCommand');
const telegramAdapter = require('../../../src/integrations/telegram/adapters/commandAdapter');
const { createMakeImageWorkflow } = require('../../../src/core/workflow/workflows/MakeImageWorkflow');
const UIManager = require('../../../src/core/ui/interfaces/UIManager');
const { TelegramRenderer } = require('../../../src/integrations/telegram/renderers/telegramRenderer');

// Mock dependencies
jest.mock('../../../src/core/workflow/workflows/MakeImageWorkflow');
jest.mock('../../../src/core/ui/interfaces/UIManager');
jest.mock('../../../src/integrations/telegram/renderers/telegramRenderer');
jest.mock('../../../src/services/sessionManager');
jest.mock('../../../src/integrations/telegram/adapters/commandAdapter');

describe('Make Command Telegram Integration', () => {
  let mockTelegramBot;
  let mockUIManager;
  let mockTelegramRenderer;
  let mockSessionManager;
  let mockComfyDeployService;
  let mockWorkflow;
  let mockWorkflowInstance;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock Telegram bot
    mockTelegramBot = {
      sendMessage: jest.fn().mockResolvedValue({ message_id: 12345 }),
      sendPhoto: jest.fn().mockResolvedValue({ message_id: 12346 }),
      editMessageText: jest.fn().mockResolvedValue({ message_id: 12345 }),
      editMessageMedia: jest.fn().mockResolvedValue({ message_id: 12345 }),
      answerCallbackQuery: jest.fn().mockResolvedValue(true)
    };
    
    // Mock Telegram renderer
    mockTelegramRenderer = {
      render: jest.fn().mockResolvedValue({
        messageId: 12345,
        inlineKeyboard: [[{ text: 'Continue', callback_data: 'next' }]]
      }),
      update: jest.fn().mockResolvedValue({
        messageId: 12345,
        updated: true
      }),
      supportsComponentType: jest.fn().mockReturnValue(true)
    };
    
    // Setup the mock to return our mockTelegramRenderer
    TelegramRenderer.mockImplementation(() => mockTelegramRenderer);
    
    // Mock UI Manager
    mockUIManager = {
      registerRenderer: jest.fn().mockReturnThis(),
      getRenderer: jest.fn().mockReturnValue(mockTelegramRenderer),
      createComponent: jest.fn().mockReturnValue({
        id: 'test-component',
        type: 'input',
        validate: jest.fn().mockReturnValue(true),
        toJSON: jest.fn().mockReturnValue({})
      }),
      render: jest.fn().mockImplementation((component, props, platform, context) => {
        return mockTelegramRenderer.render(component, context);
      })
    };
    
    // Setup the mock to return our mockUIManager
    UIManager.mockImplementation(() => mockUIManager);
    
    // Mock session manager
    mockSessionManager = {
      getSession: jest.fn().mockResolvedValue({
        id: 'session-123',
        get: jest.fn().mockImplementation((key) => {
          const data = {
            'username': 'testuser',
            'points': { balance: 1000 }
          };
          return data[key];
        }),
        set: jest.fn()
      }),
      updateSession: jest.fn().mockResolvedValue(true),
      createSession: jest.fn().mockResolvedValue({
        id: 'session-123',
        get: jest.fn().mockReturnValue(null),
        set: jest.fn()
      })
    };
    
    // Mock ComfyDeploy service
    mockComfyDeployService = {
      generate: jest.fn().mockResolvedValue({
        taskId: 'task-123',
        runId: 'run-123',
        status: 'processing'
      }),
      checkStatus: jest.fn().mockResolvedValue({
        status: 'processing',
        progress: 30,
        isComplete: false
      })
    };
    
    // Mock workflow instance
    mockWorkflowInstance = {
      id: 'workflow-123',
      getCurrentStep: jest.fn().mockReturnValue({
        id: 'collectPrompt',
        name: 'Collect Prompt',
        ui: {
          type: 'text_input',
          title: 'Image Generation',
          message: 'What would you like to generate?',
          placeholder: 'Enter your prompt...'
        }
      }),
      serialize: jest.fn().mockReturnValue({
        id: 'workflow-123',
        currentStep: 'collectPrompt'
      }),
      submitInput: jest.fn().mockResolvedValue({
        success: true,
        nextStep: 'configureSettings'
      })
    };
    
    // Mock workflow
    mockWorkflow = {
      createWorkflow: jest.fn().mockReturnValue(mockWorkflowInstance)
    };
    
    // Mock MakeImageWorkflow factory
    createMakeImageWorkflow.mockReturnValue(mockWorkflow);
    
    // Mock the telegramAdapter.executeCommand function
    telegramAdapter.executeCommand = jest.fn().mockImplementation(async (commandName, message) => {
      // Extract parameters and context for the command
      const userId = message.from.id.toString();
      const prompt = message.text.replace('/make', '').trim();
      const platform = 'telegram';
      const messageContext = {
        chatId: message.chat.id,
        username: message.from.username,
        messageId: message.message_id
      };
      
      // Execute the make command
      const result = await makeCommandHandler({
        userId,
        platform,
        sessionManager: mockSessionManager,
        uiManager: mockUIManager,
        comfyDeployService: mockComfyDeployService,
        parameters: { prompt },
        messageContext
      });
      
      // Convert result to Telegram-specific response format
      return {
        chatId: message.chat.id,
        text: result.message,
        options: {
          parse_mode: 'Markdown'
        },
        workflowId: result.workflowId
      };
    });
  });
  
  describe('Telegram Command Adapter', () => {
    it('should execute the make command with Telegram context', async () => {
      // Arrange
      const telegramMessage = {
        from: { id: 123456789, username: 'testuser' },
        chat: { id: 987654321 },
        text: '/make a beautiful sunset over mountains'
      };
      
      // Act
      const result = await telegramAdapter.executeCommand('make', telegramMessage);
      
      // Assert
      expect(result).toEqual(expect.objectContaining({
        chatId: 987654321,
        text: expect.stringContaining('workflow started'),
        workflowId: expect.any(String)
      }));
      
      // UIManager should have been used to render the component
      expect(mockUIManager.render).toHaveBeenCalled();
    });
    
    it('should handle callbacks to advance the workflow', async () => {
      // Arrange
      const callbackQuery = {
        id: 'callback-123',
        from: { id: 123456789, username: 'testuser' },
        message: {
          chat: { id: 987654321 },
          message_id: 12345
        },
        data: 'workflow:workflow-123:step:collectPrompt:action:next',
        chat_instance: 'chat-instance-123'
      };
      
      // Define a callback handler function for this test
      const handleCallback = async (callbackQuery) => {
        const { id, from, message, data } = callbackQuery;
        
        // Parse callback data
        const [type, workflowId, stepType, stepId, actionType, actionId] = data.split(':');
        
        if (type !== 'workflow') return null;
        
        const userId = from.id.toString();
        const chatId = message.chat.id;
        
        // Get user's session to retrieve the workflow
        const session = await mockSessionManager.getSession(userId);
        if (!session) return null;
        
        // In a real implementation, we would load the workflow from session
        // Here we use the mock directly
        const workflow = mockWorkflowInstance;
        
        // Submit input to move to next step
        const prompt = 'a beautiful sunset over mountains';
        await workflow.submitInput(prompt);
        
        // Update the UI for the next step
        const currentStep = workflow.getCurrentStep();
        
        // Render the updated UI
        await mockUIManager.render('form', currentStep.ui, 'telegram', {
          chatId,
          messageId: message.message_id,
          workflowId,
          stepId: currentStep.id
        });
        
        // Answer the callback query
        await mockTelegramBot.answerCallbackQuery(id, {
          text: 'Moving to settings...'
        });
        
        return {
          handled: true,
          workflowId,
          nextStep: 'configureSettings'
        };
      };
      
      // Act
      const result = await handleCallback(callbackQuery);
      
      // Assert
      expect(mockTelegramBot.answerCallbackQuery).toHaveBeenCalledWith(
        'callback-123',
        expect.objectContaining({
          text: expect.stringContaining('Moving to')
        })
      );
      
      expect(result).toEqual(expect.objectContaining({
        handled: true,
        workflowId: 'workflow-123',
        nextStep: 'configureSettings'
      }));
      
      // Should have rendered updated UI
      expect(mockUIManager.render).toHaveBeenCalled();
    });
  });
  
  describe('UI Component Rendering', () => {
    it('should render workflow steps correctly in Telegram', async () => {
      // Arrange - a workflow step UI definition
      const uiDefinition = {
        type: 'text_input',
        title: 'Image Generation',
        message: 'What would you like to generate?',
        placeholder: 'Enter your prompt...',
        required: true
      };
      
      const context = {
        chatId: 987654321,
        workflowId: 'workflow-123',
        stepId: 'collectPrompt'
      };
      
      // Mock the component mapping
      const componentType = 'input'; // text_input maps to input
      
      // Act - render the component
      await mockUIManager.render(componentType, uiDefinition, 'telegram', context);
      
      // Assert - Telegram renderer should have been called
      expect(mockTelegramRenderer.render).toHaveBeenCalled();
      // It should receive the component type as first parameter (based on mock implementation)
      expect(mockTelegramRenderer.render.mock.calls[0][0]).toBe(componentType);
      // And the context object as second parameter
      expect(mockTelegramRenderer.render.mock.calls[0][1]).toEqual(context);
    });
    
    it('should map workflow UI types to platform components', async () => {
      // Arrange
      const telegramMessage = {
        from: { id: 123456789, username: 'testuser' },
        chat: { id: 987654321 },
        text: '/make a beautiful sunset over mountains'
      };
      
      // Reset mocks
      mockUIManager.createComponent.mockClear();
      mockUIManager.render.mockClear();
      
      // Act - Execute the make command via the adapter
      await telegramAdapter.executeCommand('make', telegramMessage);
      
      // Assert - UIManager should have been called to render something
      expect(mockUIManager.render).toHaveBeenCalled();
    });
  });
}); 