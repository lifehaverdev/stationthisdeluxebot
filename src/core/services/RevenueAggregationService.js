/**
 * Revenue Aggregation Service
 *
 * Combines revenue data from multiple sources:
 * - creditLedgerDb (points-based payments on Ethereum mainnet)
 * - x402PaymentLogDb (x402 payments on Base)
 *
 * Provides unified view for admin dashboard and reporting.
 */

const { createLogger } = require('../../utils/logger');

const logger = createLogger('RevenueAggregationService');

class RevenueAggregationService {
  /**
   * @param {Object} services
   * @param {Object} services.creditLedgerDb - Points/credit ledger database
   * @param {Object} services.x402PaymentLogDb - x402 payment log database
   */
  constructor(services) {
    this.creditLedgerDb = services.creditLedgerDb;
    this.x402PaymentLogDb = services.x402PaymentLogDb;
    this.logger = logger;
  }

  /**
   * Get combined revenue summary for a time period
   *
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Promise<Object>}
   */
  async getRevenueSummary(startDate, endDate) {
    const [pointsRevenue, x402Revenue] = await Promise.all([
      this._getPointsRevenue(startDate, endDate),
      this._getX402Revenue(startDate, endDate)
    ]);

    const totalUsd = pointsRevenue.totalUsd + x402Revenue.totalUsd;
    const totalTransactions = pointsRevenue.count + x402Revenue.count;

    return {
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      summary: {
        totalUsd,
        totalTransactions,
        avgTransactionUsd: totalTransactions > 0 ? totalUsd / totalTransactions : 0
      },
      bySource: {
        points: {
          totalUsd: pointsRevenue.totalUsd,
          count: pointsRevenue.count,
          chain: 'ethereum',
          description: 'Credit ledger (points) payments'
        },
        x402: {
          totalUsd: x402Revenue.totalUsd,
          count: x402Revenue.count,
          chain: 'base',
          description: 'x402 protocol payments'
        }
      },
      breakdown: {
        pointsPercentage: totalUsd > 0 ? (pointsRevenue.totalUsd / totalUsd) * 100 : 0,
        x402Percentage: totalUsd > 0 ? (x402Revenue.totalUsd / totalUsd) * 100 : 0
      }
    };
  }

