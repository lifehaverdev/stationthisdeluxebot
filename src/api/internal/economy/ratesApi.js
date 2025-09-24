const express = require('express');
const { createLogger } = require('../../../utils/logger');

/**
 * Economy Rates API Service
 * 
 * Provides exchange rates for multi-currency cost display
 * Endpoint: /api/internal/economy/rates
 */
module.exports = function createRatesApiService(dependencies = {}) {
  const { logger = createLogger('ratesApi'), priceFeedService } = dependencies;
  
  const router = express.Router();

  // Real exchange rates (matching backend services)
  const USD_TO_POINTS_CONVERSION_RATE = 0.000337;
  
  // Token addresses from tokenConfig.js
  const MS2_ADDRESS = '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820';
  const CULT_ADDRESS = '0x0000000000c5dc95539589fbD24BE07c6C14eCa4';
  
  // Fallback rates if pricing service fails
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
        logger.warn('[ratesApi] PriceFeedService not available, using default rates');
        return { ...DEFAULT_RATES };
      }

      logger.info('[ratesApi] Fetching real-time exchange rates from PriceFeedService');
      
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
        logger.info('[ratesApi] MS2 real-time price fetched', { 
          priceUsd: ms2PriceUsd.value, 
          ms2PerUsd: rates.MS2_per_USD 
        });
      } else {
        logger.warn('[ratesApi] Failed to fetch MS2 price, using default', { 
          error: ms2PriceUsd.status === 'rejected' ? ms2PriceUsd.reason?.message : 'Invalid price'
        });
      }

      // Process CULT price
      if (cultPriceUsd.status === 'fulfilled' && cultPriceUsd.value > 0) {
        rates.CULT_per_USD = 1 / cultPriceUsd.value;
        logger.info('[ratesApi] CULT real-time price fetched', { 
          priceUsd: cultPriceUsd.value, 
          cultPerUsd: rates.CULT_per_USD 
        });
      } else {
        logger.warn('[ratesApi] Failed to fetch CULT price, using default', { 
          error: cultPriceUsd.status === 'rejected' ? cultPriceUsd.reason?.message : 'Invalid price'
        });
      }
      
      logger.info('[ratesApi] Final exchange rates calculated', { rates });
      return rates;
    } catch (error) {
      logger.error('[ratesApi] Error fetching exchange rates, using defaults', { error: error.message });
      return { ...DEFAULT_RATES };
    }
  }

  /**
   * Get cached rates or fetch fresh ones if cache is stale
   */
  async function getRates() {
    const now = Date.now();
    
    if (now - ratesCache.lastUpdated > ratesCache.ttl) {
      logger.info('[ratesApi] Cache expired, fetching fresh rates');
      ratesCache.data = await fetchCurrentRates();
      ratesCache.lastUpdated = now;
    }
    
    return ratesCache.data;
  }

  /**
   * GET /api/internal/economy/rates
   * Returns current exchange rates for cost display
   */
  router.get('/', async (req, res) => {
    const requestId = req.headers['x-request-id'] || 'unknown';
    
    try {
      logger.info(`[ratesApi] GET /rates - RequestId: ${requestId}`);
      
      const rates = await getRates();
      
      res.status(200).json({
        success: true,
        data: rates,
        timestamp: new Date().toISOString(),
        requestId
      });
      
    } catch (error) {
      logger.error(`[ratesApi] GET /rates error - RequestId: ${requestId}`, { error: error.message });
      
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
   * GET /api/internal/economy/rates/health
   * Health check endpoint
   */
  router.get('/health', (req, res) => {
    res.status(200).json({
      success: true,
      service: 'ratesApi',
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
  });

  logger.info('[ratesApi] Economy Rates API service initialized');
  return router;
};
