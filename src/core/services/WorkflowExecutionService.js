const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

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
        
        // Normalize the 'prompt' parameter to 'input_prompt' for consistency.
        if (context.parameterOverrides && context.parameterOverrides.prompt && !context.parameterOverrides.input_prompt) {
            this.logger.info('[WorkflowExecution] Adding alias "input_prompt" for provided "prompt" input.');
            context.parameterOverrides.input_prompt = context.parameterOverrides.prompt;
            // Keep original 'prompt' key so tools that expect it still work.
        }

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
        let tool = this.toolRegistry.findByDisplayName(step.toolIdentifier);
        if (!tool) {
            // Fallback: attempt lookup by toolId
            tool = this.toolRegistry.getToolById(step.toolIdentifier);
        }
        if (!tool) {
            throw new Error(`Tool with name or ID '${step.toolIdentifier}' not found in registry for step ${step.stepId} of spell "${spell.name}".`);
        }

        this.logger.info(`[WorkflowExecution] Found tool for step ${step.stepId}: "${tool.displayName}". Inspecting tool object...`);
        this.logger.info(`[WorkflowExecution] Tool metadata: ${JSON.stringify(tool.metadata)}`);
        this.logger.info(`[WorkflowExecution] Tool service: ${tool.service}`);

        this.logger.info(`[WorkflowExecution] Executing Step ${stepIndex + 1}/${spell.steps.length}: ${tool.displayName}`);

        // --- NEW: resolve parameterMappings (preferred over parameterOverrides) ---
        const resolvedParamInputs = {};
        if (step.parameterMappings) {
            Object.entries(step.parameterMappings).forEach(([paramKey, mapping]) => {
                if (!mapping || typeof mapping !== 'object') return;
                switch (mapping.type) {
                    case 'static': {
                        const v = mapping.value;
                        const isEmptyString = typeof v === 'string' && v.trim() === '';
                        if (v !== undefined && v !== null && !isEmptyString) {
                            resolvedParamInputs[paramKey] = v;
                        }
                        break;
                    }
                    case 'nodeOutput': {
                        const val =
                            pipelineContext[mapping.outputKey] ||
                            pipelineContext[`${mapping.nodeId}_${mapping.outputKey}`] ||
                            pipelineContext[mapping.paramKey];
                        if (val !== undefined) resolvedParamInputs[paramKey] = val;
                        break;
                    }
                    default:
                        // Unsupported mapping type – ignore silently for now
                        break;
                }
            });
        }

        // Merge with precedence:
        // 1) existing context from previous steps / user inputs
        // 2) resolved mappings for this step (explicit wiring)
        // 3) legacy parameterOverrides (highest priority)
        let stepInput = { ...pipelineContext, ...resolvedParamInputs, ...step.parameterOverrides };

        // ---- Schema-based pruning ----
        if (tool && tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
            const allowed = new Set(Object.keys(tool.inputSchema));
            const pruned = {};
            Object.entries(stepInput).forEach(([k, v]) => {
                if (allowed.has(k)) pruned[k] = v;
            });
            const removed = Object.keys(stepInput).filter(k => !allowed.has(k));
            if (removed.length) {
                this.logger.debug(`[WorkflowExecution] Pruned unmapped inputs for ${tool.displayName}: ${removed.join(', ')}`);
            }
            stepInput = pruned;
        }

        // ---- Runtime validation of required inputs ----
        if (tool && tool.inputSchema) {
            const missing = Object.entries(tool.inputSchema)
                .filter(([key, def]) => {
                    const required = def.required !== false; // default to required
                    if (!required) return false;
                    const val = stepInput[key];
                    if (val === undefined || val === null) return true;
                    if (typeof val === 'string' && val.trim() === '') return true;
                    return false;
                })
                .map(([key]) => key);

            if (missing.length) {
                this.logger.warn(`[WorkflowExecution] Missing required inputs for tool '${tool.displayName}' (step ${step.stepId} of spell '${spell.name}'): ${missing.join(', ')}`);
                // TODO: emit metric 'spell_missing_input' with tags { toolId, spellId }
            }
        }

        // Still support nodeOutput objects inside legacy parameterOverrides
        Object.entries(step.parameterOverrides || {}).forEach(([key, val]) => {
            if (val && val.type === 'nodeOutput') {
                const mappedVal =
                    pipelineContext[val.outputKey] ||
                    pipelineContext[val.paramKey] ||
                    pipelineContext[`${val.nodeId}_${val.outputKey}`];
                if (mappedVal !== undefined) {
                    stepInput[key] = mappedVal;
                }
            }
        });

        // Prepare tool run payload (may include LoRA resolution, etc.)
        const { inputs: finalInputs, loraResolutionData } = await this.workflowsService.prepareToolRunPayload(
            tool.toolId,
            stepInput,
            originalContext.masterAccountId,
            { internal: { client: this.internalApiClient } }
        );


        const eventPayload = {
            masterAccountId: originalContext.masterAccountId,
            eventType: 'spell_step_triggered',
            sourcePlatform: originalContext.platform,
            eventData: { spellId: spell._id, stepId: step.stepId, toolId: tool.toolId }
        };
        const eventResponse = await this.internalApiClient.post('/internal/v1/data/events', eventPayload);
        const eventId = eventResponse.data._id;

        // --- Refactored: Use centralized execution endpoint ---
        const executionPayload = {
            toolId: tool.toolId,
            inputs: finalInputs,
            user: {
                masterAccountId: originalContext.masterAccountId,
                platform: originalContext.platform,
                platformId: originalContext.platformId,
                platformContext: originalContext.platformContext || {},
            },
            eventId: eventId,
            metadata: {
                isSpell: true,
                castId: originalContext.castId || null,
                spell: typeof spell.toObject === 'function' ? spell.toObject() : spell,
                stepIndex,
                pipelineContext,
                originalContext,
                loraResolutionData,
                notificationContext: {
                    type: 'spell_step_completion',
                    spellId: spell._id,
                    stepIndex,
                },
                // --- Cook integration ---
                ...(originalContext.collectionId ? { collectionId: originalContext.collectionId } : {}),
                ...(originalContext.cookId ? { cookId: originalContext.cookId } : {}),
                ...(originalContext.jobId ? { jobId: originalContext.jobId } : {}),
                ...(originalContext.pieceIndex!==undefined ? { pieceIndex: originalContext.pieceIndex } : {}),
            },
        };

        let executionResponse;
        try {
            executionResponse = await this.internalApiClient.post('/internal/v1/data/execute', executionPayload);
            this.logger.info(`[WorkflowExecution] Step ${stepIndex + 1} submitted via centralized execution endpoint. GenID: ${executionResponse.data.generationId}, RunID: ${executionResponse.data.runId}`);
        } catch (err) {
            this.logger.error(`[WorkflowExecution] Error submitting step ${stepIndex + 1} to execution endpoint: ${err.message}`);
            throw err;
        }

        // Handle immediate delivery tools (e.g., LLMs)
        if (tool.deliveryMode === 'immediate' && executionResponse.data && executionResponse.data.response) {
            this.logger.info(`[WorkflowExecution] Immediate tool response for step ${stepIndex + 1}: ${JSON.stringify(executionResponse.data.response).substring(0,200)}...`);

            // --- NEW: persist responsePayload so downstream steps can consume it ---
            try {
                if(executionResponse.data.generationId){
                    await this.internalApiClient.put(`/internal/v1/data/generations/${executionResponse.data.generationId}`, {
                        responsePayload: { result: executionResponse.data.response }
                    });
                } else {
                    this.logger.warn('[WorkflowExecution] No generationId returned for immediate tool; skipping DB update.');
                }
            } catch(err){
                this.logger.error('[WorkflowExecution] Failed to update generation with immediate response:', err.message);
            }

            // Send generalized tool-response via WebSocket
            try {
                const websocketService = require('./websocket/server');
                websocketService.sendToUser(
                    originalContext.masterAccountId,
                    {
                        type: 'tool-response',
                        payload: {
                            toolId: tool.toolId,
                            output: executionResponse.data.response,
                            requestId: originalContext.requestId || null,
                            castId: originalContext.castId || null
                        }
                    }
                );
            } catch (err) {
                this.logger.error(`[WorkflowExecution] Failed to send tool-response via WebSocket: ${err.message}`);
            }
            return executionResponse.data.response;
        }

        // If immediate response handled, manually advance the spell since NotificationDispatcher will not yet have the payload.
        if (tool.deliveryMode === 'immediate') {
            const fakeGenerationRecord = {
                _id: executionResponse.data.generationId,
                responsePayload: { result: executionResponse.data.response },
                metadata: {
                   spell,
                   stepIndex,
                   pipelineContext,
                   originalContext,
                }
            };
            await this.continueExecution(fakeGenerationRecord);
            return executionResponse.data.response;
        }
        // For webhook tools, the NotificationDispatcher will handle the rest.
    }

    /**
     * Called by the NotificationDispatcher when a spell step is complete.
     * It processes the output and triggers the next step or finalizes the spell.
     * @param {object} completedGeneration - The completed generation record for the step.
     */
    async continueExecution(completedGeneration) {
        const { spell, stepIndex, pipelineContext, originalContext } = completedGeneration.metadata;
        this.logger.info(`[WorkflowExecution] Continuing spell "${spell.name}". Finished step ${stepIndex + 1}.`);
        // --- Update parent cast document with newly completed step generation ---
        if (completedGeneration.metadata?.castId) {
            const castId = completedGeneration.metadata.castId;
            try {
                const costDelta = typeof completedGeneration.costUsd === 'number' ? completedGeneration.costUsd : 0;
                await this.internalApiClient.put(`/internal/v1/data/spells/casts/${castId}`, {
                    generationId: completedGeneration._id.toString(),
                    costDeltaUsd: costDelta,
                });
                this.logger.info(`[WorkflowExecution] Updated cast ${castId} with generation ${completedGeneration._id} (costUsd=${costDelta}).`);
            } catch (err) {
                this.logger.error(`[WorkflowExecution] Failed to update cast ${castId}:`, err.message);
            }
        }

        // Accumulate step generation IDs
        const previousStepGenIds = (pipelineContext && pipelineContext.stepGenerationIds) ? pipelineContext.stepGenerationIds : [];
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
            // There are more steps, execute the next one.
            this.logger.info(`[WorkflowExecution] Proceeding to step ${nextStepIndex + 1} of "${spell.name}".`);
            // Propagate castId to the next step
            const contextForNextStep = { ...nextPipelineContext, stepGenerationIds, castId: completedGeneration.metadata.castId };
            await this._executeStep(spell, nextStepIndex, contextForNextStep, originalContext);
        } else {
            // This was the last step. The spell is finished.
            this.logger.info(`[WorkflowExecution] Spell "${spell.name}" finished successfully. Creating final notification record.`);
            
            // Final update to the cast document
            const { castId } = completedGeneration.metadata;
            if (castId) {
                try {
                    await this.internalApiClient.put(`/internal/v1/data/spells/casts/${castId}`, {
                        status: 'completed',
                        costDeltaUsd: '0' // Final cost is already summed up from steps
                    });
                } catch (err) {
                    this.logger.error(`[WorkflowExecution] Failed to finalize cast ${castId}:`, err.message);
                }
            }

            // ---- Aggregate cost/points across all step generations ----
            let totalCostUsd = 0;
            let totalPointsSpent = 0;
            try {
                if (stepGenerationIds && stepGenerationIds.length > 0) {
                    const queryString = stepGenerationIds.map(id => `_id_in=${id}`).join('&');
                    const genRes = await this.internalApiClient.get(`/internal/v1/data/generations?${queryString}`);
                    const stepGens = genRes.data.generations || [];
                    totalCostUsd = stepGens.reduce((sum, g) => {
                        const val = g.costUsd !== undefined && g.costUsd !== null ? Number(g.costUsd) : 0;
                        return sum + (isNaN(val) ? 0 : val);
                    }, 0);
                    totalPointsSpent = stepGens.reduce((sum, g) => {
                        const val = g.pointsSpent !== undefined && g.pointsSpent !== null ? Number(g.pointsSpent) : 0;
                        return sum + (isNaN(val) ? 0 : val);
                    }, 0);
                }
            } catch (err) {
                this.logger.warn('[WorkflowExecution] Failed to aggregate cost for final spell generation:', err.message);
            }

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
            await this.internalApiClient.post('/internal/v1/data/generations', finalGenerationParams);
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