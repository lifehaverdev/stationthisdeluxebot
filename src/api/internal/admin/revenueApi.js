/**
 * Revenue Admin API
 *
 * Endpoints for admin dashboard revenue reporting.
 * Combines points and x402 revenue into unified views.
 */

const express = require('express');
const { RevenueAggregationService } = require('../../../core/services/RevenueAggregationService');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('RevenueAdminApi');

/**
 * Create revenue admin API router
 *
 * @param {Object} dependencies
 * @param {Object} dependencies.creditLedgerDb
 * @param {Object} dependencies.x402PaymentLogDb
 */
function createRevenueAdminApi(dependencies) {
  const { creditLedgerDb, x402PaymentLogDb } = dependencies;

  const router = express.Router();
  const revenueService = new RevenueAggregationService({ creditLedgerDb, x402PaymentLogDb });

  /**
   * GET /internal/v1/admin/revenue/summary
   *
   * Get revenue summary for a time period
   * Query params: start, end (ISO date strings)
   */
  router.get('/summary', async (req, res) => {
    try {
      const { start, end } = req.query;

      // Default to last 30 days
      const endDate = end ? new Date(end) : new Date();
      const startDate = start ? new Date(start) : new Date(endDate - 30 * 24 * 60 * 60 * 1000);

      const summary = await revenueService.getRevenueSummary(startDate, endDate);

      return res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      logger.error('[RevenueAdminApi] Failed to get summary', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to get revenue summary'
      });
    }
  });

  /**
   * GET /internal/v1/admin/revenue/daily
   *
   * Get daily revenue breakdown for charting
   * Query params: start, end (ISO date strings)
   */
  router.get('/daily', async (req, res) => {
    try {
      const { start, end } = req.query;

      const endDate = end ? new Date(end) : new Date();
      const startDate = start ? new Date(start) : new Date(endDate - 30 * 24 * 60 * 60 * 1000);

      const dailyData = await revenueService.getRevenueByDay(startDate, endDate);

      return res.json({
        success: true,
        data: {
          period: {
            start: startDate.toISOString(),
            end: endDate.toISOString()
          },
          days: dailyData
        }
      });
    } catch (error) {
      logger.error('[RevenueAdminApi] Failed to get daily data', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to get daily revenue'
      });
    }
  });

  /**
   * GET /internal/v1/admin/revenue/top-sources
   *
   * Get top revenue-generating tools/spells
   * Query params: start, end, limit
   */
  router.get('/top-sources', async (req, res) => {
    try {
      const { start, end, limit = 10 } = req.query;

      const endDate = end ? new Date(end) : new Date();
      const startDate = start ? new Date(start) : new Date(endDate - 30 * 24 * 60 * 60 * 1000);

      const topSources = await revenueService.getTopRevenueSources(startDate, endDate, parseInt(limit));

      return res.json({
        success: true,
        data: {
          period: {
            start: startDate.toISOString(),
            end: endDate.toISOString()
          },
          sources: topSources
        }
      });
    } catch (error) {
      logger.error('[RevenueAdminApi] Failed to get top sources', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to get top sources'
      });
    }
  });

  /**
   * GET /internal/v1/admin/revenue/users
   *
   * Get unique payers/users stats
   * Query params: start, end
   */
  router.get('/users', async (req, res) => {
    try {
      const { start, end } = req.query;

      const endDate = end ? new Date(end) : new Date();
      const startDate = start ? new Date(start) : new Date(endDate - 30 * 24 * 60 * 60 * 1000);

      const userStats = await revenueService.getUniquePayers(startDate, endDate);

      return res.json({
        success: true,
        data: {
          period: {
            start: startDate.toISOString(),
            end: endDate.toISOString()
          },
          ...userStats
        }
      });
    } catch (error) {
      logger.error('[RevenueAdminApi] Failed to get user stats', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to get user stats'
      });
    }
  });

  /**
   * GET /internal/v1/admin/revenue/x402/stats
   *
   * Get x402-specific stats
   * Query params: start, end
   */
  router.get('/x402/stats', async (req, res) => {
    try {
      const { start, end } = req.query;

      const endDate = end ? new Date(end) : new Date();
      const startDate = start ? new Date(start) : new Date(endDate - 30 * 24 * 60 * 60 * 1000);

      const stats = await x402PaymentLogDb.getStats(startDate, endDate);
      const topPayers = await x402PaymentLogDb.getTopPayers(startDate, endDate, 10);
      const dailyRevenue = await x402PaymentLogDb.getRevenueByDay(startDate, endDate);

      return res.json({
        success: true,
        data: {
          period: {
            start: startDate.toISOString(),
            end: endDate.toISOString()
          },
          stats,
          topPayers: topPayers.map(p => ({
            address: p._id,
            totalUsd: p.total_usd,
            transactionCount: p.count
          })),
          dailyRevenue
        }
      });
    } catch (error) {
      logger.error('[RevenueAdminApi] Failed to get x402 stats', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to get x402 stats'
      });
    }
  });

  return router;
}

module.exports = createRevenueAdminApi;