  /**
   * Get revenue by day for charting
   *
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Promise<Array>}
   */
  async getRevenueByDay(startDate, endDate) {
    const [pointsByDay, x402ByDay] = await Promise.all([
      this._getPointsRevenueByDay(startDate, endDate),
      this.x402PaymentLogDb.getRevenueByDay(startDate, endDate)
    ]);

    // Merge into unified daily view
    const dayMap = new Map();

    // Add points data
    for (const day of pointsByDay) {
      dayMap.set(day._id, {
        date: day._id,
        points: { usd: day.total_usd || 0, count: day.count || 0 },
        x402: { usd: 0, count: 0 },
        total: { usd: day.total_usd || 0, count: day.count || 0 }
      });
    }

    // Add/merge x402 data
    for (const day of x402ByDay) {
      if (dayMap.has(day._id)) {
        const existing = dayMap.get(day._id);
        existing.x402 = { usd: day.total_usd || 0, count: day.count || 0 };
        existing.total.usd += day.total_usd || 0;
        existing.total.count += day.count || 0;
      } else {
        dayMap.set(day._id, {
          date: day._id,
          points: { usd: 0, count: 0 },
          x402: { usd: day.total_usd || 0, count: day.count || 0 },
          total: { usd: day.total_usd || 0, count: day.count || 0 }
        });
      }
    }

    // Sort by date and return
    return Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get top revenue sources (tools/spells)
   *
   * @param {Date} startDate
   * @param {Date} endDate
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async getTopRevenueSources(startDate, endDate, limit = 10) {
    const x402ByTool = await this._getX402RevenueByTool(startDate, endDate, limit);

    // For now, just return x402 data
    // TODO: Add points revenue by spell when that data is available
    return x402ByTool.map(item => ({
      toolId: item._id,
      source: 'x402',
      totalUsd: item.total_usd,
      count: item.count,
      avgUsd: item.count > 0 ? item.total_usd / item.count : 0
    }));
  }

  /**
   * Get unique payers across both systems
   *
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Promise<Object>}
   */
  async getUniquePayers(startDate, endDate) {
    const [pointsUsers, x402Payers] = await Promise.all([
      this._getUniquePointsUsers(startDate, endDate),
      this._getUniqueX402Payers(startDate, endDate)
    ]);

    return {
      points: {
        uniqueUsers: pointsUsers.count,
        description: 'Unique master accounts using points'
      },
      x402: {
        uniquePayers: x402Payers.count,
        topPayers: x402Payers.top,
        description: 'Unique wallet addresses using x402'
      },
      total: pointsUsers.count + x402Payers.count
    };
  }

  // ==================== Private Methods ====================

  /**
   * Get points-based revenue from credit ledger
   * @private
   */
  async _getPointsRevenue(startDate, endDate) {
    if (!this.creditLedgerDb) {
      return { totalUsd: 0, count: 0 };
    }

    try {
      // Query credit ledger for charges in this period
      // This depends on how charges are tracked in your credit ledger
      // For now, return placeholder - you'll need to adapt to your schema
      const result = await this.creditLedgerDb.getChargesInPeriod?.(startDate, endDate);

      if (!result) {
        // Fallback: try to estimate from deposits used
        return { totalUsd: 0, count: 0 };
      }

      return {
        totalUsd: result.totalUsd || 0,
        count: result.count || 0
      };
    } catch (error) {
      this.logger.error('[RevenueAggregation] Failed to get points revenue', { error: error.message });
      return { totalUsd: 0, count: 0 };
    }
  }

  /**
   * Get x402 revenue from payment log
   * @private
   */
  async _getX402Revenue(startDate, endDate) {
    try {
      const stats = await this.x402PaymentLogDb.getStats(startDate, endDate);
      return {
        totalUsd: stats.settled?.totalUsd || 0,
        count: stats.settled?.count || 0
      };
    } catch (error) {
      this.logger.error('[RevenueAggregation] Failed to get x402 revenue', { error: error.message });
      return { totalUsd: 0, count: 0 };
    }
  }

  /**
   * Get points revenue by day
   * @private
   */
  async _getPointsRevenueByDay(startDate, endDate) {
    if (!this.creditLedgerDb?.getRevenueByDay) {
      return [];
    }

    try {
      return await this.creditLedgerDb.getRevenueByDay(startDate, endDate);
    } catch (error) {
      this.logger.error('[RevenueAggregation] Failed to get points revenue by day', { error: error.message });
      return [];
    }
  }

  /**
   * Get x402 revenue by tool
   * @private
   */
  async _getX402RevenueByTool(startDate, endDate, limit) {
    try {
      const { getDb } = require('../services/db/mongoClient');
      const db = await getDb();

      return await db.collection('x402_payment_log').aggregate([
        {
          $match: {
            status: 'SETTLED',
            settled_at: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$tool_id',
            total_usd: { $sum: '$paid_usd' },
            count: { $sum: 1 }
          }
        },
        { $sort: { total_usd: -1 } },
        { $limit: limit }
      ]).toArray();
    } catch (error) {
      this.logger.error('[RevenueAggregation] Failed to get x402 revenue by tool', { error: error.message });
      return [];
    }
  }

  /**
   * Get unique points users
   * @private
   */
  async _getUniquePointsUsers(startDate, endDate) {
    if (!this.creditLedgerDb) {
      return { count: 0 };
    }

    try {
      // Adapt to your schema
      const result = await this.creditLedgerDb.getUniqueUsersInPeriod?.(startDate, endDate);
      return { count: result?.count || 0 };
    } catch (error) {
      return { count: 0 };
    }
  }

  /**
   * Get unique x402 payers
   * @private
   */
  async _getUniqueX402Payers(startDate, endDate) {
    try {
      const { getDb } = require('../services/db/mongoClient');
      const db = await getDb();

      const uniqueCount = await db.collection('x402_payment_log').distinct('payer', {
        status: 'SETTLED',
        settled_at: { $gte: startDate, $lte: endDate }
      });

      const topPayers = await this.x402PaymentLogDb.getTopPayers(startDate, endDate, 5);

      return {
        count: uniqueCount.length,
        top: topPayers.map(p => ({
          address: p._id,
          totalUsd: p.total_usd,
          count: p.count
        }))
      };
    } catch (error) {
      this.logger.error('[RevenueAggregation] Failed to get unique x402 payers', { error: error.message });
      return { count: 0, top: [] };
    }
  }
}

module.exports = { RevenueAggregationService };
