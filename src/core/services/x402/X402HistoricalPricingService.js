/**
 * X402 Historical Pricing Service
 *
 * Uses actual generation data + tool registry costs to calculate accurate pricing.
 *
 * Priority order:
 * 1. Historical data from generationOutputsDb (if sufficient samples)
 * 2. Tool's costingModel/costTable from ToolRegistry
 * 3. Minimum floor price
 *
 * Pricing strategy by data confidence:
 * - High confidence (n > 100): Use p95 historical cost + 20% markup
 * - Medium confidence (10 < n < 100): Use max historical cost + 30% markup
 * - Low confidence (n < 10): Use tool's defined cost + 50% markup
 * - No data: Use tool's defined cost + 75% markup (or minimum floor)
 */

const { createLogger } = require('../../../utils/logger');
const { USDC_DECIMALS } = require('./X402ExecutionService');

const logger = createLogger('X402HistoricalPricingService');

// Markup tiers based on data confidence
const MARKUP_TIERS = {
  HIGH_CONFIDENCE: 0.20,    // n > 100, use p95 historical
  MEDIUM_CONFIDENCE: 0.30,  // 10 < n < 100, use max historical
  LOW_CONFIDENCE: 0.50,     // n < 10, use tool definition
  NO_DATA: 0.75             // No historical data, use tool definition
};

// Thresholds for confidence levels
const CONFIDENCE_THRESHOLDS = {
  HIGH: 100,
  MEDIUM: 10
};

// Absolute minimum charge (only used if tool has no cost defined)
const MINIMUM_CHARGE_USD = 0.01;

// Cache TTL (1 hour)
const CACHE_TTL_MS = 60 * 60 * 1000;

class X402HistoricalPricingService {
  /**
   * @param {Object} services
   * @param {Object} services.generationOutputsDb - GenerationOutputsDB instance
   * @param {Object} services.toolRegistry - ToolRegistry instance
   */
  constructor(services) {
    this.generationOutputsDb = services.generationOutputsDb;
    this.toolRegistry = services.toolRegistry;
    this.logger = logger;

    if (!this.toolRegistry) {
      throw new Error('X402HistoricalPricingService requires toolRegistry');
    }

    // Cache for aggregated historical stats
    this._statsCache = new Map();
    this._lastCacheRefresh = null;
  }

