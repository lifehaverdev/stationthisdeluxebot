/**
 * User Domain Models
 * Defines the core user entity and related data structures
 */

/**
 * User Core Model
 * Contains identity and verification-related information
 */
class UserCore {
  /**
   * @param {Object} data - User data
   * @param {string} data.userId - Unique identifier for the user
   * @param {string} [data.wallet=''] - User's wallet address
   * @param {Array<string>} [data.wallets=[]] - List of user's wallet addresses
   * @param {boolean} [data.verified=false] - Whether the user is verified
   * @param {Date|null} [data.kickedAt=null] - When the user was kicked from the platform
   * @param {Date|null} [data.lastRunTime=null] - Last time the user ran a generation
   * @param {Date|null} [data.lastTouch=null] - Last user activity timestamp
   * @param {Date|null} [data.createdAt=null] - User creation timestamp
   * @param {string|null} [data.apiKey=null] - User's API key
   * @param {Date|null} [data.apiKeyCreatedAt=null] - When the API key was created
   */
  constructor(data = {}) {
    this.userId = data.userId || '';
    this.wallet = data.wallet || '';
    this.wallets = data.wallets || [];
    this.verified = data.verified || false;
    this.kickedAt = data.kickedAt || null;
    this.lastRunTime = data.lastRunTime || null;
    this.lastTouch = data.lastTouch || null;
    this.createdAt = data.createdAt || new Date();
    this.apiKey = data.apiKey || null;
    this.apiKeyCreatedAt = data.apiKeyCreatedAt || null;
  }

  /**
   * Check if the user is currently verified
   * @returns {boolean} - Whether the user is verified
   */
  isVerified() {
    return this.verified === true;
  }

  /**
   * Check if user has a verified wallet
   * @returns {boolean} - Whether the user has a verified wallet
   */
  hasVerifiedWallet() {
    return this.verified && this.wallet && this.wallet.length > 0;
  }

  /**
   * Check if the user is currently active
   * @returns {boolean} - Whether the user is active (not kicked)
   */
  isActive() {
    return this.kickedAt === null;
  }

  /**
   * Check if the user has API access
   * @returns {boolean} - Whether the user has API access
   */
  hasApiAccess() {
    return this.apiKey !== null;
  }
}

/**
 * User Economy Model
 * Contains points, currency and asset-related information
 */
class UserEconomy {
  /**
   * @param {Object} data - User economy data
   * @param {string} data.userId - Unique identifier for the user
   * @param {string} [data.balance=''] - User's token balance
   * @param {number} [data.exp=0] - User's experience points
   * @param {number} [data.points=0] - User's points
   * @param {number} [data.doints=0] - User's doints (regenerative points)
   * @param {number} [data.qoints=0] - User's qoints (premium currency)
   * @param {number} [data.boints=0] - User's boints (bonus points)
   * @param {number} [data.pendingQoints=0] - User's pending qoints
   * @param {Array} [data.assets=[]] - User's assets
   */
  constructor(data = {}) {
    this.userId = data.userId || '';
    this.balance = data.balance || '';
    this.exp = data.exp || 0;
    this.points = data.points || 0;
    this.doints = data.doints || 0;
    this.qoints = data.qoints || 0;
    this.boints = data.boints || 0;
    this.pendingQoints = data.pendingQoints || 0;
    this.assets = data.assets || [];
  }

  /**
   * Get total available points (points + doints)
   * @returns {number} - Total available points
   */
  getTotalPoints() {
    return (this.points || 0) + (this.doints || 0);
  }

  /**
   * Check if user has sufficient points for an operation
   * @param {number} required - Required points
   * @returns {boolean} - Whether the user has sufficient points
   */
  hasSufficientPoints(required) {
    return this.getTotalPoints() >= required;
  }

  /**
   * Check if user has sufficient qoints for an operation
   * @param {number} required - Required qoints
   * @returns {boolean} - Whether the user has sufficient qoints
   */
  hasSufficientQoints(required) {
    return (this.qoints || 0) >= required;
  }
}

/**
 * User Preferences Model
 * Contains user preferences and settings
 */
