/**
 * Adapter for session-related analytics operations
 */
class SessionAdapter {
  /**
   * Create a new SessionAdapter
   * @param {Object} options Adapter options
   * @param {Object} options.sessionManager Session manager instance
   */
  constructor(options) {
    if (!options.sessionManager) {
      throw new Error('sessionManager is required');
    }
    this.sessionManager = options.sessionManager;
  }

  /**
   * Get analytics data for a user
   * @param {string} userId User ID to get analytics for
   * @returns {Promise<Object|null>} Analytics data or null if not found
   */
  async getUserAnalyticsData(userId) {
    try {
      // Get user session data
      const userData = await this.sessionManager.getUserSession(userId);
      if (!userData) return null;

      // Return the session data directly
      return userData;
    } catch (error) {
      console.error('Error getting user analytics:', error);
      return null;
    }
  }
}

/**
 * Create a new SessionAdapter instance
 * @param {Object} options Adapter options
 * @returns {SessionAdapter} New adapter instance
 */
function createSessionAdapter(options) {
  return new SessionAdapter(options);
}

module.exports = {
  SessionAdapter,
  createSessionAdapter
}; 