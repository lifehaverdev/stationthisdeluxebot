const { v4: uuidv4 } = require('uuid');

class WorkflowExecutionService {
    constructor({ logger, toolRegistry, comfyUIService, internalApiClient, db, workflowsService }) {
        this.logger = logger;
        this.toolRegistry = toolRegistry;
        this.comfyuiService = comfyUIService;
        this.internalApiClient = internalApiClient;
        this.db = db; // Contains generationOutputs
        this.workflowsService = workflowsService;
    }

    /**
     * Kicks off the execution of a spell.
     * This method is fire-and-forget. It starts the first step, and the
     * NotificationDispatcher will drive the rest of the execution.
     * @param {object} spell - The spell document.
     * @param {object} context - The initial execution context from the /cast command.
     */
    async execute(spell, context) {
        this.logger.info(`[WorkflowExecution] Starting execution for spell: "${spell.name}" (ID: ${spell._id})`);
        // The initial pipeline context starts with the global parameters from the /cast command.
        const initialPipelineContext = { ...context.parameterOverrides };
        await this._executeStep(spell, 0, initialPipelineContext, context);
    }

    /**
     * Executes a single step of a spell, creating a generation record that will be
     * picked up by the NotificationDispatcher.
     * @private
     */
    async _executeStep(spell, stepIndex, pipelineContext, originalContext) {
        const step = spell.steps[stepIndex];
        const tool = this.toolRegistry.getToolById(step.toolId);
        if (!tool) {
            throw new Error(`Tool with ID '${step.toolId}' not found in registry for step ${step.stepId}.`);
        }

        this.logger.info(`[WorkflowExecution] Found tool for step ${step.stepId}: "${tool.displayName}". Inspecting tool object...`);
        this.logger.info(`[WorkflowExecution] Tool metadata: ${JSON.stringify(tool.metadata)}`);
        this.logger.info(`[WorkflowExecution] Tool service: ${tool.service}`);

        this.logger.info(`[WorkflowExecution] Executing Step ${stepIndex + 1}/${spell.steps.length}: ${tool.displayName}`);

        const stepInput = { ...pipelineContext, ...step.parameterOverrides };
        const { inputs: finalInputsForComfyUI } = await this.workflowsService.prepareToolRunPayload(tool.toolId, stepInput, originalContext.masterAccountId);

        // Find or create a session for this execution
        let sessionId;
        try {
            const activeSessionsResponse = await this.internalApiClient.get(`/v1/data/users/${originalContext.masterAccountId}/sessions/active?platform=${originalContext.platform}`);
            if (activeSessionsResponse.data && activeSessionsResponse.data.length > 0) {
                sessionId = activeSessionsResponse.data[0]._id;
            } else {
                const newSessionResponse = await this.internalApiClient.post('/v1/data/sessions', { masterAccountId: originalContext.masterAccountId, platform: originalContext.platform, userAgent: 'Spell Execution' });
                sessionId = newSessionResponse.data._id;
            }
        } catch (e) {
            this.logger.error(`[WorkflowExecution] Could not get or create a session for MAID ${originalContext.masterAccountId}`, e.response ? e.response.data : e.message);
            // Don't throw, attempt to proceed without a session if we must
        }

        const eventPayload = {
            masterAccountId: originalContext.masterAccountId,
            sessionId: sessionId,
            eventType: 'spell_step_triggered',
            sourcePlatform: originalContext.platform,
            eventData: { spellId: spell._id, stepId: step.stepId, toolId: tool.toolId }
        };
        const eventResponse = await this.internalApiClient.post('/v1/data/events', eventPayload);
        const eventId = eventResponse.data._id;

        const generationParams = {
            masterAccountId: originalContext.masterAccountId,
            sessionId: sessionId,
            initiatingEventId: eventId,
            serviceName: tool.service,
            toolId: tool.toolId,
            requestPayload: finalInputsForComfyUI,
            metadata: {
                isSpell: true,
                spell: typeof spell.toObject === 'function' ? spell.toObject() : spell, // Embed the full spell definition
                stepIndex,
                pipelineContext,
                originalContext,
            },
            deliveryStrategy: 'spell_step', // Special strategy for the dispatcher
            deliveryStatus: 'pending',
            notificationPlatform: originalContext.platform,
            status: 'pending', // Explicitly set status to pending
        };

        let generationId;
        try {
            this.logger.info(`[WorkflowExecution] Preparing to log generation for spell "${spell.name}", step ${stepIndex + 1}.`);
            const generationResponse = await this.internalApiClient.post('/v1/data/generations', generationParams);
            generationId = generationResponse.data._id;
            this.logger.info(`[WorkflowExecution] Logged generation ${generationId} successfully.`);

            // DIAGNOSTIC: Immediately fetch the record back to check its status
            const checkResponse = await this.internalApiClient.get(`/v1/data/generations/${generationId}`);
            this.logger.info(`[WorkflowExecution] DIAGNOSTIC CHECK: Fetched generation ${generationId} immediately after creation. Status is: "${checkResponse.data.status}"`);

        } catch(e) {
            this.logger.error(`[WorkflowExecution] FAILED to post generation record for spell "${spell.name}". Error: ${e.message}`, { 
                responseData: e.response?.data,
                // Avoid logging the whole params object if it's huge or has circular refs, just log keys or specific fields
                generationParamKeys: Object.keys(generationParams),
                metadataKeys: Object.keys(generationParams.metadata),
            });
            throw e; // Re-throw the error to be caught by the bot
        }
        
        const submissionResult = await this.comfyuiService.submitRequest({
            deploymentId: tool.metadata.deploymentId,
            inputs: finalInputsForComfyUI,
        });

        const run_id = (typeof submissionResult === 'string') ? submissionResult : submissionResult?.run_id;

        if (run_id) {
            await this.internalApiClient.put(`/v1/data/generations/${generationId}`, { "metadata.run_id": run_id, status: 'processing' });
            this.logger.info(`[WorkflowExecution] Step ${stepIndex + 1} submitted. GenID: ${generationId}, RunID: ${run_id}`);
        } else {
            const errorMessage = submissionResult?.error || 'Unknown error during ComfyUI submission';
            await this.internalApiClient.put(`/v1/data/generations/${generationId}`, { status: 'failed', statusReason: `ComfyUI submission failed: ${errorMessage}` });
            throw new Error(`ComfyUI submission failed for step ${stepIndex + 1}: ${errorMessage}`);
        }
    }

