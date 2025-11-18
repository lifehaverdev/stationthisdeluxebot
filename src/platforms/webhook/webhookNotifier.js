/**
 * WebhookNotifier
 * ---------------
 * Sends generation completion (and spell cast completion) notifications to external
 * webhook URLs via HTTP POST. The NotificationDispatcher delegates to this notifier
 * for records with `notificationPlatform === 'webhook'`.
 * 
 * Features:
 * - HTTP POST delivery with retry logic
 * - Exponential backoff on failures
 * - HMAC-SHA256 signature generation
 * - Standardized payload format
 */

const { validateWebhookUrl, signWebhook, convertCostUsd } = require('../../utils/webhookUtils');
const ResponsePayloadNormalizer = require('../../core/services/notifications/ResponsePayloadNormalizer');

// Retry delays in milliseconds: 1s, 5s, 30s
const RETRY_DELAYS = [1000, 5000, 30000];
const MAX_RETRY_ATTEMPTS = RETRY_DELAYS.length;
const REQUEST_TIMEOUT = 10000; // 10 seconds

class WebhookNotifier {
  /**
   * @param {object} logger - Logger instance
   * @param {object} internalApiClient - Internal API client for fetching cast records (optional)
   */
  constructor(logger = console, internalApiClient = null) {
    if (!logger) {
      throw new Error('[WebhookNotifier] logger is required.');
    }
    this.logger = logger;
    this.internalApiClient = internalApiClient;
    this.logger.info('[WebhookNotifier] Initialized.');
  }

