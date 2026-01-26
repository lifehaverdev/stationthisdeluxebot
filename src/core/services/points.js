/**
 * Points Service
 * 
 * Manages user point balances, purchases, and transactions.
 * Extracted from utils/bot/points.js
 */

class PointsService {
  constructor(options = {}) {
    this.options = {
      // Default configuration
      pointMultiplier: options.pointMultiplier || 540,
      noCoinerStarter: options.noCoinerStarter || 199800,
      ...options
    };
    
    // Dependencies to be injected
    this.userEconomyDB = options.userEconomyDB;
    this.floorplanDB = options.floorplanDB;

    this.creditLedgerDb = options.creditLedgerDb; // NEW: canonical points balance

  }

  /**
   * Get the maximum balance a user can have based on their current balance
   * @param {Object} userObject - User object with balance information
   * @returns {number} - Maximum balance
   */
  getMaxPoints(balance) {
    return Math.floor(
      (balance + this.options.noCoinerStarter) / this.options.pointMultiplier
    );
  }

  /**
   * Check if a user has enough points
   * @param {string|number} userId - User ID
   * @param {number} pointsNeeded - Points needed
   * @returns {boolean} - Whether user has enough points
   */
  async hasEnoughPoints(userId, pointsNeeded) {
    if (this.creditLedgerDb) {
      try {
        const walletAddress = await this._resolveUserWallet(userId);
        const remaining = await this.creditLedgerDb.sumPointsRemainingForWalletAddress(walletAddress);
        return remaining >= pointsNeeded;
      } catch (err) {
        console.error('CreditLedgerDb check failed; falling back to legacy path', err);
      }
    }

    // Fallback: use userEconomyDB balance directly if available
    if (this.userEconomyDB) {
      const userEco = this.userEconomyDB.findOneSync ? this.userEconomyDB.findOneSync({ userId: parseInt(userId) }) : null;
      const balance = userEco ? (userEco.balance || 0) : 0;
      const maxPoints = this.getMaxPoints(balance);
      return maxPoints >= pointsNeeded;
    }

    return false;
  }

  /**
   * Deduct points for a generation task
   * @param {Object} task - Task object containing generation details
   * @returns {Promise<Object>} - Updated balance information
   */
  async deductPointsForTask(task) {
    const { promptObj } = task;
    const userId = parseInt(promptObj.userId);
    
    // Calculate points to deduct based on generation time and type
    const rate = this._getPointRate(promptObj.type);
    const pointsToDeduct = ((task.runningStop - task.runningStart) / 1000) * rate;
    
    // Add these values to task for tracking
    task.rate = rate;
    task.pointsSpent = pointsToDeduct;

    // Handle API requests
    if (task.isAPI) {
      return await this._handleAPIPointDeduction(userId, pointsToDeduct);
    }

    // Handle cook mode
    if (promptObj.isCookMode) {
      return await this._handleCookModePointDeduction(userId, pointsToDeduct, promptObj);
    }

    // Handle standard point deduction
    return await this._handleStandardPointDeduction(userId, pointsToDeduct, task.message);
  }

  /**
   * Add points to a user's balance
   * @param {number} userId - User ID
   * @param {number} amount - Amount of points to add
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Updated balance information
   */
  async addPointsToUser(userId, amount, options = {}) {
    const { source = 'manual', message = null } = options;
    
    // Fallback to database if no session service
    if (!this.userEconomyDB) {
      throw new Error('Either SessionService or UserEconomyDB is required to add points');
    }
    
    const updatedBalance = await this.userEconomyDB.addPoints(userId, amount);
    return {
      userId,
      newBalance: updatedBalance,
      source,
      amountAdded: amount
    };
  }
  
  /**
   * Add qoints (purchased points) to a user
   * @param {number} userId - User ID
   * @param {number} amount - Amount to add
   * @param {string} source - Source of qoints
   * @returns {Promise<Object>} - Updated balance info
   */
  async addQointsToUser(userId, amount, source = 'purchase') {
    // Persist directly to DB (sessions removed)
    // Fallback to database
    if (!this.userEconomyDB) {
      throw new Error('Either SessionService or UserEconomyDB is required to add qoints');
    }
    
    const updatedBalance = await this.userEconomyDB.writeQoints(userId, 
      await this.userEconomyDB.getQoints(userId) + amount
    );
    
    return {
      userId,
      newBalance: updatedBalance,
      source,
      amountAdded: amount
    };
  }

  /**
   * Update group points in database
   * @param {Object} group - Group object
   * @param {number} pointsDeducted - Points to deduct
   * @returns {Promise<void>}
   * @private
   */
  async _updateGroupPoints(group, pointsDeducted) {
    if (!this.floorplanDB) {
      throw new Error('FloorplanDB dependency is required to update group points');
    }
    
    try {
      await this.floorplanDB.writeRoomData(group.chat.id, {
        qoints: group.qoints,
        burnedQoints: (group.burnedQoints || 0) + pointsDeducted
      });
    } catch (error) {
      console.error(`Failed to update group points in DB for group ${group.chat.id}:`, error);
      throw error;
    }
  }

