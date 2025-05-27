/**
 * Session Service
 * 
 * Manages user sessions and preferences in a platform-agnostic way.
 * Replaces the global lobby object from the original codebase.
 */

const DEFAULT_CLEAN_INTERVAL = 15 * 60 * 1000; // 15 minutes in milliseconds
const DEFAULT_CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours for asset cache expiry

// Import uuid v4
const { v4: uuidv4 } = require('uuid');

class SessionService {
  /**
   * Create a new Session Service
   * @param {Object} options Configuration options
   * @param {Object} options.db Database adapter for persistent storage
   * @param {number} options.cleanInterval Time in milliseconds before inactive sessions are cleaned
   * @param {Function} options.createDefaultUserData Function to create default user data
   * @param {Object} options.analytics Analytics service for tracking
   * @param {number} options.pointMultiplier Multiplier for point calculations
   * @param {number} options.noCoinerStarter Starter points for users without coins
   * @param {Object} options.models Database models for user data
   */
  constructor(options = {}) {
    this.sessions = {};
    this.db = options.db;
    this.cleanInterval = options.cleanInterval || DEFAULT_CLEAN_INTERVAL;
    this.createDefaultUserData = options.createDefaultUserData || (() => ({}));
    this.analytics = options.analytics;
    this.lastCleanTime = Date.now();
    
    // Point system configuration
    this.pointMulti = options.pointMultiplier || 540;
    this.noCoinerStarter = options.noCoinerStarter || 199800;
    this.cacheExpiryTime = options.cacheExpiryTime || DEFAULT_CACHE_EXPIRY;
    
    // Database models
    this.models = options.models || {};
    
    // Event listeners for lifecycle events
    this.listeners = {
      sessionCreated: [],
      sessionUpdated: [],
      sessionCleaned: [],
      pointsReplenished: []
    };
    
    // Start the cleaning cycle if enabled
    if (options.autoClean !== false) {
      this._startCleaningCycle();
    }
  }

  /**
   * Get a user session by ID, creating it if it doesn't exist
   * @param {string|number} userId The user ID 
   * @param {boolean} touch Whether to update the lastTouch timestamp
   * @returns {Object} The user session data
   */
  getSession(userId, touch = true) {
    userId = String(userId);
    
    // Create session if it doesn't exist
    if (!this.sessions[userId]) {
      const newSession = {
        ...this.createDefaultUserData(),
        sessionId: uuidv4(), // Add a UUIDv4 sessionId
        created: Date.now(),
        lastTouch: Date.now()
      };
      
      this.sessions[userId] = newSession;
      
      // Trigger session created event
      this._triggerEvent('sessionCreated', { userId, session: newSession });
    }
    
    // Update lastTouch if touch is true
    if (touch) {
      this.sessions[userId].lastTouch = Date.now();
    }
    
    // Ensure existing sessions also have a sessionId (for backward compatibility or if created before this change)
    if (!this.sessions[userId].sessionId) {
      this.sessions[userId].sessionId = uuidv4();
    }
    
    return this.sessions[userId];
  }

  /**
   * Check if a user session exists
   * @param {string|number} userId The user ID
   * @returns {boolean} Whether the session exists
   */
  hasSession(userId) {
    userId = String(userId);
    return !!this.sessions[userId];
  }

  /**
   * Update a user session with new data
   * @param {string|number} userId The user ID
   * @param {Object} data The data to update
   * @param {boolean} merge Whether to merge with existing data (true) or replace it (false)
   * @returns {Object} The updated session
   */
  updateSession(userId, data, merge = true) {
    userId = String(userId);
    const session = this.getSession(userId);
    const oldSession = { ...session }; // Save old state for event
    
    if (merge) {
      Object.assign(session, data);
    } else {
      // Preserve system fields
      const { created, lastTouch } = session;
      this.sessions[userId] = {
        ...data,
        created,
        lastTouch: Date.now()
      };
    }
    
    // Trigger session updated event
    this._triggerEvent('sessionUpdated', { 
      userId, 
      oldSession, 
      newSession: this.sessions[userId] 
    });
    
    return this.sessions[userId];
  }

