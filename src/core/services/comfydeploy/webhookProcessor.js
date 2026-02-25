// src/core/services/comfydeploy/webhookProcessor.js

const { createLogger } = require('../../../utils/logger');
const { CookOrchestratorService } = require('../cook');
const adapterRegistry = require('../adapterRegistry');
const { getPricingService } = require('../pricing');
const { generationService } = require('../store/generations/GenerationService');
const { economyService } = require('../store/economy/EconomyService');
const ResponsePayloadNormalizer = require('../notifications/ResponsePayloadNormalizer');

// Temporary in-memory cache for live progress (can be managed within this module)
const activeJobProgress = new Map();

// Reusable wrapper that mirrors webhook processing for a given run payload
async function processRunPayload(runPayload, deps){
  return processComfyDeployWebhook(runPayload, deps);
}

// Dependencies: internalApiClient (for economy/user/group calls), logger, and webSocketService for real-time updates.
async function processComfyDeployWebhook(payload, { internalApiClient, logger, webSocketService: websocketServer }) {
  logger.debug({payload}, '[Webhook Processor] Processing Body:');

  const { run_id, status, progress, live_status, outputs, event_type } = payload;

  // --- Generic adapter-based webhook handling (new architecture) ---
  try {
    const generation = await generationService.findByRunId(run_id);
    if (generation) {
      const adapter = adapterRegistry.get(generation.serviceName);
      if (adapter && typeof adapter.parseWebhook === 'function') {
        const result = adapter.parseWebhook(payload);

        const updatePayload = {
          status: result.status,
          responsePayload: result.data,
          outputs: result.data ? [{ data: result.data }] : undefined,
          costUsd: result.costUsd || null,
        };
        await generationService.update(generation._id, updatePayload);

        return { success: true, statusCode: 200, data: { message: 'Processed via adapter' } };
      }
    }
  } catch (adapterErr) {
    logger.error('[WebhookProcessor] Adapter parseWebhook flow error:', adapterErr);
    // fall through to legacy logic
  }

  if (!run_id || !status || !event_type) {
    logger.warn('[Webhook Processor] Invalid webhook payload: Missing run_id, status, or event_type.', payload);
    return { success: false, statusCode: 400, error: "Missing required fields in webhook." };
  }

  logger.debug(`[Webhook Processor Parsed] Event: ${event_type}, RunID: ${run_id}, Status: ${status}, Progress: ${progress ? (progress * 100).toFixed(1) + '%' : 'N/A'}, Live: ${live_status || 'N/A'}`);

  if (status === 'running' || status === 'queued' || status === 'started' || status === 'uploading') {
    const now = new Date().toISOString();
    const jobState = activeJobProgress.get(run_id) || {};

    if (status === 'running' && !jobState.startTime) {
      jobState.startTime = now;
      logger.debug(`[Webhook Processor] Captured startTime for RunID ${run_id}: ${jobState.startTime}`);
    }

    activeJobProgress.set(run_id, { 
      ...jobState,
      status, 
      live_status, 
      progress, 
      last_updated: now 
    });

    // Find the associated generation to get the user ID for real-time progress updates
    const generationRecordForProgress = await generationService.findByRunId(run_id).catch(() => null);

    if (generationRecordForProgress && websocketServer) {
        const collectionId = generationRecordForProgress.metadata?.collectionId || generationRecordForProgress.collectionId || null;
        websocketServer.sendToUser(generationRecordForProgress.masterAccountId, {
            type: 'generationProgress',
            payload: {
                generationId: generationRecordForProgress._id.toString(),
                runId: run_id,
                status: status,
                progress: progress,
                liveStatus: live_status,
                toolId: generationRecordForProgress.toolId || generationRecordForProgress.metadata?.toolId || null,
                spellId: generationRecordForProgress.metadata?.spell?._id || generationRecordForProgress.metadata?.spellId || null,
                castId: generationRecordForProgress.metadata?.castId || generationRecordForProgress.castId || null,
                cookId: generationRecordForProgress.metadata?.cookId || null,
                collectionId
            }
        });
    }
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
      logger.debug(`[Webhook Processor] Fetching generation record for run_id: ${run_id}`);

      generationRecord = await generationService.findByRunId(run_id);
      if (generationRecord) {
        generationId = generationRecord._id;

        // Extract costRate from metadata before spell step check
        if (generationRecord.metadata) {
            costRate = generationRecord.metadata.costRate;
            telegramChatId = generationRecord.metadata.telegramChatId; // Extracted for completeness of record info
            logger.debug(`[Webhook Processor] Extracted costRate from metadata: ${JSON.stringify(costRate)}`);
        } else {
            logger.error(`[Webhook Processor] Generation record for run_id ${run_id} is missing metadata.`);
            return { success: false, statusCode: 500, error: "Generation record metadata missing." };
        }

        // --- SPELL STEP CHECK ---
        // NOTE: Previously we bypassed debit for spell steps. This vestigial logic has been removed so that spell steps are now billed like regular tool runs.
        // If this is an intermediate step in a spell, we calculate cost but don't debit the user.
        // The user is charged upfront for the entire spell, but we still need cost data for display.
        if (generationRecord.metadata?.isSpell && generationRecord.deliveryStrategy === 'spell_step') {
            logger.debug(`[Webhook Processor] Detected spell step for generation ${generationId}. Calculating cost but bypassing debit logic.`);
            
            // Calculate cost for display purposes (same logic as regular tools)
            let costUsd = null;
            let runDurationSeconds = 0;

            if (jobStartDetails && jobStartDetails.startTime && 
                costRate && typeof costRate.amount === 'number' && typeof costRate.unit === 'string' && 
                status === 'success') {
              
              const startTime = new Date(jobStartDetails.startTime);
              const endTime = new Date(finalEventTimestamp);
              runDurationSeconds = (endTime.getTime() - startTime.getTime()) / 1000;
              
              if (runDurationSeconds < 0) {
                logger.warn(`[Webhook Processor] Calculated negative run duration (${runDurationSeconds}s) for spell step ${generationId}. Clamping to 0. Start: ${jobStartDetails.startTime}, End: ${finalEventTimestamp}`);
                runDurationSeconds = 0;
              } 

              if (costRate.unit.toLowerCase() === 'second' || costRate.unit.toLowerCase() === 'seconds') {
                costUsd = runDurationSeconds * costRate.amount;
                logger.debug(`[Webhook Processor] Calculated costUsd for spell step: ${costUsd} for generation ${generationId} (Duration: ${runDurationSeconds.toFixed(2)}s, Rate: ${costRate.amount}/${costRate.unit})`);
              } else {
                logger.warn(`[Webhook Processor] Cost calculation skipped for spell step ${generationId}: costRate.unit is '${costRate.unit}', expected 'second'.`);
              }
            } else if (status === 'success') {
              if (!costRate || !costRate.amount) {
                logger.warn(`[Webhook Processor] Could not calculate cost for successful spell step ${generationId}: Missing costRate information. 
                             This may be because the tool doesn't have costing configured. 
                             jobStartDetails: ${JSON.stringify(jobStartDetails)}, 
                             costRate: ${JSON.stringify(costRate)}, 
                             finalEventTimestamp: ${finalEventTimestamp}`);
              } else {
                logger.warn(`[Webhook Processor] Could not calculate cost for successful spell step ${generationId}: Missing or invalid jobStartDetails or startTime. 
                             jobStartDetails: ${JSON.stringify(jobStartDetails)}, 
                             costRate: ${JSON.stringify(costRate)}, 
                             finalEventTimestamp: ${finalEventTimestamp}`);
              }
            } else {
              logger.debug(`[Webhook Processor] Spell step ${generationId} ended with status ${status}. Cost calculation skipped.`);
            }
            
            const spellStepUpdatePayload = {
                status: status === 'success' ? 'completed' : 'failed',
                statusReason: status === 'failed' ? (payload.error_details || payload.error || 'Unknown error from ComfyDeploy') : null,
                responseTimestamp: finalEventTimestamp,
                responsePayload: status === 'success' ? (outputs || null) : (payload.error_details || payload.error || null),
                // Include cost data for display purposes
                ...(costUsd !== null && { costUsd: costUsd }),
                ...(runDurationSeconds > 0 && { durationMs: Math.round(runDurationSeconds * 1000) })
            };
            
            try {
                await generationService.update(generationId, spellStepUpdatePayload);
                logger.debug(`[Webhook Processor] Successfully updated spell step generation record ${generationId} with cost data.`);
                // >>>>> REMOVED EARLY RETURN: let main debit logic execute as for regular tools
            } catch (err) {
                logger.error(`[Webhook Processor] Error updating spell step generation record ${generationId}:`, err.message, err.stack);
                // continue but log
            }
            // (costUsd set, but allow flow to continue to debit logic)
        }
        // --- END SPELL STEP CHECK ---

        // Basic check for generationId; costRate and telegramChatId might be optional depending on job type or if notification is disabled
        if (!generationId) {
            logger.error(`[Webhook Processor] Essential data (generationId) missing from generation record (ID: ${generationRecord._id}) for run_id ${run_id}.`);
            return { success: false, statusCode: 500, error: "Essential data missing from fetched generation record." };
        }
        logger.debug(`[Webhook Processor] Successfully fetched generation record ${generationId} for run_id ${run_id}`);

      } else {
        logger.error(`[Webhook Processor] No generation record found for run_id ${run_id}.`);
        return { success: false, statusCode: 404, error: "Generation record not found." };
      }
    } catch (err) {
      logger.error(`[Webhook Processor] Error fetching generation record for run_id ${run_id}:`, err.message, err.stack);
      return { success: false, statusCode: 500, error: "Failed to fetch generation record." };
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
        logger.debug(`[Webhook Processor] Calculated costUsd: ${costUsd} for run_id ${run_id} (Duration: ${runDurationSeconds.toFixed(2)}s, Rate: ${costRate.amount}/${costRate.unit})`);
      } else {
        logger.warn(`[Webhook Processor] Cost calculation skipped for run_id ${run_id}: costRate.unit is '${costRate.unit}', expected 'second'.`);
      }
    } else if (status === 'success') {
      logger.warn(`[Webhook Processor] Could not calculate cost for successful run_id ${run_id}: Missing or invalid jobStartDetails, startTime, or costRate. 
                   jobStartDetails: ${JSON.stringify(jobStartDetails)}, 
                   costRate: ${JSON.stringify(costRate)}, 
                   finalEventTimestamp: ${finalEventTimestamp}`);
    } else {
      logger.debug(`[Webhook Processor] Job ${run_id} ended with status ${status}. Cost calculation skipped.`);
    }

    const updatePayload = {
      status: status === 'success' ? 'completed' : 'failed',
      statusReason: status === 'failed' ? (payload.error_details || payload.error || 'Unknown error from ComfyDeploy') : null,
      responseTimestamp: finalEventTimestamp,
      responsePayload: status === 'success' ? (outputs || null) : (payload.error_details || payload.error || null),
      costUsd: costUsd,
      ...(runDurationSeconds && runDurationSeconds > 0 ? { durationMs: Math.round(runDurationSeconds * 1000) } : {})
      // The ADR specifies `deliveryStatus` etc. should be part of generationRecord.
      // `webhookProcessor` sets the final state. The initial `deliveryStatus: 'pending'` 
      // and `notificationPlatform`/`notificationContext` should be set when the job is first created.
      // If they are not, the dispatcher service will not be able to pick this up.
      // For now, we assume they are already on the generationRecord or will be added by another process.
    };
    // Debug logging for ComfyUI output format
    if (status === 'success' && outputs) {
      logger.debug(`[Webhook Processor] ComfyUI outputs format: ${JSON.stringify(outputs)}`);
    }
    logger.debug(`[Webhook Processor] Preparing to update generation ${generationId} for run_id ${run_id}. Payload:`, JSON.stringify(updatePayload, null, 2));
    try {
      await generationService.update(generationId, updatePayload);
      logger.debug(`[Webhook Processor] Successfully updated generation record ${generationId} for run_id ${run_id}.`);
    } catch (err) {
      logger.error(`[Webhook Processor] Error updating generation record ${generationId} for run_id ${run_id}:`, err.message, err.stack);
      return { success: false, statusCode: 500, error: "Failed to update generation record." };
    }

    // --- Send Final Update via WebSocket ---
    if (websocketServer && generationRecord) {
        logger.debug(`[Webhook Processor] Sending final WebSocket update for generation ${generationId}.`);
        const collectionId = generationRecord.metadata?.collectionId || generationRecord.collectionId || null;
        // Normalize responsePayload to consistent web format (same as WebSandboxNotifier)
        const normalizedForWs = ResponsePayloadNormalizer.normalize(updatePayload.responsePayload, { logger });
        const wsOutputs = ResponsePayloadNormalizer.toWebFormat(normalizedForWs);
        websocketServer.sendToUser(generationRecord.masterAccountId, {
            type: 'generationUpdate',
            payload: {
                generationId: generationId,
                runId: run_id,
                status: updatePayload.status,
                outputs: wsOutputs,
                costUsd: _convertCostUsdForWebSocket(updatePayload.costUsd),
                finalEventTimestamp: finalEventTimestamp,
                toolId: generationRecord.toolId || generationRecord.metadata?.toolId || null,
                spellId: generationRecord.metadata?.spell?._id || generationRecord.metadata?.spellId || null,
                castId: generationRecord.metadata?.castId || generationRecord.castId || null,
                cookId: generationRecord.metadata?.cookId || null,
                collectionId
            }
        });
    }
    // --- End WebSocket Update ---

    // Notification logic has been removed as per ADR-001.
    // The Notification Dispatch Service will handle notifications based on generationRecord updates.

    // ADR-005: Debit logic starts here
    if (generationRecord && updatePayload.status === 'completed' && costUsd != null && costUsd > 0) {
      const toolId = generationRecord.metadata?.toolId || generationRecord.toolId; // Fallback as per instructions
      if (!toolId) {
        logger.error(`[Webhook Processor] Debit skipped for generation ${generationId}: toolId is missing in metadata or record.`);
      } else {
        const notifCtx = generationRecord.metadata?.notificationContext || {};
        const chatId = notifCtx.chatId;
        let spenderMasterAccountId = generationRecord.masterAccountId;
        if (chatId && chatId < 0) {
          try {
            const groupRes = await internalApiClient.get(`/internal/v1/data/groups/${chatId}`);
            const groupDoc = groupRes.data;
            if (groupDoc && groupDoc.sponsorMasterAccountId) {
              spenderMasterAccountId = groupDoc.sponsorMasterAccountId.toString();
              logger.debug(`[Webhook Processor] Group ${chatId} is sponsored by ${spenderMasterAccountId}. Charging sponsor.`);
            }
          } catch (e) {
            if (e.response?.status !== 404) {
              logger.warn(`[Webhook Processor] Failed to resolve sponsor for group ${chatId}: ${e.message}`);
            }
          }
        }

        // --- Platform Fee Recovery (Pricing Multiplier) ---
        // Get pricing service and determine if user qualifies for MS2 discount
        const pricingService = getPricingService(logger);
        const serviceName = generationRecord.serviceName || 'comfyui';
        let isMs2User = false;

        try {
          const walletAddress = await economyService.getUserWalletAddress(spenderMasterAccountId);
          if (walletAddress) {
            const deposits = await economyService.getActiveDepositsByWallet(walletAddress);
            isMs2User = pricingService.userQualifiesForMs2Pricing(deposits);
            if (isMs2User) {
              logger.info(`[Webhook Processor] User ${spenderMasterAccountId} qualifies for MS2 pricing tier.`);
            }
          } else {
            logger.debug(`[Webhook Processor] User ${spenderMasterAccountId} has no wallet address. Using standard pricing.`);
          }
        } catch (e) {
          logger.warn(`[Webhook Processor] Could not check MS2 status for ${spenderMasterAccountId}: ${e.message}. Using standard pricing.`);
        }

        // Calculate final cost with platform fee multiplier
        const quote = pricingService.getQuote({
          computeCostUsd: costUsd,
          serviceName,
          isMs2User,
          toolId
        });

        const basePointsToSpend = quote.totalPoints;

        logger.debug(`[Webhook Processor] Pricing breakdown for gen ${generationId}: computeUsd=$${costUsd.toFixed(4)}, multiplier=${quote.multiplier}x, finalUsd=$${quote.finalCostUsd.toFixed(4)}, points=${basePointsToSpend} (MS2: ${isMs2User})`);

        try {
          // --- New Contributor Reward Logic ---
          // This must be called *before* issueSpend to determine the total charge.
          const { totalPointsToCharge, totalRewards, rewardBreakdown } = await distributeContributorRewards(generationRecord, basePointsToSpend, { logger });

          logger.debug(`[Webhook Processor] Attempting to spend ${totalPointsToCharge} points for generation ${generationId}, user ${generationRecord.masterAccountId}. (Base: ${basePointsToSpend}, Rewards: ${totalRewards})`);
          await economyService.spend(spenderMasterAccountId, { pointsToSpend: totalPointsToCharge, spendContext: { generationId: generationId.toString(), toolId } });
          logger.info(`[Webhook Processor] Spend successful for generation ${generationId}, user ${generationRecord.masterAccountId}.`);

          const protocolNetPoints = basePointsToSpend;
          
          logger.debug(`[Webhook Processor] Points accounting for gen ${generationId}: Total Spent: ${totalPointsToCharge}, Contributor Rewards: ${totalRewards}, Protocol Net: ${protocolNetPoints}`);
          
          // Re-apply the update to the generation record with the new accounting info
          try {
            await generationService.recordPointsAccounting(generationId, { pointsSpent: totalPointsToCharge, contributorRewardPoints: totalRewards, protocolNetPoints, rewardBreakdown });
            logger.debug(`[Webhook Processor] Successfully updated generation ${generationId} with final point accounting.`);
          } catch(err) {
            logger.error(`[Webhook Processor] Non-critical error: Failed to update generation ${generationId} with point accounting details after a successful spend.`, err.message);
          }
          // --- End New Contributor Reward Logic ---

          // << ADR-005 EXP Update Start >>
          try {
            logger.debug(`[Webhook Processor] Attempting EXP update for masterAccountId ${generationRecord.masterAccountId}: +${totalPointsToCharge}`);
            await economyService.updateExp(generationRecord.masterAccountId, totalPointsToCharge);
            logger.debug(`[Webhook Processor] EXP updated for masterAccountId ${generationRecord.masterAccountId}: +${totalPointsToCharge} points`);
          } catch (expError) {
            logger.warn(`[Webhook Processor] EXP update failed for masterAccountId ${generationRecord.masterAccountId}. This is non-blocking. Error:`, expError.message, expError.stack);
          }
          // << ADR-005 EXP Update End >>

        } catch (spendError) {
          logger.error(`[Webhook Processor] Spend FAILED for generation ${generationId}, user ${generationRecord.masterAccountId}. Error:`, spendError.message, spendError.stack);
          try {
            await generationService.markPaymentFailed(generationId, spendError.message || 'Spend failed post-generation.');
            logger.debug(`[Webhook Processor] Updated generation ${generationId} status to 'payment_failed'.`);
          } catch (updateError) {
            logger.error(`[Webhook Processor] CRITICAL: Failed to update generation ${generationId} to 'payment_failed' after spend failure. Error:`, updateError.message, updateError.stack);
          }
        }
      }
    } else if (updatePayload.status === 'completed' && (costUsd == null || costUsd <= 0)) {
      logger.debug(`[Webhook Processor] Debit skipped for generation ${generationId}: costUsd is ${costUsd}. Assuming free generation or no cost applicable.`);
    }
    // ADR-005: Debit logic ends here

    if (generationRecord && updatePayload.status === 'completed') {
      try {
        const meta = generationRecord.metadata || {};
        const collectionId = meta.collectionId;
        const finishedJobId = meta.jobId;
        if (collectionId && finishedJobId) {
          await CookOrchestratorService.appendEvent('PieceGenerated', { collectionId, userId: String(generationRecord.masterAccountId), jobId: finishedJobId, generationId });
          // Remove dependency on cook_jobs queue progression; keep audit only
          // Schedule next piece immediately via orchestrator
          try {
            await CookOrchestratorService.scheduleNext({ collectionId, userId: String(generationRecord.masterAccountId), finishedJobId, success: true });
          } catch (e) {
            logger.warn(`[Webhook Processor] scheduleNext error: ${e.message}`);
          }
        }
      } catch (e) {
        logger.warn(`[Webhook Processor] Cook scheduling hook failed: ${e.message}`);
      }
    }
  }
  return { success: true, statusCode: 200, data: { message: "Webhook processed successfully. DB record updated." } };
}

