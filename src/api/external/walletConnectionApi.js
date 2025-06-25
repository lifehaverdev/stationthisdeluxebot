const express = require('express');
const { createLogger } = require('../../utils/logger');
const { ethers } = require('ethers');

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
    logger.error('[WalletConnectionApi] Critical: WalletLinkingService not provided.');
    router.use((req, res) => res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The wallet connection service is currently unavailable.' }}));
    return router;
  }

  /**
   * POST /initiate
   * Starts the wallet linking process.
   */
  router.post('/initiate', async (req, res) => {
    try {
      const { requestId, magicAmountWei, tokenAddress, expiresAt } = await walletLinkingService.initiateLinking();
      
      res.status(200).json({
        requestId,
        magicAmount: ethers.formatEther(magicAmountWei), // Convert to ETH for user-friendliness
        tokenAddress,
        expiresAt,
        depositToAddress: process.env.CREDIT_VAULT_CONTRACT_ADDRESS,
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

  return router;
}

module.exports = { createWalletConnectionApiRouter }; 