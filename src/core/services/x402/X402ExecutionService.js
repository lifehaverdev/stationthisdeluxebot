/**
 * X402 Execution Service
 *
 * Orchestrates x402 payment flow for tool execution:
 * 1. Validate payment covers cost
 * 2. Check replay protection
 * 3. Record payment as verified
 * 4. (Caller executes generation)
 * 5. Settle payment on-chain
 * 6. Update record with tx hash
 *
 * Key principle: Payment IS the auth. No account creation for one-offs.
 */

const crypto = require('crypto');
const { settleX402Payment } = require('../../../platforms/web/middleware/x402');
const { createLogger } = require('../../../utils/logger');

// USDC has 6 decimals
const USDC_DECIMALS = 6;

// Base mainnet USDC address
const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Base Sepolia USDC address (testnet)
const BASE_SEPOLIA_USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

/**
 * @typedef {Object} X402ValidationResult
 * @property {boolean} valid
 * @property {string} [error]
 * @property {string} [errorCode]
 * @property {number} [requiredUsd]
 * @property {number} [providedUsd]
 */

class X402ExecutionService {
  /**
   * @param {Object} services
   * @param {Object} services.x402PaymentLogDb - X402PaymentLogDB instance (required)
   */
  constructor(services) {
    if (!services?.x402PaymentLogDb) {
      throw new Error('X402ExecutionService requires x402PaymentLogDb');
    }
    this.x402PaymentLogDb = services.x402PaymentLogDb;
    this.logger = createLogger('X402ExecutionService');
  }

  /**
   * Hash the payment signature for use as unique key
   *
   * @param {Object} paymentPayload
   * @returns {string}
   */
  hashPaymentSignature(paymentPayload) {
    // The payload contains the signature in payload.payload.signature
    const signatureData = JSON.stringify({
      signature: paymentPayload.payload?.signature,
      authorization: paymentPayload.payload?.authorization
    });
    return crypto.createHash('sha256').update(signatureData).digest('hex');
  }

  /**
   * Convert USD amount to USDC atomic units (6 decimals)
   *
   * @param {number} usdAmount - Amount in USD (e.g., 0.05)
   * @returns {string} Amount in atomic units as string
   */
  usdToUsdcAtomic(usdAmount) {
    const atomic = Math.ceil(usdAmount * Math.pow(10, USDC_DECIMALS));
    return atomic.toString();
  }

  /**
   * Convert USDC atomic units to USD
   *
   * @param {string} atomicAmount - Amount in atomic units
   * @returns {number} Amount in USD
   */
  usdcAtomicToUsd(atomicAmount) {
    return Number(BigInt(atomicAmount)) / Math.pow(10, USDC_DECIMALS);
  }

  /**
   * Get USDC address for a network
   *
   * @param {string} network - CAIP-2 network ID
   * @returns {string} USDC contract address
   */
  getUsdcAddress(network) {
    switch (network) {
      case 'eip155:8453':
        return BASE_USDC_ADDRESS;
      case 'eip155:84532':
        return BASE_SEPOLIA_USDC_ADDRESS;
      default:
        throw new Error(`Unsupported network for USDC: ${network}`);
    }
  }

  /**
   * Validate x402 payment for execution
   *
   * Checks:
   * 1. Payment is verified
   * 2. Payment amount >= required cost
   * 3. Payment hasn't been used before (replay protection)
   *
   * @param {Object} x402Info - req.x402 from middleware
   * @param {number} requiredCostUsd - Required cost in USD
   * @returns {Promise<X402ValidationResult>}
   */
  async validatePaymentForExecution(x402Info, requiredCostUsd) {
    // 1. Check payment was verified by middleware
    if (!x402Info || !x402Info.verified) {
      return {
        valid: false,
        error: x402Info?.error || 'Payment not verified',
        errorCode: 'PAYMENT_NOT_VERIFIED'
      };
    }

    // 2. Check amount covers cost
    const paidUsd = this.usdcAtomicToUsd(x402Info.amount);
    if (paidUsd < requiredCostUsd) {
      return {
        valid: false,
        error: 'Insufficient payment amount',
        errorCode: 'INSUFFICIENT_PAYMENT',
        requiredUsd: requiredCostUsd,
        providedUsd: paidUsd
      };
    }

    // 3. Check replay protection
    const signatureHash = this.hashPaymentSignature(x402Info.payload);
    const alreadyUsed = await this.x402PaymentLogDb.isSignatureUsed(signatureHash);
    if (alreadyUsed) {
      return {
        valid: false,
        error: 'Payment signature already used',
        errorCode: 'PAYMENT_ALREADY_USED'
      };
    }

    return {
      valid: true,
      signatureHash,
      paidUsd,
      requiredUsd: requiredCostUsd
    };
  }

