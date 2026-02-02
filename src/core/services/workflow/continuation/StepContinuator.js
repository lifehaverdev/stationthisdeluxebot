/**
 * StepContinuator - Handles step continuation logic
 * 
 * Orchestrates the continuation of spell execution after a step completes.
 * This is the CRITICAL path that handles step completion and spell finalization.
 */

const { validateGenerationMetadata } = require('../utils/ValidationUtils');
const notificationEvents = require('../../../events/notificationEvents');

class StepContinuator {
    constructor({ logger, castManager, generationRecordManager, costAggregator, stepExecutor }) {
        this.logger = logger;
        this.castManager = castManager;
        this.generationRecordManager = generationRecordManager;
        this.costAggregator = costAggregator;
        this.stepExecutor = stepExecutor;
    }

    /**
     * Continues spell execution after a step completes
     * @param {Object} completedGeneration - Completed generation record
     * @returns {Promise<void>}
     */
    async continue(completedGeneration) {
        // Validate required metadata
        try {
            validateGenerationMetadata(completedGeneration);
        } catch (error) {
            this.logger.error(`[StepContinuator] continue validation error: ${error.message}`);
            throw error;
        }

        const { spell, stepIndex, pipelineContext, originalContext } = completedGeneration.metadata;

        // Check if generation failed
        if (completedGeneration.status === 'failed') {
            await this._handleStepFailure(completedGeneration, spell, stepIndex);
            return; // Don't continue to next step
        }

        this.logger.info(`[StepContinuator] Continuing spell "${spell.name}". Finished step ${stepIndex + 1}.`);

        // Check for duplicate execution (must happen BEFORE updating cast)
        const { castId } = completedGeneration.metadata;
        if (castId) {
            const shouldSkip = await this._checkForDuplicates(castId, completedGeneration._id.toString(), stepIndex, spell);
            if (shouldSkip) {
                return; // Already processed, skip
            }
        }

        // Update cast with completed generation
        if (castId) {
            // Convert costUsd from Decimal128/object to number safely
            let costUsd = 0;
            if (completedGeneration.costUsd !== null && completedGeneration.costUsd !== undefined) {
                if (typeof completedGeneration.costUsd === 'object' && completedGeneration.costUsd._bsontype === 'Decimal128') {
                    costUsd = parseFloat(completedGeneration.costUsd.toString());
                } else if (typeof completedGeneration.costUsd === 'object' && completedGeneration.costUsd.toString) {
                    costUsd = parseFloat(completedGeneration.costUsd.toString());
                } else {
                    costUsd = parseFloat(completedGeneration.costUsd) || 0;
                }
            }
            await this.castManager.updateCastWithGeneration(
                castId,
                completedGeneration._id.toString(),
                costUsd
            );
        }

        // Process output and build next pipeline context
        const OutputProcessor = require('./OutputProcessor');
        const PipelineContextBuilder = require('./PipelineContextBuilder');
        
        const outputProcessor = new OutputProcessor({ logger: this.logger });
        const pipelineContextBuilder = new PipelineContextBuilder({ logger: this.logger });

        const currentStep = spell.steps[stepIndex];
        const { stepOutput, next_inputs } = outputProcessor.processOutput(completedGeneration, currentStep);

        // Accumulate step generation IDs
        const stepGenerationIds = pipelineContextBuilder.accumulateStepGenerationIds(
            pipelineContext,
            completedGeneration._id.toString()
        );
        this.logger.info(`[StepContinuator] Accumulated step generation IDs for spell "${spell.name}": ${stepGenerationIds.length} steps.`);

        // Build next pipeline context
        const nextPipelineContext = pipelineContextBuilder.buildNextPipelineContext(
            pipelineContext,
            stepOutput,
            next_inputs
        );

        const nextStepIndex = stepIndex + 1;
        const isLastStep = nextStepIndex >= spell.steps.length;

        // Check if there are more steps
        if (!isLastStep) {
            // Execute next step
            await this._executeNextStep(
                spell,
                nextStepIndex,
                nextPipelineContext,
                stepGenerationIds,
                castId,
                originalContext
            );
        } else {
            // Finalize spell - this is the last step, so use its output as the final result
            // Don't create a separate final notification record if this step already has the final result
            await this._finalizeSpell(
                spell,
                castId,
                stepGenerationIds,
                completedGeneration,
                originalContext,
                isLastStep
            );
        }
    }