  /**
   * Remove a user session
   * @param {string|number} userId The user ID
   * @param {boolean} persist Whether to persist the session to the database before removing
   * @returns {Promise<boolean>} Whether the session was successfully removed
   */
  async removeSession(userId, persist = true) {
    userId = String(userId);
    
    if (!this.sessions[userId]) {
      return false;
    }
    
    const sessionData = { ...this.sessions[userId] };
    
    // Persist to database if requested and DB adapter is available
    if (persist && this.db) {
      try {
        sessionData.kickedAt = Date.now();
        await this.db.writeUserData(userId, sessionData);
        
        // Track kick in analytics if available
        if (this.analytics) {
          await this.analytics.trackUserKick(userId, sessionData.username || userId);
        }
      } catch (error) {
        console.error(`Error persisting session for user ${userId}:`, error);
      }
    }
    
    // Trigger session cleaned event before deletion
    this._triggerEvent('sessionCleaned', { userId, session: sessionData });
    
    delete this.sessions[userId];
    return true;
  }

  /**
   * Get a specific value from a user session
   * @param {string|number} userId The user ID
   * @param {string} key The key to get
   * @param {*} defaultValue The default value if the key doesn't exist
   * @returns {*} The value
   */
  getValue(userId, key, defaultValue = null) {
    userId = String(userId);
    const session = this.getSession(userId, false);
    return session[key] !== undefined ? session[key] : defaultValue;
  }

  /**
   * Set a specific value in a user session
   * @param {string|number} userId The user ID
   * @param {string} key The key to set
   * @param {*} value The value to set
   * @returns {Object} The updated session
   */
  setValue(userId, key, value) {
    userId = String(userId);
    const session = this.getSession(userId);
    const oldValue = session[key];
    session[key] = value;
    
    // Trigger session updated event only if the value actually changed
    if (oldValue !== value) {
      this._triggerEvent('sessionUpdated', { 
        userId, 
        oldSession: { ...session, [key]: oldValue }, 
        newSession: session,
        changedKey: key
      });
    }
    
    return session;
  }

  /**
   * Check if a user session is inactive and should be cleaned
   * @param {string|number} userId The user ID
   * @returns {boolean} Whether the session should be cleaned
   */
  shouldCleanSession(userId) {
    userId = String(userId);
    
    if (!this.sessions[userId]) {
      return false;
    }
    
    const session = this.sessions[userId];
    const lastTouch = session.lastTouch || 0;
    const timeSinceLastTouch = Date.now() - lastTouch;
    
    return timeSinceLastTouch > this.cleanInterval;
  }

  /**
   * Load a user session from the database
   * @param {string|number} userId The user ID
   * @returns {Promise<Object>} The loaded session
   */
  async loadSession(userId) {
    userId = String(userId);
    
    if (!this.db) {
      console.warn('No database adapter provided for session loading');
      return this.getSession(userId);
    }
    
    try {
      const userData = await this.db.fetchUserData(userId);
      
      if (userData) {
        // If user was kicked, handle point regeneration
        if (userData.kickedAt) {
          this._regenerateDoints(userData);
          delete userData.kickedAt; // Clear kickedAt after regenerating
        }
        
        this.sessions[userId] = {
          ...userData,
          lastTouch: Date.now()
        };
        return this.sessions[userId];
      } else {
        console.log(`No data found for user ${userId}, creating new session`);
        return this.getSession(userId);
      }
    } catch (error) {
      console.error(`Error loading session for user ${userId}:`, error);
      return this.getSession(userId);
    }
  }

