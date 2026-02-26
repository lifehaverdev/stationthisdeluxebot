const notificationEvents = require('../events/notificationEvents');
const MAX_DELIVERY_ATTEMPTS = 3;

// Ensure cook orchestrator can continue after internal 'cook' notifications
const CookOrchestratorService = require('./cook/CookOrchestratorService');

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
    this.workflowExecutionService = services.workflowExecutionService;
    this.spellService = services.spellService || null;
    this.generationOutputsDb = services.generationOutputsDb || null; // Phase 7h: in-process generation record access
    
    if (!this.workflowExecutionService) {
      this.logger.warn('[NotificationDispatcher] workflowExecutionService is not provided. Spell execution will not work.');
    }
    
    this.isListening = false;
    this.boundProcessRecord = this._processRecord.bind(this); // Bind once for adding/removing listener

    this.logger.debug(`[NotificationDispatcher] Initialized. Ready to listen for events.`);
  }

  start() {
    if (this.isListening) {
      this.logger.warn('[NotificationDispatcher] start() called but already listening.');
      return;
    }
    this.logger.info('[NotificationDispatcher] Starting to listen for generation update events...');
    notificationEvents.on('generationUpdated', this.boundProcessRecord);
    this.isListening = true;
  }

  stop() {
    if (!this.isListening) {
      this.logger.warn('[NotificationDispatcher] stop() called but not currently listening.');
      return;
    }
    this.logger.info('[NotificationDispatcher] Stopping event listener.');
    notificationEvents.removeListener('generationUpdated', this.boundProcessRecord);
    this.isListening = false;
  }

  async _processRecord(record) {
    this.logger.debug(`[NotificationDispatcher] Received event for record: ${record._id || record.id}`);
    
    const recordId = record._id || record.id;
    if (!recordId) {
      this.logger.warn('[NotificationDispatcher] Skipping record from event due to missing ID:', record);
      return;
    }

    if (record.deliveryStrategy === 'spell_step') {
      await this._handleSpellStep(record);
    } else if (record.deliveryStrategy === 'spell_final') {
      // Final spell completion - send notification but don't continue execution
      await this._dispatchNotification({ ...record, _id: recordId });
    } else {
      // The record passed in should already be complete
      await this._dispatchNotification({ ...record, _id: recordId });
    }
  }

  /*
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
      this.logger.debug(`[NotificationDispatcher] Querying for all processable jobs: /v1/data/generations?${queryString}`);

      const requestOptions = {
        headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB }
      };
      if (!process.env.INTERNAL_API_KEY_WEB) {
        this.logger.warn(`[NotificationDispatcher] INTERNAL_API_KEY_WEB is not set. Internal API calls may fail.`);
      }

      const response = await this.internalApiClient.get(`/v1/data/generations?${queryString}`, requestOptions);
      const pendingJobs = response.data?.generations || response.data || [];

      if (pendingJobs.length > 0) {
        this.logger.info(`[NotificationDispatcher] Found ${pendingJobs.length} total pending job(s) to process.`);
        for (const record of pendingJobs) {
          const recordId = record._id || record.id;
          if (!recordId) {
            this.logger.warn('[NotificationDispatcher] Skipping record due to missing ID:', record);
            continue;
          }

          if (record.deliveryStrategy === 'spell_step') {
            await this._handleSpellStep(record);
          } else {
            await this._dispatchNotification({ ...record, _id: recordId });
          }
        }
      } else {
        this.logger.debug('[NotificationDispatcher] No pending jobs found in this cycle.');
      }
    } catch (error) {
      this.logger.error(`[NotificationDispatcher] Error fetching pending records via internalApiClient:`, error.response ? error.response.data : error.message, error.stack);
    }
  }
  */

  async _handleSpellStep(record) {
    const recordId = record._id;
    this.logger.debug(`[NotificationDispatcher] Handling completed spell step for generationId: ${recordId}`);

    // CRITICAL: Idempotency check - skip if already processed
    if (record.deliveryStatus === 'sent' || record.deliveryStatus === 'failed' || record.deliveryStatus === 'processing') {
      this.logger.info(`[NotificationDispatcher] Skipping already processed spell step for GenID ${recordId} (deliveryStatus: ${record.deliveryStatus})`);
      return;
    }

    // Defensive check for required metadata to prevent crashes on malformed records
    if (!record.metadata || !record.metadata.spell || typeof record.metadata.stepIndex === 'undefined') {
      this.logger.error(`[NotificationDispatcher] Cannot process spell step for GenID ${recordId}: record is missing required spell metadata.`);
      // Phase 7h: in-process update replacing HTTP PUT /generations/:id
      if (this.generationOutputsDb) {
        await this.generationOutputsDb.updateGenerationOutput(recordId, { deliveryStatus: 'failed', deliveryError: 'Malformed spell step record, missing required metadata.' });
      } else {
        const updateOptions = { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } };
        await this.internalApiClient.put(`/internal/v1/data/generations/${recordId}`, { deliveryStatus: 'failed', deliveryError: 'Malformed spell step record, missing required metadata.' }, updateOptions);
      }
      return;
    }

    if (!this.workflowExecutionService) {
        this.logger.error(`[NotificationDispatcher] Cannot process spell step for GenID ${recordId}: workflowExecutionService is not available.`);
        return;
    }
    
    // CRITICAL: Atomically check and set deliveryStatus to 'processing' to prevent race conditions
    // Fetch current record first to check status, then update only if still 'pending'
    const updateOptions = { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } };
    let currentRecord = null; // Hoisted to function scope so it's accessible in the second try block
    try {
      // Phase 7h: in-process fetch replacing HTTP GET /generations/:id
      if (this.generationOutputsDb) {
        currentRecord = await this.generationOutputsDb.findGenerationById(recordId);
      } else {
        const currentRecordResponse = await this.internalApiClient.get(`/internal/v1/data/generations/${recordId}`, updateOptions);
        currentRecord = currentRecordResponse.data;
      }
      const currentStatus = currentRecord?.deliveryStatus;

      // If already processing or sent, skip (another handler is processing this)
      if (currentStatus === 'processing' || currentStatus === 'sent' || currentStatus === 'failed') {
        this.logger.info(`[NotificationDispatcher] Skipping generation ${recordId} - already ${currentStatus}`);
        return;
      }

      // Only update if status is 'pending' (or null/undefined)
      if (currentStatus !== 'pending' && currentStatus !== null && currentStatus !== undefined) {
        this.logger.warn(`[NotificationDispatcher] Unexpected deliveryStatus '${currentStatus}' for generation ${recordId}, skipping`);
        return;
      }

      // Phase 7h: in-process update replacing HTTP PUT /generations/:id
      if (this.generationOutputsDb) {
        await this.generationOutputsDb.updateGenerationOutput(recordId, { deliveryStatus: 'processing' });
      } else {
        await this.internalApiClient.put(`/internal/v1/data/generations/${recordId}`, { deliveryStatus: 'processing' }, updateOptions);
      }
    } catch (markErr) {
      this.logger.error(`[NotificationDispatcher] Failed to atomically mark generation ${recordId} as processing:`, markErr.message);
      // If the GET fails, the record might not exist - skip processing
      if (markErr.response?.status === 404) {
        this.logger.warn(`[NotificationDispatcher] Generation ${recordId} not found, skipping`);
        return;
      }
      // For other errors, skip to avoid duplicate processing
      return;
    }
    
    try {
        // Send websocket update to frontend for web-sandbox platform BEFORE continuing execution
        // This ensures the UI updates to show the step as completed instead of "calculating"
        if (record.notificationPlatform === 'web-sandbox') {
          const webSandboxNotifier = this.platformNotifiers['web-sandbox'];
          if (webSandboxNotifier && typeof webSandboxNotifier.sendNotification === 'function') {
            try {
              // Create a notification context for the websocket update
              const fullRecord = currentRecord || record;
              const notificationContext = fullRecord.metadata?.notificationContext || {
                type: 'spell_step_completion',
                spellId: fullRecord.metadata?.spell?._id || fullRecord.metadata?.spellId,
                stepIndex: fullRecord.metadata?.stepIndex,
                platform: 'web-sandbox'
              };

              // Send websocket update for this completed step
              await webSandboxNotifier.sendNotification(notificationContext, '', fullRecord);
              this.logger.debug(`[NotificationDispatcher] Sent websocket update for spell step GenID ${recordId} to web-sandbox.`);
            } catch (wsErr) {
              // Log but don't fail - continuation should still proceed
              this.logger.warn(`[NotificationDispatcher] Failed to send websocket update for spell step GenID ${recordId}: ${wsErr.message}`);
            }
          }
        }
        
        // Use the full record fetched from DB (currentRecord) instead of event record
        // The event record may not have all fields like responsePayload
        await this.workflowExecutionService.continueExecution(currentRecord || record);
        
        // Mark this step's generation record as complete so it isn't picked up again.
        // Phase 7h: in-process update replacing HTTP PUT /generations/:id
        if (this.generationOutputsDb) {
          await this.generationOutputsDb.updateGenerationOutput(recordId, { deliveryStatus: 'sent', deliveryTimestamp: new Date() });
        } else {
          await this.internalApiClient.put(`/internal/v1/data/generations/${recordId}`, { deliveryStatus: 'sent', deliveryTimestamp: new Date() }, updateOptions);
        }

        this.logger.info(`[NotificationDispatcher] Successfully processed spell step for GenID ${recordId}.`);
    } catch (error) {
        this.logger.error(`[NotificationDispatcher] Error processing spell step for GenID ${recordId}:`, error.message, error.stack);
        
        // Update the record to reflect the failure
        const updateOptions = { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } };
        try {
          // Phase 7h: in-process update replacing HTTP PUT /generations/:id
          if (this.generationOutputsDb) {
            await this.generationOutputsDb.updateGenerationOutput(recordId, { deliveryStatus: 'failed', deliveryError: `Spell continuation failed: ${error.message}` });
          } else {
            await this.internalApiClient.put(`/internal/v1/data/generations/${recordId}`, { deliveryStatus: 'failed', deliveryError: `Spell continuation failed: ${error.message}` }, updateOptions);
          }
        } catch (updateErr) {
          this.logger.error(`[NotificationDispatcher] Failed to update generation ${recordId} deliveryStatus:`, updateErr.message);
        }
        
        // Update cast status to failed if we have castId
        if (record.metadata?.castId) {
          try {
            if (this.spellService) {
              await this.spellService.updateCast(record.metadata.castId, {
                status: 'failed',
                failureReason: `Spell continuation failed: ${error.message}`,
                failedAt: new Date(),
              });
            } else {
              await this.internalApiClient.put(`/internal/v1/data/spells/casts/${record.metadata.castId}`, {
                status: 'failed',
                failureReason: `Spell continuation failed: ${error.message}`,
                failedAt: new Date()
              }, updateOptions);
            }
            this.logger.info(`[NotificationDispatcher] Updated cast ${record.metadata.castId} status to 'failed' due to continuation error`);
          } catch (castUpdateErr) {
            this.logger.error(`[NotificationDispatcher] Failed to update cast ${record.metadata.castId} status to failed:`, castUpdateErr.message);
          }
        }
    }
  }

  async _dispatchNotification(record) {
    const recordId = record._id;
    this.logger.debug(`[NotificationDispatcher] Attempting to dispatch notification for generationId: ${recordId}, platform: ${record.notificationPlatform}`);

    const notifier = this.platformNotifiers[record.notificationPlatform];
    if (!notifier || typeof notifier.sendNotification !== 'function') {
      this.logger.warn(`[NotificationDispatcher] No notifier found or 'sendNotification' method missing for platform: '${record.notificationPlatform}' for generationId: ${recordId}. Setting deliveryStatus to 'dropped'.`);
      // Even though no external notification is sent, if this was a cook piece we must advance the cook.
      try {
        await this._maybeAdvanceCook(record);
      } catch (advErr) {
        this.logger.error(`[NotificationDispatcher] Cook advance failed for gen ${recordId}:`, advErr.message);
      }
      return;
    }

    try {
      let messageContent;
      if (record.status === 'completed') {
        // ✅ Success – keep it concise. No internal IDs exposed.
        const displayName = record.metadata?.displayName || record.serviceName || 'Task';
        messageContent = `✅ ${displayName} completed successfully!`;
      } else {
        // ❌ Failure – bubble up service-provided reason when present; otherwise generic.
        const reason = record.statusReason?.trim();
        if (reason) {
          messageContent = `❌ ${reason}`;
        } else {
          messageContent = '❌ Sorry, something went wrong.';
        }
      }
      
      // Webhook notifier doesn't need notificationContext - it reads webhookUrl from metadata
      // Other platforms require notificationContext
      if (record.notificationPlatform !== 'webhook') {
        if (!record.metadata || !record.metadata.notificationContext) {
            throw new Error('Missing metadata.notificationContext in generationRecord.');
        }
      }

      await notifier.sendNotification(record.metadata?.notificationContext || {}, messageContent, record);
      
      this.logger.info(`[NotificationDispatcher] Successfully sent notification for generationId: ${recordId} via ${record.notificationPlatform}.`);
      // Phase 7h: in-process update replacing HTTP PUT /generations/:id
      if (this.generationOutputsDb) {
        await this.generationOutputsDb.updateGenerationOutput(recordId, { deliveryStatus: 'sent', deliveryTimestamp: new Date(), deliveryAttempts: (record.deliveryAttempts || 0) + 1 });
      } else {
        const updateSentOptions = { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } };
        await this.internalApiClient.put(`/internal/v1/data/generations/${recordId}`, { deliveryStatus: 'sent', deliveryTimestamp: new Date(), deliveryAttempts: (record.deliveryAttempts || 0) + 1 }, updateSentOptions);
      }

    } catch (dispatchError) {
      const attempts = (record.deliveryAttempts || 0) + 1;
      this.logger.error(`[NotificationDispatcher] Error sending notification for generationId: ${recordId} via ${record.notificationPlatform} (Attempt ${attempts}):`, dispatchError.message, dispatchError.stack);
      
      const updatePayload = {
        deliveryAttempts: attempts,
        deliveryError: dispatchError.message
      };

      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        this.logger.warn(`[NotificationDispatcher] Max delivery attempts (${MAX_DELIVERY_ATTEMPTS}) reached for generationId: ${recordId}. Setting status to 'dropped'.`);
        updatePayload.deliveryStatus = 'dropped';
      }
      try {
        // Phase 7h: in-process update replacing HTTP PUT /generations/:id
        if (this.generationOutputsDb) {
          await this.generationOutputsDb.updateGenerationOutput(recordId, updatePayload);
        } else {
          const requestOptions = { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } };
          await this.internalApiClient.put(`/internal/v1/data/generations/${recordId}`, updatePayload, requestOptions);
        }
      } catch (updateError) {
        this.logger.error(`[NotificationDispatcher] Failed to update generation ${recordId} after dispatch error:`, updateError.message);
      }
      // Regardless of notification failure, attempt to progress cook flow.
      try {
        await this._maybeAdvanceCook(record);
      } catch (advErr) {
        this.logger.error(`[NotificationDispatcher] Cook advance failed for gen ${recordId}:`, advErr.message);
      }
      return;
    }

    // Success path – after notification sent, advance cook if applicable
    try {
      await this._maybeAdvanceCook(record);
    } catch (advErr) {
      this.logger.error(`[NotificationDispatcher] Cook advance failed for gen ${recordId}:`, advErr.message);
    }
  }

  /**
   * If the generation belongs to a cook (notificationPlatform==='cook'), append event and schedule next piece.
   */
  async _maybeAdvanceCook(record) {
    // ✅ Log for debugging cook detection
    if (record.notificationPlatform !== 'cook') {
      // Only log if metadata suggests it might be a cook generation
      const meta = record.metadata || {};
      if (meta.collectionId || meta.cookId || meta.jobId || meta.source === 'cook') {
        this.logger.debug(`[NotificationDispatcher] Skipping cook advance - notificationPlatform is '${record.notificationPlatform}', not 'cook'. GenId: ${record._id}, metadata: ${JSON.stringify({ collectionId: meta.collectionId, cookId: meta.cookId, jobId: meta.jobId, source: meta.source })}`);
      }
      return;
    }
    const meta = record.metadata || {};
    const { collectionId, cookId, jobId } = meta;
    const userId = String(record.masterAccountId || '') || null;
    if (!collectionId || !userId || !jobId) {
      this.logger.warn(`[NotificationDispatcher] Cook generation missing required fields. GenId: ${record._id}, collectionId: ${collectionId}, userId: ${userId}, jobId: ${jobId}`);
      return;
    }

    try {
      // ✅ Extract cookId from jobId if not in metadata (jobId format: "cookId:index")
      const finalCookId = cookId || (jobId.includes(':') ? jobId.split(':')[0] : null);
      
      await CookOrchestratorService.appendEvent('PieceGenerated', { 
        collectionId, 
        userId, 
        cookId: finalCookId, // ✅ Include cookId so event is stored on cook document
        jobId, 
        generationId: record._id 
      });
      await CookOrchestratorService.scheduleNext({ collectionId, userId, finishedJobId: jobId, success: record.status === 'completed' });
      this.logger.info(`[NotificationDispatcher] Cook orchestration progressed for collection ${collectionId}, job ${jobId}`);
    } catch (err) {
      this.logger.error(`[NotificationDispatcher] Error advancing cook for collection ${collectionId}:`, err.message);
    }
  }
}

module.exports = NotificationDispatcher; 
