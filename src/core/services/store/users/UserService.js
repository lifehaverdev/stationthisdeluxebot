/**
 * UserService
 *
 * In-process domain service for user core operations.
 * Replaces internalApiClient calls to /internal/v1/data/users/*.
 *
 * Methods mirror the most-called internal API endpoints:
 *   - findOrCreate  → POST /users/find-or-create
 *   - findById      → GET  /users/:masterAccountId
 *   - findByPlatformId → GET /users/by-platform/:platform/:platformId
 */

const { ObjectId, Decimal128 } = require('mongodb');
const UserCoreDB = require('../../db/userCoreDb');
const { createLogger } = require('../../../../utils/logger');

const USD_CREDIT_TO_POINTS_RATE = 0.00037;
const LIVE_TASK_STATUSES = ['pending', 'processing', 'running', 'queued', 'waiting'];
const PENDING_TASK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

class UserService {
  constructor({ userCoreDb, userEconomyDb, creditLedgerDb, generationOutputsDb, logger } = {}) {
    this.userCoreDb = userCoreDb || new UserCoreDB(createLogger('UserCoreDB'));
    this.userEconomyDb = userEconomyDb || null;
    this.creditLedgerDb = creditLedgerDb || null;
    this.generationOutputsDb = generationOutputsDb || null;
    this.logger = logger || createLogger('UserService');
  }

  /**
   * Find or create a user by platform identity.
   * Returns same shape as the internal HTTP endpoint for drop-in replacement.
   *
   * @param {object} params
   * @param {string} params.platform - e.g. 'telegram', 'discord', 'web'
   * @param {string} params.platformId - platform-specific user ID
   * @param {object} [params.platformContext] - optional extra data (firstName, username, etc.)
   * @returns {Promise<{ masterAccountId: string, user: object, isNewUser: boolean }>}
   */
  async findOrCreate({ platform, platformId, platformContext = {} }) {
    if (!platform || typeof platform !== 'string' || platform.trim() === '') {
      throw new Error("Missing or invalid 'platform'. Must be a non-empty string.");
    }
    if (!platformId || typeof platformId !== 'string' || platformId.trim() === '') {
      throw new Error("Missing or invalid 'platformId'. Must be a non-empty string.");
    }

    const { user, isNew } = await this.userCoreDb.findOrCreateByPlatformId(platform, platformId, platformContext);

    if (!user || !user._id) {
      throw new Error(`findOrCreateByPlatformId returned null or invalid user for ${platform}:${platformId}`);
    }

    this.logger.debug(`[UserService] findOrCreate: user ${isNew ? 'created' : 'found'} for ${platform}:${platformId}`);

    return {
      masterAccountId: user._id.toString(),
      user,
      isNewUser: isNew,
    };
  }

  /**
   * Find a user by their MongoDB _id (masterAccountId).
   *
   * @param {string} masterAccountId
   * @returns {Promise<object|null>}
   */
  async findById(masterAccountId) {
    if (!masterAccountId) return null;
    return this.userCoreDb.findUserCoreById(masterAccountId);
  }

  /**
   * Find a user by platform identity without creating.
   *
   * @param {string} platform
   * @param {string} platformId
   * @returns {Promise<object|null>}
   */
  async findByPlatformId(platform, platformId) {
    if (!platform || !platformId) return null;
    return this.userCoreDb.findUserCoreByPlatformId(platform, platformId);
  }

  /**
   * Generate a status report for a user.
   * Aggregates: points (ledger), EXP, wallet address, live generation tasks.
   * Mirrors GET /users/:masterAccountId/status-report
   *
   * @param {string} masterAccountId
   * @returns {Promise<{ points: number, exp: number, walletAddress: string|null, liveTasks: Array }>}
   */
  async getStatusReport(masterAccountId) {
    const oid = masterAccountId instanceof ObjectId
      ? masterAccountId
      : new ObjectId(masterAccountId.toString());

    // 1. EXP from userEconomy
    let points = 0;
    let exp = 0;
    let economyRecord = null;
    if (this.userEconomyDb) {
      economyRecord = await this.userEconomyDb.findByMasterAccountId(oid);
      if (economyRecord?.exp) {
        const raw = economyRecord.exp instanceof Decimal128
          ? parseFloat(economyRecord.exp.toString())
          : parseFloat(economyRecord.exp);
        if (!isNaN(raw)) exp = Math.floor(raw);
      }
    }

    // 2. Wallet address from userCore
    let walletAddress = null;
    const userCoreRecord = await this.userCoreDb.findUserCoreById(oid);
    if (userCoreRecord?.wallets?.length) {
      const primary = userCoreRecord.wallets.find(w => w.isPrimary === true)
        || userCoreRecord.wallets.find(w => w.active === true);
      if (primary) walletAddress = primary.address;
    }

    // 3. Points from creditLedger via wallet
    if (walletAddress && this.creditLedgerDb?.sumPointsRemainingForWalletAddress) {
      try {
        const ledgerPoints = await this.creditLedgerDb.sumPointsRemainingForWalletAddress(walletAddress);
        if (typeof ledgerPoints === 'number' && !isNaN(ledgerPoints)) {
          points = ledgerPoints;
        }
      } catch (err) {
        this.logger.error(`[UserService] getStatusReport: ledger points error for ${walletAddress}: ${err.message}`);
      }
    }

    // Fallback: legacy USD credit conversion
    if (points === 0 && economyRecord?.usdCredit) {
      const usd = parseFloat(economyRecord.usdCredit.toString());
      if (!isNaN(usd)) points = Math.floor(usd / USD_CREDIT_TO_POINTS_RATE);
    }

    // 4. Live generation tasks
    let liveTasks = [];
    if (this.generationOutputsDb) {
      try {
        const records = await this.generationOutputsDb.findGenerationsByMasterAccount(oid);
        if (records?.length) {
          const now = Date.now();
          liveTasks = records
            .filter(task => {
              const s = task.status?.toLowerCase() || '';
              if (!LIVE_TASK_STATUSES.includes(s)) return false;
              if (s === 'pending') {
                const ts = new Date(task.requestTimestamp);
                return !isNaN(ts.getTime()) ? (now - ts.getTime()) < PENDING_TASK_MAX_AGE_MS : true;
              }
              return true;
            })
            .map(task => {
              let costUsd = task.costUsd instanceof Decimal128
                ? parseFloat(task.costUsd.toString())
                : (typeof task.costUsd === 'number' ? task.costUsd : null);
              return {
                idHash: require('crypto').createHash('sha256').update(task._id.toString()).digest('hex').substring(0, 5),
                status: task.status,
                costUsd,
                progress: task.metadata?.progressPercent ?? null,
                sourcePlatform: task.notificationPlatform || task.sourcePlatform || null,
                updatedAt: task.updatedAt || task.responseTimestamp || task.requestTimestamp || null,
                startedAt: task.requestTimestamp || null,
                toolId: task.toolId || null,
              };
            });
        }
      } catch (err) {
        this.logger.error(`[UserService] getStatusReport: live tasks error for ${masterAccountId}: ${err.message}`);
      }
    }

    return { points, exp, walletAddress, liveTasks };
  }
}

const userService = new UserService();

module.exports = { UserService, userService };
