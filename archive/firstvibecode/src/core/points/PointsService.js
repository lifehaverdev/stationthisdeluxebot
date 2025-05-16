/**
 * Points Service
 * 
 * Centralized service for managing user points across the application.
 * Handles allocation, finalization, refunding, and logging of point operations.
 */

const { EventEmitter } = require('events');
const { AppError, ERROR_SEVERITY } = require('../shared/errors');

// Point operation types
const POINT_OPERATION = {
  ALLOCATE: 'allocate',
  FINALIZE: 'finalize',
  REFUND: 'refund',
  AWARD: 'award',
  DEDUCT: 'deduct'
};

/**
 * PointsService class
 * Manages user point operations
 */
class PointsService extends EventEmitter {
  /**
   * Create a new PointsService
   * @param {Object} options - Service options
   * @param {Object} options.repository - Data repository for persistent storage
   * @param {Object} [options.analyticsService] - Optional analytics service
   * @param {Object} [options.eventBus] - Optional event bus for system-wide events
   * @param {Object} [options.logger] - Optional logger instance
   */
  constructor(options = {}) {
    super();
    
    if (!options.repository) {
      throw new Error('Repository is required for PointsService');
    }
    
    this.repository = options.repository;
    this.analyticsService = options.analyticsService;
    this.eventBus = options.eventBus;
    this.logger = options.logger || console;
    
    // Keep track of pending allocations
    this.pendingAllocations = new Map();
  }
  
