/**
 * Workflow Repository Tests
 * 
 * Tests the functionality of the workflow repository responsible for 
 * storing and retrieving workflow instances.
 */

const { v4: uuidv4 } = require('uuid');
jest.mock('uuid');

const WorkflowRepository = require('../../../src/core/workflow/repository');
const { AppError } = require('../../../src/core/shared/errors');

describe('WorkflowRepository', () => {
  // Mock dependencies
  const mockDatabase = {
    query: jest.fn(),
    one: jest.fn(),
    oneOrNone: jest.fn(),
    manyOrNone: jest.fn(),
    none: jest.fn(),
    tx: jest.fn()
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
  
  let workflowRepository;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup UUID mock to return predictable values
    uuidv4.mockReturnValue('mocked-uuid');
    
    workflowRepository = new WorkflowRepository({
      db: mockDatabase,
      logger: mockLogger
    });
  });
  
  describe('constructor', () => {
    test('should initialize with provided dependencies', () => {
      // Assert
      expect(workflowRepository.db).toBe(mockDatabase);
      expect(workflowRepository.logger).toBe(mockLogger);
    });
    
    test('should throw error if database is not provided', () => {
      // Act & Assert
      expect(() => new WorkflowRepository({
        logger: mockLogger
      })).toThrow('Database is required');
    });
  });
  
  describe('createWorkflow', () => {
    test('should create a new workflow and return its ID', async () => {
      // Arrange
      const workflowData = {
        type: 'AccountSetup',
        userId: 'user123',
        platform: 'telegram',
        data: { step: 'start' }
      };
      
      mockDatabase.one.mockResolvedValue({ id: 'wf123' });
      
      // Act
      const result = await workflowRepository.createWorkflow(workflowData);
      
      // Assert
      expect(result).toBe('wf123');
      expect(mockDatabase.one).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO workflows'),
        {
          id: 'mocked-uuid',
          type: 'AccountSetup',
          userId: 'user123',
          platform: 'telegram',
          data: JSON.stringify({ step: 'start' }),
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
          expiresAt: expect.any(Date)
        }
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Created new workflow'),
        expect.objectContaining({ id: 'wf123', type: 'AccountSetup', userId: 'user123' })
      );
    });
    
    test('should throw error if database operation fails', async () => {
      // Arrange
      const workflowData = {
        type: 'AccountSetup',
        userId: 'user123'
      };
      
      mockDatabase.one.mockRejectedValue(new Error('Database error'));
      
      // Act & Assert
      await expect(workflowRepository.createWorkflow(workflowData))
        .rejects.toThrow('Failed to create workflow: Database error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
    
    test('should throw error if required parameters are missing', async () => {
      // Arrange
      const invalidData = {
        userId: 'user123'
        // Missing type
      };
      
      // Act & Assert
      await expect(workflowRepository.createWorkflow(invalidData))
        .rejects.toThrow('Workflow type is required');
        
      await expect(workflowRepository.createWorkflow({ type: 'Test' }))
        .rejects.toThrow('User ID is required');
    });
  });
  
  describe('getWorkflowById', () => {
    test('should return workflow by ID', async () => {
      // Arrange
      const workflowId = 'wf123';
      const mockWorkflow = {
        id: workflowId,
        type: 'AccountSetup',
        user_id: 'user123',
        platform: 'telegram',
        data: JSON.stringify({ currentStep: 'form' }),
        created_at: new Date(),
        updated_at: new Date(),
        expires_at: new Date()
      };
      
      mockDatabase.oneOrNone.mockResolvedValue(mockWorkflow);
      
      // Act
      const result = await workflowRepository.getWorkflowById(workflowId);
      
      // Assert
      expect(result).toEqual({
        id: workflowId,
        type: 'AccountSetup',
        userId: 'user123',
        platform: 'telegram',
        data: { currentStep: 'form' },
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        expiresAt: expect.any(Date)
      });
      expect(mockDatabase.oneOrNone).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM workflows WHERE id = $1'),
        [workflowId]
      );
    });
    
    test('should return null if workflow not found', async () => {
      // Arrange
      const workflowId = 'nonexistent';
      mockDatabase.oneOrNone.mockResolvedValue(null);
      
      // Act
      const result = await workflowRepository.getWorkflowById(workflowId);
      
      // Assert
      expect(result).toBeNull();
    });
    
    test('should throw error if database operation fails', async () => {
      // Arrange
      mockDatabase.oneOrNone.mockRejectedValue(new Error('Database error'));
      
      // Act & Assert
      await expect(workflowRepository.getWorkflowById('wf123'))
        .rejects.toThrow('Failed to get workflow: Database error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
  
  describe('getUserWorkflows', () => {
    test('should return active workflows for user', async () => {
      // Arrange
      const userId = 'user123';
      const mockWorkflows = [
        {
          id: 'wf1',
          type: 'AccountSetup',
          user_id: userId,
          platform: 'telegram',
          data: JSON.stringify({ step: 'form' }),
          created_at: new Date(),
          updated_at: new Date(),
          expires_at: new Date()
        },
        {
          id: 'wf2',
          type: 'PointsTransfer',
          user_id: userId,
          platform: 'web',
          data: JSON.stringify({ amount: 100 }),
          created_at: new Date(),
          updated_at: new Date(),
          expires_at: new Date()
        }
      ];
      
      mockDatabase.manyOrNone.mockResolvedValue(mockWorkflows);
      
      // Act
      const result = await workflowRepository.getUserWorkflows({ userId });
      
      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('wf1');
      expect(result[0].type).toBe('AccountSetup');
      expect(result[0].userId).toBe(userId);
      expect(result[0].data).toEqual({ step: 'form' });
      
      expect(result[1].id).toBe('wf2');
      expect(result[1].type).toBe('PointsTransfer');
      
      expect(mockDatabase.manyOrNone).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM workflows WHERE user_id = $1'),
        [userId]
      );
    });
    
    test('should filter by platform if provided', async () => {
      // Arrange
      const userId = 'user123';
      const platform = 'telegram';
      
      mockDatabase.manyOrNone.mockResolvedValue([]);
      
      // Act
      await workflowRepository.getUserWorkflows({ userId, platform });
      
      // Assert
      expect(mockDatabase.manyOrNone).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1 AND platform = $2'),
        [userId, platform]
      );
    });
    
    test('should filter by type if provided', async () => {
      // Arrange
      const userId = 'user123';
      const type = 'AccountSetup';
      
      mockDatabase.manyOrNone.mockResolvedValue([]);
      
      // Act
      await workflowRepository.getUserWorkflows({ userId, type });
      
      // Assert
      expect(mockDatabase.manyOrNone).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1 AND type = $2'),
        [userId, type]
      );
    });
    
    test('should return empty array if no workflows found', async () => {
      // Arrange
      mockDatabase.manyOrNone.mockResolvedValue([]);
      
      // Act
      const result = await workflowRepository.getUserWorkflows({ userId: 'user123' });
      
      // Assert
      expect(result).toEqual([]);
    });
    
    test('should throw error if database operation fails', async () => {
      // Arrange
      mockDatabase.manyOrNone.mockRejectedValue(new Error('Database error'));
      
      // Act & Assert
      await expect(workflowRepository.getUserWorkflows({ userId: 'user123' }))
        .rejects.toThrow('Failed to get user workflows: Database error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
    
    test('should throw error if userId is not provided', async () => {
      // Act & Assert
      await expect(workflowRepository.getUserWorkflows({}))
        .rejects.toThrow('User ID is required');
    });
  });
  
  describe('updateWorkflow', () => {
    test('should update workflow data', async () => {
      // Arrange
      const workflowId = 'wf123';
      const updateData = {
        data: { currentStep: 'confirmation', formData: { name: 'Test' } }
      };
      
      mockDatabase.oneOrNone.mockResolvedValue({ id: workflowId });
      
      // Act
      const result = await workflowRepository.updateWorkflow(workflowId, updateData);
      
      // Assert
      expect(result).toBe(true);
      expect(mockDatabase.oneOrNone).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE workflows SET'),
        {
          id: workflowId,
          data: JSON.stringify(updateData.data),
          updatedAt: expect.any(Date)
        }
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Updated workflow'),
        expect.objectContaining({ id: workflowId })
      );
    });
    
    test('should return false if workflow not found', async () => {
      // Arrange
      mockDatabase.oneOrNone.mockResolvedValue(null);
      
      // Act
      const result = await workflowRepository.updateWorkflow('nonexistent', { data: {} });
      
      // Assert
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Workflow not found for update'),
        expect.objectContaining({ id: 'nonexistent' })
      );
    });
    
    test('should throw error if database operation fails', async () => {
      // Arrange
      mockDatabase.oneOrNone.mockRejectedValue(new Error('Database error'));
      
      // Act & Assert
      await expect(workflowRepository.updateWorkflow('wf123', { data: {} }))
        .rejects.toThrow('Failed to update workflow: Database error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
  
  describe('deleteWorkflow', () => {
    test('should delete workflow by ID', async () => {
      // Arrange
      const workflowId = 'wf123';
      mockDatabase.oneOrNone.mockResolvedValue({ id: workflowId });
      
      // Act
      const result = await workflowRepository.deleteWorkflow(workflowId);
      
      // Assert
      expect(result).toBe(true);
      expect(mockDatabase.oneOrNone).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM workflows WHERE id = $1 RETURNING id'),
        [workflowId]
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deleted workflow'),
        expect.objectContaining({ id: workflowId })
      );
    });
    
    test('should return false if workflow not found', async () => {
      // Arrange
      mockDatabase.oneOrNone.mockResolvedValue(null);
      
      // Act
      const result = await workflowRepository.deleteWorkflow('nonexistent');
      
      // Assert
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Workflow not found for deletion'),
        expect.objectContaining({ id: 'nonexistent' })
      );
    });
    
    test('should throw error if database operation fails', async () => {
      // Arrange
      mockDatabase.oneOrNone.mockRejectedValue(new Error('Database error'));
      
      // Act & Assert
      await expect(workflowRepository.deleteWorkflow('wf123'))
        .rejects.toThrow('Failed to delete workflow: Database error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
  
  describe('deleteUserWorkflows', () => {
    test('should delete all workflows for a user', async () => {
      // Arrange
      const userId = 'user123';
      mockDatabase.manyOrNone.mockResolvedValue([{ id: 'wf1' }, { id: 'wf2' }]);
      
      // Act
      const result = await workflowRepository.deleteUserWorkflows({ userId });
      
      // Assert
      expect(result).toBe(2);
      expect(mockDatabase.manyOrNone).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM workflows WHERE user_id = $1 RETURNING id'),
        [userId]
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Deleted 2 workflows for user'),
        expect.objectContaining({ userId })
      );
    });
    
    test('should filter by platform if provided', async () => {
      // Arrange
      const userId = 'user123';
      const platform = 'telegram';
      mockDatabase.manyOrNone.mockResolvedValue([{ id: 'wf1' }]);
      
      // Act
      await workflowRepository.deleteUserWorkflows({ userId, platform });
      
      // Assert
      expect(mockDatabase.manyOrNone).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1 AND platform = $2'),
        [userId, platform]
      );
    });
    
    test('should filter by type if provided', async () => {
      // Arrange
      const userId = 'user123';
      const type = 'AccountSetup';
      mockDatabase.manyOrNone.mockResolvedValue([]);
      
      // Act
      await workflowRepository.deleteUserWorkflows({ userId, type });
      
      // Assert
      expect(mockDatabase.manyOrNone).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1 AND type = $2'),
        [userId, type]
      );
    });
    
    test('should return 0 if no workflows found', async () => {
      // Arrange
      mockDatabase.manyOrNone.mockResolvedValue([]);
      
      // Act
      const result = await workflowRepository.deleteUserWorkflows({ userId: 'user123' });
      
      // Assert
      expect(result).toBe(0);
    });
    
    test('should throw error if database operation fails', async () => {
      // Arrange
      mockDatabase.manyOrNone.mockRejectedValue(new Error('Database error'));
      
      // Act & Assert
      await expect(workflowRepository.deleteUserWorkflows({ userId: 'user123' }))
        .rejects.toThrow('Failed to delete user workflows: Database error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
    
    test('should throw error if userId is not provided', async () => {
      // Act & Assert
      await expect(workflowRepository.deleteUserWorkflows({}))
        .rejects.toThrow('User ID is required');
    });
  });
  
  describe('cleanupExpiredWorkflows', () => {
    test('should delete expired workflows', async () => {
      // Arrange
      mockDatabase.manyOrNone.mockResolvedValue([
        { id: 'wf1', user_id: 'user1' },
        { id: 'wf2', user_id: 'user2' }
      ]);
      
      // Act
      const result = await workflowRepository.cleanupExpiredWorkflows();
      
      // Assert
      expect(result).toBe(2);
      expect(mockDatabase.manyOrNone).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM workflows WHERE expires_at < $1 RETURNING id, user_id'),
        [expect.any(Date)]
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up 2 expired workflows')
      );
    });
    
    test('should return 0 if no expired workflows', async () => {
      // Arrange
      mockDatabase.manyOrNone.mockResolvedValue([]);
      
      // Act
      const result = await workflowRepository.cleanupExpiredWorkflows();
      
      // Assert
      expect(result).toBe(0);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('No expired workflows to clean up')
      );
    });
    
    test('should throw error if database operation fails', async () => {
      // Arrange
      mockDatabase.manyOrNone.mockRejectedValue(new Error('Database error'));
      
      // Act & Assert
      await expect(workflowRepository.cleanupExpiredWorkflows())
        .rejects.toThrow('Failed to clean up expired workflows: Database error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
}); 