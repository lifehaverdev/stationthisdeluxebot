/**
 * Session Manager
 * 
 * Manages user sessions for the application.
 * Provides a simplified interface to the SessionService for the new architecture.
 */

const { 
  SessionService, 
  SessionRepository,
  SessionState,
  SessionModel
} = require('./index');
const { AppError } = require('../shared/errors/AppError');

/**
 * SessionManager
 * Manages user sessions and provides an interface for storing/retrieving user data
 */
class SessionManager {
  /**
   * Create a new session manager
   * @param {Object} options - Manager options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.persistence - Persistence configuration
   * @param {string} options.persistence.type - Type of persistence ('memory', 'redis', 'mongo')
   * @param {Object} options.persistence.options - Options for the chosen persistence
   */
  constructor(options = {}) {
    this.logger = options.logger || console;
    
    // Initialize repository based on persistence type
    this.repository = new SessionRepository(options.persistence);
    
    // Initialize service with repository
    this.sessionService = new SessionService(this.repository, {
      cleanupIntervalMs: options.cleanupIntervalMs || 30 * 60 * 1000
    });
    
    this.logger.info('Session manager initialized');
  }

  /**
   * Get user data from session
   * @param {string} userId - User ID to get data for
   * @returns {Promise<Object|null>} - User data or null if not found
   */
  async getUserData(userId) {
    try {
      // Get session by user ID
      const session = await this.sessionService.getSessionByUserId(userId);
      
      if (!session) {
        return null;
      }
      
      // Return the user data from the session state
      return session.state.data || {};
    } catch (error) {
      this.logger.error('Error getting user data', { userId, error });
      throw new AppError('Failed to get user data', {
        code: 'SESSION_GET_FAILED',
        cause: error
      });
    }
  }

  /**
   * Update user data in session
   * @param {string} userId - User ID to update data for
   * @param {Object} data - Data to update
   * @returns {Promise<Object>} - Updated user data
   */
  async updateUserData(userId, data) {
    try {
      // Ensure we have a session
      let session = await this.sessionService.getSessionByUserId(userId);
      
      if (!session) {
        // Create a new session if one doesn't exist
        session = await this.sessionService.createSession(userId, { data });
        return data;
      }
      
      // Update the session with new data
      const updates = {
        state: {
          ...session.state,
          data: {
            ...(session.state.data || {}),
            ...data
          }
        }
      };
      
      const updatedSession = await this.sessionService.updateSession(userId, updates);
      
      if (!updatedSession) {
        throw new Error('Failed to update session');
      }
      
      return updatedSession.state.data || {};
    } catch (error) {
      this.logger.error('Error updating user data', { userId, error });
      throw new AppError('Failed to update user data', {
        code: 'SESSION_UPDATE_FAILED',
        cause: error
      });
    }
  }

  /**
   * Create a new user session
   * @param {string} userId - User ID
   * @param {Object} initialData - Initial user data
   * @returns {Promise<Object>} - Session data
   */
  async createUserSession(userId, initialData = {}) {
    try {
      // Create a new session
      const session = await this.sessionService.createSession(userId, { 
        data: initialData
      });
      
      return session.state.data || {};
    } catch (error) {
      // If session already exists, try to get it
      if (error.message && error.message.includes('already exists')) {
        const session = await this.sessionService.getSessionByUserId(userId);
        return session ? (session.state.data || {}) : null;
      }
      
      this.logger.error('Error creating user session', { userId, error });
      throw new AppError('Failed to create user session', {
        code: 'SESSION_CREATE_FAILED',
        cause: error
      });
    }
  }

  /**
   * End a user session
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Success flag
   */
  async endUserSession(userId) {
    try {
      await this.sessionService.endSession(userId);
      return true;
    } catch (error) {
      this.logger.error('Error ending user session', { userId, error });
      throw new AppError('Failed to end user session', {
        code: 'SESSION_END_FAILED',
        cause: error
      });
    }
  }

  /**
   * Get a list of all active sessions
   * @returns {Promise<Array>} - List of active sessions
   */
  async getActiveSessions() {
    try {
      return await this.sessionService.listActiveSessions();
    } catch (error) {
      this.logger.error('Error listing active sessions', { error });
      throw new AppError('Failed to list active sessions', {
        code: 'SESSION_LIST_FAILED',
        cause: error
      });
    }
  }

  /**
   * Count active sessions
   * @returns {Promise<number>} - Number of active sessions
   */
  async countActiveSessions() {
    try {
      return await this.sessionService.countActiveSessions();
    } catch (error) {
      this.logger.error('Error counting active sessions', { error });
      throw new AppError('Failed to count active sessions', {
        code: 'SESSION_COUNT_FAILED',
        cause: error
      });
    }
  }
}

module.exports = { SessionManager }; 