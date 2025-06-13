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

    // ADR-005: Debit logic starts here
    if (generationRecord && updatePayload.status === 'completed' && costUsd != null && costUsd > 0) {
      const toolId = generationRecord.metadata?.toolId || generationRecord.toolId; // Fallback as per instructions
      if (!toolId) {
        logger.error(`[Webhook Processor] Debit skipped for generation ${generationId}: toolId is missing in metadata or record.`);
        // Potentially mark as payment_failed or requires_manual_intervention
      } else {

        // <<<< ADR-012: Micro-Fee System START >>>>
        const { finalCost, rewards } = calculateCreatorRewards(generationRecord, costUsd, logger);
        const debitPayload = buildDebitPayload(toolId, generationRecord, finalCost);
        // <<<< ADR-012: Micro-Fee System END >>>>

        try {
          logger.info(`[Webhook Processor] Attempting debit for generation ${generationId}, user ${generationRecord.masterAccountId}. Payload:`, JSON.stringify(debitPayload));
          await issueDebit(generationRecord.masterAccountId, debitPayload, { internalApiClient, logger });
          logger.info(`[Webhook Processor] Debit successful for generation ${generationId}, user ${generationRecord.masterAccountId}.`);

          // <<<< ADR-012: Micro-Fee System START >>>>
          if (rewards.length > 0) {
            await distributeCreatorRewards(generationRecord, rewards, { internalApiClient, logger });
          }
          // <<<< ADR-012: Micro-Fee System END >>>>

          // If debit succeeds, the 'completed' status remains, and NotificationDispatcher will pick it up.

          // << ADR-005 EXP Update Start >>
          try {
            const usdPerPoint = 0.000337;
            const pointsSpent = Math.round(costUsd / usdPerPoint);
            const expPayload = {
              expChange: pointsSpent,
              description: `EXP gained for ${pointsSpent} points spent via tool ${toolId}`
            };
            const expUpdateEndpoint = `/v1/data/users/${generationRecord.masterAccountId}/economy/exp`;
            const expRequestOptions = { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } };
            
            logger.info(`[Webhook Processor] Attempting EXP update for masterAccountId ${generationRecord.masterAccountId}. Payload:`, JSON.stringify(expPayload));
            await internalApiClient.put(expUpdateEndpoint, expPayload, expRequestOptions);
            logger.info(`[Webhook Processor] EXP updated for masterAccountId ${generationRecord.masterAccountId}: +${pointsSpent} points`);

          } catch (expError) {
            logger.warn(`[Webhook Processor] EXP update failed for masterAccountId ${generationRecord.masterAccountId}. This is non-blocking. Error:`, expError.message, expError.stack);
            // Do not re-throw or change generation status.
          }
          // << ADR-005 EXP Update End >>

        } catch (debitError) {
          logger.error(`[Webhook Processor] Debit FAILED for generation ${generationId}, user ${generationRecord.masterAccountId}. Error:`, debitError.message, debitError.stack);
          // Update generation record to 'payment_failed'
          const paymentFailedUpdatePayload = {
            status: 'payment_failed',
            statusReason: debitError.message || 'Debit failed post-generation.',
            // Potentially add more context about the debit failure
          };
          try {
            const putRequestOptions = { headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB } };
            await internalApiClient.put(`/v1/data/generations/${generationId}`, paymentFailedUpdatePayload, putRequestOptions);
            logger.info(`[Webhook Processor] Successfully updated generation ${generationId} status to 'payment_failed'.`);
          } catch (updateError) {
            logger.error(`[Webhook Processor] CRITICAL: Failed to update generation ${generationId} to 'payment_failed' after debit failure. Error:`, updateError.message, updateError.stack);
            // This is a critical state. The user was not charged, but the record doesn't reflect payment failure.
            // Manual intervention might be required.
          }
          // Do not proceed to notification dispatch if debit failed.
          // The function will return, and NotificationDispatcher should not pick up 'payment_failed' jobs.
        }
      }
    } else if (updatePayload.status === 'completed' && (costUsd == null || costUsd <= 0)) {
      logger.info(`[Webhook Processor] Debit skipped for generation ${generationId}: costUsd is ${costUsd}. Assuming free generation or no cost applicable.`);
    }
    // ADR-005: Debit logic ends here
  }
  return { success: true, statusCode: 200, data: { message: "Webhook processed successfully. DB record updated." } };
}

