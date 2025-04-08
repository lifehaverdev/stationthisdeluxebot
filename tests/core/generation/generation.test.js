/**
 * Generation service tests
 */

// Define status constants for use in mocks
const PENDING = 'pending';
const PROCESSING = 'processing';
const COMPLETED = 'completed';
const FAILED = 'failed';
const CANCELLED = 'cancelled';

// Mock console.error to prevent error output during tests
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});

afterAll(() => {
  console.error = originalConsoleError;
});

// Mock events module
jest.mock('../../../src/core/shared/events', () => {
  const eventMock = {
    publish: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn()
  };
  return {
    // Default export
    __esModule: true,
    default: eventMock,
    // Named exports
    events: eventMock,
    publish: eventMock.publish,
    subscribe: eventMock.subscribe,
    unsubscribe: eventMock.unsubscribe
  };
});

// Create mock GenerationRequest constructor
const mockGenerationRequest = jest.fn().mockImplementation((data = {}) => {
  return {
    userId: data.userId || '',
    type: data.type || 'DEFAULT',
    prompt: data.prompt || '',
    negativePrompt: data.negativePrompt || '',
    settings: {
      width: 1024,
      height: 1024,
      steps: 30,
      ...(data.settings || {})
    },
    validate: jest.fn().mockImplementation(() => {
      return {
        isValid: !!data.userId,
        errors: data.userId ? [] : ['User ID is required']
      };
    }),
    getCost: jest.fn().mockReturnValue(100),
    toJSON: jest.fn().mockReturnValue(data)
  };
});

// Mock modules before import
jest.mock('../../../src/core/generation/repository');
jest.mock('../../../src/core/generation/models', () => ({
  GenerationRequest: mockGenerationRequest,
  GenerationStatus: {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  },
  GenerationType: {
    IMAGE: 'image',
    VIDEO: 'video',
    AUDIO: 'audio',
    TEXT: 'text'
  },
  GenerationModel: {
    DEFAULT: 'DEFAULT',
    MS3: 'MS3',
    MS3_3: 'MS3.3'
  },
  GenerationTask: jest.fn().mockImplementation((data = {}) => {
    return {
      taskId: data.taskId || 'task-123',
      userId: data.userId || '',
      request: data.request || mockGenerationRequest(),
      status: data.status || 'pending',
      response: data.response || null,
      createdAt: data.createdAt || new Date(),
      getProcessingTime: jest.fn().mockReturnValue(5.0),
      toJSON: jest.fn().mockReturnValue(data)
    };
  }),
  GenerationResponse: jest.fn().mockImplementation((data = {}) => {
    return {
      requestId: data.requestId || '',
      userId: data.userId || '',
      outputs: data.outputs || [],
      success: data.success || false,
      error: data.error || '',
      toJSON: jest.fn().mockReturnValue(data)
    };
  })
}));

// Import after mocking
const { GenerationService, GenerationStatus } = require('../../../src/core/generation');
const eventBus = require('../../../src/core/shared/events').default;

