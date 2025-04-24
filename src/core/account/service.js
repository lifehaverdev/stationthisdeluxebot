/**
 * Account Service
 * 
 * Core service for account management functionality following clean architecture pattern.
 * Handles profile, preferences, API keys, and other account-related operations.
 */

const { AppError } = require('../shared/errors');

/**
 * Account Service
 * Manages user accounts, profiles, and preferences in a platform-agnostic way
 */
class AccountService {
  /**
   * Creates a new AccountService
   * @param {Object} deps - Dependencies
   * @param {Object} deps.userRepository - Repository for user data
   * @param {Object} deps.apiKeyRepository - Repository for API keys
   * @param {Object} deps.logger - Logger instance
   */
  constructor({ userRepository, apiKeyRepository, logger }) {
    this.userRepository = userRepository;
    this.apiKeyRepository = apiKeyRepository;
    this.logger = logger;
  }

  /**
   * Get a user's profile information
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User profile information
   */
  async getUserProfile(userId) {
    try {
      const userData = await this.userRepository.findOne({ userId });
      if (!userData) {
        return {
          name: null,
          username: null,
          createdAt: Date.now(),
          verified: false
        };
      }
      
      return {
        name: userData.name,
        username: userData.username,
        createdAt: userData.createdAt || Date.now(),
        verified: userData.verified || false,
        email: userData.email
      };
    } catch (error) {
      this.logger.error('Error fetching user profile', { userId, error });
      throw new AppError('Failed to fetch profile', 'FETCH_PROFILE_FAILED');
    }
  }

  /**
   * Update a user's profile information
   * @param {string} userId - User ID
   * @param {Object} profileData - Updated profile data
   * @returns {Promise<Object>} Updated profile information
   */
  async updateUserProfile(userId, profileData) {
    try {
      // Validate profile data
      const validFields = ['name', 'username', 'email'];
      const cleanData = {};
      
      Object.keys(profileData).forEach(key => {
        if (validFields.includes(key)) {
          cleanData[key] = profileData[key];
        }
      });
      
      // Update user data
      await this.userRepository.update({ userId }, cleanData);
      
      // Return updated profile
      return this.getUserProfile(userId);
    } catch (error) {
      this.logger.error('Error updating user profile', { userId, error });
      throw new AppError('Failed to update profile', 'UPDATE_PROFILE_FAILED');
    }
  }

  /**
   * Get a user's preferences
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User preferences
   */
  async getUserPreferences(userId) {
    try {
      const userData = await this.userRepository.findOne({ userId });
      if (!userData || !userData.preferences) {
        return {
          notifications: true,
          language: 'en',
          theme: 'default'
        };
      }
      
      return {
        notifications: userData.preferences.notifications !== false,
        language: userData.preferences.language || 'en',
        theme: userData.preferences.theme || 'default'
      };
    } catch (error) {
      this.logger.error('Error fetching user preferences', { userId, error });
      throw new AppError('Failed to fetch preferences', 'FETCH_PREFERENCES_FAILED');
    }
  }

  /**
   * Update a user's preferences
   * @param {string} userId - User ID
   * @param {Object} preferencesData - Updated preferences data
   * @returns {Promise<Object>} Updated preferences
   */
  async updateUserPreferences(userId, preferencesData) {
    try {
      // Validate preferences data
      const validFields = ['notifications', 'language', 'theme'];
      const cleanData = {};
      
      Object.keys(preferencesData).forEach(key => {
        if (validFields.includes(key)) {
          cleanData[key] = preferencesData[key];
        }
      });
      
      // Get current user data
      const userData = await this.userRepository.findOne({ userId });
      if (!userData) {
        // Create new user if not exists
        await this.userRepository.create({
          userId,
          createdAt: Date.now(),
          preferences: cleanData
        });
      } else {
        // Update existing preferences
        await this.userRepository.update(
          { userId }, 
          { preferences: { ...userData.preferences, ...cleanData } }
        );
      }
      
      // Return updated preferences
      return this.getUserPreferences(userId);
    } catch (error) {
      this.logger.error('Error updating user preferences', { userId, error });
      throw new AppError('Failed to update preferences', 'UPDATE_PREFERENCES_FAILED');
    }
  }

  /**
   * Get API keys for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} List of API keys
   */
  async getUserApiKeys(userId) {
    try {
      const apiKeys = await this.apiKeyRepository.find({ userId });
      return apiKeys.map(key => ({
        id: key.id,
        name: key.name,
        createdAt: key.createdAt,
        lastUsed: key.lastUsed,
        // Don't return the actual key, only metadata
        truncatedKey: key.key ? `${key.key.substring(0, 4)}...${key.key.substring(key.key.length - 4)}` : null
      }));
    } catch (error) {
      this.logger.error('Error fetching user API keys', { userId, error });
      throw new AppError('Failed to fetch API keys', 'FETCH_API_KEYS_FAILED');
    }
  }

  /**
   * Generate a new API key for a user
   * @param {string} userId - User ID
   * @param {string} keyName - Name for the new key
   * @returns {Promise<Object>} New API key information
   */
  async generateApiKey(userId, keyName) {
    try {
      // Generate a random API key
      const key = `sk-${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
      
      // Save the key
      const apiKey = await this.apiKeyRepository.create({
        userId,
        name: keyName,
        key,
        createdAt: Date.now(),
        lastUsed: null
      });
      
      // Return the key (only returned once at creation)
      return {
        id: apiKey.id,
        name: apiKey.name,
        key, // Full key is only returned at creation time
        createdAt: apiKey.createdAt
      };
    } catch (error) {
      this.logger.error('Error generating API key', { userId, error });
      throw new AppError('Failed to generate API key', 'GENERATE_API_KEY_FAILED');
    }
  }

  /**
   * Delete an API key
   * @param {string} userId - User ID
   * @param {string} keyId - ID of the key to delete
   * @returns {Promise<boolean>} Success status
   */
  async deleteApiKey(userId, keyId) {
    try {
      await this.apiKeyRepository.delete({ userId, id: keyId });
      return true;
    } catch (error) {
      this.logger.error('Error deleting API key', { userId, keyId, error });
      throw new AppError('Failed to delete API key', 'DELETE_API_KEY_FAILED');
    }
  }

  /**
   * Delete a user account and all associated data
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteUserAccount(userId) {
    try {
      // Delete API keys
      await this.apiKeyRepository.deleteMany({ userId });
      
      // Delete user data
      await this.userRepository.delete({ userId });
      
      return true;
    } catch (error) {
      this.logger.error('Error deleting user account', { userId, error });
      throw new AppError('Failed to delete user account', 'DELETE_ACCOUNT_FAILED');
    }
  }
}

module.exports = AccountService; 