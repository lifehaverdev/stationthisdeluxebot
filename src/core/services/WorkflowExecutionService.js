const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { retryWithBackoff } = require('./workflow/utils/RetryHandler');
const { createEvent } = require('./workflow/utils/EventManager');
const { validateStepIndex, validateStep, validateTool, validateRequiredInputs, validateGenerationMetadata } = require('./workflow/utils/ValidationUtils');
const CastManager = require('./workflow/management/CastManager');
const GenerationRecordManager = require('./workflow/management/GenerationRecordManager');
const CostAggregator = require('./workflow/management/CostAggregator');
const StepExecutor = require('./workflow/execution/StepExecutor');
const SpellExecutor = require('./workflow/execution/SpellExecutor');

class WorkflowExecutionService {
    constructor({ logger, toolRegistry, comfyUIService, internalApiClient, db, workflowsService }) {
        this.logger = logger;
        this.toolRegistry = toolRegistry;
        this.comfyuiService = comfyUIService;
        this.internalApiClient = internalApiClient;
        this.db = db; // Contains generationOutputs
        this.workflowsService = workflowsService;
        
        // Initialize management services
        this.castManager = new CastManager({ logger, internalApiClient });
        this.generationRecordManager = new GenerationRecordManager({ logger, internalApiClient });
        this.costAggregator = new CostAggregator({ logger, internalApiClient });
        
        // Initialize execution services
        const adapterRegistry = require('./adapterRegistry');
        this.stepExecutor = new StepExecutor({
            logger,
            toolRegistry,
            workflowsService,
            internalApiClient,
            adapterRegistry,
            generationRecordManager: this.generationRecordManager
        });
        this.spellExecutor = new SpellExecutor({
            logger,
            stepExecutor: this.stepExecutor
        });
    }

    /**
     * Kicks off the execution of a spell.
     * This method is fire-and-forget. It starts the first step, and the
     * NotificationDispatcher will drive the rest of the execution.
     * @param {object} spell - The spell document.
     * @param {object} context - The initial execution context from the /cast command.
     */
    async execute(spell, context) {
        // Delegate to SpellExecutor
        await this.spellExecutor.execute(spell, context);
    }

    /**
     * Executes a single step of a spell, creating a generation record that will be
     * picked up by the NotificationDispatcher.
     * @private
     * NOTE: This method is kept for backward compatibility with continueExecution.
     * It delegates to StepExecutor which uses Execution Strategy pattern.
     */
    async _executeStep(spell, stepIndex, pipelineContext, originalContext) {
        // Delegate to StepExecutor - uses Execution Strategy pattern (no conditionals!)
        await this.stepExecutor.executeStep(spell, stepIndex, pipelineContext, originalContext);
    }

