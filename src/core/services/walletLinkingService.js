const { createLogger } = require('../../utils/logger');
const { generateApiKey } = require('./apiKeyService');
const { ObjectId } = require('mongodb');

/**
 * @class WalletLinkingService
 * @description Manages the business logic for linking wallets, including the "magic amount" flow for new users.
 */
class WalletLinkingService {
  constructor(dependencies) {
    this.logger = dependencies.logger || createLogger('WalletLinkingService');
    const { userCore: userCoreDb, walletLinkingRequests: walletLinkingRequestDb } = dependencies.db;

    if (!userCoreDb || !walletLinkingRequestDb) {
      throw new Error('WalletLinkingService: Missing required database dependencies (userCoreDb, walletLinkingRequestDb).');
    }
    this.userCoreDb = userCoreDb;
    this.walletLinkingRequestDb = walletLinkingRequestDb;
    // Use a simple in-memory Map to temporarily store the raw API key for claiming.
    this.apiKeyClaimCache = new Map();
    this.logger.info('[WalletLinkingService] Initialized.');
  }

  /**
   * Initiates the wallet linking process for a new user.
   * Creates a temporary user, generates a magic amount, and returns a request ID for polling.
   * @returns {Promise<{requestId: string, magicAmountWei: string, tokenAddress: string, expiresAt: Date}>}
   */
  async initiateLinking() {
    // 1. Create a temporary user account
    const newUser = await this.userCoreDb.createUserCore({
      status: 'PENDING_VERIFICATION',
      profile: { displayName: 'New API User' },
    });
    const masterAccountId = newUser._id;

    // 2. Generate a unique magic amount. This needs to be genuinely unique for pending requests.
    // A simple loop with retries can handle the rare case of a collision.
    let magicAmountWei;
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 10) {
      // Generate a random amount, e.g., between 0.001 and 0.0001 ETH, ensuring it's unique
      const randomPart = Math.floor(10000000000000 + Math.random() * 90000000000000); // e.g., 0.00010000... to 0.00099999...
      magicAmountWei = randomPart.toString();
      
      const existingRequest = await this.walletLinkingRequestDb.findPendingRequestByAmount(magicAmountWei, process.env.WRAPPED_NATIVE_TOKEN_ADDRESS);
      if (!existingRequest) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      // If we couldn't find a unique number after several attempts, something is wrong.
      // We should also clean up the user we created.
      // await this.userCoreDb.deleteUser(masterAccountId); // TODO: Need a delete method in userCoreDb
      this.logger.error('[WalletLinkingService] Could not generate a unique magic amount after multiple attempts.');
      throw new Error('Failed to generate a unique magic amount for wallet linking.');
    }

    // 3. Create the linking request in the database
    const tokenAddress = process.env.WRAPPED_NATIVE_TOKEN_ADDRESS; // Assuming WETH or native equivalent
    const expiresInSeconds = 900; // 15 minutes
    const linkingRequest = await this.walletLinkingRequestDb.createRequest({
      masterAccountId,
      magicAmountWei,
      tokenAddress,
      expiresInSeconds,
    });
    
    if (!linkingRequest) {
        // await this.userCoreDb.deleteUser(masterAccountId);
        this.logger.error(`[WalletLinkingService] Failed to create wallet linking request in DB for masterAccountId ${masterAccountId}`);
        throw new Error('Database error while creating wallet linking request.');
    }

    this.logger.info(`[WalletLinkingService] Initiated linking for new masterAccountId ${masterAccountId} with requestId ${linkingRequest._id}`);

    return {
      requestId: linkingRequest._id.toString(),
      magicAmountWei,
      tokenAddress,
      expiresAt: linkingRequest.expires_at,
    };
  }

  /**
   * Completes the linking process once a deposit is confirmed.
   * Generates the first real API key for the user and stores it for claiming.
   * @param {ObjectId} masterAccountId - The ID of the user.
   * @param {ObjectId} requestId - The ID of the linking request.
   * @returns {Promise<void>}
   */
  async completeLinkingAndGenerateFirstApiKey(masterAccountId, requestId) {
    this.logger.info(`[WalletLinkingService] Completing linking for masterAccountId ${masterAccountId}, request ID ${requestId}`);
    // 1. Generate a new API key
    const { apiKey, keyHash, keyPrefix } = generateApiKey();

    // 2. Add the API key to the user's document
    const apiKeyDocument = {
        keyPrefix,
        keyHash,
        name: 'Initial API Key',
        permissions: ['all'], // Or a default set of permissions
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastUsedAt: null
    };
    await this.userCoreDb.addApiKey(masterAccountId, apiKeyDocument);
    
    // 3. Update the user's status to active
    await this.userCoreDb.updateUserStatus(masterAccountId, 'active');

    // 4. Cache the raw API key so it can be claimed, with a short expiry.
    const claimKey = `api_key_claim:${requestId}`;
    this.apiKeyClaimCache.set(claimKey, apiKey);

    // Set a timeout to automatically remove the key from the cache after 5 minutes
    setTimeout(() => {
      if (this.apiKeyClaimCache.has(claimKey)) {
        this.apiKeyClaimCache.delete(claimKey);
        this.logger.info(`[WalletLinkingService] Claim key for request ${requestId} expired from cache.`);
      }
    }, 300 * 1000); // 5 minutes

    this.logger.info(`[WalletLinkingService] First API key generated and cached for claiming by masterAccountId ${masterAccountId}.`);
  }

  /**
   * Checks the status of a linking request and retrieves the API key if completed.
   * @param {string} requestId - The ID of the linking request.
   * @returns {Promise<{status: string, apiKey: string|null}>}
   */
  async getLinkingStatusAndClaimKey(requestId) {
    const linkingRequest = await this.walletLinkingRequestDb.findById(new ObjectId(requestId));
    if (!linkingRequest || linkingRequest.status === 'EXPIRED') {
      return { status: 'EXPIRED', apiKey: null };
    }

    if (linkingRequest.status === 'DELIVERED') {
      return { status: 'ALREADY_CLAIMED', apiKey: null };
    }
    
    if (linkingRequest.status === 'PENDING') {
      return { status: 'PENDING', apiKey: null };
    }

    if (linkingRequest.status === 'COMPLETED') {
      const claimKey = `api_key_claim:${requestId}`;
      
      // Check if the key is in our in-memory cache
      if (this.apiKeyClaimCache.has(claimKey)) {
        const apiKey = this.apiKeyClaimCache.get(claimKey);
        this.apiKeyClaimCache.delete(claimKey); // Key is claimed, delete it.
        
        // Mark as delivered in the DB to prevent replay issues
        await this.walletLinkingRequestDb.updateRequestStatus(requestId, 'DELIVERED');

        this.logger.info(`[WalletLinkingService] API key for request ${requestId} has been successfully claimed and marked as DELIVERED.`);
        return { status: 'COMPLETED', apiKey: apiKey };
      } else {
        // This is the edge case: the request is complete, but the key isn't in our cache.
        // This can happen if the server restarted after the key was generated but before it was claimed.
        // The raw key is lost. We should not auto-reissue. We'll return a special status.
        this.logger.warn(`[WalletLinkingService] Attempted to claim key for completed request ${requestId}, but key was not in cache. This may require manual intervention.`);
        return { status: 'NEEDS_ASSISTANCE', apiKey: null };
      }
    }

    // Default case for other statuses like FAILED
    return { status: 'FAILED', apiKey: null };
  }
}

module.exports = WalletLinkingService; 