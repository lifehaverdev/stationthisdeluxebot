/**
 * Pricing Module
 *
 * Centralized pricing configuration and calculation.
 * Import from here for all pricing-related functionality.
 */

const { PRICING_CONFIG } = require('./pricingConfig');
const { PricingService, getPricingService } = require('./pricingService');

module.exports = {
  PRICING_CONFIG,
  PricingService,
  getPricingService,
};
