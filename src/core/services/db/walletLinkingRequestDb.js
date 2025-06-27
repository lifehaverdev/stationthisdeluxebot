const { BaseDB, ObjectId } = require('./BaseDB');

const COLLECTION_NAME = 'wallet_linking_requests';

/**
 * @class WalletLinkingRequestDB
 * @description Manages database operations for wallet linking requests made via "magic amount" deposits.
 */
class WalletLinkingRequestDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    if (!logger) {
      const tempLogger = console;
      tempLogger.warn('[WalletLinkingRequestDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = tempLogger;
    } else {
      this.logger = logger;
    }
  }

  /**
   * Creates a new wallet linking request.
   * @param {object} requestData - The data for the new request.
   * @param {ObjectId} requestData.masterAccountId - The master account ID of the user.
   * @param {string} requestData.magicAmountWei - The unique deposit amount in Wei.
   * @param {string} requestData.tokenAddress - The contract address of the token to be deposited.
   * @param {number} requestData.expiresInSeconds - The number of seconds until the request expires.
   * @returns {Promise<object>} The created request document.
   */
  async createRequest({ masterAccountId, magicAmountWei, tokenAddress, expiresInSeconds = 900 }) { // Default 15 mins
    if (!masterAccountId || !magicAmountWei || !tokenAddress) {
      this.logger.error('[WalletLinkingRequestDB] masterAccountId, magicAmountWei, and tokenAddress are required.');
      return null;
    }

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const dataToInsert = {
      master_account_id: new ObjectId(masterAccountId),
      magic_amount_wei: magicAmountWei,
      token_address: tokenAddress.toLowerCase(),
      status: 'PENDING',
      expires_at: expiresAt,
      created_at: new Date(),
      updated_at: new Date(),
    };

    try {
        const result = await this.insertOne(dataToInsert);
        return result.insertedId ? { _id: result.insertedId, ...dataToInsert } : null;
    } catch (error) {
        // Handle potential unique index violation if a pending request with the same amount already exists
        if (error.code === 11000) {
            this.logger.warn(`[WalletLinkingRequestDB] Attempted to create a request with a duplicate magic amount. This may indicate a collision or a race condition. Amount: ${magicAmountWei}`);
            return null; // Or handle by retrying with a new amount
        }
        this.logger.error(`[WalletLinkingRequestDB] Error creating request:`, error);
        throw error;
    }
  }

  /**
   * Finds a pending wallet linking request by the exact amount and token.
   * @param {string} magicAmountWei - The deposit amount in Wei.
   * @param {string} tokenAddress - The contract address of the deposited token.
   * @returns {Promise<object|null>} The request document, or null if not found.
   */
  async findPendingRequestByAmount(magicAmountWei, tokenAddress) {
    if (!magicAmountWei || !tokenAddress) {
      return null;
    }
    return this.findOne({
      magic_amount_wei: magicAmountWei,
      token_address: tokenAddress.toLowerCase(),
      status: 'PENDING',
    });
  }

  /**
   * Updates the status of a wallet linking request.
   * @param {ObjectId} requestId - The ID of the request to update.
   * @param {string} status - The new status (e.g., 'COMPLETED', 'EXPIRED', 'FAILED').
   * @param {object} [additionalData={}] - Any other fields to update.
   * @returns {Promise<object>} The update result.
   */
  async updateRequestStatus(requestId, status, additionalData = {}) {
    if (!requestId || !status) {
      this.logger.error('[WalletLinkingRequestDB] requestId and status are required.');
      return null;
    }
    const updateData = {
      status,
      ...additionalData,
      updated_at: new Date(),
    };
    return this.updateOne({ _id: new ObjectId(requestId) }, { $set: updateData });
  }

  /**
   * Finds a request by its unique ID.
   * @param {ObjectId|string} requestId - The ID of the request.
   * @returns {Promise<object|null>} The request document, or null if not found.
   */
  async findById(requestId) {
    if (!requestId) {
      return null;
    }
    // Ensure we're searching by ObjectId
    const objectId = typeof requestId === 'string' ? new ObjectId(requestId) : requestId;
    return this.findOne({ _id: objectId });
  }
}

module.exports = WalletLinkingRequestDB; 