    /**
     * Called by the NotificationDispatcher when a spell step is complete.
     * It processes the output and triggers the next step or finalizes the spell.
     * @param {object} completedGeneration - The completed generation record for the step.
     */
    async continueExecution(completedGeneration) {
        const { spell, stepIndex, pipelineContext, originalContext } = completedGeneration.metadata;
        this.logger.info(`[WorkflowExecution] Continuing spell "${spell.name}". Finished step ${stepIndex + 1}.`);

        // Get the current step definition to check for outputMappings
        const currentStep = spell.steps[stepIndex];
        const outputMappings = currentStep.outputMappings || {};
        
        const stepOutput = completedGeneration.responsePayload?.[0]?.data;
        const next_inputs = {};
        if (stepOutput) {
            this.logger.info(`[WorkflowExecution] Processing output from step ${stepIndex + 1}. Mappings: ${JSON.stringify(outputMappings)}`, { stepOutput });
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
                    next_inputs[outputKey] = stepOutput[outputKey];
                }
            }
        }
        
        const nextPipelineContext = { ...pipelineContext, ...next_inputs };
        const nextStepIndex = stepIndex + 1;

        if (nextStepIndex < spell.steps.length) {
            // There are more steps, execute the next one.
            this.logger.info(`[WorkflowExecution] Proceeding to step ${nextStepIndex + 1} of "${spell.name}".`);
            await this._executeStep(spell, nextStepIndex, nextPipelineContext, originalContext);
        } else {
            // This was the last step. The spell is finished.
            this.logger.info(`[WorkflowExecution] Spell "${spell.name}" finished successfully. Creating final notification record.`);
            
            // Create a *new* final generation record that the dispatcher will handle normally.
            const finalGenerationParams = {
                masterAccountId: originalContext.masterAccountId,
                sessionId: completedGeneration.sessionId,
                initiatingEventId: completedGeneration.initiatingEventId,
                serviceName: 'spells',
                toolId: `spell-${spell.slug}`,
                requestPayload: originalContext.parameterOverrides,
                responsePayload: completedGeneration.responsePayload,
                status: 'completed',
                deliveryStatus: 'pending', // So the dispatcher picks it up
                notificationPlatform: originalContext.platform,
                metadata: {
                    isSpell: true,
                    spellName: spell.name,
                    userInputPrompt: originalContext.parameterOverrides?.input_prompt || '',
                    notificationContext: {
                        platform: originalContext.platform,
                        chatId: originalContext.chatId,
                        replyToMessageId: originalContext.messageId
                    }
                }
            };
            await this.internalApiClient.post('/v1/data/generations', finalGenerationParams);
            this.logger.info(`[WorkflowExecution] Final notification record for spell "${spell.name}" created.`);
        }
    }
}

module.exports = WorkflowExecutionService; 