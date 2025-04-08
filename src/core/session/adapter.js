/**
 * Session Adapter
 * Provides compatibility layer between legacy lobby system and new session management
 */

const { SessionModel, ClientType } = require('./models');
const { SessionService } = require('./service');

/**
 * Creates a session adapter to bridge between legacy lobby and the new session system
 * @param {Object} legacyLobby - Reference to legacy lobby object
 * @param {SessionService} [sessionService] - Optional session service instance
 * @returns {Object} - Session adapter interface
 */
function createSessionAdapter(legacyLobby = {}, sessionService = null) {
  if (!sessionService) {
    sessionService = new SessionService();
  }

  return {
    /**
     * Get a session value, trying the new system first, then falling back to legacy
     * @param {string} userId - User ID
     * @param {boolean} [createIfNotExists=true] - Whether to create a session if it doesn't exist
     * @returns {Promise<Object|null>} - Session state data or null
     */
    async getSession(userId, createIfNotExists = true) {
      if (!userId) {
        throw new Error('userId is required');
      }
      
      // Try to get from new system first
      let session = await sessionService.getSessionByUserId(userId);
      
      // If session doesn't exist in new system but exists in legacy system, migrate it
      if (!session && legacyLobby[userId]) {
        session = await sessionService.createFromLobby(userId, legacyLobby[userId]);
      } 
      // If session doesn't exist anywhere but createIfNotExists is true, create it
      else if (!session && createIfNotExists) {
        session = await sessionService.createSession(userId);
      }
      
      // Return the state or null
      return session ? session.state : null;
    },

    /**
     * Get a session by API key
     * @param {string} apiKey - API key
     * @returns {Promise<Object|null>} - Session state data or null
     */
    async getSessionByApiKey(apiKey) {
      if (!apiKey) {
        throw new Error('apiKey is required');
      }
      
      // Try to get from new system
      const session = await sessionService.getSessionByApiKey(apiKey);
      
      // Return the state or null
      return session ? session.state : null;
    },

    /**
     * Update a session value
     * @param {string} userId - User ID
     * @param {Object} updates - Updates to apply
     * @param {boolean} [updateLegacy=true] - Whether to also update legacy lobby
     * @returns {Promise<Object|null>} - Updated session state or null
     */
    async updateSession(userId, updates, updateLegacy = true) {
      if (!userId) {
        throw new Error('userId is required');
      }
      
      // Update in new system
      const updatedSession = await sessionService.updateSession(userId, updates);
      
      // Also update in legacy system if requested
      if (updateLegacy && updatedSession) {
        // Make sure user exists in legacy system
        if (!legacyLobby[userId]) {
          legacyLobby[userId] = {};
        }
        
        // Apply updates to legacy lobby
        Object.entries(updates).forEach(([key, value]) => {
          // Skip client-specific fields that don't belong in the legacy lobby
          if (
            key !== 'clientConnections' && 
            key !== 'activeClientId' && 
            key !== 'activeClientType'
          ) {
            legacyLobby[userId][key] = value;
          }
        });
        
        // Special handling for stationedIn updates (sync with legacy stationed)
        if (updates.stationedIn) {
          legacyLobby[userId].stationed = updates.stationedIn;
        }
      }
      
      // Return the state or null
      return updatedSession ? updatedSession.state : null;
    },

    /**
     * Check if user is stationed in a chat
     * @param {string} userId - User ID
     * @param {string} chatId - Chat ID
     * @returns {Promise<boolean>} - Whether user is stationed in the chat
     */
    async isStationedIn(userId, chatId) {
      if (!userId || !chatId) {
        throw new Error('userId and chatId are required');
      }
      
      // Try new system first
      const session = await sessionService.getSessionByUserId(userId);
      if (session) {
        return session.state.isStationedIn(chatId);
      }
      
      // Fall back to legacy system
      return legacyLobby[userId]?.stationed?.[chatId] === true;
    },

    /**
     * Add user to a chat
     * @param {string} userId - User ID
     * @param {string} chatId - Chat ID
     * @param {boolean} [updateLegacy=true] - Whether to also update legacy lobby
     * @returns {Promise<boolean>} - Whether operation was successful
     */
    async addToChat(userId, chatId, updateLegacy = true) {
      if (!userId || !chatId) {
        throw new Error('userId and chatId are required');
      }
      
      // Update in new system
      const updatedSession = await sessionService.addUserToChat(userId, chatId);
      
      // Also update in legacy system if requested
      if (updateLegacy) {
        // Make sure user exists in legacy system
        if (!legacyLobby[userId]) {
          legacyLobby[userId] = {};
        }
        
        // Make sure stationed object exists
        if (!legacyLobby[userId].stationed) {
          legacyLobby[userId].stationed = {};
        }
        
        // Add to chat
        legacyLobby[userId].stationed[chatId] = true;
        
        // Update current chat ID
        legacyLobby[userId].currentChatId = chatId;
      }
      
      return !!updatedSession;
    },

    /**
     * Remove user from a chat
     * @param {string} userId - User ID
     * @param {string} chatId - Chat ID
     * @param {boolean} [updateLegacy=true] - Whether to also update legacy lobby
     * @returns {Promise<boolean>} - Whether operation was successful
     */
    async removeFromChat(userId, chatId, updateLegacy = true) {
      if (!userId || !chatId) {
        throw new Error('userId and chatId are required');
      }
      
      // Update in new system
      const updatedSession = await sessionService.removeUserFromChat(userId, chatId);
      
      // Also update in legacy system if requested
      if (updateLegacy && legacyLobby[userId]?.stationed) {
        delete legacyLobby[userId].stationed[chatId];
        
        // If we removed the current chat, set current chat to null
        if (legacyLobby[userId].currentChatId === chatId) {
          legacyLobby[userId].currentChatId = null;
        }
      }
      
      return !!updatedSession;
    },

    /**
     * Get all sessions
     * @returns {Promise<Array<Object>>} - Array of session states
     */
    async getAllSessions() {
      const sessions = await sessionService.listActiveSessions();
      return sessions.map(session => session.state);
    },

    /**
     * Create a web session for a user
     * @param {string} userId - User ID
     * @param {Object} [clientData={}] - Additional client data
     * @returns {Promise<{state: Object, apiKey: string}|null>} - Session state and API key or null
     */
    async createWebSession(userId, clientData = {}) {
      if (!userId) {
        throw new Error('userId is required');
      }
      
      const result = await sessionService.createWebSession(userId, clientData);
      if (!result) {
        return null;
      }
      
      return {
        state: result.session.state,
        apiKey: result.apiKey,
        isNewSession: result.isNewSession
      };
    },

    /**
     * Create an API session for a user
     * @param {string} userId - User ID
     * @param {Object} [clientData={}] - Additional client data
     * @returns {Promise<{state: Object, apiKey: string}|null>} - Session state and API key or null
     */
    async createApiSession(userId, clientData = {}) {
      if (!userId) {
        throw new Error('userId is required');
      }
      
      const result = await sessionService.createApiSession(userId, clientData);
      if (!result) {
        return null;
      }
      
      return {
        state: result.session.state,
        apiKey: result.apiKey,
        isNewSession: result.isNewSession
      };
    },

    /**
     * Generate a new API key for a user
     * @param {string} userId - User ID
     * @returns {Promise<string|null>} - New API key or null if not successful
     */
    async generateApiKey(userId) {
      if (!userId) {
        throw new Error('userId is required');
      }
      
      return sessionService.generateApiKey(userId);
    },

    /**
     * Revoke API key for a user
     * @param {string} userId - User ID
     * @returns {Promise<boolean>} - Whether the API key was revoked
     */
    async revokeApiKey(userId) {
      if (!userId) {
        throw new Error('userId is required');
      }
      
      return sessionService.revokeApiKey(userId);
    },

    /**
     * Check if a session is connected via web interface
     * @param {string} userId - User ID
     * @returns {Promise<boolean>} - Whether the session is using web interface
     */
    async isWebSession(userId) {
      if (!userId) {
        throw new Error('userId is required');
      }
      
      const session = await sessionService.getSessionByUserId(userId);
      if (!session) {
        return false;
      }
      
      return session.state.isWebSession();
    },

    /**
     * Check if a session is connected via API
     * @param {string} userId - User ID
     * @returns {Promise<boolean>} - Whether the session is using API
     */
    async isApiSession(userId) {
      if (!userId) {
        throw new Error('userId is required');
      }
      
      const session = await sessionService.getSessionByUserId(userId);
      if (!session) {
        return false;
      }
      
      return session.state.isApiSession();
    },

    /**
     * Get the active client type for a session
     * @param {string} userId - User ID
     * @returns {Promise<string|null>} - Active client type or null
     */
    async getActiveClientType(userId) {
      if (!userId) {
        throw new Error('userId is required');
      }
      
      const session = await sessionService.getSessionByUserId(userId);
      if (!session) {
        return null;
      }
      
      return session.state.activeClientType;
    },

    /**
     * Migrate all users from legacy lobby to new session system
     * @returns {Promise<number>} - Number of migrated users
     */
    async migrateAllFromLobby() {
      let migratedCount = 0;
      
      // Iterate through each user in the legacy lobby
      for (const [userId, userData] of Object.entries(legacyLobby)) {
        try {
          // Check if session already exists
          const existingSession = await sessionService.getSessionByUserId(userId);
          
          if (!existingSession) {
            // Create new session from legacy data
            await sessionService.createFromLobby(userId, userData);
            migratedCount++;
          }
        } catch (error) {
          console.error(`Error migrating user ${userId}:`, error);
        }
      }
      
      return migratedCount;
    },

    /**
     * Get a specific property from a user's session
     * @param {string} userId - User ID
     * @param {string} property - Property name
     * @param {*} [defaultValue=null] - Default value if property doesn't exist
     * @returns {Promise<*>} - Property value or default
     */
    async getSessionProperty(userId, property, defaultValue = null) {
      if (!userId || !property) {
        throw new Error('userId and property are required');
      }
      
      // Try to get from new system first
      const session = await this.getSession(userId, false);
      
      if (session && property in session) {
        return session[property];
      }
      
      // Fall back to legacy system
      if (legacyLobby[userId] && property in legacyLobby[userId]) {
        return legacyLobby[userId][property];
      }
      
      return defaultValue;
    },

    /**
     * Set a specific property in a user's session
     * @param {string} userId - User ID
     * @param {string} property - Property name
     * @param {*} value - Property value
     * @param {boolean} [updateLegacy=true] - Whether to also update legacy lobby
     * @returns {Promise<boolean>} - Whether the operation was successful
     */
    async setSessionProperty(userId, property, value, updateLegacy = true) {
      if (!userId || !property) {
        throw new Error('userId and property are required');
      }
      
      // Create an update object with the property
      const updates = { [property]: value };
      
      // Update session
      const updatedSession = await this.updateSession(userId, updates, updateLegacy);
      
      return !!updatedSession;
    }
  };
}

module.exports = { createSessionAdapter }; 