/**
 * Generation Service
 * Handles generation task operations and management
 */

const { v4: uuidv4 } = require('uuid');
const { 
  GenerationRequest, 
  GenerationResponse, 
  GenerationTask, 
  GenerationStatus, 
  GenerationModel, 
  GenerationType 
} = require('./models');
const { GenerationRepository } = require('./repository');
const eventBus = require('../shared/events').default;

// For testing compatibility
const events = eventBus.events || eventBus;

/**
 * Generation Service
 * Provides methods for managing generation tasks
 */
class GenerationService {
  /**
   * @param {Object} options - Service options
   * @param {GenerationRepository} [options.repository] - Repository instance
   * @param {Object} [options.pointsService] - Points service for checking balances
   */
  constructor(options = {}) {
    this.repository = options.repository || new GenerationRepository();
    this.pointsService = options.pointsService;
  }

  /**
   * Create a new generation task
   * @param {GenerationRequest|Object} request - Generation request
   * @returns {Promise<GenerationTask>} - Created task
   */
  async createTask(request) {
    try {
      // Ensure request is a GenerationRequest instance
      const generationRequest = request instanceof GenerationRequest
        ? request
        : new GenerationRequest(request);
      
      // Validate request
      const validation = generationRequest.validate();
      if (!validation.isValid) {
        throw new Error(`Invalid generation request: ${validation.errors.join(', ')}`);
      }
      
      // Check if user has sufficient points (if points service is available)
      if (this.pointsService) {
        const cost = generationRequest.getCost();
        const hasSufficientPoints = await this.pointsService.hasSufficientPoints(
          generationRequest.userId,
          cost
        );
        
        if (!hasSufficientPoints) {
          throw new Error(`Insufficient points for generation. Required: ${cost}`);
        }
      }
      
      // Create task ID
      const taskId = uuidv4();
      
      // Create task
      const task = new GenerationTask({
        taskId,
        userId: generationRequest.userId,
        request: generationRequest,
        status: GenerationStatus.PENDING,
        createdAt: new Date()
      });
      
      // Save task
      const savedTask = await this.repository.saveTask(task);
      
      // Publish event
      events.publish('generation:task-created', {
        taskId: savedTask.taskId,
        userId: savedTask.userId,
        type: savedTask.request.type
      });
      
      return savedTask;
    } catch (error) {
      console.error('Error creating generation task:', error);
      throw error;
    }
  }

  /**
   * Get a task by ID
   * @param {string} taskId - Task ID
   * @returns {Promise<GenerationTask|null>} - Found task or null
   */
  async getTaskById(taskId) {
    return this.repository.getTaskById(taskId);
  }

  /**
   * Get tasks for a user
   * @param {string} userId - User ID
   * @param {Object} [options={}] - Query options
   * @returns {Promise<Array<GenerationTask>>} - Found tasks
   */
  async getTasksForUser(userId, options = {}) {
    return this.repository.getTasksForUser(userId, options);
  }