    /**
     * Handles step failure
     * @private
     */
    async _handleStepFailure(completedGeneration, spell, stepIndex) {
        this.logger.error(`[StepContinuator] Step ${stepIndex + 1} of spell "${spell.name}" failed. Stopping spell execution.`);

        // Update cast status to failed
        if (completedGeneration.metadata?.castId) {
            const castId = completedGeneration.metadata.castId;
            const failureReason = completedGeneration.metadata?.error?.message ||
                                completedGeneration.metadata?.errorDetails?.message ||
                                completedGeneration.deliveryError ||
                                'Step execution failed';
            await this.castManager.updateCastStatusToFailed(castId, failureReason);
        }
    }

    /**
     * Checks for duplicate execution
     * @private
     * @returns {Promise<boolean>} - True if should skip (duplicate detected)
     */
    async _checkForDuplicates(castId, generationId, stepIndex, spell) {
        const { alreadyProcessed, nextStepAlreadyExecuted } = await this.castManager.checkForDuplicateGeneration(
            castId,
            generationId,
            stepIndex
        );

        if (alreadyProcessed) {
            this.logger.warn(`[StepContinuator] Step ${stepIndex + 1} of spell "${spell.name}" has already been processed (generation ${generationId} already in cast). Skipping duplicate execution.`);
            return true;
        }

        if (nextStepAlreadyExecuted) {
            const nextStepIndex = stepIndex + 1;
            this.logger.warn(`[StepContinuator] Step ${nextStepIndex + 1} of spell "${spell.name}" appears to have already been executed. Skipping duplicate execution.`);
            return true;
        }

        return false;
    }

    /**
     * Executes the next step
     * @private
     */
    async _executeNextStep(spell, nextStepIndex, nextPipelineContext, stepGenerationIds, castId, originalContext) {
        this.logger.info(`[StepContinuator] Proceeding to step ${nextStepIndex + 1} of "${spell.name}".`);

        // Propagate castId and stepGenerationIds to the next step
        const PipelineContextBuilder = require('./PipelineContextBuilder');
        const pipelineContextBuilder = new PipelineContextBuilder({ logger: this.logger });
        
        const contextForNextStep = pipelineContextBuilder.mergeContexts(nextPipelineContext, {
            stepGenerationIds,
            castId: castId
        });

        await this.stepExecutor.executeStep(spell, nextStepIndex, contextForNextStep, originalContext);
    }

