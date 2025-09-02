// src/platforms/web/webSandboxNotifier.js

/**
 * WebSandboxNotifier
 * ------------------
 * Sends generation completion (and other) notifications to the in-browser
 * sandbox via the server-side WebSocketService. The NotificationDispatcher
 * delegates to this notifier for records with `notificationPlatform ===
 * 'web-sandbox'`.
 */

class WebSandboxNotifier {
  /**
   * @param {object} websocketService - The singleton WebSocketService instance.
   * @param {object} logger - Logger instance.
   */
  constructor(websocketService, logger = console) {
    if (!websocketService) {
      throw new Error('[WebSandboxNotifier] websocketService is required.');
    }
    this.websocketService = websocketService;
    this.logger = logger;
    this.logger.info('[WebSandboxNotifier] Initialized.');
  }

  /**
   * Dispatch a notification to all active web-sandbox connections for the user.
   * The payload structure mirrors the messages produced by webhookProcessor so
   * that the existing front-end handlers (generationProgress / generationUpdate)
   * can process them without modification.
   *
   * @param {object} notificationContext - Context object stored on the generation record.
   * @param {string} _messageContent - Human-readable fallback message (ignored).
   * @param {object} generationRecord - Full generation document.
   */
  async sendNotification(notificationContext, _messageContent, generationRecord) {
    try {
      const masterAccountId = generationRecord.masterAccountId?.toString();
      if (!masterAccountId) {
        this.logger.warn('[WebSandboxNotifier] masterAccountId missing on generationRecord. Cannot deliver.');
        return;
      }

      // Build the payload expected by the client-side sandbox handlers
      const payload = {
        generationId: (generationRecord._id || generationRecord.id)?.toString(),
        runId: generationRecord.metadata?.run_id || null,
        status: generationRecord.status,
        outputs: generationRecord.responsePayload,
        toolId: generationRecord.toolId,
        spellId: generationRecord.spellId || generationRecord.metadata?.spellId || generationRecord.metadata?.spell?._id || null,
        castId: generationRecord.castId || generationRecord.metadata?.castId || null,
        cookId: generationRecord.cookId || generationRecord.metadata?.cookId || null,
        costUsd: generationRecord.costUsd ?? null,
        finalEventTimestamp: generationRecord.responseTimestamp || new Date().toISOString(),
      };

      this.logger.info('[WebSandboxNotifier] DEBUG payload', JSON.stringify(payload));

      const sent = this.websocketService.sendToUser(masterAccountId, {
        type: 'generationUpdate',
        payload,
      });

      if (sent) {
        this.logger.info(`[WebSandboxNotifier] Delivered generationUpdate to user ${masterAccountId}. GenID: ${payload.generationId}`);
      } else {
        this.logger.warn(`[WebSandboxNotifier] No active WS connections for user ${masterAccountId}. Notification not delivered.`);
      }
    } catch (err) {
      this.logger.error('[WebSandboxNotifier] Failed to send notification:', err.message, err.stack);
      // Re-throw so NotificationDispatcher can mark delivery failure & retry logic.
      throw err;
    }
  }
}

module.exports = WebSandboxNotifier; 