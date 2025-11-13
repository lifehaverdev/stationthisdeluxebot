/**
 * StepContinuator - Handles step continuation logic
 * 
 * Orchestrates the continuation of spell execution after a step completes.
 * This is the CRITICAL path that handles step completion and spell finalization.
 */

const { validateGenerationMetadata } = require('../utils/ValidationUtils');

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
            await this.castManager.updateCastWithGeneration(
                castId,
                completedGeneration._id.toString(),
                completedGeneration.costUsd
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

        // Check if there are more steps
        if (nextStepIndex < spell.steps.length) {
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
            // Finalize spell
            await this._finalizeSpell(
                spell,
                castId,
                stepGenerationIds,
                completedGeneration,
                originalContext
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
     */
    async _finalizeSpell(spell, castId, stepGenerationIds, completedGeneration, originalContext) {
        // Check if cast is already completed to prevent duplicate finalization
        if (castId) {
            const isCompleted = await this.castManager.checkCastStatus(castId);
            if (isCompleted) {
                this.logger.warn(`[StepContinuator] Cast ${castId} is already completed. Skipping duplicate finalization.`);
                return; // Already finalized, skip
            }
        }

        this.logger.info(`[StepContinuator] Spell "${spell.name}" finished successfully. Creating final notification record.`);

        // Finalize cast
        if (castId) {
            await this.castManager.finalizeCast(castId);
        }

        // Aggregate costs
        const { totalCostUsd, totalPointsSpent } = await this.costAggregator.aggregateCosts(stepGenerationIds);

        // Create final generation record
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
            status: 'completed',
            deliveryStatus: 'pending', // So the dispatcher picks it up
            notificationPlatform: originalContext.platform,
            deliveryStrategy: 'cook_piece',
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
                    replyToMessageId: originalContext.telegramContext?.messageId
                },
                // Cook linkage
                ...(originalContext.collectionId ? { collectionId: originalContext.collectionId } : {}),
                ...(originalContext.cookId ? { cookId: originalContext.cookId } : {}),
                ...(originalContext.jobId ? { jobId: originalContext.jobId } : {}),
                ...(originalContext.pieceIndex !== undefined ? { pieceIndex: originalContext.pieceIndex } : {})
            }
        };

        await this.generationRecordManager.createGenerationRecord(finalGenerationParams);
        this.logger.info(`[StepContinuator] Final notification record for spell "${spell.name}" created.`);
    }
}

module.exports = StepContinuator;

