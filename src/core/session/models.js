/**
 * Session Domain Models
 * Defines the core session entity and related data structures
 */

/**
 * Enum for client types
 * @readonly
 * @enum {string}
 */
const ClientType = {
  TELEGRAM: 'telegram',
  WEB: 'web',
  API: 'api',
  CLI: 'cli'
};

// Freeze the ClientType enum to make it immutable
Object.freeze(ClientType);

/**
 * SessionState
 * Immutable representation of session data at a point in time
 */
class SessionState {
  /**
   * @param {Object} data - Session state data
   * @param {string} data.userId - User ID associated with this session
   * @param {Object} [data.clientConnections={}] - Active client connections
   * @param {Object} [data.stationedIn={}] - Map of chat IDs where user is stationed (legacy)
   * @param {Array} [data.runs=[]] - Recent generation runs
   * @param {Object} [data.state={}] - Current UI state
   * @param {Object} [data.workflow={}] - Current workflow data
   * @param {Array} [data.commandList=[]] - Available commands for this session
   * @param {Object} [data.wallets=[]] - User wallets in session
   * @param {Object} [data.cache={}] - Session-specific cache
   * @param {Date} [data.lastActive=null] - Last activity timestamp
   * @param {string} [data.currentChatId=null] - Current active chat ID (legacy)
   * @param {string} [data.activeClientId=null] - Current active client ID
   * @param {string} [data.activeClientType=null] - Current active client type
   * @param {boolean} [data.verified=false] - Whether the session is verified
   * @param {string} [data.apiKey=null] - API key for web/API access
   */
  constructor(data = {}) {
    // Required properties
    this.userId = data.userId || '';
    
    // Client connection data
    this.clientConnections = Object.freeze(data.clientConnections || {});
    this.activeClientId = data.activeClientId || null;
    this.activeClientType = data.activeClientType || null;
    this.apiKey = data.apiKey || null;
    
    // Legacy chat data (for Telegram compatibility)
    this.stationedIn = Object.freeze(data.stationedIn || {});
    this.currentChatId = data.currentChatId || null;
    
    // Session data
    this.runs = Object.freeze(data.runs || []);
    this.state = Object.freeze(data.state || {}); 
    this.workflow = Object.freeze(data.workflow || {});
    this.commandList = Object.freeze(data.commandList || []);
    this.wallets = Object.freeze(data.wallets || []);
    this.cache = Object.freeze(data.cache || {});
    this.lastActive = data.lastActive || new Date();
    this.verified = data.verified || false;
    
    // Points data carried over from legacy lobby
    this.points = data.points || 0;
    this.doints = data.doints || 0;
    this.qoints = data.qoints || 0;
    this.boints = data.boints || 0;
    
    // Additional settings carried over from lobby
    this.basePrompt = data.basePrompt || '';
    this.checkpoint = data.checkpoint || '';
    this.voiceModel = data.voiceModel || '';
    this.waterMark = data.waterMark || '';
    this.balance = data.balance || 0;
    
    // Freeze this object to ensure immutability
    Object.freeze(this);
  }

  /**
   * Check if the session is active in a specific chat (Telegram)
   * @param {string} chatId - Chat ID to check
   * @returns {boolean} - Whether the session is active in the chat
   */
  isStationedIn(chatId) {
    return this.stationedIn[chatId] === true;
  }

  /**
   * Check if a client connection is active
   * @param {string} clientId - Client ID to check
   * @returns {boolean} - Whether the client connection is active
   */
  hasActiveClient(clientId) {
    return this.clientConnections[clientId] !== undefined;
  }

  /**
   * Get client type for a connection
   * @param {string} clientId - Client ID to check
   * @returns {string|null} - Client type or null if not found
   */
  getClientType(clientId) {
    return this.clientConnections[clientId]?.type || null;
  }

  /**
   * Check if the session is using web interface
   * @returns {boolean} - Whether session is using web interface
   */
  isWebSession() {
    return this.activeClientType === ClientType.WEB || 
           Object.values(this.clientConnections).some(c => c.type === ClientType.WEB);
  }

  /**
   * Check if the session is using API
   * @returns {boolean} - Whether session is using API
   */
  isApiSession() {
    return this.activeClientType === ClientType.API || 
           Object.values(this.clientConnections).some(c => c.type === ClientType.API);
  }

  /**
   * Check if the session is using Telegram
   * @returns {boolean} - Whether session is using Telegram
   */
  isTelegramSession() {
    return this.activeClientType === ClientType.TELEGRAM || 
           Object.values(this.clientConnections).some(c => c.type === ClientType.TELEGRAM);
  }

  /**
   * Check if the session has valid API key
   * @returns {boolean} - Whether the session has valid API key
   */
  hasValidApiKey() {
    return typeof this.apiKey === 'string' && this.apiKey.length > 0;
  }

