// src/core/services/comfydeploy/webhookProcessor.js

// Temporary in-memory cache for live progress (can be managed within this module)
const activeJobProgress = new Map();

// Dependencies: internalApiClient and logger. telegramNotifier is removed.
async function processComfyDeployWebhook(payload, { internalApiClient, logger }) {
  // Initial check of received dependencies
  // Use a temporary console.log if logger itself might be an issue, but logs show it works.
  if (logger && typeof logger.info === 'function') {
    logger.info('[Webhook Processor] Initial check of received dependencies:', {
      isInternalApiClientPresent: !!internalApiClient,
      isInternalApiClientGetFunction: typeof internalApiClient?.get === 'function',
      isLoggerPresent: !!logger
    });
  } else {
    console.log('[Webhook Processor - Fallback Log] Initial check of received dependencies:', {
      isInternalApiClientPresent: !!internalApiClient,
      isInternalApiClientGetFunction: typeof internalApiClient?.get === 'function',
      isLoggerPresent: !!logger
    });
  }

  logger.info('~~⚡~~ [Webhook Processor] Processing Body:', JSON.stringify(payload, null, 2));

  const { run_id, status, progress, live_status, outputs, event_type } = payload;

  if (!run_id || !status || !event_type) {
    logger.warn('[Webhook Processor] Invalid webhook payload: Missing run_id, status, or event_type.', payload);
    return { success: false, statusCode: 400, error: "Missing required fields in webhook." };
  }

  logger.info(`[Webhook Processor Parsed] Event: ${event_type}, RunID: ${run_id}, Status: ${status}, Progress: ${progress ? (progress * 100).toFixed(1) + '%' : 'N/A'}, Live: ${live_status || 'N/A'}`);

  if (status === 'running' || status === 'queued' || status === 'started' || status === 'uploading') {
    const now = new Date().toISOString();
    const jobState = activeJobProgress.get(run_id) || {};

    if (status === 'running' && !jobState.startTime) {
      jobState.startTime = now; 
      logger.info(`[Webhook Processor] Captured startTime for RunID ${run_id}: ${jobState.startTime}`);
    }

    activeJobProgress.set(run_id, { 
      ...jobState,
      status, 
      live_status, 
      progress, 
      last_updated: now 
    });
  }

  if (status === 'success' || status === 'failed') {
    logger.info(`[Webhook Processor Final State] RunID: ${run_id} finished with status: ${status}.`);
    const finalEventTimestamp = new Date().toISOString();
    const jobStartDetails = activeJobProgress.get(run_id);
    activeJobProgress.delete(run_id);

    let generationRecord;
    let generationId;
    let costRate;
    let telegramChatId; // Still extract, as it's part of record metadata for the dispatcher

    try {
      logger.info(`[Webhook Processor] Attempting to fetch generation record for run_id: ${run_id}. internalApiClient defined: ${!!internalApiClient}, is function: ${typeof internalApiClient?.get === 'function'}`);
      if (!internalApiClient || typeof internalApiClient.get !== 'function') {
        logger.error(`[Webhook Processor] CRITICAL ERROR for run_id ${run_id}: internalApiClient is undefined or not a valid client before GET call. This should not happen. internalApiClient:`, internalApiClient);
        activeJobProgress.delete(run_id); // Clean up job progress
        return { success: false, statusCode: 500, error: "Internal server error: Core API client not configured or invalid for webhook processing." };
      }
      
      // Add the X-Internal-Client-Key header for this request
      const requestOptions = {
        headers: {
          'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB
        }
      };
      if (!process.env.INTERNAL_API_KEY_WEB) {
        logger.warn(`[Webhook Processor] INTERNAL_API_KEY_WEB is not set in environment variables. Internal API calls may fail authentication.`);
      }

      const response = await internalApiClient.get(`/v1/data/generations?metadata.run_id=${run_id}`, requestOptions);
      if (response && response.data && response.data.generations && response.data.generations.length > 0) {
        generationRecord = response.data.generations[0];
        generationId = generationRecord._id;
        if (generationRecord.metadata) {
            costRate = generationRecord.metadata.costRate;
            telegramChatId = generationRecord.metadata.telegramChatId; // Extracted for completeness of record info
        } else {
            logger.error(`[Webhook Processor] Generation record for run_id ${run_id} is missing metadata.`);
            return { success: false, statusCode: 500, error: "Generation record metadata missing." };
        }

        // Basic check for generationId; costRate and telegramChatId might be optional depending on job type or if notification is disabled
        if (!generationId) {
            logger.error(`[Webhook Processor] Essential data (generationId) missing from generation record (ID: ${generationRecord._id}) for run_id ${run_id}.`);
            return { success: false, statusCode: 500, error: "Essential data missing from fetched generation record." };
        }
        logger.info(`[Webhook Processor] Successfully fetched generation record ${generationId} for run_id ${run_id}. ChatID (metadata): ${telegramChatId}`);

      } else {
        logger.error(`[Webhook Processor] No generation record found for run_id ${run_id}. Response: ${JSON.stringify(response.data)}`);
        return { success: false, statusCode: 404, error: "Generation record not found." };
      }
    } catch (err) {
      logger.error(`[Webhook Processor] Error fetching generation record for run_id ${run_id}:`, err.message, err.stack);
      const errStatus = err.response ? err.response.status : 500;
      const errMessage = err.response && err.response.data && err.response.data.message ? err.response.data.message : "Failed to fetch internal generation record.";
      return { success: false, statusCode: errStatus, error: errMessage };
    }

    let costUsd = null;
    let runDurationSeconds = 0;

    if (jobStartDetails && jobStartDetails.startTime && 
        costRate && typeof costRate.amount === 'number' && typeof costRate.unit === 'string' && 
        status === 'success') {
      
      const startTime = new Date(jobStartDetails.startTime);
      const endTime = new Date(finalEventTimestamp);
      runDurationSeconds = (endTime.getTime() - startTime.getTime()) / 1000;
      
      if (runDurationSeconds < 0) {
        logger.warn(`[Webhook Processor] Calculated negative run duration (${runDurationSeconds}s) for run_id ${run_id}. Clamping to 0. Start: ${jobStartDetails.startTime}, End: ${finalEventTimestamp}`);
        runDurationSeconds = 0;
      } 

      if (costRate.unit.toLowerCase() === 'second' || costRate.unit.toLowerCase() === 'seconds') {
        costUsd = runDurationSeconds * costRate.amount;
        logger.info(`[Webhook Processor] Calculated costUsd: ${costUsd} for run_id ${run_id} (Duration: ${runDurationSeconds.toFixed(2)}s, Rate: ${costRate.amount}/${costRate.unit})`);
      } else {
        logger.warn(`[Webhook Processor] Cost calculation skipped for run_id ${run_id}: costRate.unit is '${costRate.unit}', expected 'second'.`);
      }
    } else if (status === 'success') {
      logger.warn(`[Webhook Processor] Could not calculate cost for successful run_id ${run_id}: Missing or invalid jobStartDetails, startTime, or costRate. 
                   jobStartDetails: ${JSON.stringify(jobStartDetails)}, 
                   costRate: ${JSON.stringify(costRate)}, 
                   finalEventTimestamp: ${finalEventTimestamp}`);
    } else {
      logger.info(`[Webhook Processor] Job ${run_id} ended with status ${status}. Cost calculation skipped.`);
    }

    const updatePayload = {
      status: status === 'success' ? 'completed' : 'failed',
      statusReason: status === 'failed' ? (payload.error_details || payload.error || 'Unknown error from ComfyDeploy') : null,
      responseTimestamp: finalEventTimestamp,
      responsePayload: status === 'success' ? (outputs || null) : (payload.error_details || payload.error || null),
      costUsd: costUsd,
      // The ADR specifies `deliveryStatus` etc. should be part of generationRecord.
      // `webhookProcessor` sets the final state. The initial `deliveryStatus: 'pending'` 
      // and `notificationPlatform`/`notificationContext` should be set when the job is first created.
      // If they are not, the dispatcher service will not be able to pick this up.
      // For now, we assume they are already on the generationRecord or will be added by another process.
    };
    logger.info(`[Webhook Processor] Preparing to update generation ${generationId} for run_id ${run_id}. Payload:`, JSON.stringify(updatePayload, null, 2));
    try {
       // Add the X-Internal-Client-Key header for this request
       const putRequestOptions = {
        headers: {
          'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB
        }
      };
       await internalApiClient.put(`/v1/data/generations/${generationId}`, updatePayload, putRequestOptions);
       logger.info(`[Webhook Processor] Successfully updated generation record ${generationId} for run_id ${run_id}.`);
    } catch (err) {
       logger.error(`[Webhook Processor] Error updating generation record ${generationId} for run_id ${run_id}:`, err.message, err.stack);
       const errStatus = err.response ? err.response.status : 500;
       const errMessage = err.response && err.response.data && err.response.data.message ? err.response.data.message : "Failed to update internal generation record.";
       return { success: false, statusCode: errStatus, error: errMessage };
    }

    // Notification logic has been removed as per ADR-001.
    // The Notification Dispatch Service will handle notifications based on generationRecord updates.
  }
  return { success: true, statusCode: 200, data: { message: "Webhook processed successfully. DB record updated." } };
}

module.exports = {
  processComfyDeployWebhook,
  getActiveJobProgress: () => activeJobProgress
}; 