/**
 * Session Service
 * Provides business logic for session management
 */

const { SessionModel, SessionState, ClientType } = require('./models');
const { SessionRepository } = require('./repository');
const eventBus = require('../shared/events').default;
const crypto = require('crypto');

/**
 * Generate a secure API key
 * @private
 * @returns {string} - Generated API key
 */
function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * SessionService
 * Core service for managing user sessions
 */
class SessionService {
  /**
   * @param {SessionRepository} [repository] - Repository instance
   * @param {Object} [options={}] - Additional options
   */
  constructor(repository = null, options = {}) {
    this.repository = repository || new SessionRepository();
    this.options = options;
    
    // Session cleanup interval (30 minutes)
    this.cleanupInterval = null;
    this.cleanupIntervalMs = options.cleanupIntervalMs || 30 * 60 * 1000;
    
    // Start cleanup scheduler
    this._startCleanupScheduler();
  }

  /**
   * Start the cleanup scheduler
   * @private
   */
  _startCleanupScheduler() {
    // Only start in a Node.js environment
    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => {
        this.cleanupExpiredSessions()
          .catch(err => console.error('Error cleaning up sessions:', err));
      }, this.cleanupIntervalMs);
      
      // Ensure cleanup interval doesn't prevent Node from exiting
      if (this.cleanupInterval && typeof this.cleanupInterval.unref === 'function') {
        this.cleanupInterval.unref();
      }
    }
  }

  /**
   * Stop the cleanup scheduler
   * @private
   */
  _stopCleanupScheduler() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Create a new session
   * @param {string} userId - User ID
   * @param {Object} [initialState={}] - Initial session state
   * @returns {Promise<SessionModel>} - Created session
   */
  async createSession(userId, initialState = {}) {
    if (!userId) {
      throw new Error('userId is required to create a session');
    }
    
    // Check if session already exists
    const existingSession = await this.getSessionByUserId(userId);
    if (existingSession) {
      throw new Error(`Session for user ${userId} already exists`);
    }
    
    // Create new session with state
    const stateData = { userId, ...initialState };
    const sessionState = new SessionState(stateData);
    
    // Create session model with state
    const session = new SessionModel({
      userId,
      state: sessionState
    });
    
    // Store in repository
    const createdSession = await this.repository.create(session);
    
    // Publish event
    eventBus.publish('session:created', { 
      userId,
      sessionId: createdSession.sessionId
    });
    
    return createdSession;
  }

  /**
   * Get a session by user ID
   * @param {string} userId - User ID
   * @returns {Promise<SessionModel|null>} - Found session or null
   */
  async getSessionByUserId(userId) {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    return this.repository.findByUserId(userId);
  }

  /**
   * Get a session by session ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<SessionModel|null>} - Found session or null
   */
  async getSessionById(sessionId) {
    if (!sessionId) {
      throw new Error('sessionId is required');
    }
    
    return this.repository.findBySessionId(sessionId);
  }

  /**
   * Find a session by API key
   * @param {string} apiKey - API key to search for
   * @returns {Promise<SessionModel|null>} - Found session or null 
   */
  async getSessionByApiKey(apiKey) {
    if (!apiKey) {
      throw new Error('apiKey is required');
    }
    
    // This is inefficient but works for MVP in-memory implementation
    const sessions = await this.repository.listActive();
    return sessions.find(session => session.state.apiKey === apiKey) || null;
  }

  /**
   * Get or create a session
   * @param {string} userId - User ID
   * @param {Object} [initialState={}] - Initial state if session is created
   * @returns {Promise<SessionModel>} - Existing or created session
   */
  async getOrCreateSession(userId, initialState = {}) {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Try to get existing session
    const existingSession = await this.getSessionByUserId(userId);
    if (existingSession) {
      return existingSession;
    }
    
    // Create new session if not found
    return this.createSession(userId, initialState);
  }

  /**
   * Update a session
   * @param {string} userId - User ID
   * @param {Object} updates - Updates to apply to the session state
   * @returns {Promise<SessionModel|null>} - Updated session or null
   */
  async updateSession(userId, updates) {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Get existing session
    const existingSession = await this.getSessionByUserId(userId);
    if (!existingSession) {
      return null;
    }
    
    // Apply updates
    const updatedSession = await this.repository.update(userId, updates);
    
    // Publish event
    if (updatedSession) {
      eventBus.publish('session:updated', { 
        userId,
        sessionId: updatedSession.sessionId
      });
    }
    
    return updatedSession;
  }

  /**
   * Generate a new API key for a session
   * @param {string} userId - User ID
   * @returns {Promise<string|null>} - New API key or null if session not found
   */
  async generateApiKey(userId) {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Get existing session
    const existingSession = await this.getSessionByUserId(userId);
    if (!existingSession) {
      return null;
    }
    
    // Generate new API key
    const apiKey = generateApiKey();
    
    // Update session with new API key
    const updatedSession = await this.updateSession(userId, { apiKey });
    
    // Return the new API key
    return updatedSession ? apiKey : null;
  }

  /**
   * Revoke API key for a session
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Whether the API key was revoked
   */
  async revokeApiKey(userId) {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Get existing session
    const existingSession = await this.getSessionByUserId(userId);
    if (!existingSession || !existingSession.state.apiKey) {
      return false;
    }
    
    // Update session to remove API key
    const updatedSession = await this.updateSession(userId, { apiKey: null });
    
    // Return success
    return updatedSession !== null;
  }

  /**
   * Add a client connection to a session
   * @param {string} userId - User ID
   * @param {string} clientId - Client ID (should be unique)
   * @param {string} clientType - Client type (from ClientType enum)
   * @param {Object} [clientData={}] - Additional client-specific data
   * @returns {Promise<SessionModel|null>} - Updated session or null
   */
  async addClientConnection(userId, clientId, clientType, clientData = {}) {
    if (!userId || !clientId || !clientType) {
      throw new Error('userId, clientId, and clientType are required');
    }
    
    // Get existing session
    const session = await this.getSessionByUserId(userId);
    if (!session) {
      return null;
    }
    
    // Add to client connections
    const clientConnections = { ...session.state.clientConnections };
    clientConnections[clientId] = {
      type: clientType,
      connectedAt: new Date(),
      active: true,
      ...clientData
    };
    
    // Set as active client if there's no active client yet
    const updates = {
      clientConnections,
      activeClientId: session.state.activeClientId || clientId,
      activeClientType: session.state.activeClientType || clientType
    };
    
    // Update session
    return this.updateSession(userId, updates);
  }

  /**
   * Remove a client connection from a session
   * @param {string} userId - User ID
   * @param {string} clientId - Client ID to remove
   * @returns {Promise<SessionModel|null>} - Updated session or null
   */
  async removeClientConnection(userId, clientId) {
    if (!userId || !clientId) {
      throw new Error('userId and clientId are required');
    }
    
    // Get existing session
    const session = await this.getSessionByUserId(userId);
    if (!session) {
      return null;
    }
    
    // Check if client exists
    if (!session.state.clientConnections[clientId]) {
      return session;  // No change needed
    }
    
    // Remove from client connections
    const clientConnections = { ...session.state.clientConnections };
    delete clientConnections[clientId];
    
    // Update active client if this was the active one
    let updates = { clientConnections };
    
    if (session.state.activeClientId === clientId) {
      // Find another client to set as active, if any
      const nextClientId = Object.keys(clientConnections)[0];
      
      if (nextClientId) {
        updates.activeClientId = nextClientId;
        updates.activeClientType = clientConnections[nextClientId].type;
      } else {
        updates.activeClientId = null;
        updates.activeClientType = null;
      }
    }
    
    // Update session
    return this.updateSession(userId, updates);
  }

  /**
   * Set the active client for a session
   * @param {string} userId - User ID
   * @param {string} clientId - Client ID to set as active
   * @returns {Promise<SessionModel|null>} - Updated session or null
   */
  async setActiveClient(userId, clientId) {
    if (!userId || !clientId) {
      throw new Error('userId and clientId are required');
    }
    
    // Get existing session
    const session = await this.getSessionByUserId(userId);
    if (!session) {
      return null;
    }
    
    // Check if client exists
    if (!session.state.clientConnections[clientId]) {
      throw new Error(`Client ${clientId} does not exist for user ${userId}`);
    }
    
    // Update active client
    const updates = {
      activeClientId: clientId,
      activeClientType: session.state.clientConnections[clientId].type
    };
    
    // Update session
    return this.updateSession(userId, updates);
  }

  /**
   * Refresh a session (extend expiration)
   * @param {string} userId - User ID
   * @param {number} [extensionMs=24*60*60*1000] - How long to extend (default: 24 hours)
   * @returns {Promise<SessionModel|null>} - Updated session or null
   */
  async refreshSession(userId, extensionMs = 24 * 60 * 60 * 1000) {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Get existing session
    const existingSession = await this.getSessionByUserId(userId);
    if (!existingSession) {
      return null;
    }
    
    // Update expiration time
    const newExpiresAt = new Date(Date.now() + extensionMs);
    
    return this.repository.update(userId, { 
      expiresAt: newExpiresAt,
      lastActive: new Date()
    });
  }

  /**
   * End a session
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Whether the session was ended
   */
  async endSession(userId) {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Delete session from repository
    const result = await this.repository.delete(userId);
    
    // Publish event if successful
    if (result) {
      eventBus.publish('session:ended', { userId });
    }
    
    return result;
  }

  /**
   * List all active sessions
   * @returns {Promise<Array<SessionModel>>} - List of active sessions
   */
  async listActiveSessions() {
    return this.repository.listActive();
  }

  /**
   * Count active sessions
   * @returns {Promise<number>} - Count of active sessions
   */
  async countActiveSessions() {
    return this.repository.countActive();
  }

  /**
   * Clean up expired sessions
   * @returns {Promise<number>} - Number of cleaned up sessions
   */
  async cleanupExpiredSessions() {
    return this.repository.cleanupExpired();
  }

  /**
   * Add user to a chat (legacy Telegram method)
   * @param {string} userId - User ID
   * @param {string} chatId - Chat ID
   * @returns {Promise<SessionModel|null>} - Updated session or null
   */
  async addUserToChat(userId, chatId) {
    if (!userId || !chatId) {
      throw new Error('userId and chatId are required');
    }
    
    // Get existing session
    const session = await this.getSessionByUserId(userId);
    if (!session) {
      return null;
    }
    
    // Create a client ID for this Telegram chat
    const clientId = `telegram_${chatId}`;
    
    // Add as client connection and update legacy properties
    const clientConnections = { ...session.state.clientConnections };
    clientConnections[clientId] = {
      type: ClientType.TELEGRAM,
      chatId: chatId,
      connectedAt: new Date(),
      active: true
    };
    
    // Update stationedIn property for legacy compatibility
    const stationedIn = { ...session.state.stationedIn };
    stationedIn[chatId] = true;
    
    // Update session
    return this.updateSession(userId, {
      currentChatId: chatId,
      stationedIn,
      clientConnections,
      activeClientId: clientId,
      activeClientType: ClientType.TELEGRAM
    });
  }

  /**
   * Remove user from a chat (legacy Telegram method)
   * @param {string} userId - User ID
   * @param {string} chatId - Chat ID
   * @returns {Promise<SessionModel|null>} - Updated session or null
   */
  async removeUserFromChat(userId, chatId) {
    if (!userId || !chatId) {
      throw new Error('userId and chatId are required');
    }
    
    // Get existing session
    const session = await this.getSessionByUserId(userId);
    if (!session) {
      return null;
    }
    
    // Update stationedIn property for legacy compatibility
    const stationedIn = { ...session.state.stationedIn };
    delete stationedIn[chatId];
    
    // Remove client connection
    const clientId = `telegram_${chatId}`;
    const clientConnections = { ...session.state.clientConnections };
    delete clientConnections[clientId];
    
    // Update active client if this was the active one
    let updates = { stationedIn, clientConnections };
    
    if (session.state.activeClientId === clientId) {
      // Find another client to set as active, if any
      const nextClientId = Object.keys(clientConnections)[0];
      
      if (nextClientId) {
        updates.activeClientId = nextClientId;
        updates.activeClientType = clientConnections[nextClientId].type;
        // If it's a Telegram client, update currentChatId for legacy compatibility
        if (clientConnections[nextClientId].type === ClientType.TELEGRAM) {
          updates.currentChatId = clientConnections[nextClientId].chatId;
        } else {
          updates.currentChatId = null;
        }
      } else {
        updates.activeClientId = null;
        updates.activeClientType = null;
        updates.currentChatId = null;
      }
    }
    
    // Update session
    return this.updateSession(userId, updates);
  }

  /**
   * Check if user is in a chat (legacy Telegram method)
   * @param {string} userId - User ID
   * @param {string} chatId - Chat ID
   * @returns {Promise<boolean>} - Whether the user is in the chat
   */
  async isUserInChat(userId, chatId) {
    if (!userId || !chatId) {
      throw new Error('userId and chatId are required');
    }
    
    // Get existing session
    const session = await this.getSessionByUserId(userId);
    if (!session) {
      return false;
    }
    
    return session.state.isStationedIn(chatId);
  }

  /**
   * Create a web session for a user
   * @param {string} userId - User ID
   * @param {Object} [clientData={}] - Additional client data
   * @returns {Promise<{session: SessionModel, apiKey: string}|null>} - Session and API key or null
   */
  async createWebSession(userId, clientData = {}) {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Get or create session
    let session = await this.getSessionByUserId(userId);
    let isNewSession = false;
    
    if (!session) {
      session = await this.createSession(userId);
      isNewSession = true;
    }
    
    // Generate an API key if none exists
    let apiKey = session.state.apiKey;
    if (!apiKey) {
      apiKey = generateApiKey();
    }
    
    // Create a client ID for this web session
    const clientId = `web_${Date.now()}`;
    
    // Add as client connection
    const clientConnections = { ...session.state.clientConnections };
    clientConnections[clientId] = {
      type: ClientType.WEB,
      connectedAt: new Date(),
      active: true,
      ...clientData
    };
    
    // Update session
    const updatedSession = await this.updateSession(userId, {
      apiKey,
      clientConnections,
      activeClientId: clientId,
      activeClientType: ClientType.WEB
    });
    
    if (!updatedSession) {
      return null;
    }
    
    return {
      session: updatedSession,
      apiKey,
      isNewSession
    };
  }

  /**
   * Create an API session for a user
   * @param {string} userId - User ID
   * @param {Object} [clientData={}] - Additional client data
   * @returns {Promise<{session: SessionModel, apiKey: string}|null>} - Session and API key or null
   */
  async createApiSession(userId, clientData = {}) {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Get or create session
    let session = await this.getSessionByUserId(userId);
    let isNewSession = false;
    
    if (!session) {
      session = await this.createSession(userId);
      isNewSession = true;
    }
    
    // Generate an API key if none exists
    let apiKey = session.state.apiKey;
    if (!apiKey) {
      apiKey = generateApiKey();
    }
    
    // Create a client ID for this API session
    const clientId = `api_${Date.now()}`;
    
    // Add as client connection
    const clientConnections = { ...session.state.clientConnections };
    clientConnections[clientId] = {
      type: ClientType.API,
      connectedAt: new Date(),
      active: true,
      ...clientData
    };
    
    // Update session
    const updatedSession = await this.updateSession(userId, {
      apiKey,
      clientConnections,
      activeClientId: clientId,
      activeClientType: ClientType.API
    });
    
    if (!updatedSession) {
      return null;
    }
    
    return {
      session: updatedSession,
      apiKey,
      isNewSession
    };
  }

  /**
   * Create a session from legacy lobby data
   * @param {string} userId - User ID
   * @param {Object} lobbyData - Legacy lobby data
   * @returns {Promise<SessionModel>} - Created session
   */
  async createFromLobby(userId, lobbyData) {
    if (!userId) {
      throw new Error('userId is required');
    }
    
    // Convert legacy format to SessionModel
    const session = SessionModel.fromLobby(userId, lobbyData);
    
    // Try to create, handle case where session might already exist
    try {
      return await this.repository.create(session);
    } catch (error) {
      if (error.message.includes('already exists')) {
        // Update existing session instead
        return this.repository.update(userId, session);
      }
      throw error;
    }
  }
}

module.exports = { SessionService }; 