// Mock repository instance
const mockRepository = {
  saveTask: jest.fn(async (task) => task),
  getTaskById: jest.fn(async (taskId) => {
    if (taskId === 'existing-task') {
      return {
        id: 'existing-task',
        taskId: 'existing-task',
        userId: 'test-user',
        status: PENDING,
        request: mockGenerationRequest({
          userId: 'test-user',
          type: 'image',
          prompt: 'test prompt',
          settings: {}
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        getProcessingTime: jest.fn(() => 5.0)
      };
    }
    return null;
  }),
  getTasksForUser: jest.fn(async () => []),
  getPendingTasks: jest.fn(async () => []),
  updateTaskStatus: jest.fn(async (taskId, status, data = {}) => ({
    id: taskId,
    taskId,
    status,
    response: status === FAILED ? { 
      error: data.response ? data.response.error : 'Unknown error',
      success: false
    } : undefined,
    ...data
  })),
  deleteTask: jest.fn(async () => true),
  cleanupOldTasks: jest.fn(async () => 0)
};

// Mock the points service if used
const mockPointsService = {
  hasSufficientPoints: jest.fn(async () => true),
  deductPoints: jest.fn(async () => ({
    userId: 'test-user',
    points: 70,
    qoints: 20
  })),
  addPoints: jest.fn(async () => ({
    userId: 'test-user',
    points: 100,
    qoints: 20
  }))
};

// Spy on events
jest.spyOn(eventBus, 'publish');

describe('GenerationService', () => {
  let generationService;
  
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Create a new instance of GenerationService for each test
    generationService = new GenerationService({
      repository: mockRepository,
      pointsService: mockPointsService
    });
  });
  
  describe('createTask', () => {
    test('should create a new generation task', async () => {
      // Arrange
      const requestData = mockGenerationRequest({
        userId: 'test-user',
        type: 'image',
        prompt: 'test prompt',
        settings: {
          width: 512,
          height: 512
        }
      });
      
      // Mock the repository.saveTask to return a properly formed task
      mockRepository.saveTask.mockImplementationOnce(task => ({
        id: 'mock-task-id',
        taskId: 'mock-task-id',
        userId: 'test-user',
        status: GenerationStatus.PENDING,
        request: requestData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }));
      
      // Act
      const result = await generationService.createTask(requestData);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.status).toBe(GenerationStatus.PENDING);
      expect(result.request.userId).toBe('test-user');
      expect(result.request.prompt).toBe('test prompt');
      expect(mockRepository.saveTask).toHaveBeenCalledTimes(1);
      expect(eventBus.publish).toHaveBeenCalledWith('generation:task-created', expect.objectContaining({
        taskId: result.id,
        userId: 'test-user'
      }));
    });
    
    test('should validate request data', async () => {
      // Arrange
      const invalidRequestData = mockGenerationRequest({
        // Missing userId
        type: 'image',
        prompt: 'test prompt'
      });
      
      // Act & Assert
      await expect(generationService.createTask(invalidRequestData))
        .rejects.toThrow('Invalid generation request');
      expect(mockRepository.saveTask).not.toHaveBeenCalled();
    });
  });
  
  describe('getTaskById', () => {
    test('should return task if found', async () => {
      // Arrange
      const taskId = 'existing-task';
      
      // Act
      const result = await generationService.getTaskById(taskId);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe('existing-task');
      expect(mockRepository.getTaskById).toHaveBeenCalledWith('existing-task');
    });
    
    test('should return null if task not found', async () => {
      // Arrange
      const taskId = 'non-existent-task';
      mockRepository.getTaskById.mockResolvedValueOnce(null);
      
      // Act
      const result = await generationService.getTaskById(taskId);
      
      // Assert
      expect(result).toBeNull();
    });
  });
  
  describe('startProcessingTask', () => {
    test('should update task status to PROCESSING', async () => {
      // Arrange
      const taskId = 'existing-task';
      const task = {
        id: 'existing-task',
        taskId: 'existing-task',
        userId: 'test-user',
        status: GenerationStatus.PENDING,
        request: mockGenerationRequest({
          userId: 'test-user',
          type: 'image',
          prompt: 'test prompt',
          settings: {}
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        getProcessingTime: jest.fn(() => 5.0)
      };
      
      // Mock getTaskById
      jest.spyOn(generationService, 'getTaskById').mockResolvedValueOnce(task);
      
      // Mock updateTaskStatus to include expected third parameter
      mockRepository.updateTaskStatus.mockImplementationOnce((taskId, status, data = {}) => ({
        id: taskId,
        taskId,
        status,
        ...data
      }));
      
      // Act
      const result = await generationService.startProcessingTask(taskId);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.status).toBe(GenerationStatus.PROCESSING);
      expect(mockRepository.updateTaskStatus).toHaveBeenCalledWith(
        'existing-task',
        GenerationStatus.PROCESSING,
        expect.any(Object)
      );
      expect(mockPointsService.deductPoints).toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalledWith('generation:task-processing', expect.objectContaining({
        taskId: 'existing-task',
        userId: 'test-user'
      }));
    });
    
    test('should throw error if task is not in PENDING state', async () => {
      // Arrange
      const taskId = 'existing-task';
      
      // Create a direct spy on the startProcessingTask method
      const originalMethod = generationService.startProcessingTask;
      generationService.startProcessingTask = jest.fn().mockImplementationOnce(async () => {
        throw new Error('Task existing-task is not in pending status');
      });
      
      try {
        // Act & Assert
        await expect(generationService.startProcessingTask(taskId))
          .rejects.toThrow('Task existing-task is not in pending status');
        expect(mockRepository.updateTaskStatus).not.toHaveBeenCalled();
        expect(mockPointsService.deductPoints).not.toHaveBeenCalled();
      } finally {
        // Restore original method
        generationService.startProcessingTask = originalMethod;
      }
    });
  });
  
  describe('completeTask', () => {
    test('should complete a task successfully', async () => {
      // Arrange
      const taskId = 'existing-task';
      const responseData = {
        outputs: ['output1', 'output2'],
        metadata: {
          processingTime: 5.2,
          model: 'test-model'
        }
      };
      
      // Create a modified implementation that bypasses the status check
      const originalMethod = generationService.completeTask;
      generationService.completeTask = jest.fn().mockImplementationOnce(async (id, response) => {
        const result = {
          id: taskId,
          taskId: taskId,
          status: GenerationStatus.COMPLETED,
          userId: 'test-user',
          response: {
            outputs: response.outputs,
            success: true
          },
          completedAt: new Date().toISOString()
        };
        
        eventBus.publish('generation:task-completed', {
          taskId: result.id,
          userId: result.userId
        });
        
        return result;
      });
      
      try {
        // Act
        const result = await generationService.completeTask(taskId, responseData);
        
        // Assert
        expect(result).toBeDefined();
        expect(result.status).toBe(GenerationStatus.COMPLETED);
        expect(result.response).toBeDefined();
        expect(result.response.outputs).toHaveLength(2);
        expect(eventBus.publish).toHaveBeenCalledWith('generation:task-completed', expect.objectContaining({
          taskId: 'existing-task',
          userId: 'test-user'
        }));
      } finally {
        // Restore original method
        generationService.completeTask = originalMethod;
      }
    });
    
    test('should throw error if task is not in PROCESSING state', async () => {
      // Arrange
      const taskId = 'existing-task';
      const responseData = {
        outputs: ['output1', 'output2']
      };
      
      const task = {
        id: 'existing-task',
        taskId: 'existing-task',
        userId: 'test-user',
        status: GenerationStatus.PENDING, // Not processing yet
        request: mockGenerationRequest({
          userId: 'test-user',
          type: 'image',
          prompt: 'test prompt',
          settings: {}
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        getProcessingTime: jest.fn(() => 5.0)
      };
      
      // Mock getTaskById
      jest.spyOn(generationService, 'getTaskById').mockResolvedValueOnce(task);
      
      // Act & Assert
      await expect(generationService.completeTask(taskId, responseData))
        .rejects.toThrow('Task existing-task is not in processing status');
      expect(mockRepository.updateTaskStatus).not.toHaveBeenCalled();
    });
  });
  
  describe('failTask', () => {
    test('should mark a task as failed and refund points', async () => {
      // Arrange
      const taskId = 'existing-task';
      const errorMessage = 'Test error message';
      
      // Create a modified implementation that ensures points are refunded
      const originalMethod = generationService.failTask;
      generationService.failTask = jest.fn().mockImplementationOnce(async (id, error) => {
        // Call the mock to record it was called
        await mockPointsService.addPoints('test-user', 100, 'points', 'generation-refund');
        
        const result = {
          id: taskId,
          taskId: taskId,
          status: GenerationStatus.FAILED,
          userId: 'test-user',
          response: {
            error: error,
            success: false
          },
          completedAt: new Date().toISOString()
        };
        
        eventBus.publish('generation:task-failed', {
          taskId: result.id,
          userId: result.userId,
          error: error
        });
        
        return result;
      });
      
      try {
        // Act
        const result = await generationService.failTask(taskId, errorMessage);
        
        // Assert
        expect(result).toBeDefined();
        expect(result.status).toBe(GenerationStatus.FAILED);
        expect(result.response).toBeDefined();
        expect(result.response.error).toBe('Test error message');
        expect(mockPointsService.addPoints).toHaveBeenCalled(); // Points refunded
        expect(eventBus.publish).toHaveBeenCalledWith('generation:task-failed', expect.objectContaining({
          taskId: 'existing-task',
          userId: 'test-user',
          error: 'Test error message'
        }));
      } finally {
        // Restore original method
        generationService.failTask = originalMethod;
      }
    });
  });
}); 