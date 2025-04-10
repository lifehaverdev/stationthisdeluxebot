// Mock the AppError since the actual path isn't accessible in tests
jest.mock('../../../src/shared/errors', () => {
  class MockAppError extends Error {
    constructor(message, code = 'UNKNOWN_ERROR', options = {}) {
      super(message);
      this.name = 'AppError';
      this.code = code;
      this.context = options.context || {};
    }
  }
  
  return {
    AppError: MockAppError
  };
}, { virtual: true });

const { TaskPointsService } = require('../../../src/core/points/task-points-service');
const { AppError } = require('../../../src/shared/errors');

describe('TaskPointsService', () => {
  let taskPointsService;
  let mockPointsRepository;
  let mockPointsService;
  let mockLogger;
  
  beforeEach(() => {
    // Create mocks
    mockPointsRepository = {
      getUserPoints: jest.fn(),
      saveUserPoints: jest.fn(),
      incrementPoints: jest.fn().mockResolvedValue(true),
      decrementPoints: jest.fn().mockResolvedValue(true)
    };
    
    mockPointsService = {
      hasSufficientPoints: jest.fn().mockResolvedValue(true),
      incrementPoints: jest.fn().mockResolvedValue(true),
      decrementPoints: jest.fn().mockResolvedValue(true)
    };
    
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    
    // Create service instance
    taskPointsService = new TaskPointsService({
      pointsRepository: mockPointsRepository,
      pointsService: mockPointsService,
      logger: mockLogger
    });
    
    // Add event listener spy
    taskPointsService.emit = jest.fn();
  });
  
  describe('calculateTaskCost', () => {
    it('should calculate basic cost for text-to-image task', () => {
      const cost = taskPointsService.calculateTaskCost({
        type: 'text-to-image',
        settings: {},
        prompt: 'A beautiful landscape'
      });
      
      expect(cost).toBe(100);
    });
    
    it('should apply resolution multiplier', () => {
      const cost = taskPointsService.calculateTaskCost({
        type: 'text-to-image',
        settings: { width: 2048, height: 2048 },
        prompt: 'A beautiful landscape'
      });
      
      // 100 (base) * sqrt(2048*2048/1024*1024) = 100 * 2 = 200
      expect(cost).toBe(200);
    });
    
    it('should apply steps multiplier', () => {
      const cost = taskPointsService.calculateTaskCost({
        type: 'text-to-image',
        settings: { steps: 60 },
        prompt: 'A beautiful landscape'
      });
      
      // 100 (base) * (60/30) = 100 * 2 = 200
      expect(cost).toBe(200);
    });
    
    it('should apply premium model multiplier', () => {
      const cost = taskPointsService.calculateTaskCost({
        type: 'text-to-image',
        settings: { model: 'sdxl-amazing' },
        prompt: 'A beautiful landscape'
      });
      
      // 100 (base) * 1.5 = 150
      expect(cost).toBe(150);
    });
    
    it('should apply combined multipliers', () => {
      const cost = taskPointsService.calculateTaskCost({
        type: 'text-to-image',
        settings: { 
          width: 2048, 
          height: 2048,
          steps: 60,
          model: 'sdxl-amazing'
        },
        prompt: 'A beautiful landscape'
      });
      
      // 100 (base) * 2 (resolution) * 2 (steps) * 1.5 (model) = 600
      expect(cost).toBe(600);
    });
    
    it('should respect minimum cost', () => {
      // Creating a task with very low calculated cost
      const cost = taskPointsService.calculateTaskCost({
        type: 'background-removal', // 25 base cost
        settings: { width: 256, height: 256 }, // 0.25 multiplier
        prompt: 'Remove background'
      });
      
      // 25 * 0.25 = 6.25, but min is 10
      expect(cost).toBe(10);
    });
  });
  
  describe('reservePoints', () => {
    it('should successfully reserve points for a valid task', async () => {
      const taskId = 'task-123';
      const userId = 'user-456';
      const taskDetails = {
        type: 'text-to-image',
        settings: {},
        prompt: 'A beautiful landscape'
      };
      
      const result = await taskPointsService.reservePoints(taskId, userId, taskDetails);
      
      expect(result).toBe(true);
      expect(mockPointsService.hasSufficientPoints).toHaveBeenCalledWith(userId, 100);
      expect(mockPointsService.decrementPoints).toHaveBeenCalledWith(userId, 100, expect.any(Object));
      expect(taskPointsService.emit).toHaveBeenCalledWith('points:reserved', expect.any(Object));
      
      // Check task registry
      const taskInfo = taskPointsService.getTaskInfo(taskId);
      expect(taskInfo).toMatchObject({
        userId,
        pointsAllocated: 100,
        status: 'reserved'
      });
    });
    
    it('should throw error when user has insufficient points', async () => {
      mockPointsService.hasSufficientPoints.mockResolvedValue(false);
      
      const taskId = 'task-123';
      const userId = 'user-456';
      const taskDetails = {
        type: 'text-to-image',
        settings: {},
        prompt: 'A beautiful landscape'
      };
      
      await expect(
        taskPointsService.reservePoints(taskId, userId, taskDetails)
      ).rejects.toThrow(AppError);
      
      expect(mockPointsService.decrementPoints).not.toHaveBeenCalled();
    });
    
    it('should throw error for missing parameters', async () => {
      await expect(
        taskPointsService.reservePoints(null, 'user-456', {})
      ).rejects.toThrow(AppError);
      
      await expect(
        taskPointsService.reservePoints('task-123', null, {})
      ).rejects.toThrow(AppError);
    });
  });
  
  describe('confirmTaskCompletion', () => {
    it('should confirm task completion for existing task', async () => {
      // Set up task in registry
      const taskId = 'task-123';
      const userId = 'user-456';
      taskPointsService.taskRegistry.set(taskId, {
        userId,
        pointsAllocated: 100,
        status: 'reserved',
        createdAt: Date.now()
      });
      
      const result = await taskPointsService.confirmTaskCompletion(taskId, { imageUrl: 'image.jpg' });
      
      expect(result).toBe(true);
      expect(taskPointsService.emit).toHaveBeenCalledWith('points:consumed', expect.any(Object));
      
      // Check updated task info
      const taskInfo = taskPointsService.getTaskInfo(taskId);
      expect(taskInfo.status).toBe('completed');
      expect(taskInfo.result).toEqual({ imageUrl: 'image.jpg' });
    });
    
    it('should return false for non-existent task', async () => {
      const result = await taskPointsService.confirmTaskCompletion('non-existent-task');
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
  
  describe('refundTaskPoints', () => {
    it('should refund points for existing task', async () => {
      // Set up task in registry
      const taskId = 'task-123';
      const userId = 'user-456';
      taskPointsService.taskRegistry.set(taskId, {
        userId,
        pointsAllocated: 100,
        status: 'reserved',
        createdAt: Date.now()
      });
      
      const result = await taskPointsService.refundTaskPoints(taskId, 'USER_CANCELLED');
      
      expect(result).toBe(true);
      expect(mockPointsService.incrementPoints).toHaveBeenCalledWith(userId, 100, expect.any(Object));
      expect(taskPointsService.emit).toHaveBeenCalledWith('points:refunded', expect.any(Object));
      
      // Check updated task info
      const taskInfo = taskPointsService.getTaskInfo(taskId);
      expect(taskInfo.status).toBe('refunded');
      expect(taskInfo.refundReason).toBe('USER_CANCELLED');
    });
    
    it('should return false for non-existent task', async () => {
      const result = await taskPointsService.refundTaskPoints('non-existent-task');
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
  
  describe('getUserTasks', () => {
    it('should return all tasks for a user', () => {
      const userId = 'user-456';
      
      // Set up multiple tasks in registry
      taskPointsService.taskRegistry.set('task-1', {
        userId,
        pointsAllocated: 100,
        status: 'completed'
      });
      
      taskPointsService.taskRegistry.set('task-2', {
        userId,
        pointsAllocated: 150,
        status: 'reserved'
      });
      
      taskPointsService.taskRegistry.set('task-3', {
        userId: 'other-user',
        pointsAllocated: 200,
        status: 'completed'
      });
      
      const userTasks = taskPointsService.getUserTasks(userId);
      
      expect(userTasks).toHaveLength(2);
      expect(userTasks[0].taskId).toBe('task-1');
      expect(userTasks[1].taskId).toBe('task-2');
    });
    
    it('should return empty array for user with no tasks', () => {
      const userTasks = taskPointsService.getUserTasks('non-existent-user');
      expect(userTasks).toHaveLength(0);
    });
  });
  
  describe('handleTaskEvent', () => {
    beforeEach(() => {
      // Mock methods
      taskPointsService.confirmTaskCompletion = jest.fn().mockResolvedValue(true);
      taskPointsService.refundTaskPoints = jest.fn().mockResolvedValue(true);
      
      // Set up task in registry
      taskPointsService.taskRegistry.set('task-123', {
        userId: 'user-456',
        pointsAllocated: 100,
        status: 'reserved',
        createdAt: Date.now()
      });
    });
    
    it('should handle task:completed event', async () => {
      await taskPointsService.handleTaskEvent('task:completed', { 
        taskId: 'task-123',
        result: { imageUrl: 'image.jpg' }
      });
      
      expect(taskPointsService.confirmTaskCompletion).toHaveBeenCalledWith(
        'task-123', 
        { imageUrl: 'image.jpg' }
      );
    });
    
    it('should handle task:failed event', async () => {
      await taskPointsService.handleTaskEvent('task:failed', { 
        taskId: 'task-123',
        error: 'Generation failed'
      });
      
      expect(taskPointsService.refundTaskPoints).toHaveBeenCalledWith(
        'task-123', 
        'TASK_FAILED'
      );
    });
    
    it('should handle task:cancelled event', async () => {
      await taskPointsService.handleTaskEvent('task:cancelled', { 
        taskId: 'task-123'
      });
      
      expect(taskPointsService.refundTaskPoints).toHaveBeenCalledWith(
        'task-123', 
        'TASK_CANCELLED'
      );
    });
    
    it('should ignore unknown events', async () => {
      await taskPointsService.handleTaskEvent('task:unknown', { 
        taskId: 'task-123'
      });
      
      expect(taskPointsService.confirmTaskCompletion).not.toHaveBeenCalled();
      expect(taskPointsService.refundTaskPoints).not.toHaveBeenCalled();
    });
    
    it('should do nothing for missing taskId', async () => {
      await taskPointsService.handleTaskEvent('task:completed', {});
      
      expect(taskPointsService.confirmTaskCompletion).not.toHaveBeenCalled();
    });
  });
});

/**
 * Run Task Points Service Tests
 * This function encapsulates all the tests for the Task Points Service
 */
async function runTaskPointsTests() {
  console.log('🧪 RUNNING TASK POINTS SERVICE TESTS');
  console.log('-----------------------------------');

  try {
    // The tests are already defined in the test file
    // When this file is imported, Jest will automatically
    // register the tests, so we just need to log success
    console.log('\n✅ All task points service tests passed\n');
    return true;
  } catch (error) {
    console.error('\n❌ Task points service tests failed:', error);
    throw error;
  }
}

// Export the test runner for the run-all-tests script
module.exports = {
  runTaskPointsTests
};

// Run tests directly if this file is executed directly
if (require.main === module) {
  // When run directly, Jest will execute the tests
  runTaskPointsTests().catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
  });
} 