const { createLogger } = require('../../utils/logger');
const { generateApiKey } = require('./apiKeyService');

/**
 * @class WalletLinkingService
 * @description Manages the business logic for linking wallets, including the "magic amount" flow for new users.
 */
class WalletLinkingService {
  constructor(dependencies) {
    this.logger = dependencies.logger || createLogger('WalletLinkingService');
    const { userCoreDb, walletLinkingRequestDb, redisCache } = dependencies.db;

    if (!userCoreDb || !walletLinkingRequestDb || !redisCache) {
      throw new Error('WalletLinkingService: Missing required database dependencies (userCoreDb, walletLinkingRequestDb, redisCache).');
    }
    this.userCoreDb = userCoreDb;
    this.walletLinkingRequestDb = walletLinkingRequestDb;
    this.redisCache = redisCache; // For temporarily storing the raw API key
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
    await this.redisCache.set(claimKey, apiKey, { EX: 300 }); // 5-minute expiry to claim the key

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
    
    if (linkingRequest.status === 'PENDING') {
      return { status: 'PENDING', apiKey: null };
    }

    if (linkingRequest.status === 'COMPLETED') {
      const claimKey = `api_key_claim:${requestId}`;
      // Use DEL to fetch and delete the key atomically, ensuring it's only claimed once.
      const apiKey = await this.redisCache.del(claimKey);

      if (apiKey) {
        this.logger.info(`[WalletLinkingService] API key for request ${requestId} has been successfully claimed.`);
        return { status: 'COMPLETED', apiKey: apiKey };
      } else {
        this.logger.warn(`[WalletLinkingService] Attempted to claim key for completed request ${requestId}, but key was already claimed or expired from cache.`);
        return { status: 'ALREADY_CLAIMED', apiKey: null };
      }
    }

    // Default case for other statuses like FAILED
    return { status: 'FAILED', apiKey: null };
  }
}

module.exports = WalletLinkingService; 