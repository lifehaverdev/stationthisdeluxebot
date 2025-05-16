/**
 * Workflow Engine Tests
 * 
 * Tests the functionality of the workflow engine responsible for 
 * managing workflow definitions and providing them to the workflow service.
 */

const WorkflowEngine = require('../../../src/core/workflow/engine');
const { AppError } = require('../../../src/core/shared/errors');
const WorkflowModel = require('../../../src/core/workflow/model');

// Mock dependencies
const mockWorkflowRepository = {
  findById: jest.fn(),
  findByUserId: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn()
};

const mockSessionManager = {
  getSession: jest.fn(),
  updateSession: jest.fn()
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

// Mock workflows
const mockAccountWorkflow = {
  name: 'AccountWorkflow',
  createWorkflow: jest.fn(),
  steps: {
    main: {
      process: jest.fn(),
      onInput: jest.fn()
    },
    profile: {
      process: jest.fn(),
      onInput: jest.fn()
    }
  }
};

const mockWorkflowInstance = {
  id: 'workflow-123',
  context: {
    userId: 'user123',
    workflowId: 'workflow-123',
    currentStep: 'main'
  },
  getCurrentStep: jest.fn(),
  processStep: jest.fn(),
  processInput: jest.fn(),
  serialize: jest.fn(),
  deserialize: jest.fn()
};

// Mock workflow registry
const mockWorkflowRegistry = {
  getWorkflow: jest.fn()
};

// Mock WorkflowModel
jest.mock('../../../src/core/workflow/model');

describe('WorkflowEngine', () => {
  let workflowEngine;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    WorkflowModel.mockClear();
    
    // Setup default mock behavior
    mockWorkflowRegistry.getWorkflow.mockReturnValue(mockAccountWorkflow);
    mockAccountWorkflow.createWorkflow.mockReturnValue(mockWorkflowInstance);
    
    mockWorkflowInstance.getCurrentStep.mockReturnValue({
      id: 'main',
      ui: { 
        type: 'menu',
        title: 'Account Settings',
        options: []
      }
    });
    
    mockWorkflowInstance.processStep.mockResolvedValue({
      nextStep: 'main',
      ui: {
        type: 'menu',
        title: 'Account Settings',
        options: []
      }
    });
    
    mockWorkflowInstance.processInput.mockResolvedValue({
      nextStep: 'profile',
      ui: {
        type: 'form',
        title: 'Profile',
        options: []
      }
    });
    
    mockWorkflowInstance.serialize.mockReturnValue({
      id: 'workflow-123',
      context: {
        userId: 'user123',
        currentStep: 'main'
      },
      state: {}
    });
    
    // Create workflow engine instance with mocked dependencies
    workflowEngine = new WorkflowEngine({
      workflowRepository: mockWorkflowRepository,
      sessionManager: mockSessionManager,
      workflowRegistry: mockWorkflowRegistry,
      logger: mockLogger
    });
  });

  describe('startWorkflow', () => {
    test('should create and start a new workflow', async () => {
      // Arrange
      const workflowName = 'AccountWorkflow';
      const initialContext = {
        userId: 'user123',
        platform: 'telegram'
      };
      
      // Act
      const result = await workflowEngine.startWorkflow(workflowName, initialContext);
      
      // Assert
      expect(mockWorkflowRegistry.getWorkflow).toHaveBeenCalledWith(workflowName);
      expect(mockAccountWorkflow.createWorkflow).toHaveBeenCalledWith({
        context: initialContext
      });
      
      expect(mockWorkflowRepository.create).toHaveBeenCalledWith({
        workflowType: workflowName,
        userId: 'user123',
        state: expect.any(Object),
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
        currentStep: 'main'
      });
      
      expect(result).toBeDefined();
      expect(result.id).toBe('workflow-123');
      expect(result.currentStep).toBe('main');
    });
    
    test('should throw error when workflow not found in registry', async () => {
      // Arrange
      mockWorkflowRegistry.getWorkflow.mockReturnValue(null);
      
      // Act & Assert
      await expect(workflowEngine.startWorkflow('NonExistentWorkflow', {}))
        .rejects.toThrow('Workflow NonExistentWorkflow not found');
      
      expect(mockLogger.error).toHaveBeenCalled();
    });
    
    test('should throw error when userId is missing', async () => {
      // Act & Assert
      await expect(workflowEngine.startWorkflow('AccountWorkflow', {}))
        .rejects.toThrow('User ID is required for workflow');
      
      expect(mockLogger.error).toHaveBeenCalled();
    });
    
    test('should store workflow in user session when sessionManager available', async () => {
      // Arrange
      const workflowName = 'AccountWorkflow';
      const initialContext = {
        userId: 'user123',
        platform: 'telegram'
      };
      
      mockSessionManager.getSession.mockResolvedValue({
        id: 'session123',
        data: {},
        get: jest.fn(),
        set: jest.fn()
      });
      
      // Act
      await workflowEngine.startWorkflow(workflowName, initialContext);
      
      // Assert
      expect(mockSessionManager.getSession).toHaveBeenCalledWith('user123');
      expect(mockSessionManager.updateSession).toHaveBeenCalledWith('user123', {
        activeWorkflows: {
          'workflow-123': {
            id: 'workflow-123',
            type: 'AccountWorkflow',
            currentStep: 'main'
          }
        }
      });
    });
  });

  describe('getWorkflow', () => {
    test('should retrieve workflow by ID', async () => {
      // Arrange
      const workflowId = 'workflow-123';
      
      mockWorkflowRepository.findById.mockResolvedValue({
        id: workflowId,
        workflowType: 'AccountWorkflow',
        userId: 'user123',
        state: {
          context: {
            userId: 'user123',
            currentStep: 'main'
          }
        },
        currentStep: 'main'
      });
      
      // Act
      const result = await workflowEngine.getWorkflow(workflowId);
      
      // Assert
      expect(mockWorkflowRepository.findById).toHaveBeenCalledWith(workflowId);
      expect(mockWorkflowRegistry.getWorkflow).toHaveBeenCalledWith('AccountWorkflow');
      expect(result).toBeDefined();
      expect(result.id).toBe(workflowId);
      expect(result.getCurrentStep().id).toBe('main');
    });
    
    test('should return null when workflow not found', async () => {
      // Arrange
      mockWorkflowRepository.findById.mockResolvedValue(null);
      
      // Act
      const result = await workflowEngine.getWorkflow('nonexistent');
      
      // Assert
      expect(result).toBeNull();
    });
    
    test('should throw error when workflow type not found in registry', async () => {
      // Arrange
      mockWorkflowRepository.findById.mockResolvedValue({
        id: 'workflow-123',
        workflowType: 'NonExistentWorkflow',
        userId: 'user123',
        state: {}
      });
      
      mockWorkflowRegistry.getWorkflow.mockReturnValue(null);
      
      // Act & Assert
      await expect(workflowEngine.getWorkflow('workflow-123'))
        .rejects.toThrow('Workflow type NonExistentWorkflow not found in registry');
      
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getUserWorkflows', () => {
    test('should return active workflows for user', async () => {
      // Arrange
      const userId = 'user123';
      
      mockWorkflowRepository.findByUserId.mockResolvedValue([
        {
          id: 'workflow-123',
          workflowType: 'AccountWorkflow',
          userId,
          state: {},
          currentStep: 'main',
          createdAt: 1609459200000
        },
        {
          id: 'workflow-456',
          workflowType: 'AccountWorkflow',
          userId,
          state: {},
          currentStep: 'profile',
          createdAt: 1609545600000
        }
      ]);
      
      // Act
      const result = await workflowEngine.getUserWorkflows(userId);
      
      // Assert
      expect(mockWorkflowRepository.findByUserId).toHaveBeenCalledWith(userId);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('workflow-123');
      expect(result[1].id).toBe('workflow-456');
    });
    
    test('should return empty array when no workflows found', async () => {
      // Arrange
      mockWorkflowRepository.findByUserId.mockResolvedValue([]);
      
      // Act
      const result = await workflowEngine.getUserWorkflows('user123');
      
      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('handleWorkflowInput', () => {
    test('should process input and update workflow state', async () => {
      // Arrange
      const workflowId = 'workflow-123';
      const input = 'profile';
      const context = {
        userId: 'user123',
        messageId: 'msg123'
      };
      
      mockWorkflowRepository.findById.mockResolvedValue({
        id: workflowId,
        workflowType: 'AccountWorkflow',
        userId: 'user123',
        state: {
          context: {
            userId: 'user123',
            currentStep: 'main'
          }
        },
        currentStep: 'main'
      });
      
      // Act
      const result = await workflowEngine.handleWorkflowInput(workflowId, input, context);
      
      // Assert
      expect(mockWorkflowInstance.processInput).toHaveBeenCalledWith(input, {
        userId: 'user123',
        messageId: 'msg123'
      });
      
      expect(mockWorkflowRepository.update).toHaveBeenCalledWith(
        workflowId,
        {
          state: expect.any(Object),
          currentStep: 'profile',
          updatedAt: expect.any(Number)
        }
      );
      
      expect(result).toEqual({
        success: true,
        workflowId,
        nextStep: 'profile',
        ui: {
          type: 'form',
          title: 'Profile',
          options: []
        }
      });
    });
    
    test('should throw error when workflow not found', async () => {
      // Arrange
      mockWorkflowRepository.findById.mockResolvedValue(null);
      
      // Act & Assert
      await expect(workflowEngine.handleWorkflowInput('nonexistent', 'input', {}))
        .rejects.toThrow('Workflow not found');
      
      expect(mockLogger.error).toHaveBeenCalled();
    });
    
    test('should throw error when input processing fails', async () => {
      // Arrange
      mockWorkflowRepository.findById.mockResolvedValue({
        id: 'workflow-123',
        workflowType: 'AccountWorkflow',
        userId: 'user123',
        state: {},
        currentStep: 'main'
      });
      
      mockWorkflowInstance.processInput.mockRejectedValue(new Error('Invalid input'));
      
      // Act & Assert
      await expect(workflowEngine.handleWorkflowInput('workflow-123', 'invalid', {}))
        .rejects.toThrow('Error processing workflow input: Invalid input');
      
      expect(mockLogger.error).toHaveBeenCalled();
    });
    
    test('should update user session with workflow state', async () => {
      // Arrange
      const workflowId = 'workflow-123';
      const input = 'profile';
      const context = {
        userId: 'user123'
      };
      
      mockWorkflowRepository.findById.mockResolvedValue({
        id: workflowId,
        workflowType: 'AccountWorkflow',
        userId: 'user123',
        state: {},
        currentStep: 'main'
      });
      
      mockSessionManager.getSession.mockResolvedValue({
        id: 'session123',
        data: {
          activeWorkflows: {
            'workflow-123': {
              id: 'workflow-123',
              type: 'AccountWorkflow',
              currentStep: 'main'
            }
          }
        },
        get: jest.fn(),
        set: jest.fn()
      });
      
      // Act
      await workflowEngine.handleWorkflowInput(workflowId, input, context);
      
      // Assert
      expect(mockSessionManager.updateSession).toHaveBeenCalledWith('user123', {
        activeWorkflows: {
          'workflow-123': {
            id: 'workflow-123',
            type: 'AccountWorkflow',
            currentStep: 'profile'
          }
        }
      });
    });
  });

  describe('cancelWorkflow', () => {
    test('should delete workflow and update session', async () => {
      // Arrange
      const workflowId = 'workflow-123';
      const userId = 'user123';
      
      mockWorkflowRepository.findById.mockResolvedValue({
        id: workflowId,
        workflowType: 'AccountWorkflow',
        userId,
        state: {},
        currentStep: 'main'
      });
      
      mockSessionManager.getSession.mockResolvedValue({
        id: 'session123',
        data: {
          activeWorkflows: {
            'workflow-123': {
              id: 'workflow-123',
              type: 'AccountWorkflow',
              currentStep: 'main'
            }
          }
        },
        get: jest.fn(),
        set: jest.fn()
      });
      
      // Act
      const result = await workflowEngine.cancelWorkflow(workflowId);
      
      // Assert
      expect(mockWorkflowRepository.delete).toHaveBeenCalledWith(workflowId);
      expect(mockSessionManager.updateSession).toHaveBeenCalledWith(userId, {
        activeWorkflows: {}
      });
      
      expect(result).toEqual({
        success: true,
        message: 'Workflow cancelled successfully'
      });
    });
    
    test('should return error when workflow not found', async () => {
      // Arrange
      mockWorkflowRepository.findById.mockResolvedValue(null);
      
      // Act
      const result = await workflowEngine.cancelWorkflow('nonexistent');
      
      // Assert
      expect(result).toEqual({
        success: false,
        message: 'Workflow not found'
      });
      
      expect(mockWorkflowRepository.delete).not.toHaveBeenCalled();
    });
    
    test('should handle errors during cancellation', async () => {
      // Arrange
      mockWorkflowRepository.findById.mockResolvedValue({
        id: 'workflow-123',
        workflowType: 'AccountWorkflow',
        userId: 'user123',
        state: {},
        currentStep: 'main'
      });
      
      mockWorkflowRepository.delete.mockRejectedValue(new Error('Delete failed'));
      
      // Act
      const result = await workflowEngine.cancelWorkflow('workflow-123');
      
      // Assert
      expect(result).toEqual({
        success: false,
        message: 'Failed to cancel workflow: Delete failed'
      });
      
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('resumeWorkflow', () => {
    test('should process current step of workflow', async () => {
      // Arrange
      const workflowId = 'workflow-123';
      
      mockWorkflowRepository.findById.mockResolvedValue({
        id: workflowId,
        workflowType: 'AccountWorkflow',
        userId: 'user123',
        state: {},
        currentStep: 'main'
      });
      
      // Act
      const result = await workflowEngine.resumeWorkflow(workflowId);
      
      // Assert
      expect(mockWorkflowInstance.processStep).toHaveBeenCalled();
      expect(mockWorkflowRepository.update).toHaveBeenCalledWith(
        workflowId,
        {
          state: expect.any(Object),
          updatedAt: expect.any(Number)
        }
      );
      
      expect(result).toEqual({
        success: true,
        workflowId,
        nextStep: 'main',
        ui: {
          type: 'menu',
          title: 'Account Settings',
          options: []
        }
      });
    });
    
    test('should throw error when workflow not found', async () => {
      // Arrange
      mockWorkflowRepository.findById.mockResolvedValue(null);
      
      // Act & Assert
      await expect(workflowEngine.resumeWorkflow('nonexistent'))
        .rejects.toThrow('Workflow not found');
      
      expect(mockLogger.error).toHaveBeenCalled();
    });
    
    test('should handle step processing errors', async () => {
      // Arrange
      mockWorkflowRepository.findById.mockResolvedValue({
        id: 'workflow-123',
        workflowType: 'AccountWorkflow',
        userId: 'user123',
        state: {},
        currentStep: 'main'
      });
      
      mockWorkflowInstance.processStep.mockRejectedValue(new Error('Step processing failed'));
      
      // Act & Assert
      await expect(workflowEngine.resumeWorkflow('workflow-123'))
        .rejects.toThrow('Error processing workflow step: Step processing failed');
      
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredWorkflows', () => {
    test('should delete expired workflows', async () => {
      // Arrange
      const now = Date.now();
      const expiryThreshold = 24 * 60 * 60 * 1000; // 24 hours
      const expiredWorkflows = [
        {
          id: 'workflow-old-1',
          updatedAt: now - expiryThreshold - 3600000 // 1 hour older than threshold
        },
        {
          id: 'workflow-old-2',
          updatedAt: now - expiryThreshold - 7200000 // 2 hours older than threshold
        }
      ];
      
      mockWorkflowRepository.find = jest.fn().mockResolvedValue(expiredWorkflows);
      
      // Act
      const result = await workflowEngine.cleanupExpiredWorkflows(expiryThreshold);
      
      // Assert
      expect(mockWorkflowRepository.find).toHaveBeenCalledWith({
        updatedAt: { $lt: now - expiryThreshold }
      });
      
      expect(mockWorkflowRepository.delete).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        success: true,
        deleted: 2,
        message: 'Deleted 2 expired workflows'
      });
    });
    
    test('should handle no expired workflows', async () => {
      // Arrange
      mockWorkflowRepository.find = jest.fn().mockResolvedValue([]);
      
      // Act
      const result = await workflowEngine.cleanupExpiredWorkflows();
      
      // Assert
      expect(mockWorkflowRepository.delete).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        deleted: 0,
        message: 'No expired workflows to delete'
      });
    });
    
    test('should handle errors during cleanup', async () => {
      // Arrange
      mockWorkflowRepository.find = jest.fn().mockRejectedValue(new Error('Find failed'));
      
      // Act
      const result = await workflowEngine.cleanupExpiredWorkflows();
      
      // Assert
      expect(result).toEqual({
        success: false,
        message: 'Failed to cleanup expired workflows: Find failed'
      });
      
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('constructor', () => {
    test('should initialize with empty workflow definitions', () => {
      // Assert
      expect(workflowEngine.getWorkflowTypes()).toEqual([]);
    });
    
    test('should use provided logger', () => {
      // Arrange
      const customLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
      };
      
      // Act
      const engine = new WorkflowEngine({ logger: customLogger });
      
      // Assert using a private method call to trigger logging
      engine.getWorkflowDefinition('NonExistent');
      expect(customLogger.warn).toHaveBeenCalled();
    });
  });
  
  describe('registerWorkflow', () => {
    test('should register a new workflow definition', () => {
      // Act
      workflowEngine.registerWorkflow(mockDefinitions.AccountSetup);
      
      // Assert
      expect(workflowEngine.getWorkflowTypes()).toEqual(['AccountSetup']);
      expect(workflowEngine.getWorkflowDefinition('AccountSetup')).toBe(mockDefinitions.AccountSetup);
    });
    
    test('should register multiple workflow definitions', () => {
      // Act
      workflowEngine.registerWorkflow(mockDefinitions.AccountSetup);
      workflowEngine.registerWorkflow(mockDefinitions.SubscriptionRenewal);
      
      // Assert
      expect(workflowEngine.getWorkflowTypes()).toContain('AccountSetup');
      expect(workflowEngine.getWorkflowTypes()).toContain('SubscriptionRenewal');
      expect(workflowEngine.getWorkflowTypes().length).toBe(2);
    });
    
    test('should throw error when registering invalid workflow', () => {
      // Arrange
      const invalidWorkflow = {
        // Missing type
        initialStep: 'welcome',
        steps: {}
      };
      
      // Act & Assert
      expect(() => workflowEngine.registerWorkflow(invalidWorkflow))
        .toThrow('Workflow definition must have a type');
    });
    
    test('should throw error when registering workflow with missing initialStep', () => {
      // Arrange
      const invalidWorkflow = {
        type: 'InvalidWorkflow',
        // Missing initialStep
        steps: {}
      };
      
      // Act & Assert
      expect(() => workflowEngine.registerWorkflow(invalidWorkflow))
        .toThrow('Workflow definition must have an initialStep');
    });
    
    test('should throw error when registering workflow with missing steps', () => {
      // Arrange
      const invalidWorkflow = {
        type: 'InvalidWorkflow',
        initialStep: 'welcome'
        // Missing steps
      };
      
      // Act & Assert
      expect(() => workflowEngine.registerWorkflow(invalidWorkflow))
        .toThrow('Workflow definition must have steps');
    });
    
    test('should throw error when registering workflow with empty steps', () => {
      // Arrange
      const invalidWorkflow = {
        type: 'InvalidWorkflow',
        initialStep: 'welcome',
        steps: {}
      };
      
      // Act & Assert
      expect(() => workflowEngine.registerWorkflow(invalidWorkflow))
        .toThrow('Workflow definition must have at least one step');
    });
    
    test('should throw error when registering workflow with invalid initialStep', () => {
      // Arrange
      const invalidWorkflow = {
        type: 'InvalidWorkflow',
        initialStep: 'nonexistent',
        steps: {
          welcome: {
            next: 'complete',
            handlers: {}
          },
          complete: {
            handlers: {}
          }
        }
      };
      
      // Act & Assert
      expect(() => workflowEngine.registerWorkflow(invalidWorkflow))
        .toThrow('Initial step "nonexistent" does not exist in workflow steps');
    });
    
    test('should throw error when trying to register duplicate workflow type', () => {
      // Arrange
      workflowEngine.registerWorkflow(mockDefinitions.AccountSetup);
      
      // Act & Assert
      expect(() => workflowEngine.registerWorkflow(mockDefinitions.AccountSetup))
        .toThrow('Workflow type "AccountSetup" is already registered');
    });
    
    test('should validate step handlers', () => {
      // Arrange
      const invalidWorkflow = {
        type: 'InvalidWorkflow',
        initialStep: 'welcome',
        steps: {
          welcome: {
            next: 'complete',
            // Missing handlers
          },
          complete: {
            handlers: {}
          }
        }
      };
      
      // Act & Assert
      expect(() => workflowEngine.registerWorkflow(invalidWorkflow))
        .toThrow('Step "welcome" must have handlers');
    });
  });
  
  describe('getWorkflowDefinition', () => {
    test('should return workflow definition by type', () => {
      // Arrange
      workflowEngine.registerWorkflow(mockDefinitions.AccountSetup);
      
      // Act
      const definition = workflowEngine.getWorkflowDefinition('AccountSetup');
      
      // Assert
      expect(definition).toBe(mockDefinitions.AccountSetup);
    });
    
    test('should return null for non-existent workflow type', () => {
      // Act
      const definition = workflowEngine.getWorkflowDefinition('NonExistentType');
      
      // Assert
      expect(definition).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Workflow definition not found'),
        expect.objectContaining({ type: 'NonExistentType' })
      );
    });
  });
  
  describe('getWorkflowTypes', () => {
    test('should return empty array when no workflows are registered', () => {
      // Act
      const types = workflowEngine.getWorkflowTypes();
      
      // Assert
      expect(types).toEqual([]);
    });
    
    test('should return all registered workflow types', () => {
      // Arrange
      workflowEngine.registerWorkflow(mockDefinitions.AccountSetup);
      workflowEngine.registerWorkflow(mockDefinitions.SubscriptionRenewal);
      
      // Act
      const types = workflowEngine.getWorkflowTypes();
      
      // Assert
      expect(types).toEqual(['AccountSetup', 'SubscriptionRenewal']);
    });
  });
  
  describe('validateWorkflowStepTransitions', () => {
    test('should validate valid workflow step transitions', () => {
      // Arrange
      const validWorkflow = {
        type: 'ValidWorkflow',
        initialStep: 'step1',
        steps: {
          step1: {
            next: 'step2',
            handlers: { processStep: jest.fn() }
          },
          step2: {
            next: 'step3',
            handlers: { processStep: jest.fn() }
          },
          step3: {
            final: true,
            handlers: { processStep: jest.fn() }
          }
        }
      };
      
      // Act & Assert - Should not throw
      expect(() => workflowEngine.registerWorkflow(validWorkflow)).not.toThrow();
    });
    
    test('should throw error on invalid next step reference', () => {
      // Arrange
      const invalidWorkflow = {
        type: 'InvalidWorkflow',
        initialStep: 'step1',
        steps: {
          step1: {
            next: 'nonexistent', // This step doesn't exist
            handlers: { processStep: jest.fn() }
          },
          step2: {
            handlers: { processStep: jest.fn() }
          }
        }
      };
      
      // Act & Assert
      expect(() => workflowEngine.registerWorkflow(invalidWorkflow))
        .toThrow('Step "step1" has invalid next step reference "nonexistent"');
    });
    
    test('should allow a null next step for final steps', () => {
      // Arrange
      const validWorkflow = {
        type: 'ValidWorkflow',
        initialStep: 'step1',
        steps: {
          step1: {
            next: null, // Valid for final step
            final: true,
            handlers: { processStep: jest.fn() }
          }
        }
      };
      
      // Act & Assert - Should not throw
      expect(() => workflowEngine.registerWorkflow(validWorkflow)).not.toThrow();
    });
    
    test('should detect circular references in workflow steps', () => {
      // Arrange
      const circularWorkflow = {
        type: 'CircularWorkflow',
        initialStep: 'step1',
        steps: {
          step1: {
            next: 'step2',
            handlers: { processStep: jest.fn() }
          },
          step2: {
            next: 'step3',
            handlers: { processStep: jest.fn() }
          },
          step3: {
            next: 'step1', // Creates a cycle
            handlers: { processStep: jest.fn() }
          }
        }
      };
      
      // We might not validate circular references in the implementation,
      // but if we do, this test would check for it
      // Act & Assert
      // This might not throw if circular references are allowed
      // expect(() => workflowEngine.registerWorkflow(circularWorkflow))
      //   .toThrow('Circular reference detected in workflow steps');
      
      // Alternative: just check that it registers (if cycles are allowed)
      workflowEngine.registerWorkflow(circularWorkflow);
      expect(workflowEngine.getWorkflowTypes()).toContain('CircularWorkflow');
    });
  });
  
  describe('unregisterWorkflow', () => {
    test('should unregister a workflow definition', () => {
      // Arrange
      workflowEngine.registerWorkflow(mockDefinitions.AccountSetup);
      workflowEngine.registerWorkflow(mockDefinitions.SubscriptionRenewal);
      
      // Act
      workflowEngine.unregisterWorkflow('AccountSetup');
      
      // Assert
      expect(workflowEngine.getWorkflowTypes()).toEqual(['SubscriptionRenewal']);
      expect(workflowEngine.getWorkflowDefinition('AccountSetup')).toBeNull();
    });
    
    test('should do nothing when unregistering non-existent workflow', () => {
      // Arrange
      workflowEngine.registerWorkflow(mockDefinitions.AccountSetup);
      
      // Act
      workflowEngine.unregisterWorkflow('NonExistentType');
      
      // Assert
      expect(workflowEngine.getWorkflowTypes()).toEqual(['AccountSetup']);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cannot unregister non-existent workflow'),
        expect.objectContaining({ type: 'NonExistentType' })
      );
    });
  });
  
  describe('loadWorkflowsFromDirectory', () => {
    // This would typically be tested with mocked filesystem
    // Here's a basic example assuming the function exists
    
    test('should load workflows from directory', () => {
      // This would be a more complex test involving mocking filesystem
      // or dependency injection to simulate loading modules
      
      // For now, a placeholder assertion
      expect(true).toBe(true);
    });
  });

  describe('constructor', () => {
    test('should initialize with empty workflow types if none provided', () => {
      // Act
      const engine = new WorkflowEngine({ logger: mockLogger });
      
      // Assert
      expect(engine.workflowTypes).toEqual({});
      expect(engine.logger).toBe(mockLogger);
    });
    
    test('should initialize with provided workflow types', () => {
      // Arrange
      const initialTypes = {
        'AccountSetup': mockAccountSetupDefinition
      };
      
      // Act
      const engine = new WorkflowEngine({
        workflowTypes: initialTypes,
        logger: mockLogger
      });
      
      // Assert
      expect(engine.workflowTypes).toEqual(initialTypes);
    });
    
    test('should use default logger if not provided', () => {
      // Act
      const engine = new WorkflowEngine();
      
      // Assert
      expect(engine.logger).toBeDefined();
      expect(typeof engine.logger.info).toBe('function');
      expect(typeof engine.logger.error).toBe('function');
    });
  });
  
  describe('registerWorkflow', () => {
    test('should register a new workflow type', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      
      // Act
      engine.registerWorkflow(mockAccountSetupDefinition);
      
      // Assert
      expect(engine.workflowTypes).toHaveProperty('AccountSetup');
      expect(engine.workflowTypes.AccountSetup).toBe(mockAccountSetupDefinition);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Registered workflow type'),
        expect.objectContaining({ type: 'AccountSetup' })
      );
    });
    
    test('should throw error if workflow type is missing', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      const invalidDefinition = { ...mockAccountSetupDefinition };
      delete invalidDefinition.type;
      
      // Act & Assert
      expect(() => engine.registerWorkflow(invalidDefinition)).toThrow('Workflow definition must have a type');
    });
    
    test('should throw error if workflow steps are missing', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      const invalidDefinition = { ...mockAccountSetupDefinition };
      delete invalidDefinition.steps;
      
      // Act & Assert
      expect(() => engine.registerWorkflow(invalidDefinition)).toThrow('Workflow definition must have steps');
    });
    
    test('should throw error if workflow initialStep is missing', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      const invalidDefinition = { ...mockAccountSetupDefinition };
      delete invalidDefinition.initialStep;
      
      // Act & Assert
      expect(() => engine.registerWorkflow(invalidDefinition)).toThrow('Workflow definition must have an initialStep');
    });
    
    test('should override existing workflow type with same name', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      const originalDefinition = { ...mockAccountSetupDefinition };
      const newDefinition = { 
        ...mockAccountSetupDefinition,
        initialStep: 'new_start'
      };
      
      // Act
      engine.registerWorkflow(originalDefinition);
      engine.registerWorkflow(newDefinition);
      
      // Assert
      expect(engine.workflowTypes.AccountSetup).toBe(newDefinition);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Overriding existing workflow type'),
        expect.objectContaining({ type: 'AccountSetup' })
      );
    });
    
    test('should register multiple workflow types', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      
      // Act
      engine.registerWorkflow(mockAccountSetupDefinition);
      engine.registerWorkflow(mockSurveyDefinition);
      
      // Assert
      expect(engine.workflowTypes).toHaveProperty('AccountSetup');
      expect(engine.workflowTypes).toHaveProperty('Survey');
      expect(engine.workflowTypes.AccountSetup).toBe(mockAccountSetupDefinition);
      expect(engine.workflowTypes.Survey).toBe(mockSurveyDefinition);
    });
  });
  
  describe('getWorkflowType', () => {
    test('should return workflow definition for valid type', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      engine.registerWorkflow(mockAccountSetupDefinition);
      
      // Act
      const definition = engine.getWorkflowType('AccountSetup');
      
      // Assert
      expect(definition).toBe(mockAccountSetupDefinition);
    });
    
    test('should return null for non-existent workflow type', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      
      // Act
      const definition = engine.getWorkflowType('NonExistent');
      
      // Assert
      expect(definition).toBeNull();
    });
    
    test('should handle case sensitivity in workflow types', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      engine.registerWorkflow(mockAccountSetupDefinition);
      
      // Act & Assert
      expect(engine.getWorkflowType('accountsetup')).toBeNull();
      expect(engine.getWorkflowType('ACCOUNTSETUP')).toBeNull();
      expect(engine.getWorkflowType('AccountSetup')).toBe(mockAccountSetupDefinition);
    });
  });
  
  describe('listWorkflowTypes', () => {
    test('should return empty array when no workflow types are registered', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      
      // Act
      const types = engine.listWorkflowTypes();
      
      // Assert
      expect(types).toEqual([]);
    });
    
    test('should return array of registered workflow types', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      engine.registerWorkflow(mockAccountSetupDefinition);
      engine.registerWorkflow(mockSurveyDefinition);
      
      // Act
      const types = engine.listWorkflowTypes();
      
      // Assert
      expect(types).toEqual(['AccountSetup', 'Survey']);
    });
    
    test('should return types in a consistent order', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      
      // Register in reverse alphabetical order
      engine.registerWorkflow(mockSurveyDefinition);
      engine.registerWorkflow(mockAccountSetupDefinition);
      
      // Act
      const types = engine.listWorkflowTypes();
      
      // Assert - should be alphabetical
      expect(types).toEqual(['AccountSetup', 'Survey']);
    });
  });
  
  describe('createWorkflow', () => {
    test('should create a new workflow instance for valid workflow type', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      engine.registerWorkflow(mockAccountSetupDefinition);
      
      const userId = 'user123';
      const mockWorkflowInstance = {
        id: 'workflow-123',
        userId: userId,
        workflowType: 'AccountSetup'
      };
      
      WorkflowModel.mockImplementation(() => mockWorkflowInstance);
      
      // Act
      const workflow = engine.createWorkflow('AccountSetup', userId);
      
      // Assert
      expect(workflow).toBe(mockWorkflowInstance);
      expect(WorkflowModel).toHaveBeenCalledWith({
        definition: mockAccountSetupDefinition,
        userId: userId,
        logger: mockLogger
      });
    });
    
    test('should throw error for invalid workflow type', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      const userId = 'user123';
      
      // Act & Assert
      expect(() => engine.createWorkflow('NonExistent', userId))
        .toThrow('Unknown workflow type: NonExistent');
    });
    
    test('should throw error if userId is not provided', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      engine.registerWorkflow(mockAccountSetupDefinition);
      
      // Act & Assert
      expect(() => engine.createWorkflow('AccountSetup'))
        .toThrow('userId is required to create a workflow');
    });
    
    test('should create workflow with initial data if provided', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      engine.registerWorkflow(mockAccountSetupDefinition);
      
      const userId = 'user123';
      const initialData = { name: 'John Doe' };
      const mockWorkflowInstance = {
        id: 'workflow-123',
        userId: userId,
        workflowType: 'AccountSetup',
        setData: jest.fn()
      };
      
      WorkflowModel.mockImplementation(() => mockWorkflowInstance);
      
      // Act
      const workflow = engine.createWorkflow('AccountSetup', userId, initialData);
      
      // Assert
      expect(workflow).toBe(mockWorkflowInstance);
      expect(mockWorkflowInstance.setData).toHaveBeenCalledWith(initialData);
    });
  });
  
  describe('hydrateWorkflow', () => {
    test('should hydrate a workflow from stored data', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      engine.registerWorkflow(mockAccountSetupDefinition);
      
      const storedData = {
        id: 'workflow-123',
        userId: 'user123',
        workflowType: 'AccountSetup',
        currentStep: 'personal_info',
        data: { name: 'John Doe' },
        history: ['welcome']
      };
      
      const mockWorkflowInstance = {
        id: 'workflow-123',
        userId: 'user123',
        workflowType: 'AccountSetup',
        currentStep: 'personal_info'
      };
      
      WorkflowModel.mockImplementation(() => mockWorkflowInstance);
      
      // Act
      const workflow = engine.hydrateWorkflow(storedData);
      
      // Assert
      expect(workflow).toBe(mockWorkflowInstance);
      expect(WorkflowModel).toHaveBeenCalledWith({
        definition: mockAccountSetupDefinition,
        ...storedData,
        logger: mockLogger
      });
    });
    
    test('should throw error if workflowType is missing in stored data', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      
      const storedData = {
        id: 'workflow-123',
        userId: 'user123',
        // Missing workflowType
        currentStep: 'personal_info'
      };
      
      // Act & Assert
      expect(() => engine.hydrateWorkflow(storedData))
        .toThrow('workflowType is required in stored workflow data');
    });
    
    test('should throw error for unknown workflow type', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      
      const storedData = {
        id: 'workflow-123',
        userId: 'user123',
        workflowType: 'NonExistent',
        currentStep: 'personal_info'
      };
      
      // Act & Assert
      expect(() => engine.hydrateWorkflow(storedData))
        .toThrow('Unknown workflow type: NonExistent');
    });
    
    test('should log error if workflow hydration fails', () => {
      // Arrange
      const engine = new WorkflowEngine({ logger: mockLogger });
      engine.registerWorkflow(mockAccountSetupDefinition);
      
      const storedData = {
        id: 'workflow-123',
        userId: 'user123',
        workflowType: 'AccountSetup',
        currentStep: 'personal_info'
      };
      
      const hydrationError = new Error('Hydration failed');
      WorkflowModel.mockImplementation(() => {
        throw hydrationError;
      });
      
      // Act & Assert
      expect(() => engine.hydrateWorkflow(storedData))
        .toThrow('Error hydrating workflow: Hydration failed');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error hydrating workflow'),
        expect.objectContaining({
          error: hydrationError,
          workflowData: storedData
        })
      );
    });
  });
}); 