  /**
   * Check if the session is verified
   * @returns {boolean} - Whether the session is verified
   */
  isVerified() {
    return this.verified === true;
  }

  /**
   * Convert session state to JSON
   * @returns {Object} - JSON representation of this session state
   */
  toJSON() {
    return { ...this };
  }

  /**
   * Create a new state based on this one with the provided updates
   * @param {Object} updates - Updates to apply to current state
   * @returns {SessionState} - New state instance
   */
  withUpdates(updates = {}) {
    return new SessionState({
      ...this.toJSON(),
      ...updates,
      lastActive: new Date()
    });
  }
}

/**
 * SessionModel
 * Complete session entity that may contain additional metadata
 */
class SessionModel {
  /**
   * @param {Object} data - Session data
   * @param {string} data.userId - User ID associated with the session
   * @param {SessionState} [data.state=null] - Current session state
   * @param {Date} [data.createdAt=null] - When the session was created
   * @param {Date} [data.expiresAt=null] - When the session expires
   * @param {string} [data.sessionId=null] - Unique session identifier
   */
  constructor(data = {}) {
    this.userId = data.userId || '';
    this.sessionId = data.sessionId || `session_${this.userId}_${Date.now()}`;
    this.state = data.state || new SessionState({ userId: this.userId });
    this.createdAt = data.createdAt || new Date();
    this.expiresAt = data.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    
    // Tracking properties
    this.lastSyncedAt = data.lastSyncedAt || null;
    this.version = data.version || 1;
  }

  /**
   * Get the user ID associated with this session
   * @returns {string} - User ID
   */
  getUserId() {
    return this.userId;
  }

  /**
   * Get the session ID
   * @returns {string} - Session ID
   */
  getSessionId() {
    return this.sessionId;
  }

  /**
   * Check if the session is expired
   * @returns {boolean} - Whether the session is expired
   */
  isExpired() {
    return new Date() > this.expiresAt;
  }

  /**
   * Update the session state
   * @param {Object} updates - Updates to apply to the state
   * @returns {SessionModel} - Updated session with new state
   */
  updateState(updates = {}) {
    const newState = this.state.withUpdates(updates);
    
    return new SessionModel({
      ...this,
      state: newState,
      version: this.version + 1,
      lastSyncedAt: null // Mark that this version hasn't been synced
    });
  }

  /**
   * Convert session to JSON
   * @returns {Object} - JSON representation of this session
   */
  toJSON() {
    return {
      userId: this.userId,
      sessionId: this.sessionId,
      state: this.state.toJSON(),
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      lastSyncedAt: this.lastSyncedAt,
      version: this.version
    };
  }

  /**
   * Create a SessionModel from a JSON object
   * @param {Object} data - JSON representation of a session
   * @returns {SessionModel} - SessionModel instance
   */
  static fromJSON(data) {
    return new SessionModel({
      ...data,
      state: new SessionState(data.state || {}),
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + 24 * 60 * 60 * 1000),
      lastSyncedAt: data.lastSyncedAt ? new Date(data.lastSyncedAt) : null
    });
  }

  /**
   * Create a session model from a legacy lobby object
   * @param {string} userId - User ID
   * @param {Object} lobbyData - Legacy lobby data
   * @returns {SessionModel} - SessionModel instance
   */
  static fromLobby(userId, lobbyData = {}) {
    if (!userId) {
      throw new Error('User ID is required');
    }

    // Create client connections from stationed chats
    const clientConnections = {};
    if (lobbyData.stationed) {
      Object.keys(lobbyData.stationed).forEach(chatId => {
        clientConnections[`telegram_${chatId}`] = {
          type: ClientType.TELEGRAM,
          chatId: chatId,
          connectedAt: new Date(),
          active: true
        };
      });
    }

    return new SessionModel({
      userId,
      state: new SessionState({
        userId,
        verified: lobbyData.verified || false,
        stationedIn: lobbyData.stationed || {},
        clientConnections,
        activeClientType: Object.keys(clientConnections).length > 0 ? ClientType.TELEGRAM : null,
        activeClientId: Object.keys(clientConnections)[0] || null,
        runs: lobbyData.runs || [],
        commandList: lobbyData.commandList || [],
        wallets: lobbyData.wallets || [],
        points: lobbyData.points || 0,
        doints: lobbyData.doints || 0,
        qoints: lobbyData.qoints || 0,
        boints: lobbyData.boints || 0,
        basePrompt: lobbyData.basePrompt || '',
        checkpoint: lobbyData.checkpoint || '',
        voiceModel: lobbyData.voiceModel || '',
        waterMark: lobbyData.waterMark || '',
        balance: lobbyData.balance || 0,
        lastActive: new Date()
      })
    });
  }
}

module.exports = {
  SessionState,
  SessionModel,
  ClientType
}; 