  /**
   * Get pricing for a tool execution
   *
   * @param {string} toolId
   * @param {Object} parameters - Input parameters (for cost table lookup)
   * @returns {Promise<Object>} Quote with pricing details
   */
  async calculateToolCost(toolId, parameters = {}) {
    const tool = this.toolRegistry.getToolById(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    // Get historical stats (from cache or fresh query)
    const stats = await this._getToolStats(toolId);

    let baseCostUsd;
    let markup;
    let confidence;
    let source;

    if (stats && stats.count >= CONFIDENCE_THRESHOLDS.HIGH) {
      // High confidence: use p95 historical cost
      baseCostUsd = stats.p95CostUsd || stats.avgCostUsd;
      markup = MARKUP_TIERS.HIGH_CONFIDENCE;
      confidence = 'high';
      source = 'historical_p95';
      this.logger.debug(`[x402] High confidence pricing for ${toolId}`, {
        n: stats.count,
        p95: baseCostUsd,
        avg: stats.avgCostUsd
      });

    } else if (stats && stats.count >= CONFIDENCE_THRESHOLDS.MEDIUM) {
      // Medium confidence: use max historical cost
      baseCostUsd = stats.maxCostUsd || stats.avgCostUsd * 1.5;
      markup = MARKUP_TIERS.MEDIUM_CONFIDENCE;
      confidence = 'medium';
      source = 'historical_max';
      this.logger.debug(`[x402] Medium confidence pricing for ${toolId}`, {
        n: stats.count,
        max: baseCostUsd
      });

    } else if (stats && stats.count > 0) {
      // Low confidence: have some data, blend with tool definition
      const historicalMax = stats.maxCostUsd || stats.avgCostUsd;
      const toolDefinedCost = this._getToolDefinedCost(tool, parameters);
      // Use whichever is higher for safety
      baseCostUsd = Math.max(historicalMax, toolDefinedCost);
      markup = MARKUP_TIERS.LOW_CONFIDENCE;
      confidence = 'low';
      source = 'historical_limited_blended';
      this.logger.debug(`[x402] Low confidence pricing for ${toolId}`, {
        n: stats.count,
        historical: historicalMax,
        toolDefined: toolDefinedCost,
        used: baseCostUsd
      });

    } else {
      // No historical data: use tool's defined cost
      baseCostUsd = this._getToolDefinedCost(tool, parameters);
      markup = MARKUP_TIERS.NO_DATA;
      confidence = 'none';
      source = this._getToolCostSource(tool, parameters);
      this.logger.debug(`[x402] No historical data for ${toolId}, using ${source}`, {
        cost: baseCostUsd
      });
    }

    // Ensure minimum
    if (baseCostUsd < MINIMUM_CHARGE_USD) {
      baseCostUsd = MINIMUM_CHARGE_USD;
      source = 'minimum_floor';
    }

    const markupUsd = baseCostUsd * markup;
    const totalCostUsd = baseCostUsd + markupUsd;
    const totalCostAtomic = this._usdToAtomic(totalCostUsd);

    return {
      toolId,
      toolDisplayName: tool.displayName,
      baseCostUsd: this._round(baseCostUsd),
      markupUsd: this._round(markupUsd),
      markupPercent: Math.round(markup * 100),
      totalCostUsd: this._round(totalCostUsd),
      totalCostAtomic,
      confidence,
      source,
      historicalSampleSize: stats?.count || 0,
      toolCostingModel: tool.costingModel?.rateSource || 'unknown',
      parameters
    };
  }

  /**
   * Get the cost defined in the tool's definition
   * @private
   */
  _getToolDefinedCost(tool, parameters) {
    const { costingModel, metadata } = tool;

    if (!costingModel) {
      return MINIMUM_CHARGE_USD;
    }

    switch (costingModel.rateSource) {
      case 'static':
        return this._getStaticCost(tool, parameters);

      case 'api':
        return this._getApiCost(tool, parameters);

      case 'machine':
        return this._getMachineCost(tool, parameters);

      default:
        return MINIMUM_CHARGE_USD;
    }
  }

  /**
   * Get descriptive source name for the cost
   * @private
   */
  _getToolCostSource(tool, parameters) {
    const { costingModel, metadata } = tool;

    if (!costingModel) return 'minimum_floor';

    if (metadata?.costTable) return 'tool_cost_table';
    if (costingModel.staticCost) return 'tool_static_cost';
    if (costingModel.rateSource === 'machine') return 'tool_machine_rate';

    return 'tool_definition';
  }

  /**
   * Calculate static cost from tool definition
   * @private
   */
  _getStaticCost(tool, parameters) {
    const { costingModel, metadata } = tool;

    // Check for detailed cost table first (like DALL-E)
    if (metadata?.costTable) {
      return this._lookupCostTable(metadata.costTable, parameters, tool);
    }

    // Fall back to staticCost
    if (costingModel.staticCost) {
      const amount = costingModel.staticCost.amount || 0;
      const unit = costingModel.staticCost.unit || 'request';

      // For per-token costs, estimate based on typical usage
      if (unit === 'token') {
        // Estimate ~1000 tokens for a typical request
        const estimatedTokens = parameters.maxTokens || 1000;
        return amount * estimatedTokens;
      }

      return amount;
    }

    return MINIMUM_CHARGE_USD;
  }

  /**
   * Calculate API-based cost from tool definition
   * @private
   */
  _getApiCost(tool, parameters) {
    // API costs typically use cost tables
    if (tool.metadata?.costTable) {
      return this._lookupCostTable(tool.metadata.costTable, parameters, tool);
    }

    // Fall back to static if available
    return this._getStaticCost(tool, parameters);
  }

  /**
   * Calculate machine-time based cost from tool definition
   * @private
   */
  _getMachineCost(tool, parameters) {
    const { costingModel, metadata } = tool;

    // Get rate per second (default: $0.001/sec)
    const ratePerSecond = costingModel.rate || 0.001;

    // Try to get estimated duration from tool metadata
    let estimatedSeconds;

    if (metadata?.estimatedGpuSeconds) {
      estimatedSeconds = metadata.estimatedGpuSeconds;
    } else if (metadata?.avgHistoricalDurationMs) {
      estimatedSeconds = metadata.avgHistoricalDurationMs / 1000;
    } else if (metadata?.maxHistoricalDurationMs) {
      // Use max for safety if only max is available
      estimatedSeconds = metadata.maxHistoricalDurationMs / 1000;
    } else {
      // Default estimate: 30 seconds
      estimatedSeconds = 30;
    }

    // For video tools, scale by duration if provided
    if (tool.category === 'video' && parameters.duration) {
      const durationMultiplier = parameters.duration / (tool.inputSchema?.duration?.default || 2);
      estimatedSeconds *= durationMultiplier;
    }

    return ratePerSecond * estimatedSeconds;
  }

  /**
   * Look up cost from a cost table (model -> size -> quality -> price)
   * @private
   */
  _lookupCostTable(costTable, parameters, tool) {
    // Get parameter values with defaults from schema
    const model = parameters.model || tool.inputSchema?.model?.default || Object.keys(costTable)[0];
    const size = parameters.size || tool.inputSchema?.size?.default;
    const quality = parameters.quality || tool.inputSchema?.quality?.default;

    // Navigate the cost table
    const modelCosts = costTable[model];
    if (!modelCosts) {
      // Model not found, use first model's costs
      const firstModel = Object.keys(costTable)[0];
      const firstModelCosts = costTable[firstModel];
      return this._extractCostFromLevel(firstModelCosts);
    }

    // If model costs is a number, return it directly
    if (typeof modelCosts === 'number') {
      return modelCosts;
    }

    // Try to find size-specific costs
    if (size && modelCosts[size]) {
      const sizeCosts = modelCosts[size];
      if (typeof sizeCosts === 'number') {
        return sizeCosts;
      }
      // Try quality level
      if (quality && sizeCosts[quality] !== undefined) {
        return sizeCosts[quality];
      }
      // Return first quality tier
      return this._extractCostFromLevel(sizeCosts);
    }

    // No size match, use first available
    return this._extractCostFromLevel(modelCosts);
  }

  /**
   * Extract a numeric cost from a nested cost structure
   * @private
   */
  _extractCostFromLevel(costs) {
    if (typeof costs === 'number') {
      return costs;
    }
    if (typeof costs === 'object') {
      const firstKey = Object.keys(costs)[0];
      return this._extractCostFromLevel(costs[firstKey]);
    }
    return MINIMUM_CHARGE_USD;
  }

  /**
   * Refresh the stats cache for all tools
   * Call this periodically (e.g., hourly via cron) or on startup
   */
  async refreshCache() {
    this.logger.info('[x402] Refreshing historical pricing cache...');

    try {
      const allStats = await this._aggregateAllToolStats();

      this._statsCache.clear();
      for (const stat of allStats) {
        this._statsCache.set(stat.toolId, stat);
      }

      this._lastCacheRefresh = Date.now();
      this.logger.info(`[x402] Cache refreshed with ${allStats.length} tools`);

      return { success: true, toolCount: allStats.length };

    } catch (error) {
      this.logger.error('[x402] Failed to refresh cache', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get stats for a specific tool (from cache or fresh query)
   * @private
   */
  async _getToolStats(toolId) {
    // Check if cache is stale
    if (!this._lastCacheRefresh || (Date.now() - this._lastCacheRefresh) > CACHE_TTL_MS) {
      await this.refreshCache();
    }

    return this._statsCache.get(toolId);
  }

  /**
   * Aggregate stats for all tools from generationOutputs
   * @private
   */
  async _aggregateAllToolStats() {
    if (!this.generationOutputsDb) {
      this.logger.warn('[x402] No generationOutputsDb available, using tool definitions only');
      return [];
    }

    // Look at last 30 days of successful generations
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const pipeline = [
      {
        $match: {
          status: 'success',
          requestTimestamp: { $gte: thirtyDaysAgo },
          costUsd: { $exists: true, $ne: null }
        }
      },
      {
        $addFields: {
          // Prefer toolId, fall back to toolDisplayName, then serviceName
          toolKey: {
            $ifNull: [
              '$toolId',
              { $ifNull: ['$toolDisplayName', '$serviceName'] }
            ]
          },
          // Convert Decimal128 to double for aggregation
          costUsdNum: { $toDouble: '$costUsd' }
        }
      },
      {
        $group: {
          _id: '$toolKey',
          count: { $sum: 1 },
          avgCostUsd: { $avg: '$costUsdNum' },
          minCostUsd: { $min: '$costUsdNum' },
          maxCostUsd: { $max: '$costUsdNum' },
          stdDevCostUsd: { $stdDevPop: '$costUsdNum' },
          avgDurationMs: { $avg: '$durationMs' },
          maxDurationMs: { $max: '$durationMs' }
        }
      },
      {
        $project: {
          _id: 0,
          toolId: '$_id',
          count: 1,
          avgCostUsd: { $round: ['$avgCostUsd', 6] },
          minCostUsd: { $round: ['$minCostUsd', 6] },
          maxCostUsd: { $round: ['$maxCostUsd', 6] },
          stdDevCostUsd: { $round: ['$stdDevCostUsd', 6] },
          avgDurationMs: { $round: ['$avgDurationMs', 0] },
          maxDurationMs: 1,
          // Estimate p95 as avg + 2*stdDev (approximation)
          p95CostUsd: {
            $round: [
              { $add: ['$avgCostUsd', { $multiply: ['$stdDevCostUsd', 2] }] },
              6
            ]
          }
        }
      }
    ];

    try {
      const results = await this.generationOutputsDb.aggregate(pipeline);

      // Ensure p95 doesn't exceed max
      return results.map(stat => {
        if (stat.p95CostUsd > stat.maxCostUsd) {
          stat.p95CostUsd = stat.maxCostUsd;
        }
        // Ensure p95 isn't less than average
        if (stat.p95CostUsd < stat.avgCostUsd) {
          stat.p95CostUsd = stat.avgCostUsd;
        }
        return stat;
      });

    } catch (error) {
      this.logger.error('[x402] Aggregation failed', { error: error.message });
      return [];
    }
  }

  /**
   * Convert USD to USDC atomic units
   * @private
   */
  _usdToAtomic(usdAmount) {
    const atomic = Math.ceil(usdAmount * Math.pow(10, USDC_DECIMALS));
    return atomic.toString();
  }

  /**
   * Round to 6 decimal places
   * @private
   */
  _round(num) {
    return Math.round(num * 1000000) / 1000000;
  }

  /**
   * Get cache status for debugging/monitoring
   */
  getCacheStatus() {
    return {
      size: this._statsCache.size,
      lastRefresh: this._lastCacheRefresh ? new Date(this._lastCacheRefresh).toISOString() : null,
      ageMs: this._lastCacheRefresh ? Date.now() - this._lastCacheRefresh : null,
      isStale: !this._lastCacheRefresh || (Date.now() - this._lastCacheRefresh) > CACHE_TTL_MS,
      ttlMs: CACHE_TTL_MS
    };
  }

  /**
   * Get all cached stats (for debugging)
   */
  getAllCachedStats() {
    return Object.fromEntries(this._statsCache);
  }

  /**
   * Get stats for a specific tool (for debugging)
   */
  async getToolStats(toolId) {
    return this._getToolStats(toolId);
  }

  /**
   * Get pricing breakdown for all registered tools
   * Useful for admin dashboard
   */
  async getAllToolPricing() {
    const tools = this.toolRegistry.getAllTools();
    const results = [];

    for (const tool of tools) {
      try {
        const quote = await this.calculateToolCost(tool.toolId, {});
        results.push(quote);
      } catch (error) {
        results.push({
          toolId: tool.toolId,
          toolDisplayName: tool.displayName,
          error: error.message
        });
      }
    }

    return results;
  }
}

module.exports = {
  X402HistoricalPricingService,
  MARKUP_TIERS,
  CONFIDENCE_THRESHOLDS,
  MINIMUM_CHARGE_USD,
  CACHE_TTL_MS
};
