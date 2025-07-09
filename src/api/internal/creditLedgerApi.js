const express = require('express');
const { v4: uuidv4 } = require('uuid');

/**
 * Creates the credit ledger API router
 * @param {object} services - Service container
 * @param {CreditLedgerDB} services.creditLedgerDb - Credit ledger database service
 * @param {object} logger - Logger instance
 * @returns {express.Router} The configured router
 */
function createCreditLedgerApi(services, logger) {
  const router = express.Router();
  const creditLedgerDb = services.db?.creditLedger;

  if (!creditLedgerDb) {
    throw new Error('CreditLedgerApi: Missing creditLedgerDb service');
  }

  // POST /ledger/entries - Create a new ledger entry
  router.post('/entries', async (req, res) => {
    const requestId = uuidv4();
    const { deposit_tx_hash, deposit_log_index, deposit_block_number, vault_account, depositor_address, token_address, deposit_amount_wei } = req.body;

    logger.info(`[creditLedgerApi] POST /ledger/entries - RequestId: ${requestId}`, { body: req.body });

    try {
      const entry = await creditLedgerDb.createLedgerEntry({
        deposit_tx_hash,
        deposit_log_index,
        deposit_block_number,
        vault_account,
        depositor_address,
        token_address,
        deposit_amount_wei,
        status: 'PENDING_CONFIRMATION'
      });

      res.status(201).json({ entry, requestId });
    } catch (error) {
      logger.error(`[creditLedgerApi] Error creating ledger entry:`, error);
      res.status(500).json({ error: { message: 'Failed to create ledger entry', details: error.message, requestId } });
    }
  });

  // GET /ledger/entries/:txHash - Get a ledger entry by transaction hash
  router.get('/entries/:txHash', async (req, res) => {
    const { txHash } = req.params;
    const requestId = uuidv4();

    logger.info(`[creditLedgerApi] GET /ledger/entries/${txHash} - RequestId: ${requestId}`);

    try {
      const entry = await creditLedgerDb.findLedgerEntryByTxHash(txHash);
      if (!entry) {
        return res.status(404).json({ error: { message: 'Ledger entry not found', requestId } });
      }
      res.json({ entry, requestId });
    } catch (error) {
      logger.error(`[creditLedgerApi] Error finding ledger entry:`, error);
      res.status(500).json({ error: { message: 'Failed to find ledger entry', details: error.message, requestId } });
    }
  });

  // PUT /ledger/entries/:txHash/status - Update a ledger entry status
  router.put('/entries/:txHash/status', async (req, res) => {
    const { txHash } = req.params;
    const { status, confirmation_tx_hash, additional_data } = req.body;
    const requestId = uuidv4();

    logger.info(`[creditLedgerApi] PUT /ledger/entries/${txHash}/status - RequestId: ${requestId}`, { body: req.body });

    try {
      const result = await creditLedgerDb.updateLedgerStatus(txHash, status, confirmation_tx_hash, additional_data);
      res.json({ result, requestId });
    } catch (error) {
      logger.error(`[creditLedgerApi] Error updating ledger entry status:`, error);
      res.status(500).json({ error: { message: 'Failed to update ledger entry status', details: error.message, requestId } });
    }
  });

  // POST /ledger/withdrawals - Create a new withdrawal request
  router.post('/withdrawals', async (req, res) => {
    const requestId = uuidv4();
    const { request_tx_hash, request_block_number, vault_account, user_address, token_address, master_account_id, collateral_amount_wei } = req.body;

    logger.info(`[creditLedgerApi] POST /ledger/withdrawals - RequestId: ${requestId}`, { body: req.body });

    try {
      const request = await creditLedgerDb.createWithdrawalRequest({
        request_tx_hash,
        request_block_number,
        vault_account,
        user_address,
        token_address,
        master_account_id,
        status: 'PENDING_PROCESSING',
        collateral_amount_wei
      });

      res.status(201).json({ request, requestId });
    } catch (error) {
      logger.error(`[creditLedgerApi] Error creating withdrawal request:`, error);
      res.status(500).json({ error: { message: 'Failed to create withdrawal request', details: error.message, requestId } });
    }
  });

  // GET /ledger/withdrawals/:txHash - Get a withdrawal request by transaction hash
  router.get('/withdrawals/:txHash', async (req, res) => {
    const { txHash } = req.params;
    const requestId = uuidv4();

    logger.info(`[creditLedgerApi] GET /ledger/withdrawals/${txHash} - RequestId: ${requestId}`);

    try {
      const request = await creditLedgerDb.findWithdrawalRequestByTxHash(txHash);
      if (!request) {
        return res.status(404).json({ error: { message: 'Withdrawal request not found', requestId } });
      }
      res.json({ request, requestId });
    } catch (error) {
      logger.error(`[creditLedgerApi] Error finding withdrawal request:`, error);
      res.status(500).json({ error: { message: 'Failed to find withdrawal request', details: error.message, requestId } });
    }
  });

  // PUT /ledger/withdrawals/:txHash/status - Update a withdrawal request status
  router.put('/withdrawals/:txHash/status', async (req, res) => {
    const { txHash } = req.params;
    const { status, additional_data } = req.body;
    const requestId = uuidv4();

    logger.info(`[creditLedgerApi] PUT /ledger/withdrawals/${txHash}/status - RequestId: ${requestId}`, { body: req.body });

    try {
      const result = await creditLedgerDb.updateWithdrawalRequestStatus(txHash, status, additional_data);
      res.json({ result, requestId });
    } catch (error) {
      logger.error(`[creditLedgerApi] Error updating withdrawal request status:`, error);
      res.status(500).json({ error: { message: 'Failed to update withdrawal request status', details: error.message, requestId } });
    }
  });

  // POST /ledger/vaults - Create a new referral vault
  router.post('/vaults', async (req, res) => {
    const requestId = uuidv4();
    const { vault_address, owner_address, master_account_id, creation_tx_hash, salt } = req.body;

    logger.info(`[creditLedgerApi] POST /ledger/vaults - RequestId: ${requestId}`, { body: req.body });

    try {
      const vault = await creditLedgerDb.createReferralVault({
        vault_address,
        owner_address,
        master_account_id,
        creation_tx_hash,
        salt
      });

      res.status(201).json({ vault, requestId });
    } catch (error) {
      logger.error(`[creditLedgerApi] Error creating referral vault:`, error);
      res.status(500).json({ error: { message: 'Failed to create referral vault', details: error.message, requestId } });
    }
  });

  // GET /ledger/vaults/by-address/:address - Get a vault by its address
  router.get('/vaults/by-address/:address', async (req, res) => {
    const { address } = req.params;
    const requestId = uuidv4();

    logger.info(`[creditLedgerApi] GET /ledger/vaults/by-address/${address} - RequestId: ${requestId}`);

    try {
      const vault = await creditLedgerDb.findReferralVaultByAddress(address);
      if (!vault) {
        return res.status(404).json({ error: { message: 'Vault not found', requestId } });
      }
      res.json({ vault, requestId });
    } catch (error) {
      logger.error(`[creditLedgerApi] Error finding vault:`, error);
      res.status(500).json({ error: { message: 'Failed to find vault', details: error.message, requestId } });
    }
  });

  // GET /ledger/vaults/by-master-account/:masterAccountId - Get all vaults for a master account
  router.get('/vaults/by-master-account/:masterAccountId', async (req, res) => {
    const { masterAccountId } = req.params;
    const requestId = uuidv4();

    logger.info(`[creditLedgerApi] GET /ledger/vaults/by-master-account/${masterAccountId} - RequestId: ${requestId}`);

    try {
      const vaults = await creditLedgerDb.findReferralVaultsByMasterAccount(masterAccountId);
      res.json({ vaults, requestId });
    } catch (error) {
      logger.error(`[creditLedgerApi] Error finding vaults:`, error);
      res.status(500).json({ error: { message: 'Failed to find vaults', details: error.message, requestId } });
    }
  });

  // GET /ledger/points/:masterAccountId - Get total points remaining for a user
  router.get('/points/:masterAccountId', async (req, res) => {
    const { masterAccountId } = req.params;
    try {
      const points = await creditLedgerDb.sumPointsRemainingForUser(masterAccountId);
      res.json({ points });
    } catch (error) {
      logger.error(`[creditLedgerApi] Error getting points for user ${masterAccountId}:`, error);
      res.status(500).json({ error: { message: 'Failed to get points', details: error.message } });
    }
  });

  // GET /ledger/points/by-wallet/:walletAddress - Get total points remaining for a wallet address
  router.get('/points/by-wallet/:walletAddress', async (req, res) => {
    const { walletAddress } = req.params;
    try {
      const points = await creditLedgerDb.sumPointsRemainingForWalletAddress(walletAddress);
      res.json({ points });
    } catch (error) {
      logger.error(`[creditLedgerApi] Error getting points for wallet ${walletAddress}:`, error);
      res.status(500).json({ error: { message: 'Failed to get points', details: error.message } });
    }
  });

  return router;
}

module.exports = createCreditLedgerApi; 