const express = require('express');
const { createLogger } = require('../../../utils/logger');
const { ethers } = require('ethers');

const logger = createLogger('WalletConnectionApi');

/**
 * Creates a router for the wallet connection flow.
 * @param {object} dependencies - Service dependencies, including the walletLinkingService.
 * @returns {express.Router}
 */
function createWalletConnectionApiRouter(dependencies) {
  const router = express.Router();
  const internalApiClient = dependencies.internalApiClient || (dependencies.internal && dependencies.internal.client);

  if (!internalApiClient) {
    logger.error('[WalletConnectionApi] internalApiClient dependency missing.');
    return router;
  }

  /**
   * POST /initiate
   * Starts the wallet linking process.
   */
  router.post('/initiate', async (req, res) => {
    try {
      // Require authentication (dualAuth applied at parent router) to get masterAccountId
      const masterAccountId = req.user?.masterAccountId;
      if (!masterAccountId) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User authentication required.' } });
      }

      const { tokenAddress = '0x0000000000000000000000000000000000000000', expiresInSeconds } = req.body || {};

      // Proxy to internal API
      const response = await internalApiClient.post(`/internal/v1/data/users/${masterAccountId}/wallets/requests/magic-amount`, { tokenAddress, expiresInSeconds });

      const { requestId, magicAmountWei, expiresAt } = response.data;

      res.status(200).json({
        requestId,
        magicAmount: ethers.formatEther(magicAmountWei),
        tokenAddress,
        expiresAt,
        depositToAddress: process.env.CREDIT_VAULT_CONTRACT_ADDRESS,
      });
    } catch (error) {
      logger.error('[WalletConnectionApi] /initiate proxy failed:', error.response?.data || error);
      const status = error.response?.status || 500;
      res.status(status).json({ error: { code: 'INITIATION_FAILED', message: 'Failed to initiate wallet connection process.' } });
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