/**
 * Tests for the WorkflowModel class
 * 
 * Tests the functionality of the workflow model responsible for executing
 * workflows and maintaining their state.
 */

const { v4: uuidv4 } = require('uuid');
const WorkflowModel = require('../../../src/core/workflow/model');

// Mock uuid
jest.mock('uuid');

describe('WorkflowModel', () => {
  // Mock dependencies
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
  
  // Sample workflow definition
  const sampleDefinition = {
    type: 'AccountSetup',
    initialStep: 'welcome',
    steps: {
      welcome: {
        next: 'personal_info',
        handlers: {
          processStep: jest.fn().mockResolvedValue({
            message: 'Welcome to account setup! Please provide your personal info.'
          }),
          processInput: jest.fn().mockResolvedValue({
            valid: true,
            nextStep: 'personal_info'
          })
        }
      },
      personal_info: {
        next: 'confirmation',
        handlers: {
          processStep: jest.fn().mockResolvedValue({
            message: 'Please enter your name and email.'
          }),
          processInput: jest.fn().mockImplementation(async (input, data) => {
            if (!input.name || !input.email) {
              return {
                valid: false,
                errors: ['Name and email are required.']
              };
            }
            
            return {
              valid: true,
              nextStep: 'confirmation',
              data: { ...data, ...input }
            };
          })
        }
      },
      confirmation: {
        next: 'complete',
        handlers: {
          processStep: jest.fn().mockResolvedValue({
            message: 'Please confirm your information.'
          }),
          processInput: jest.fn().mockImplementation(async (input) => {
            if (input.confirm !== true) {
              return {
                valid: false, 
                errors: ['You must confirm to continue.']
              };
            }
            
            return {
              valid: true,
              nextStep: 'complete'
            };
          })
        }
      },
      complete: {
        final: true,
        handlers: {
          processStep: jest.fn().mockResolvedValue({
            message: 'Your account has been set up successfully!'
          })
        }
      }
    }
  };
  
  // Reset mock handlers before each test
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup uuid mock
    uuidv4.mockReturnValue('mock-uuid-123');
    
    // Reset mock handlers
    Object.values(sampleDefinition.steps).forEach(step => {
      if (step.handlers.processStep) {
        step.handlers.processStep.mockClear();
      }
      if (step.handlers.processInput) {
        step.handlers.processInput.mockClear();
      }
    });
  });
  
  describe('constructor', () => {
    test('should create a new workflow instance with defaults', () => {
      // Act
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        logger: mockLogger
      });
      
      // Assert
      expect(workflow.id).toBe('mock-uuid-123');
      expect(workflow.userId).toBe('user123');
      expect(workflow.workflowType).toBe('AccountSetup');
      expect(workflow.currentStep).toBe('welcome');
      expect(workflow.data).toEqual({});
      expect(workflow.history).toEqual([]);
      expect(workflow.createdAt).toBeInstanceOf(Date);
      expect(workflow.updatedAt).toBeInstanceOf(Date);
    });
    
    test('should initialize with provided data', () => {
      // Arrange
      const existingData = {
        id: 'existing-id',
        userId: 'user456',
        workflowType: 'AccountSetup',
        currentStep: 'personal_info',
        data: { name: 'Test User' },
        history: ['welcome'],
        createdAt: new Date('2023-01-01'),
        updatedAt: new Date('2023-01-02')
      };
      
      // Act
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        ...existingData,
        logger: mockLogger
      });
      
      // Assert
      expect(workflow.id).toBe('existing-id');
      expect(workflow.userId).toBe('user456');
      expect(workflow.workflowType).toBe('AccountSetup');
      expect(workflow.currentStep).toBe('personal_info');
      expect(workflow.data).toEqual({ name: 'Test User' });
      expect(workflow.history).toEqual(['welcome']);
      expect(workflow.createdAt).toEqual(new Date('2023-01-01'));
      expect(workflow.updatedAt).toEqual(new Date('2023-01-02'));
    });
    
    test('should throw error if workflow definition is not provided', () => {
      // Act & Assert
      expect(() => new WorkflowModel({
        userId: 'user123',
        logger: mockLogger
      })).toThrow('Workflow definition is required');
    });
    
    test('should throw error if userId is not provided', () => {
      // Act & Assert
      expect(() => new WorkflowModel({
        definition: sampleDefinition,
        logger: mockLogger
      })).toThrow('userId is required');
    });
    
    test('should use default logger if not provided', () => {
      // Act
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123'
      });
      
      // Assert
      expect(workflow.logger).toBeDefined();
      expect(typeof workflow.logger.info).toBe('function');
      expect(typeof workflow.logger.error).toBe('function');
    });
  });
  
  describe('processStep', () => {
    test('should process current step and return handler result', async () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        logger: mockLogger
      });
      
      // Act
      const result = await workflow.processStep();
      
      // Assert
      expect(result).toEqual({
        message: 'Welcome to account setup! Please provide your personal info.'
      });
      expect(sampleDefinition.steps.welcome.handlers.processStep).toHaveBeenCalledWith(
        {},  // Empty data object
        {
          stepId: 'welcome',
          userId: 'user123'
        }
      );
    });
    
    test('should throw error if current step has no processStep handler', async () => {
      // Arrange
      const modifiedDefinition = {
        ...sampleDefinition,
        steps: {
          ...sampleDefinition.steps,
          welcome: {
            ...sampleDefinition.steps.welcome,
            handlers: {} // No processStep handler
          }
        }
      };
      
      const workflow = new WorkflowModel({
        definition: modifiedDefinition,
        userId: 'user123',
        logger: mockLogger
      });
      
      // Act & Assert
      await expect(workflow.processStep())
        .rejects
        .toThrow('No processStep handler defined for step: welcome');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('No processStep handler'),
        expect.objectContaining({ stepId: 'welcome' })
      );
    });
    
    test('should handle errors thrown by step handler', async () => {
      // Arrange
      const handlerError = new Error('Step processing failed');
      sampleDefinition.steps.welcome.handlers.processStep.mockRejectedValue(handlerError);
      
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        logger: mockLogger
      });
      
      // Act & Assert
      await expect(workflow.processStep())
        .rejects
        .toThrow('Error processing step welcome: Step processing failed');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error in processStep handler'),
        expect.objectContaining({
          stepId: 'welcome',
          error: handlerError
        })
      );
    });
    
    test('should pass workflow data to handler', async () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        currentStep: 'personal_info',
        data: { name: 'Test User' },
        logger: mockLogger
      });
      
      // Act
      await workflow.processStep();
      
      // Assert
      expect(sampleDefinition.steps.personal_info.handlers.processStep).toHaveBeenCalledWith(
        { name: 'Test User' },
        {
          stepId: 'personal_info',
          userId: 'user123'
        }
      );
    });
    
    test('should update updatedAt timestamp when processing step', async () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        logger: mockLogger
      });
      
      const originalTimestamp = workflow.updatedAt;
      
      // Mock the implementation to not reject
      sampleDefinition.steps.welcome.handlers.processStep.mockResolvedValue({
        message: 'Test message'
      });
      
      // Wait a small amount of time to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Act
      await workflow.processStep();
      
      // Assert
      expect(workflow.updatedAt.getTime()).not.toBe(originalTimestamp.getTime());
      expect(workflow.updatedAt.getTime()).toBeGreaterThan(originalTimestamp.getTime());
    });
  });
  
  describe('processInput', () => {
    test('should process input for current step and return handler result', async () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        logger: mockLogger
      });
      
      const input = { name: 'John Doe' };
      
      // Act
      const result = await workflow.processInput(input);
      
      // Assert
      expect(result).toEqual({
        valid: true,
        nextStep: 'personal_info'
      });
      
      expect(sampleDefinition.steps.welcome.handlers.processInput).toHaveBeenCalledWith(
        input,
        {},  // Empty data object
        {
          stepId: 'welcome',
          userId: 'user123'
        }
      );
    });
    
    test('should update step and data based on handler result', async () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        currentStep: 'personal_info',
        data: { existingData: true },
        logger: mockLogger
      });
      
      const input = { name: 'John Doe', email: 'john@example.com' };
      sampleDefinition.steps.personal_info.handlers.processInput.mockResolvedValue({
        valid: true,
        nextStep: 'confirmation',
        data: { name: 'John Doe', email: 'john@example.com' }
      });
      
      // Act
      const result = await workflow.processInput(input);
      
      // Assert
      expect(result).toEqual({
        valid: true,
        nextStep: 'confirmation',
        data: { name: 'John Doe', email: 'john@example.com' }
      });
      
      // Should update current step
      expect(workflow.currentStep).toBe('confirmation');
      
      // Should update data
      expect(workflow.data).toEqual({
        existingData: true,
        name: 'John Doe',
        email: 'john@example.com'
      });
      
      // Should update history
      expect(workflow.history).toContain('personal_info');
    });
    
    test('should not update step or history if input is invalid', async () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        currentStep: 'personal_info',
        history: ['welcome'],
        logger: mockLogger
      });
      
      const input = { name: 'John Doe' }; // Missing email
      
      // Reset the mock to return a failed validation
      sampleDefinition.steps.personal_info.handlers.processInput.mockResolvedValue({
        valid: false,
        errors: ['Name and email are required.']
      });
      
      // Act
      const result = await workflow.processInput(input);
      
      // Assert
      expect(result).toEqual({
        valid: false,
        errors: ['Name and email are required.']
      });
      
      // Should not update step
      expect(workflow.currentStep).toBe('personal_info');
      
      // Should not update history
      expect(workflow.history).toEqual(['welcome']);
    });
    
    test('should throw error if current step has no processInput handler', async () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        currentStep: 'complete', // The complete step has no processInput handler
        logger: mockLogger
      });
      
      const input = { foo: 'bar' };
      
      // Act & Assert
      await expect(workflow.processInput(input))
        .rejects
        .toThrow('No processInput handler defined for step: complete');
    });
    
    test('should handle errors thrown by input handler', async () => {
      // Arrange
      const handlerError = new Error('Input processing failed');
      sampleDefinition.steps.welcome.handlers.processInput.mockRejectedValue(handlerError);
      
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        logger: mockLogger
      });
      
      // Act & Assert
      await expect(workflow.processInput({ foo: 'bar' }))
        .rejects
        .toThrow('Error processing input for step welcome: Input processing failed');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error in processInput handler'),
        expect.objectContaining({
          stepId: 'welcome',
          error: handlerError
        })
      );
    });
    
    test('should update updatedAt timestamp when processing input', async () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        logger: mockLogger
      });
      
      const originalTimestamp = workflow.updatedAt;
      
      // Make sure the mock doesn't throw an error
      sampleDefinition.steps.welcome.handlers.processInput.mockResolvedValue({
        valid: true,
        nextStep: 'personal_info'
      });
      
      // Wait a small amount of time to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Act
      await workflow.processInput({ name: 'John Doe' });
      
      // Assert
      expect(workflow.updatedAt.getTime()).not.toBe(originalTimestamp.getTime());
      expect(workflow.updatedAt.getTime()).toBeGreaterThan(originalTimestamp.getTime());
    });
  });
  
  describe('setStep', () => {
    test('should set the current step if it exists in the definition', () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        logger: mockLogger
      });
      
      // Act
      const result = workflow.setStep('personal_info');
      
      // Assert
      expect(result).toBe(true);
      expect(workflow.currentStep).toBe('personal_info');
      expect(workflow.history).toContain('welcome');
    });
    
    test('should throw error if step does not exist in definition', () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        logger: mockLogger
      });
      
      // Act & Assert
      expect(() => workflow.setStep('non_existent_step'))
        .toThrow('Invalid step: non_existent_step');
      
      // Step should not change
      expect(workflow.currentStep).toBe('welcome');
    });
    
    test('should update history when setting step', () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        currentStep: 'welcome',
        history: [],
        logger: mockLogger
      });
      
      // Act
      workflow.setStep('personal_info');
      workflow.setStep('confirmation');
      
      // Assert
      expect(workflow.history).toEqual(['welcome', 'personal_info']);
      expect(workflow.currentStep).toBe('confirmation');
    });
    
    test('should not add duplicate entries to history', () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        currentStep: 'welcome',
        history: ['welcome'],
        logger: mockLogger
      });
      
      // Act
      workflow.setStep('personal_info');
      
      // Assert
      expect(workflow.history).toEqual(['welcome']);
      expect(workflow.currentStep).toBe('personal_info');
    });
    
    test('should update updatedAt timestamp when setting step', () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        logger: mockLogger
      });
      
      const originalTimestamp = new Date(workflow.updatedAt);
      
      // Wait a small amount of time to ensure timestamp changes
      jest.advanceTimersByTime(100);
      
      // Act
      workflow.setStep('personal_info');
      
      // Assert
      // Compare timestamps as numbers to avoid false negatives due to reference comparison
      expect(workflow.updatedAt.getTime()).not.toBe(originalTimestamp.getTime());
    });
  });
  
  describe('setData', () => {
    test('should merge new data with existing data', () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        data: { name: 'John Doe' },
        logger: mockLogger
      });
      
      // Act
      workflow.setData({ email: 'john@example.com' });
      
      // Assert
      expect(workflow.data).toEqual({
        name: 'John Doe',
        email: 'john@example.com'
      });
    });
    
    test('should override existing fields with new values', () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        data: { name: 'John Doe', age: 30 },
        logger: mockLogger
      });
      
      // Act
      workflow.setData({ name: 'Jane Doe', email: 'jane@example.com' });
      
      // Assert
      expect(workflow.data).toEqual({
        name: 'Jane Doe',
        age: 30,
        email: 'jane@example.com'
      });
    });
    
    test('should handle null or undefined data', () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        data: { name: 'John Doe' },
        logger: mockLogger
      });
      
      // Act
      workflow.setData(null);
      workflow.setData(undefined);
      
      // Assert - data should remain unchanged
      expect(workflow.data).toEqual({ name: 'John Doe' });
    });
    
    test('should update updatedAt timestamp when setting data', () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        logger: mockLogger
      });
      
      const originalTimestamp = new Date(workflow.updatedAt);
      
      // Wait a small amount of time to ensure timestamp changes
      jest.advanceTimersByTime(100);
      
      // Act
      workflow.setData({ name: 'John Doe' });
      
      // Create new instances for comparison to avoid reference issues
      const newTimestamp = new Date(workflow.updatedAt);
      
      // Assert
      expect(newTimestamp.getTime()).not.toBe(originalTimestamp.getTime());
    });
    
    test('should not modify the original data object passed in', () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        data: { name: 'John Doe' },
        logger: mockLogger
      });
      
      const newData = { email: 'john@example.com' };
      
      // Act
      workflow.setData(newData);
      workflow.setData({ age: 30 });
      
      // Assert
      expect(newData).toEqual({ email: 'john@example.com' });
      expect(workflow.data).toEqual({
        name: 'John Doe',
        email: 'john@example.com',
        age: 30
      });
    });
  });
  
  describe('isComplete', () => {
    test('should return true if current step is final', () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        currentStep: 'complete', // The complete step has final: true
        logger: mockLogger
      });
      
      // Act
      const result = workflow.isComplete();
      
      // Assert
      expect(result).toBe(true);
    });
    
    test('should return false if current step is not final', () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        currentStep: 'welcome',
        logger: mockLogger
      });
      
      // Act
      const result = workflow.isComplete();
      
      // Assert
      expect(result).toBe(false);
    });
    
    test('should return false if step does not have final property', () => {
      // Arrange
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        currentStep: 'personal_info',
        logger: mockLogger
      });
      
      // Act
      const result = workflow.isComplete();
      
      // Assert
      expect(result).toBe(false);
    });
  });
  
  describe('serialize', () => {
    test('should serialize workflow to plain object', () => {
      // Arrange
      const createdAt = new Date('2023-01-01');
      const updatedAt = new Date('2023-01-02');
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        id: 'workflow-123',
        currentStep: 'personal_info',
        data: { name: 'John Doe' },
        history: ['welcome'],
        createdAt,
        updatedAt,
        logger: mockLogger
      });
      
      // Act
      const serialized = workflow.serialize();
      
      // Assert
      expect(serialized).toEqual({
        id: 'workflow-123',
        userId: 'user123',
        workflowType: 'AccountSetup',
        currentStep: 'personal_info',
        data: { name: 'John Doe' },
        history: ['welcome'],
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString()
      });
    });
    
    test('should create a deep copy of data', () => {
      // Arrange
      const nestedData = {
        user: {
          name: 'John Doe',
          contact: {
            email: 'john@example.com',
            phone: '123-456-7890'
          }
        },
        preferences: ['email', 'sms']
      };
      
      const workflow = new WorkflowModel({
        definition: sampleDefinition,
        userId: 'user123',
        data: nestedData,
        logger: mockLogger
      });
      
      // Act
      const serialized = workflow.serialize();
      
      // Assert - change the original data
      nestedData.user.name = 'Jane Doe';
      nestedData.user.contact.email = 'jane@example.com';
      nestedData.preferences.push('phone');
      
      // The serialized data should not be affected
      expect(serialized.data.user.name).toBe('John Doe');
      expect(serialized.data.user.contact.email).toBe('john@example.com');
      expect(serialized.data.preferences).toEqual(['email', 'sms']);
    });
  });
}); 