  /**
   * Start processing a task
   * @param {string} taskId - Task ID
   * @returns {Promise<GenerationTask|null>} - Updated task or null
   */
  async startProcessingTask(taskId) {
    try {
      const task = await this.repository.getTaskById(taskId);
      
      if (!task) {
        return null;
      }
      
      if (task.status !== GenerationStatus.PENDING) {
        throw new Error(`Task ${taskId} is not in pending status`);
      }
      
      // Deduct points if points service is available
      if (this.pointsService) {
        const cost = task.request.getCost();
        await this.pointsService.deductPoints(
          task.userId,
          cost,
          'points',
          'generation'
        );
      }
      
      // Update status to processing
      const updatedTask = await this.repository.updateTaskStatus(taskId, GenerationStatus.PROCESSING, {
        startedAt: new Date()
      });
      
      // Publish event
      events.publish('generation:task-processing', {
        taskId,
        userId: task.userId,
        type: task.request.type
      });
      
      return updatedTask;
    } catch (error) {
      console.error(`Error starting task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Complete a task
   * @param {string} taskId - Task ID
   * @param {GenerationResponse|Object} response - Generation response
   * @returns {Promise<GenerationTask|null>} - Updated task or null
   */
  async completeTask(taskId, response) {
    try {
      const task = await this.repository.getTaskById(taskId);
      
      if (!task) {
        return null;
      }
      
      if (task.status !== GenerationStatus.PROCESSING) {
        throw new Error(`Task ${taskId} is not in processing status`);
      }
      
      // Ensure response is a GenerationResponse instance
      const generationResponse = response instanceof GenerationResponse
        ? response
        : new GenerationResponse({
            requestId: taskId,
            userId: task.userId,
            ...response
          });
      
      // Calculate processing time
      generationResponse.processingTime = task.getProcessingTime();
      
      // Update task
      const updatedTask = await this.repository.updateTaskStatus(
        taskId, 
        GenerationStatus.COMPLETED,
        { 
          response: generationResponse,
          completedAt: new Date()
        }
      );
      
      // Publish event
      events.publish('generation:task-completed', {
        taskId,
        userId: task.userId,
        outputs: generationResponse.outputs
      });
      
      return updatedTask;
    } catch (error) {
      console.error(`Error completing task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Fail a task
   * @param {string} taskId - Task ID
   * @param {string} error - Error message
   * @returns {Promise<GenerationTask|null>} - Updated task or null
   */
  async failTask(taskId, error) {
    try {
      const task = await this.repository.getTaskById(taskId);
      
      if (!task) {
        return null;
      }
      
      // Refund points if task was processing and points service is available
      if (task.status === GenerationStatus.PROCESSING && this.pointsService) {
        const cost = task.request.getCost();
        await this.pointsService.addPoints(
          task.userId,
          cost,
          'points',
          'generation-refund'
        );
      }
      
      // Create error response
      const response = new GenerationResponse({
        requestId: taskId,
        userId: task.userId,
        success: false,
        error,
        processingTime: task.getProcessingTime()
      });
      
      // Update task
      const updatedTask = await this.repository.updateTaskStatus(
        taskId,
        GenerationStatus.FAILED,
        { 
          response,
          completedAt: new Date() 
        }
      );
      
      // Publish event
      events.publish('generation:task-failed', {
        taskId,
        userId: task.userId,
        error
      });
      
      return updatedTask;
    } catch (error) {
      console.error(`Error failing task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Cancel a task
   * @param {string} taskId - Task ID
   * @returns {Promise<GenerationTask|null>} - Updated task or null
   */
  async cancelTask(taskId) {
    try {
      const task = await this.repository.getTaskById(taskId);
      
      if (!task) {
        return null;
      }
      
      // Only allow cancellation of pending tasks
      if (task.status !== GenerationStatus.PENDING) {
        throw new Error(`Task ${taskId} cannot be cancelled (status: ${task.status})`);
      }
      
      // Update task
      return this.repository.updateTaskStatus(taskId, GenerationStatus.CANCELLED);
    } catch (error) {
      console.error(`Error cancelling task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Get next pending task for processing
   * @returns {Promise<GenerationTask|null>} - Next pending task or null
   */
  async getNextPendingTask() {
    try {
      const pendingTasks = await this.repository.getPendingTasks({ limit: 1 });
      return pendingTasks.length > 0 ? pendingTasks[0] : null;
    } catch (error) {
      console.error('Error getting next pending task:', error);
      throw error;
    }
  }

  /**
   * Delete a task
   * @param {string} taskId - Task ID
   * @returns {Promise<boolean>} - Whether the task was deleted
   */
  async deleteTask(taskId) {
    return this.repository.deleteTask(taskId);
  }

  /**
   * Clean up old tasks
   * @param {Object} [options={}] - Cleanup options
   * @returns {Promise<number>} - Number of tasks deleted
   */
  async cleanupOldTasks(options = {}) {
    return this.repository.cleanupOldTasks(options);
  }
}

module.exports = { GenerationService }; 