/**
 * @file Manages database operations for platform linking requests in the Noema database.
 * This handles approval-based platform linking requests (e.g., Telegram user requesting to link to Discord account).
 */

const { BaseDB, ObjectId } = require('./BaseDB');
const { PRIORITY } = require('./utils/queue');
const { v4: uuidv4 } = require('uuid');

const COLLECTION_NAME = 'platformLinkRequests';

class PlatformLinkRequestsDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    if (!logger) {
      console.warn('[PlatformLinkRequestsDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = console;
    } else {
      this.logger = logger;
    }
  }

  /**
   * Creates a new platform linking request.
   * @param {Object} requestData - The data for the new request.
   * @param {string} requestData.requestingPlatform - Platform making the request (e.g., 'telegram', 'discord').
   * @param {string} requestData.requestingPlatformId - Platform-specific user ID.
   * @param {ObjectId|string} requestData.requestingMasterAccountId - Requester's masterAccountId.
   * @param {string} requestData.targetWalletAddress - Wallet address to link to.
   * @param {ObjectId|string} requestData.targetMasterAccountId - Target user's masterAccountId.
   * @param {number} [expiresInHours=48] - Hours until request expires (default 48).
   * @returns {Promise<Object|null>} The created request document.
   */
  async createRequest({
    requestingPlatform,
    requestingPlatformId,
    requestingMasterAccountId,
    targetWalletAddress,
    targetMasterAccountId,
    expiresInHours = 48
  }) {
    if (!requestingPlatform || !requestingPlatformId || !requestingMasterAccountId || 
        !targetWalletAddress || !targetMasterAccountId) {
      this.logger.error('[PlatformLinkRequestsDB] All required fields must be provided.');
      return null;
    }

    const requestId = uuidv4();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + expiresInHours * 60 * 60 * 1000);

    const requestData = {
      requestId,
      requestingPlatform,
      requestingPlatformId,
      requestingMasterAccountId: new ObjectId(requestingMasterAccountId),
      targetWalletAddress: targetWalletAddress.toLowerCase(),
      targetMasterAccountId: new ObjectId(targetMasterAccountId),
      status: 'pending',
      createdAt,
      expiresAt,
      updatedAt: createdAt
    };

    try {
      const result = await this.insertOne(requestData, false, PRIORITY.HIGH);
      if (result.insertedId) {
        return { _id: result.insertedId, ...requestData };
      }
      return null;
    } catch (error) {
      this.logger.error('[PlatformLinkRequestsDB] Error creating platform link request:', error);
      throw error;
    }
  }

  /**
   * Finds a platform linking request by requestId.
   * @param {string} requestId - The unique request ID.
   * @returns {Promise<Object|null>} The request document or null if not found.
   */
  async findByRequestId(requestId) {
    if (!requestId) {
      return null;
    }
    return this.findOne({ requestId }, PRIORITY.HIGH);
  }

  /**
   * Finds a platform linking request by ID.
   * @param {ObjectId|string} id - The MongoDB _id.
   * @returns {Promise<Object|null>} The request document or null if not found.
   */
  async findById(id) {
    if (!id) {
      return null;
    }
    const objectId = typeof id === 'string' ? new ObjectId(id) : id;
    return this.findOne({ _id: objectId }, PRIORITY.HIGH);
  }

  /**
   * Finds all pending requests for a specific masterAccountId (both sent and received).
   * @param {ObjectId|string} masterAccountId - The masterAccountId to search for.
   * @param {string} [status='pending'] - Filter by status (default: 'pending').
   * @returns {Promise<Array>} Array of request documents.
   */
  async findByMasterAccountId(masterAccountId, status = 'pending') {
    if (!masterAccountId) {
      return [];
    }
    const id = typeof masterAccountId === 'string' ? new ObjectId(masterAccountId) : masterAccountId;
    
    const query = {
      $or: [
        { requestingMasterAccountId: id },
        { targetMasterAccountId: id }
      ]
    };

    if (status) {
      query.status = status;
    }

    return this.findMany(query, PRIORITY.HIGH);
  }

  /**
   * Finds pending requests sent by a specific platform user.
   * @param {string} platform - Platform name (e.g., 'telegram').
   * @param {string} platformId - Platform-specific user ID.
   * @returns {Promise<Array>} Array of request documents.
   */
  async findPendingByRequestingPlatform(platform, platformId) {
    if (!platform || !platformId) {
      return [];
    }
    return this.findMany({
      requestingPlatform: platform,
      requestingPlatformId: platformId,
      status: 'pending'
    }, PRIORITY.HIGH);
  }

  /**
   * Updates the status of a platform linking request.
   * @param {string} requestId - The request ID.
   * @param {string} status - New status ('approved', 'rejected', 'expired').
   * @param {Object} [additionalData={}] - Additional fields to update.
   * @returns {Promise<Object|null>} Updated request document or null if not found.
   */
  async updateRequestStatus(requestId, status, additionalData = {}) {
    if (!requestId || !status) {
      this.logger.error('[PlatformLinkRequestsDB] requestId and status are required.');
      return null;
    }

    const updateData = {
      status,
      updatedAt: new Date(),
      ...additionalData
    };

    // Add timestamp based on status
    if (status === 'approved' && !updateData.approvedAt) {
      updateData.approvedAt = new Date();
    } else if (status === 'rejected' && !updateData.rejectedAt) {
      updateData.rejectedAt = new Date();
    }

    try {
      const updateResult = await this.updateOne(
        { requestId },
        { $set: updateData },
        {},
        false,
        PRIORITY.HIGH
      );

      if (updateResult.matchedCount > 0) {
        return this.findByRequestId(requestId);
      }
      return null;
    } catch (error) {
      this.logger.error('[PlatformLinkRequestsDB] Error updating request status:', error);
      throw error;
    }
  }

  /**
   * Finds all expired pending requests.
   * @returns {Promise<Array>} Array of expired request documents.
   */
  async findExpiredPendingRequests() {
    const now = new Date();
    return this.findMany({
      status: 'pending',
      expiresAt: { $lt: now }
    }, PRIORITY.MEDIUM);
  }

  /**
   * Marks expired requests as expired.
   * @returns {Promise<number>} Number of requests updated.
   */
  async expirePendingRequests() {
    const expiredRequests = await this.findExpiredPendingRequests();
    let updatedCount = 0;

    for (const request of expiredRequests) {
      try {
        await this.updateRequestStatus(request.requestId, 'expired');
        updatedCount++;
      } catch (error) {
        this.logger.error(`[PlatformLinkRequestsDB] Error expiring request ${request.requestId}:`, error);
      }
    }

    return updatedCount;
  }

  /**
   * Checks if a platform is already linked to a masterAccountId.
   * This is a helper method that should check the userCore collection.
   * Note: This method doesn't directly query userCore, but provides a way to check.
   * The actual check should be done in the API layer using userCoreDb.
   * @param {ObjectId|string} masterAccountId - The masterAccountId to check.
   * @param {string} platform - Platform name to check.
   * @returns {Promise<boolean>} True if platform is already linked.
   */
  async isPlatformAlreadyLinked(masterAccountId, platform) {
    // This is a placeholder - actual implementation should query userCore collection
    // For now, we'll return false and let the API layer handle the check
    this.logger.warn('[PlatformLinkRequestsDB] isPlatformAlreadyLinked should be checked via userCoreDb in API layer.');
    return false;
  }
}

module.exports = PlatformLinkRequestsDB;

