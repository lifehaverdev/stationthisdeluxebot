/**
 * Points Repository
 * Handles data access for points entities
 */

const { Repository } = require('../shared/repository');
const { UserPoints } = require('./models');
const eventBus = require('../shared/events').default;

// This will be replaced with actual DB clients in the future
let legacyDB = null;

/**
 * Points Repository
 * Implements the Repository interface for points entities
 */
class PointsRepository extends Repository {
  /**
   * @param {Object} options - Repository options
   * @param {Object} [options.legacyUserEconomyDB] - Legacy UserEconomyDB instance
   */
  constructor(options = {}) {
    super();
    
    // Store legacy DB reference for backward compatibility
    this.legacyUserEconomyDB = options.legacyUserEconomyDB;
    
    // Initialize connection with legacy systems if needed
    this._initializeLegacyConnection();
  }

  /**
   * Initialize connection to legacy database if needed
   * @private
   */
  _initializeLegacyConnection() {
    if (!legacyDB && typeof require !== 'undefined') {
      try {
        // This is a temporary solution during migration
        // Will be replaced with proper DI in the future
        legacyDB = require('../../../db/index');
        
        // Use legacy DB connections if not provided in constructor
        if (!this.legacyUserEconomyDB && legacyDB.UserEconomy) {
          this.legacyUserEconomyDB = new legacyDB.UserEconomy();
        }
      } catch (error) {
        console.error('Failed to initialize legacy DB connection:', error);
      }
    }
  }

  /**
   * Get user points by user ID
   * @param {string} userId - User ID
   * @returns {Promise<UserPoints|null>} - User points or null if not found
   */
  async getUserPoints(userId) {
    try {
      if (!this.legacyUserEconomyDB) {
        return null;
      }
      
      const pointsData = await this.legacyUserEconomyDB.findOne({ userId });
      
      if (!pointsData) {
        return null;
      }
      
      return new UserPoints(pointsData);
    } catch (error) {
      console.error(`Error getting points for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Save user points
   * @param {string} userId - User ID
   * @param {UserPoints|Object} points - User points
   * @returns {Promise<UserPoints>} - Updated user points
   */
  async saveUserPoints(userId, points) {
    try {
      if (!this.legacyUserEconomyDB) {
        throw new Error('Legacy database not initialized');
      }
      
      // Convert to UserPoints if it's not already
      const userPoints = points instanceof UserPoints 
        ? points 
        : new UserPoints({ userId, ...points });
      
      // Ensure user ID is set
      if (!userPoints.userId) {
        userPoints.userId = userId;
      }
      
      // Update in database
      await this.legacyUserEconomyDB.writeUserData(userId, userPoints);
      
      // Publish event
      eventBus.publish('points:updated', { 
        userId,
        points: userPoints.getBalances()
      });
      
      return userPoints;
    } catch (error) {
      console.error(`Error saving points for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Update specific point type for a user
   * @param {string} userId - User ID
   * @param {string} pointType - Point type
   * @param {number} value - New value
   * @returns {Promise<UserPoints>} - Updated user points
   */
  async updatePointType(userId, pointType, value) {
    try {
      // Get current points
      const currentPoints = await this.getUserPoints(userId);
      
      if (!currentPoints) {
        throw new Error(`User ${userId} not found`);
      }
      
      // Set new value
      currentPoints[pointType] = value;
      
      // Save updated points
      return this.saveUserPoints(userId, currentPoints);
    } catch (error) {
      console.error(`Error updating ${pointType} for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Increment a point type for a user
   * @param {string} userId - User ID
   * @param {string} pointType - Point type
   * @param {number} amount - Amount to increment
   * @returns {Promise<UserPoints>} - Updated user points
   */
  async incrementPoints(userId, pointType, amount) {
    try {
      // Get current points
      const currentPoints = await this.getUserPoints(userId);
      
      if (!currentPoints) {
        throw new Error(`User ${userId} not found`);
      }
      
      // Add points
      const currentValue = currentPoints[pointType] || 0;
      currentPoints[pointType] = currentValue + amount;
      
      // Save updated points
      return this.saveUserPoints(userId, currentPoints);
    } catch (error) {
      console.error(`Error incrementing ${pointType} for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Decrement a point type for a user
   * @param {string} userId - User ID
   * @param {string} pointType - Point type
   * @param {number} amount - Amount to decrement
   * @returns {Promise<UserPoints>} - Updated user points
   */
  async decrementPoints(userId, pointType, amount) {
    try {
      // Get current points
      const currentPoints = await this.getUserPoints(userId);
      
      if (!currentPoints) {
        throw new Error(`User ${userId} not found`);
      }
      
      // Subtract points, but don't go below zero
      const currentValue = currentPoints[pointType] || 0;
      currentPoints[pointType] = Math.max(0, currentValue - amount);
      
      // Save updated points
      return this.saveUserPoints(userId, currentPoints);
    } catch (error) {
      console.error(`Error decrementing ${pointType} for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Set last points update timestamp for a user
   * @param {string} userId - User ID
   * @param {Date} [timestamp=new Date()] - Update timestamp
   * @returns {Promise<UserPoints>} - Updated user points
   */
  async setLastPointsUpdate(userId, timestamp = new Date()) {
    try {
      // Get current points
      const currentPoints = await this.getUserPoints(userId);
      
      if (!currentPoints) {
        throw new Error(`User ${userId} not found`);
      }
      
      // Set timestamp
      currentPoints.lastPointsUpdate = timestamp;
      
      // Save updated points
      return this.saveUserPoints(userId, currentPoints);
    } catch (error) {
      console.error(`Error setting last points update for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Process points for all users (batch operation)
   * @param {Array<Object>} usersPointsUpdates - Array of user points updates
   * @returns {Promise<number>} - Number of users updated
   */
  async batchProcessPoints(usersPointsUpdates) {
    try {
      if (!this.legacyUserEconomyDB) {
        throw new Error('Legacy database not initialized');
      }
      
      // Check if legacy DB has batch support
      if (!this.legacyUserEconomyDB.startBatch) {
        // Fall back to individual updates if no batch support
        let updatedCount = 0;
        
        for (const userPoints of usersPointsUpdates) {
          if (!userPoints.userId) continue;
          
          await this.saveUserPoints(userPoints.userId, userPoints);
          updatedCount++;
        }
        
        return updatedCount;
      }
      
      // Use batch operations if supported
      const batch = this.legacyUserEconomyDB.startBatch();
      let modifiedCount = 0;
      
      for (const userPoints of usersPointsUpdates) {
        if (!userPoints.userId) continue;
        
        batch.updateOne(
          { userId: userPoints.userId },
          userPoints
        );
        
        modifiedCount++;
      }
      
      // Execute the batch
      if (modifiedCount > 0) {
        await batch.executeBatch();
      }
      
      return modifiedCount;
    } catch (error) {
      console.error('Error in batch points processing:', error);
      throw error;
    }
  }
}

module.exports = { PointsRepository }; 