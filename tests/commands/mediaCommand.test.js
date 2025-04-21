/**
 * Unit Tests for Media Commands
 * 
 * Tests the functionality of the media commands in isolation
 * with mocked dependencies.
 */

const {
  createImageToImageCommand,
  createRemoveBackgroundCommand,
  createUpscaleCommand,
  createAnalyzeImageCommand,
  createAnimateCommand,
  createVideoCommand,
  registerMediaCommands,
  processMediaWebhook
} = require('../../src/commands/mediaCommand');

// Mock workflow module
jest.mock('../../src/core/workflow/workflows/MediaOperationWorkflow', () => {
  return {
    createMediaOperationWorkflow: jest.fn(() => ({
      createWorkflow: jest.fn(() => ({
        id: 'mock-workflow-123',
        getCurrentStep: jest.fn(() => ({ 
          id: 'operation_select',
          ui: { type: 'options', message: 'Select a media operation:' }
        })),
        processInput: jest.fn().mockResolvedValue({
          success: true,
          nextStep: 'image_input'
        }),
        serialize: jest.fn(() => ({ id: 'mock-workflow-123', currentStep: 'image_input' })),
        getCurrentStepId: jest.fn(() => 'image_input')
      }))
    })),
    resumeWorkflowWithWebhook: jest.fn().mockImplementation((serializedWorkflow, webhookPayload) => {
      if (webhookPayload.status === 'success') {
        return {
          id: 'mock-workflow-123',
          context: { userId: 'user-123', result: webhookPayload },
          currentStep: 'results',
          getCurrentStepId: jest.fn(() => 'results'),
          serialize: jest.fn(() => ({ id: 'mock-workflow-123', currentStep: 'results' }))
        };
      } else {
        throw new Error('Operation failed');
      }
    })
  };
});

// Mock UUID
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-1234')
}));

