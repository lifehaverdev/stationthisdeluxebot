/**
 * Account Points Service
 * 
 * Provides core functionality for managing user points and balances
 * Handles business logic for points calculations, refreshing, and visualization
 */

const { AppError } = require('../../utils/errors');

/**
 * Account Points Service
 * Handles core points functionality including fetching, updating, and visualizing balances
 */
class AccountPointsService {
  /**
   * Creates a new AccountPointsService
   * @param {Object} deps - Dependencies
   * @param {Object} deps.userEconomyRepo - Repository for user economy data
   * @param {Object} deps.walletService - Service for wallet operations (optional)
   * @param {Object} deps.logger - Logger instance
   */
  constructor({ userEconomyRepo, walletService = null, logger }) {
    this.userEconomyRepo = userEconomyRepo;
    this.walletService = walletService;
    this.logger = logger;
  }

  /**
   * Get a user's current points balance
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User balance information
   */
  async getUserBalance(userId) {
    try {
      const economyData = await this.userEconomyRepo.findOne({ userId });
      if (!economyData) {
        return { 
          points: 0, 
          qoints: 0, 
          pendingQoints: 0,
          balance: 0,
          doints: 0,
          maxPoints: 10000 // Default max points
        };
      }
      
      return {
        points: economyData.points || 0,
        qoints: economyData.qoints || 0,
        pendingQoints: economyData.pendingQoints || 0,
        balance: economyData.balance || 0,
        doints: economyData.doints || 0,
        maxPoints: economyData.maxPoints || 10000
      };
    } catch (error) {
      this.logger.error('Error fetching user balance', { userId, error });
      throw new AppError('Failed to fetch balance', 'FETCH_BALANCE_FAILED');
    }
  }

  /**
   * Refresh a user's points balance
   * @param {string} userId - User ID
   * @param {Object} userData - User data from session
   * @returns {Promise<Object>} Updated balance information
   */
  async refreshPoints(userId, userData) {
    try {
      // Get the latest economic data from repository
      const economyData = await this.userEconomyRepo.findOne({ userId });
      if (!economyData) {
        return this.getUserBalance(userId);
      }

      // Initialize persistent data for user
      let updatedData = {
        pendingQoints: 0,
        qoints: userData.qoints || economyData.qoints || 0,
        points: userData.points || economyData.points || 0,
        doints: userData.doints || economyData.doints || 0,
        balance: userData.balance || economyData.balance || 0,
        maxPoints: economyData.maxPoints || 10000
      };
      
      // Get pending qoints from both memory and DB
      const dbPendingQoints = economyData.pendingQoints || 0;
      const memoryPendingQoints = userData.pendingQoints || 0;
      const totalPendingQoints = Math.max(memoryPendingQoints, dbPendingQoints);

      // Update qoints if there are pending ones
      if (totalPendingQoints > 0) {
        updatedData.qoints += totalPendingQoints;
        
        // Update the database with the new values
        await this.userEconomyRepo.startBatch()
          .writeUserDataPoint(userId, 'pendingQoints', 0, true)
          .writeUserDataPoint(userId, 'qoints', updatedData.qoints, true)
          .executeBatch();
      }

      // Refresh balance from blockchain if user is verified and has wallet
      if (userData.verified && userData.wallet && this.walletService) {
        try {
          const balance = await this.walletService.getBalance(userData.wallet);
          updatedData.balance = balance;
          this.logger.info(`Updated balance for ${userId}: ${balance}`);
        } catch (balanceError) {
          this.logger.warn(`Failed to fetch balance for user ${userId}`, { error: balanceError });
          // Don't update balance if fetch fails
        }
      }

      return updatedData;
    } catch (error) {
      this.logger.error('Error refreshing user points', { userId, error });
      throw new AppError('Failed to refresh points', 'REFRESH_POINTS_FAILED');
    }
  }

  /**
   * Create a visual representation of user's points balance
   * @param {number} totalPossiblePoints - Maximum possible points
   * @param {number} spentPoints - Points spent by user
   * @param {number} qoints - Qoints balance
   * @param {number} segments - Number of segments in bar (default: 7)
   * @returns {string} Visual representation of points balance
   */
  createBalancedBar(totalPossiblePoints, spentPoints, qoints, segments = 7) {
    let bar = [];

    const regeneratingEmojiTiers = [
      { emoji: '💎', value: 10000 },
      { emoji: '💠', value: 1000 },
      { emoji: '🔷', value: 100 },
      { emoji: '🔹', value: 10 }
    ];

    const qointEmojiTiers = [
      { emoji: '☀️', value: 10000 },
      { emoji: '🧀', value: 1000 },
      { emoji: '🔶', value: 100 },
      { emoji: '🔸', value: 10 }
    ];

    // Helper function to fill segments based on points and tiers
    const fillSegments = (points, tiers, remainingSegments) => {
      const emojiBar = [];
      let segmentCount = remainingSegments;

      for (const tier of tiers) {
        while (points >= tier.value && segmentCount > 0) {
          emojiBar.push(tier.emoji);
          points -= tier.value;
          segmentCount--;
        }
      }

      while (segmentCount > 0) {
        if (points > 0) {
          emojiBar.push('🔹');
          points -= 10;
        } else {
          emojiBar.push('▫️');
        }
        segmentCount--;
      }

      return emojiBar;
    };

    if (qoints && qoints > 0 && totalPossiblePoints > 0) {
      bar = bar.concat(fillSegments(qoints, qointEmojiTiers, 1));
      const regenPoints = totalPossiblePoints - spentPoints;
      bar = bar.concat(fillSegments(regenPoints, regeneratingEmojiTiers, segments - 1));
      if (spentPoints > 0) {
        bar[bar.length - 1] = '▫️';
      }
    } else if (!qoints || qoints <= 0) {
      const regenPoints = totalPossiblePoints - spentPoints;
      bar = fillSegments(regenPoints, regeneratingEmojiTiers, segments);
      if (spentPoints > 0) {
        bar[bar.length - 1] = '▫️';
      }
    } else if (totalPossiblePoints <= spentPoints && qoints && qoints > 0) {
      bar = fillSegments(qoints, qointEmojiTiers, segments);
      const lowestQointValue = qointEmojiTiers[qointEmojiTiers.length - 1].value;
      if (qoints < lowestQointValue * segments) {
        bar[bar.length - 1] = '▫️';
      }
    }

    while (bar.length > segments) {
      bar.pop();
    }

    return bar.join('');
  }
}

module.exports = AccountPointsService; 