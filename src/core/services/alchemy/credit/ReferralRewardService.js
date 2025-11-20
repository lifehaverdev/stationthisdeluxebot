/**
 * ReferralRewardService
 * 
 * Handles referral reward calculation and routing.
 * Routes rewards to creator accounts, checking for referral vaults.
 */
class ReferralRewardService {
  constructor(creditLedgerDb, logger) {
    this.creditLedgerDb = creditLedgerDb;
    this.logger = logger || console;
  }

  /**
   * Routes a point reward to the creator's referral vault if it exists, otherwise directly to the creator.
   * @param {string|ObjectId} creatorAccountId - The creator's master account ID
   * @param {number} points - The points to credit
   * @param {object} meta - Additional metadata to store on reward entry
   */
  async routeReward(creatorAccountId, points, meta = {}) {
    if (points <= 0) return;
    
    try {
      // Check for referral vaults
      const vaults = await this.creditLedgerDb.findReferralVaultsByMasterAccount(creatorAccountId);
      const targetAccountId = creatorAccountId; // For now we credit creator directly
      const description = vaults.length > 0
        ? `Creator share routed (${points} pts) via referral vault.`
        : `Creator share credited directly (${points} pts).`;

      await this.creditLedgerDb.createRewardCreditEntry({
        masterAccountId: targetAccountId,
        points,
        rewardType: 'SPELL_CREATOR_SHARE',
        description,
        relatedItems: meta,
      });
    } catch (err) {
      this.logger.error('[ReferralRewardService] routeReward failed:', err);
      throw err;
    }
  }

  /**
   * Calculates referral reward based on gross deposit USD and vault account.
   * @param {number} grossDepositUsd - The gross deposit amount in USD
   * @param {object} vaultAccount - The vault account object
   * @returns {number} The calculated referral reward points
   */
  calculateReferralReward(grossDepositUsd, vaultAccount) {
    // This is a placeholder - actual calculation logic should be extracted from CreditService
    // if there's specific referral reward calculation logic
    return 0;
  }
}

module.exports = ReferralRewardService;

