/**
 * QueueStateContainer
 * 
 * A simple in-memory container to store task states with basic
 * queue operations and filtering capability. Maintains tasks in
 * insertion order.
 */

class QueueStateContainer {
  /**
   * Create a new queue container
   * 
   * @param {Object} options - Container options
   * @param {string} [options.name='unnamed'] - Name of this queue for debugging
   * @param {number} [options.limit=1000] - Maximum number of tasks to store
   */
  constructor(options = {}) {
    this.name = options.name || 'unnamed';
    this.limit = options.limit || 1000;
    this._tasks = new Map();  // Using Map for O(1) lookups
  }

  /**
   * Add a task to the queue
   * 
   * @param {TaskState} task - Task state to add
   * @throws {Error} If queue is at capacity
   * @returns {QueueStateContainer} This container for chaining
   */
  add(task) {
    if (this.count() >= this.limit) {
      throw new Error(`Queue "${this.name}" is at capacity (${this.limit})`);
    }
    
    this._tasks.set(task.id, task);
    return this;
  }

  /**
   * Remove a task from the queue
   * 
   * @param {string} taskId - ID of task to remove
   * @returns {TaskState|null} Removed task or null if not found
   */
  remove(taskId) {
    const task = this._tasks.get(taskId);
    if (task) {
      this._tasks.delete(taskId);
    }
    return task || null;
  }

  /**
   * Get a task by ID
   * 
   * @param {string} taskId - ID of task to get
   * @returns {TaskState|null} Task or null if not found
   */
  get(taskId) {
    return this._tasks.get(taskId) || null;
  }

  /**
   * Check if queue contains a task
   * 
   * @param {string} taskId - ID of task to check
   * @returns {boolean} True if queue contains the task
   */
  has(taskId) {
    return this._tasks.has(taskId);
  }

  /**
   * Get the current count of tasks in the queue
   * 
   * @returns {number} Number of tasks in the queue
   */
  count() {
    return this._tasks.size;
  }

  /**
   * Clear all tasks from the queue
   * 
   * @returns {QueueStateContainer} This container for chaining
   */
  clear() {
    this._tasks.clear();
    return this;
  }

  /**
   * Get an array of all tasks
   * 
   * @returns {Array<TaskState>} Array of all task states
   */
  getState() {
    return Array.from(this._tasks.values());
  }

  /**
   * Find tasks matching a predicate function
   * 
   * @param {Function} predicate - Function that takes a task and returns boolean
   * @returns {Array<TaskState>} Array of matching task states
   */
  find(predicate) {
    return this.getState().filter(predicate);
  }

  /**
   * Find tasks by user ID
   * 
   * @param {string} userId - User ID to match
   * @returns {Array<TaskState>} Array of matching task states
   */
  findByUserId(userId) {
    return this.find(task => task.userId === userId);
  }

  /**
   * Find tasks by type
   * 
   * @param {string} type - Task type to match
   * @returns {Array<TaskState>} Array of matching task states
   */
  findByType(type) {
    return this.find(task => task.type === type);
  }

  /**
   * Find tasks by status
   * 
   * @param {string} status - Status to match
   * @returns {Array<TaskState>} Array of matching task states
   */
  findByStatus(status) {
    return this.find(task => task.status === status);
  }

  /**
   * Take the first task matching a predicate
   * 
   * @param {Function} predicate - Function that takes a task and returns boolean
   * @returns {TaskState|null} First matching task or null
   */
  takeFirst(predicate) {
    const tasks = this.find(predicate);
    if (tasks.length > 0) {
      return this.remove(tasks[0].id);
    }
    return null;
  }

  /**
   * Replace a task with an updated version
   * 
   * @param {TaskState} updatedTask - Updated task state
   * @returns {TaskState|null} Previous task state or null
   */
  replace(updatedTask) {
    const previous = this.remove(updatedTask.id);
    if (previous) {
      this.add(updatedTask);
    }
    return previous;
  }
}

module.exports = { QueueStateContainer }; 