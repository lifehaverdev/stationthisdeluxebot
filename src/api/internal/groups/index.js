const express = require('express');
const { ObjectId } = require('../../../core/services/db/BaseDB');

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

  // Util: locate group doc by chatId
  async function findGroupDoc(chatId) {
    return userCoreDb.findUserCoreByPlatformId('telegram_group', chatId.toString());
  }

  /**
   * GET /groups/:chatId
   * Returns the group document if it exists.
   */
  router.get('/:chatId', async (req, res) => {
    const { chatId } = req.params;
    try {
      const groupDoc = await findGroupDoc(chatId);
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
    const { chatId, chatTitle, sponsorMasterAccountId } = req.body;
    if (!chatId || !sponsorMasterAccountId) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'chatId and sponsorMasterAccountId required' } });
    }
    try {
      let groupDoc = await findGroupDoc(chatId);
      if (!groupDoc) {
        // create
        const { user: created } = await userCoreDb.findOrCreateByPlatformId('telegram_group', chatId.toString(), {
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
    try {
      const groupDoc = await findGroupDoc(chatId);
      if (!groupDoc) return res.status(404).json({ error: { code: 'GROUP_NOT_FOUND' } });
      const update = sponsorMasterAccountId ? { $set: { sponsorMasterAccountId: new ObjectId(sponsorMasterAccountId) } } : { $unset: { sponsorMasterAccountId: '' } };
      const updated = await userCoreDb.updateUserCore(groupDoc._id, update);
      res.json(updated);
    } catch (err) {
      logger.error(`[GroupsApi] PATCH /groups/${chatId}/sponsor failed: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  return router;
}

module.exports = createGroupsApi;