  /**
   * Persist a user session to the database
   * @param {string|number} userId The user ID
   * @returns {Promise<boolean>} Whether the session was successfully persisted
   */
  async persistSession(userId) {
    userId = String(userId);
    
    if (!this.db) {
      console.warn('No database adapter provided for session persistence');
      return false;
    }
    
    if (!this.sessions[userId]) {
      return false;
    }
    
    try {
      await this.db.writeUserData(userId, this.sessions[userId]);
      return true;
    } catch (error) {
      console.error(`Error persisting session for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Clean inactive sessions
   * @returns {Promise<number>} The number of sessions cleaned
   */
  async cleanSessions() {
    const now = Date.now();
    let cleaned = 0;
    
    console.log(`Starting session cleaning cycle at ${new Date().toISOString()}`);
    
    // Process points for all users before cleaning
    await this.handlePointsReplenishment();
    
    const userIds = Object.keys(this.sessions);
    for (const userId of userIds) {
      if (this.shouldCleanSession(userId)) {
        try {
          await this.removeSession(userId, true);
          cleaned++;
        } catch (error) {
          console.error(`Error cleaning session for user ${userId}:`, error);
        }
      }
    }
    
    this.lastCleanTime = now;
    console.log(`Cleaned ${cleaned} inactive sessions`);
    
    return cleaned;
  }

  /**
   * Calculate max points based on balance
   * @param {number} balance - User's MS2 token balance
   * @returns {number} - Max points
   */
  calculateMaxPoints(balance) {
    return Math.floor((balance + this.noCoinerStarter) / this.pointMulti);
  }

  /**
   * Add a listener for session lifecycle events
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   * @returns {Function} - Function to remove the listener
   */
  on(event, callback) {
    if (!this.listeners[event]) {
      throw new Error(`Unknown event: ${event}`);
    }
    
    this.listeners[event].push(callback);
    
    // Return function to remove listener
    return () => {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    };
  }

  /**
   * Batch operation on multiple sessions
   * @param {Array<string|number>} userIds - Array of user IDs
   * @param {Function} operation - Operation to perform on each session
   * @returns {Promise<Array>} - Results of the operations
   */
  async batchOperation(userIds, operation) {
    const results = [];
    
    for (const userId of userIds) {
      try {
        const session = this.getSession(userId);
        const result = await operation(session, userId);
        results.push({ userId, success: true, result });
      } catch (error) {
        console.error(`Error in batch operation for user ${userId}:`, error);
        results.push({ userId, success: false, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * Handle asset caching with expiry
   * @param {string|number} userId - User ID
   * @param {string} assetKey - Asset key (token address, NFT address, etc)
   * @param {*} value - Value to cache
   * @returns {Object} - Updated session
   */
  cacheAsset(userId, assetKey, value) {
    const session = this.getSession(userId);
    
    if (!session.assets) {
      session.assets = {};
    }
    
    session.assets[assetKey] = {
      bal: value,
      checked: Date.now()
    };
    
    return session;
  }

  /**
   * Get cached asset if still valid, or null if expired
   * @param {string|number} userId - User ID
   * @param {string} assetKey - Asset key
   * @returns {*} - Cached asset value or null
   */
  getCachedAsset(userId, assetKey) {
    const session = this.getSession(userId, false);
    
    if (!session.assets || !session.assets[assetKey]) {
      return null;
    }
    
    const asset = session.assets[assetKey];
    const timeSinceChecked = Date.now() - asset.checked;
    
    if (timeSinceChecked > this.cacheExpiryTime) {
      return null; // Cache expired
    }
    
    return asset.bal;
  }

  /**
   * Handle the points replenishment cycle
   * This implements the original logic from the lobby cleaning
   * @returns {Promise<number>} The number of sessions updated
   */
  async handlePointsReplenishment() {
    let updated = 0;
    
    // Add points to exp and reset points to zero
    for (const userId in this.sessions) {
      try {
        const session = this.sessions[userId];
        
        if (!session) continue;
        
        // Store old values for event tracking
        const oldPoints = session.points || 0;
        const oldDoints = session.doints || 0;
        const oldExp = session.exp || 0;
        
        // Add exp and reset points
        session.exp = (session.exp || 0) + (session.points || 0);
        session.doints = (session.doints || 0) + (session.points || 0);
        session.boints = 0;
        session.points = 0;
        
        // Apply soft reset for points
        this._softResetPoints(session);
        
        updated++;
        
        // Trigger points replenished event
        this._triggerEvent('pointsReplenished', {
          userId,
          oldPoints,
          oldDoints,
          oldExp,
          newPoints: session.points,
          newDoints: session.doints,
          newExp: session.exp
        });
      } catch (error) {
        console.error(`Error processing points for user ${userId}:`, error);
      }
    }
    
    // If we have a database with batch operations, use it
    if (this.db && typeof this.db.addPointsToAllUsers === 'function') {
      try {
        await this.db.addPointsToAllUsers(this.sessions);
      } catch (error) {
        console.error('Error in batch points update:', error);
      }
    }
    
    return updated;
  }

  /**
   * Apply soft reset to user points
   * @param {Object} session - User session
   * @private
   */
  _softResetPoints(session) {
    const maxPoints = this.calculateMaxPoints(session.balance || 0);
    const regeneratedPoints = (maxPoints / 18);
    
    // Store old values for logging
    const oldDoints = session.doints || 0;
    
    // Always subtract from doints, regardless of points status
    session.doints = Math.max(oldDoints - regeneratedPoints, 0);
    
    console.log(`$$$ SoftReset [${session.userId}] | Balance: ${session.balance} | Doints: ${oldDoints} → ${session.doints} | MaxPoints: ${maxPoints} | Regenerated: ${regeneratedPoints}`);
  }

  /**
   * Regenerate doints for a kicked user
   * @param {Object} userData - User data from database
   * @private
   */
  _regenerateDoints(userData) {
    if (!userData.kickedAt) {
      console.log(`$$$ [${userData.userId}] | Status: Skipped - No kickedAt timestamp`);
      return;
    }

    const timeSinceLastRun = Date.now() - userData.kickedAt;
    const maxPoints = this.calculateMaxPoints(userData.balance || 0);
    const regenerationCycles = Math.floor(timeSinceLastRun / this.cleanInterval);
    const regeneratedPoints = (maxPoints / 18) * regenerationCycles;
    const oldDoints = userData.doints || 0;
    
    userData.doints = Math.max(oldDoints - regeneratedPoints, 0);
    
    console.log(`$$$ [${userData.userId}] Rejoins the fray | Time: ${Math.floor(timeSinceLastRun / 1000)}s | Cycles: ${regenerationCycles} | Balance: ${userData.balance} | Doints: ${oldDoints} → ${userData.doints} | MaxPoints: ${maxPoints}`);
  }

  /**
   * Trigger an event to all listeners
   * @param {string} event - Event name
   * @param {Object} data - Event data
   * @private
   */
  _triggerEvent(event, data) {
    if (!this.listeners[event]) {
      return;
    }
    
    for (const callback of this.listeners[event]) {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in ${event} listener:`, error);
      }
    }
  }

  /**
   * Start the automatic cleaning cycle
   * @private
   */
  _startCleaningCycle() {
    setInterval(() => {
      this.cleanSessions().catch(error => {
        console.error('Error in session cleaning cycle:', error);
      });
    }, this.cleanInterval);
  }

  /**
   * Get user data from database or session
   * @param {string|number} userId The user ID
   * @returns {Promise<Object|null>} The user data or null if not found
   */
  async getUserData(userId) {
    userId = String(userId);
    
    // Check if data is in memory
    if (this.sessions[userId]) {
      return this.sessions[userId];
    }
    
    // Try to load from database
    if (this.db) {
      try {
        const userData = await this.db.readUserData(userId);
        if (userData) {
          // Store in session for future access
          this.sessions[userId] = userData;
          return userData;
        }
      } catch (error) {
        console.error(`Error loading user data for ${userId}:`, error);
      }
    }
    
    return null;
  }
  
  /**
   * Get user data by wallet address
   * @param {string} walletAddress The wallet address
   * @returns {Promise<Object|null>} User data or null if not found
   */
  async getUserDataByWallet(walletAddress) {
    walletAddress = String(walletAddress).toLowerCase();
    
    // First check if we have a session with this wallet
    for (const [userId, session] of Object.entries(this.sessions)) {
      if (session.walletAddress && session.walletAddress.toLowerCase() === walletAddress) {
        return session;
      }
    }
    
    // Try to load from database
    if (this.db) {
      try {
        const userData = await this.db.findUserByWallet(walletAddress);
        if (userData) {
          // Store in session for future access
          this.sessions[userData.id || walletAddress] = userData;
          return userData;
        }
      } catch (error) {
        console.error(`Error loading user data for wallet ${walletAddress}:`, error);
      }
    }
    
    return null;
  }
  
  /**
   * Create a new user
   * @param {Object} userData User data with optional wallet address
   * @returns {Promise<Object>} Created user data
   */
  async createUser(userData) {
    // Generate unique ID if not provided
    if (!userData.id) {
      userData.id = userData.walletAddress || `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    
    const userId = String(userData.id);
    
    // Merge with default user data
    const defaultData = this.createDefaultUserData();
    const mergedData = {
      ...defaultData,
      ...userData.userData,
      id: userId,
      created: Date.now(),
      lastTouch: Date.now()
    };
    
    // Save to session
    this.sessions[userId] = mergedData;
    
    // Persist to database if available
    if (this.db) {
      try {
        await this.db.writeUserData(userId, mergedData);
      } catch (error) {
        console.error(`Error saving new user ${userId}:`, error);
      }
    }
    
    // Trigger session created event
    this._triggerEvent('sessionCreated', { userId, session: mergedData });
    
    return mergedData;
  }
}

module.exports = SessionService; 