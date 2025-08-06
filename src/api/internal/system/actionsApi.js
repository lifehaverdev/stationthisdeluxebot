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
  const { db, creditService, saltMiningService } = dependencies;

  if (!db || !creditService || !saltMiningService) {
    logger.error('[ActionsApi] Missing critical dependencies (db, creditService, or saltMiningService).');
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

    try {
      // 1. Check if name is already taken (belt and suspenders)
      const existingVault = await db.creditLedger.findReferralVaultByName(vaultName);
      if (existingVault) {
        return res.status(409).json({ error: { code: 'NAME_TAKEN', message: 'This vault name is already taken.' } });
      }

      // 2. Get user's primary wallet
      const user = await db.userCore.findUserCoreById(masterAccountId);
      if (!user || !user.wallets || user.wallets.length === 0) {
        return res.status(404).json({ error: { code: 'WALLET_NOT_FOUND', message: 'User has no wallet linked to create a vault.' }});
      }
      const primaryWallet = user.wallets.find(w => w.isPrimary) || user.wallets[0];
      const ownerAddress = primaryWallet.address;

      // 3. Mine a salt
      logger.info(`[ActionsApi] Mining salt for owner ${ownerAddress}...`, { requestId });
      const { salt, predictedAddress } = await saltMiningService.getSalt(ownerAddress);
      logger.info(`[ActionsApi] Mined salt ${salt}, predicted address ${predictedAddress}`, { requestId });

      // 4. Call creditService to deploy the vault (this method will need to be created)
      // It will handle the on-chain tx and saving the record to the DB
      const newVault = await creditService.deployReferralVault({
        masterAccountId: new ObjectId(masterAccountId),
        ownerAddress,
        vaultName,
        salt,
        predictedAddress
      });

      res.status(201).json(newVault);

    } catch (error) {
      logger.error(`[ActionsApi] Failed to create referral vault for MAID ${masterAccountId}.`, { error: error.message, stack: error.stack, requestId });
      res.status(500).json({ error: { code: 'VAULT_CREATION_FAILED', message: error.message || 'An unexpected error occurred during vault creation.' } });
    }
  });

  return router;
}

module.exports = { createActionsApi }; 