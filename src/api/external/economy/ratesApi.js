const express = require('express');
const { createLogger } = require('../../../utils/logger');
const { getPricingService } = require('../../../core/services/pricing');

/**
 * External Rates API
 * 
 * Provides exchange rates for multi-currency cost display
 * This is a public endpoint that doesn't require authentication
 * since it's just exchange rate data.
 */
function createRatesApi(dependencies) {
  const router = express.Router();
  const { internalApiClient, priceFeedService, logger = createLogger('ratesApi-external') } = dependencies;

  // Fallback rates if internal API is unavailable
  const USD_TO_POINTS_CONVERSION_RATE = 0.000337;
  
  // Token addresses from tokenConfig.js
  const MS2_ADDRESS = '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820';
  const CULT_ADDRESS = '0x0000000000c5dc95539589fbD24BE07c6C14eCa4';
  
  const DEFAULT_RATES = {
    POINTS_per_USD: 1 / USD_TO_POINTS_CONVERSION_RATE, // ~2,967 points per USD
    MS2_per_USD: 2,
    CULT_per_USD: 50
  };

  // Cache for rates to avoid frequent external calls
  let ratesCache = {
    data: DEFAULT_RATES,
    lastUpdated: 0,
    ttl: 5 * 60 * 1000 // 5 minutes TTL
  };

  /**
   * Fetch real-time exchange rates using PriceFeedService
   * Falls back to default rates if pricing service is unavailable
   */
  async function fetchCurrentRates() {
    try {
      // If PriceFeedService is not available, use default rates
      if (!priceFeedService) {
        logger.warn('[ratesApi-external] PriceFeedService not available, using default rates');
        return { ...DEFAULT_RATES };
      }

      logger.info('[ratesApi-external] Fetching real-time exchange rates from PriceFeedService');
      
      // Fetch real-time prices for MS2 and CULT tokens
      const [ms2PriceUsd, cultPriceUsd] = await Promise.allSettled([
        priceFeedService.getPriceInUsd(MS2_ADDRESS),
        priceFeedService.getPriceInUsd(CULT_ADDRESS)
      ]);

      // Build rates object with real-time data or fallbacks
      const rates = {
        POINTS_per_USD: 1 / USD_TO_POINTS_CONVERSION_RATE, // Always use fixed rate for points
        MS2_per_USD: 2, // Default fallback
        CULT_per_USD: 50 // Default fallback
      };

      // Process MS2 price
      if (ms2PriceUsd.status === 'fulfilled' && ms2PriceUsd.value > 0) {
        rates.MS2_per_USD = 1 / ms2PriceUsd.value;
        logger.info('[ratesApi-external] MS2 real-time price fetched', { 
          priceUsd: ms2PriceUsd.value, 
          ms2PerUsd: rates.MS2_per_USD 
        });
      } else {
        logger.warn('[ratesApi-external] Failed to fetch MS2 price, using default', { 
          error: ms2PriceUsd.status === 'rejected' ? ms2PriceUsd.reason?.message : 'Invalid price'
        });
      }

      // Process CULT price
      if (cultPriceUsd.status === 'fulfilled' && cultPriceUsd.value > 0) {
        rates.CULT_per_USD = 1 / cultPriceUsd.value;
        logger.info('[ratesApi-external] CULT real-time price fetched', { 
          priceUsd: cultPriceUsd.value, 
          cultPerUsd: rates.CULT_per_USD 
        });
      } else {
        logger.warn('[ratesApi-external] Failed to fetch CULT price, using default', { 
          error: cultPriceUsd.status === 'rejected' ? cultPriceUsd.reason?.message : 'Invalid price'
        });
      }
      
      logger.info('[ratesApi-external] Final exchange rates calculated', { rates });
      return rates;
    } catch (error) {
      logger.error('[ratesApi-external] Error fetching exchange rates, using defaults', { error: error.message });
      return { ...DEFAULT_RATES };
    }
  }

  /**
   * Get cached rates or fetch fresh ones if cache is stale
   */
  async function getRates() {
    const now = Date.now();
    
    if (now - ratesCache.lastUpdated > ratesCache.ttl) {
      logger.info('[ratesApi-external] Cache expired, fetching fresh rates');
      ratesCache.data = await fetchCurrentRates();
      ratesCache.lastUpdated = now;
    }
    
    return ratesCache.data;
  }

  /**
   * @route GET /api/external/economy/rates
   * @description Fetches current exchange rates for cost display
   * @access Public (no authentication required)
   */
  router.get('/', async (req, res, next) => {
    const requestId = req.headers['x-request-id'] || 'unknown';
    
    try {
      logger.info(`[ratesApi-external] GET /rates - RequestId: ${requestId}`);
      
      // Get real-time rates with caching
      const rates = await getRates();
      
      res.status(200).json({
        success: true,
        data: rates,
        timestamp: new Date().toISOString(),
        requestId,
        source: 'real-time-pricing'
      });
      
    } catch (error) {
      logger.error(`[ratesApi-external] GET /rates error - RequestId: ${requestId}`, { error: error.message });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'RATES_FETCH_ERROR',
          message: 'Failed to fetch exchange rates',
          requestId
        },
        data: DEFAULT_RATES // Fallback to defaults
      });
    }
  });

  /**
   * @route GET /api/external/economy/rates/health
   * @description Health check endpoint
   * @access Public
   */
  router.get('/health', (req, res) => {
    res.status(200).json({
      success: true,
      service: 'ratesApi-external',
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
  });

  router.get('/rates', async (req, res, next) => {
    const requestId = req.headers['x-request-id'] || 'unknown';
    try {
      logger.info(`[ratesApi-external] GET /rates (compat) - RequestId: ${requestId}`);
      const rates = await getRates();
      res.status(200).json({
        success: true,
        data: rates,
        timestamp: new Date().toISOString(),
        requestId,
        source: 'real-time-pricing'
      });
    } catch (error) {
      logger.error(`[ratesApi-external] GET /rates (compat) error - RequestId: ${requestId}`, { error: error.message });
      res.status(500).json({
        success: false,
        error: { code: 'RATES_FETCH_ERROR', message: 'Failed to fetch exchange rates', requestId },
        data: DEFAULT_RATES
      });
    }
  });

  // ========================================================================
  // PRICING TRANSPARENCY ENDPOINTS
  // ========================================================================

  /**
   * @route GET /api/external/economy/pricing
   * @description Get current pricing configuration (platform fees, multipliers, MS2 discounts)
   * @access Public (transparency)
   */
  router.get('/pricing', (req, res) => {
    try {
      const pricingService = getPricingService(logger);
      const pricingInfo = pricingService.getPublicPricingInfo();
      res.json({
        success: true,
        data: pricingInfo,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('[ratesApi-external] Error fetching pricing info:', error);
      res.status(500).json({
        success: false,
        error: { code: 'PRICING_FETCH_ERROR', message: 'Failed to fetch pricing information' }
      });
    }
  });

  /**
   * @route GET /api/external/economy/pricing/quote
   * @description Get a price quote for a specific operation
   * @query computeCostUsd - Base compute cost in USD
   * @query serviceName - Service name (e.g., 'comfyui')
   * @query isMs2 - Whether user is MS2 tier ('true' or 'false')
   * @query toolId - Optional tool ID for per-tool pricing
   * @access Public (transparency)
   */
  router.get('/pricing/quote', (req, res) => {
    try {
      const { computeCostUsd, serviceName, isMs2, toolId } = req.query;

      if (!computeCostUsd || !serviceName) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'Missing required query params: computeCostUsd, serviceName' }
        });
      }

      const pricingService = getPricingService(logger);
      const quote = pricingService.getQuote({
        computeCostUsd: parseFloat(computeCostUsd),
        serviceName,
        isMs2User: isMs2 === 'true',
        toolId: toolId || null,
      });

      res.json({
        success: true,
        data: quote,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('[ratesApi-external] Error generating quote:', error);
      res.status(500).json({
        success: false,
        error: { code: 'QUOTE_ERROR', message: 'Failed to generate price quote' }
      });
    }
  });

  logger.info('[ratesApi-external] External Economy Rates API service initialized (with pricing transparency)');
  return router;
}

module.exports = {
  createRatesApi
};