    /**
     * Finalizes the spell
     * @private
     * @param {boolean} isLastStep - Whether this is the last step (to avoid duplicate notifications)
     */
    async _finalizeSpell(spell, castId, stepGenerationIds, completedGeneration, originalContext, isLastStep = false) {
        let finalGenerationRecordForEvent = null;
        // Check if cast is already completed to prevent duplicate finalization
        if (castId) {
            const isCompleted = await this.castManager.checkCastStatus(castId);
            if (isCompleted) {
                this.logger.warn(`[StepContinuator] Cast ${castId} is already completed. Skipping duplicate finalization.`);
                return; // Already finalized, skip
            }
        }

        this.logger.info(`[StepContinuator] Spell "${spell.name}" finished successfully.`);

        // Finalize cast
        if (castId) {
            await this.castManager.finalizeCast(castId);
        }

        // Aggregate costs
        const { totalCostUsd, totalPointsSpent } = await this.costAggregator.aggregateCosts(stepGenerationIds);

        // If this is the last step, update its record to send the final notification
        // This avoids creating a duplicate final record
        if (isLastStep && completedGeneration._id) {
            this.logger.info(`[StepContinuator] Updating final step's generation record to send spell completion notification.`);
            try {
                // Check if cast has webhook URL for webhook delivery
                let webhookUrl = null;
                let webhookSecret = null;
                let notificationPlatform = originalContext.platform || 'none';
                
                if (castId) {
                    try {
                        const castRecord = await this.castManager.getCast(castId);
                        if (castRecord?.metadata?.webhookUrl) {
                            webhookUrl = castRecord.metadata.webhookUrl;
                            webhookSecret = castRecord.metadata.webhookSecret || null;
                            notificationPlatform = 'webhook';
                            this.logger.info(`[StepContinuator] Found webhook URL in cast record ${castId}, will deliver via webhook`);
                        }
                    } catch (castErr) {
                        this.logger.warn(`[StepContinuator] Failed to fetch cast record for webhook check: ${castErr.message}`);
                    }
                }

                // CRITICAL: Always construct notificationContext from originalContext.telegramContext
                // The completedGeneration.metadata.notificationContext might only have step completion info
                // (type: 'spell_step_completion', stepIndex) and not the Telegram context needed for delivery
                // We MUST prioritize originalContext.telegramContext to ensure chatId, messageId, userId are present
                const existingContext = completedGeneration.metadata?.notificationContext || {};
                const notificationContext = {
                    // Preserve any additional context from the completed generation first
                    ...existingContext,
                    // Then override with Telegram context from originalContext (this ensures chatId is always present)
                    platform: originalContext.platform,
                    chatId: originalContext.telegramContext?.chatId || existingContext.chatId,
                    replyToMessageId: originalContext.telegramContext?.messageId || existingContext.replyToMessageId,
                    userId: originalContext.telegramContext?.userId || existingContext.userId
                };
                
                // Final safety check: ensure chatId is present (required for Telegram notifications)
                if (!notificationContext.chatId && notificationPlatform !== 'webhook') {
                    this.logger.warn(`[StepContinuator] No chatId found in notificationContext. originalContext.telegramContext: ${JSON.stringify(originalContext.telegramContext)}`);
                }
                
                // Build update payload
                const updatePayload = {
                    deliveryStrategy: 'spell_final',
                    deliveryStatus: 'pending', // Trigger notification
                    notificationPlatform: notificationPlatform,
                    costUsd: Number(totalCostUsd) || 0,
                    pointsSpent: Number(totalPointsSpent) || 0,
                    protocolNetPoints: Number(totalPointsSpent) || 0,
                    'metadata.stepGenerationIds': stepGenerationIds,
                    'metadata.spellName': spell.name,
                    'metadata.userInputPrompt': originalContext.parameterOverrides?.input_prompt || '',
                    'metadata.notificationContext': notificationContext // CRITICAL: Preserve notificationContext for Telegram delivery
                };

                // Add webhook URL and secret to metadata if webhook delivery
                if (webhookUrl) {
                    updatePayload['metadata.webhookUrl'] = webhookUrl;
                    if (webhookSecret) {
                        updatePayload['metadata.webhookSecret'] = webhookSecret;
                    }
                    updatePayload['metadata.castId'] = castId; // Ensure castId is in metadata for WebhookNotifier
                }
                
                await this.generationRecordManager.updateGenerationRecord(completedGeneration._id.toString(), updatePayload);
                this.logger.info(`[StepContinuator] Updated final step generation record ${completedGeneration._id} for spell completion notification.`);
                
                // Fetch the updated record and emit event manually since status was already 'completed'
                try {
                    const updatedRecord = await this.generationRecordManager.getGenerationRecord(completedGeneration._id.toString());
                    if (updatedRecord && updatedRecord.deliveryStrategy === 'spell_final' && updatedRecord.deliveryStatus === 'pending') {
                        notificationEvents.emit('generationUpdated', updatedRecord);
                        this.logger.info(`[StepContinuator] Emitted generationUpdated event for final spell completion ${completedGeneration._id}`);
                    }
                    finalGenerationRecordForEvent = updatedRecord || completedGeneration;
                } catch (emitErr) {
                    this.logger.error(`[StepContinuator] Failed to emit event for final step: ${emitErr.message}`);
                    finalGenerationRecordForEvent = completedGeneration;
                }
            } catch (updateErr) {
                this.logger.error(`[StepContinuator] Failed to update final step record: ${updateErr.message}`);
                // Fallback: create a new final record if update fails
                finalGenerationRecordForEvent = await this._createFinalNotificationRecord(
                    spell,
                    castId,
                    stepGenerationIds,
                    completedGeneration,
                    originalContext,
                    totalCostUsd,
                    totalPointsSpent
                );
            }
        } else {
            // Create final generation record for spell completion notification
            finalGenerationRecordForEvent = await this._createFinalNotificationRecord(
                spell,
                castId,
                stepGenerationIds,
                completedGeneration,
                originalContext,
                totalCostUsd,
                totalPointsSpent
            );
        }

        try {
            const finalGenerationId = Array.isArray(stepGenerationIds) && stepGenerationIds.length
                ? stepGenerationIds[stepGenerationIds.length - 1]
                : (completedGeneration?._id?.toString() || null);
            notificationEvents.emit('spellCompletion', {
                spellSlug: spell.slug || (spell._id && spell._id.toString()) || null,
                spellId: spell._id ? spell._id.toString() : null,
                castId: castId || null,
                masterAccountId: originalContext?.masterAccountId || null,
                stepGenerationIds,
                finalGenerationId,
                finalGenerationRecord: finalGenerationRecordForEvent || null,
                finalStepSnapshot: {
                    outputs: completedGeneration?.outputs || null,
                    responsePayload: completedGeneration?.responsePayload || null,
                    text: completedGeneration?.text || null,
                    result: completedGeneration?.result || null
                },
                captionTask: originalContext?.captionTask || null,
                embellishmentTask: originalContext?.embellishmentTask || null,
            });
        } catch (emitErr) {
            this.logger.warn(`[StepContinuator] Failed to emit spellCompletion event: ${emitErr.message}`);
        }
    }

