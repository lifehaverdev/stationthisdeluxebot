const { AnalyticsEvents, EVENT_TYPES } = require('../../db/models/analyticsEvents');

/**
 * Service that handles analytics operations with decoupled session access
 */
class AnalyticsService {
  /**
   * @param {Object} options
   * @param {Object} options.sessionAdapter - Session adapter instance
   * @param {Object} options.analyticsEvents - Optional instance of AnalyticsEvents
   */
  constructor({ sessionAdapter, analyticsEvents = null }) {
    this.sessionAdapter = sessionAdapter;
    this.analytics = analyticsEvents || new AnalyticsEvents();
    this.EVENT_TYPES = EVENT_TYPES;
  }

  /**
   * Tracks a user joining event
   * @param {number|string} userId - User ID
   * @param {string} username - Username
   * @param {string} source - Origin of the join
   * @param {Object} details - Additional details
   * @returns {Promise<any>} - Result of tracking operation
   */
  async trackUserJoin(userId, username, source, details = {}) {
    const userData = await this.sessionAdapter.getUserAnalyticsData(userId);
    return this.analytics.trackUserJoin(userId, username, source, details);
  }

  /**
   * Tracks a user kick event
   * @param {number|string} userId - User ID 
   * @param {string} username - Username
   * @param {string} reason - Reason for kicking
   * @returns {Promise<any>} - Result of tracking operation
   */
  async trackUserKick(userId, username, reason) {
    const userData = await this.sessionAdapter.getUserAnalyticsData(userId);
    return this.analytics.trackUserKick(
      userId, 
      username, 
      reason,
      {
        lastTouch: userData.lastTouch,
        timeSinceLastTouch: userData.timeSinceLastTouch
      }
    );
  }

  /**
   * Tracks a verification event
   * @param {Object} message - Message object
   * @param {boolean} success - Whether verification was successful
   * @param {Object} details - Additional details
   * @returns {Promise<any>} - Result of tracking operation
   */
  async trackVerification(message, success, details = {}) {
    const userData = await this.sessionAdapter.getUserAnalyticsData(message.from.id);
    const enhancedDetails = {
      ...details,
      wallet: userData.wallet
    };
    return this.analytics.trackVerification(message, success, enhancedDetails);
  }

  /**
   * Tracks a gatekeeping event
   * @param {Object} message - Message object
   * @param {string} reason - Reason for gatekeeping
   * @param {Object} details - Additional details
   * @returns {Promise<any>} - Result of tracking operation
   */
  async trackGatekeeping(message, reason, details = {}) {
    return this.analytics.trackGatekeeping(message, reason, details);
  }

  /**
   * Tracks an asset check event
   * @param {number|string} userId - User ID
   * @param {string} username - Username
   * @param {string} checkType - Type of asset check
   * @param {any} result - Result of the check
   * @param {Object} details - Additional details
   * @returns {Promise<any>} - Result of tracking operation
   */
  async trackAssetCheck(userId, username, checkType, result, details = {}) {
    return this.analytics.trackAssetCheck(userId, username, checkType, result, details);
  }

  /**
   * Tracks an account action event
   * @param {Object} message - Message object
   * @param {string} action - Action performed
   * @param {boolean} success - Whether action was successful
   * @param {Object} details - Additional details
   * @returns {Promise<any>} - Result of tracking operation
   */
  async trackAccountAction(message, action, success, details = {}) {
    return this.analytics.trackAccountAction(message, action, success, details);
  }
}

/**
 * Creates an instance of AnalyticsService
 * @param {Object} options
 * @param {Object} options.sessionAdapter - Session adapter instance
 * @returns {AnalyticsService} - New AnalyticsService instance
 */
function createAnalyticsService({ sessionAdapter }) {
  return new AnalyticsService({ sessionAdapter });
}

module.exports = {
  AnalyticsService,
  createAnalyticsService
}; 