/**
 * Payments API
 * 
 * Public API endpoints for on-chain spell payment transactions.
 * Handles transaction generation and payment status checking.
 */

const express = require('express');
const { createLogger } = require('../../../utils/logger');
const { ethers } = require('ethers');

/**
 * Create payments API router
 * @param {Object} dependencies
 * @returns {express.Router}
 */
function createPaymentsApi(dependencies) {
  const router = express.Router();
  const { spellPaymentService, logger } = dependencies;

  if (!spellPaymentService) {
    logger.warn('[PaymentsAPI] SpellPaymentService not available');
    return router; // Return empty router if service not available
  }

  // Generate payment transaction (PUBLIC)
  router.post('/generate-transaction', async (req, res) => {
    try {
      const { amountPts, spellId, slug, walletAddress, preferredToken } = req.body;
      
      // Validate required fields
      const missingFields = [];
      if (!amountPts && amountPts !== 0) missingFields.push('amountPts');
      if (!spellId) missingFields.push('spellId');
      if (!slug) missingFields.push('slug');
      if (!walletAddress) missingFields.push('walletAddress');
      
      if (missingFields.length > 0) {
        return res.status(400).json({
          error: { 
            code: 'BAD_REQUEST', 
            message: `Missing required fields: ${missingFields.join(', ')}` 
          }
        });
      }

      // Validate wallet address format
      if (typeof walletAddress !== 'string' || !ethers.isAddress(walletAddress)) {
        return res.status(400).json({
          error: { 
            code: 'INVALID_WALLET_ADDRESS', 
            message: 'Invalid wallet address format. Expected a valid Ethereum address.' 
          }
        });
      }

      // Validate amount
      if (typeof amountPts !== 'number' || isNaN(amountPts) || amountPts <= 0) {
        return res.status(400).json({
          error: { 
            code: 'INVALID_AMOUNT', 
            message: 'amountPts must be a positive number' 
          }
        });
      }

      // Validate amount is reasonable (prevent extremely large values)
      if (amountPts > 1000000) {
        return res.status(400).json({
          error: { 
            code: 'AMOUNT_TOO_LARGE', 
            message: 'Payment amount exceeds maximum allowed' 
          }
        });
      }

      // Validate spellId format (should be MongoDB ObjectId or valid string)
      if (typeof spellId !== 'string' || spellId.length > 100) {
        return res.status(400).json({
          error: { 
            code: 'INVALID_SPELL_ID', 
            message: 'Invalid spell ID format' 
          }
        });
      }

      const result = await spellPaymentService.generatePaymentTransaction({
        amountPts,
        spellId,
        slug,
        walletAddress,
        preferredToken: preferredToken || 'ETH'
      });

      res.status(200).json(result);
    } catch (error) {
      logger.error('[PaymentsAPI] Failed to generate payment transaction:', error);
      
      // Provide more specific error messages
      let errorCode = 'INTERNAL_ERROR';
      let errorMessage = 'Failed to generate transaction';
      
      if (error.message.includes('price') || error.message.includes('PriceFeed')) {
        errorCode = 'PRICE_FEED_ERROR';
        errorMessage = 'Failed to fetch token price. Please try again.';
      } else if (error.message.includes('gas') || error.message.includes('estimate')) {
        errorCode = 'GAS_ESTIMATION_ERROR';
        errorMessage = 'Failed to estimate gas. Please check your wallet balance and try again.';
      } else if (error.message.includes('network') || error.message.includes('RPC')) {
        errorCode = 'NETWORK_ERROR';
        errorMessage = 'Blockchain network error. Please try again later.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      res.status(500).json({
        error: { 
          code: errorCode, 
          message: errorMessage,
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      });
    }
  });

  // Track transaction sent (PUBLIC)
  router.post('/tx-sent', async (req, res) => {
    try {
      const { spellPaymentId, txHash } = req.body;
      
      if (!spellPaymentId || !txHash) {
        return res.status(400).json({
          error: { 
            code: 'BAD_REQUEST', 
            message: 'Missing required fields: spellPaymentId, txHash' 
          }
        });
      }

      // Validate txHash format (should be 0x followed by 64 hex characters)
      if (typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return res.status(400).json({
          error: { 
            code: 'INVALID_TX_HASH', 
            message: 'Invalid transaction hash format' 
          }
        });
      }

      // Validate spellPaymentId format (should be UUID)
      if (typeof spellPaymentId !== 'string' || spellPaymentId.length > 100) {
        return res.status(400).json({
          error: { 
            code: 'INVALID_PAYMENT_ID', 
            message: 'Invalid payment ID format' 
          }
        });
      }

      await spellPaymentService.trackTransactionSent(spellPaymentId, txHash);
      
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[PaymentsAPI] Failed to track transaction:', error);
      res.status(500).json({
        error: { 
          code: 'INTERNAL_ERROR', 
          message: 'Failed to track transaction',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  });

  // Check payment status (PUBLIC)
  router.get('/status/:spellPaymentId', async (req, res) => {
    try {
      const { spellPaymentId } = req.params;
      
      if (!spellPaymentId || typeof spellPaymentId !== 'string') {
        return res.status(400).json({
          error: { 
            code: 'BAD_REQUEST', 
            message: 'spellPaymentId is required and must be a string' 
          }
        });
      }

      // Validate spellPaymentId format
      if (spellPaymentId.length > 100) {
        return res.status(400).json({
          error: { 
            code: 'INVALID_PAYMENT_ID', 
            message: 'Invalid payment ID format' 
          }
        });
      }

      const status = await spellPaymentService.checkPaymentStatus(spellPaymentId);
      
      // Ensure status object has required fields
      if (!status || typeof status !== 'object') {
        return res.status(500).json({
          error: { 
            code: 'INVALID_STATUS', 
            message: 'Invalid status response from payment service' 
          }
        });
      }
      
      res.status(200).json(status);
    } catch (error) {
      logger.error('[PaymentsAPI] Failed to check payment status:', error);
      
      let errorCode = 'INTERNAL_ERROR';
      let errorMessage = 'Failed to check payment status';
      
      if (error.message.includes('not found')) {
        errorCode = 'PAYMENT_NOT_FOUND';
        errorMessage = 'Payment not found';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      res.status(500).json({
        error: { 
          code: errorCode, 
          message: errorMessage,
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      });
    }
  });

  return router;
}

module.exports = createPaymentsApi;

