/**
 * Points Domain Models
 * Defines point types and structures for the points system
 */

/**
 * Point Types
 * @enum {string}
 */
const PointType = {
  POINTS: 'points',     // Regular points earned through activities
  DOINTS: 'doints',     // Regenerative points that decay over time
  QOINTS: 'qoints',     // Premium points used for API and special features
  BOINTS: 'boints',     // Bonus points from special activities
  EXP: 'exp'            // Experience points that don't decay
};

/**
 * Point Constants
 * Default values and limits used in point calculations
 */
const PointConstants = {
  // Base allowance for users without tokens
  NOCOINERSTARTER: 199800,
  
  // Divider for balance-to-points ratio
  POINTMULTI: 540,
  
  // Default regeneration interval (15 minutes in milliseconds)
  REGEN_INTERVAL_MS: 15 * 60 * 1000,
  
  // Regeneration divisor (points regenerate at 1/18 of max per cycle)
  REGEN_DIVISOR: 18,
  
  // Minimum qoints required for API access
  API_QOINT_MINIMUM: 50,
  
  // Minimum qoints warning threshold
  QOINT_WARNING_THRESHOLD: 1000,
  
  // Default point costs for different model types
  COST: {
    DEFAULT: 100,       // Default cost for standard models
    MS3: 500,           // Cost for MS3 model
    MS3_3: 1000         // Cost for MS3.3 model
  }
};

/**
 * User Points
 * Contains all point balances for a user
 */
class UserPoints {
  /**
   * @param {Object} data - Point data
   * @param {string} data.userId - User ID
   * @param {number} [data.points=0] - Regular points
   * @param {number} [data.doints=0] - Regenerative points
   * @param {number} [data.qoints=0] - Premium points
   * @param {number} [data.boints=0] - Bonus points
   * @param {number} [data.exp=0] - Experience points
   * @param {number} [data.pendingQoints=0] - Pending premium points
   * @param {Date|null} [data.lastPointsUpdate=null] - Last time points were updated
   * @param {string} [data.balance=''] - Token balance (for point calculations)
   */
  constructor(data = {}) {
    this.userId = data.userId || '';
    this.points = data.points || 0;
    this.doints = data.doints || 0;
    this.qoints = data.qoints || 0;
    this.boints = data.boints || 0;
    this.exp = data.exp || 0;
    this.pendingQoints = data.pendingQoints || 0;
    this.lastPointsUpdate = data.lastPointsUpdate || null;
    this.balance = data.balance || '';
  }

  /**
   * Get total spendable points (points + doints)
   * @returns {number} - Total points
   */
  getTotalPoints() {
    return (this.points || 0) + (this.doints || 0);
  }

  /**
   * Get all point balances as an object
   * @returns {Object} - Point balances
   */
  getBalances() {
    return {
      points: this.points,
      doints: this.doints,
      qoints: this.qoints,
      boints: this.boints,
      exp: this.exp,
      pendingQoints: this.pendingQoints
    };
  }

  /**
   * Add points of a specific type
   * @param {string} type - Point type
   * @param {number} amount - Amount to add
   * @returns {UserPoints} - This instance for chaining
   */
  addPoints(type, amount) {
    if (typeof this[type] === 'number') {
      this[type] += amount;
    }
    return this;
  }

  /**
   * Deduct points of a specific type
   * @param {string} type - Point type
   * @param {number} amount - Amount to deduct
   * @returns {UserPoints} - This instance for chaining
   */
  deductPoints(type, amount) {
    if (typeof this[type] === 'number') {
      this[type] = Math.max(0, this[type] - amount);
    }
    return this;
  }

  /**
   * Check if user has sufficient points of a specific type
   * @param {string} type - Point type
   * @param {number} required - Required amount
   * @returns {boolean} - Whether user has sufficient points
   */
  hasSufficientPoints(type, required) {
    if (type === PointType.POINTS) {
      return this.getTotalPoints() >= required;
    }
    return (this[type] || 0) >= required;
  }

  /**
   * Convert to a plain object
   * @returns {Object} - Plain object
   */
  toJSON() {
    return {
      userId: this.userId,
      points: this.points,
      doints: this.doints,
      qoints: this.qoints,
      boints: this.boints,
      exp: this.exp,
      pendingQoints: this.pendingQoints,
      lastPointsUpdate: this.lastPointsUpdate,
      balance: this.balance
    };
  }

  /**
   * Create UserPoints from a plain object
   * @param {Object} data - Plain object
   * @returns {UserPoints} - UserPoints instance
   */
  static fromJSON(data) {
    return new UserPoints(data);
  }
}

/**
 * Point Operation
 * Represents a point transaction
 */
class PointOperation {
  /**
   * @param {Object} data - Operation data
   * @param {string} data.userId - User ID
   * @param {string} data.type - Operation type (add, deduct)
   * @param {string} data.pointType - Point type
   * @param {number} data.amount - Amount of points
   * @param {string} data.reason - Reason for the operation
   * @param {Date} [data.timestamp=new Date()] - Operation timestamp
   */
  constructor(data = {}) {
    this.userId = data.userId;
    this.type = data.type;
    this.pointType = data.pointType;
    this.amount = data.amount;
    this.reason = data.reason;
    this.timestamp = data.timestamp || new Date();
  }
}

module.exports = {
  PointType,
  PointConstants,
  UserPoints,
  PointOperation
}; 