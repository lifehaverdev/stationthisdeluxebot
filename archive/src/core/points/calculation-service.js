/**
 * Points Calculation Service
 * Handles point calculations, limits, and regeneration formulas
 */

const { PointConstants } = require('./models');

/**
 * Points Calculation Service
 * Provides methods for calculating point limits, costs, and regeneration rates
 */
class PointsCalculationService {
  /**
   * Calculate maximum points based on balance
   * @param {string|number} balance - User's token balance
   * @returns {number} - Maximum points allowed
   */
  calculateMaxPoints(balance) {
    // Convert balance to number if it's a string
    const numericBalance = typeof balance === 'string' 
      ? parseFloat(balance) || 0 
      : balance || 0;
    
    return Math.floor(
      (numericBalance + PointConstants.NOCOINERSTARTER) / PointConstants.POINTMULTI
    );
  }

  /**
   * Calculate points equivalent of a token balance
   * @param {number} points - Number of points
   * @returns {number} - Token balance equivalent
   */
  pointsToTokens(points) {
    return points * PointConstants.POINTMULTI;
  }

  /**
   * Calculate regeneration amount based on balance and time
   * @param {string|number} balance - User's token balance
   * @param {number} [timeSinceLastRegen=PointConstants.REGEN_INTERVAL_MS] - Time since last regeneration (ms)
   * @returns {number} - Amount of points to regenerate
   */
  calculateRegenerationAmount(balance, timeSinceLastRegen = PointConstants.REGEN_INTERVAL_MS) {
    const maxPoints = this.calculateMaxPoints(balance);
    const cycles = Math.floor(timeSinceLastRegen / PointConstants.REGEN_INTERVAL_MS);
    
    // Points regenerate at 1/18 of max per cycle
    return (maxPoints / PointConstants.REGEN_DIVISOR) * Math.max(1, cycles);
  }

  /**
   * Calculate time until next point regeneration
   * @param {Date} [lastUpdate=new Date()] - Last update timestamp
   * @returns {number} - Time in milliseconds until next regeneration
   */
  calculateTimeUntilNextRegen(lastUpdate = new Date()) {
    const now = new Date();
    const lastUpdateTime = lastUpdate instanceof Date ? lastUpdate : new Date(lastUpdate);
    const timeSinceLastUpdate = now - lastUpdateTime;
    
    // If more than a regeneration interval has passed, regeneration is due now
    if (timeSinceLastUpdate >= PointConstants.REGEN_INTERVAL_MS) {
      return 0;
    }
    
    // Otherwise, return the remaining time
    return PointConstants.REGEN_INTERVAL_MS - timeSinceLastUpdate;
  }

  /**
   * Check if a user has reached their point limit
   * @param {Object} userPoints - User's point balances
   * @param {number} userPoints.points - Regular points
   * @param {number} userPoints.doints - Regenerative points
   * @param {string|number} userPoints.balance - Token balance
   * @returns {boolean} - Whether the user has reached their point limit
   */
  hasReachedPointLimit(userPoints) {
    const totalPoints = (userPoints.points || 0) + (userPoints.doints || 0);
    const maxPoints = this.calculateMaxPoints(userPoints.balance);
    
    return totalPoints >= maxPoints;
  }

  /**
   * Get point cost for a generation
   * @param {Object} generationConfig - Generation configuration
   * @param {string} [generationConfig.type='DEFAULT'] - Generation type
   * @returns {number} - Point cost
   */
  getGenerationCost(generationConfig = {}) {
    const type = generationConfig.type || 'DEFAULT';
    
    // Get cost based on model type
    if (type === 'MS3.3') {
      return PointConstants.COST.MS3_3;
    } else if (type === 'MS3') {
      return PointConstants.COST.MS3;
    }
    
    return PointConstants.COST.DEFAULT;
  }

  /**
   * Calculate batch point conversion for all users
   * @param {Array<Object>} userPoints - Array of user point objects
   * @returns {Array<Object>} - Updated user point objects
   */
  batchConvertPoints(userPoints) {
    return userPoints.map(user => {
      const oldPoints = user.points || 0;
      const oldDoints = user.doints || 0;
      const oldBoints = user.boints || 0;
      const oldExp = user.exp || 0;
      
      // Only process if there are actually points to update
      if (oldPoints > 0 || oldDoints > 0 || oldBoints > 0) {
        const totalPoints = oldPoints + oldBoints;
        const newDoints = Math.max(0, oldDoints + oldPoints);
        const newExp = Math.max(0, oldExp + totalPoints);
        
        return {
          ...user,
          points: 0,
          doints: newDoints,
          boints: 0,
          exp: newExp,
          lastPointsUpdate: new Date()
        };
      }
      
      return user;
    });
  }
}

module.exports = PointsCalculationService; 