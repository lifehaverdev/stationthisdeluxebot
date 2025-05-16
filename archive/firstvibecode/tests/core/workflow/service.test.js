/**
 * Tests for the WorkflowService class
 * 
 * Tests the functionality of the service responsible for workflow 
 * persistence and management of workflow state.
 */

const WorkflowService = require('../../../src/core/workflow/service');
const WorkflowEngine = require('../../../src/core/workflow/engine');

// Mock dependencies
jest.mock('../../../src/core/workflow/engine');

describe('WorkflowService', () => {
  // Mock dependencies and instances
  let mockWorkflowRepository;
  let mockWorkflowEngine;
  let mockLogger;
  let service;
  
  // Sample workflow data
  const mockWorkflowData = {
    id: 'workflow-123',
    userId: 'user123',
    workflowType: 'AccountSetup',
    currentStep: 'personal_info',
    data: { name: 'John Doe' },
    history: ['welcome'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  // Mock workflow instance
  const mockWorkflow = {
    id: mockWorkflowData.id,
    userId: mockWorkflowData.userId,
    workflowType: mockWorkflowData.workflowType,
    currentStep: mockWorkflowData.currentStep,
    data: mockWorkflowData.data,
    history: mockWorkflowData.history,
    processStep: jest.fn().mockResolvedValue({ success: true }),
    processInput: jest.fn().mockResolvedValue({ success: true }),
    setStep: jest.fn(),
    setData: jest.fn(),
    isComplete: jest.fn().mockReturnValue(false),
    serialize: jest.fn().mockReturnValue({ ...mockWorkflowData })
  };
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup mock repository
    mockWorkflowRepository = {
      save: jest.fn().mockResolvedValue(mockWorkflowData),
      findById: jest.fn().mockResolvedValue(mockWorkflowData),
      findByUserId: jest.fn().mockResolvedValue([mockWorkflowData]),
      findByUserIdAndType: jest.fn().mockResolvedValue([mockWorkflowData]),
      findActive: jest.fn().mockResolvedValue([mockWorkflowData]),
      deleteById: jest.fn().mockResolvedValue(true)
    };
    
    // Setup mock engine
    mockWorkflowEngine = {
      createWorkflow: jest.fn().mockReturnValue(mockWorkflow),
      hydrateWorkflow: jest.fn().mockReturnValue(mockWorkflow),
      registerWorkflow: jest.fn(),
      getWorkflowType: jest.fn().mockReturnValue({ type: 'AccountSetup' }),
      listWorkflowTypes: jest.fn().mockReturnValue(['AccountSetup', 'Survey'])
    };
    
    // Setup WorkflowEngine mock implementation
    WorkflowEngine.mockImplementation(() => mockWorkflowEngine);
    
    // Setup mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
    
    // Create service instance
    service = new WorkflowService({
      workflowRepository: mockWorkflowRepository,
      logger: mockLogger
    });
  });
  
  describe('constructor', () => {
    test('should initialize with repository and create engine', () => {
      // Assert
      expect(service.repository).toBe(mockWorkflowRepository);
      expect(service.engine).toBeDefined();
      expect(WorkflowEngine).toHaveBeenCalledWith(expect.objectContaining({
        logger: mockLogger
      }));
    });
    
    test('should throw error if repository is not provided', () => {
      // Act & Assert
      expect(() => new WorkflowService({ logger: mockLogger }))
        .toThrow('workflowRepository is required');
    });
    
    test('should use default logger if not provided', () => {
      // Act
      const serviceWithDefaultLogger = new WorkflowService({
        workflowRepository: mockWorkflowRepository
      });
      
      // Assert
      expect(serviceWithDefaultLogger.logger).toBeDefined();
      expect(typeof serviceWithDefaultLogger.logger.info).toBe('function');
    });
  });
  
  describe('registerWorkflowType', () => {
    test('should register workflow type with engine', () => {
      // Arrange
      const workflowDefinition = { type: 'NewWorkflow', steps: {}, initialStep: 'start' };
      
      // Act
      service.registerWorkflowType(workflowDefinition);
      
      // Assert
      expect(mockWorkflowEngine.registerWorkflow).toHaveBeenCalledWith(workflowDefinition);
    });
  });
  
  describe('createWorkflow', () => {
    test('should create and save a new workflow', async () => {
      // Arrange
      const workflowType = 'AccountSetup';
      const userId = 'user123';
      const initialData = { referral: 'website' };
      
      // Act
      const workflow = await service.createWorkflow(workflowType, userId, initialData);
      
      // Assert
      expect(mockWorkflowEngine.createWorkflow).toHaveBeenCalledWith(
        workflowType,
        userId,
        initialData
      );
      expect(mockWorkflowRepository.save).toHaveBeenCalledWith(
        mockWorkflow.serialize()
      );
      expect(workflow).toBe(mockWorkflow);
    });
    
    test('should throw error if workflow type is invalid', async () => {
      // Arrange
      mockWorkflowEngine.createWorkflow.mockImplementation(() => {
        throw new Error('Unknown workflow type');
      });
      
      // Act & Assert
      await expect(service.createWorkflow('InvalidType', 'user123'))
        .rejects.toThrow('Unknown workflow type');
    });
    
    test('should log error if save fails', async () => {
      // Arrange
      const saveError = new Error('Database error');
      mockWorkflowRepository.save.mockRejectedValue(saveError);
      
      // Act & Assert
      await expect(service.createWorkflow('AccountSetup', 'user123'))
        .rejects.toThrow('Failed to save workflow: Database error');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error saving workflow'),
        expect.objectContaining({
          error: saveError,
          workflowId: mockWorkflow.id,
          userId: 'user123'
        })
      );
    });
  });
  
  describe('getWorkflow', () => {
    test('should retrieve and hydrate a workflow by id', async () => {
      // Arrange
      const workflowId = 'workflow-123';
      
      // Act
      const workflow = await service.getWorkflow(workflowId);
      
      // Assert
      expect(mockWorkflowRepository.findById).toHaveBeenCalledWith(workflowId);
      expect(mockWorkflowEngine.hydrateWorkflow).toHaveBeenCalledWith(mockWorkflowData);
      expect(workflow).toBe(mockWorkflow);
    });
    
    test('should return null if workflow not found', async () => {
      // Arrange
      mockWorkflowRepository.findById.mockResolvedValue(null);
      
      // Act
      const workflow = await service.getWorkflow('nonexistent-id');
      
      // Assert
      expect(workflow).toBeNull();
    });
    
    test('should throw error if hydration fails', async () => {
      // Arrange
      const hydrationError = new Error('Invalid workflow data');
      mockWorkflowEngine.hydrateWorkflow.mockImplementation(() => {
        throw hydrationError;
      });
      
      // Act & Assert
      await expect(service.getWorkflow('workflow-123'))
        .rejects.toThrow(/Error hydrating workflow/);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error hydrating workflow'),
        expect.objectContaining({
          error: hydrationError,
          workflowId: 'workflow-123'
        })
      );
    });
  });
  
  describe('getWorkflowsForUser', () => {
    test('should retrieve all workflows for a user', async () => {
      // Arrange
      const userId = 'user123';
      const secondWorkflow = {
        ...mockWorkflowData,
        id: 'workflow-456',
        workflowType: 'Survey'
      };
      
      mockWorkflowRepository.findByUserId.mockResolvedValue([
        mockWorkflowData,
        secondWorkflow
      ]);
      
      mockWorkflowEngine.hydrateWorkflow
        .mockReturnValueOnce(mockWorkflow)
        .mockReturnValueOnce({
          ...mockWorkflow,
          id: 'workflow-456',
          workflowType: 'Survey'
        });
      
      // Act
      const workflows = await service.getWorkflowsForUser(userId);
      
      // Assert
      expect(mockWorkflowRepository.findByUserId).toHaveBeenCalledWith(userId);
      expect(mockWorkflowEngine.hydrateWorkflow).toHaveBeenCalledTimes(2);
      expect(workflows).toHaveLength(2);
      expect(workflows[0].id).toBe('workflow-123');
      expect(workflows[1].id).toBe('workflow-456');
    });
    
    test('should return empty array if no workflows found', async () => {
      // Arrange
      mockWorkflowRepository.findByUserId.mockResolvedValue([]);
      
      // Act
      const workflows = await service.getWorkflowsForUser('user-no-workflows');
      
      // Assert
      expect(workflows).toEqual([]);
      expect(mockWorkflowEngine.hydrateWorkflow).not.toHaveBeenCalled();
    });
    
    test('should skip workflows that fail to hydrate', async () => {
      // Arrange
      const userId = 'user123';
      const corruptedWorkflow = {
        ...mockWorkflowData,
        id: 'corrupted-workflow',
        workflowType: 'Unknown'
      };
      
      mockWorkflowRepository.findByUserId.mockResolvedValue([
        mockWorkflowData,
        corruptedWorkflow
      ]);
      
      mockWorkflowEngine.hydrateWorkflow
        .mockReturnValueOnce(mockWorkflow)
        .mockImplementationOnce(() => {
          throw new Error('Invalid workflow data');
        });
      
      // Act
      const workflows = await service.getWorkflowsForUser(userId);
      
      // Assert
      expect(mockWorkflowRepository.findByUserId).toHaveBeenCalledWith(userId);
      expect(mockWorkflowEngine.hydrateWorkflow).toHaveBeenCalledTimes(2);
      expect(workflows).toHaveLength(1);
      expect(workflows[0].id).toBe('workflow-123');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to hydrate workflow'),
        expect.objectContaining({
          workflowId: 'corrupted-workflow',
          userId
        })
      );
    });
  });
  
  describe('getWorkflowsForUserByType', () => {
    test('should retrieve workflows of specific type for a user', async () => {
      // Arrange
      const userId = 'user123';
      const workflowType = 'AccountSetup';
      
      // Act
      const workflows = await service.getWorkflowsForUserByType(userId, workflowType);
      
      // Assert
      expect(mockWorkflowRepository.findByUserIdAndType).toHaveBeenCalledWith(
        userId,
        workflowType
      );
      expect(mockWorkflowEngine.hydrateWorkflow).toHaveBeenCalledWith(mockWorkflowData);
      expect(workflows).toHaveLength(1);
      expect(workflows[0]).toBe(mockWorkflow);
    });
    
    test('should return empty array if no workflows found for type', async () => {
      // Arrange
      mockWorkflowRepository.findByUserIdAndType.mockResolvedValue([]);
      
      // Act
      const workflows = await service.getWorkflowsForUserByType('user123', 'NonExistentType');
      
      // Assert
      expect(workflows).toEqual([]);
    });
  });
  
  describe('getActiveWorkflowsForUser', () => {
    test('should retrieve active workflows for a user', async () => {
      // Arrange
      const userId = 'user123';
      
      // Act
      const workflows = await service.getActiveWorkflowsForUser(userId);
      
      // Assert
      expect(mockWorkflowRepository.findActive).toHaveBeenCalledWith(userId);
      expect(workflows).toHaveLength(1);
      expect(workflows[0]).toBe(mockWorkflow);
    });
    
    test('should filter out completed workflows', async () => {
      // Arrange
      const userId = 'user123';
      const completedWorkflow = {
        ...mockWorkflowData,
        id: 'completed-workflow',
        currentStep: 'complete'
      };
      
      mockWorkflowRepository.findActive.mockResolvedValue([
        mockWorkflowData,
        completedWorkflow
      ]);
      
      const mockCompletedWorkflow = {
        ...mockWorkflow,
        id: 'completed-workflow',
        currentStep: 'complete',
        isComplete: jest.fn().mockReturnValue(true)
      };
      
      mockWorkflowEngine.hydrateWorkflow
        .mockReturnValueOnce(mockWorkflow)
        .mockReturnValueOnce(mockCompletedWorkflow);
      
      // Act
      const workflows = await service.getActiveWorkflowsForUser(userId);
      
      // Assert
      expect(mockWorkflowRepository.findActive).toHaveBeenCalledWith(userId);
      expect(workflows).toHaveLength(1);
      expect(workflows[0].id).toBe('workflow-123');
    });
  });
  
  describe('processWorkflowStep', () => {
    test('should process workflow step and save updates', async () => {
      // Arrange
      const workflowId = 'workflow-123';
      const expectedResponse = { success: true, message: 'Step processed' };
      mockWorkflow.processStep.mockResolvedValue(expectedResponse);
      
      // Act
      const result = await service.processWorkflowStep(workflowId);
      
      // Assert
      expect(mockWorkflowRepository.findById).toHaveBeenCalledWith(workflowId);
      expect(mockWorkflow.processStep).toHaveBeenCalled();
      expect(mockWorkflowRepository.save).toHaveBeenCalledWith(
        mockWorkflow.serialize()
      );
      expect(result).toEqual(expectedResponse);
    });
    
    test('should throw error if workflow not found', async () => {
      // Arrange
      mockWorkflowRepository.findById.mockResolvedValue(null);
      
      // Act & Assert
      await expect(service.processWorkflowStep('nonexistent-id'))
        .rejects.toThrow('Workflow not found');
    });
    
    test('should handle errors during step processing', async () => {
      // Arrange
      const workflowId = 'workflow-123';
      const processError = new Error('Step processing failed');
      mockWorkflow.processStep.mockRejectedValue(processError);
      
      // Act & Assert
      await expect(service.processWorkflowStep(workflowId))
        .rejects.toThrow('Error processing workflow step: Step processing failed');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing workflow step'),
        expect.objectContaining({
          error: processError,
          workflowId
        })
      );
      
      // Should not save if processing fails
      expect(mockWorkflowRepository.save).not.toHaveBeenCalled();
    });
  });
  
  describe('processWorkflowInput', () => {
    test('should process user input and save updates', async () => {
      // Arrange
      const workflowId = 'workflow-123';
      const input = { name: 'John Doe' };
      const expectedResponse = { success: true, message: 'Input processed' };
      mockWorkflow.processInput.mockResolvedValue(expectedResponse);
      
      // Act
      const result = await service.processWorkflowInput(workflowId, input);
      
      // Assert
      expect(mockWorkflowRepository.findById).toHaveBeenCalledWith(workflowId);
      expect(mockWorkflow.processInput).toHaveBeenCalledWith(input);
      expect(mockWorkflowRepository.save).toHaveBeenCalledWith(
        mockWorkflow.serialize()
      );
      expect(result).toEqual(expectedResponse);
    });
    
    test('should validate input is provided', async () => {
      // Act & Assert
      await expect(service.processWorkflowInput('workflow-123'))
        .rejects.toThrow('Input is required');
    });
    
    test('should handle errors during input processing', async () => {
      // Arrange
      const workflowId = 'workflow-123';
      const input = { invalid: 'data' };
      const processError = new Error('Invalid input');
      mockWorkflow.processInput.mockRejectedValue(processError);
      
      // Act & Assert
      await expect(service.processWorkflowInput(workflowId, input))
        .rejects.toThrow('Error processing workflow input: Invalid input');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing workflow input'),
        expect.objectContaining({
          error: processError,
          workflowId,
          input
        })
      );
    });
  });
  
  describe('saveWorkflow', () => {
    test('should serialize and save workflow', async () => {
      // Arrange
      
      // Act
      await service.saveWorkflow(mockWorkflow);
      
      // Assert
      expect(mockWorkflow.serialize).toHaveBeenCalled();
      expect(mockWorkflowRepository.save).toHaveBeenCalledWith(
        mockWorkflow.serialize()
      );
    });
    
    test('should handle errors during save', async () => {
      // Arrange
      const saveError = new Error('Database error');
      mockWorkflowRepository.save.mockRejectedValue(saveError);
      
      // Act & Assert
      await expect(service.saveWorkflow(mockWorkflow))
        .rejects.toThrow('Failed to save workflow: Database error');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error saving workflow'),
        expect.objectContaining({
          error: saveError,
          workflowId: mockWorkflow.id
        })
      );
    });
  });
  
  describe('deleteWorkflow', () => {
    test('should delete workflow by id', async () => {
      // Arrange
      const workflowId = 'workflow-123';
      
      // Act
      const result = await service.deleteWorkflow(workflowId);
      
      // Assert
      expect(mockWorkflowRepository.deleteById).toHaveBeenCalledWith(workflowId);
      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Workflow deleted'),
        expect.objectContaining({ workflowId })
      );
    });
    
    test('should handle errors during deletion', async () => {
      // Arrange
      const workflowId = 'workflow-123';
      const deleteError = new Error('Delete failed');
      mockWorkflowRepository.deleteById.mockRejectedValue(deleteError);
      
      // Act & Assert
      await expect(service.deleteWorkflow(workflowId))
        .rejects.toThrow('Failed to delete workflow: Delete failed');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error deleting workflow'),
        expect.objectContaining({
          error: deleteError,
          workflowId
        })
      );
    });
  });
  
  describe('getAvailableWorkflowTypes', () => {
    test('should return list of available workflow types', () => {
      // Act
      const types = service.getAvailableWorkflowTypes();
      
      // Assert
      expect(mockWorkflowEngine.listWorkflowTypes).toHaveBeenCalled();
      expect(types).toEqual(['AccountSetup', 'Survey']);
    });
  });
}); 