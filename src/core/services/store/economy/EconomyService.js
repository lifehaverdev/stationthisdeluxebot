// src/core/services/store/economy/EconomyService.js

const CreditLedgerDB = require('../../db/alchemy/creditLedgerDb');
const UserEconomyDB = require('../../db/userEconomyDb');
const UserCoreDB = require('../../db/userCoreDb');
const { ObjectId } = require('../../db/BaseDB');
const { createLogger } = require('../../../../utils/logger');

class EconomyService {
  constructor({ creditLedgerDb, userEconomyDb, userCoreDb, logger } = {}) {
    this.creditLedger = creditLedgerDb || new CreditLedgerDB(createLogger('CreditLedgerDB'));
    this.userEconomy = userEconomyDb || new UserEconomyDB(createLogger('UserEconomyDB'));
    this.userCore = userCoreDb || new UserCoreDB(createLogger('UserCoreDB'));
    this.logger = logger || createLogger('EconomyService');
  }

  /**
   * Resolve a masterAccountId to an ObjectId.
   */
  _toOid(id) {
    return id instanceof ObjectId ? id : new ObjectId(id.toString());
  }

  /**
   * Get the primary wallet address for a user.
   * Checks wallets[] array (current schema).
   * Returns null if no wallet is linked.
   *
   * @param {string|ObjectId} masterAccountId
   * @returns {Promise<string|null>}
   */
  async getUserWalletAddress(masterAccountId) {
    const user = await this.userCore.findUserCoreById(this._toOid(masterAccountId));
    if (!user) return null;
    if (Array.isArray(user.wallets) && user.wallets.length > 0) {
      const primary = user.wallets.find(w => w.isPrimary) || user.wallets[0];
      return primary?.address || null;
    }
    return null;
  }

  /**
   * Get active confirmed deposits for a wallet address.
   * Used for MS2 pricing tier check.
   *
   * @param {string} walletAddress
   * @returns {Promise<Array>}
   */
  async getActiveDepositsByWallet(walletAddress) {
    return this.creditLedger.findActiveDepositsForWalletAddress(walletAddress);
  }

