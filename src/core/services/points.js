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
}

module.exports = PointsService; 