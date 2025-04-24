/**
 * E2E Test Suite for Media Commands
 * 
 * Tests the full lifecycle of media commands from input to delivery,
 * including webhook handling, point deductions, UI flow, and error handling.
 */

const {
  createImageToImageCommand,
  createRemoveBackgroundCommand,
  processMediaWebhook
} = require('../../src/commands/mediaCommand');
const { createMediaOperationWorkflow, resumeWorkflowWithWebhook } = require('../../src/core/workflow/workflows/MediaOperationWorkflow');
const { AppError, ERROR_SEVERITY } = require('../../src/core/shared/errors');

// Mock dependencies
jest.mock('../../src/core/workflow/workflows/MediaOperationWorkflow', () => {
  const actualModule = jest.requireActual('../../src/core/workflow/workflows/MediaOperationWorkflow');
  
  return {
    ...actualModule,
    createMediaOperationWorkflow: jest.fn(options => {
      // Create a mock workflow instance with the core functionality
      return {
        createWorkflow: jest.fn(context => {
          return {
            id: 'workflow-123',
            context: {
              ...context.context,
              _services: options
            },
            getCurrentStep: jest.fn(() => ({
              id: 'operation_select',
              name: 'Select Operation',
              ui: {
                type: 'options',
                message: 'Select a media operation:',
                options: [
                  { id: 'image-to-image', label: 'Image-to-Image' },
                  { id: 'background-removal', label: 'Remove Background' }
                ]
              }
            })),
            processInput: jest.fn(input => {
              const operationType = input || context.context.operationType;
              
              return {
                success: true,
                nextStep: operationType === 'image-to-image' ? 'prompt_input' : 'image_input'
              };
            }),
            getCurrentStepId: jest.fn(() => 'operation_select'),
            serialize: jest.fn(() => ({
              id: 'workflow-123',
              context: context.context,
              currentStep: 'operation_select'
            }))
          };
        }),
        name: 'MediaOperationWorkflow'
      };
    }),
    resumeWorkflowWithWebhook: jest.fn((serializedWorkflow, webhookPayload) => {
      if (webhookPayload.status === 'success') {
        return {
          id: serializedWorkflow.id,
          context: {
            ...serializedWorkflow.context,
            result: webhookPayload
          },
          getCurrentStepId: jest.fn(() => 'results'),
          serialize: jest.fn(() => ({
            id: serializedWorkflow.id,
            context: {
              ...serializedWorkflow.context,
              result: webhookPayload
            },
            currentStep: 'results'
          }))
        };
      } else {
        throw new AppError('Operation failed', {
          severity: ERROR_SEVERITY.ERROR,
          code: 'OPERATION_FAILED',
          userFacing: true
        });
      }
    })
  };
});

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-1234')
}));