// <<<< ADR-012: Micro-Fee System REVISED >>>>
/**
 * Calculates and distributes contributor rewards based on a shared pool model.
 * The user is charged the base cost + the total rewards distributed.
 * @param {object} generationRecord - The full generation record.
 * @param {number} basePoints - The base cost of the generation in points.
 * @param {{internalApiClient: object, logger: object}} dependencies - Dependencies.
 * @returns {Promise<{totalPointsToCharge: number, totalRewards: number, rewardBreakdown: Array}>}
 */
async function distributeContributorRewards(generationRecord, basePoints, { logger }) {
    logger.debug(`[distributeContributorRewards] Calculating rewards for gen ${generationRecord._id} based on ${basePoints} base points.`);
    const generatingUserId = generationRecord.masterAccountId.toString();
    const rewardsToDistribute = [];
    const shares = {};
    let totalShares = 0;

    // --- 1. Gather contributors and count shares ---
    const loras = (generationRecord.metadata?.loraResolutionData?.appliedLoras || []);
    loras.forEach(lora => {
        const ownerId = lora.ownerAccountId?.toString();
        // Don't reward user for using their own assets
        if (ownerId && ownerId !== generatingUserId) {
            shares[ownerId] = (shares[ownerId] || 0) + 1; // 1 share per LoRA used
            totalShares++;
            logger.debug(`[distributeContributorRewards] LoRA from ${ownerId} adds 1 share.`);
        }
    });

    const isSpell = generationRecord.metadata?.isSpell;
    const spellOwnerId = generationRecord.metadata?.spell?.ownedBy?.toString();
    if (isSpell && spellOwnerId && spellOwnerId !== generatingUserId) {
        shares[spellOwnerId] = (shares[spellOwnerId] || 0) + 1; // 1 share for the spell
        totalShares++;
        logger.debug(`[distributeContributorRewards] Spell from ${spellOwnerId} adds 1 share.`);
    }

    // Future-proofing for base model owner reward
    const baseModelOwnerId = generationRecord.metadata?.model?.ownerAccountId?.toString();
    if (baseModelOwnerId && baseModelOwnerId !== generatingUserId) {
        // This part is for future implementation when base model ownership is tracked.
        // For now, we just log it. Uncomment the lines below to activate it.
        // shares[baseModelOwnerId] = (shares[baseModelOwnerId] || 0) + 1;
        // totalShares++;
        logger.debug(`[distributeContributorRewards] Base model owner found (${baseModelOwnerId}), but reward logic is not yet active for base models.`);
    }

    if (totalShares === 0) {
        logger.debug('[distributeContributorRewards] No external contributors found. No rewards to distribute.');
        return { totalPointsToCharge: basePoints, totalRewards: 0, rewardBreakdown: [] };
    }

    // --- 2. Calculate rewards ---
    const contributorRewardPool = Math.floor(basePoints * 0.20);
    logger.debug(`[distributeContributorRewards] Total Shares: ${totalShares}. Reward Pool: ${contributorRewardPool} points (20% of base).`);

    if (contributorRewardPool === 0) {
        logger.debug('[distributeContributorRewards] Reward pool is zero. No rewards to distribute.');
        return { totalPointsToCharge: basePoints, totalRewards: 0, rewardBreakdown: [] };
    }

    const pointsPerShare = Math.floor(contributorRewardPool / totalShares);
    if (pointsPerShare === 0) {
        logger.debug(`[distributeContributorRewards] Points per share is zero. No rewards to distribute.`);
        return { totalPointsToCharge: basePoints, totalRewards: 0, rewardBreakdown: [] };
    }

    let totalPointsDistributed = 0;
    const rewardBreakdown = [];

    // --- 3. Prepare reward distribution ---
    for (const [contributorId, shareCount] of Object.entries(shares)) {
        const points = pointsPerShare * shareCount;
        if (points > 0) {
            rewardsToDistribute.push({ contributorId, points });
            totalPointsDistributed += points;
        }
    }
    
    // The user is charged the base cost + total rewards successfully calculated
    const totalPointsToCharge = basePoints + totalPointsDistributed;

    // --- 4. Issue credits to contributors ---
    for (const reward of rewardsToDistribute) {
        try {
            const creditPayload = {
                points: reward.points,
                description: `Reward for your contribution to generation ${generationRecord._id}`,
                rewardType: 'CONTRIBUTOR_REWARD',
                relatedItems: {
                    sourceGenerationId: generationRecord._id.toString(),
                    sourceUserId: generatingUserId,
                }
            };
            await economyService.creditPoints(reward.contributorId, {
                points: creditPayload.points,
                description: creditPayload.description,
                rewardType: creditPayload.rewardType,
                relatedItems: creditPayload.relatedItems,
            });
            logger.debug(`[distributeContributorRewards] Successfully credited ${reward.points} points to contributor ${reward.contributorId}.`);
            rewardBreakdown.push({
                contributorId: reward.contributorId,
                points: reward.points,
                status: 'credited'
            });
        } catch (error) {
            logger.error(`[distributeContributorRewards] FAILED to credit contributor ${reward.contributorId} for generation ${generationRecord._id}. Error:`, error.message);
            rewardBreakdown.push({
                contributorId: reward.contributorId,
                points: reward.points,
                status: 'failed',
                error: error.message
            });
        }
    }
    
    logger.debug(`[distributeContributorRewards] Calculation complete. Base: ${basePoints}, Rewards: ${totalPointsDistributed}, Total Charge: ${totalPointsToCharge}.`);
    
    return { totalPointsToCharge, totalRewards: totalPointsDistributed, rewardBreakdown };
}


