/**
 * x402 Payment Middleware
 *
 * Custom middleware for x402 payment protocol integration.
 * Uses @x402/core primitives for maximum control.
 *
 * Flow:
 * 1. Check for X-PAYMENT header
 * 2. If present: decode, verify with facilitator, attach to req.x402
 * 3. If not present: continue (other auth methods will handle)
 *
 * Settlement happens AFTER successful execution, not in middleware.
 */

const { HTTPFacilitatorClient } = require('@x402/core/server');
const { decodePaymentSignatureHeader } = require('@x402/core/http');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('x402Middleware');

// Default facilitator (Coinbase CDP - supports Base mainnet, fee-free USDC settlement)
const DEFAULT_FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';

/**
 * @typedef {Object} X402Config
 * @property {string} receiverAddress - Address to receive USDC payments (Foundation on Base)
 * @property {string} network - CAIP-2 network ID (e.g., 'eip155:8453' for Base)
 * @property {string} [facilitatorUrl] - Facilitator URL (defaults to x402.org)
 */

/**
 * @typedef {Object} X402PaymentInfo
 * @property {boolean} verified - Whether payment was verified successfully
 * @property {string} payer - Wallet address that signed the payment
 * @property {string} amount - Amount in atomic units (wei)
 * @property {string} asset - Token contract address (USDC)
 * @property {string} network - Network the payment is on
 * @property {Object} payload - Full decoded payment payload
 * @property {Object} requirements - Payment requirements that were satisfied
 * @property {string} [error] - Error message if verification failed
 */

/**
 * Creates x402 payment middleware
 *
 * @param {X402Config} config - Middleware configuration
 * @returns {Function} Express middleware
 */
function createX402Middleware(config) {
  const {
    receiverAddress,
    network,
    facilitatorUrl = DEFAULT_FACILITATOR_URL
  } = config;

  if (!receiverAddress) {
    throw new Error('x402 middleware requires receiverAddress');
  }
  if (!network) {
    throw new Error('x402 middleware requires network');
  }

  // Create facilitator client (talks to x402.org)
  const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });

  logger.info(`[x402] Middleware initialized`, {
    receiverAddress,
    network,
    facilitatorUrl
  });

  return async function x402PaymentMiddleware(req, res, next) {
    // Skip if x402 is disabled
    if (process.env.X402_ENABLED !== 'true') {
      req.x402 = null;
      return next();
    }

    // Check for payment header (v2 uses X-PAYMENT, v1 uses X-PAYMENT-SIGNATURE)
    const paymentHeader = req.headers['x-payment'] || req.headers['x-payment-signature'];

    if (!paymentHeader) {
      // No x402 payment - continue to other auth methods
      req.x402 = null;
      return next();
    }

    try {
      // Decode the payment payload from base64
      const paymentPayload = decodePaymentSignatureHeader(paymentHeader);

      logger.debug('[x402] Payment header decoded', {
        x402Version: paymentPayload.x402Version,
        network: paymentPayload.accepted?.network,
        scheme: paymentPayload.accepted?.scheme
      });

      // Build the requirements we expect this payment to satisfy
      const paymentRequirements = {
        scheme: paymentPayload.accepted.scheme,
        network: paymentPayload.accepted.network,
        asset: paymentPayload.accepted.asset,
        amount: paymentPayload.accepted.amount,
        payTo: receiverAddress,
        maxTimeoutSeconds: paymentPayload.accepted.maxTimeoutSeconds || 300,
        extra: paymentPayload.accepted.extra || {}
      };

      // Debug: Log what we're sending to the facilitator
      console.log('[x402] Verifying with facilitator:');
      console.log('paymentPayload:', JSON.stringify(paymentPayload, null, 2));
      console.log('paymentRequirements:', JSON.stringify(paymentRequirements, null, 2));

      // Verify payment with facilitator
      const verifyResult = await facilitatorClient.verify(paymentPayload, paymentRequirements);

      if (!verifyResult.isValid) {
        logger.warn('[x402] Payment verification failed', {
          reason: verifyResult.invalidReason,
          payer: verifyResult.payer
        });

        req.x402 = {
          verified: false,
          error: verifyResult.invalidReason,
          payer: verifyResult.payer,
          payload: paymentPayload,
          requirements: paymentRequirements
        };

        return next();
      }

      // Payment verified - attach to request
      req.x402 = {
        verified: true,
        payer: verifyResult.payer,
        amount: paymentRequirements.amount,
        asset: paymentRequirements.asset,
        network: paymentRequirements.network,
        payload: paymentPayload,
        requirements: paymentRequirements,
        // Include facilitator client for settlement after execution
        _facilitatorClient: facilitatorClient
      };

      logger.info('[x402] Payment verified', {
        payer: verifyResult.payer,
        amount: paymentRequirements.amount,
        network: paymentRequirements.network
      });

      next();

    } catch (error) {
      // Log full error details for debugging
      logger.error('[x402] Middleware error', { error: error.message, stack: error.stack });
      if (error.response) {
        console.log('[x402] Facilitator response:', JSON.stringify(error.response, null, 2));
      }
      if (error.status) {
        console.log('[x402] Facilitator HTTP status:', error.status);
      }

      req.x402 = {
        verified: false,
        error: error.message
      };

      next();
    }
  };
}

