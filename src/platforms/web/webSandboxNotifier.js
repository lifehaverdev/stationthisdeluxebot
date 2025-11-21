// src/platforms/web/webSandboxNotifier.js

const ResponsePayloadNormalizer = require('../../core/services/notifications/ResponsePayloadNormalizer');

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
   * Convert costUsd from various formats to a number for frontend consumption
   * @param {any} costUsd - Cost value from database (Decimal128, number, string, or null)
   * @returns {number|null} - Converted number or null
   */
  _convertCostUsd(costUsd) {
    if (costUsd === null || costUsd === undefined) {
      return null;
    }

    // Handle Decimal128 objects (MongoDB BSON type)
    if (costUsd && typeof costUsd === 'object') {
      // Check for Decimal128 BSON type first
      if (costUsd._bsontype === 'Decimal128' && costUsd.toString) {
        try {
          return parseFloat(costUsd.toString());
        } catch (e) {
          this.logger.warn('[WebSandboxNotifier] Failed to convert Decimal128 costUsd:', e.message);
          return null;
        }
      }
      
      // Handle MongoDB $numberDecimal format
      if (costUsd.$numberDecimal) {
        try {
          return parseFloat(costUsd.$numberDecimal);
        } catch (e) {
          this.logger.warn('[WebSandboxNotifier] Failed to convert $numberDecimal costUsd:', e.message);
          return null;
        }
      }
      
      // Try toString() as fallback for other object types
      if (costUsd.toString && typeof costUsd.toString === 'function') {
        try {
          const str = costUsd.toString();
          // Only parse if it's not the default [object Object] string
          if (str !== '[object Object]') {
            const num = parseFloat(str);
            if (!isNaN(num)) {
              return num;
            }
          }
        } catch (e) {
          // Fall through to warning
        }
      }
    }

    // Handle string or number
    if (typeof costUsd === 'string' || typeof costUsd === 'number') {
      const num = parseFloat(costUsd);
      return isNaN(num) ? null : num;
    }

    this.logger.warn('[WebSandboxNotifier] Unknown costUsd format:', typeof costUsd, costUsd);
    return null;
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

      // Normalize responsePayload to ensure consistent format
      const normalizedPayload = ResponsePayloadNormalizer.normalize(
        generationRecord.responsePayload,
        { logger: this.logger }
      );
      
      // Convert to web-friendly format (maintains backward compatibility with frontend)
      const webOutputs = ResponsePayloadNormalizer.toWebFormat(normalizedPayload);

      // Build the payload expected by the client-side sandbox handlers
      const payload = {
        generationId: (generationRecord._id || generationRecord.id)?.toString(),
        runId: generationRecord.metadata?.run_id || null,
        status: generationRecord.status,
        outputs: webOutputs,
        toolId: generationRecord.toolId,
        spellId: generationRecord.spellId || generationRecord.metadata?.spellId || generationRecord.metadata?.spell?._id || null,
        castId: generationRecord.castId || generationRecord.metadata?.castId || null,
        cookId: generationRecord.cookId || generationRecord.metadata?.cookId || null,
        collectionId: generationRecord.collectionId || generationRecord.metadata?.collectionId || null,
        costUsd: this._convertCostUsd(generationRecord.costUsd),
        finalEventTimestamp: generationRecord.responseTimestamp || new Date().toISOString(),
      };

      this.logger.info('[WebSandboxNotifier] DEBUG payload', JSON.stringify(payload));
      this.logger.info(`[WebSandboxNotifier] Cost data - original: ${generationRecord.costUsd}, converted: ${payload.costUsd}`);

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
