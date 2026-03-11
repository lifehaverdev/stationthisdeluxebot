const express = require('express');
const { createLogger } = require('../../../utils/logger');

const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');

const logger = createLogger('ActionsApi');

/**
 * Creates a router for complex, multi-step internal actions.
 * @param {object} dependencies - Service dependencies.
 * @returns {express.Router}
 */
function createActionsApi(dependencies) {
  const router = express.Router();
  const { db } = dependencies;

  if (!db) {
    logger.error('[ActionsApi] Missing critical dependency: db.');
    router.use((req, res) => res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'A critical service is not available.' }}));
    return router;
  }

  router.post('/create-referral-vault', async (req, res) => {
    const requestId = uuidv4();
    const { masterAccountId, vaultName } = req.body;

    logger.info(`[ActionsApi] /create-referral-vault called for MAID ${masterAccountId} with name "${vaultName}"`, { requestId });

    if (!masterAccountId || !vaultName) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'masterAccountId and vaultName are required.' } });
    }

    if (vaultName.length < 4 || !/^[a-zA-Z0-9_-]+$/.test(vaultName)) {
      return res.status(400).json({ error: { code: 'INVALID_NAME', message: 'Name must be at least 4 characters and contain only letters, numbers, underscores, or dashes.' } });
    }

    try {
      // 1. Check if name is already taken
      const existingVault = await db.creditLedger.findReferralVaultByName(vaultName);
      if (existingVault) {
        return res.status(409).json({ error: { code: 'NAME_TAKEN', message: 'This referral code name is already taken.' } });
      }

      // 2. Get user's primary wallet
      const user = await db.userCore.findUserCoreById(masterAccountId);
      if (!user || !user.wallets || user.wallets.length === 0) {
        return res.status(404).json({ error: { code: 'WALLET_NOT_FOUND', message: 'User has no wallet linked.' }});
      }
      const primaryWallet = user.wallets.find(w => w.isPrimary) || user.wallets[0];
      const ownerAddress = primaryWallet.address;

      // 3. Claim the name — store in DB, no on-chain deployment needed.
      //    When used in a deposit, the name is hashed on-chain: keccak256(vaultName)
      const result = await db.creditLedger.createReferralVault({
        vault_name: vaultName,
        owner_address: ownerAddress,
        master_account_id: new ObjectId(masterAccountId),
        status: 'ACTIVE',
      });

      logger.info(`[ActionsApi] Referral code "${vaultName}" claimed by ${ownerAddress}`, { requestId });

      res.status(201).json({
        vault_name: vaultName,
        owner_address: ownerAddress,
        master_account_id: masterAccountId,
        status: 'ACTIVE',
        _id: result.insertedId,
      });

    } catch (error) {
      logger.error(`[ActionsApi] Failed to create referral vault for MAID ${masterAccountId}.`, { error: error.message, stack: error.stack, requestId });
      res.status(500).json({ error: { code: 'VAULT_CREATION_FAILED', message: error.message || 'An unexpected error occurred.' } });
    }
  });

  return router;
}

module.exports = { createActionsApi }; 