    /**
     * Called by the NotificationDispatcher when a spell step is complete.
     * It processes the output and triggers the next step or finalizes the spell.
     * @param {object} completedGeneration - The completed generation record for the step.
     */
    async continueExecution(completedGeneration) {
        // --- CRITICAL: Validate required metadata ---
        try {
            validateGenerationMetadata(completedGeneration);
        } catch (error) {
            this.logger.error(`[WorkflowExecution] continueExecution validation error: ${error.message}`);
            throw error;
        }
        
        const { spell, stepIndex, pipelineContext, originalContext } = completedGeneration.metadata;
        
        // --- CRITICAL: Check if generation failed ---
        if (completedGeneration.status === 'failed') {
            this.logger.error(`[WorkflowExecution] Step ${stepIndex + 1} of spell "${spell.name}" failed. Stopping spell execution.`);
            
            // Update cast status to failed
            if (completedGeneration.metadata?.castId) {
                const castId = completedGeneration.metadata.castId;
                    const failureReason = completedGeneration.metadata?.error?.message || 
                                        completedGeneration.metadata?.errorDetails?.message ||
                                        completedGeneration.deliveryError ||
                                        'Step execution failed';
                await this.castManager.updateCastStatusToFailed(castId, failureReason);
            }
            
            // Don't continue to next step
            return;
        }
        
        this.logger.info(`[WorkflowExecution] Continuing spell "${spell.name}". Finished step ${stepIndex + 1}.`);
        
        // --- CRITICAL: Check if this step has already been processed to prevent duplicate execution ---
        // This must happen BEFORE updating the cast to avoid race conditions
        const { castId } = completedGeneration.metadata;
        if (castId) {
            const { alreadyProcessed, nextStepAlreadyExecuted } = await this.castManager.checkForDuplicateGeneration(
                castId,
                completedGeneration._id.toString(),
                stepIndex
            );
            
                    if (alreadyProcessed) {
                this.logger.warn(`[WorkflowExecution] Step ${stepIndex + 1} of spell "${spell.name}" has already been processed (generation ${completedGeneration._id} already in cast). Skipping duplicate execution.`);
                        return; // Already processed, skip
                    }
                    
            if (nextStepAlreadyExecuted) {
                    const nextStepIndex = stepIndex + 1;
                this.logger.warn(`[WorkflowExecution] Step ${nextStepIndex + 1} of spell "${spell.name}" appears to have already been executed. Skipping duplicate execution.`);
                        return; // Already executed, skip
            }
        }
        
        // --- Update parent cast document with newly completed step generation ---
        if (castId) {
            await this.castManager.updateCastWithGeneration(
                castId,
                completedGeneration._id.toString(),
                completedGeneration.costUsd
            );
        }

        // Accumulate step generation IDs with validation
        let previousStepGenIds = [];
        if (pipelineContext && Array.isArray(pipelineContext.stepGenerationIds)) {
            previousStepGenIds = pipelineContext.stepGenerationIds;
        } else if (pipelineContext && pipelineContext.stepGenerationIds) {
            this.logger.warn(`[WorkflowExecution] pipelineContext.stepGenerationIds is not an array, resetting`);
        }
        
        if (!completedGeneration._id) {
            this.logger.error('[WorkflowExecution] completedGeneration missing _id');
            throw new Error('Generation record missing _id');
        }
        
        const stepGenerationIds = [...previousStepGenIds, completedGeneration._id];
        this.logger.info(`[WorkflowExecution] Accumulated step generation IDs for spell "${spell.name}": ${stepGenerationIds.length} steps.`);

        // Get the current step definition to check for outputMappings
        const currentStep = spell.steps[stepIndex];
        const outputMappings = currentStep.outputMappings || {};
        
        // Extract generic output formats
        let stepOutput = (completedGeneration.responsePayload?.[0]?.data) || completedGeneration.responsePayload || {};

        // --- Normalise to common fields ---
        if(stepOutput === null) stepOutput = {};
        // OpenAI/LLM variants
        if(stepOutput.result && !stepOutput.text) stepOutput.text = stepOutput.result;
        if(stepOutput.response && !stepOutput.text) stepOutput.text = stepOutput.response;
        if(Array.isArray(stepOutput.choices) && stepOutput.choices[0]?.message?.content && !stepOutput.text){
           stepOutput.text = stepOutput.choices[0].message.content;
        }
        if(stepOutput.output && typeof stepOutput.output === 'string' && !stepOutput.text){
           stepOutput.text = stepOutput.output;
        }

        const next_inputs = {};
        if (stepOutput) {
            this.logger.info(`[WorkflowExecution] Processing output from step ${stepIndex + 1}. Mappings: ${JSON.stringify(outputMappings)}`, { stepOutput });
            
            // Validate output is not empty
            if (Object.keys(stepOutput).length === 0) {
                this.logger.warn(`[WorkflowExecution] Step ${stepIndex + 1} produced empty output. Next step may fail if it requires inputs.`);
            }
            
            // Handle the common case of chaining image outputs to image inputs
            if (Array.isArray(stepOutput.images) && stepOutput.images.length > 0 && stepOutput.images[0].url) {
                // If there's no explicit mapping for 'images', default to mapping it to 'input_image'
                if (!outputMappings || !outputMappings.images) {
                    const imageUrl = stepOutput.images[0].url;
                    next_inputs.input_image = imageUrl;
                    this.logger.info(`[WorkflowExecution] Mapped "images" output to "input_image" via default convention with URL: ${imageUrl}`);
                }
            }
            
            for (const outputKey in stepOutput) {
                // 1. Check for an explicit mapping
                if (outputMappings[outputKey]) {
                    const inputKey = outputMappings[outputKey];
                    next_inputs[inputKey] = stepOutput[outputKey];
                    this.logger.info(`[WorkflowExecution] Mapped output "${outputKey}" to input "${inputKey}".`);
                // 2. Fallback to the prefix convention if no explicit mapping exists
                } else if (outputKey.startsWith('output_')) {
                    const inputKey = 'input_' + outputKey.substring('output_'.length);
                    next_inputs[inputKey] = stepOutput[outputKey];
                    this.logger.info(`[WorkflowExecution] Mapped output "${outputKey}" to input "${inputKey}" via default convention.`);
                } else {
                // 3. Carry over any other fields that don't match
                    // Avoid overwriting a more specific mapping (like input_image) with a broader one (like the images array)
                    if (!next_inputs[outputKey]) {
                        next_inputs[outputKey] = stepOutput[outputKey];
                    }
                }
            }
            // No hard-coded fallbacks here – mapping must be defined in spell JSON.
        }
        
        const nextPipelineContext = { ...pipelineContext, ...stepOutput, ...next_inputs };
        const nextStepIndex = stepIndex + 1;

        if (nextStepIndex < spell.steps.length) {
            // Note: Duplicate check for next step already happened above before cast update
            // There are more steps, execute the next one.
            this.logger.info(`[WorkflowExecution] Proceeding to step ${nextStepIndex + 1} of "${spell.name}".`);
            // Propagate castId to the next step
            const contextForNextStep = { ...nextPipelineContext, stepGenerationIds, castId: completedGeneration.metadata.castId };
            await this._executeStep(spell, nextStepIndex, contextForNextStep, originalContext);
        } else {
            // This was the last step. The spell is finished.
            
            // CRITICAL: Check if cast is already completed to prevent duplicate finalization
            // castId is already defined above
            if (castId) {
                const isCompleted = await this.castManager.checkCastStatus(castId);
                if (isCompleted) {
                        this.logger.warn(`[WorkflowExecution] Cast ${castId} is already completed. Skipping duplicate finalization.`);
                        return; // Already finalized, skip
                }
            }
            
            this.logger.info(`[WorkflowExecution] Spell "${spell.name}" finished successfully. Creating final notification record.`);
            
            // Final update to the cast document
            if (castId) {
                await this.castManager.finalizeCast(castId);
            }

            // ---- Aggregate cost/points across all step generations ----
            const { totalCostUsd, totalPointsSpent } = await this.costAggregator.aggregateCosts(stepGenerationIds);

            // Create a *new* final generation record that the dispatcher will handle normally.
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
                    }
                    ,
                    // Cook linkage
                    ...(originalContext.collectionId ? { collectionId: originalContext.collectionId } : {}),
                    ...(originalContext.cookId ? { cookId: originalContext.cookId } : {}),
                    ...(originalContext.jobId ? { jobId: originalContext.jobId } : {}),
                    ...(originalContext.pieceIndex!==undefined ? { pieceIndex: originalContext.pieceIndex } : {})
                }
            };
            await this.generationRecordManager.createGenerationRecord(finalGenerationParams);
            this.logger.info(`[WorkflowExecution] Final notification record for spell "${spell.name}" created.`);
        }
    }

    async executeGpt(tool, originalContext, mergedInputs, dependencies) {
        const { logger } = dependencies;
        const { masterAccountId, platform, notification } = originalContext;

        try {
             // --- User Handling ---
            

            // --- Event Logging ---
            const eventPayload = {
                masterAccountId: masterAccountId,
                eventType: 'gpt_execution_triggered',
                sourcePlatform: platform,
                eventData: {
                    toolId: tool.toolId
                }
            };
            const eventResponse = await this.internalApiClient.post('/internal/v1/data/events', eventPayload);
            const eventId = eventResponse.data._id;
            
            // --- OpenAI API Call ---
            const gptResponse = await axios.post(tool.apiPath, {
                // ... existing code ...
            });

            const finalGenerationParams = {
                masterAccountId: masterAccountId,
                initiatingEventId: eventId,
                serviceName: 'openai',
                toolId: tool.toolId,
                requestPayload: mergedInputs,
                responsePayload: { result: gptResponse.data.result },
                metadata: {
                    notificationContext: notification,
                },
                status: 'completed',
                deliveryStatus: 'pending',
                notificationPlatform: notification.platform,
            };

            await this.internalApiClient.post('/internal/v1/data/generations', finalGenerationParams);

            return { success: true };

        } catch (error) {
            // ... existing code ...
        }
    }
}

module.exports = WorkflowExecutionService; 