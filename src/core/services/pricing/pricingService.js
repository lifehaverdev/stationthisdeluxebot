/**
 * Pricing Service
 *
 * Calculates final costs with platform fee recovery and tier discounts.
 * Provides transparent breakdowns for user-facing displays.
 */

const { PRICING_CONFIG } = require('./pricingConfig');

// Station economy: 1 point = $0.000337 (matches GPU baseline)
const USD_PER_POINT = 0.000337;

class PricingService {
  constructor(logger) {
    this.logger = logger || console;
    this.config = PRICING_CONFIG;
  }

  /**
   * Convert USD to points.
   * @param {number} usd - Amount in USD
   * @returns {number} Points (rounded)
   */
  usdToPoints(usd) {
    return Math.round(usd / USD_PER_POINT);
  }

  /**
   * Get the multiplier for a given service and user tier.
   * @param {string} serviceName - e.g., 'comfyui', 'replicate'
   * @param {boolean} isMs2User - Whether user paid with MS2 tokens
   * @param {string} [toolId] - Optional tool ID for per-tool overrides
   * @returns {number} The multiplier to apply to base compute cost
   */
  getMultiplier(serviceName, isMs2User, toolId = null) {
    const serviceConfig = this.config.platformFeeMultipliers[serviceName]
      || this.config.platformFeeMultipliers.default;

    if (!serviceConfig.enabled) {
      return 1.0; // No markup if disabled
    }

    let baseMultiplier = isMs2User ? serviceConfig.ms2 : serviceConfig.standard;

    // Apply per-tool multiplier if configured
    if (toolId) {
      const toolMultipliers = this.config.serviceOverrides[serviceName]?.toolMultipliers || {};
      const toolMultiplier = toolMultipliers[toolId] || 1.0;
      baseMultiplier *= toolMultiplier;
    }

    return baseMultiplier;
  }

  /**
   * Calculate the final cost with platform fee recovery.
   * @param {Object} params
   * @param {number} params.computeCostUsd - Base compute cost in USD
   * @param {string} params.serviceName - Service name (e.g., 'comfyui')
   * @param {boolean} params.isMs2User - Whether user is MS2 tier
   * @param {string} [params.toolId] - Optional tool ID for overrides
   * @returns {Object} { finalCostUsd, breakdown }
   */
  calculateCost({ computeCostUsd, serviceName, isMs2User, toolId = null }) {
    const multiplier = this.getMultiplier(serviceName, isMs2User, toolId);
    const platformFeeUsd = computeCostUsd * (multiplier - 1);
    let finalCostUsd = computeCostUsd * multiplier;

    // Apply minimum charge
    if (finalCostUsd < this.config.minimums.minimumChargeUsd) {
      finalCostUsd = this.config.minimums.minimumChargeUsd;
    }

    const breakdown = {
      computeCostUsd: Number(computeCostUsd.toFixed(6)),
      platformFeeUsd: Number(platformFeeUsd.toFixed(6)),
      finalCostUsd: Number(finalCostUsd.toFixed(6)),
      totalPoints: this.usdToPoints(finalCostUsd),
      multiplier: multiplier,
      multiplierApplied: multiplier, // deprecated: use multiplier
      tier: isMs2User ? 'ms2' : 'standard',
      serviceName,
      toolId,
    };

    this.logger.debug('[PricingService] Cost calculated:', breakdown);

    return {
      finalCostUsd,
      breakdown,
    };
  }

  /**
   * Get a user-facing price quote with transparency info.
   * @param {Object} params - Same as calculateCost
   * @returns {Object} Quote with breakdown and explanations
   */
  getQuote({ computeCostUsd, serviceName, isMs2User, toolId = null }) {
    const { finalCostUsd, breakdown } = this.calculateCost({
      computeCostUsd,
      serviceName,
      isMs2User,
      toolId,
    });

    const serviceConfig = this.config.platformFeeMultipliers[serviceName]
      || this.config.platformFeeMultipliers.default;

    // Calculate what the other tier would pay (for comparison)
    const otherTierMultiplier = this.getMultiplier(serviceName, !isMs2User, toolId);
    const otherTierCost = computeCostUsd * otherTierMultiplier;

    const quote = {
      ...breakdown,
      // Savings info for MS2 users
      ...(isMs2User && {
        savingsUsd: Number((otherTierCost - finalCostUsd).toFixed(6)),
        savingsPercent: Number((((otherTierCost - finalCostUsd) / otherTierCost) * 100).toFixed(1)),
      }),
      // What they'd pay if they switched tiers
      alternativeTier: {
        tier: isMs2User ? 'standard' : 'ms2',
        costUsd: Number(otherTierCost.toFixed(6)),
      },
      // Transparency explanations
      explanations: {
        compute: this.config.transparency.computeCostExplanation,
        platformFee: serviceConfig.enabled ? this.config.transparency.platformFeeExplanation : null,
        ms2Discount: isMs2User ? this.config.transparency.ms2DiscountExplanation : null,
      },
    };

    return quote;
  }

  /**
   * Get the current pricing config for transparency/display.
   * Safe to expose to users.
   */
  getPublicPricingInfo() {
    return {
      version: this.config.version,
      lastUpdated: this.config.lastUpdated,
      services: Object.entries(this.config.platformFeeMultipliers)
        .filter(([_, config]) => config.enabled)
        .map(([name, config]) => ({
          name,
          description: config.description,
          standardMultiplier: config.standard,
          ms2Multiplier: config.ms2,
          ms2DiscountPercent: Math.round((1 - config.ms2 / config.standard) * 100),
        })),
      ms2Benefits: {
        tokenAddress: this.config.ms2Benefits.tokenAddress,
        discountPercent: this.config.ms2Benefits.discountPercent,
        minimumDepositUsd: this.config.ms2Benefits.minimumDepositUsd,
      },
      transparency: this.config.transparency,
    };
  }

  /**
   * Check if a deposit entry qualifies for MS2 pricing.
   * @param {Object} depositEntry - Credit ledger entry
   * @returns {boolean}
   */
  isMs2Deposit(depositEntry) {
    if (!depositEntry?.token_address) return false;

    const tokenAddress = depositEntry.token_address.toLowerCase();
    const ms2Address = this.config.ms2Benefits.tokenAddress.toLowerCase();

    return tokenAddress === ms2Address;
  }

  /**
   * Determine if a user's active deposits qualify them for MS2 pricing.
   * Uses FIFO - if their first (lowest funding_rate) deposit is MS2, they get MS2 pricing.
   * @param {Array} activeDeposits - Sorted array of active deposit entries (FIFO order)
   * @returns {boolean}
   */
  userQualifiesForMs2Pricing(activeDeposits) {
    if (!activeDeposits || activeDeposits.length === 0) return false;

    // Check if any deposit being consumed is MS2
    // Since we use FIFO, we could check just the first, but let's be generous
    // and give MS2 pricing if ANY of their deposits are MS2
    return activeDeposits.some(deposit => this.isMs2Deposit(deposit));
  }
}

// Singleton instance
let instance = null;

function getPricingService(logger) {
  if (!instance) {
    instance = new PricingService(logger);
  }
  return instance;
}

module.exports = {
  PricingService,
  getPricingService,
};