class UserPreferences {
  /**
   * @param {Object} data - User preferences data
   * @param {string} data.userId - Unique identifier for the user
   * @param {Object} [data.generationSettings={}] - Generation settings
   * @param {Object} [data.uiState={}] - UI state
   * @param {Object} [data.favorites={}] - User favorites
   * @param {Array} [data.commandList=[]] - Available commands
   */
  constructor(data = {}) {
    this.userId = data.userId || '';
    
    // Generation settings (with defaults)
    this.generationSettings = {
      input_batch: data.input_batch || 1,
      input_steps: data.input_steps || 30,
      input_cfg: data.input_cfg || 7,
      input_strength: data.input_strength || 0.6,
      input_height: data.input_height || 1024,
      input_width: data.input_width || 1024,
      input_negative: data.input_negative || '-1',
      input_checkpoint: data.input_checkpoint || "zavychromaxl_v60",
      input_seed: data.input_seed || -1,
      lastSeed: data.lastSeed || -1,
      ...(data.generationSettings || {})
    };
    
    // UI state
    this.uiState = {
      prompt: data.prompt || '',
      userPrompt: data.userPrompt || '-1',
      basePrompt: data.basePrompt || "MS2",
      lastImage: data.lastImage || '',
      createSwitch: data.createSwitch || 'MAKE',
      tempSize: data.tempSize || { height: 500, width: 500 },
      state: data.state || { state: 'IDLE', chatId: null, messageThreadId: null },
      ...(data.uiState || {})
    };
    
    // User flags and preferences
    this.flags = {
      advancedUser: data.advancedUser || false,
      autoPrompt: data.autoPrompt || false,
      forceLogo: data.forceLogo || false,
      customFileNames: data.customFileNames || false,
      controlNet: data.controlNet || false,
      styleTransfer: data.styleTransfer || false,
      openPose: data.openPose || false,
      ...(data.flags || {})
    };
    
    // User favorites
    this.favorites = data.favorites || {
      basePrompt: [],
      gens: [],
      loras: [],
    };
    
    // Command list (with defaults)
    this.commandList = data.commandList || [
      { command: 'help', description: 'See help description' },
      { command: 'make', description: 'txt2img'},
      { command: 'quickmake', description: 'SDXL txt2img'},
      { command: 'effect', description: 'img2img'},
      { command: 'signin', description: 'Connect account' },
      { command: 'ca', description: 'Check chart buy' },
      { command: 'loralist', description: 'See available LoRAs' },
      { command: 'status', description: 'Check the group queue status' },
    ];
    
    // Custom properties
    this.waterMark = data.waterMark || 'mslogo';
    this.voiceModel = data.voiceModel || "165UvtZp7kKnmrVQwx";
    this.type = data.type || '';
    this.inpaintTarget = data.inpaintTarget || '';
    this.runs = data.runs || [];
  }

  /**
   * Get generation settings with optional overrides
   * @param {Object} [overrides={}] - Settings to override
   * @returns {Object} - The generation settings
   */
  getGenerationSettings(overrides = {}) {
    return { ...this.generationSettings, ...overrides };
  }
}

/**
 * Complete User Model
 * Combines Core, Economy, and Preferences
 */
class User {
  /**
   * @param {Object} data - Complete user data
   */
  constructor(data = {}) {
    this.core = new UserCore(data);
    this.economy = new UserEconomy(data);
    this.preferences = new UserPreferences(data);
  }

  /**
   * Get the user ID
   * @returns {string} - The user ID
   */
  getId() {
    return this.core.userId;
  }

  /**
   * Get combined user data as a plain object (for backwards compatibility)
   * @returns {Object} - Combined user data
   */
  toJSON() {
    return {
      ...this.core,
      ...this.economy,
      ...this.preferences.generationSettings,
      ...this.preferences.uiState,
      ...this.preferences.flags,
      favorites: this.preferences.favorites,
      commandList: this.preferences.commandList,
      waterMark: this.preferences.waterMark,
      voiceModel: this.preferences.voiceModel,
      type: this.preferences.type,
      inpaintTarget: this.preferences.inpaintTarget,
      runs: this.preferences.runs,
    };
  }

  /**
   * Create a User from a plain object
   * @param {Object} data - Plain user data
   * @returns {User} - User instance
   */
  static fromJSON(data) {
    return new User(data);
  }
}

module.exports = {
  UserCore,
  UserEconomy,
  UserPreferences,
  User
}; 