// <<<< ADR-012: Micro-Fee System START >>>>
/**
 * Calculates creator rewards based on spell and LoRA usage.
 * @param {object} generationRecord - The full generation record.
 * @param {number} baseCost - The base cost of the generation in USD.
 * @param {object} logger - The logger instance.
 * @returns {{finalCost: number, rewards: Array<{ownerId: string, amount: number, type: string}>}}
 */
function calculateCreatorRewards(generationRecord, baseCost, logger) {
    const rewards = [];
    let totalFee = 0;
    const generatingUserId = generationRecord.masterAccountId.toString();

    const isSpell = generationRecord.metadata?.isSpell;
    const appliedLoras = generationRecord.metadata?.loraResolutionData?.appliedLoras || [];

    const uniqueLoras = appliedLoras.reduce((acc, lora) => {
        // Don't reward user for using their own LoRA
        if (lora.ownerAccountId && lora.ownerAccountId !== generatingUserId) {
            if (!acc.find(item => item.modelId === lora.modelId)) {
                acc.push(lora);
            }
        }
        return acc;
    }, []);

    if (isSpell) {
        const spellOwnerId = generationRecord.metadata?.spell?.ownedBy?.toString();
        const LORA_FEE_RATE = 0.03;
        const SPELL_FEE_RATE = 0.03;

        // Credit spell owner (if they aren't the one running the spell)
        if (spellOwnerId && spellOwnerId !== generatingUserId) {
            const spellFee = baseCost * SPELL_FEE_RATE;
            rewards.push({ ownerId: spellOwnerId, amount: spellFee, type: 'spell_fee' });
            totalFee += spellFee;
            logger.info(`[calculateCreatorRewards] Calculated spell fee of ${spellFee} for owner ${spellOwnerId}`);
        }

        // Credit LoRA owners
        if (uniqueLoras.length > 0) {
            const loraFeePool = baseCost * LORA_FEE_RATE;
            const perLoraFee = loraFeePool / uniqueLoras.length;
            uniqueLoras.forEach(lora => {
                rewards.push({ ownerId: lora.ownerAccountId, amount: perLoraFee, type: 'lora_fee' });
                totalFee += perLoraFee;
            });
            logger.info(`[calculateCreatorRewards] Calculated LoRA fee of ${loraFeePool} split among ${uniqueLoras.length} LoRAs for spell generation.`);
        }
    } else if (uniqueLoras.length > 0) {
        const LORA_FEE_RATE = 0.05;
        const loraFeePool = baseCost * LORA_FEE_RATE;
        const perLoraFee = loraFeePool / uniqueLoras.length;
        uniqueLoras.forEach(lora => {
            rewards.push({ ownerId: lora.ownerAccountId, amount: perLoraFee, type: 'lora_fee' });
            totalFee += perLoraFee;
        });
        logger.info(`[calculateCreatorRewards] Calculated LoRA fee of ${loraFeePool} split among ${uniqueLoras.length} LoRAs.`);
    }

    const finalCost = baseCost + totalFee;
    logger.info(`[calculateCreatorRewards] Base Cost: ${baseCost}, Total Fee: ${totalFee}, Final Cost: ${finalCost}`);

    return { finalCost, rewards };
}

/**
 * Distributes rewards to creators by calling the credit API.
 * @param {object} generationRecord - The generation record for context.
 * @param {Array<{ownerId: string, amount: number, type: string}>} rewards - The rewards to distribute.
 * @param {{internalApiClient: object, logger: object}} dependencies - Dependencies.
 */
async function distributeCreatorRewards(generationRecord, rewards, { internalApiClient, logger }) {
    logger.info(`[distributeCreatorRewards] Distributing ${rewards.length} rewards for generation ${generationRecord._id}.`);

    for (const reward of rewards) {
        try {
            const creditPayload = {
                amountUsd: reward.amount,
                description: `Reward for your ${reward.type === 'spell_fee' ? 'Spell' : 'LoRA'} used in generation ${generationRecord._id}`,
                transactionType: "creator_reward",
                relatedItems: {
                    generationId: generationRecord._id,
                    rewardType: reward.type,
                }
            };
            await issueCredit(reward.ownerId, creditPayload, { internalApiClient, logger });
            logger.info(`[distributeCreatorRewards] Successfully credited ${reward.amount} to owner ${reward.ownerId}.`);
        } catch (error) {
            logger.error(`[distributeCreatorRewards] FAILED to credit owner ${reward.ownerId} for generation ${generationRecord._id}. Error:`, error.message);
            // This failure is logged but does not stop other rewards or fail the main process.
        }
    }
}


