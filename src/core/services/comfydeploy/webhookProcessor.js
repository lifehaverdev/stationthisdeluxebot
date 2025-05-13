// src/core/services/comfydeploy/webhookProcessor.js

// Assume internalApiClient and telegramNotifier will be passed or imported as needed
// For now, we'll keep the SIMULATING comments.

// Temporary in-memory cache for live progress (can be managed within this module)
const activeJobProgress = new Map();

async function processComfyDeployWebhook(payload, { internalApiClient, telegramNotifier, logger }) {
  // It's good practice to log the raw body once during development/debugging.
  // The logger will be passed in.
  logger.info('~~⚡~~ [Webhook Processor] Processing Body:', JSON.stringify(payload, null, 2));

  const { run_id, status, progress, live_status, outputs, event_type } = payload;

  if (!run_id || !status || !event_type) {
    logger.warn('[Webhook Processor] Invalid webhook payload: Missing run_id, status, or event_type.', payload);
    // This function will return a status/error, the route handler will send HTTP response
    return { success: false, statusCode: 400, error: "Missing required fields in webhook." };
  }

  logger.info(`[Webhook Processor Parsed] Event: ${event_type}, RunID: ${run_id}, Status: ${status}, Progress: ${progress ? (progress * 100).toFixed(1) + '%' : 'N/A'}, Live: ${live_status || 'N/A'}`);

  // --- Handle Intermediate Status Updates ---
  if (status === 'running' || status === 'queued' || status === 'started' || status === 'uploading') {
    activeJobProgress.set(run_id, { 
      status, 
      live_status, 
      progress, 
      last_updated: new Date().toISOString() 
    });
    // TODO: Optionally, emit an event here if other parts of your system need real-time progress
  }

  // --- Handle Final Status Updates (Success or Failed) ---
  if (status === 'success' || status === 'failed') {
    logger.info(`[Webhook Processor Final State] RunID: ${run_id} finished with status: ${status}.`);
    activeJobProgress.delete(run_id); // Clean up from progress cache

    let generationRecord;
    let generationId = "GENERATION_ID_PLACEHOLDER"; // Placeholder
    let costRate = null; // Placeholder
    let telegramChatId = "TELEGRAM_CHAT_ID_PLACEHOLDER"; // Placeholder

    try {
      logger.info(`[Webhook Processor] SIMULATING: Would fetch generation record for run_id: ${run_id} using internalApiClient.`);
      // const response = await internalApiClient.get(`/generations?metadata.run_id=${run_id}`);
      // if (response.data && response.data.generations && response.data.generations.length > 0) {
      //   generationRecord = response.data.generations[0];
      //   generationId = generationRecord.id;
      //   costRate = generationRecord.metadata.costRate;
      //   telegramChatId = generationRecord.metadata.telegramChatId;
      // } else {
      //   logger.error(`[Webhook Processor] No generation record found for run_id ${run_id}.`);
      //   return { success: false, statusCode: 404, error: "Generation record not found." };
      // }
    } catch (err) {
      logger.error(`[Webhook Processor] Error fetching generation record for run_id ${run_id}:`, err.message);
      return { success: false, statusCode: 500, error: "Failed to fetch internal generation record." };
    }

    let costUsd = null;
    // TODO: Implement run duration calculation logic here using timestamps from payload or cache.
    // Example:
    // const jobStartTime = activeJobProgress.get(run_id)?.initialTimestamp; // Assuming you stored this
    // const jobEndTime = new Date(payload.updated_at || payload.outputs?.[0]?.created_at || Date.now());
    // if (jobStartTime && costRate) {
    //    const runDurationSeconds = (jobEndTime.getTime() - new Date(jobStartTime).getTime()) / 1000;
    //    if (costRate.unit === 'second' && costRate.amount) {
    //       costUsd = runDurationSeconds * costRate.amount;
    //       logger.info(`[Webhook Processor] Calculated costUsd: ${costUsd} for run_id ${run_id}`);
    //    }
    // }

    const updatePayload = {
      status: status === 'success' ? 'completed' : 'failed',
      statusReason: status === 'failed' ? (payload.error_details || payload.error || 'Unknown error from ComfyDeploy') : null,
      responseTimestamp: new Date().toISOString(),
      responsePayload: status === 'success' ? (outputs || null) : (payload.error_details || payload.error || null),
      // costUsd: costUsd, // Uncomment when calculation is ready
    };
    logger.info(`[Webhook Processor] SIMULATING: Would update generation ${generationId} with payload:`, updatePayload);
    // try {
    //    await internalApiClient.put(`/generations/${generationId}`, updatePayload);
    // } catch (err) {
    //    logger.error(`[Webhook Processor] Error updating generation record ${generationId} for run_id ${run_id}:`, err.message);
    //    // Potentially allow notification to proceed anyway or handle error differently
    // }

    logger.info(`[Webhook Processor] SIMULATING: Would notify Telegram user for chat_id ${telegramChatId}`);
    // const messageToUser = status === 'success' 
    //   ? `Your job ${run_id} is complete! Image: ${outputs?.[0]?.data?.images?.[0]?.url || 'Not available'}`
    //   : `Your job ${run_id} failed. Reason: ${updatePayload.statusReason}`;
    // try {
    //    await telegramNotifier.sendMessage(telegramChatId, messageToUser);
    // } catch (err) {
    //    logger.error(`[Webhook Processor] Error notifying user for run_id ${run_id}:`, err.message);
    // }
  }
  return { success: true, statusCode: 200, data: { message: "success" } };
}

module.exports = {
  processComfyDeployWebhook,
  // Potentially export activeJobProgress if needed elsewhere for status checks, or provide a getter
  getActiveJobProgress: () => activeJobProgress // Example getter
}; 