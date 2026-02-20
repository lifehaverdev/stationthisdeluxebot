/**
 * DepositNotificationService
 * 
 * Handles WebSocket notifications for deposit updates and transaction status.
 * Provides real-time updates to users about their deposit transactions.
 */
class DepositNotificationService {
  constructor(webSocketService, logger) {
    this.webSocketService = webSocketService;
    this.logger = logger || console;
  }

  /**
   * Sends a WebSocket notification for deposit status updates.
   * @param {string} masterAccountId - The user's master account ID
   * @param {string} status - Deposit status (e.g., 'pending', 'confirmed', 'failed')
   * @param {object} payload - Additional payload data
   */
  notifyDepositUpdate(masterAccountId, status, payload = {}) {
    if (!this.webSocketService) {
      this.logger.warn('[DepositNotificationService] WebSocket service not available, skipping notification');
      return false;
    }

    const sent = this.webSocketService.sendToUser(masterAccountId, {
      type: 'pointsDepositUpdate',
      payload: { status, ...payload }
    });

    if (sent) {
      this.logger.debug(`[DepositNotificationService] Sent pointsDepositUpdate (${status}) to user ${masterAccountId}`);
    } else {
      this.logger.warn(`[DepositNotificationService] Failed to send pointsDepositUpdate (${status}) to user ${masterAccountId} - user may be offline`);
      // TODO: Consider storing notification in database for later delivery
    }

    return sent;
  }

  /**
   * Sends a WebSocket notification for transaction status updates.
   * Provides real-time updates on transaction lifecycle: submitted, pending, confirming, confirmed, failed.
   * @param {string} masterAccountId - The user's master account ID
   * @param {string} txHash - The transaction hash
   * @param {string} status - Transaction status: 'submitted', 'pending', 'confirming', 'confirmed', 'failed'
   * @param {object} payload - Additional payload data (receipt, error, etc.)
   */
  notifyTransactionStatus(masterAccountId, txHash, status, payload = {}) {
    if (!this.webSocketService) {
      this.logger.warn('[DepositNotificationService] WebSocket service not available, skipping notification');
      return false;
    }

    const sent = this.webSocketService.sendToUser(masterAccountId, {
      type: 'transactionStatusUpdate',
      payload: {
        txHash,
        status,
        timestamp: new Date().toISOString(),
        ...payload
      }
    });

    if (sent) {
      this.logger.debug(`[DepositNotificationService] Sent transactionStatusUpdate (${status}) for tx ${txHash} to user ${masterAccountId}`);
    } else {
      this.logger.warn(`[DepositNotificationService] Failed to send transactionStatusUpdate (${status}) for tx ${txHash} to user ${masterAccountId}`);
    }

    return sent;
  }
}

module.exports = DepositNotificationService;

