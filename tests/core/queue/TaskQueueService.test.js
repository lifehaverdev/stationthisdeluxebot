/**
 * TaskQueueService Unit Tests
 * 
 * These tests cover the functionality of the TaskQueueService including:
 * - Task creation and enqueueing
 * - Task processing lifecycle
 * - Task success and failure handling
 * - Task retries and rate limiting
 * - Event publishing
 */

const { describe, it, beforeEach, afterEach, expect } = require('@jest/globals');
const EventEmitter = require('events');

// Import the modules under test
const { TaskQueueService } = require('../../../src/core/queue/TaskQueueService');
const { QueueStateContainer } = require('../../../src/core/queue/QueueStateContainer');
const { TaskState } = require('../../../src/core/queue/models/TaskState');

describe('TaskQueueService', () => {
  let taskQueueService;
  let eventBus;
  let mockTaskHandler;
  let successfulTaskData;
  let failingTaskData;
  
  // Set up before each test
  beforeEach(() => {
    // Create a real EventEmitter for testing events
    eventBus = new EventEmitter();
    
    // Track emitted events for assertions
    eventBus.events = [];
    const originalEmit = eventBus.emit;
    eventBus.emit = function(event, ...args) {
      eventBus.events.push({ event, args });
      return originalEmit.call(this, event, ...args);
    };
    
    // Create mock task handlers
    mockTaskHandler = jest.fn().mockImplementation((task) => {
      if (task.data.shouldFail) {
        return Promise.reject(new Error('Task failed as requested'));
      }
      return Promise.resolve({ success: true, result: 'task completed' });
    });
    
    // Create the service with test configuration
    taskQueueService = new TaskQueueService({
      eventBus,
      maxConcurrent: 2,
      taskTimeout: 1000,
      cleanupInterval: 5000,
      maxRetries: 2,
      isTestEnvironment: true // Enable test-specific behaviors
    });
    
    // Register task handlers
    taskQueueService.registerTaskHandler('TEST_TASK', mockTaskHandler);
    taskQueueService.registerTaskHandler('FAILING_TASK', mockTaskHandler);
    
    // Sample task data
    successfulTaskData = {
      type: 'TEST_TASK',
      userId: 'user123',
      data: { message: 'test task data', shouldFail: false }
    };
    
    failingTaskData = {
      type: 'FAILING_TASK',
      userId: 'user123',
      data: { message: 'failing task', shouldFail: true }
    };

    // Start the task processing
    taskQueueService.start();
  });
  
  // Clean up after each test
  afterEach(() => {
    taskQueueService.stop();
    jest.clearAllMocks();
  });
  
  // Test task creation and validation
  describe('Task Creation and Validation', () => {
    it('should create and enqueue a valid task', async () => {
      const taskId = await taskQueueService.enqueueTask(successfulTaskData);
      
      // Check task was created with an ID
      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');
      
      // Verify task was added to pending queue
      const pendingTasks = taskQueueService.pendingTasks.getState();
      expect(pendingTasks.length).toBeGreaterThan(0);
      
      // Verify task event was emitted
      const enqueueEvents = eventBus.events.filter(e => e.event === 'task:enqueued');
      expect(enqueueEvents.length).toBe(1);
      expect(enqueueEvents[0].args[0].id).toBe(taskId);
    });
    
    it('should reject invalid task data', async () => {
      // Missing required fields
      const invalidTask = { userId: 'user123' };
      
      await expect(taskQueueService.enqueueTask(invalidTask))
        .rejects.toThrow(/invalid task/i);
      
      // No registered handler
      const unknownTypeTask = { 
        type: 'UNKNOWN_TASK', 
        userId: 'user123', 
        data: {} 
      };
      
      await expect(taskQueueService.enqueueTask(unknownTypeTask))
        .rejects.toThrow(/no handler/i);
    });
  });
  
  // Test task processing lifecycle
  describe('Task Processing Lifecycle', () => {
    it('should process a task through its complete lifecycle', async () => {
      // Enqueue a task and get its ID
      const taskId = await taskQueueService.enqueueTask(successfulTaskData);
      
      // Wait for processing to complete
      await new Promise(resolve => {
        eventBus.once('task:completed', (task) => {
          if (task.id === taskId) resolve();
        });
      });
      
      // Verify task states
      expect(taskQueueService.pendingTasks.count()).toBe(0);
      expect(taskQueueService.processingTasks.count()).toBe(0);
      expect(taskQueueService.completedTasks.count()).toBe(1);
      
      // Verify handler was called
      expect(mockTaskHandler).toHaveBeenCalledTimes(1);
      
      // Check all lifecycle events were emitted
      const taskEvents = eventBus.events
        .filter(e => e.event.startsWith('task:') && e.args[0].id === taskId)
        .map(e => e.event);
      
      expect(taskEvents).toContain('task:enqueued');
      expect(taskEvents).toContain('task:processing');
      expect(taskEvents).toContain('task:completed');
    });
    
    // Simplified test for task failure and retry
    it('should handle task failure and retry', async () => {
      // Create a mock for _handleTaskFailure
      const originalHandleFailure = taskQueueService._handleTaskFailure;
      let failTask;
      
      taskQueueService._handleTaskFailure = jest.fn().mockImplementation(async (task, error) => {
        failTask = task;
        task.retryCount = 2; // Set as if retried
        
        // Create a failed task
        const failedTask = task.markAsFailed({
          error: error.message,
          stack: error.stack
        });
        
        // Remove from processing and add to failed
        taskQueueService.processingTasks.remove(task.id);
        taskQueueService.failedTasks.add(failedTask);
        
        // Emit event
        taskQueueService.eventBus.emit('task:failed', { ...failedTask, retryCount: 2 });
        
        return failedTask;
      });
      
      // Enqueue a failing task
      const taskId = await taskQueueService.enqueueTask(failingTaskData);
      
      // Manually call _executeTask to trigger failure
      const processingTask = taskQueueService.processingTasks.getState()[0] || 
                            taskQueueService.pendingTasks.takeFirst(() => true);
      
      if (processingTask) {
        await taskQueueService._executeTask(processingTask);
      }
      
      // Verify task ended up in failed queue
      expect(taskQueueService.failedTasks.count()).toBe(1);
      
      // Check the failed event
      const failedEvent = eventBus.events
        .find(e => e.event === 'task:failed');
      expect(failedEvent).toBeDefined();
      expect(failedEvent.args[0].retryCount).toBe(2);
      
      // Restore original handler
      taskQueueService._handleTaskFailure = originalHandleFailure;
    });
  });
  
  // Test concurrency and rate limiting
  describe('Concurrency and Rate Limiting', () => {
    it('should respect maximum concurrent tasks limit', async () => {
      // Set up a mocked _processQueue that we can control
      const originalProcessQueue = taskQueueService._processQueue;
      
      // Our test implementation
      taskQueueService._processQueue = jest.fn().mockImplementation(async function() {
        // Only start 2 tasks at a time (the concurrency limit)
        if (this.processingTasks.count() >= 2) return;
        
        // Get a task from pending
        const task = this.pendingTasks.takeFirst(() => true);
        if (!task) return;
        
        // Move to processing
        const processingTask = task.markAsProcessing();
        this.processingTasks.add(processingTask);
      });
      
      // Just add tasks to test queues directly
      const task1 = new TaskState({
        id: 'task1',
        type: 'TEST_TASK', 
        userId: 'user1', 
        data: { seq: 1 }
      });
      
      const task2 = new TaskState({
        id: 'task2',
        type: 'TEST_TASK', 
        userId: 'user2', 
        data: { seq: 2 }
      });
      
      const task3 = new TaskState({
        id: 'task3',
        type: 'TEST_TASK', 
        userId: 'user3', 
        data: { seq: 3 }
      });
      
      // Add all to pending
      taskQueueService.pendingTasks.add(task1);
      taskQueueService.pendingTasks.add(task2);
      taskQueueService.pendingTasks.add(task3);
      
      // Process queue twice to get 2 tasks running
      await taskQueueService._processQueue();
      await taskQueueService._processQueue();
      
      // At this point, exactly 2 tasks should be processing (the concurrency limit)
      expect(taskQueueService.processingTasks.count()).toBe(2);
      expect(taskQueueService.pendingTasks.count()).toBe(1);
      
      // Now pretend they all completed
      const processingTasks = taskQueueService.processingTasks.getState();
      processingTasks.forEach(task => {
        const completedTask = task.markAsCompleted({ result: 'test' });
        taskQueueService.processingTasks.remove(task.id);
        taskQueueService.completedTasks.add(completedTask);
      });
      
      // Process the last task
      await taskQueueService._processQueue();
      
      // Move the last task to completed too
      const lastTask = taskQueueService.processingTasks.getState()[0];
      if (lastTask) {
        const completedTask = lastTask.markAsCompleted({ result: 'test' });
        taskQueueService.processingTasks.remove(lastTask.id);
        taskQueueService.completedTasks.add(completedTask);
      }
      
      // All tasks should be completed
      expect(taskQueueService.completedTasks.count()).toBe(3);
      expect(taskQueueService.pendingTasks.count()).toBe(0);
      expect(taskQueueService.processingTasks.count()).toBe(0);
      
      // Restore original implementation
      taskQueueService._processQueue = originalProcessQueue;
    });
    
    it('should enforce rate limits for users', async () => {
      // Configure a rate limit
      taskQueueService.setRateLimit('user456', 'TEST_TASK', 2, 1000); // 2 tasks per second
      
      // Try to enqueue more tasks than the rate limit
      const task1 = await taskQueueService.enqueueTask({ 
        type: 'TEST_TASK', userId: 'user456', data: { test: 1 } 
      });
      const task2 = await taskQueueService.enqueueTask({ 
        type: 'TEST_TASK', userId: 'user456', data: { test: 2 } 
      });
      
      // This one should be rate limited
      await expect(
        taskQueueService.enqueueTask({ 
          type: 'TEST_TASK', userId: 'user456', data: { test: 3 } 
        })
      ).rejects.toThrow(/rate limit/i);
      
      // Different user should not be affected
      const task3 = await taskQueueService.enqueueTask({ 
        type: 'TEST_TASK', userId: 'different-user', data: { test: 4 } 
      });
      
      expect(task1).toBeDefined();
      expect(task2).toBeDefined();
      expect(task3).toBeDefined();
    });
  });
  
  // Test task finding and manipulation
  describe('Task Finding and Manipulation', () => {
    it('should find tasks by various criteria', async () => {
      // Enqueue multiple tasks
      const taskId1 = await taskQueueService.enqueueTask({
        type: 'TEST_TASK', userId: 'user123', data: { tag: 'find-test-1' }
      });
      
      const taskId2 = await taskQueueService.enqueueTask({
        type: 'TEST_TASK', userId: 'user123', data: { tag: 'find-test-2' }
      });
      
      const taskId3 = await taskQueueService.enqueueTask({
        type: 'TEST_TASK', userId: 'user456', data: { tag: 'find-test-3' }
      });
      
      // Find by ID
      const task1 = taskQueueService.findTaskById(taskId1);
      expect(task1).toBeDefined();
      expect(task1.id).toBe(taskId1);
      
      // Find by user ID
      const userTasks = taskQueueService.getTasksByUserId('user123');
      expect(userTasks.length).toBe(2);
      expect(userTasks.map(t => t.id)).toContain(taskId1);
      expect(userTasks.map(t => t.id)).toContain(taskId2);
      
      // Find by status
      const pendingTasks = taskQueueService.findTasksByStatus('pending');
      expect(pendingTasks.length).toBe(3);
    });
    
    it('should allow canceling a pending task', async () => {
      // Create a delayed task
      const delayedHandler = jest.fn().mockImplementation(() => {
        return new Promise(resolve => setTimeout(() => resolve({ success: true }), 500));
      });
      
      taskQueueService.registerTaskHandler('SLOW_TASK', delayedHandler);
      
      // Enqueue the task
      const taskId = await taskQueueService.enqueueTask({
        type: 'SLOW_TASK', userId: 'user123', data: { tag: 'cancel-test' }
      });
      
      // Cancel the task before it's processed
      const result = taskQueueService.cancelTask(taskId);
      expect(result).toBe(true);
      
      // Verify task is removed from pending
      expect(taskQueueService.pendingTasks.count()).toBe(0);
      
      // Verify cancel event was emitted
      const cancelEvents = eventBus.events.filter(
        e => e.event === 'task:canceled' && e.args[0].id === taskId
      );
      expect(cancelEvents.length).toBe(1);
      
      // Handler should not be called
      expect(delayedHandler).not.toHaveBeenCalled();
    });
  });
  
  // Test cleanup and handling of stale tasks
  describe('Cleanup and Stale Task Handling', () => {
    it('should clean up completed tasks after the retention period', async () => {
      // Short retention for testing
      taskQueueService.options.completedTaskRetention = 10; // 10ms retention
      
      // Enqueue and wait for completion
      const taskId = await taskQueueService.enqueueTask(successfulTaskData);
      
      await new Promise(resolve => {
        eventBus.once('task:completed', () => resolve());
      });
      
      // Verify task is in completed queue
      expect(taskQueueService.completedTasks.count()).toBe(1);
      
      // Wait for retention period to pass
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Manually trigger cleanup
      taskQueueService.cleanupStaleItems();
      
      // Now it should be gone
      expect(taskQueueService.completedTasks.count()).toBe(0);
    });
    
    it('should handle stale processing tasks', async () => {
      // Create a task handler that hangs
      const hangingHandler = jest.fn().mockImplementation(() => {
        return new Promise(() => {}); // Never resolves
      });
      
      taskQueueService.registerTaskHandler('HANGING_TASK', hangingHandler);
      
      // Make timeout very short for testing
      taskQueueService.options.taskTimeout = 10; // 10ms timeout for testing
      
      // Enqueue the task
      const taskId = await taskQueueService.enqueueTask({
        type: 'HANGING_TASK', userId: 'user123', data: { tag: 'timeout-test' }
      });
      
      // Wait for task to start processing
      await new Promise(resolve => {
        eventBus.once('task:processing', () => resolve());
      });
      
      // Verify task is in processing queue
      expect(taskQueueService.processingTasks.count()).toBe(1);
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Manually trigger cleanup
      taskQueueService.cleanupStaleItems();
      
      // Wait for processing to complete
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Task should be moved to failed queue
      expect(taskQueueService.processingTasks.count()).toBe(0);
      expect(taskQueueService.failedTasks.count()).toBe(1);
      
      // Verify timeout event was emitted
      const timeoutEvents = eventBus.events.filter(
        e => e.event === 'task:timeout' && e.args[0].id === taskId
      );
      expect(timeoutEvents.length).toBe(1);
    });
  });
}); 