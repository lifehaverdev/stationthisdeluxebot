/**
 * Guest Account Service
 * 
 * Manages guest account creation and flagging using the existing user account system.
 * Guest accounts are regular user accounts flagged with isGuest: true.
 */

class GuestAccountService {
  constructor({ logger, internalApiClient, userCoreDb }) {
    this.logger = logger;
    this.internalApiClient = internalApiClient;
    this.userCoreDb = userCoreDb;
  }

  /**
   * Create or find user account and flag as guest
   * @param {Object} params
   * @param {string} params.walletAddress - The wallet address
   * @param {string} params.spellPaymentId - Unique ID for tracking this spell payment
   * @param {string} params.spellId - The spell ID being executed
   * @param {string} params.txHash - The transaction hash (optional initially)
   * @returns {Promise<Object>} { masterAccountId, walletAddress, isNewUser }
   */
  async createOrFindGuestAccount({ walletAddress, spellPaymentId, spellId, txHash }) {
    try {
      // Phase 7f: in-process find-or-create, replacing HTTP call to /auth/find-or-create-by-wallet
      const normalizedAddress = walletAddress.toLowerCase();
      let user = await this.userCoreDb.findUserCoreByWalletAddress(normalizedAddress);
      let isNewUser = false;
      if (!user) {
        user = await this.userCoreDb.createUserCore({
          wallets: [{ address: normalizedAddress, verified: true, isPrimary: true, addedAt: new Date() }],
          lastLoginTimestamp: new Date(),
          lastSeenPlatform: 'web'
        });
        isNewUser = true;
      } else {
        await this.userCoreDb.updateLastLogin(user._id, 'web');
      }

      const userId = user._id.toString();

      // Flag as guest account with metadata
      await this.userCoreDb.updateOne(
        { _id: user._id },
        {
          $set: {
            isGuest: true,
            guestMetadata: {
              spellPaymentId,
              spellId: spellId || null,
              txHash: txHash || null,
              createdAt: new Date()
            }
          }
        }
      );

      this.logger.info(`[GuestAccountService] Created/found guest account ${userId} for wallet ${walletAddress}`);

      return {
        masterAccountId: userId,
        walletAddress: normalizedAddress,
        isNewUser
      };
    } catch (error) {
      this.logger.error(`[GuestAccountService] Failed to create/find guest account:`, error);
      throw error;
    }
  }

  /**
   * Find guest account by spell payment ID
   * @param {string} spellPaymentId
   * @returns {Promise<Object|null>}
   */
  async findBySpellPaymentId(spellPaymentId) {
    try {
      return await this.userCoreDb.findOne({
        'guestMetadata.spellPaymentId': spellPaymentId,
        isGuest: true
      });
    } catch (error) {
      this.logger.error(`[GuestAccountService] Error finding guest by spellPaymentId:`, error);
      return null;
    }
  }

  /**
   * Find guest account by transaction hash
   * @param {string} txHash
   * @returns {Promise<Object|null>}
   */
  async findByTxHash(txHash) {
    try {
      return await this.userCoreDb.findOne({
        'guestMetadata.txHash': txHash,
        isGuest: true
      });
    } catch (error) {
      this.logger.error(`[GuestAccountService] Error finding guest by txHash:`, error);
      return null;
    }
  }

  /**
   * Update guest account metadata (e.g., when transaction is confirmed)
   * @param {string} spellPaymentId
   * @param {Object} updates - Fields to update in guestMetadata
   * @returns {Promise<Object|null>}
   */
  async updateGuestMetadata(spellPaymentId, updates) {
    try {
      const user = await this.findBySpellPaymentId(spellPaymentId);
      if (!user) {
        return null;
      }

      const updateDoc = {};
      for (const [key, value] of Object.entries(updates)) {
        updateDoc[`guestMetadata.${key}`] = value;
      }

      await this.userCoreDb.updateOne(
        { _id: user._id },
        { $set: updateDoc }
      );

      return await this.userCoreDb.findById(user._id);
    } catch (error) {
      this.logger.error(`[GuestAccountService] Error updating guest metadata:`, error);
      return null;
    }
  }

  /**
   * Convert guest account to full account (optional future feature)
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  async convertToFullAccount(userId) {
    try {
      await this.userCoreDb.updateOne(
        { _id: userId },
        {
          $unset: { isGuest: '', guestMetadata: '' }
        }
      );
      
      this.logger.info(`[GuestAccountService] Converted guest account ${userId} to full account`);
      return await this.userCoreDb.findById(userId);
    } catch (error) {
      this.logger.error(`[GuestAccountService] Error converting guest to full account:`, error);
      return null;
    }
  }
}

module.exports = GuestAccountService;