/**
 * Settle an x402 payment after successful execution
 *
 * Call this AFTER the generation succeeds to actually transfer USDC.
 * The facilitator pays gas, USDC goes from payer → receiverAddress.
 *
 * @param {Object} x402Info - The req.x402 object from middleware
 * @returns {Promise<{success: boolean, transaction?: string, error?: string}>}
 */
async function settleX402Payment(x402Info) {
  if (!x402Info || !x402Info.verified) {
    return { success: false, error: 'No verified payment to settle' };
  }

  const facilitatorClient = x402Info._facilitatorClient;
  if (!facilitatorClient) {
    return { success: false, error: 'Facilitator client not available' };
  }

  try {
    const settleResult = await facilitatorClient.settle(
      x402Info.payload,
      x402Info.requirements
    );

    if (!settleResult.success) {
      logger.error('[x402] Settlement failed', {
        reason: settleResult.errorReason,
        payer: settleResult.payer
      });
      return {
        success: false,
        error: settleResult.errorReason,
        payer: settleResult.payer
      };
    }

    logger.info('[x402] Payment settled', {
      transaction: settleResult.transaction,
      network: settleResult.network,
      payer: settleResult.payer
    });

    return {
      success: true,
      transaction: settleResult.transaction,
      network: settleResult.network,
      payer: settleResult.payer
    };

  } catch (error) {
    logger.error('[x402] Settlement error', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Generate PaymentRequired response for 402 status
 *
 * @param {Object} options
 * @param {string} options.receiverAddress - Address to receive payment
 * @param {string} options.network - CAIP-2 network ID
 * @param {string} options.amount - Amount in atomic units
 * @param {string} options.asset - Token address (USDC)
 * @param {string} options.description - Human-readable description
 * @param {string} options.resourceUrl - URL of the resource being accessed
 * @returns {Object} PaymentRequired object for 402 response
 */
function createPaymentRequired(options) {
  const {
    receiverAddress,
    network,
    amount,
    asset,
    description,
    resourceUrl
  } = options;

  return {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description: description,
      mimeType: 'application/json'
    },
    accepts: [{
      scheme: 'exact',
      network: network,
      asset: asset,
      amount: amount,
      payTo: receiverAddress,
      maxTimeoutSeconds: 300,
      extra: {}
    }]
  };
}

/**
 * Send 402 Payment Required response
 *
 * @param {Response} res - Express response
 * @param {Object} paymentRequired - PaymentRequired object
 */
function sendPaymentRequired(res, paymentRequired) {
  const { encodePaymentRequiredHeader } = require('@x402/core/http');

  const headerValue = encodePaymentRequiredHeader(paymentRequired);

  res.status(402)
    .set('X-PAYMENT-REQUIRED', headerValue)
    .json({
      error: 'PAYMENT_REQUIRED',
      message: 'This endpoint requires payment via x402 protocol',
      paymentRequired
    });
}

module.exports = {
  createX402Middleware,
  settleX402Payment,
  createPaymentRequired,
  sendPaymentRequired,
  DEFAULT_FACILITATOR_URL
};
