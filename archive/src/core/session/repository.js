/**
 * Session Repository Implementation
 * Provides data access for session entities
 */

const { Repository } = require('../shared/repository');
const { SessionModel, SessionState } = require('./models');
const eventBus = require('../shared/events').default;

// In-memory session storage (will be replaced with a persistent store in the future)
const SESSION_STORE = new Map();

/**
 * Session Repository
 * Implements the Repository interface for Session entities
 */
class SessionRepository extends Repository {
  /**
   * @param {Object} options - Repository options
   * @param {Object} [options.store] - Optional custom store implementation
   */
  constructor(options = {}) {
    super();
    
    // Use provided store or fallback to default in-memory store
    this.store = options.store || SESSION_STORE;
  }

  /**
   * Create a new session
   * @param {SessionModel|Object} sessionData - Session data
   * @returns {Promise<SessionModel>} - Created session
   */
  async create(sessionData) {
    // Ensure we have a userId
    if (!sessionData.userId) {
      throw new Error('userId is required to create a session');
    }
    
    // Convert to SessionModel if plain object
    const session = sessionData instanceof SessionModel
      ? sessionData
      : new SessionModel(sessionData);
    
    // Check if session already exists
    if (this.store.has(session.userId)) {
      throw new Error(`Session for user ${session.userId} already exists`);
    }
    
    // Store the session
    this.store.set(session.userId, session);
    
    // Publish event
    eventBus.publish('session:created', { 
      userId: session.userId,
      sessionId: session.sessionId
    });
    
    return session;
  }

  /**
   * Find a session by user ID
   * @param {string} userId - User ID
   * @returns {Promise<SessionModel|null>} - Found session or null
   */
  async findByUserId(userId) {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    const session = this.store.get(userId);
    return session || null;
  }

  /**
   * Find a session by session ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<SessionModel|null>} - Found session or null
   */
  async findBySessionId(sessionId) {
    if (!sessionId) {
      throw new Error('sessionId is required');
    }
    
    // Iterate through sessions to find by sessionId
    for (const session of this.store.values()) {
      if (session.sessionId === sessionId) {
        return session;
      }
    }
    
    return null;
  }

  /**
   * Update a session
   * @param {string} userId - User ID
   * @param {SessionModel|Object} sessionData - Updated session data
   * @returns {Promise<SessionModel|null>} - Updated session or null
   */
  async update(userId, updates) {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Check if session exists
    const existingSession = this.store.get(userId);
    if (!existingSession) {
      return null;
    }
    
    let updatedSession;
    
    if (updates instanceof SessionModel) {
      // Use the session model directly
      updatedSession = updates;
    } else if (typeof updates === 'object') {
      // If updates contains a state property that's a complete SessionState
      if (updates.state instanceof SessionState) {
        updatedSession = new SessionModel({
          ...existingSession,
          ...updates,
          version: existingSession.version + 1
        });
      } 
      // If updates.state is a plain object
      else if (updates.state && typeof updates.state === 'object') {
        const newState = new SessionState({
          ...existingSession.state.toJSON(),
          ...updates.state
        });
        
        updatedSession = new SessionModel({
          ...existingSession,
          ...updates,
          state: newState,
          version: existingSession.version + 1
        });
      }
      // If updates are state properties
      else {
        updatedSession = existingSession.updateState(updates);
      }
    } else {
      throw new Error('Updates must be an object or SessionModel instance');
    }
    
    // Update in store
    this.store.set(userId, updatedSession);
    
    // Publish event
    eventBus.publish('session:updated', { 
      userId: updatedSession.userId,
      sessionId: updatedSession.sessionId
    });
    
    return updatedSession;
  }

  /**
   * Delete a session by user ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Whether the session was deleted
   */
  async delete(userId) {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Check if session exists
    const existingSession = this.store.get(userId);
    if (!existingSession) {
      return false;
    }
    
    // Delete from store
    const result = this.store.delete(userId);
    
    // Publish event if delete was successful
    if (result) {
      eventBus.publish('session:deleted', { 
        userId,
        sessionId: existingSession.sessionId
      });
    }
    
    return result;
  }

  /**
   * List all active sessions
   * @returns {Promise<Array<SessionModel>>} - List of all active sessions
   */
  async listActive() {
    const activeSessions = [];
    
    // Get all non-expired sessions
    for (const session of this.store.values()) {
      if (!session.isExpired()) {
        activeSessions.push(session);
      }
    }
    
    return activeSessions;
  }

  /**
   * Count active sessions
   * @returns {Promise<number>} - Number of active sessions
   */
  async countActive() {
    let count = 0;
    
    // Count all non-expired sessions
    for (const session of this.store.values()) {
      if (!session.isExpired()) {
        count++;
      }
    }
    
    return count;
  }

  /**
   * Clean up expired sessions
   * @returns {Promise<number>} - Number of removed sessions
   */
  async cleanupExpired() {
    let removed = 0;
    
    // Remove all expired sessions
    for (const [userId, session] of this.store.entries()) {
      if (session.isExpired()) {
        this.store.delete(userId);
        
        eventBus.publish('session:expired', { 
          userId,
          sessionId: session.sessionId
        });
        
        removed++;
      }
    }
    
    return removed;
  }
}

module.exports = { SessionRepository }; 