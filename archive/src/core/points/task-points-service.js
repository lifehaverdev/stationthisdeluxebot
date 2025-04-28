/**
 * Task Points Service
 * 
 * Handles points allocation and tracking for generation tasks.
 * Provides methods for reserving, consuming, and refunding points for tasks.
 */

const { EventEmitter } = require('events');
const { AppError } = require('../../shared/errors');

/**
 * TaskPointsService manages points for generation tasks.
 * It tracks point allocations, ensures tasks have sufficient points,
 * and manages point consumption when tasks complete.
 */
class TaskPointsService extends EventEmitter {
  /**
   * Create a new TaskPointsService
   * @param {Object} deps - Dependencies
   * @param {Object} deps.pointsRepository - Repository for points data storage
   * @param {Object} deps.pointsService - Service for basic points operations
   * @param {Object} [deps.logger] - Optional logger instance
   */
  constructor(deps) {
    super();
    this.pointsRepository = deps.pointsRepository;
    this.pointsService = deps.pointsService;
    this.logger = deps.logger || console;
    
    this.taskRegistry = new Map(); // Map<taskId, taskInfo>
  }
  
  /**
   * Calculate points cost for a generation task
   * @param {Object} taskDetails - Task details
   * @param {string} taskDetails.type - Type of generation (e.g., 'text-to-image', 'upscale')
   * @param {Object} taskDetails.settings - Generation settings
   * @param {string} [taskDetails.prompt] - Generation prompt (if applicable)
   * @returns {number} Points cost for the task
   */
  calculateTaskCost(taskDetails) {
    const { type, settings = {} } = taskDetails;
    
    // Base costs for different task types
    const baseCosts = {
      'DEFAULT': 100,
      'text-to-image': 100,
      'image-to-image': 75,
      'upscale': 50,
      'background-removal': 25,
      'video': 200
    };
    
    // Get base cost for this task type
    const baseCost = baseCosts[type] || baseCosts.DEFAULT;
    
    // Apply multipliers based on settings
    let multiplier = 1.0;
    
    // Resolution multiplier
    if (settings.width && settings.height) {
      const pixels = settings.width * settings.height;
      const basePixels = 1024 * 1024; // 1024x1024 is our reference resolution
      
      // Scale cost with resolution, but not linearly
      multiplier *= Math.sqrt(pixels / basePixels);
    }
    
    // Steps multiplier (if applicable)
    if (settings.steps) {
      const baseSteps = 30; // Reference number of steps
      multiplier *= (settings.steps / baseSteps);
    }
    
    // Special model multiplier (if applicable)
    if (settings.model) {
      const premiumModels = ['sdxl', 'sdxl-turbo', 'realistic-vision', 'dreamshaper'];
      if (premiumModels.some(model => settings.model.toLowerCase().includes(model))) {
        multiplier *= 1.5; // Premium models cost more
      }
    }
    
    // Calculate final cost, round to nearest integer
    const finalCost = Math.round(baseCost * multiplier);
    
    // Ensure minimum cost
    return Math.max(finalCost, 10);
  }
  