describe('Media Command E2E Tests', () => {
  // Setup mocks and test fixtures
  let mediaService;
  let pointsService;
  let sessionManager;
  let uiManager;
  let analyticsService;
  let imageToImageCommand;
  let removeBackgroundCommand;
  
  const mockUser = {
    id: 'user-123',
    username: 'testuser',
    points: 1000
  };
  
  const mockContext = {
    userId: mockUser.id,
    platform: 'telegram',
    messageContext: {
      chatId: 'chat-123',
      threadId: 'thread-123',
      username: mockUser.username
    }
  };
  
  // Setup mock services before tests
  beforeEach(() => {
    // Create mock media service
    mediaService = {
      processImageToImage: jest.fn().mockImplementation(async (params) => {
        return {
          taskId: 'task-' + Math.random().toString(36).substring(7),
          run_id: 'run-' + Math.random().toString(36).substring(7),
          status: 'queued'
        };
      }),
      removeBackground: jest.fn().mockImplementation(async (params) => {
        return {
          taskId: 'task-' + Math.random().toString(36).substring(7),
          run_id: 'run-' + Math.random().toString(36).substring(7),
          status: 'queued'
        };
      }),
      getOperationCost: jest.fn().mockImplementation(async (operationType) => {
        switch (operationType) {
          case 'image-to-image':
            return 10;
          case 'background-removal':
            return 5;
          default:
            return 8;
        }
      })
    };
    
    // Create mock points service
    pointsService = {
      hasSufficientPoints: jest.fn().mockResolvedValue(true),
      allocatePoints: jest.fn().mockImplementation(async (params) => {
        return {
          success: true,
          transactionId: 'txn-' + Math.random().toString(36).substring(7)
        };
      }),
      finalizePoints: jest.fn().mockImplementation(async (params) => {
        return {
          success: true,
          transactionId: params.operationId
        };
      }),
      refundPoints: jest.fn().mockImplementation(async (params) => {
        return {
          success: true,
          transactionId: params.operationId
        };
      })
    };
    
    // Create mock session and session manager
    const mockSession = {
      get: jest.fn().mockImplementation((key) => {
        if (key === 'points.balance') return mockUser.points;
        if (key === 'username') return mockUser.username;
        if (key === 'workflows.workflow-123') {
          return {
            id: 'workflow-123',
            context: {
              userId: mockUser.id,
              operationType: 'image-to-image'
            },
            currentStep: 'processing'
          };
        }
        return null;
      }),
      set: jest.fn()
    };
    
    sessionManager = {
      getSession: jest.fn().mockResolvedValue(mockSession),
      createSession: jest.fn().mockResolvedValue(mockSession),
      updateSession: jest.fn().mockResolvedValue(true)
    };
    
    // Create mock UI manager
    uiManager = {
      createComponent: jest.fn().mockImplementation((type, props) => {
        return { type, props };
      }),
      render: jest.fn().mockImplementation(async (component, options, platform, context) => {
        return {
          messageId: 'msg-' + Math.random().toString(36).substring(7),
          platform
        };
      })
    };
    
    // Create mock analytics service
    analyticsService = {
      trackEvent: jest.fn()
    };
    
    // Create command instances
    const dependencies = {
      mediaService,
      pointsService,
      sessionManager,
      uiManager,
      analyticsService
    };
    
    imageToImageCommand = createImageToImageCommand(dependencies);
    removeBackgroundCommand = createRemoveBackgroundCommand(dependencies);
  });
  
  describe('Image-to-Image Command Flow', () => {
    test('Full image-to-image generation lifecycle', async () => {
      // 1. Start the command workflow
      const startResult = await imageToImageCommand.execute({
        ...mockContext,
        parameters: {
          prompt: 'a beautiful landscape',
          imageUrl: 'https://example.com/image.jpg'
        }
      });
      
      // Verify workflow started
      expect(startResult.success).toBe(true);
      expect(startResult.workflowId).toBeDefined();
      
      // Verify session was updated with workflow
      expect(sessionManager.updateSession).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          workflows: expect.any(Object)
        })
      );
      
      // Verify analytics were tracked
      expect(analyticsService.trackEvent).toHaveBeenCalledWith(
        'command:media:initiated',
        expect.objectContaining({
          userId: mockUser.id,
          operationType: 'image-to-image'
        })
      );
      
      // 2. Simulate webhook callback for successful processing
      const webhookPayload = {
        status: 'success',
        outputs: ['https://example.com/result.jpg'],
        metadata: {
          prompt: 'a beautiful landscape',
          seed: 12345
        }
      };
      
      const webhookResult = await processMediaWebhook({
        payload: webhookPayload,
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Verify webhook was processed
      expect(webhookResult.success).toBe(true);
      expect(webhookResult.status).toBe('success');
      
      // Verify points were finalized
      expect(pointsService.finalizePoints).toHaveBeenCalled();
      
      // Verify session was updated with completed workflow
      expect(sessionManager.updateSession).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          'workflows.workflow-123': expect.any(Object)
        })
      );
    });
    
    test('Handling insufficient points', async () => {
      // Setup insufficient points
      pointsService.hasSufficientPoints.mockResolvedValueOnce(false);
      
      // Mock the workflow to test the points check
      jest.spyOn(createMediaOperationWorkflow(), 'createWorkflow').mockImplementationOnce(context => {
        return {
          id: 'workflow-123',
          context: {
            ...context.context,
          },
          getCurrentStep: jest.fn(() => ({
            id: 'confirmation',
            process: async () => {
              // This will trigger the points check
              const hasPoints = await pointsService.hasSufficientPoints(
                context.context.userId,
                10,
                'points'
              );
              
              if (!hasPoints) {
                throw new AppError('Insufficient points for this operation', {
                  severity: ERROR_SEVERITY.WARNING,
                  code: 'INSUFFICIENT_POINTS',
                  userFacing: true
                });
              }
              
              return { nextStep: 'processing' };
            },
            ui: {
              type: 'confirmation',
              message: 'Confirm operation'
            }
          })),
          processInput: jest.fn(input => {
            throw new AppError('Insufficient points for this operation', {
              severity: ERROR_SEVERITY.WARNING,
              code: 'INSUFFICIENT_POINTS',
              userFacing: true
            });
          }),
          getCurrentStepId: jest.fn(() => 'confirmation'),
          serialize: jest.fn(() => ({
            id: 'workflow-123',
            context: context.context,
            currentStep: 'confirmation'
          }))
        };
      });
      
      // Execute command should fail with insufficient points
      const result = await imageToImageCommand.execute({
        ...mockContext,
        parameters: {
          prompt: 'a beautiful landscape',
          imageUrl: 'https://example.com/image.jpg'
        }
      });
      
      // Should return error about insufficient points
      expect(result.success).toBe(false);
      expect(result.message).toContain('Insufficient points');
      
      // Should not allocate points
      expect(pointsService.allocatePoints).not.toHaveBeenCalled();
    });
  });
  
  describe('Background Removal Command Flow', () => {
    test('Full background removal lifecycle', async () => {
      // 1. Start the command workflow
      const startResult = await removeBackgroundCommand.execute({
        ...mockContext,
        parameters: {
          imageUrl: 'https://example.com/image.jpg'
        }
      });
      
      // Verify workflow started
      expect(startResult.success).toBe(true);
      expect(startResult.workflowId).toBeDefined();
      
      // 2. Simulate webhook callback for successful processing
      const webhookPayload = {
        status: 'success',
        outputs: ['https://example.com/nobg.png']
      };
      
      const webhookResult = await processMediaWebhook({
        payload: webhookPayload,
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Verify webhook was processed
      expect(webhookResult.success).toBe(true);
      expect(webhookResult.status).toBe('success');
    });
    
    test('Handling processing failure', async () => {
      // 1. Start the command workflow
      const startResult = await removeBackgroundCommand.execute({
        ...mockContext,
        parameters: {
          imageUrl: 'https://example.com/image.jpg'
        }
      });
      
      // Verify workflow started
      expect(startResult.success).toBe(true);
      
      // 2. Simulate webhook callback for failed processing
      const webhookPayload = {
        status: 'error',
        error: 'Failed to process image'
      };
      
      // Mock session.get to return a workflow for our test
      const originalGet = sessionManager.getSession().get;
      sessionManager.getSession().get = jest.fn().mockImplementation(key => {
        if (key === 'workflows.workflow-123') {
          return {
            id: 'workflow-123',
            context: {
              userId: mockUser.id,
              operationType: 'background-removal',
              taskId: 'task-123'
            },
            currentStep: 'processing'
          };
        }
        return originalGet(key);
      });
      
      const webhookResult = await processMediaWebhook({
        payload: webhookPayload,
        userId: mockUser.id,
        workflowId: 'workflow-123',
        sessionManager
      });
      
      // Verify webhook error was properly handled
      expect(webhookResult.success).toBe(false);
      expect(webhookResult.error.message).toBeDefined();
      
      // Verify points were refunded
      expect(pointsService.refundPoints).toHaveBeenCalled();
    });
  });
}); 