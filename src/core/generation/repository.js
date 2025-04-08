/**
 * Generation Repository
 * Handles data access for generation tasks
 */

const { Repository } = require('../shared/repository');
const { GenerationTask, GenerationStatus } = require('./models');
const eventBus = require('../shared/events').default;

// This will be replaced with proper storage in the future
const inMemoryTasks = new Map();

/**
 * Generation Repository
 * Implements the Repository interface for generation tasks
 */
class GenerationRepository extends Repository {
  /**
   * @param {Object} options - Repository options
   */
  constructor(options = {}) {
    super();
    this.maxHistoryPerUser = options.maxHistoryPerUser || 50;
  }

  /**
   * Save a generation task
   * @param {GenerationTask} task - Generation task
   * @returns {Promise<GenerationTask>} - Saved task
   */
  async saveTask(task) {
    try {
      if (!task.taskId) {
        throw new Error('Task ID is required');
      }
      
      // Store task in memory (this will be replaced with database storage)
      inMemoryTasks.set(task.taskId, task);
      
      // Publish event
      eventBus.publish('generation:task-updated', {
        taskId: task.taskId,
        userId: task.userId,
        status: task.status
      });
      
      return task;
    } catch (error) {
      console.error(`Error saving generation task ${task.taskId}:`, error);
      throw error;
    }
  }

  /**
   * Get a generation task by ID
   * @param {string} taskId - Task ID
   * @returns {Promise<GenerationTask|null>} - Found task or null
   */
  async getTaskById(taskId) {
    try {
      // Get task from memory (this will be replaced with database query)
      const task = inMemoryTasks.get(taskId);
      
      return task || null;
    } catch (error) {
      console.error(`Error getting generation task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Get tasks for a user
   * @param {string} userId - User ID
   * @param {Object} [options={}] - Query options
   * @param {number} [options.limit=10] - Maximum number of tasks to return
   * @param {GenerationStatus} [options.status] - Filter by status
   * @returns {Promise<Array<GenerationTask>>} - Found tasks
   */
  async getTasksForUser(userId, options = {}) {
    try {
      const limit = options.limit || 10;
      const status = options.status;
      
      // Get tasks from memory (this will be replaced with database query)
      const userTasks = Array.from(inMemoryTasks.values())
        .filter(task => task.userId === userId)
        .filter(task => status ? task.status === status : true)
        .sort((a, b) => b.createdAt - a.createdAt) // Most recent first
        .slice(0, limit);
      
      return userTasks;
    } catch (error) {
      console.error(`Error getting tasks for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get pending tasks
   * @param {Object} [options={}] - Query options
   * @param {number} [options.limit=10] - Maximum number of tasks to return
   * @returns {Promise<Array<GenerationTask>>} - Pending tasks
   */
  async getPendingTasks(options = {}) {
    try {
      const limit = options.limit || 10;
      
      // Get pending tasks from memory (this will be replaced with database query)
      const pendingTasks = Array.from(inMemoryTasks.values())
        .filter(task => task.status === GenerationStatus.PENDING)
        .sort((a, b) => a.createdAt - b.createdAt) // Oldest first
        .slice(0, limit);
      
      return pendingTasks;
    } catch (error) {
      console.error('Error getting pending tasks:', error);
      throw error;
    }
  }

  /**
   * Update task status
   * @param {string} taskId - Task ID
   * @param {GenerationStatus} status - New status
   * @param {Object} [data={}] - Additional data to update
   * @returns {Promise<GenerationTask|null>} - Updated task or null
   */
  async updateTaskStatus(taskId, status, data = {}) {
    try {
      // Get task
      const task = await this.getTaskById(taskId);
      
      if (!task) {
        return null;
      }
      
      // Update status and other fields
      task.status = status;
      
      if (status === GenerationStatus.PROCESSING && !task.startedAt) {
        task.startedAt = new Date();
      } else if ((status === GenerationStatus.COMPLETED || 
                  status === GenerationStatus.FAILED || 
                  status === GenerationStatus.CANCELLED) && 
                 !task.completedAt) {
        task.completedAt = new Date();
      }
      
      // Apply additional updates
      Object.assign(task, data);
      
      // Save updated task
      return this.saveTask(task);
    } catch (error) {
      console.error(`Error updating task status ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a task
   * @param {string} taskId - Task ID
   * @returns {Promise<boolean>} - Whether the task was deleted
   */
  async deleteTask(taskId) {
    try {
      // Delete task from memory (this will be replaced with database operation)
      const deleted = inMemoryTasks.delete(taskId);
      
      if (deleted) {
        // Publish event
        eventBus.publish('generation:task-deleted', {
          taskId
        });
      }
      
      return deleted;
    } catch (error) {
      console.error(`Error deleting task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up old tasks
   * @param {Object} [options={}] - Cleanup options
   * @param {number} [options.olderThanDays=7] - Delete tasks older than this many days
   * @returns {Promise<number>} - Number of tasks deleted
   */
  async cleanupOldTasks(options = {}) {
    try {
      const olderThanDays = options.olderThanDays || 7;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      // Find old tasks (this will be replaced with database query)
      const oldTaskIds = Array.from(inMemoryTasks.entries())
        .filter(([_, task]) => task.createdAt < cutoffDate)
        .map(([taskId]) => taskId);
      
      // Delete old tasks
      for (const taskId of oldTaskIds) {
        await this.deleteTask(taskId);
      }
      
      return oldTaskIds.length;
    } catch (error) {
      console.error('Error cleaning up old tasks:', error);
      throw error;
    }
  }
}

module.exports = { GenerationRepository }; 