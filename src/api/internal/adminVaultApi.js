const express = require('express');
const { ethers } = require('ethers');

/**
 * Creates the Admin Vault API router.
 * @param {object} deps - dependencies injected from internalApiIndex
 * @param {object} deps.logger
 * @param {EthereumService|object} deps.ethereumService - Multi-chain aware service with read/write helpers
 * @param {CreditLedgerDB} deps.creditLedgerDb - DB for withdrawals table
 * @param {Function} deps.vaultBalanceService - function (vaultAddress)=>Promise<[{tokenAddress,balanceWei,decimals,symbol}]>
 */
function createAdminVaultApi(deps) {
  const router = express.Router();
  const logger = deps.logger || console;
  const ethereumService = deps.ethereumService;
  const vaultBalanceService = deps.vaultBalanceService;
  const creditLedgerDb = deps.creditLedgerDb;

  // Constants for NFT gating
  const MILADY_STATION_ADDRESS = process.env.MILADY_STATION_ADDRESS || '0xYourMiladyStationAddressHere';
  const ADMIN_TOKEN_ID = 598;
  const ERC721A_ABI = [
    'function ownerOf(uint256 tokenId) view returns (address)'
  ];

  /**
   * Middleware: Verify request signed by admin NFT owner.
   * Expects headers:
   *  - x-address: signer address
   *  - x-signature: signature hex
   *  - x-message: original message
   */
  async function verifyAdmin(req, res, next) {
    try {
      const signerAddress = req.header('x-address');
      const signature = req.header('x-signature');
      const message = req.header('x-message');
      if (!signerAddress || !signature || !message) {
        return res.status(401).json({ error: { message: 'Missing auth headers' } });
      }
      // recover signer
      const recovered = ethers.verifyMessage(message, signature);
      if (recovered.toLowerCase() !== signerAddress.toLowerCase()) {
        return res.status(401).json({ error: { message: 'Invalid signature' } });
      }
      // Check NFT ownership on-chain
      const owner = await ethereumService.read(
        MILADY_STATION_ADDRESS,
        ERC721A_ABI,
        'ownerOf',
        ADMIN_TOKEN_ID
      );
      if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
        return res.status(403).json({ error: { message: 'Not admin owner' } });
      }
      next();
    } catch (err) {
      logger.error('[AdminVaultApi] verifyAdmin error', err);
      res.status(500).json({ error: { message: 'Internal auth error' } });
    }
  }

  // GET /admin/vaults/balances
  router.get('/vaults/balances', verifyAdmin, async (req, res) => {
    try {
      // Master vault + chartered vaults from DB if available
      const vaults = [];
      const masterAddress = process.env.CREDIT_VAULT_ADDRESS;
      if (masterAddress) {
        const tokens = await vaultBalanceService(masterAddress);
        vaults.push({ vaultAddress: masterAddress, vaultName: 'Master', tokens });
      }
      // chartered vaults list via DB
      if (deps.db?.data?.referralVaults) {
        const list = await deps.db.data.referralVaults.findAll();
        for (const v of list) {
          const tokens = await vaultBalanceService(v.vault_address);
          vaults.push({ vaultAddress: v.vault_address, vaultName: v.vault_name, tokens });
        }
      }
      res.json({ vaults });
    } catch (err) {
      logger.error('[AdminVaultApi] balances error', err);
      res.status(500).json({ error: { message: 'Failed to fetch balances' } });
    }
  });

  // POST /admin/withdrawals
  router.post('/withdrawals', verifyAdmin, async (req, res) => {
    try {
      const { vault_address, token_address, amount_wei } = req.body;
      if (!vault_address || !token_address || !amount_wei) {
        return res.status(400).json({ error: { message: 'Missing params' } });
      }
      const withdrawal = await creditLedgerDb.createWithdrawalRequest({
        vault_account: vault_address,
        token_address,
        collateral_amount_wei: amount_wei,
        status: 'ADMIN_QUEUED'
      });
      res.status(201).json({ withdrawal });
    } catch (err) {
      logger.error('[AdminVaultApi] withdrawal error', err);
      res.status(500).json({ error: { message: 'Failed to queue withdrawal' } });
    }
  });

  return router;
}

module.exports = createAdminVaultApi;
