/**
 * X402 Pricing Service
 *
 * Calculates USD costs for tool executions and converts to USDC atomic units.
 * Uses the same cost logic as the points system but outputs USD.
 */

const { createLogger } = require('../../../utils/logger');
const { USDC_DECIMALS } = require('./X402ExecutionService');

const logger = createLogger('X402PricingService');

// Platform markup (percentage on top of base cost)
const PLATFORM_MARKUP = 0.20; // 20%

// Minimum charge in USD
const MINIMUM_CHARGE_USD = 0.01;

/**
 * @typedef {Object} X402Quote
 * @property {number} baseCostUsd - Raw cost from provider
 * @property {number} markupUsd - Platform markup
 * @property {number} totalCostUsd - Total cost in USD
 * @property {string} totalCostAtomic - Total cost in USDC atomic units
 * @property {string} toolId
 * @property {Object} parameters - Parameters used for calculation
 */

class X402PricingService {
  /**
   * @param {Object} services
   * @param {Object} services.toolRegistry - ToolRegistry instance
   */
  constructor(services) {
    this.toolRegistry = services.toolRegistry;
    this.logger = logger;
  }

  /**
   * Calculate cost for a tool execution
   *
   * @param {string} toolId
   * @param {Object} parameters - Input parameters
   * @returns {X402Quote}
   */
  calculateToolCost(toolId, parameters) {
    const tool = this.toolRegistry.getToolById(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    let baseCostUsd = 0;

    const { costingModel, metadata } = tool;

    if (!costingModel) {
      // No costing model - use minimum
      baseCostUsd = MINIMUM_CHARGE_USD;
    } else {
      switch (costingModel.rateSource) {
        case 'static':
          baseCostUsd = this._calculateStaticCost(tool, parameters);
          break;

        case 'api':
          baseCostUsd = this._calculateApiCost(tool, parameters);
          break;

        case 'machine':
          baseCostUsd = this._calculateMachineCost(tool, parameters);
          break;

        default:
          baseCostUsd = MINIMUM_CHARGE_USD;
      }
    }

    // Ensure minimum charge
    if (baseCostUsd < MINIMUM_CHARGE_USD) {
      baseCostUsd = MINIMUM_CHARGE_USD;
    }

    // Apply platform markup
    const markupUsd = baseCostUsd * PLATFORM_MARKUP;
    const totalCostUsd = baseCostUsd + markupUsd;

    // Convert to USDC atomic units (6 decimals)
    const totalCostAtomic = this._usdToAtomic(totalCostUsd);

    const quote = {
      baseCostUsd: Math.round(baseCostUsd * 1000000) / 1000000,
      markupUsd: Math.round(markupUsd * 1000000) / 1000000,
      totalCostUsd: Math.round(totalCostUsd * 1000000) / 1000000,
      totalCostAtomic,
      toolId,
      parameters: { ...parameters }
    };

    this.logger.debug('[x402] Quote calculated', quote);

    return quote;
  }

  /**
   * Calculate cost for static pricing (e.g., API calls with fixed rates)
   * @private
   */
  _calculateStaticCost(tool, parameters) {
    const { costingModel, metadata } = tool;

    // Check for cost table (like DALL-E)
    if (metadata?.costTable) {
      return this._lookupCostTable(metadata.costTable, parameters, tool);
    }

    // Fall back to static amount
    return costingModel.staticCost?.amount || MINIMUM_CHARGE_USD;
  }

  /**
   * Look up cost from a cost table (model -> size -> quality -> price)
   * @private
   */
  _lookupCostTable(costTable, parameters, tool) {
    const model = parameters.model || tool.inputSchema?.model?.default || Object.keys(costTable)[0];
    const size = parameters.size || tool.inputSchema?.size?.default || '1024x1024';
    const quality = parameters.quality || tool.inputSchema?.quality?.default || 'standard';

    // Navigate the cost table
    const modelCosts = costTable[model];
    if (!modelCosts) {
      this.logger.warn(`[x402] Model ${model} not in cost table, using default`);
      return MINIMUM_CHARGE_USD;
    }

    const sizeCosts = modelCosts[size];
    if (!sizeCosts) {
      // Try to find a size that matches
      const availableSizes = Object.keys(modelCosts);
      this.logger.warn(`[x402] Size ${size} not in cost table for ${model}, using first available: ${availableSizes[0]}`);
      const fallbackSizeCosts = modelCosts[availableSizes[0]];
      if (typeof fallbackSizeCosts === 'object') {
        return Object.values(fallbackSizeCosts)[0] || MINIMUM_CHARGE_USD;
      }
      return fallbackSizeCosts || MINIMUM_CHARGE_USD;
    }

    if (typeof sizeCosts === 'number') {
      return sizeCosts;
    }

    const cost = sizeCosts[quality];
    if (cost === undefined) {
      // Try first quality tier
      const availableQualities = Object.keys(sizeCosts);
      this.logger.warn(`[x402] Quality ${quality} not in cost table, using ${availableQualities[0]}`);
      return sizeCosts[availableQualities[0]] || MINIMUM_CHARGE_USD;
    }

    return cost;
  }

  /**
   * Calculate cost for API-based pricing
   * @private
   */
  _calculateApiCost(tool, parameters) {
    // Similar to static but may have different lookup
    if (tool.metadata?.costTable) {
      return this._lookupCostTable(tool.metadata.costTable, parameters, tool);
    }
    return tool.costingModel?.staticCost?.amount || MINIMUM_CHARGE_USD;
  }

  /**
   * Calculate cost for machine-time based pricing
   * @private
   */
  _calculateMachineCost(tool, parameters) {
    const { costingModel, metadata } = tool;

    // Rate per second
    const ratePerSecond = costingModel.rate || 0.001;

    // Estimate duration from historical data or defaults
    const avgDurationMs = metadata?.avgHistoricalDurationMs || 10000; // 10s default
    const durationSec = avgDurationMs / 1000;

    return ratePerSecond * durationSec;
  }

  /**
   * Convert USD to USDC atomic units
   * @private
   */
  _usdToAtomic(usdAmount) {
    // Round up to ensure we always cover costs
    const atomic = Math.ceil(usdAmount * Math.pow(10, USDC_DECIMALS));
    return atomic.toString();
  }

  /**
   * Generate PaymentRequired response for a tool
   *
   * @param {string} toolId
   * @param {Object} parameters
   * @param {Object} config - { receiverAddress, network, usdcAddress, resourceUrl }
   * @returns {Object} PaymentRequired object
   */
  generatePaymentRequired(toolId, parameters, config) {
    const quote = this.calculateToolCost(toolId, parameters);
    const tool = this.toolRegistry.getToolById(toolId);

    // EIP-712 domain parameters for USDC (required for transferWithAuthorization)
    // Base mainnet and Sepolia both use these values
    const usdcDomain = {
      name: 'USD Coin',
      version: '2'
    };

    return {
      x402Version: 2,
      resource: {
        url: config.resourceUrl,
        description: `${tool?.displayName || toolId} execution`,
        mimeType: 'application/json'
      },
      accepts: [{
        scheme: 'exact',
        network: config.network,
        asset: config.usdcAddress,
        amount: quote.totalCostAtomic,
        payTo: config.receiverAddress,
        maxTimeoutSeconds: 300,
        extra: {
          // EIP-712 domain parameters for the asset (USDC)
          name: usdcDomain.name,
          version: usdcDomain.version
        }
      }],
      // Include quote details for client reference
      extensions: {
        quote: {
          baseCostUsd: quote.baseCostUsd,
          markupUsd: quote.markupUsd,
          totalCostUsd: quote.totalCostUsd,
          toolId: quote.toolId
        }
      }
    };
  }
}

module.exports = { X402PricingService, PLATFORM_MARKUP, MINIMUM_CHARGE_USD };
