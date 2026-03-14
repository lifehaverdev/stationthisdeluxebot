const express = require('express');
const { createLogger } = require('../../../utils/logger');
const { ethers } = require('ethers');
const { getCreditVaultAddress } = require('../../../core/services/alchemy/foundationConfig');

const logger = createLogger('WalletConnectionApi');

/**
 * Creates a router for the wallet connection flow.
 * @param {object} dependencies - Service dependencies, including the walletLinkingService.
 * @returns {express.Router}
 */
function createWalletConnectionApiRouter(dependencies) {
  const router = express.Router();
  const { walletLinkingService } = dependencies;

  if (!walletLinkingService) {
    logger.error('[WalletConnectionApi] walletLinkingService dependency missing.');
    return router;
  }

  /**
   * POST /initiate
   * Starts the wallet linking process. No authentication required — creates a provisional user.
   */
  router.post('/initiate', async (req, res) => {
    try {
      const { requestId, magicAmountWei, tokenAddress, expiresAt } = await walletLinkingService.initiateLinking();

      res.status(200).json({
        requestId,
        magicAmountWei,
        magicAmount: ethers.formatEther(magicAmountWei),
        tokenAddress,
        expiresAt,
        depositToAddress: getCreditVaultAddress('1'),
      });
    } catch (error) {
      logger.error('[WalletConnectionApi] /initiate failed:', error);
      res.status(500).json({ error: { code: 'INITIATION_FAILED', message: 'Failed to initiate wallet connection process.' } });
    }
  });

  /**
   * GET /status/:requestId
   * Checks the status of a linking request and claims the API key if ready.
   */
  router.get('/status/:requestId', async (req, res) => {
    const { requestId } = req.params;
    if (!requestId) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Request ID is missing.' } });
    }

    try {
      const result = await walletLinkingService.getLinkingStatusAndClaimKey(requestId);
      
      if (result.status === 'COMPLETED') {
        res.status(200).json({
          status: result.status,
          apiKey: result.apiKey,
          message: 'Wallet connected successfully. This is your API key. Store it securely, it will not be shown again.'
        });
      } else if (result.status === 'ALREADY_CLAIMED') {
        res.status(410).json({ // 410 Gone is appropriate here
            status: result.status,
            message: 'This API key has already been claimed.'
        });
      } else {
        res.status(202).json({ // 202 Accepted is good for PENDING
          status: result.status,
        });
      }
    } catch (error) {
      logger.error(`[WalletConnectionApi] /status/${requestId} failed:`, error);
      res.status(500).json({ error: { code: 'STATUS_CHECK_FAILED', message: 'Failed to check status of the wallet connection process.' } });
    }
  });

  /**
   * POST /relink
   * Generates a new magic amount request for an existing user, identified by wallet address.
   * Used when a user already has an account but needs a fresh API key (e.g., key was lost or broken).
   * No auth required — identity is proven by the magic amount deposit from the claimed wallet.
   */
  router.post('/relink', async (req, res) => {
    const rawAddress = req.body.walletAddress || req.body.address;
    if (!rawAddress) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'A valid walletAddress is required.', received: req.body } });
    }
    let walletAddress;
    try {
      walletAddress = ethers.getAddress(rawAddress); // normalizes to EIP-55 checksum
    } catch {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid Ethereum address.', received: rawAddress } });
    }

    try {
      const { requestId, magicAmountWei, tokenAddress, expiresAt } = await walletLinkingService.initiateRelink(walletAddress);

      res.status(200).json({
        requestId,
        magicAmountWei,
        magicAmount: ethers.formatEther(magicAmountWei),
        tokenAddress,
        expiresAt,
        depositToAddress: getCreditVaultAddress('1'),
        message: 'Send the exact magic amount from your wallet to receive a new API key.',
      });
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
      }
      logger.error('[WalletConnectionApi] /relink failed:', error);
      res.status(500).json({ error: { code: 'RELINK_FAILED', message: 'Failed to initiate re-link process.' } });
    }
  });

  return router;
}

module.exports = { createWalletConnectionApiRouter }; 