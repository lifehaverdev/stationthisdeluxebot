/**
 * User Repository Implementation
 * Provides data access for user entities while maintaining backward compatibility
 */

const { Repository } = require('../shared/repository');
const { User, UserCore, UserEconomy, UserPreferences } = require('./models');
const eventBus = require('../shared/events').default;

// This will be replaced with actual DB clients in the future
let legacyDB = null;

/**
 * User Repository
 * Implements the Repository interface for User entities
 */
class UserRepository extends Repository {
  /**
   * @param {Object} options - Repository options
   * @param {Object} [options.legacyUserCoreDB] - Legacy UserCoreDB instance
   * @param {Object} [options.legacyUserEconomyDB] - Legacy UserEconomyDB instance 
   * @param {Object} [options.legacyUserPrefDB] - Legacy UserPrefDB instance
   */
  constructor(options = {}) {
    super();
    
    // Store legacy DB references for backward compatibility
    this.legacyUserCoreDB = options.legacyUserCoreDB;
    this.legacyUserEconomyDB = options.legacyUserEconomyDB;
    this.legacyUserPrefDB = options.legacyUserPrefDB;
    
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
        if (!this.legacyUserCoreDB && legacyDB.UserCore) {
          this.legacyUserCoreDB = new legacyDB.UserCore();
        }
        
        if (!this.legacyUserEconomyDB && legacyDB.UserEconomy) {
          this.legacyUserEconomyDB = new legacyDB.UserEconomy();
        }
        
        if (!this.legacyUserPrefDB && legacyDB.UserPref) {
          this.legacyUserPrefDB = new legacyDB.UserPref();
        }
      } catch (error) {
        console.error('Failed to initialize legacy DB connection:', error);
      }
    }
  }

  /**
   * Create a new user
   * @param {Object} data - User data
   * @returns {Promise<User>} - Created user
   */
  async create(data) {
    // Ensure we have a userId
    if (!data.userId) {
      throw new Error('userId is required to create a user');
    }
    
    const user = new User(data);
    
    // Use legacy DBs to create the user data
    try {
      // Create core user data
      if (this.legacyUserCoreDB) {
        await this.legacyUserCoreDB.writeNewUserData(user.core.userId, user.core);
      }
      
      // Create economy data
      if (this.legacyUserEconomyDB) {
        await this.legacyUserEconomyDB.writeNewUserData(user.core.userId, user.economy);
      }
      
      // Create preferences data
      if (this.legacyUserPrefDB) {
        await this.legacyUserPrefDB.writeNewUserData(user.core.userId, user.preferences);
      }
      
      // Publish event
      eventBus.publish('user:created', { userId: user.core.userId });
      
      return user;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  /**
   * Find a user by ID
   * @param {string} userId - User ID
   * @returns {Promise<User|null>} - Found user or null
   */
  async findById(userId) {
    try {
      // Fetch all user data from legacy DBs
      const userData = {};
      
      // Get core data
      if (this.legacyUserCoreDB) {
        const coreData = await this.legacyUserCoreDB.findOne({ userId });
        if (coreData) {
          Object.assign(userData, coreData);
        } else {
          return null; // No core data found
        }
      }
      
      // Get economy data
      if (this.legacyUserEconomyDB) {
        const economyData = await this.legacyUserEconomyDB.findOne({ userId });
        if (economyData) {
          Object.assign(userData, economyData);
        }
      }
      
      // Get preferences data
      if (this.legacyUserPrefDB) {
        const prefData = await this.legacyUserPrefDB.findOne({ userId });
        if (prefData) {
          Object.assign(userData, prefData);
        }
      }
      
      // Create User object if we found data
      if (Object.keys(userData).length > 0) {
        return new User(userData);
      }
      
      return null;
    } catch (error) {
      console.error(`Error finding user by ID ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Find users by query
   * @param {Object} query - Query criteria
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<Array<User>>} - Found users
   */
  async find(query, options = {}) {
    try {
      // This is a simplified implementation during migration
      // In the future, we'll use more efficient queries
      
      // Get user IDs from core collection
      let userIds = [];
      if (this.legacyUserCoreDB) {
        const coreResults = await this.legacyUserCoreDB.findMany(query);
        userIds = coreResults.map(user => user.userId);
      }
      
      // Fetch complete user data for each ID
      const users = [];
      for (const userId of userIds) {
        const user = await this.findById(userId);
        if (user) {
          users.push(user);
        }
      }
      
      return users;
    } catch (error) {
      console.error('Error finding users:', error);
      throw error;
    }
  }

  /**
   * Update a user by ID
   * @param {string} userId - User ID
   * @param {Object} data - Data to update
   * @returns {Promise<User|null>} - Updated user or null
   */
  async updateById(userId, data) {
    try {
      // First check if user exists
      const existingUser = await this.findById(userId);
      if (!existingUser) {
        return null;
      }
      
      // Create updated user object
      const updatedUser = new User({
        ...existingUser.toJSON(),
        ...data
      });
      
      // Update core data if it changed
      if (this.legacyUserCoreDB) {
        await this.legacyUserCoreDB.writeUserData(userId, updatedUser.core);
      }
      
      // Update economy data if it changed
      if (this.legacyUserEconomyDB) {
        await this.legacyUserEconomyDB.writeUserData(userId, updatedUser.economy);
      }
      
      // Update preferences data if it changed
      if (this.legacyUserPrefDB) {
        await this.legacyUserPrefDB.writeUserData(userId, updatedUser.preferences);
      }
      
      // Publish event
      eventBus.publish('user:updated', { userId });
      
      return updatedUser;
    } catch (error) {
      console.error(`Error updating user by ID ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a user by ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Whether the user was deleted
   */
  async deleteById(userId) {
    try {
      let deleted = false;
      
      // Delete from all collections
      if (this.legacyUserCoreDB) {
        const coreResult = await this.legacyUserCoreDB.deleteOne({ userId });
        deleted = deleted || coreResult.deletedCount > 0;
      }
      
      if (this.legacyUserEconomyDB) {
        const economyResult = await this.legacyUserEconomyDB.deleteOne({ userId });
        deleted = deleted || economyResult.deletedCount > 0;
      }
      
      if (this.legacyUserPrefDB) {
        const prefResult = await this.legacyUserPrefDB.deleteOne({ userId });
        deleted = deleted || prefResult.deletedCount > 0;
      }
      
      // Publish event if any documents were deleted
      if (deleted) {
        eventBus.publish('user:deleted', { userId });
      }
      
      return deleted;
    } catch (error) {
      console.error(`Error deleting user by ID ${userId}:`, error);
      throw error;
    }
  }
}

module.exports = { UserRepository }; 