  /**
   * Deduct points from a user's active deposits.
   * Mirrors the POST /economy/spend handler exactly:
   *   1. Find deposits by masterAccountId
   *   2. Fallback to primary wallet address if none found
   *   3. Supplement with wallet deposits if still insufficient
   *   4. Execute deduction in a transaction, sorted by lowest funding rate first
   *
   * @param {string|ObjectId} masterAccountId
   * @param {{ pointsToSpend: number, spendContext?: object }} options
   * @returns {Promise<Array>} spend breakdown
   * @throws if insufficient funds or deduction fails
   */
  async spend(masterAccountId, { pointsToSpend, spendContext } = {}) {
    if (!Number.isInteger(pointsToSpend) || pointsToSpend <= 0) {
      throw new Error('pointsToSpend must be a positive integer.');
    }

    const oid = this._toOid(masterAccountId);
    const idStr = oid.toString();

    // 1. Try by masterAccountId
    let activeDeposits = await this.creditLedger.findActiveDepositsForUser(oid);
    let spendTarget = 'masterAccountId';

    // 2. If none, fallback to primary wallet address
    if (!activeDeposits || activeDeposits.length === 0) {
      this.logger.debug(`[EconomyService] spend: No deposits for ${idStr}, attempting wallet fallback.`);
      const walletAddress = await this.getUserWalletAddress(oid);
      if (walletAddress) {
        this.logger.debug(`[EconomyService] spend: Fallback to wallet-based spend for ${walletAddress}`);
        activeDeposits = await this.creditLedger.findActiveDepositsForWalletAddress(walletAddress);
        spendTarget = 'walletAddress';
      }
    }

    if (!activeDeposits || activeDeposits.length === 0) {
      throw Object.assign(new Error('User has no active deposits with points remaining.'), { code: 'INSUFFICIENT_FUNDS' });
    }

    // 3. Check if enough total points; supplement with wallet deposits if needed
    const totalPointsRemaining = activeDeposits.reduce((sum, d) => sum + (d.points_remaining || 0), 0);

    if (totalPointsRemaining < pointsToSpend) {
      const walletAddress = await this.getUserWalletAddress(oid);
      if (walletAddress) {
        this.logger.debug(`[EconomyService] spend: Supplementing from wallet ${walletAddress}`);
        const supplemental = await this.creditLedger.findActiveDepositsForWalletAddress(walletAddress);
        const existingIds = new Set(activeDeposits.map(d => d._id.toString()));
        for (const dep of supplemental) {
          if (!existingIds.has(dep._id.toString())) {
            activeDeposits.push(dep);
          }
        }
        if (spendTarget === 'masterAccountId') spendTarget = 'combined';
      }
    }

    // 4. Re-evaluate after supplementation
    const combinedPoints = activeDeposits.reduce((sum, d) => sum + (d.points_remaining || 0), 0);
    if (combinedPoints < pointsToSpend) {
      throw Object.assign(
        new Error(`User has insufficient points. Required: ${pointsToSpend}, Available: ${combinedPoints}.`),
        { code: 'INSUFFICIENT_FUNDS' }
      );
    }

    // 5. Execute deduction in a transaction
    const spendSummary = await this.creditLedger.withTransaction(async (session) => {
      // Re-read deposits within transaction for consistency
      let txDeposits;
      if (spendTarget === 'masterAccountId' || spendTarget === 'combined') {
        txDeposits = await this.creditLedger.findActiveDepositsForUser(oid);
      } else {
        const walletAddress = await this.getUserWalletAddress(oid);
        txDeposits = walletAddress
          ? await this.creditLedger.findActiveDepositsForWalletAddress(walletAddress)
          : [];
      }

      // Supplement wallet deposits inside transaction for combined case
      if (spendTarget === 'combined') {
        const walletAddress = await this.getUserWalletAddress(oid);
        if (walletAddress) {
          const supplemental = await this.creditLedger.findActiveDepositsForWalletAddress(walletAddress);
          const existingIds = new Set(txDeposits.map(d => d._id.toString()));
          for (const dep of supplemental) {
            if (!existingIds.has(dep._id.toString())) txDeposits.push(dep);
          }
        }
      }

      const txTotal = txDeposits.reduce((sum, d) => sum + (d.points_remaining || 0), 0);
      if (txTotal < pointsToSpend) {
        throw new Error(`Insufficient points in transaction. Required: ${pointsToSpend}, Available: ${txTotal}`);
      }

      // Sort by lowest funding rate first
      txDeposits.sort((a, b) => (a.funding_rate_applied || 0) - (b.funding_rate_applied || 0));

      let pointsLeft = pointsToSpend;
      const summary = [];

      for (const deposit of txDeposits) {
        if (pointsLeft <= 0) break;
        const pointsBefore = deposit.points_remaining;
        const toDeduct = Math.min(pointsLeft, pointsBefore);
        await this.creditLedger.deductPointsFromDeposit(deposit._id, toDeduct, session);
        summary.push({
          depositId: deposit._id.toString(),
          tokenAddress: deposit.token_address,
          fundingRate: deposit.funding_rate_applied,
          pointsBefore,
          pointsDeducted: toDeduct,
          pointsAfter: pointsBefore - toDeduct,
        });
        pointsLeft -= toDeduct;
      }

      if (pointsLeft > 0) {
        throw new Error(`Failed to deduct all points. Remaining: ${pointsLeft}`);
      }

      return summary;
    });

    this.logger.info(`[EconomyService] SPEND_LOG: User ${idStr} spent ${pointsToSpend} points (target: ${spendTarget})`, {
      totalPointsSpent: pointsToSpend,
      spendBreakdown: spendSummary,
      context: spendContext || 'N/A',
    });

    return spendSummary;
  }

  /**
   * Credit points to a user as a reward.
   * Mirrors POST /economy/credit-points handler exactly.
   *
   * @param {string|ObjectId} masterAccountId
   * @param {{ points: number, description: string, rewardType: string, relatedItems?: object }} options
   * @returns {Promise<{ entryId: ObjectId }>}
   */
  async creditPoints(masterAccountId, { points, description, rewardType, relatedItems } = {}) {
    if (!Number.isInteger(points) || points <= 0) {
      throw new Error('points must be a positive integer.');
    }
    if (!description || typeof description !== 'string') {
      throw new Error('description must be a non-empty string.');
    }
    if (!rewardType || typeof rewardType !== 'string') {
      throw new Error('rewardType must be a non-empty string.');
    }

    const oid = this._toOid(masterAccountId);
    const result = await this.creditLedger.createRewardCreditEntry({
      masterAccountId: oid,
      points,
      rewardType,
      description,
      relatedItems,
    });

    if (!result.insertedId) {
      throw new Error('Database operation failed to create reward entry.');
    }

    return { entryId: result.insertedId };
  }

  /**
   * Increment (or decrement) a user's EXP.
   * Mirrors PUT /economy/exp handler exactly.
   *
   * @param {string|ObjectId} masterAccountId
   * @param {number} expChange — integer, may be negative
   * @returns {Promise<void>}
   */
  async updateExp(masterAccountId, expChange) {
    const expChangeInt = parseInt(expChange, 10);
    if (!Number.isInteger(expChangeInt)) {
      throw new Error('expChange must be an integer.');
    }

    const oid = this._toOid(masterAccountId);
    const result = await this.userEconomy.updateExperience(oid, expChangeInt);

    if (!result || result.matchedCount === 0) {
      this.logger.warn(`[EconomyService] updateExp: Economy record not found for ${oid.toString()}`);
    }
  }
}

// Singleton for production use
const defaultService = new EconomyService();

module.exports = { EconomyService, economyService: defaultService };