describe('Media Command Tests', () => {
  // Common mocks for all tests
  let mockMediaService;
  let mockPointsService;
  let mockSessionManager;
  let mockUIManager;
  let mockAnalyticsService;
  let mockSession;
  let mockRegistry;
  
  // Setup common mocks before each test
  beforeEach(() => {
    // Create mocks
    mockMediaService = {
      processImageToImage: jest.fn().mockResolvedValue({ taskId: 'task-123', run_id: 'run-123', status: 'queued' }),
      removeBackground: jest.fn().mockResolvedValue({ taskId: 'task-123', run_id: 'run-123', status: 'queued' }),
      upscaleImage: jest.fn().mockResolvedValue({ taskId: 'task-123', run_id: 'run-123', status: 'queued' }),
      interrogateImage: jest.fn().mockResolvedValue({ taskId: 'task-123', run_id: 'run-123', status: 'queued' }),
      animateImage: jest.fn().mockResolvedValue({ taskId: 'task-123', run_id: 'run-123', status: 'queued' }),
      generateVideo: jest.fn().mockResolvedValue({ taskId: 'task-123', run_id: 'run-123', status: 'queued' }),
      getOperationCost: jest.fn().mockResolvedValue(10)
    };
    
    mockPointsService = {
      hasSufficientPoints: jest.fn().mockResolvedValue(true),
      allocatePoints: jest.fn().mockResolvedValue(true),
      finalizePoints: jest.fn().mockResolvedValue(true),
      refundPoints: jest.fn().mockResolvedValue(true)
    };
    
    mockSession = {
      get: jest.fn((key) => {
        if (key === 'points.balance') return 100;
        if (key === 'username') return 'testuser';
        if (key === 'locale') return 'en';
        if (key === 'workflows.mock-workflow-123') return { id: 'mock-workflow-123', currentStep: 'processing' };
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
      createComponent: jest.fn().mockReturnValue({ type: 'options', props: {} }),
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
    test('should create image-to-image command with correct metadata', () => {
      const command = createImageToImageCommand({});
      
      expect(command.name).toBe('image-to-image');
      expect(command.description).toBe('Transform an image using AI');
      expect(command.category).toBe('media');
      expect(command.aliases).toContain('img2img');
      expect(typeof command.execute).toBe('function');
      expect(typeof command.processWebhook).toBe('function');
    });
    
    test('should create remove-background command with correct metadata', () => {
      const command = createRemoveBackgroundCommand({});
      
      expect(command.name).toBe('remove-background');
      expect(command.description).toBe('Remove the background from an image');
      expect(command.category).toBe('media');
      expect(command.aliases).toContain('rembg');
      expect(typeof command.execute).toBe('function');
      expect(typeof command.processWebhook).toBe('function');
    });
    
    test('should create upscale command with correct metadata', () => {
      const command = createUpscaleCommand({});
      
      expect(command.name).toBe('upscale');
      expect(command.description).toBe('Enhance image quality and resolution');
      expect(command.category).toBe('media');
      expect(command.aliases).toContain('enhance');
      expect(typeof command.execute).toBe('function');
      expect(typeof command.processWebhook).toBe('function');
    });
    
    test('should create analyze command with correct metadata', () => {
      const command = createAnalyzeImageCommand({});
      
      expect(command.name).toBe('analyze');
      expect(command.description).toBe('Analyze an image to get a description or prompt');
      expect(command.category).toBe('media');
      expect(command.aliases).toContain('interrogate');
      expect(typeof command.execute).toBe('function');
      expect(typeof command.processWebhook).toBe('function');
    });
    
    test('should create animate command with correct metadata', () => {
      const command = createAnimateCommand({});
      
      expect(command.name).toBe('animate');
      expect(command.description).toBe('Animate a still image');
      expect(command.category).toBe('media');
      expect(command.aliases).toContain('motion');
      expect(typeof command.execute).toBe('function');
      expect(typeof command.processWebhook).toBe('function');
    });
    
    test('should create video command with correct metadata', () => {
      const command = createVideoCommand({});
      
      expect(command.name).toBe('video');
      expect(command.description).toBe('Generate a video from a prompt');
      expect(command.category).toBe('media');
      expect(command.aliases).toContain('vid');
      expect(typeof command.execute).toBe('function');
      expect(typeof command.processWebhook).toBe('function');
    });
  });
  
  describe('Command Registration Tests', () => {
    test('should register all media commands with registry', () => {
      registerMediaCommands(mockRegistry, {});
      
      // Should register 6 commands
      expect(mockRegistry.register).toHaveBeenCalledTimes(6);
    });
    
    test('should throw error if registry is not provided', () => {
      expect(() => registerMediaCommands(null, {})).toThrow('Command registry is required');
    });
  });
  
  describe('Command Execution Tests', () => {
    test('should start image-to-image workflow successfully', async () => {
      // Create command
      const command = createImageToImageCommand({
        mediaService: mockMediaService,
        sessionManager: mockSessionManager,
        pointsService: mockPointsService,
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
        },
        parameters: {
          prompt: 'test prompt',
          imageUrl: 'http://example.com/image.jpg'
        }
      });
      
      // Check result
      expect(result.success).toBe(true);
      expect(result.workflowId).toBe('mock-workflow-123');
      
      // Verify session was updated
      expect(mockSessionManager.updateSession).toHaveBeenCalled();
      
      // Verify analytics were tracked
      expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith('command:media:initiated', expect.any(Object));
    });
    
    test('should handle missing userId error', async () => {
      // Create command
      const command = createImageToImageCommand({
        mediaService: mockMediaService,
        sessionManager: mockSessionManager,
        pointsService: mockPointsService,
        uiManager: mockUIManager,
        analyticsService: mockAnalyticsService
      });
      
      // Execute command with missing userId
      await expect(command.execute({
        platform: 'telegram',
        messageContext: {}
      })).rejects.toThrow('User ID is required');
    });
    
    test('should handle missing media service error', async () => {
      // Create command without media service
      const command = createImageToImageCommand({
        sessionManager: mockSessionManager,
        pointsService: mockPointsService,
        uiManager: mockUIManager,
        analyticsService: mockAnalyticsService
      });
      
      // Execute command
      await expect(command.execute({
        userId: 'user-123',
        platform: 'telegram',
        messageContext: {}
      })).rejects.toThrow('Media service is required');
    });
  });
  
  describe('Webhook Processing Tests', () => {
    test('should process successful webhook', async () => {
      // Setup test data
      const webhookData = {
        payload: {
          status: 'success',
          outputs: ['http://example.com/result.jpg']
        },
        userId: 'user-123',
        workflowId: 'mock-workflow-123',
        sessionManager: mockSessionManager
      };
      
      // Process webhook
      const result = await processMediaWebhook(webhookData);
      
      // Check result
      expect(result.success).toBe(true);
      expect(result.status).toBe('success');
      
      // Verify session was updated
      expect(mockSessionManager.updateSession).toHaveBeenCalled();
    });
    
    test('should handle failed webhook', async () => {
      // Setup test data
      const webhookData = {
        payload: {
          status: 'error',
          error: 'Generation failed'
        },
        userId: 'user-123',
        workflowId: 'mock-workflow-123',
        sessionManager: mockSessionManager
      };
      
      // Process webhook
      const result = await processMediaWebhook(webhookData);
      
      // Check result
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
    
    test('should handle missing parameters', async () => {
      await expect(processMediaWebhook({})).rejects.toThrow('Missing required webhook parameters');
    });
    
    test('should handle missing session', async () => {
      // Mock session not found
      mockSessionManager.getSession.mockResolvedValueOnce(null);
      
      // Setup test data
      const webhookData = {
        payload: { status: 'success' },
        userId: 'user-123',
        workflowId: 'mock-workflow-123',
        sessionManager: mockSessionManager
      };
      
      // Process webhook
      const result = await processMediaWebhook(webhookData);
      
      // Check result
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('SESSION_NOT_FOUND');
    });
    
    test('should handle missing workflow', async () => {
      // Mock workflow not found
      mockSession.get.mockReturnValueOnce(null);
      
      // Setup test data
      const webhookData = {
        payload: { status: 'success' },
        userId: 'user-123',
        workflowId: 'missing-workflow',
        sessionManager: mockSessionManager
      };
      
      // Process webhook
      const result = await processMediaWebhook(webhookData);
      
      // Check result
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('WORKFLOW_NOT_FOUND');
    });
  });
}); 