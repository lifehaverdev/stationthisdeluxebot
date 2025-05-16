const { BaseDB, ObjectId } = require('./BaseDB');
// const { getCachedClient } = require('./utils/queue'); // Not needed here anymore

const COLLECTION_NAME = 'userSessions';

class UserSessionsDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    if (!logger) {
      const tempLogger = console;
      tempLogger.warn('[UserSessionsDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = tempLogger;
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
    if (!sessionData || !sessionData.masterAccountId) {
        this.logger.error('[UserSessionsDB] masterAccountId is required to create a session.');
        return null;
    }
    const dataToInsert = {
      // sessionId will be handled by BaseDB as _id
      sessionStartTimestamp: new Date(),
      ...sessionData,
      status: sessionData.status || 'active',
    };
    const result = await this.insertOne(dataToInsert);
    return result.insertedId ? { _id: result.insertedId, ...dataToInsert } : null;
  }

  /**
   * Finds a session by its ID.
   * @param {ObjectId} sessionId - The ID of the session.
   * @returns {Promise<Object|null>} The session document, or null if not found.
   */
  async findSessionById(sessionId) {
    if (!sessionId) {
        this.logger.error('[UserSessionsDB] sessionId is required to find a session.');
        return null;
    }
    return this.findOne({ _id: new ObjectId(sessionId) });
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
    if (!sessionId) {
        this.logger.error('[UserSessionsDB] sessionId is required to update a session.');
        return null;
    }
    if (updateData.status === 'ended' && !updateData.sessionEndTimestamp) {
      updateData.sessionEndTimestamp = new Date();
    }
    return this.updateOne({ _id: new ObjectId(sessionId) }, { $set: updateData });
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

  async findSessionsByMasterAccount(masterAccountId, options = {}) {
    if (!masterAccountId) {
        this.logger.error('[UserSessionsDB] masterAccountId is required to find sessions.');
        return [];
    }
    return this.findMany({ masterAccountId }, options);
  }

  async findActiveSessionsByMasterAccount(masterAccountId, options = {}) {
    if (!masterAccountId) {
        this.logger.error('[UserSessionsDB] masterAccountId is required to find active sessions.');
        return [];
    }
    return this.findMany({ masterAccountId, status: 'active' }, options);
  }
}

// const client = getCachedClient(); // Not needed here anymore
module.exports = UserSessionsDB; // Export the class 