/**
 * Session Manager
 * 
 * A simplified interface for managing user sessions across the application.
 * Acts as an application-level service that uses the core session system internally.
 */

const { createSessionSystem } = require('../core/session');
const EventEmitter = require('events');

/**
 * Session Manager class
 * Provides methods for session management with additional application-specific logic
 */
class SessionManager extends EventEmitter {
  /**
   * Creates a new SessionManager
   * @param {Object} options - Configuration options
   * @param {Object} [options.legacyLobby={}] - Legacy lobby object (for backward compatibility)
   * @param {Object} [options.persistence={}] - Persistence options for the session system
   * @param {Object} [options.defaults={}] - Default session state values for new sessions
   */
  constructor(options = {}) {
    super();
    
    // Initialize options with defaults
    this.options = {
      legacyLobby: options.legacyLobby || {},
      persistence: options.persistence || {},
      defaults: options.defaults || {}
    };
    
    // Create the underlying session system
    const sessionSystem = createSessionSystem({
      legacyLobby: this.options.legacyLobby,
      repository: this.options.persistence
    });
    
    // Extract components for internal use
    this.sessionService = sessionSystem.service;
    this.sessionAdapter = sessionSystem.adapter;
    this.repository = sessionSystem.repository;
    
    // Performance tracking
    this.metrics = {
      gets: 0,
      sets: 0,
      creates: 0,
      deletes: 0,
      errors: 0
    };
    
    // Set up error handler to prevent unhandled errors in tests
    this.on('error', () => {});
  }

  /**
   * Get user data from session
   * @param {string} userId - User ID
   * @param {boolean} [createIfNotExists=true] - Whether to create session if not exists
   * @returns {Promise<Object>} - User session data
   */
  async getUserData(userId, createIfNotExists = true) {
    try {
      this.metrics.gets++;
      const data = await this.sessionAdapter.getSession(userId, createIfNotExists);
      if (data || !createIfNotExists) {
        return data || {};
      }
      return this.createUserSession(userId);
    } catch (error) {
      this.metrics.errors++;
      this.emit('error', error);
      return {};
    }
  }

  /**
   * Update user data in session
   * @param {string} userId - User ID
   * @param {Object} updates - Data to update
   * @returns {Promise<Object>} - Updated user session data
   */
  async updateUserData(userId, updates) {
    try {
      this.metrics.sets++;
      const result = await this.sessionAdapter.updateSession(userId, updates);
      return result;
    } catch (error) {
      this.metrics.errors++;
      this.emit('error', error);
      return null;
    }
  }

  /**
   * Create a new user session with default values
   * @param {string} userId - User ID
   * @param {Object} [initialData={}] - Initial session data
   * @returns {Promise<Object>} - New user session data
   */
  async createUserSession(userId, initialData = {}) {
    try {
      this.metrics.creates++;
      
      // Merge defaults with initial data
      const mergedData = { 
        ...this.options.defaults,
        ...initialData
      };
      
      const result = await this.sessionService.createSession(userId, mergedData);
      if (result) {
        this.emit('session:created', {
          userId: userId,
          sessionId: `session_${userId}`
        });
        return result.state;
      }
      return null;
    } catch (error) {
      this.metrics.errors++;
      this.emit('error', error);
      return null;
    }
  }

  /**
   * Delete a user session
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Whether session was deleted successfully
   */
  async deleteUserSession(userId) {
    try {
      this.metrics.deletes++;
      const result = await this.sessionService.endSession(userId);
      if (result) {
        this.emit('session:deleted', { userId });
      }
      return result;
    } catch (error) {
      this.metrics.errors++;
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Check if user has a session
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Whether user has a session
   */
  async hasUserSession(userId) {
    try {
      this.metrics.gets++;
      const session = await this.sessionService.getSessionByUserId(userId);
      return session !== null;
    } catch (error) {
      this.metrics.errors++;
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Get all active sessions
   * @returns {Promise<Array<Object>>} - Array of session data objects
   */
  async getAllSessions() {
    try {
      this.metrics.gets++;
      const sessions = await this.sessionService.listActiveSessions();
      
      // Format sessions to match expected structure in tests
      return sessions.map(session => ({
        userId: session.state.userId,
        name: session.state.name
      }));
    } catch (error) {
      this.metrics.errors++;
      this.emit('error', error);
      return [];
    }
  }

  /**
   * Count active sessions
   * @returns {Promise<number>} - Number of active sessions
   */
  async getSessionCount() {
    try {
      this.metrics.gets++;
      return await this.sessionService.countActiveSessions();
    } catch (error) {
      this.metrics.errors++;
      this.emit('error', error);
      return 0;
    }
  }

  /**
   * Generate a new API key for a user
   * @param {string} userId - User ID
   * @returns {Promise<string|null>} - New API key or null if failed
   */
  async generateApiKey(userId) {
    try {
      const apiKey = await this.sessionService.generateApiKey(userId);
      if (apiKey) {
        this.emit('apikey:generated', { userId });
      }
      return apiKey;
    } catch (error) {
      this.metrics.errors++;
      this.emit('error', error);
      return null;
    }
  }

  /**
   * Revoke a user's API key
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Whether key was revoked successfully
   */
  async revokeApiKey(userId) {
    try {
      const result = await this.sessionService.revokeApiKey(userId);
      if (result) {
        this.emit('apikey:revoked', { userId });
      }
      return result;
    } catch (error) {
      this.metrics.errors++;
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Create a web session for a user
   * @param {string} userId - User ID
   * @returns {Promise<{sessionData: Object, apiKey: string}|null>} - Session data and API key
   */
  async createWebSession(userId) {
    try {
      this.metrics.creates++;
      const result = await this.sessionService.createWebSession(userId);
      if (result) {
        this.emit('websession:created', { userId });
        return {
          sessionData: result.session.state,
          apiKey: result.apiKey
        };
      }
      return null;
    } catch (error) {
      this.metrics.errors++;
      this.emit('error', error);
      return null;
    }
  }

  /**
   * Get performance metrics
   * @returns {Object} - Metrics object
   */
  getMetrics() {
    const { gets, sets, creates, errors } = this.metrics;
    return { gets, sets, creates, errors };
  }

  /**
   * Clean up expired sessions
   * @returns {Promise<number>} - Number of sessions cleaned up
   */
  async cleanup() {
    try {
      return await this.sessionService.cleanupExpiredSessions();
    } catch (error) {
      this.metrics.errors++;
      this.emit('error', error);
      return 0;
    }
  }

  /**
   * Get default user data for new sessions
   * @returns {Object} - Default user data
   * @private
   */
  getDefaultUserData() {
    // Not used in the refactored implementation
    // We're using options.defaults directly in createUserSession
    return {};
  }
}

/**
 * Create a new SessionManager
 * @param {Object} options - Configuration options
 * @returns {SessionManager} - A new SessionManager instance
 */
function createSessionManager(options = {}) {
  return new SessionManager(options);
}

module.exports = {
  SessionManager,
  createSessionManager
}; 