  /**
   * Reserve points for a task
   * @param {string} taskId - Unique ID for the task
   * @param {string} userId - User ID who initiated the task
   * @param {Object} taskDetails - Details about the task
   * @returns {Promise<boolean>} True if points reserved successfully
   * @throws {AppError} If points reservation fails
   */
  async reservePoints(taskId, userId, taskDetails) {
    if (!taskId || !userId) {
      throw new AppError('Missing required parameters', 'INVALID_PARAMETERS');
    }
    
    // Calculate task cost
    const pointsRequired = this.calculateTaskCost(taskDetails);
    
    try {
      // Check if user has sufficient points
      const hasSufficientPoints = await this.pointsService.hasSufficientPoints(
        userId, 
        pointsRequired
      );
      
      if (!hasSufficientPoints) {
        throw new AppError(
          `Insufficient points for task. Required: ${pointsRequired}`,
          'INSUFFICIENT_POINTS'
        );
      }
      
      // Decrement user points
      await this.pointsService.decrementPoints(userId, pointsRequired, {
        reason: 'GENERATION_TASK',
        details: {
          taskId,
          type: taskDetails.type,
          timestamp: Date.now()
        }
      });
      
      // Register the task
      this.taskRegistry.set(taskId, {
        userId,
        pointsAllocated: pointsRequired,
        details: taskDetails,
        status: 'reserved',
        createdAt: Date.now()
      });
      
      this.logger.info(`Points reserved for task: ${taskId}, Amount: ${pointsRequired}`);
      
      // Emit event
      this.emit('points:reserved', {
        taskId,
        userId,
        points: pointsRequired
      });
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to reserve points for task ${taskId}:`, error);
      throw new AppError(
        `Failed to reserve points: ${error.message}`,
        'POINTS_RESERVATION_FAILED',
        { cause: error }
      );
    }
  }
  
  /**
   * Confirm points consumption for a completed task
   * @param {string} taskId - Task ID to confirm
   * @param {Object} result - Task result details
   * @returns {Promise<boolean>} True if confirmation successful
   */
  async confirmTaskCompletion(taskId, result = {}) {
    const taskInfo = this.taskRegistry.get(taskId);
    
    if (!taskInfo) {
      this.logger.warn(`Task ${taskId} not found in registry`);
      return false;
    }
    
    try {
      // Update task status
      this.taskRegistry.set(taskId, {
        ...taskInfo,
        status: 'completed',
        completedAt: Date.now(),
        result
      });
      
      this.logger.info(`Task ${taskId} completed, points consumed: ${taskInfo.pointsAllocated}`);
      
      // Emit event
      this.emit('points:consumed', {
        taskId,
        userId: taskInfo.userId,
        points: taskInfo.pointsAllocated,
        result
      });
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to confirm task completion ${taskId}:`, error);
      return false;
    }
  }
  
  /**
   * Refund points for a failed or cancelled task
   * @param {string} taskId - Task ID to refund
   * @param {string} reason - Reason for refund
   * @returns {Promise<boolean>} True if refund successful
   */
  async refundTaskPoints(taskId, reason = 'TASK_FAILED') {
    const taskInfo = this.taskRegistry.get(taskId);
    
    if (!taskInfo) {
      this.logger.warn(`Task ${taskId} not found in registry for refund`);
      return false;
    }
    
    try {
      const { userId, pointsAllocated } = taskInfo;
      
      // Add points back to user
      await this.pointsService.incrementPoints(userId, pointsAllocated, {
        reason: 'TASK_REFUND',
        details: {
          taskId,
          originalReason: reason,
          timestamp: Date.now()
        }
      });
      
      // Update task status
      this.taskRegistry.set(taskId, {
        ...taskInfo,
        status: 'refunded',
        refundedAt: Date.now(),
        refundReason: reason
      });
      
      this.logger.info(`Refunded ${pointsAllocated} points for task ${taskId}`);
      
      // Emit event
      this.emit('points:refunded', {
        taskId,
        userId,
        points: pointsAllocated,
        reason
      });
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to refund points for task ${taskId}:`, error);
      return false;
    }
  }
  
  /**
   * Get task information including points allocation
   * @param {string} taskId - Task ID to retrieve
   * @returns {Object|null} Task information or null if not found
   */
  getTaskInfo(taskId) {
    return this.taskRegistry.get(taskId) || null;
  }
  
  /**
   * Get all tasks for a user
   * @param {string} userId - User ID to get tasks for
   * @returns {Array<Object>} Array of task information
   */
  getUserTasks(userId) {
    const userTasks = [];
    
    for (const [taskId, taskInfo] of this.taskRegistry.entries()) {
      if (taskInfo.userId === userId) {
        userTasks.push({
          taskId,
          ...taskInfo
        });
      }
    }
    
    return userTasks;
  }
  
  /**
   * Handle task event from generation service
   * @param {string} eventType - Event type
   * @param {Object} eventData - Event data
   * @returns {Promise<void>}
   */
  async handleTaskEvent(eventType, eventData) {
    const { taskId } = eventData;
    
    if (!taskId) {
      return;
    }
    
    switch (eventType) {
      case 'task:completed':
        await this.confirmTaskCompletion(taskId, eventData.result);
        break;
        
      case 'task:failed':
        await this.refundTaskPoints(taskId, 'TASK_FAILED');
        break;
        
      case 'task:cancelled':
        await this.refundTaskPoints(taskId, 'TASK_CANCELLED');
        break;
        
      default:
        // Ignore other events
        break;
    }
  }
}

module.exports = { TaskPointsService }; 