    /**
     * Creates a final notification record for spell completion
     * @private
     */
    async _createFinalNotificationRecord(spell, castId, stepGenerationIds, completedGeneration, originalContext, totalCostUsd, totalPointsSpent) {
        const finalGenerationParams = {
            masterAccountId: originalContext.masterAccountId,
            initiatingEventId: completedGeneration.initiatingEventId,
            serviceName: 'comfyui',
            toolId: `spell-${spell.slug || (spell._id && spell._id.toString())}`,
            toolDisplayName: spell.name || `Spell ${spell.slug || (spell._id && spell._id.toString())}`,
            spellId: (spell._id && spell._id.toString()) || null,
            castId: completedGeneration.metadata.castId || null,
            requestPayload: originalContext.parameterOverrides,
            responsePayload: completedGeneration.responsePayload,
            outputs: completedGeneration.outputs || null,
            text: completedGeneration.text || null,
            result: completedGeneration.result || null,
            status: 'completed',
            deliveryStatus: 'pending', // So the dispatcher picks it up
            notificationPlatform: originalContext.platform,
            deliveryStrategy: 'spell_final',
            // Aggregated cost fields
            costUsd: Number(totalCostUsd) || 0,
            pointsSpent: Number(totalPointsSpent) || 0,
            protocolNetPoints: Number(totalPointsSpent) || 0,
            metadata: {
                isSpell: true,
                spellName: spell.name,
                userInputPrompt: originalContext.parameterOverrides?.input_prompt || '',
                stepGenerationIds,
                notificationContext: {
                    platform: originalContext.platform,
                    chatId: originalContext.telegramContext?.chatId,
                    replyToMessageId: originalContext.telegramContext?.messageId,
                    userId: originalContext.telegramContext?.userId
                },
                // Cook linkage
                ...(originalContext.collectionId ? { collectionId: originalContext.collectionId } : {}),
                ...(originalContext.cookId ? { cookId: originalContext.cookId } : {}),
                ...(originalContext.jobId ? { jobId: originalContext.jobId } : {}),
                ...(originalContext.pieceIndex !== undefined ? { pieceIndex: originalContext.pieceIndex } : {})
            }
        };

        const { generationId } = await this.generationRecordManager.createGenerationRecord(finalGenerationParams);
        this.logger.info(`[StepContinuator] Final notification record for spell "${spell.name}" created.`);
        return { _id: generationId, ...finalGenerationParams };
    }
}

module.exports = StepContinuator;
