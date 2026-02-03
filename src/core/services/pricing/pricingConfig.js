/**
 * Pricing Configuration Module
 *
 * Centralized pricing levers for service cost calculations.
 * All rates and multipliers are defined here for easy adjustment.
 *
 * TRANSPARENCY: This config is exposed via API so users can see current rates.
 */

const PRICING_CONFIG = {
  // Version for tracking config changes
  version: '1.0.0',
  lastUpdated: '2026-02-03',

  // ==========================================================================
  // PLATFORM FEE RECOVERY
  // ==========================================================================
  // These fees help cover fixed platform costs (e.g., $100/month ComfyUI Deploy)
  // Expressed as multipliers on top of base compute cost

  platformFeeMultipliers: {
    // ComfyUI Deploy: $100/month platform fee
    // With ~1200 gens/month at $0.02 avg = $24 compute
    // Need 4x markup on standard, 2x on MS2 to recover ~$75-100
    comfyui: {
      description: 'ComfyUI Deploy platform fee recovery',
      standard: 4.0,    // 4x compute cost for standard users
      ms2: 2.0,         // 2x compute cost for MS2 token holders (50% discount)
      enabled: true,
    },

    // Other services can be added here
    // Example: replicate, fal, runpod, modal
    default: {
      description: 'Default platform markup',
      standard: 1.0,    // No markup (passthrough)
      ms2: 1.0,
      enabled: false,
    },
  },

  // ==========================================================================
  // MS2 TOKEN BENEFITS
  // ==========================================================================

  ms2Benefits: {
    // Token contract address (lowercase)
    tokenAddress: '0x98ed411b8cf8536657c660db8aa55d9d4baaf820',

    // Discount percentage vs standard pricing (for display purposes)
    discountPercent: 50,

    // Minimum deposit value to qualify for MS2 benefits
    minimumDepositUsd: 0.02,
  },

  // ==========================================================================
  // SERVICE-SPECIFIC OVERRIDES
  // ==========================================================================
  // Per-tool or per-workflow adjustments if certain operations are more expensive

  serviceOverrides: {
    comfyui: {
      // Tools that are particularly expensive to run can have additional multipliers
      toolMultipliers: {
        // 'chromake': 1.2,  // Example: 20% extra for chromakey (GPU intensive)
        // 'wan1that': 1.5,  // Example: 50% extra for video generation
      },
    },
  },

  // ==========================================================================
  // TRANSPARENCY MESSAGES
  // ==========================================================================
  // User-facing explanations for pricing

  transparency: {
    platformFeeExplanation: 'A portion of this cost covers platform infrastructure fees that enable advanced features like multi-LoRA loading.',
    ms2DiscountExplanation: 'MS2 token holders receive reduced platform fees as a benefit of supporting the ecosystem.',
    computeCostExplanation: 'Base compute cost reflects actual GPU time used for your generation.',
  },

  // ==========================================================================
  // RATE LIMITS & MINIMUMS
  // ==========================================================================

  minimums: {
    // Minimum charge per generation (in USD) to avoid micro-transaction overhead
    minimumChargeUsd: 0.001,

    // Minimum points to charge (avoids rounding to zero)
    minimumChargePoints: 3,
  },
};

// Freeze to prevent accidental mutation
Object.freeze(PRICING_CONFIG);
Object.freeze(PRICING_CONFIG.platformFeeMultipliers);
Object.freeze(PRICING_CONFIG.platformFeeMultipliers.comfyui);
Object.freeze(PRICING_CONFIG.platformFeeMultipliers.default);
Object.freeze(PRICING_CONFIG.ms2Benefits);
Object.freeze(PRICING_CONFIG.transparency);
Object.freeze(PRICING_CONFIG.minimums);

module.exports = { PRICING_CONFIG };
