/**
 * Task Points Service
 * Handles the integration between the task queue and points system
 */

const { PointType } = require('../points');
const eventBus = require('../shared/events').default;

/**
 * Task Points Service
 * Manages point allocation and processing for task execution
 */
class TaskPointsService {
  /**
   * @param {Object} options - Service options
   * @param {Object} options.pointsService - PointsService instance
   * @param {Object} [options.eventBus] - Event bus instance
   */
  constructor(options = {}) {
    if (!options.pointsService) {
      throw new Error('PointsService is required');
    }
    
    this.pointsService = options.pointsService;
    this.eventBus = options.eventBus || eventBus;
    
    // Set up event listeners
    this._setupEventListeners();
  }
  
  /**
   * Set up event listeners for task lifecycle events
   * @private
   */
  _setupEventListeners() {
    // Listen for task enqueued events
    this.eventBus.subscribe('task:enqueued', this._handleTaskEnqueued.bind(this));
    
    // Listen for task completed events
    this.eventBus.subscribe('task:completed', this._handleTaskCompleted.bind(this));
    
    // Listen for task failed events
    this.eventBus.subscribe('task:failed', this._handleTaskFailed.bind(this));
    
    // Listen for task cancelled events
    this.eventBus.subscribe('task:cancelled', this._handleTaskCancelled.bind(this));
  }
  
  /**
   * Handle task enqueued event
   * @param {Object} event - Event data
   * @private
   */
  async _handleTaskEnqueued(event) {
    try {
      const { task } = event;
      
      if (!task || !task.userId) {
        return;
      }
      
      // Allocate points for the task
      const result = await this.allocateTaskPoints(task.userId, task);
      
      // Update task with allocated points info
      task.dointsAllocated = result.dointsAllocated;
    } catch (error) {
      console.error('Error handling task enqueued event:', error);
    }
  }
  
  /**
   * Handle task completed event
   * @param {Object} event - Event data
   * @private
   */
  async _handleTaskCompleted(event) {
    try {
      const { task } = event;
      
      if (!task || !task.userId) {
        return;
      }
      
      // Process task completion
      await this.processTaskCompletion(task.userId, task);
    } catch (error) {
      console.error('Error handling task completed event:', error);
    }
  }
  
  /**
   * Handle task failed event
   * @param {Object} event - Event data
   * @private
   */
  async _handleTaskFailed(event) {
    try {
      const { task } = event;
      
      if (!task || !task.userId || !task.dointsAllocated) {
        return;
      }
      
      // Release allocated points
      await this.releaseTaskPoints(task.userId, task.dointsAllocated, 'task_failed');
    } catch (error) {
      console.error('Error handling task failed event:', error);
    }
  }
  
  /**
   * Handle task cancelled event
   * @param {Object} event - Event data
   * @private
   */
  async _handleTaskCancelled(event) {
    try {
      const { task } = event;
      
      if (!task || !task.userId || !task.dointsAllocated) {
        return;
      }
      
      // Release allocated points
      await this.releaseTaskPoints(task.userId, task.dointsAllocated, 'task_cancelled');
    } catch (error) {
      console.error('Error handling task cancelled event:', error);
    }
  }
  
  /**
   * Allocate points for a task
   * @param {string} userId - User ID
   * @param {Object} task - Task details
   * @returns {Promise<Object>} - Updated user points and allocated amount
   */
  async allocateTaskPoints(userId, task) {
    return this.pointsService.allocateTaskPoints(userId, task);
  }
  
  /**
   * Release allocated points if task fails or is cancelled
   * @param {string} userId - User ID
   * @param {number} amount - Amount to release
   * @param {string} [reason='task_cancelled'] - Reason for releasing
   * @returns {Promise<Object>} - Updated user points
   */
  async releaseTaskPoints(userId, amount, reason = 'task_cancelled') {
    return this.pointsService.releaseTaskPoints(userId, amount, reason);
  }
  
  /**
   * Process points after task completion
   * @param {string} userId - User ID
   * @param {Object} task - Task details
   * @returns {Promise<Object>} - Updated points and processing details
   */
  async processTaskCompletion(userId, task) {
    return this.pointsService.processTaskCompletion(userId, task);
  }
  
  /**
   * Check if user has sufficient points for task
   * @param {string} userId - User ID
   * @param {Object} task - Task details
   * @returns {Promise<Object>} - Check result
   */
  async checkSufficientPoints(userId, task) {
    try {
      // Get task cost
      const cost = this.pointsService.getGenerationCost(task);
      
      // Check if user has enough points
      const hasSufficient = await this.pointsService.hasSufficientPoints(
        userId,
        cost,
        PointType.POINTS
      );
      
      return {
        hasSufficient,
        cost,
        pointType: PointType.POINTS
      };
    } catch (error) {
      console.error('Error checking sufficient points:', error);
      return {
        hasSufficient: false,
        error: error.message
      };
    }
  }
}

module.exports = TaskPointsService; 