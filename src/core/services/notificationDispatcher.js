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
    if (!services.workflowExecutionService) {
      this.logger.warn('[NotificationDispatcher] workflowExecutionService is not provided. Spell execution will not work.');
    }
    
    this.internalApiClient = services.internalApiClient;
    this.logger = services.logger;
    this.platformNotifiers = services.platformNotifiers || {};
    this.workflowExecutionService = services.workflowExecutionService;
    
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
      // Fetch records for normal notification dispatch
      params.append('deliveryStatus', 'pending');
      params.append('status_in', 'completed'); 
      params.append('status_in', 'failed'); 
      params.append('notificationPlatform_ne', 'none');
      params.append('deliveryStrategy_ne', 'spell_step'); // Exclude spell steps from regular dispatch

      // Also fetch records for spell step continuation
      const spellParams = new URLSearchParams();
      spellParams.append('deliveryStrategy', 'spell_step');
      spellParams.append('status', 'completed');
      spellParams.append('deliveryStatus', 'pending'); // Process only once

      const queryString = params.toString();
      const spellQueryString = spellParams.toString();
      this.logger.debug(`[NotificationDispatcher] Querying for notifications: /v1/data/generations?${queryString}`);
      this.logger.debug(`[NotificationDispatcher] Querying for spell steps: /v1/data/generations?${spellQueryString}`);
      
      const requestOptions = {
        headers: {
          'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB 
        }
      };
      if (!process.env.INTERNAL_API_KEY_WEB) {
        this.logger.warn(`[NotificationDispatcher] INTERNAL_API_KEY_WEB (used as system key) is not set. Internal API calls may fail authentication.`);
      }

      const [notificationResponse, spellStepResponse] = await Promise.all([
        this.internalApiClient.get(`/v1/data/generations?${queryString}`, requestOptions),
        this.internalApiClient.get(`/v1/data/generations?${spellQueryString}`, requestOptions)
      ]);

      const pendingNotifications = notificationResponse.data?.generations || notificationResponse.data || [];
      const pendingSpellSteps = spellStepResponse.data?.generations || spellStepResponse.data || [];
      const processedSpellStepIds = new Set();

      if (pendingSpellSteps.length > 0) {
          this.logger.info(`[NotificationDispatcher] Found ${pendingSpellSteps.length} completed spell steps to process.`);
          for (const record of pendingSpellSteps) {
              await this._handleSpellStep(record);
              processedSpellStepIds.add(record._id.toString());
          }
      }

      if (pendingNotifications.length > 0) {
        this.logger.info(`[NotificationDispatcher] Found ${pendingNotifications.length} pending notifications to process.`);
        for (const record of pendingNotifications) {
          const recordId = record._id || record.id;
          if (!recordId) {
            this.logger.warn('[NotificationDispatcher] Skipping notification record due to missing ID:', record);
            continue;
          }
          if (processedSpellStepIds.has(recordId.toString())) {
            this.logger.info(`[NotificationDispatcher] Skipping record ${recordId} because it was already handled as a spell step.`);
            continue;
          }
          await this._dispatchNotification({ ...record, _id: recordId });
        }
      } else {
        if(pendingSpellSteps.length === 0) this.logger.debug('[NotificationDispatcher] No pending notifications or spell steps found in this cycle.');
      }
    } catch (error) {
      this.logger.error(`[NotificationDispatcher] Error fetching pending records via internalApiClient:`, error.response ? error.response.data : error.message, error.stack);
    }
  }

  async _handleSpellStep(record) {
    const recordId = record._id;
    this.logger.info(`[NotificationDispatcher] Handling completed spell step for generationId: ${recordId}`);

    // Defensive check for required metadata to prevent crashes on malformed records
    if (!record.metadata || !record.metadata.spell || typeof record.metadata.stepIndex === 'undefined') {
      this.logger.error(`[NotificationDispatcher] Cannot process spell step for GenID ${recordId}: record is missing required spell metadata.`);
      const updateOptions = { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } };
      await this.internalApiClient.put(`/v1/data/generations/${recordId}`, {
        deliveryStatus: 'failed',
        deliveryError: 'Malformed spell step record, missing required metadata.'
      }, updateOptions);
      return;
    }

    if (!this.workflowExecutionService) {
        this.logger.error(`[NotificationDispatcher] Cannot process spell step for GenID ${recordId}: workflowExecutionService is not available.`);
        return;
    }
    try {
        await this.workflowExecutionService.continueExecution(record);
        
        // Mark this step's generation record as complete so it isn't picked up again.
        const updateOptions = { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } };
        await this.internalApiClient.put(`/v1/data/generations/${recordId}`, {
          deliveryStatus: 'complete', // 'complete' signifies it's been handled by the spell engine
          deliveryTimestamp: new Date(),
        }, updateOptions);

        this.logger.info(`[NotificationDispatcher] Successfully processed spell step for GenID ${recordId}.`);
    } catch (error) {
        this.logger.error(`[NotificationDispatcher] Error processing spell step for GenID ${recordId}:`, error.message, error.stack);
        // Optionally, update the record to reflect the failure
        const updateOptions = { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } };
        await this.internalApiClient.put(`/v1/data/generations/${recordId}`, {
          deliveryStatus: 'failed',
          deliveryError: `Spell continuation failed: ${error.message}`
        }, updateOptions);
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
        messageContent = `Your '${record.metadata?.displayName || record.serviceName}' job (ID: ${recordId}) completed successfully!`;
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