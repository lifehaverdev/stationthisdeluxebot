const DEFAULT_POLLING_INTERVAL_MS = 10000; // 10 seconds
const MAX_DELIVERY_ATTEMPTS = 3;

class NotificationDispatcher {
  constructor(services, options = {}) {
    if (!services || !services.internalApiClient) {
      throw new Error('[NotificationDispatcher] Critical: services.internalApiClient is required.');
    }
    if (!services.logger) {
        throw new Error('[NotificationDispatcher] Critical: services.logger is required.');
    }
    
    this.internalApiClient = services.internalApiClient;
    this.logger = services.logger;
    this.platformNotifiers = services.platformNotifiers || {};
    
    this.pollingIntervalMs = options.pollingIntervalMs || DEFAULT_POLLING_INTERVAL_MS;
    this.isPolling = false;
    this.pollTimer = null;

    this.logger.info(`[NotificationDispatcher] Initialized. Polling interval: ${this.pollingIntervalMs / 1000}s. Using internalApiClient for DB operations.`);
  }

  async start() {
    if (this.isPolling) {
      this.logger.warn('[NotificationDispatcher] start() called but already polling.');
      return;
    }
    this.logger.info('[NotificationDispatcher] Starting polling for pending notifications...');
    this.isPolling = true;
    
    await this._processPendingNotifications(); 
    
    this.pollTimer = setInterval(async () => {
      await this._processPendingNotifications();
    }, this.pollingIntervalMs);
  }

  async stop() {
    if (!this.isPolling) {
      this.logger.warn('[NotificationDispatcher] stop() called but not currently polling.');
      return;
    }
    this.logger.info('[NotificationDispatcher] Stopping polling.');
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;
  }

  async _processPendingNotifications() {
    if (!this.isPolling && this.pollTimer) { 
        this.logger.info('[NotificationDispatcher] Polling is disabled, skipping _processPendingNotifications cycle.');
        return;
    }
    this.logger.debug('[NotificationDispatcher] Checking for pending notifications via internalApiClient...');
    try {
      const params = new URLSearchParams();
      params.append('deliveryStatus', 'pending');
      params.append('status_in', 'completed'); 
      params.append('status_in', 'failed'); 
      params.append('notificationPlatform_ne', 'none');

      const queryString = params.toString();
      this.logger.debug(`[NotificationDispatcher] Querying internal API: /v1/data/generations?${queryString}`);
      
      const requestOptions = {
        headers: {
          'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB 
        }
      };
      if (!process.env.INTERNAL_API_KEY_WEB) {
        this.logger.warn(`[NotificationDispatcher] INTERNAL_API_KEY_WEB (used as system key) is not set. Internal API calls may fail authentication.`);
      }

      const response = await this.internalApiClient.get(`/v1/data/generations?${queryString}`, requestOptions);

      let pendingRecords = [];
      if (response && response.data && Array.isArray(response.data.generations)) {
        pendingRecords = response.data.generations.filter(record => 
          (record.status === 'completed' || record.status === 'failed') && 
          record.status !== 'payment_failed' &&
          record.notificationPlatform !== 'none'
        );
      } else if (response && response.data && Array.isArray(response.data)) {
        pendingRecords = response.data.filter(record => 
          record.deliveryStatus === 'pending' &&
          (record.status === 'completed' || record.status === 'failed') && 
          record.status !== 'payment_failed' &&
          record.notificationPlatform !== 'none'
        );
      } else {
        this.logger.warn('[NotificationDispatcher] Received unexpected response structure from GET /v1/data/generations. Expected an array of generations.', response.data);
      }

      if (pendingRecords.length > 0) {
        this.logger.info(`[NotificationDispatcher] Found ${pendingRecords.length} pending notifications to process after filtering.`);
        for (const record of pendingRecords) {
          const recordId = record._id || record.id;
          if (!recordId) {
            this.logger.warn('[NotificationDispatcher] Skipping record due to missing ID:', record);
            continue;
          }
          await this._dispatchNotification({ ...record, _id: recordId });
        }
      } else {
        this.logger.debug('[NotificationDispatcher] No pending notifications found in this cycle after filtering.');
      }
    } catch (error) {
      this.logger.error('[NotificationDispatcher] Error fetching pending notifications via internalApiClient:', error.response ? error.response.data : error.message, error.stack);
    }
  }

  async _dispatchNotification(record) {
    const recordId = record._id;
    this.logger.info(`[NotificationDispatcher] Attempting to dispatch notification for generationId: ${recordId}, platform: ${record.notificationPlatform}`);

    const notifier = this.platformNotifiers[record.notificationPlatform];
    if (!notifier || typeof notifier.sendNotification !== 'function') {
      this.logger.warn(`[NotificationDispatcher] No notifier found or 'sendNotification' method missing for platform: '${record.notificationPlatform}' for generationId: ${recordId}. Setting deliveryStatus to 'skipped'.`);
      try {
        const updateSkippedOptions = { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } };
        await this.internalApiClient.put(`/v1/data/generations/${recordId}`, { 
          deliveryStatus: 'skipped', 
          deliveryError: `No notifier for platform ${record.notificationPlatform}` 
        }, updateSkippedOptions);
      } catch (updateError) {
        this.logger.error(`[NotificationDispatcher] Failed to update generation ${recordId} to 'skipped' status:`, updateError.message);
      }
      return;
    }

    try {
      let messageContent;
      if (record.status === 'completed') {
        const imageUrl = record.responsePayload?.[0]?.data?.images?.[0]?.url || 'Output details processing.';
        messageContent = `Your job for workflow '${record.serviceName}' (ID: ${recordId}) completed successfully! Image URL: ${imageUrl}`;
      } else { 
        const reason = record.statusReason || 'Unknown error';
        messageContent = `Your job for workflow '${record.serviceName}' (ID: ${recordId}) failed. Reason: ${reason}`;
      }

      if (!record.metadata || !record.metadata.notificationContext) {
          throw new Error('Missing metadata.notificationContext in generationRecord.');
      }

      await notifier.sendNotification(record.metadata.notificationContext, messageContent, record);
      
      this.logger.info(`[NotificationDispatcher] Successfully sent notification for generationId: ${recordId} via ${record.notificationPlatform}.`);
      const updateSentOptions = { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } };
      await this.internalApiClient.put(`/v1/data/generations/${recordId}`, {
        deliveryStatus: 'sent',
        deliveryTimestamp: new Date(),
        deliveryAttempts: (record.deliveryAttempts || 0) + 1
      }, updateSentOptions);

    } catch (dispatchError) {
      const attempts = (record.deliveryAttempts || 0) + 1;
      this.logger.error(`[NotificationDispatcher] Error sending notification for generationId: ${recordId} via ${record.notificationPlatform} (Attempt ${attempts}):`, dispatchError.message, dispatchError.stack);
      
      const updatePayload = {
        deliveryAttempts: attempts,
        deliveryError: dispatchError.message
      };

      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        this.logger.warn(`[NotificationDispatcher] Max delivery attempts (${MAX_DELIVERY_ATTEMPTS}) reached for generationId: ${recordId}. Setting status to 'failed'.`);
        updatePayload.deliveryStatus = 'failed';
      }
      try {
        const requestOptions = {
          headers: {
            'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB 
          }
        };
        await this.internalApiClient.put(`/v1/data/generations/${recordId}`, updatePayload, requestOptions);
      } catch (updateError) {
        this.logger.error(`[NotificationDispatcher] Failed to update generation ${recordId} after dispatch error:`, updateError.message);
      }
    }
  }
}

module.exports = NotificationDispatcher; 