  /**
   * Allocate points for a user task
   * This reserves points but doesn't consume them until finalized
   * 
   * @param {Object} options - Allocation options
   * @param {string} options.userId - User ID
   * @param {string} options.operationId - Unique operation ID (typically taskId)
   * @param {number} options.points - Number of points to allocate
   * @param {string} [options.reason] - Reason for the allocation
   * @param {Object} [options.metadata] - Additional metadata
   * @returns {Promise<Object>} Allocation result
   * @throws {AppError} If allocation fails
   */
  async allocatePoints({ userId, operationId, points, reason = 'task', metadata = {} }) {
    try {
      if (!userId) throw new Error('User ID is required');
      if (!operationId) throw new Error('Operation ID is required');
      if (typeof points !== 'number' || points <= 0) {
        throw new Error('Points must be a positive number');
      }
      
      // Check if points are already allocated for this operation
      if (this.pendingAllocations.has(operationId)) {
        const existing = this.pendingAllocations.get(operationId);
        this.logger.warn(`Points already allocated for operation ${operationId}`, {
          userId,
          operationId,
          existingPoints: existing.points,
          requestedPoints: points
        });
        
        return existing;
      }
      
      // Get current user point balance
      const user = await this.repository.getUser(userId);
      
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }
      
      // Check if user has enough points
      if (user.points < points) {
        throw new AppError('Insufficient points', {
          code: 'INSUFFICIENT_POINTS',
          severity: ERROR_SEVERITY.WARNING,
          details: {
            userId,
            available: user.points,
            required: points
          }
        });
      }
      
      // Create allocation record
      const allocationRecord = {
        userId,
        operationId,
        points,
        reason,
        metadata,
        timestamp: Date.now(),
        status: 'pending',
        originalBalance: user.points
      };
      
      // Store in memory
      this.pendingAllocations.set(operationId, allocationRecord);
      
      // Log the allocation
      this.logger.info(`Allocated ${points} points for user ${userId}`, allocationRecord);
      
      // Emit events
      this._emitEvent(POINT_OPERATION.ALLOCATE, allocationRecord);
      
      return {
        success: true,
        userId,
        operationId,
        points,
        timestamp: allocationRecord.timestamp,
        remainingBalance: user.points - points
      };
    } catch (error) {
      this.logger.error(`Failed to allocate points for user ${userId}`, {
        userId,
        operationId,
        points,
        error: error.message
      });
      
      // Rethrow as AppError
      if (error instanceof AppError) {
        throw error;
      } else {
        throw new AppError(`Points allocation failed: ${error.message}`, {
          severity: ERROR_SEVERITY.ERROR,
          code: 'POINTS_ALLOCATION_FAILED',
          cause: error
        });
      }
    }
  }
  
  /**
   * Finalize points allocation
   * This confirms the usage of previously allocated points
   * 
   * @param {Object} options - Finalization options
   * @param {string} options.operationId - Operation ID of the allocation to finalize
   * @param {number} [options.actualPoints] - Actual points consumed (defaults to allocated amount)
   * @param {string} [options.reason] - Reason for finalization
   * @param {Object} [options.metadata] - Additional metadata
   * @returns {Promise<Object>} Finalization result
   * @throws {AppError} If finalization fails
   */
  async finalizePoints({ operationId, actualPoints, reason, metadata = {} }) {
    try {
      if (!operationId) throw new Error('Operation ID is required');
      
      // Check if there's a pending allocation
      if (!this.pendingAllocations.has(operationId)) {
        throw new Error(`No pending allocation found for operation ${operationId}`);
      }
      
      const allocation = this.pendingAllocations.get(operationId);
      const pointsToDeduct = actualPoints !== undefined ? actualPoints : allocation.points;
      
      if (pointsToDeduct > allocation.points) {
        throw new Error('Actual points cannot exceed allocated points');
      }
      
      // Get current user data
      const user = await this.repository.getUser(allocation.userId);
      
      if (!user) {
        throw new Error(`User ${allocation.userId} not found`);
      }
      
      // Deduct points from user's balance
      const updatedUser = await this.repository.updateUserPoints({
        userId: allocation.userId,
        deduction: pointsToDeduct,
        operation: POINT_OPERATION.FINALIZE,
        metadata: {
          operationId,
          reason: reason || allocation.reason,
          originalAllocation: allocation.points,
          ...metadata
        }
      });
      
      // Create finalization record
      const finalizationRecord = {
        userId: allocation.userId,
        operationId,
        allocatedPoints: allocation.points,
        actualPoints: pointsToDeduct,
        refundedPoints: allocation.points - pointsToDeduct,
        reason: reason || allocation.reason,
        metadata: {
          ...allocation.metadata,
          ...metadata
        },
        timestamp: Date.now(),
        status: 'finalized',
        newBalance: updatedUser.points
      };
      
      // Remove from pending allocations
      this.pendingAllocations.delete(operationId);
      
      // Log the finalization
      this.logger.info(`Finalized ${pointsToDeduct} points for user ${allocation.userId}`, finalizationRecord);
      
      // Emit events
      this._emitEvent(POINT_OPERATION.FINALIZE, finalizationRecord);
      
      // If there was a difference (partial usage), emit refund event too
      if (pointsToDeduct < allocation.points) {
        const refundAmount = allocation.points - pointsToDeduct;
        const refundRecord = {
          ...finalizationRecord,
          points: refundAmount,
          status: 'refunded_partial',
        };
        this._emitEvent(POINT_OPERATION.REFUND, refundRecord);
      }
      
      return {
        success: true,
        userId: allocation.userId,
        operationId,
        allocatedPoints: allocation.points,
        finalizedPoints: pointsToDeduct,
        refundedPoints: allocation.points - pointsToDeduct,
        timestamp: finalizationRecord.timestamp,
        newBalance: updatedUser.points
      };
    } catch (error) {
      this.logger.error(`Failed to finalize points for operation ${operationId}`, {
        operationId,
        error: error.message
      });
      
      // Rethrow as AppError
      if (error instanceof AppError) {
        throw error;
      } else {
        throw new AppError(`Points finalization failed: ${error.message}`, {
          severity: ERROR_SEVERITY.ERROR,
          code: 'POINTS_FINALIZATION_FAILED',
          cause: error
        });
      }
    }
  }
  
  /**
   * Refund allocated points
   * This returns previously allocated points to the user
   * 
   * @param {Object} options - Refund options
   * @param {string} options.operationId - Operation ID of the allocation to refund
   * @param {number} [options.refundAmount] - Amount to refund (defaults to full allocation)
   * @param {string} [options.reason] - Reason for the refund
   * @param {Object} [options.metadata] - Additional metadata
   * @returns {Promise<Object>} Refund result
   * @throws {AppError} If refund fails
   */
  async refundPoints({ operationId, refundAmount, reason = 'task_cancelled', metadata = {} }) {
    try {
      if (!operationId) throw new Error('Operation ID is required');
      
      // Check if there's a pending allocation
      if (!this.pendingAllocations.has(operationId)) {
        throw new Error(`No pending allocation found for operation ${operationId}`);
      }
      
      const allocation = this.pendingAllocations.get(operationId);
      const amountToRefund = refundAmount !== undefined ? refundAmount : allocation.points;
      
      if (amountToRefund > allocation.points) {
        throw new Error('Refund amount cannot exceed allocated points');
      }
      
      // Remove from pending allocations
      this.pendingAllocations.delete(operationId);
      
      // Create refund record
      const refundRecord = {
        userId: allocation.userId,
        operationId,
        points: amountToRefund,
        reason,
        metadata: {
          ...allocation.metadata,
          ...metadata
        },
        timestamp: Date.now(),
        status: 'refunded'
      };
      
      // Log the refund
      this.logger.info(`Refunded ${amountToRefund} points for user ${allocation.userId}`, refundRecord);
      
      // Emit events
      this._emitEvent(POINT_OPERATION.REFUND, refundRecord);
      
      return {
        success: true,
        userId: allocation.userId,
        operationId,
        refundedPoints: amountToRefund,
        timestamp: refundRecord.timestamp
      };
    } catch (error) {
      this.logger.error(`Failed to refund points for operation ${operationId}`, {
        operationId,
        error: error.message
      });
      
      throw new AppError(`Points refund failed: ${error.message}`, {
        severity: ERROR_SEVERITY.ERROR,
        code: 'POINTS_REFUND_FAILED',
        cause: error
      });
    }
  }
  
  /**
   * Award points to a user (increases their balance)
   * 
   * @param {Object} options - Award options
   * @param {string} options.userId - User ID
   * @param {number} options.points - Number of points to award
   * @param {string} [options.reason] - Reason for awarding points
   * @param {Object} [options.metadata] - Additional metadata
   * @returns {Promise<Object>} Award result
   * @throws {AppError} If award fails
   */
  async awardPoints({ userId, points, reason = 'reward', metadata = {} }) {
    try {
      if (!userId) throw new Error('User ID is required');
      if (typeof points !== 'number' || points <= 0) {
        throw new Error('Points must be a positive number');
      }
      
      // Get current user data
      const user = await this.repository.getUser(userId);
      
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }
      
      // Add points to user's balance
      const updatedUser = await this.repository.updateUserPoints({
        userId,
        addition: points,
        operation: POINT_OPERATION.AWARD,
        metadata: {
          reason,
          ...metadata
        }
      });
      
      // Create award record
      const awardRecord = {
        userId,
        points,
        reason,
        metadata,
        timestamp: Date.now(),
        previousBalance: user.points,
        newBalance: updatedUser.points
      };
      
      // Log the award
      this.logger.info(`Awarded ${points} points to user ${userId}`, awardRecord);
      
      // Emit events
      this._emitEvent(POINT_OPERATION.AWARD, awardRecord);
      
      return {
        success: true,
        userId,
        points,
        timestamp: awardRecord.timestamp,
        newBalance: updatedUser.points
      };
    } catch (error) {
      this.logger.error(`Failed to award points to user ${userId}`, {
        userId,
        points,
        error: error.message
      });
      
      throw new AppError(`Points award failed: ${error.message}`, {
        severity: ERROR_SEVERITY.ERROR,
        code: 'POINTS_AWARD_FAILED',
        cause: error
      });
    }
  }
  
  /**
   * Deduct points from a user (decreases their balance)
   * 
   * @param {Object} options - Deduction options
   * @param {string} options.userId - User ID
   * @param {number} options.points - Number of points to deduct
   * @param {string} [options.reason] - Reason for deducting points
   * @param {Object} [options.metadata] - Additional metadata
   * @returns {Promise<Object>} Deduction result
   * @throws {AppError} If deduction fails
   */
  async deductPoints({ userId, points, reason = 'penalty', metadata = {} }) {
    try {
      if (!userId) throw new Error('User ID is required');
      if (typeof points !== 'number' || points <= 0) {
        throw new Error('Points must be a positive number');
      }
      
      // Get current user data
      const user = await this.repository.getUser(userId);
      
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }
      
      // Check if user has enough points
      if (user.points < points) {
        throw new AppError('Insufficient points', {
          code: 'INSUFFICIENT_POINTS',
          severity: ERROR_SEVERITY.WARNING,
          details: {
            userId,
            available: user.points,
            required: points
          }
        });
      }
      
      // Deduct points from user's balance
      const updatedUser = await this.repository.updateUserPoints({
        userId,
        deduction: points,
        operation: POINT_OPERATION.DEDUCT,
        metadata: {
          reason,
          ...metadata
        }
      });
      
      // Create deduction record
      const deductionRecord = {
        userId,
        points,
        reason,
        metadata,
        timestamp: Date.now(),
        previousBalance: user.points,
        newBalance: updatedUser.points
      };
      
      // Log the deduction
      this.logger.info(`Deducted ${points} points from user ${userId}`, deductionRecord);
      
      // Emit events
      this._emitEvent(POINT_OPERATION.DEDUCT, deductionRecord);
      
      return {
        success: true,
        userId,
        points,
        timestamp: deductionRecord.timestamp,
        newBalance: updatedUser.points
      };
    } catch (error) {
      this.logger.error(`Failed to deduct points from user ${userId}`, {
        userId,
        points,
        error: error.message
      });
      
      if (error instanceof AppError) {
        throw error;
      } else {
        throw new AppError(`Points deduction failed: ${error.message}`, {
          severity: ERROR_SEVERITY.ERROR,
          code: 'POINTS_DEDUCTION_FAILED',
          cause: error
        });
      }
    }
  }
  
  /**
   * Get user's current point balance
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User points info
   * @throws {AppError} If retrieval fails
   */
  async getUserPoints(userId) {
    try {
      if (!userId) throw new Error('User ID is required');
      
      // Get current user data
      const user = await this.repository.getUser(userId);
      
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }
      
      // Calculate pending allocations
      let pendingTotal = 0;
      const pendingAllocations = [];
      
      // Collect all pending allocations for this user
      for (const [operationId, allocation] of this.pendingAllocations.entries()) {
        if (allocation.userId === userId) {
          pendingTotal += allocation.points;
          pendingAllocations.push({
            operationId,
            points: allocation.points,
            reason: allocation.reason,
            timestamp: allocation.timestamp
          });
        }
      }
      
      return {
        userId,
        balance: user.points,
        pendingAllocations: pendingTotal,
        availableBalance: user.points - pendingTotal,
        details: {
          pendingOperations: pendingAllocations
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get points for user ${userId}`, {
        userId,
        error: error.message
      });
      
      throw new AppError(`Failed to retrieve user points: ${error.message}`, {
        severity: ERROR_SEVERITY.ERROR,
        code: 'POINTS_RETRIEVAL_FAILED',
        cause: error
      });
    }
  }
  
  /**
   * Calculate the cost of an operation based on parameters
   * 
   * @param {Object} options - Cost calculation options
   * @param {string} options.operationType - Type of operation
   * @param {Object} options.parameters - Operation parameters
   * @returns {number} Calculated cost in points
   */
  calculateCost({ operationType, parameters }) {
    // Implement cost calculation logic based on operation type
    switch (operationType) {
      case 'image_generation':
        // Example: Base cost + additional costs based on resolution
        const { width = 512, height = 512, steps = 20 } = parameters;
        const baseCost = 10;
        const resolutionFactor = (width * height) / (512 * 512);
        const stepFactor = steps / 20;
        
        return Math.ceil(baseCost * resolutionFactor * stepFactor);
        
      case 'text_generation':
        // Example: Cost based on input + output tokens
        const { maxTokens = 100 } = parameters;
        return 5 + Math.ceil(maxTokens / 100);
        
      default:
        return 10; // Default cost
    }
  }
  
  /**
   * Clean up expired allocations
   * 
   * @param {number} maxAgeMs - Maximum age in milliseconds (default: 1 hour)
   * @returns {Object} Cleanup results
   */
  cleanupExpiredAllocations(maxAgeMs = 3600000) {
    const now = Date.now();
    const expiredIds = [];
    
    // Find and collect expired allocations
    for (const [operationId, allocation] of this.pendingAllocations.entries()) {
      if (now - allocation.timestamp > maxAgeMs) {
        expiredIds.push(operationId);
        
        // Log the expiration
        this.logger.info(`Expired allocation for operation ${operationId}`, {
          userId: allocation.userId,
          operationId,
          points: allocation.points,
          age: now - allocation.timestamp
        });
      }
    }
    
    // Remove expired allocations
    for (const operationId of expiredIds) {
      this.pendingAllocations.delete(operationId);
    }
    
    if (expiredIds.length > 0) {
      this.logger.info(`Cleaned up ${expiredIds.length} expired allocations`);
    }
    
    return {
      cleanedCount: expiredIds.length,
      remainingCount: this.pendingAllocations.size
    };
  }
  
  /**
   * Emit events to both local listeners and global event bus
   * 
   * @param {string} operation - Operation type
   * @param {Object} data - Event data
   * @private
   */
  _emitEvent(operation, data) {
    // Emit to local listeners
    this.emit(operation, data);
    this.emit('points_operation', { operation, ...data });
    
    // Emit to global event bus if available
    if (this.eventBus && typeof this.eventBus.emit === 'function') {
      this.eventBus.emit(`points:${operation}`, data);
      this.eventBus.emit('points:operation', { operation, ...data });
    }
    
    // Log to analytics if available
    if (this.analyticsService && typeof this.analyticsService.track === 'function') {
      this.analyticsService.track(`points_${operation}`, {
        userId: data.userId,
        points: data.points,
        operationId: data.operationId,
        reason: data.reason
      });
    }
  }
}

/**
 * Create a points service with the provided options
 * 
 * @param {Object} options - Configuration options
 * @returns {PointsService} Configured points service
 */
function createPointsService(options = {}) {
  return new PointsService(options);
}

module.exports = {
  PointsService,
  createPointsService,
  POINT_OPERATION
}; 