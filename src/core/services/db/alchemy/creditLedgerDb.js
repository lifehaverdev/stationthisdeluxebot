const { BaseDB, ObjectId } = require('../BaseDB');

const COLLECTION_NAME = 'credit_ledger';

class CreditLedgerDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    if (!logger) {
      const tempLogger = console;
      tempLogger.warn('[CreditLedgerDB] Logger instance was not provided during construction. Falling back to console.');
      this.logger = tempLogger;
    } else {
      this.logger = logger;
    }
  }

  /**
   * Creates a new entry in the credit ledger.
   * This should be called when a new on-chain deposit event is detected.
   * @param {object} entryDetails - The details of the ledger entry.
   * @param {string} entryDetails.deposit_tx_hash - The hash of the deposit transaction.
   * @param {number} entryDetails.deposit_log_index - The log index of the deposit event.
   * @param {number} entryDetails.deposit_block_number - The block number of the deposit.
   * @param {string} entryDetails.deposit_contract_address - Address of the contract that received the deposit.
   * @param {string} entryDetails.deposit_contract_type - Type of contract ('MAIN_VAULT' or 'REFERRAL_VAULT').
   * @param {string} entryDetails.deposit_event_name - Name of the event ('Deposit' or 'AccountDeposit').
   * @param {ObjectId} entryDetails.masterAccountId - The master account ID of the user.
   * @param {string} entryDetails.depositor_address - The wallet address that made the deposit.
   * @param {string|null} entryDetails.referrer_address - The address of the referrer, if applicable.
   * @param {string} entryDetails.deposit_amount_wei - The raw amount of tokens deposited.
   * @returns {Promise<Object>} The result of the insertion.
   */
  async createLedgerEntry(entryDetails) {
    const dataToInsert = {
      ...entryDetails,
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return this.insertOne(dataToInsert);
  }

  /**
   * Updates the status of a ledger entry.
   * Typically used to move an entry from PENDING_CONFIRMATION to CONFIRMED.
   * @param {string} depositTxHash - The hash of the original deposit transaction.
   * @param {string} status - The new status (e.g., 'CONFIRMED', 'FAILED').
   * @param {object} [additionalData={}] - An object with additional fields to set.
   * @returns {Promise<Object>} The result of the update operation.
   */
  async updateLedgerStatus(depositTxHash, status, additionalData = {}) {
    const filter = { deposit_tx_hash: depositTxHash };
    const update = {
      $set: {
        status,
        ...additionalData,
        updatedAt: new Date(),
      },
    };
    return this.updateOne(filter, update);
  }

  /**
   * Finds a ledger entry by the original deposit transaction hash.
   * @param {string} depositTxHash - The hash of the deposit transaction.
   * @returns {Promise<Object|null>} The ledger entry document, or null if not found.
   */
  async findLedgerEntryByTxHash(depositTxHash) {
    return this.findOne({ deposit_tx_hash: depositTxHash });
  }

  /**
   * Finds all ledger entries that are pending processing (pending confirmation or errored).
   * Useful for reconciliation or retrying failed confirmations.
   * @returns {Promise<Array<Object>>} A list of entries to be processed.
   */
  async findProcessableEntries() {
    return this.findMany({ 
      status: { $in: ['PENDING_CONFIRMATION', 'ERROR'] } 
    });
  }

  /**
   * Creates a new withdrawal request entry in the ledger.
   * @param {object} requestDetails - The details of the withdrawal request
   * @param {string} requestDetails.request_tx_hash - Hash of the withdrawal request transaction
   * @param {number} requestDetails.request_block_number - Block number of the request
   * @param {string} requestDetails.vault_account - Address of the vault account
   * @param {string} requestDetails.user_address - Address of the user requesting withdrawal
   * @param {string} requestDetails.token_address - Address of the token to withdraw
   * @param {string} requestDetails.master_account_id - User's master account ID
   * @param {string} requestDetails.status - Initial status of the request
   * @param {string} requestDetails.collateral_amount_wei - Amount of collateral in wei
   * @returns {Promise<Object>} The created withdrawal request document
   */
  async createWithdrawalRequest(requestDetails) {
    const dataToInsert = {
      ...requestDetails,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    return this.insertOne(dataToInsert);
  }

  /**
   * Finds a withdrawal request by its transaction hash.
   * @param {string} txHash - The transaction hash to search for
   * @returns {Promise<Object|null>} The withdrawal request document or null if not found
   */
  async findWithdrawalRequestByTxHash(txHash) {
    return this.findOne({ request_tx_hash: txHash });
  }

  /**
   * Updates the status of a withdrawal request.
   * @param {string} requestTxHash - The transaction hash of the withdrawal request
   * @param {string} status - The new status
   * @param {object} additionalData - Additional data to update
   * @returns {Promise<Object>} The result of the update operation
   */
  async updateWithdrawalRequestStatus(requestTxHash, status, additionalData = {}) {
    const filter = { request_tx_hash: requestTxHash };
    const update = {
      $set: {
        status,
        ...additionalData,
        updatedAt: new Date()
      }
    };
    return this.updateOne(filter, update);
  }

  /**
   * Finds all withdrawal requests in a specific status.
   * @param {string} status - The status to filter by
   * @returns {Promise<Array>} Array of withdrawal request documents
   */
  async findWithdrawalRequestsByStatus(status) {
    return this.find({ status });
  }

  /**
   * Records a new referral vault in the ledger.
   * @param {object} vaultDetails - Details of the referral vault
   * @param {string} vaultDetails.vault_address - The address of the created vault
   * @param {string} vaultDetails.owner_address - The address that owns the vault
   * @param {string} vaultDetails.master_account_id - The master account ID from userCore
   * @param {string} vaultDetails.creation_tx_hash - The transaction hash where the vault was created
   * @param {string} vaultDetails.salt - The salt used to create the vault
   * @returns {Promise<Object>} The created vault document
   */
  async createReferralVault(vaultDetails) {
    const dataToInsert = {
      ...vaultDetails,
      type: 'REFERRAL_VAULT',
      is_active: true,
      total_referral_volume_wei: '0', // Track total volume through this vault
      total_referral_rewards_wei: '0', // Track total rewards earned
      createdAt: new Date(),
      updatedAt: new Date()
    };
    return this.insertOne(dataToInsert);
  }

  /**
   * Finds a referral vault by its address.
   * @param {string} vaultAddress - The address of the vault to find
   * @returns {Promise<Object|null>} The vault document or null if not found
   */
  async findReferralVaultByAddress(vaultAddress) {
    return this.findOne({
      vault_address: vaultAddress,
      type: 'REFERRAL_VAULT'
    });
  }

  /**
   * Gets all active referral vaults owned by a user's master account.
   * @param {string} masterAccountId - The master account ID from userCore
   * @returns {Promise<Array>} Array of vault documents
   */
  async findReferralVaultsByMasterAccount(masterAccountId) {
    return this.findMany({
      master_account_id: masterAccountId,
      type: 'REFERRAL_VAULT',
      is_active: true
    });
  }

  /**
   * Gets all active referral vaults owned by a specific wallet address.
   * @param {string} ownerAddress - The wallet address that owns the vaults
   * @returns {Promise<Array>} Array of vault documents
   */
  async findReferralVaultsByOwner(ownerAddress) {
    return this.findMany({
      owner_address: ownerAddress,
      type: 'REFERRAL_VAULT',
      is_active: true
    });
  }

  /**
   * Updates the referral volume and rewards for a vault.
   * @param {string} vaultAddress - The address of the vault
   * @param {string} additionalVolumeWei - Additional volume in wei to add
   * @param {string} rewardsWei - Rewards in wei to add
   * @returns {Promise<Object>} The result of the update operation
   */
  async updateReferralVaultStats(vaultAddress, additionalVolumeWei, rewardsWei) {
    return this.updateOne(
      { vault_address: vaultAddress, type: 'REFERRAL_VAULT' },
      {
        $inc: {
          total_referral_volume_wei: additionalVolumeWei,
          total_referral_rewards_wei: rewardsWei
        },
        $set: { updatedAt: new Date() }
      }
    );
  }

  /**
   * Finds all active, confirmed deposit entries for a user that can be spent from.
   * The deposits are sorted by their funding rate in ascending order, so that
   * lower-quality assets are spent first.
   * @param {ObjectId} masterAccountId - The user's master account ID.
   * @returns {Promise<Array<Object>>} A sorted list of credit ledger entries.
   */
  async findActiveDepositsForUser(masterAccountId) {
    return this.findMany(
      {
        master_account_id: masterAccountId,
        status: 'CONFIRMED',
        points_remaining: { $gt: 0 },
      },
      {
        sort: { funding_rate_applied: 1 }, // Ascending order (lowest rate first)
      }
    );
  }

  /**
   * Finds all active, confirmed deposit entries for a wallet address that can be spent from.
   * The deposits are sorted by their funding rate in ascending order.
   * @param {string} walletAddress - The user's wallet address (case-insensitive).
   * @returns {Promise<Array<Object>>} A sorted list of credit ledger entries.
   */
  async findActiveDepositsForWalletAddress(walletAddress) {
    if (!walletAddress) return [];
    return this.findMany(
      {
        depositor_address: { $regex: `^${walletAddress}$`, $options: 'i' },
        status: 'CONFIRMED',
        points_remaining: { $gt: 0 },
      },
      {
        sort: { funding_rate_applied: 1 },
      }
    );
  }

  /**
   * Atomically deducts a specified number of points from a specific deposit entry.
   * @param {ObjectId} depositId - The _id of the credit_ledger entry.
   * @param {number} pointsToDeduct - The number of points to subtract from points_remaining.
   * @returns {Promise<Object>} The result of the update operation.
   */
  async deductPointsFromDeposit(depositId, pointsToDeduct) {
    if (pointsToDeduct <= 0) {
      throw new Error('Points to deduct must be a positive number.');
    }
    return this.updateOne(
      { _id: depositId },
      {
        $inc: { points_remaining: -pointsToDeduct },
        $set: { updatedAt: new Date() },
      }
    );
  }

  /**
   * Creates a new, confirmed credit ledger entry specifically for rewards.
   * This bypasses the typical on-chain deposit flow.
   * @param {object} rewardDetails - The details of the reward.
   * @param {ObjectId} rewardDetails.masterAccountId - The account ID of the user receiving the reward.
   * @param {number} rewardDetails.points - The number of points to credit.
   * @param {string} rewardDetails.rewardType - The type of reward (e.g., 'CONTRIBUTOR_REWARD').
   * @param {string} rewardDetails.description - A description of why the reward was given.
   * @param {object} rewardDetails.relatedItems - Contextual data, like the source generation ID.
   * @returns {Promise<Object>} The result of the insertion.
   */
  async createRewardCreditEntry(rewardDetails) {
    const { masterAccountId, points, rewardType, description, relatedItems } = rewardDetails;
    const now = new Date();

    const dataToInsert = {
      master_account_id: masterAccountId,
      status: 'CONFIRMED',
      type: rewardType,
      description: description,
      points_credited: points,
      points_remaining: points,
      related_items: relatedItems || {},
      createdAt: now,
      updatedAt: now,
      // Note: Fields from on-chain deposits like tx_hashes, addresses, and USD values are intentionally null.
    };
    return this.insertOne(dataToInsert);
  }

  /**
   * Sums the points_remaining for all active, confirmed deposits for a wallet address.
   * @param {string} walletAddress - The user's wallet address (case-insensitive).
   * @returns {Promise<number>} The total points remaining.
   */
  async sumPointsRemainingForWalletAddress(walletAddress) {
    if (!walletAddress) return 0;
    const match = {
      depositor_address: { $regex: `^${walletAddress}$`, $options: 'i' },
      status: 'CONFIRMED',
      points_remaining: { $gt: 0 },
    };
    // Debug: log how many entries match before aggregation
    const allEntries = await this.findMany(match);
    this.logger.info(`[CreditLedgerDB] Aggregating points for wallet ${walletAddress}: Found ${allEntries.length} matching ledger entries.`);
    if (allEntries.length > 0) {
      this.logger.info(`[CreditLedgerDB] Points remaining in entries:`, allEntries.map(e => e.points_remaining));
    }
    const result = await this.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: "$points_remaining" } } }
    ]);
    this.logger.info(`[CreditLedgerDB] Aggregation result for wallet ${walletAddress}:`, result);
    return result.length > 0 ? result[0].total : 0;
  }

  /**
   * @deprecated Use sumPointsRemainingForWalletAddress instead.
   */
  async sumPointsRemainingForUser(masterAccountId) {
    // Deprecated: Use wallet address instead
    return 0;
  }
}

module.exports = CreditLedgerDB; 