  /**
   * Get point rate for a specific generation type
   * @param {string} type - Generation type
   * @returns {number} - Point rate
   * @private
   */
  _getPointRate(type) {
    const doublePointTypes = ['MS3.2']; // Types that cost double
    return doublePointTypes.includes(type) ? 6 : 2;
  }

  /**
   * Handle API point deduction
   * @param {number} userId - User ID
   * @param {number} pointsToDeduct - Points to deduct
   * @returns {Promise<Object>} - Updated balance information
   * @private
   */
  async _handleAPIPointDeduction(userId, pointsToDeduct) {
    // Sessions removed – operate directly on DB
    // Fallback to database
    if (!this.userEconomyDB) {
      throw new Error('UserEconomyDB dependency is required for API point deduction');
    }
    
    try {
      const userEco = await this.userEconomyDB.findOne({ userId: parseInt(userId) });
      
      if (!userEco) {
        console.error('No user economy found for API user:', userId);
        await this.userEconomyDB.writeQoints(parseInt(userId), 0);
        return { userId, pointsSpent: pointsToDeduct, newBalance: 0 };
      }

      // Subtract points from user's qoints, but don't let it go below 0
      const newBalance = Math.max(0, userEco.qoints - pointsToDeduct);
      
      // Update the DB with new balance
      await this.userEconomyDB.writeQoints(parseInt(userEco.userId), newBalance);
      
      return {
        userId,
        pointsSpent: pointsToDeduct,
        newBalance,
        source: 'api'
      };
    } catch (error) {
      console.error(`Failed to deduct points for API user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Handle cook mode point deduction
   * @param {number} userId - User ID
   * @param {number} pointsToDeduct - Points to deduct 
   * @param {Object} promptObj - Prompt object
   * @returns {Promise<Object>} - Updated balance information
   * @private
   */
  async _handleCookModePointDeduction(userId, pointsToDeduct, promptObj) {
    // Sessions removed – go straight to DB
    // Fallback to database
    if (!this.userEconomyDB) {
      throw new Error('UserEconomyDB dependency is required for cook mode point deduction');
    }
    
    try {
      const userEco = await this.userEconomyDB.findOne({ userId });
      if (userEco) {
        userEco.qoints = Math.max(0, userEco.qoints - pointsToDeduct);
        await this.userEconomyDB.writeQoints(userEco.userId, userEco.qoints);
        
        return {
          userId,
          pointsSpent: pointsToDeduct,
          newBalance: userEco.qoints,
          source: 'cookMode'
        };
      } else {
        throw new Error(`No user economy found for cook mode user: ${userId}`);
      }
    } catch (error) {
      console.error(`Failed to deduct points for cook mode user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Handle standard point deduction (non-API, non-cook mode)
   * @param {number} userId - User ID
   * @param {number} pointsToDeduct - Points to deduct
   * @param {Object} message - Message object
   * @returns {Promise<Object>} - Updated balance information
   * @private
   */
  async _handleStandardPointDeduction(userId, pointsToDeduct, message) {
    // Sessions removed – update DB
    // Fallback to database update
    if (!this.userEconomyDB) {
      throw new Error('UserEconomyDB dependency is required for standard point deduction without SessionService');
    }

    const userEco = await this.userEconomyDB.findOne({ userId: parseInt(userId) });
    if (!userEco) {
      throw new Error(`No user economy found for user ${userId}`);
    }

    const newBalance = (userEco.points || 0) + pointsToDeduct;
    await this.userEconomyDB.writePoints(userId, newBalance);

    return {
      userId,
      pointsSpent: pointsToDeduct,
      newBalance,
      source: 'standard-db'
    };
  }

  // _registerSessionEvents removed – sessions deprecated

  /**
   * Calculate initial points for new users
   * @returns {number} Initial points amount
   */
  calculateInitialPoints() {
    return this.options.noCoinerStarter || 199800;
  }

  /**
   * Calculate points for guest users (limited allocation)
   * @returns {number} Guest points amount
   */
  calculateGuestPoints() {
    // Guests get a fraction of regular starter points
    return Math.floor((this.options.noCoinerStarter || 199800) / 5);
  }

  /**
   * Add points back to a wallet via a confirmed credit ledger entry.
   * Mirrors the ADMIN_GIFT flow used by the admin dashboard.
   *
   * @param {Object} options
   * @param {string} options.walletAddress - Wallet to credit (depositor_address)
   * @param {string|ObjectId} [options.masterAccountId] - User's master account ID
   * @param {number} options.points - Points to add
   * @param {string} options.rewardType - Ledger entry type (e.g. 'TRAINING_REFUND')
   * @param {string} options.description - Human-readable reason
   * @param {Object} [options.relatedItems={}] - Contextual metadata stored on the entry
   * @returns {Promise<Object>} The created credit ledger entry
   */
  async addPoints(options) {
    const { walletAddress, masterAccountId, points, rewardType, description, relatedItems = {} } = options;

    if (!this.creditLedgerDb) {
      throw new Error('creditLedgerDb is required for addPoints');
    }
    if (!walletAddress) {
      throw new Error('walletAddress is required for addPoints');
    }
    if (!points || points <= 0) {
      throw new Error('points must be a positive number');
    }

    return this.creditLedgerDb.createRewardCreditEntry({
      masterAccountId: masterAccountId || null,
      points,
      rewardType: rewardType || 'TRAINING_REFUND',
      description: description || `Refund of ${points} points`,
      relatedItems,
      depositorAddress: walletAddress,
    });
  }

  /**
   * Deduct points for a training job
   * Uses credit ledger (wallet-based) system exclusively
   *
   * @param {Object} options - Deduction options
   * @param {string} options.walletAddress - User's wallet address (required)
   * @param {number} options.pointsToDeduct - Points to deduct
   * @param {Object} [options.metadata] - Additional metadata for the transaction
   * @param {string} [options.metadata.trainingId] - Training job ID
   * @param {string} [options.metadata.modelName] - Name of the trained model
   * @param {number} [options.metadata.trainingCostUsd] - Cost in USD
   * @returns {Promise<Object>} Deduction result
   */
  async deductPointsForTraining(options) {
    const { walletAddress, pointsToDeduct, metadata = {} } = options;

    if (!walletAddress) {
      throw new Error('walletAddress is required for training deduction');
    }

    if (!this.creditLedgerDb) {
      throw new Error('creditLedgerDb is required for training deduction');
    }

    if (!pointsToDeduct || pointsToDeduct <= 0) {
      throw new Error('pointsToDeduct must be a positive number');
    }

    const result = await this._deductFromCreditLedger(walletAddress, pointsToDeduct, metadata);
    return {
      success: true,
      source: 'credit_ledger',
      walletAddress,
      pointsDeducted: pointsToDeduct,
      ...result,
      metadata
    };
  }

  /**
   * Deduct points from credit ledger (across multiple deposits if needed)
   * @param {string} walletAddress - User's wallet address
   * @param {number} pointsToDeduct - Points to deduct
   * @param {Object} metadata - Transaction metadata
   * @returns {Promise<Object>} Deduction details
   * @private
   */
  async _deductFromCreditLedger(walletAddress, pointsToDeduct, metadata) {
    // Get total available
    const totalAvailable = await this.creditLedgerDb.sumPointsRemainingForWalletAddress(walletAddress);

    if (totalAvailable < pointsToDeduct) {
      throw new Error(
        `Insufficient points. Available: ${totalAvailable}, Required: ${pointsToDeduct}`
      );
    }

    // Get active entries sorted by funding rate (lowest first)
    const deposits = await this.creditLedgerDb.findActiveDepositsForWalletAddress(walletAddress);

    // Consume refund/reward entries first (no funding_rate_applied),
    // then regular deposits by lowest funding rate.
    deposits.sort((a, b) => {
      const aHasRate = a.funding_rate_applied != null;
      const bHasRate = b.funding_rate_applied != null;
      if (!aHasRate && bHasRate) return -1;
      if (aHasRate && !bHasRate) return 1;
      return (a.funding_rate_applied || 0) - (b.funding_rate_applied || 0);
    });

    let remainingToDeduct = pointsToDeduct;
    const deductions = [];

    for (const deposit of deposits) {
      if (remainingToDeduct <= 0) break;

      const availableInDeposit = deposit.points_remaining || 0;
      const toDeductFromThis = Math.min(availableInDeposit, remainingToDeduct);

      if (toDeductFromThis > 0) {
        await this.creditLedgerDb.deductPointsFromDeposit(deposit._id, toDeductFromThis);
        deductions.push({
          depositId: deposit._id,
          deducted: toDeductFromThis,
          fundingRate: deposit.funding_rate_applied
        });
        remainingToDeduct -= toDeductFromThis;
      }
    }

    if (remainingToDeduct > 0) {
      // Should not happen if totalAvailable check passed, but defensive
      throw new Error(`Failed to deduct all points. Remaining: ${remainingToDeduct}`);
    }

    const newBalance = await this.creditLedgerDb.sumPointsRemainingForWalletAddress(walletAddress);

    return {
      depositsUsed: deductions.length,
      deductions,
      previousBalance: totalAvailable,
      newBalance
    };
  }

}

module.exports = PointsService; 