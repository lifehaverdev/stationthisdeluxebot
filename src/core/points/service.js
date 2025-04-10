/**
 * Points Service
 * Provides business logic for managing user points
 */

const { UserPoints, PointType, PointOperation } = require('./models');
const { PointsRepository } = require('./repository');
const PointsCalculationService = require('./calculation-service');
const eventBus = require('../shared/events').default;

/**
 * Points Service
 * Handles point operations, regeneration, and limits
 */
class PointsService {
  /**
   * @param {Object} options - Service options
   * @param {PointsRepository} [options.pointsRepository] - Points repository instance
   * @param {PointsCalculationService} [options.calculationService] - Calculation service instance
   */
  constructor(options = {}) {
    this.pointsRepository = options.pointsRepository || new PointsRepository();
    this.calculationService = options.calculationService || new PointsCalculationService();
  }

  /**
   * Get points for a user
   * @param {string} userId - User ID
   * @returns {Promise<UserPoints|null>} - User points or null if not found
   */
  async getUserPoints(userId) {
    return this.pointsRepository.getUserPoints(userId);
  }

  /**
   * Get individual point balance
   * @param {string} userId - User ID
   * @param {string} pointType - Point type
   * @returns {Promise<number>} - Point balance
   */
  async getPointBalance(userId, pointType) {
    const points = await this.pointsRepository.getUserPoints(userId);
    return points ? (points[pointType] || 0) : 0;
  }

  /**
   * Add points to a user
   * @param {string} userId - User ID
   * @param {number} amount - Amount to add
   * @param {string} pointType - Point type
   * @param {string} [reason='manual'] - Reason for adding points
   * @returns {Promise<UserPoints>} - Updated user points
   */
  async addPoints(userId, amount, pointType = PointType.POINTS, reason = 'manual') {
    // Validate amount
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }
    
    const updatedPoints = await this.pointsRepository.incrementPoints(userId, pointType, amount);
    
    // Record the operation
    const operation = new PointOperation({
      userId,
      type: 'add',
      pointType,
      amount,
      reason
    });
    
    // Publish event
    eventBus.publish('points:added', {
      userId,
      pointType,
      amount,
      reason,
      newBalance: updatedPoints[pointType]
    });
    
