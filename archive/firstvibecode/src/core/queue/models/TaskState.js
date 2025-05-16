/**
 * TaskState - Immutable Task State Model
 * 
 * Represents a task in the task queue system with immutable state
 * management. Provides utility methods for validating and transforming
 * task states through their lifecycle.
 */

const { v4: uuidv4 } = require('uuid');

// Task statuses
const TASK_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled'
};

/**
 * TaskState class - immutable model for task state
 */
class TaskState {
  /**
   * Constructor for creating a task state
   * 
   * @param {Object} taskData - Task data
   * @param {string} [taskData.id] - Optional task ID (generated if not provided)
   * @param {string} taskData.type - Task type
   * @param {string} taskData.userId - User ID associated with this task
   * @param {Object} taskData.data - Task payload data
   * @param {string} [taskData.status=TASK_STATUS.PENDING] - Task status
   * @param {number} [taskData.priority=0] - Task priority (higher = more important)
   * @param {Date} [taskData.createdAt] - Creation timestamp
   * @param {Date} [taskData.updatedAt] - Last update timestamp
   * @param {Date} [taskData.startedAt] - When processing started
   * @param {Date} [taskData.completedAt] - When processing completed
   * @param {number} [taskData.retryCount=0] - Number of retry attempts
   * @param {Object} [taskData.result] - Task result data
   * @param {Error|Object} [taskData.error] - Error information if failed
   */
  constructor(taskData) {
    // Validate required fields
    this._validateTaskData(taskData);
    
    // Generate ID if not provided
    const id = taskData.id || uuidv4();
    const now = new Date();
    
    // Copy immutable task properties
    this._state = Object.freeze({
      ...taskData,
      id,
      status: taskData.status || TASK_STATUS.PENDING,
      priority: taskData.priority || 0,
      createdAt: taskData.createdAt || now,
      updatedAt: taskData.updatedAt || now,
      startedAt: taskData.startedAt || null,
      completedAt: taskData.completedAt || null,
      retryCount: taskData.retryCount || 0,
      result: taskData.result || null,
      error: taskData.error || null
    });
  }
  
  /**
   * Validates task data for required fields
   * 
   * @param {Object} taskData - Task data to validate
   * @throws {Error} If validation fails
   * @private
   */
  _validateTaskData(taskData) {
    if (!taskData) {
      throw new Error('Task data is required');
    }
    
    if (!taskData.type) {
      throw new Error('Task type is required');
    }
    
    if (!taskData.userId) {
      throw new Error('User ID is required');
    }
    
    if (!taskData.data || typeof taskData.data !== 'object') {
      throw new Error('Task data payload must be an object');
    }
    
    // Validate status if provided
    if (taskData.status && !Object.values(TASK_STATUS).includes(taskData.status)) {
      throw new Error(`Invalid task status: ${taskData.status}`);
    }
  }
  
  /**
   * Creates a new task state with updated properties
   * 
   * @param {Object} updates - Properties to update
   * @returns {TaskState} New task state instance
   */
  update(updates) {
    return new TaskState({
      ...this._state,
      ...updates,
      updatedAt: new Date()
    });
  }
  
  /**
   * Transition the task to processing state
   * 
   * @returns {TaskState} New task state in processing status
   */
  markAsProcessing() {
    return this.update({
      status: TASK_STATUS.PROCESSING,
      startedAt: new Date()
    });
  }
  
  /**
   * Transition the task to completed state
   * 
   * @param {Object} result - Optional result data
   * @returns {TaskState} New task state in completed status
   */
  markAsCompleted(result = null) {
    return this.update({
      status: TASK_STATUS.COMPLETED,
      completedAt: new Date(),
      result
    });
  }
  
  /**
   * Transition the task to failed state
   * 
   * @param {Error|Object} error - Error information
   * @returns {TaskState} New task state in failed status
   */
  markAsFailed(error) {
    return this.update({
      status: TASK_STATUS.FAILED,
      completedAt: new Date(),
      error: error instanceof Error ? 
        { message: error.message, stack: error.stack } : 
        error
    });
  }
  
  /**
   * Transition the task to canceled state
   * 
   * @returns {TaskState} New task state in canceled status
   */
  markAsCanceled() {
    return this.update({
      status: TASK_STATUS.CANCELED,
      completedAt: new Date()
    });
  }
  
  /**
   * Increment the retry count for this task
   * 
   * @returns {TaskState} New task state with incremented retry count
   */
  incrementRetry() {
    return this.update({
      status: TASK_STATUS.PENDING, // Reset to pending for retry
      retryCount: this.retryCount + 1
    });
  }
  
  /**
   * Creates a new TaskState instance
   * 
   * @param {Object} taskData - Task data
   * @returns {TaskState} New task state instance
   * @static
   */
  static create(taskData) {
    return new TaskState(taskData);
  }
  
  /**
   * Get time spent in current status
   * @returns {number} Milliseconds in current status
   */
  getTimeInStatus() {
    const now = new Date();
    
    if (this.status === TASK_STATUS.PROCESSING && this.startedAt) {
      return now - this.startedAt;
    }
    
    if (this.completedAt) {
      return this.completedAt - (this.startedAt || this.createdAt);
    }
    
    return now - this.updatedAt;
  }
  
  // Getters for immutable properties
  get id() { return this._state.id; }
  get type() { return this._state.type; }
  get userId() { return this._state.userId; }
  get data() { return this._state.data; }
  get status() { return this._state.status; }
  get priority() { return this._state.priority; }
  get createdAt() { return this._state.createdAt; }
  get updatedAt() { return this._state.updatedAt; }
  get startedAt() { return this._state.startedAt; }
  get completedAt() { return this._state.completedAt; }
  get retryCount() { return this._state.retryCount; }
  get result() { return this._state.result; }
  get error() { return this._state.error; }
  
  /**
   * Convert task state to plain object
   * @returns {Object} Plain object representation of task state
   */
  toJSON() {
    return { ...this._state };
  }
  
  /**
   * Check if task is in a specific status
   * 
   * @param {string} status - Status to check
   * @returns {boolean} True if task has this status
   */
  hasStatus(status) {
    return this.status === status;
  }
  
  /**
   * Check if task is pending
   * @returns {boolean} True if pending
   */
  isPending() {
    return this.hasStatus(TASK_STATUS.PENDING);
  }
  
  /**
   * Check if task is processing
   * @returns {boolean} True if processing
   */
  isProcessing() {
    return this.hasStatus(TASK_STATUS.PROCESSING);
  }
  
  /**
   * Check if task is completed
   * @returns {boolean} True if completed
   */
  isCompleted() {
    return this.hasStatus(TASK_STATUS.COMPLETED);
  }
  
  /**
   * Check if task is failed
   * @returns {boolean} True if failed
   */
  isFailed() {
    return this.hasStatus(TASK_STATUS.FAILED);
  }
  
  /**
   * Check if task is canceled
   * @returns {boolean} True if canceled
   */
  isCanceled() {
    return this.hasStatus(TASK_STATUS.CANCELED);
  }
  
  /**
   * Check if task is finished (completed, failed, or canceled)
   * @returns {boolean} True if finished
   */
  isFinished() {
    return this.isCompleted() || this.isFailed() || this.isCanceled();
  }
}

module.exports = {
  TaskState,
  TASK_STATUS
}; 