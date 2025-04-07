/**
 * User Service
 * Provides business logic for user management operations
 */

const { User } = require('./models');
const UserRepository = require('./repository');
const eventBus = require('../shared/events');

// For testing compatibility
const events = eventBus.events || eventBus;

/**
 * User Service
 * Handles user operations and business logic
 */
class UserService {
  /**
   * @param {Object} options - Service options
   * @param {UserRepository} [options.userRepository] - User repository instance
   */
  constructor(options = {}) {
    this.userRepository = options.userRepository || new UserRepository();
  }

  /**
   * Get a user by ID
   * @param {string} userId - User ID
   * @returns {Promise<User|null>} - User object or null if not found
   */
  async getUserById(userId) {
    return this.userRepository.findById(userId);
  }

  /**
   * Check if a user exists
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Whether the user exists
   */
  async userExists(userId) {
    const user = await this.userRepository.findById(userId);
    return !!user;
  }

  /**
   * Create a new user
   * @param {Object} userData - User data
   * @returns {Promise<User>} - Created user
   */
  async createUser(userData) {
    // Make sure user doesn't already exist
    const existingUser = await this.userRepository.findById(userData.userId);
    if (existingUser) {
      throw new Error(`User with ID ${userData.userId} already exists`);
    }

    // Create the user
    const user = await this.userRepository.create(userData);
    
    // Broadcast event
    events.publish('user:created', { 
      userId: user.core.userId,
      isNew: true
    });
    
    return user;
  }

  /**
   * Update a user
   * @param {string} userId - User ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<User|null>} - Updated user or null if not found
   */
  async updateUser(userId, updates) {
    const updatedUser = await this.userRepository.updateById(userId, updates);
    
    if (updatedUser) {
      // Broadcast event
      events.publish('user:updated', { 
        userId: updatedUser.core.userId
      });
    }
    
    return updatedUser;
  }

  /**
   * Deactivate a user (sets kickedAt)
   * @param {string} userId - User ID
   * @returns {Promise<User|null>} - Updated user or null if not found
   */
  async deactivateUser(userId) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      return null;
    }
    
    return this.userRepository.updateById(userId, {
      kickedAt: new Date()
    });
  }

  /**
   * Reactivate a user (clears kickedAt)
   * @param {string} userId - User ID
   * @returns {Promise<User|null>} - Updated user or null if not found
   */
  async reactivateUser(userId) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      return null;
    }
    
    return this.userRepository.updateById(userId, {
      kickedAt: null
    });
  }

  /**
   * Update user's last activity timestamp
   * @param {string} userId - User ID
   * @returns {Promise<User|null>} - Updated user or null if not found
   */
  async updateLastActivity(userId) {
    return this.userRepository.updateById(userId, {
      lastTouch: new Date()
    });
  }

  /**
   * Verify a user's wallet
   * @param {string} userId - User ID
   * @param {string} wallet - Wallet address
   * @returns {Promise<User|null>} - Updated user or null if not found
   */
  async verifyUserWallet(userId, wallet) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      return null;
    }
    
    // Add wallet to wallets array if not already there
    const wallets = [...(user.core.wallets || [])];
    if (wallet && !wallets.includes(wallet)) {
      wallets.push(wallet);
    }
    
    return this.userRepository.updateById(userId, {
      wallet,
      wallets,
      verified: true
    });
  }

  /**
   * Generate API key for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} - Object containing the API key
   */
  async generateApiKey(userId) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }
    
    // Generate a random API key
    const apiKey = this.generateRandomKey();
    const apiKeyCreatedAt = new Date();
    
    // Update the user with the new API key
    await this.userRepository.updateById(userId, {
      apiKey,
      apiKeyCreatedAt
    });
    
    return { apiKey };
  }

  /**
   * Revoke a user's API key
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Whether the API key was revoked
   */
  async revokeApiKey(userId) {
    const user = await this.userRepository.findById(userId);
    if (!user || !user.core.apiKey) {
      return false;
    }
    
    await this.userRepository.updateById(userId, {
      apiKey: null,
      apiKeyCreatedAt: null
    });
    
    return true;
  }

  /**
   * Initialize a new user with default values
   * @param {string} userId - User ID
   * @param {Object} [initialData={}] - Initial user data
   * @returns {Promise<User>} - Created user
   */
  async initializeNewUser(userId, initialData = {}) {
    // Check if user already exists
    const existingUser = await this.userRepository.findById(userId);
    if (existingUser) {
      return existingUser;
    }
    
    // Create new user with default values
    const userData = {
      userId,
      createdAt: new Date(),
      lastTouch: new Date(),
      ...initialData
    };
    
    return this.createUser(userData);
  }

  /**
   * Delete a user
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Whether the user was deleted
   */
  async deleteUser(userId) {
    const result = await this.userRepository.deleteById(userId);
    
    if (result) {
      // Broadcast event
      events.publish('user:deleted', { 
        userId: userId
      });
    }
    
    return result;
  }

  /**
   * Find users by wallet address
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Array<User>>} - Found users
   */
  async findUsersByWallet(walletAddress) {
    return this.userRepository.find({ wallet: walletAddress });
  }

  /**
   * Generate a random API key
   * @private
   * @returns {string} - Random API key
   */
  generateRandomKey() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15) +
           Date.now().toString(36);
  }
}

module.exports = UserService; 