    return updatedPoints;
  }

  /**
   * Deduct points from a user
   * @param {string} userId - User ID
   * @param {number} amount - Amount to deduct
   * @param {string} pointType - Point type
   * @param {string} [reason='manual'] - Reason for deducting points
   * @returns {Promise<UserPoints>} - Updated user points
   */
  async deductPoints(userId, amount, pointType = PointType.POINTS, reason = 'manual') {
    // Validate amount
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }
    
    const updatedPoints = await this.pointsRepository.decrementPoints(userId, pointType, amount);
    
    // Record the operation
    const operation = new PointOperation({
      userId,
      type: 'deduct',
      pointType,
      amount,
      reason
    });
    
    // Publish event
    eventBus.publish('points:deducted', {
      userId,
      pointType,
      amount,
      reason,
      newBalance: updatedPoints[pointType]
    });
    
    return updatedPoints;
  }

  /**
   * Check if a user has sufficient points
   * @param {string} userId - User ID
   * @param {number} required - Required amount
   * @param {string} pointType - Point type
   * @returns {Promise<boolean>} - Whether the user has sufficient points
   */
  async hasSufficientPoints(userId, required, pointType = PointType.POINTS) {
    const points = await this.pointsRepository.getUserPoints(userId);
    
    if (!points) {
      return false;
    }
    
    if (pointType === PointType.POINTS) {
      return points.getTotalPoints() >= required;
    }
    
    return (points[pointType] || 0) >= required;
  }

  /**
   * Regenerate points for a user
   * @param {string} userId - User ID
   * @param {Object} [options={}] - Regeneration options
   * @param {string|number} [options.balance] - User's token balance
   * @param {Date} [options.lastUpdate] - Last update timestamp
   * @returns {Promise<UserPoints>} - Updated user points
   */
  async regeneratePoints(userId, options = {}) {
    // Get current points
    const currentPoints = await this.pointsRepository.getUserPoints(userId);
    
    if (!currentPoints) {
      throw new Error(`User ${userId} not found`);
    }
    
    // Get options with defaults
    const balance = options.balance !== undefined ? options.balance : currentPoints.balance;
    const lastUpdate = options.lastUpdate || currentPoints.lastPointsUpdate || new Date();
    
    // Calculate time since last update
    const now = new Date();
    const timeSinceLastUpdate = now - (lastUpdate instanceof Date ? lastUpdate : new Date(lastUpdate));
    
    // Calculate regeneration amount
    const regenerationAmount = this.calculationService.calculateRegenerationAmount(
      balance,
      timeSinceLastUpdate
    );
    
    // Deduct doints by regeneration amount
    currentPoints.doints = Math.max(0, currentPoints.doints - regenerationAmount);
    
    // Update timestamp
    currentPoints.lastPointsUpdate = now;
    
    // Save updated points
    const updatedPoints = await this.pointsRepository.saveUserPoints(userId, currentPoints);
    
    // Publish event
    eventBus.publish('points:regenerated', {
      userId,
      regenerationAmount,
      newDointsBalance: updatedPoints.doints
    });
    
    return updatedPoints;
  }

  /**
   * Process points conversion for a user (points to doints)
   * @param {string} userId - User ID
   * @returns {Promise<UserPoints>} - Updated user points
   */
  async processPointsConversion(userId) {
    // Get current points
    const currentPoints = await this.pointsRepository.getUserPoints(userId);
    
    if (!currentPoints) {
      throw new Error(`User ${userId} not found`);
    }
    
    const oldPoints = currentPoints.points || 0;
    const oldDoints = currentPoints.doints || 0;
    const oldBoints = currentPoints.boints || 0;
    const oldExp = currentPoints.exp || 0;
    
    // Only process if there are actually points to update
    if (oldPoints > 0 || oldDoints > 0 || oldBoints > 0) {
      const totalPoints = oldPoints + oldBoints;
      const newDoints = Math.max(0, oldDoints + oldPoints);
      const newExp = Math.max(0, oldExp + totalPoints);
      
      // Update points
      currentPoints.points = 0;
      currentPoints.doints = newDoints;
      currentPoints.boints = 0;
      currentPoints.exp = newExp;
      currentPoints.lastPointsUpdate = new Date();
      
      // Save updated points
      const updatedPoints = await this.pointsRepository.saveUserPoints(userId, currentPoints);
      
      // Publish event
      eventBus.publish('points:converted', {
        userId,
        oldPoints,
        oldDoints,
        oldBoints,
        oldExp,
        newDoints,
        newExp
      });
      
      return updatedPoints;
    }
    
    return currentPoints;
  }

  /**
   * Process points conversion for all users (batch operation)
   * @param {Array<Object>} users - Array of users with point data
   * @returns {Promise<number>} - Number of users processed
   */
  async batchProcessPointsConversion(users) {
    // Filter users who have points to convert
    const usersToProcess = users.filter(user => 
      (user.points && user.points > 0) || 
      (user.doints && user.doints > 0) || 
      (user.boints && user.boints > 0)
    );
    
    if (usersToProcess.length === 0) {
      return 0;
    }
    
    // Calculate updated points for each user
    const updatedUsers = this.calculationService.batchConvertPoints(usersToProcess);
    
    // Save updates in batch
    const processedCount = await this.pointsRepository.batchProcessPoints(updatedUsers);
    
    // Publish batch event
    eventBus.publish('points:batch-converted', {
      userCount: processedCount
    });
    
    return processedCount;
  }

  /**
   * Check if a user has reached their point limit
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Whether the user has reached their point limit
   */
  async hasReachedPointLimit(userId) {
    const userPoints = await this.pointsRepository.getUserPoints(userId);
    
    if (!userPoints) {
      return false;
    }
    
    return this.calculationService.hasReachedPointLimit(userPoints);
  }

  /**
   * Calculate maximum points for a user based on balance
   * @param {string} userId - User ID
   * @returns {Promise<number>} - Maximum points allowed
   */
  async calculateMaxPoints(userId) {
    const userPoints = await this.pointsRepository.getUserPoints(userId);
    
    if (!userPoints) {
      return 0;
    }
    
    return this.calculationService.calculateMaxPoints(userPoints.balance);
  }

  /**
   * Calculate time until next point regeneration
   * @param {string} userId - User ID
   * @returns {Promise<number>} - Time in milliseconds until next regeneration
   */
  async getTimeUntilNextRegen(userId) {
    const userPoints = await this.pointsRepository.getUserPoints(userId);
    
    if (!userPoints || !userPoints.lastPointsUpdate) {
      return 0;
    }
    
    return this.calculationService.calculateTimeUntilNextRegen(userPoints.lastPointsUpdate);
  }

  /**
   * Get cost for a generation
   * @param {Object} generationConfig - Generation configuration
   * @returns {number} - Point cost
   */
  getGenerationCost(generationConfig = {}) {
    return this.calculationService.getGenerationCost(generationConfig);
  }

  /**
   * Allocate points for a task
   * @param {string} userId - User ID
   * @param {Object} task - Task details
   * @param {string} task.type - Task type (e.g., 'MS3', 'MS3.3')
   * @param {string} [task.source='manual'] - Source of the task
   * @returns {Promise<Object>} - Updated user points and allocated amount
   */
  async allocateTaskPoints(userId, task) {
    const taskType = task.type || 'DEFAULT';
    
    // Determine points to add based on task type
    const dointsToAdd = taskType === 'MS3.3' ? 1000 : 100;
    
    // Check if user has sufficient doints capacity
    const userPoints = await this.getUserPoints(userId);
    if (!userPoints) {
      throw new Error(`User ${userId} not found`);
    }
    
    // Add doints as a temporary reservation
    const updatedPoints = await this.addPoints(
      userId, 
      dointsToAdd, 
      PointType.DOINTS, 
      `task_allocation:${taskType}`
    );
    
    // Publish specific event for task allocation
    eventBus.publish('points:task:allocated', {
      userId,
      taskType,
      dointsAllocated: dointsToAdd,
      newDointsBalance: updatedPoints.doints
    });
    
    return {
      userPoints: updatedPoints,
      dointsAllocated: dointsToAdd
    };
  }
  
  /**
   * Release allocated points if task fails or is cancelled
   * @param {string} userId - User ID
   * @param {number} amount - Amount to release
   * @param {string} [reason='task_cancelled'] - Reason for releasing
   * @returns {Promise<UserPoints>} - Updated user points
   */
  async releaseTaskPoints(userId, amount, reason = 'task_cancelled') {
    // Deduct the previously added doints
    const updatedPoints = await this.deductPoints(
      userId,
      amount,
      PointType.DOINTS,
      reason
    );
    
    // Publish event
    eventBus.publish('points:task:released', {
      userId,
      amount,
      reason,
      newDointsBalance: updatedPoints.doints
    });
    
    return updatedPoints;
  }
  
  /**
   * Process points after task completion
   * @param {string} userId - User ID
   * @param {Object} task - Task details
   * @param {string} task.type - Task type
   * @param {number} task.runningStart - Task start timestamp
   * @param {number} task.runningStop - Task end timestamp
   * @param {number} task.dointsAllocated - Doints allocated for the task
   * @param {string} [task.groupId] - Group ID if task was executed in a group
   * @returns {Promise<Object>} - Updated points and processing details
   */
  async processTaskCompletion(userId, task) {
    // Get user points
    const userPoints = await this.getUserPoints(userId);
    if (!userPoints) {
      throw new Error(`User ${userId} not found`);
    }
    
    // Calculate points based on task runtime
    let rate = 2;
    const doublePointTypes = ['MS3.2']; 
    if (doublePointTypes.includes(task.type)) {
      rate = 6;
    }
    
    // Use actual runtime or estimate if not available
    const runtime = (task.runningStop && task.runningStart) 
      ? (task.runningStop - task.runningStart) / 1000
      : 30; // Default to 30 seconds if no runtime info
      
    const pointsToAdd = runtime * rate;
    
    // Check for group status
    if (task.groupId) {
      // TODO: Implement group points processing
      // This will be handled by a GroupPointsService in the future
      eventBus.publish('points:task:group', {
        userId,
        groupId: task.groupId,
        pointsToAdd
      });
      
      return {
        userPoints,
        pointsAdded: 0,
        dointsRemoved: task.dointsAllocated || 0,
        groupHandled: true
      };
    }
    
    // For regular users, remove allocated doints and add regular points
    const updatedPoints = await this.deductPoints(
      userId, 
      task.dointsAllocated || 0, 
      PointType.DOINTS, 
      'task_completed'
    );
    
    // Add points based on calculation
    const finalPoints = await this.addPoints(
      userId,
      pointsToAdd,
      PointType.POINTS,
      `task_reward:${task.type}`
    );
    
    // Return updated points and processing details
    return {
      userPoints: finalPoints,
      pointsAdded: pointsToAdd,
      dointsRemoved: task.dointsAllocated || 0,
      rate
    };
  }
}

module.exports = { PointsService }; 