  /**
   * Sleep utility for retry delays
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Sends HTTP POST request to webhook URL with retry logic
   * @param {string} url - Webhook URL
   * @param {object} payload - Payload to send
   * @param {number} attempt - Current attempt number (0-indexed)
   * @returns {Promise<{ success: boolean, statusCode?: number, error?: string }>}
   */
  async _sendWebhookRequest(url, payload, attempt = 0) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'StationThis-Webhook/1.0',
          ...(payload.signature && {
            'X-Webhook-Signature': `sha256=${payload.signature}`
          })
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        this.logger.info(`[WebhookNotifier] Successfully delivered webhook to ${url} (status: ${response.status})`);
        return { success: true, statusCode: response.status };
      }

      // Non-2xx response - retry if we have attempts left
      const errorText = await response.text().catch(() => 'Unable to read response body');
      const error = `Webhook returned ${response.status}: ${errorText.substring(0, 200)}`;
      
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        this.logger.warn(`[WebhookNotifier] Webhook delivery failed (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}): ${error}`);
        await this._sleep(RETRY_DELAYS[attempt]);
        return this._sendWebhookRequest(url, payload, attempt + 1);
      }

      throw new Error(error);

    } catch (error) {
      // Network error or timeout - retry if we have attempts left
      if (attempt < MAX_RETRY_ATTEMPTS - 1 && error.name !== 'AbortError') {
        this.logger.warn(`[WebhookNotifier] Webhook delivery failed (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}): ${error.message}`);
        await this._sleep(RETRY_DELAYS[attempt]);
        return this._sendWebhookRequest(url, payload, attempt + 1);
      }

      // Max attempts reached or abort error
      if (error.name === 'AbortError') {
        throw new Error(`Webhook request timeout after ${REQUEST_TIMEOUT}ms`);
      }
      throw error;
    }
  }

  /**
   * Builds webhook payload for tool execution completion
   * @param {object} generationRecord - Full generation document
   * @param {string} webhookSecret - Optional secret for signing
   * @returns {object} - Webhook payload
   */
  _buildToolExecutionPayload(generationRecord, webhookSecret = null) {
    // Normalize responsePayload to ensure consistent format
    const normalizedPayload = ResponsePayloadNormalizer.normalize(
      generationRecord.responsePayload,
      { logger: this.logger }
    );
    
    // Convert to web-friendly format
    const webOutputs = ResponsePayloadNormalizer.toWebFormat(normalizedPayload);

    const payload = {
      event: generationRecord.status === 'completed' ? 'generation.completed' : 'generation.failed',
      generationId: (generationRecord._id || generationRecord.id)?.toString(),
      toolId: generationRecord.toolId || null,
      status: generationRecord.status,
      outputs: webOutputs,
      costUsd: convertCostUsd(generationRecord.costUsd),
      timestamp: generationRecord.responseTimestamp || new Date().toISOString(),
    };

    // Add error details if failed
    if (generationRecord.status === 'failed') {
      payload.error = {
        code: generationRecord.metadata?.errorCode || 'GENERATION_FAILED',
        message: generationRecord.metadata?.errorMessage || generationRecord.responsePayload?.error || 'Generation failed'
      };
    }

    // Generate signature if secret provided
    if (webhookSecret) {
      payload.signature = signWebhook(payload, webhookSecret);
    }

    return payload;
  }

  /**
   * Builds webhook payload for spell cast completion
   * @param {object} castRecord - Cast record document
   * @param {object} generationRecord - Final generation record (optional)
   * @param {string} webhookSecret - Optional secret for signing
   * @returns {object} - Webhook payload
   */
  _buildSpellCastPayload(castRecord, generationRecord = null, webhookSecret = null) {
    const payload = {
      event: castRecord.status === 'completed' ? 'spell.completed' : 'spell.failed',
      castId: (castRecord._id || castRecord.id)?.toString(),
      spellId: (castRecord.spellId || castRecord.metadata?.spellId)?.toString() || null,
      spellSlug: castRecord.metadata?.spellSlug || null,
      status: castRecord.status,
      generationIds: (castRecord.stepGenerationIds || []).map(id => id.toString()),
      costUsd: castRecord.costUsd || null,
      startedAt: castRecord.startedAt || castRecord.metadata?.startedAt || null,
      completedAt: castRecord.completedAt || castRecord.metadata?.completedAt || null,
    };

    // Add final outputs if generation record provided
    if (generationRecord && generationRecord.responsePayload) {
      const normalizedPayload = ResponsePayloadNormalizer.normalize(
        generationRecord.responsePayload,
        { logger: this.logger }
      );
      payload.finalOutputs = ResponsePayloadNormalizer.toWebFormat(normalizedPayload);
    }

    // Add error details if failed
    if (castRecord.status === 'failed') {
      payload.error = {
        code: castRecord.metadata?.errorCode || 'SPELL_FAILED',
        message: castRecord.metadata?.failureReason || castRecord.metadata?.errorMessage || 'Spell execution failed'
      };
    }

    // Generate signature if secret provided
    if (webhookSecret) {
      payload.signature = signWebhook(payload, webhookSecret);
    }

    return payload;
  }

  /**
   * Dispatch a notification to the webhook URL specified in the generation record.
   * 
   * @param {object} notificationContext - Context object (not used for webhooks, webhook URL is in metadata)
   * @param {string} _messageContent - Human-readable fallback message (ignored)
   * @param {object} generationRecord - Full generation document
   */
  async sendNotification(notificationContext, _messageContent, generationRecord) {
    try {
      // Extract webhook URL from metadata
      const webhookUrl = generationRecord.metadata?.webhookUrl;
      if (!webhookUrl) {
        throw new Error('Webhook URL not found in generation record metadata.webhookUrl');
      }

      // Validate webhook URL
      const validation = validateWebhookUrl(webhookUrl, process.env.NODE_ENV !== 'production');
      if (!validation.valid) {
        throw new Error(`Invalid webhook URL: ${validation.error}`);
      }

      // Extract webhook secret (optional)
      const webhookSecret = generationRecord.metadata?.webhookSecret || null;

      // Determine if this is a spell cast completion or tool execution
      const isSpellCast = generationRecord.castId || generationRecord.metadata?.castId;
      
      let payload;
      if (isSpellCast && this.internalApiClient) {
        // This is a spell cast - fetch cast record and build spell payload
        try {
          const castId = generationRecord.castId || generationRecord.metadata?.castId;
          const castResponse = await this.internalApiClient.get(
            `/internal/v1/data/spells/casts/${castId}`,
            { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } }
          );
          const castRecord = castResponse.data;
          
          // Use the final generation record if this is the last step
          payload = this._buildSpellCastPayload(castRecord, generationRecord, webhookSecret);
        } catch (castError) {
          this.logger.warn(`[WebhookNotifier] Failed to fetch cast record for spell webhook: ${castError.message}`);
          // Fall back to tool execution payload format
          payload = this._buildToolExecutionPayload(generationRecord, webhookSecret);
        }
      } else {
        // This is a tool execution
        payload = this._buildToolExecutionPayload(generationRecord, webhookSecret);
      }

      // Send webhook with retry logic
      const result = await this._sendWebhookRequest(webhookUrl, payload);

      if (result.success) {
        this.logger.info(`[WebhookNotifier] Successfully delivered webhook for generationId: ${generationRecord._id}`);
      } else {
        throw new Error(`Webhook delivery failed: ${result.error}`);
      }

    } catch (err) {
      this.logger.error('[WebhookNotifier] Failed to send webhook notification:', err.message, err.stack);
      // Re-throw so NotificationDispatcher can mark delivery failure & retry logic
      throw err;
    }
  }
}

module.exports = WebhookNotifier;

