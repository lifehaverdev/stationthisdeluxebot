const express = require('express');
const { ObjectId } = require('../../../core/services/db/BaseDB');
const { economyService } = require('../../../core/services/store/economy/EconomyService');
const CreditLedgerDB = require('../../../core/services/db/alchemy/creditLedgerDb');

/**
 * Creates the Groups API router using the existing userCoreDb.
 * @param {Object} deps - Injected dependencies (logger, db)
 * @returns {express.Router}
 */
function createGroupsApi(deps = {}) {
  const router = express.Router();
  const logger = deps.logger || console;

  if (!deps.db || !deps.db.userCore) {
    logger.error('[GroupsApi] userCoreDb dependency missing');
    throw new Error('userCoreDb dependency missing');
  }
  const userCoreDb = deps.db.userCore;
  const creditLedgerDb = deps.db.creditLedger || new CreditLedgerDB(logger);

  // Util: locate group doc by chatId
  async function findGroupDoc(chatId, platform = 'telegram_group') {
    return userCoreDb.findUserCoreByPlatformId(platform, chatId.toString());
  }

  /**
   * GET /groups/:chatId
   * Returns the group document if it exists.
   */
  router.get('/:chatId', async (req, res) => {
    const { chatId } = req.params;
    const platform = req.query.platform || 'telegram_group';
    try {
      const groupDoc = await findGroupDoc(chatId, platform);
      if (!groupDoc) return res.status(404).json({ error: { code: 'GROUP_NOT_FOUND' } });
      res.json(groupDoc);
    } catch (err) {
      logger.error(`[GroupsApi] GET /groups/${chatId} failed: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  /**
   * POST /groups/sponsor
   * Create or update sponsorship for a chat.
   * Body: { chatId, chatTitle, sponsorMasterAccountId }
   */
  router.post('/sponsor', async (req, res) => {
    const { chatId, chatTitle, sponsorMasterAccountId, platform = 'telegram_group' } = req.body;
    if (!chatId || !sponsorMasterAccountId) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'chatId and sponsorMasterAccountId required' } });
    }
    try {
      let groupDoc = await findGroupDoc(chatId, platform);
      if (!groupDoc) {
        // create
        const { user: created } = await userCoreDb.findOrCreateByPlatformId(platform, chatId.toString(), {
          accountType: 'group',
          sponsorMasterAccountId: new ObjectId(sponsorMasterAccountId),
          profile: { name: chatTitle || `Group ${chatId}` }
        });
        groupDoc = created;
      } else {
        // update
        groupDoc = await userCoreDb.updateUserCore(groupDoc._id, {
          $set: { sponsorMasterAccountId: new ObjectId(sponsorMasterAccountId) }
        });
      }
      res.json(groupDoc);
    } catch (err) {
      logger.error(`[GroupsApi] POST /groups/sponsor failed: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  /**
   * PATCH /groups/:chatId/sponsor
   * Body { sponsorMasterAccountId } nullable to clear.
   */
  router.patch('/:chatId/sponsor', async (req, res) => {
    const { chatId } = req.params;
    const { sponsorMasterAccountId } = req.body;
    const platform = req.query.platform || req.body.platform || 'telegram_group';
    try {
      const groupDoc = await findGroupDoc(chatId, platform);
      if (!groupDoc) return res.status(404).json({ error: { code: 'GROUP_NOT_FOUND' } });
      const update = sponsorMasterAccountId ? { $set: { sponsorMasterAccountId: new ObjectId(sponsorMasterAccountId) } } : { $unset: { sponsorMasterAccountId: '' } };
      const updated = await userCoreDb.updateUserCore(groupDoc._id, update);
      res.json(updated);
    } catch (err) {
      logger.error(`[GroupsApi] PATCH /groups/${chatId}/sponsor failed: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  /**
   * GET /groups/:chatId/balance
   * Returns the group pool balance (sum of points_remaining from credit ledger).
   */
  router.get('/:chatId/balance', async (req, res) => {
    const { chatId } = req.params;
    const platform = req.query.platform || 'telegram_group';
    try {
      const groupDoc = await findGroupDoc(chatId, platform);
      if (!groupDoc) return res.status(404).json({ error: { code: 'GROUP_NOT_FOUND' } });

      const activeDeposits = await creditLedgerDb.findActiveDepositsForUser(groupDoc._id);
      const balance = activeDeposits.reduce((sum, d) => sum + (d.points_remaining || 0), 0);

      let exp = 0;
      if (deps.db.userEconomy) {
        const economyRecord = await deps.db.userEconomy.findByMasterAccountId(groupDoc._id);
        if (economyRecord && economyRecord.exp != null) {
          exp = Number(economyRecord.exp);
        }
      }

      res.json({ balance, exp });
    } catch (err) {
      logger.error(`[GroupsApi] GET /groups/${chatId}/balance failed: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  /**
   * POST /groups/:chatId/fund
   * Transfer points from a user to a group's pool.
   * Body: { funderMasterAccountId, points, platform? }
   */
  router.post('/:chatId/fund', async (req, res) => {
    const { chatId } = req.params;
    const { funderMasterAccountId, points, platform = 'telegram_group' } = req.body;

    if (!funderMasterAccountId || !points) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'funderMasterAccountId and points required' } });
    }
    if (!Number.isInteger(points) || points <= 0) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'points must be a positive integer' } });
    }

    try {
      const groupDoc = await findGroupDoc(chatId, platform);
      if (!groupDoc) return res.status(404).json({ error: { code: 'GROUP_NOT_FOUND' } });
      if (!groupDoc.sponsorMasterAccountId) {
        return res.status(400).json({ error: { code: 'NOT_SPONSORED', message: 'Group must be sponsored before funding' } });
      }

      // Deduct from funder
      try {
        await economyService.spend(funderMasterAccountId, {
          pointsToSpend: points,
          spendContext: { type: 'GROUP_FUND', groupId: groupDoc._id.toString(), chatId }
        });
      } catch (spendErr) {
        if (spendErr.code === 'INSUFFICIENT_FUNDS') {
          return res.status(402).json({ error: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough points to fund this amount.' } });
        }
        throw spendErr;
      }

      // Credit to group pool
      try {
        await economyService.creditPoints(groupDoc._id, {
          points,
          description: 'Group pool funding',
          rewardType: 'GROUP_POOL_FUND',
          relatedItems: { funderMasterAccountId, chatId }
        });
      } catch (creditErr) {
        logger.error(`[GroupsApi] CRITICAL: Spend succeeded but credit failed for group ${chatId}. Funder: ${funderMasterAccountId}, Points: ${points}. Manual reconciliation required. Error: ${creditErr.message}`);
        return res.status(500).json({ error: { code: 'CREDIT_FAILED', message: 'Points were deducted but could not be credited to group pool. Please contact support.' } });
      }

      res.json({ success: true, pointsFunded: points });
    } catch (err) {
      logger.error(`[GroupsApi] POST /groups/${chatId}/fund failed: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  return router;
}

module.exports = createGroupsApi;
