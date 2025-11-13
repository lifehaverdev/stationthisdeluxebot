const { createLogger } = require('../../utils/logger');

const logger = createLogger('AdminActivityService');

/**
 * Service for emitting admin activity events via WebSocket
 * Provides real-time monitoring of platform activity
 */
class AdminActivityService {
  constructor({ webSocketService, logger: customLogger }) {
    this.webSocketService = webSocketService;
    this.logger = customLogger || logger;
    this.alertThresholds = {
      largeDeposit: 10000, // Points
      largeSpend: 5000, // Points
      rapidSpending: { points: 1000, windowMinutes: 5 }, // 1000 points in 5 minutes
    };
    this.recentSpends = new Map(); // userId -> [{ timestamp, points }, ...]
  }

  /**
   * Emit an admin activity event
   * @param {string} type - Event type (deposit, withdrawal, pointSpend, systemAlert, etc.)
   * @param {object} data - Event data
   */
  emitActivity(type, data) {
    if (!this.webSocketService) {
      this.logger.debug('[AdminActivityService] WebSocket service not available, skipping activity broadcast.');
      return;
    }

    const activity = {
      type: 'adminActivity',
      payload: {
        eventType: type,
        timestamp: new Date().toISOString(),
        ...data
      }
    };

    const sent = this.webSocketService.broadcastToAdmins(activity);
    if (sent) {
      this.logger.debug(`[AdminActivityService] Emitted ${type} activity to admins.`);
    }
  }

  /**
   * Emit a deposit event
   */
  emitDeposit({ masterAccountId, depositorAddress, tokenAddress, amount, points, txHash, chainId }) {
    this.emitActivity('deposit', {
      masterAccountId: masterAccountId?.toString(),
      depositorAddress,
      tokenAddress,
      amount: amount?.toString(),
      points: points?.toString(),
      txHash,
      chainId,
    });

    // Check for large deposit alert
    const pointsNum = Number(points || 0);
    if (pointsNum >= this.alertThresholds.largeDeposit) {
      this.emitActivity('alert', {
        severity: 'info',
        category: 'largeDeposit',
        message: `Large deposit detected: ${pointsNum.toLocaleString()} points`,
        masterAccountId: masterAccountId?.toString(),
        depositorAddress,
        points: pointsNum,
      });
    }
  }

  /**
   * Emit a withdrawal request event
   */
  emitWithdrawalRequest({ masterAccountId, depositorAddress, tokenAddress, amount, txHash, chainId }) {
    this.emitActivity('withdrawalRequest', {
      masterAccountId: masterAccountId?.toString(),
      depositorAddress,
      tokenAddress,
      amount: amount?.toString(),
      txHash,
      chainId,
    });
  }

  /**
   * Emit a withdrawal processed event
   */
  emitWithdrawalProcessed({ masterAccountId, depositorAddress, tokenAddress, amount, txHash, chainId }) {
    this.emitActivity('withdrawalProcessed', {
      masterAccountId: masterAccountId?.toString(),
      depositorAddress,
      tokenAddress,
      amount: amount?.toString(),
      txHash,
      chainId,
    });
  }

  /**
   * Emit a point spend event
   */
  emitPointSpend({ masterAccountId, points, serviceName, toolId, toolDisplayName, generationId, costUsd }) {
    const pointsNum = Number(points || 0);
    const userId = masterAccountId?.toString();

    this.emitActivity('pointSpend', {
      masterAccountId: userId,
      points: pointsNum,
      serviceName,
      toolId,
      toolDisplayName,
      generationId: generationId?.toString(),
      costUsd: costUsd ? Number(costUsd) : null,
    });

    // Track recent spends for rapid spending detection
    if (userId) {
      const now = Date.now();
      if (!this.recentSpends.has(userId)) {
        this.recentSpends.set(userId, []);
      }
      const userSpends = this.recentSpends.get(userId);
      userSpends.push({ timestamp: now, points: pointsNum });
      
      // Clean up old entries (older than window)
      const windowMs = this.alertThresholds.rapidSpending.windowMinutes * 60 * 1000;
      const recentSpends = userSpends.filter(s => now - s.timestamp < windowMs);
      this.recentSpends.set(userId, recentSpends);

      // Check for rapid spending
      const totalRecentPoints = recentSpends.reduce((sum, s) => sum + s.points, 0);
      if (totalRecentPoints >= this.alertThresholds.rapidSpending.points) {
        this.emitActivity('alert', {
          severity: 'warning',
          category: 'rapidSpending',
          message: `Rapid spending detected: ${totalRecentPoints.toLocaleString()} points in ${this.alertThresholds.rapidSpending.windowMinutes} minutes`,
          masterAccountId: userId,
          points: totalRecentPoints,
          windowMinutes: this.alertThresholds.rapidSpending.windowMinutes,
        });
      }
    }

    // Check for large spend alert
    if (pointsNum >= this.alertThresholds.largeSpend) {
      this.emitActivity('alert', {
        severity: 'info',
        category: 'largeSpend',
        message: `Large spend detected: ${pointsNum.toLocaleString()} points`,
        masterAccountId: userId,
        serviceName,
        toolId,
        points: pointsNum,
      });
    }
  }

  /**
   * Emit a system alert
   */
  emitSystemAlert({ severity, category, message, details }) {
    this.emitActivity('alert', {
      severity, // 'info', 'warning', 'error'
      category, // 'system', 'transaction', 'user', etc.
      message,
      details,
    });
  }

  /**
   * Emit a system error
   */
  emitSystemError({ error, context, details }) {
    this.emitActivity('alert', {
      severity: 'error',
      category: 'systemError',
      message: error.message || 'System error occurred',
      error: error.toString(),
      context,
      details,
    });
  }
}

module.exports = AdminActivityService;

