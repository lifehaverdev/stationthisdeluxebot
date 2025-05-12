const { BaseDB, ObjectId } = require('./BaseDB');
// const { getCachedClient } = require('./utils/queue'); // Not needed here anymore

class UserSessionsDB extends BaseDB {
  constructor(logger) { 
    super('userSessions');
    if (!logger) {
      console.warn('[UserSessionsDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = console; 
    } else {
      this.logger = logger;
    }
  }

  /**
   * Creates a new user session.
   * @param {Object} sessionData - The data for the new session.
   * @param {ObjectId} sessionData.masterAccountId - The master account ID of the user.
   * @param {Date} sessionData.startTime - The start time of the session.
   * @param {string} sessionData.platform - The platform where the session originated.
   * @param {boolean} sessionData.isActive - Whether the session is active.
   * @param {Date} sessionData.lastUserActivityTimestamp - Timestamp of the last user activity.
   * @param {string} [sessionData.userAgent] - User agent string.
   * @param {Object} [sessionData.metadata] - Additional session-specific metadata.
   * @returns {Promise<Object>} The created session document.
   */
  async createSession(sessionData) {
    const dataToInsert = {
      ...sessionData,
      startTime: sessionData.startTime || new Date(),
      isActive: sessionData.isActive !== undefined ? sessionData.isActive : true,
      lastUserActivityTimestamp: sessionData.lastUserActivityTimestamp || new Date(),
    };
    const result = await this.insertOne(dataToInsert);
    if (result.insertedId) {
        return { _id: result.insertedId, ...dataToInsert };
    }
    return null;
  }

  /**
   * Finds a session by its ID.
   * @param {ObjectId} sessionId - The ID of the session.
   * @returns {Promise<Object|null>} The session document, or null if not found.
   */
  async findSessionById(sessionId) {
    return this.findOne({ _id: sessionId });
  }

  /**
   * Updates a session by its ID.
   * @param {ObjectId} sessionId - The ID of the session to update.
   * @param {Object} updateData - The data to update.
   * @param {Date} [updateData.endTime] - The end time of the session.
   * @param {string} [updateData.endReason] - The reason for session termination.
   * @param {boolean} [updateData.isActive] - Whether the session is active.
   * @param {Date} [updateData.lastUserActivityTimestamp] - Timestamp of the last user activity.
   * @param {Object} [updateData.metadata] - Additional session-specific metadata.
   * @returns {Promise<Object>} The update result.
   */
  async updateSession(sessionId, updateData) {
    return this.updateOne({ _id: sessionId }, updateData);
  }

  /**
   * Finds active sessions for a user on a specific platform.
   * @param {ObjectId} masterAccountId - The master account ID of the user.
   * @param {string} platform - The platform.
   * @returns {Promise<Array<Object>>} A list of active session documents.
   */
  async findActiveSessionsByUserAndPlatform(masterAccountId, platform) {
    return this.findMany({ masterAccountId, platform, isActive: true });
  }

  /**
   * Marks a session as inactive.
   * @param {ObjectId} sessionId - The ID of the session.
   * @param {string} endReason - The reason for ending the session.
   * @returns {Promise<Object>} The update result.
   */
  async endSession(sessionId, endReason) {
    return this.updateSession(sessionId, {
      isActive: false,
      endTime: new Date(),
      endReason,
    });
  }

  /**
   * Updates the last user activity timestamp for a session.
   * @param {ObjectId} sessionId - The ID of the session.
   * @returns {Promise<Object>} The update result.
   */
  async updateLastActivity(sessionId) {
    return this.updateSession(sessionId, { lastUserActivityTimestamp: new Date() });
  }
}

// const client = getCachedClient(); // Not needed here anymore
module.exports = UserSessionsDB; // Export the class 