  /**
   * Record payment as verified (before execution)
   *
   * @param {Object} x402Info - req.x402 from middleware
   * @param {Object} executionDetails
   * @param {string} executionDetails.toolId
   * @param {string} [executionDetails.generationId]
   * @param {string} [executionDetails.spellId]
   * @param {number} executionDetails.costUsd
   * @returns {Promise<{signatureHash: string}>}
   */
  async recordPaymentVerified(x402Info, executionDetails) {
    const signatureHash = this.hashPaymentSignature(x402Info.payload);
    const paidUsd = this.usdcAtomicToUsd(x402Info.amount);

    await this.x402PaymentLogDb.recordVerified({
      signatureHash,
      payer: x402Info.payer,
      amount: x402Info.amount,
      asset: x402Info.asset,
      network: x402Info.network,
      payTo: x402Info.requirements.payTo,
      toolId: executionDetails.toolId,
      generationId: executionDetails.generationId,
      spellId: executionDetails.spellId,
      costUsd: executionDetails.costUsd,
      paidUsd
    });

    this.logger.info('[x402] Payment recorded as verified', {
      signatureHash: signatureHash.slice(0, 16) + '...',
      payer: x402Info.payer,
      toolId: executionDetails.toolId,
      costUsd: executionDetails.costUsd,
      paidUsd
    });

    return { signatureHash };
  }

  /**
   * Settle payment after successful execution
   *
   * Calls the facilitator to execute on-chain transfer.
   * Updates the payment record with transaction hash.
   *
   * @param {Object} x402Info - req.x402 from middleware
   * @param {string} signatureHash - Hash from recordPaymentVerified
   * @returns {Promise<{success: boolean, transaction?: string, error?: string}>}
   */
  async settlePayment(x402Info, signatureHash) {
    const settleResult = await settleX402Payment(x402Info);

    if (settleResult.success) {
      await this.x402PaymentLogDb.recordSettled(signatureHash, settleResult.transaction);

      this.logger.info('[x402] Payment settled successfully', {
        signatureHash: signatureHash.slice(0, 16) + '...',
        transaction: settleResult.transaction,
        payer: settleResult.payer
      });
    } else {
      await this.x402PaymentLogDb.recordFailed(signatureHash, settleResult.error);

      this.logger.error('[x402] Payment settlement failed', {
        signatureHash: signatureHash.slice(0, 16) + '...',
        error: settleResult.error
      });
    }

    return settleResult;
  }

  /**
   * Full execution flow for x402 payment
   *
   * Usage:
   * ```
   * const validation = await x402Service.validatePaymentForExecution(req.x402, costUsd);
   * if (!validation.valid) {
   *   return res.status(402).json({ error: validation.errorCode, ... });
   * }
   *
   * const { signatureHash } = await x402Service.recordPaymentVerified(req.x402, { toolId, costUsd });
   *
   * // Execute generation...
   * const result = await executeGeneration(...);
   *
   * // Settle payment (USDC moves on-chain)
   * const settlement = await x402Service.settlePayment(req.x402, signatureHash);
   *
   * return res.json({ ...result, x402: { settled: settlement.success, tx: settlement.transaction }});
   * ```
   *
   * If execution fails, don't call settlePayment() - user keeps their USDC.
   */
}

// Export singleton-ready factory
function createX402ExecutionService(services) {
  return new X402ExecutionService(services);
}

module.exports = {
  X402ExecutionService,
  createX402ExecutionService,
  USDC_DECIMALS,
  BASE_USDC_ADDRESS,
  BASE_SEPOLIA_USDC_ADDRESS
};