/**
 * Issues a credit to a user's account via the internal API.
 * @param {string} masterAccountId - The user to credit.
 * @param {object} payload - The credit payload.
 * @param {{internalApiClient: object, logger: object}} dependencies - Dependencies.
 */
async function issueCredit(masterAccountId, payload, { internalApiClient, logger }) {
    if (!masterAccountId) {
        throw new Error('masterAccountId is required for credit.');
    }
    const creditEndpoint = `/v1/data/users/${masterAccountId}/economy/credit`;
    const requestOptions = {
        headers: { 'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB },
    };

    logger.info(`[issueCredit] Sending POST to ${creditEndpoint} for user ${masterAccountId}. Payload:`, JSON.stringify(payload));

    try {
        await internalApiClient.post(creditEndpoint, payload, requestOptions);
    } catch (error) {
        const errorMessage = error.response?.data?.message || error.message || 'Unknown error during credit';
        logger.error(`[issueCredit] Credit request failed for user ${masterAccountId}. Error: ${errorMessage}`);
        const creditError = new Error(`Credit API call failed: ${errorMessage}`);
        creditError.statusCode = error.response?.status || 500;
        throw creditError;
    }
}
// <<<< ADR-012: Micro-Fee System END >>>>

// Helper function to build the debit payload as per ADR-005
function buildDebitPayload(toolId, generationRecord, costUsd) {
  return {
    // Fields explicitly required by the /debit API at the top level:
    amountUsd: costUsd,
    description: `Debit for generation via ${toolId}`,
    transactionType: "generation_debit",

    // Place all other identifiers and audit information into 'relatedItems':
    relatedItems: {
      toolId: toolId,
      generationId: generationRecord._id,
      run_id: generationRecord.metadata?.run_id, // from previous 'metadata' object
      // We could add other relevant details from generationRecord.metadata here if needed
    }
    // Removed top-level toolId, generationId, and the old metadata object as they are not directly used
    // at the top level by the current /debit API. Their contents are now in relatedItems.
  };
}

// Helper function to issue the debit request via the internal API
async function issueDebit(masterAccountId, payload, { internalApiClient, logger }) {
  if (!masterAccountId) {
    logger.error('[Webhook Processor - issueDebit] masterAccountId is undefined. Cannot issue debit.');
    throw new Error('masterAccountId is required for debit.');
  }
  if (!internalApiClient || typeof internalApiClient.post !== 'function') {
    logger.error('[Webhook Processor - issueDebit] internalApiClient is undefined or not a valid client. Cannot issue debit.');
    throw new Error('Internal API client not configured or invalid for issuing debit.');
  }

  // const debitEndpoint = `/internal/v1/data/users/${masterAccountId}/economy/debit`;
  // ADR-005 hotfix: Path issue with internalApiClient potentially double-prepending /internal
  const debitEndpoint = `/v1/data/users/${masterAccountId}/economy/debit`;
  const requestOptions = {
    headers: {
      'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB,
      // Add other necessary headers like Content-Type if not automatically handled by internalApiClient
    },
  };
  if (!process.env.INTERNAL_API_KEY_WEB) {
    logger.warn(`[Webhook Processor - issueDebit] INTERNAL_API_KEY_WEB is not set. Debit call to ${debitEndpoint} may fail authentication.`);
  }

  logger.info(`[Webhook Processor - issueDebit] Sending POST to ${debitEndpoint} for user ${masterAccountId}. Payload:`, JSON.stringify(payload));
  
  try {
    const response = await internalApiClient.post(debitEndpoint, payload, requestOptions);
    // Assuming a successful response is 2xx. The internalApiClient might throw for non-2xx.
    logger.info(`[Webhook Processor - issueDebit] Debit request successful for user ${masterAccountId}. Response status: ${response.status}`);
    return response.data; // Or whatever the successful response structure is
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message || 'Unknown error during debit';
    const errorStatus = error.response?.status || 500;
    logger.error(`[Webhook Processor - issueDebit] Debit request failed for user ${masterAccountId}. Status: ${errorStatus}, Error: ${errorMessage}`, error.stack);
    // Re-throw a more specific error or a standardized error object
    const debitError = new Error(`Debit API call failed: ${errorMessage}`);
    debitError.statusCode = errorStatus;
    debitError.details = error.response?.data; // Attach more details if available
    throw debitError;
  }
}

module.exports = {
  processComfyDeployWebhook,
  getActiveJobProgress: () => activeJobProgress
}; 