// This function is no longer needed as we are using a points-based system and a single reward function.
/*
async function issueCredit(masterAccountId, payload, { internalApiClient, logger }) {
    if (!masterAccountId) {
        throw new Error('masterAccountId is required for credit.');
    }
    const creditEndpoint = `/internal/v1/data/users/${masterAccountId}/economy/credit`;
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
*/
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

  const debitEndpoint = `/internal/v1/data/users/${masterAccountId}/economy/debit`;
  const requestOptions = {
    headers: {
      'X-Internal-Client-Key': process.env.INTERNAL_API_KEY_WEB,
    },
  };
  if (!process.env.INTERNAL_API_KEY_WEB) {
    logger.warn(`[Webhook Processor - issueDebit] INTERNAL_API_KEY_WEB is not set. Debit call to ${debitEndpoint} may fail authentication.`);
  }

  logger.debug(`[Webhook Processor - issueDebit] Sending POST to ${debitEndpoint} for user ${masterAccountId}. Payload:`, JSON.stringify(payload));
  
  try {
    const response = await internalApiClient.post(debitEndpoint, payload, requestOptions);
    // Assuming a successful response is 2xx. The internalApiClient might throw for non-2xx.
    logger.debug(`[Webhook Processor - issueDebit] Debit request successful for user ${masterAccountId}. Response status: ${response.status}`);
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


/**
 * Convert costUsd from various formats to a number for WebSocket consumption
 * @param {any} costUsd - Cost value from database (Decimal128, number, string, or null)
 * @returns {number|null} - Converted number or null
 */
function _convertCostUsdForWebSocket(costUsd) {
  if (costUsd === null || costUsd === undefined) {
    return null;
  }

  // Handle Decimal128 objects
  if (costUsd && typeof costUsd === 'object' && costUsd.toString) {
    try {
      return parseFloat(costUsd.toString());
    } catch (e) {
      return null;
    }
  }

  // Handle MongoDB $numberDecimal format
  if (costUsd && typeof costUsd === 'object' && costUsd.$numberDecimal) {
    try {
      return parseFloat(costUsd.$numberDecimal);
    } catch (e) {
      return null;
    }
  }

  // Handle string or number
  if (typeof costUsd === 'string' || typeof costUsd === 'number') {
    const num = parseFloat(costUsd);
    return isNaN(num) ? null : num;
  }

  return null;
}

module.exports = {
  processComfyDeployWebhook,
  processRunPayload,
  getActiveJobProgress: () => activeJobProgress
}; 
