/**
 * x402 Payment Protocol Services
 *
 * Entry point for all x402-related services.
 *
 * x402 Flow:
 * 1. Client sends request without payment → Server returns 402 + PaymentRequired
 * 2. Client signs payment with wallet (EIP-3009 transferWithAuthorization)
 * 3. Client sends request with X-PAYMENT header
 * 4. Middleware decodes + verifies with facilitator
 * 5. Server executes generation
 * 6. Server calls settle() → Facilitator executes on-chain transfer
 * 7. USDC moves from payer → receiverAddress (Foundation)
 */

const {
  X402ExecutionService,
  createX402ExecutionService,
  USDC_DECIMALS,
  BASE_USDC_ADDRESS,
  BASE_SEPOLIA_USDC_ADDRESS
} = require('./X402ExecutionService');

const {
  X402PricingService,
  PLATFORM_MARKUP,
  MINIMUM_CHARGE_USD
} = require('./X402PricingService');

const {
  X402HistoricalPricingService,
  MARKUP_TIERS,
  CONFIDENCE_THRESHOLDS,
  CACHE_TTL_MS
} = require('./X402HistoricalPricingService');

const {
  createX402Middleware,
  settleX402Payment,
  createPaymentRequired,
  sendPaymentRequired,
  DEFAULT_FACILITATOR_URL
} = require('../../../platforms/web/middleware/x402');

// Note: x402PaymentLogDb is now a class (X402PaymentLogDB) initialized via
// src/core/services/db/index.js and passed through dependencies.db.x402PaymentLog

module.exports = {
  // Execution service
  X402ExecutionService,
  createX402ExecutionService,

  // Pricing services
  X402PricingService,           // Static pricing from cost tables
  X402HistoricalPricingService, // Dynamic pricing from historical data (recommended)
  PLATFORM_MARKUP,
  MINIMUM_CHARGE_USD,
  MARKUP_TIERS,
  CONFIDENCE_THRESHOLDS,
  CACHE_TTL_MS,

  // Middleware
  createX402Middleware,
  settleX402Payment,
  createPaymentRequired,
  sendPaymentRequired,

  // Constants
  USDC_DECIMALS,
  BASE_USDC_ADDRESS,
  BASE_SEPOLIA_USDC_ADDRESS,
  DEFAULT_FACILITATOR_URL,

  // Network identifiers
  NETWORKS: {
    BASE_MAINNET: 'eip155:8453',
    BASE_SEPOLIA: 'eip155:84532'
  }
};
