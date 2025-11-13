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
        // Validate stepIndex bounds
        if (stepIndex < 0 || stepIndex >= spell.steps.length) {
            throw new Error(`Invalid stepIndex ${stepIndex} for spell "${spell.name}" with ${spell.steps.length} steps`);
        }
        
        const step = spell.steps[stepIndex];
        if (!step) {
            throw new Error(`Step at index ${stepIndex} is undefined in spell "${spell.name}"`);
        }
        
        if (!step.toolIdentifier) {
            throw new Error(`Step ${step.stepId || stepIndex} in spell "${spell.name}" is missing toolIdentifier`);
        }
        
        // Validate tool exists before proceeding
        let tool = this.toolRegistry.findByDisplayName(step.toolIdentifier);
        if (!tool) {
            // Fallback: attempt lookup by toolId
            tool = this.toolRegistry.getToolById(step.toolIdentifier);
        }
        if (!tool) {
            throw new Error(`Tool with name or ID '${step.toolIdentifier}' not found in registry for step ${step.stepId || stepIndex} of spell "${spell.name}".`);
        }

        this.logger.info(`[WorkflowExecution] Found tool for step ${step.stepId}: "${tool.displayName}". Inspecting tool object...`);
        this.logger.info(`[WorkflowExecution] Tool metadata: ${JSON.stringify(tool.metadata)}`);
        this.logger.info(`[WorkflowExecution] Tool service: ${tool.service}`);

        this.logger.info(`[WorkflowExecution] Executing Step ${stepIndex + 1}/${spell.steps.length}: ${tool.displayName}`);

        // --- CRITICAL: Create event FIRST (required for initiatingEventId in generation records) ---
        // This must happen before any generation record creation, including async adapter paths
        const eventPayload = {
            masterAccountId: originalContext.masterAccountId,
            eventType: 'spell_step_triggered',
            sourcePlatform: originalContext.platform,
            eventData: { spellId: spell._id, stepId: step.stepId, toolId: tool.toolId }
        };
        const eventResponse = await this.internalApiClient.post('/internal/v1/data/events', eventPayload);
        const eventId = eventResponse.data._id;
        this.logger.info(`[WorkflowExecution] Created event ${eventId} for spell step ${stepIndex + 1}`);

        // --- Adapter-based execution (replaces HTTP Generation API) ---
        const adapterRegistry = require('./adapterRegistry');
        const adapter = adapterRegistry.get(tool.service);
        if (adapter) {
            try {
                // CRITICAL: For immediate tools, skip adapter path entirely - let centralized execution endpoint handle it
                // This ensures immediate tools (like ChatGPT) use execute() via the centralized endpoint, not startJob()
                if (tool.deliveryMode === 'immediate') {
                    this.logger.info(`[WorkflowExecution] Tool ${tool.toolId} is immediate - skipping adapter path, using centralized execution endpoint`);
                    // Fall through to centralized execution endpoint below
                } else if (typeof adapter.startJob === 'function') {
                    // CRITICAL: Create generation record FIRST with spell metadata before starting async job
                    // Webhook processor needs this record to continue spell execution
                    const { ObjectId } = require('mongodb');
                    const generationParams = {
                        masterAccountId: new ObjectId(originalContext.masterAccountId),
                        initiatingEventId: new ObjectId(eventId), // CRITICAL: Required field - use event created above
                        serviceName: tool.service,
                        toolId: tool.toolId,
                        toolDisplayName: tool.displayName || tool.name || tool.toolId,
                        requestPayload: pipelineContext,
                        status: 'processing',
                        deliveryStatus: 'pending',
                        deliveryStrategy: 'spell_step',
                        notificationPlatform: originalContext.platform || 'none',
                        metadata: {
                            isSpell: true,
                            castId: originalContext.castId || null,
                            spell: typeof spell.toObject === 'function' ? spell.toObject() : spell,
                            stepIndex,
                            pipelineContext,
                            originalContext,
                            run_id: null, // Will be set after startJob (use snake_case to match webhook processor)
                        }
                    };
                    
                    const genResponse = await this.internalApiClient.post('/internal/v1/data/generations', generationParams);
                    const generationId = genResponse.data._id;
                    this.logger.info(`[WorkflowExecution] Created generation record ${generationId} for async adapter job`);
                    
                    // Now start the async job
                    const runInfo = await adapter.startJob(pipelineContext);
                    
                    // Update generation record with runId so webhook processor can find it
                    // NOTE: Webhook processor queries by metadata.run_id (snake_case), so use that format
                    try {
                        await this.internalApiClient.put(`/internal/v1/data/generations/${generationId}`, {
                            'metadata.run_id': runInfo.runId  // Use snake_case to match webhook processor query
                        });
                        this.logger.info(`[WorkflowExecution] Updated generation ${generationId} with run_id ${runInfo.runId}`);
                    } catch (updateErr) {
                        this.logger.error(`[WorkflowExecution] Failed to update generation ${generationId} with run_id:`, updateErr.message);
                        // Don't throw - webhook processor can still find by run_id in metadata
                    }
                    
                    // --- CRITICAL: Start background poller for async adapter jobs ---
                    // This ensures the generation record is updated and spell execution continues when job completes
                    (async () => {
                        try {
                            let attempts = 0;
                            const maxAttempts = 60; // 5 min at 5s interval (same as generationExecutionApi)
                            while (attempts < maxAttempts) {
                                await new Promise(r => setTimeout(r, 5000));
                                const pollRes = await adapter.pollJob(runInfo.runId);
                                
                                if (pollRes.status === 'succeeded' || pollRes.status === 'failed' || pollRes.status === 'completed') {
                                    const finalStatus = (pollRes.status === 'failed') ? 'failed' : 'completed';
                                    let finalData = pollRes.data;
                                    
                                    // Normalize text data format
                                    if (pollRes.type === 'text' && finalData) {
                                        if (typeof finalData.text === 'string') {
                                            finalData = { text: [finalData.text] };
                                        } else if (typeof finalData.description === 'string') {
                                            finalData = { text: [finalData.description] };
                                        }
                                    }
                                    
                                    // Update generation record with final result
                                    const updatePayload = {
                                        status: finalStatus,
                                        responsePayload: [{ type: pollRes.type, data: finalData }],
                                        ...(pollRes.costUsd && { costUsd: pollRes.costUsd })
                                    };
                                    
                                    await this.internalApiClient.put(`/internal/v1/data/generations/${generationId}`, updatePayload);
                                    this.logger.info(`[WorkflowExecution] Updated generation ${generationId} with final status: ${finalStatus}`);
                                    
                                    // Fetch updated record and emit event to trigger spell continuation
                                    const notificationEvents = require('../events/notificationEvents');
                                    const updatedGenResponse = await this.internalApiClient.get(`/internal/v1/data/generations/${generationId}`);
                                    const updatedRecord = updatedGenResponse.data;
                                    
                                    if (updatedRecord) {
                                        // Ensure deliveryStrategy is set for NotificationDispatcher routing
                                        const recordToEmit = {
                                            ...updatedRecord,
                                            deliveryStrategy: 'spell_step'
                                        };
                                        notificationEvents.emit('generationUpdated', recordToEmit);
                                        this.logger.info(`[WorkflowExecution] Emitted generationUpdated for completed adapter job ${generationId}`);
                                    }
                                    
                                    break; // Job completed, exit polling loop
                                }
                                
                                attempts++;
                            }
                            
                            if (attempts >= maxAttempts) {
                                this.logger.error(`[WorkflowExecution] Adapter job ${runInfo.runId} did not complete within ${maxAttempts * 5} seconds`);
                                // Update generation record to failed status
                                await this.internalApiClient.put(`/internal/v1/data/generations/${generationId}`, {
                                    status: 'failed',
                                    deliveryError: 'Job did not complete within timeout period'
                                });
                            }
                        } catch (pollErr) {
                            this.logger.error(`[WorkflowExecution] Background poller error for adapter job ${runInfo.runId}:`, pollErr.message);
                            // Update generation record to failed status
                            try {
                                await this.internalApiClient.put(`/internal/v1/data/generations/${generationId}`, {
                                    status: 'failed',
                                    deliveryError: `Polling error: ${pollErr.message}`
                                });
                            } catch (updateErr) {
                                this.logger.error(`[WorkflowExecution] Failed to update generation ${generationId} status after polling error:`, updateErr.message);
                            }
                        }
                    })();
                    
                    this.logger.info(`[WorkflowExecution] Started async job via adapter for step ${step.stepId}. GenID: ${generationId}, RunId: ${runInfo.runId}`);
                    return;
                }
            } catch (adaptErr) {
                this.logger.error(`[WorkflowExecution] Adapter execution error for step ${step.stepId}:`, adaptErr);
                throw adaptErr;
            }
        }

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

        // Event already created above (before adapter check) - reuse eventId

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
            // For immediate tools, timeout errors are acceptable - the generation continues in background
            // and event-driven continuation will handle completion. Don't fail the spell on timeout.
            if (tool.deliveryMode === 'immediate' && (err.message?.includes('timeout') || err.message?.includes('exceeded'))) {
                this.logger.warn(`[WorkflowExecution] Timeout submitting step ${stepIndex + 1} to execution endpoint (immediate tool). Generation continues in background, event-driven continuation will handle completion. Error: ${err.message}`);
                // Return early - don't throw. The centralized endpoint will emit generationUpdated event when it completes.
                return;
            }
            this.logger.error(`[WorkflowExecution] Error submitting step ${stepIndex + 1} to execution endpoint: ${err.message}`);
            throw err;
        }

        // Handle immediate delivery tools (e.g., LLMs)
        // CRITICAL: For spell steps, we MUST continue execution even for immediate tools
        if (tool.deliveryMode === 'immediate' && executionResponse.data && executionResponse.data.response) {
            this.logger.info(`[WorkflowExecution] Immediate tool response for step ${stepIndex + 1}: ${JSON.stringify(executionResponse.data.response).substring(0,200)}...`);

            // Validate generationId exists (required for spell continuation)
            if (!executionResponse.data.generationId) {
                this.logger.error('[WorkflowExecution] Immediate tool returned no generationId, cannot continue spell');
                throw new Error('Immediate tool execution did not return generationId');
            }

            // --- CRITICAL: Update generation record with responsePayload ---
            // Note: deliveryStrategy is already set by centralized execution endpoint
            try {
                    await this.internalApiClient.put(`/internal/v1/data/generations/${executionResponse.data.generationId}`, {
                    responsePayload: { result: executionResponse.data.response },
                    status: 'completed' // Ensure status is set
                    });
                this.logger.info(`[WorkflowExecution] Updated generation ${executionResponse.data.generationId} with responsePayload`);
            } catch(err){
                this.logger.error('[WorkflowExecution] Failed to update generation with immediate response:', err.message);
                // Don't throw - centralized endpoint already emitted event, continuation should still work
            }

            // Send generalized tool-response via WebSocket
            try {
                const websocketService = require('./websocket/server');
                // Extract castId from metadata or execution response
                const castId = originalContext.castId || executionResponse.data.castId || null;
                const spellId = (typeof spell.toObject === 'function' ? spell.toObject() : spell)?._id;
                this.logger.info(`[WorkflowExecution] WebSocket tool-response - originalContext.castId: ${originalContext.castId}, executionResponse.data.castId: ${executionResponse.data.castId}, final castId: ${castId}`);
                
                // Send progress indicator message first so frontend can locate the window
                websocketService.sendToUser(
                    originalContext.masterAccountId,
                    {
                        type: 'generationProgress',
                        payload: {
                            generationId: executionResponse.data.generationId,
                            status: 'running',
                            progress: 0.5,
                            liveStatus: 'processing',
                            toolId: tool.toolId,
                            spellId: spellId,
                            castId: castId
                        }
                    }
                );
                
                // Then send the actual response
                websocketService.sendToUser(
                    originalContext.masterAccountId,
                    {
                        type: 'tool-response',
                        payload: {
                            toolId: tool.toolId,
                            output: executionResponse.data.response,
                            requestId: originalContext.requestId || null,
                            castId: castId
                        }
                    }
                );
            } catch (err) {
                this.logger.error(`[WorkflowExecution] Failed to send tool-response via WebSocket: ${err.message}`);
            }

            // NOTE: Centralized execution endpoint already emits generationUpdated event with deliveryStrategy='spell_step'
            // NotificationDispatcher will handle spell continuation automatically
            // No need to emit again or call continueExecution directly - that would cause duplicate execution
            
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
        // --- CRITICAL: Validate required metadata ---
        if (!completedGeneration.metadata) {
            this.logger.error('[WorkflowExecution] continueExecution called with generation missing metadata');
            throw new Error('Generation record missing metadata');
        }
        
        const { spell, stepIndex, pipelineContext, originalContext } = completedGeneration.metadata;
        
        if (!spell) {
            this.logger.error('[WorkflowExecution] continueExecution called with generation missing spell in metadata');
            throw new Error('Generation metadata missing spell definition');
        }
        
        if (typeof stepIndex !== 'number' || stepIndex < 0) {
            this.logger.error(`[WorkflowExecution] continueExecution called with invalid stepIndex: ${stepIndex}`);
            throw new Error(`Generation metadata missing or invalid stepIndex: ${stepIndex}`);
        }
        
        if (!pipelineContext || typeof pipelineContext !== 'object') {
            this.logger.error('[WorkflowExecution] continueExecution called with generation missing pipelineContext');
            throw new Error('Generation metadata missing pipelineContext');
        }
        
        if (!originalContext || typeof originalContext !== 'object') {
            this.logger.error('[WorkflowExecution] continueExecution called with generation missing originalContext');
            throw new Error('Generation metadata missing originalContext');
        }
        
        // --- CRITICAL: Check if generation failed ---
        if (completedGeneration.status === 'failed') {
            this.logger.error(`[WorkflowExecution] Step ${stepIndex + 1} of spell "${spell.name}" failed. Stopping spell execution.`);
            
            // Update cast status to failed
            if (completedGeneration.metadata?.castId) {
                const castId = completedGeneration.metadata.castId;
                try {
                    const failureReason = completedGeneration.metadata?.error?.message || 
                                        completedGeneration.metadata?.errorDetails?.message ||
                                        completedGeneration.deliveryError ||
                                        'Step execution failed';
                    
                    await this.internalApiClient.put(`/internal/v1/data/spells/casts/${castId}`, {
                        status: 'failed',
                        failureReason: failureReason,
                        failedAt: new Date(),
                    });
                    this.logger.info(`[WorkflowExecution] Updated cast ${castId} status to 'failed'`);
                } catch (err) {
                    this.logger.error(`[WorkflowExecution] Failed to update cast ${castId} status to failed:`, err.message);
                    // Don't throw - we've already logged the error, continue with cleanup
                }
            }
            
            // Don't continue to next step
            return;
        }
        
        this.logger.info(`[WorkflowExecution] Continuing spell "${spell.name}". Finished step ${stepIndex + 1}.`);
        
        // --- CRITICAL: Check if this step has already been processed to prevent duplicate execution ---
        // This must happen BEFORE updating the cast to avoid race conditions
        const { castId } = completedGeneration.metadata;
        if (castId) {
            try {
                const castResponse = await this.internalApiClient.get(`/internal/v1/data/spells/casts/${castId}`);
                const cast = castResponse.data;
                if (cast && cast.stepGenerationIds && Array.isArray(cast.stepGenerationIds)) {
                    const generationIdStr = completedGeneration._id.toString();
                    // Check if this generation ID is already in the cast's stepGenerationIds
                    const alreadyProcessed = cast.stepGenerationIds.some(id => 
                        (typeof id === 'string' ? id : id.toString()) === generationIdStr
                    );
                    if (alreadyProcessed) {
                        this.logger.warn(`[WorkflowExecution] Step ${stepIndex + 1} of spell "${spell.name}" has already been processed (generation ${generationIdStr} already in cast). Skipping duplicate execution.`);
                        return; // Already processed, skip
                    }
                    
                    // CRITICAL: Also check if the NEXT step has already been executed
                    // This prevents duplicate execution when continueExecution is called multiple times
                    // After step N (index N) completes, we should have N+1 generations
                    // If we already have N+2 generations, step N+1 was already executed
                    const nextStepIndex = stepIndex + 1;
                    const currentGenerationCount = cast.stepGenerationIds.length;
                    const expectedCount = stepIndex + 1; // After step N, we should have N+1 generations
                    if (currentGenerationCount >= expectedCount + 1) {
                        // We already have a generation for the next step, skip execution
                        this.logger.warn(`[WorkflowExecution] Step ${nextStepIndex + 1} of spell "${spell.name}" appears to have already been executed (cast has ${currentGenerationCount} generations, expected ${expectedCount}). Skipping duplicate execution.`);
                        return; // Already executed, skip
                    }
                }
            } catch (castErr) {
                this.logger.warn(`[WorkflowExecution] Failed to check cast ${castId} for duplicate processing:`, castErr.message);
                // Continue with execution - better to execute twice than not at all
            }
        }
        
        // --- Update parent cast document with newly completed step generation ---
        if (castId) {
            try {
                const costDelta = typeof completedGeneration.costUsd === 'number' ? completedGeneration.costUsd : 0;
                await this.internalApiClient.put(`/internal/v1/data/spells/casts/${castId}`, {
                    generationId: completedGeneration._id.toString(),
                    costDeltaUsd: costDelta,
                });
                this.logger.info(`[WorkflowExecution] Updated cast ${castId} with generation ${completedGeneration._id} (costUsd=${costDelta}).`);
            } catch (err) {
                this.logger.error(`[WorkflowExecution] Failed to update cast ${castId}:`, err.message);
                // Add retry logic for transient failures
                let retries = 3;
                let lastError = err;
                while (retries > 0) {
                    try {
                        await new Promise(r => setTimeout(r, 1000 * (4 - retries))); // Exponential backoff
                        const costDelta = typeof completedGeneration.costUsd === 'number' ? completedGeneration.costUsd : 0;
                        await this.internalApiClient.put(`/internal/v1/data/spells/casts/${castId}`, {
                            generationId: completedGeneration._id.toString(),
                            costDeltaUsd: costDelta,
                        });
                        this.logger.info(`[WorkflowExecution] Successfully updated cast ${castId} after retry`);
                        break; // Success
                    } catch (retryErr) {
                        lastError = retryErr;
                        retries--;
                        if (retries === 0) {
                            this.logger.error(`[WorkflowExecution] Failed to update cast ${castId} after 3 retries:`, lastError.message);
                            // Consider: emit metric or alert for manual reconciliation
                        }
                    }
                }
            }
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
                try {
                    const castResponse = await this.internalApiClient.get(`/internal/v1/data/spells/casts/${castId}`);
                    const cast = castResponse.data;
                    if (cast && cast.status === 'completed') {
                        this.logger.warn(`[WorkflowExecution] Cast ${castId} is already completed. Skipping duplicate finalization.`);
                        return; // Already finalized, skip
                    }
                } catch (castErr) {
                    this.logger.warn(`[WorkflowExecution] Failed to check cast ${castId} status before finalization:`, castErr.message);
                    // Continue with finalization - better to finalize twice than not at all
                }
            }
            
            this.logger.info(`[WorkflowExecution] Spell "${spell.name}" finished successfully. Creating final notification record.`);
            
            // Final update to the cast document
            if (castId) {
                try {
                    await this.internalApiClient.put(`/internal/v1/data/spells/casts/${castId}`, {
                        status: 'completed',
                        costDeltaUsd: '0' // Final cost is already summed up from steps
                    });
                    this.logger.info(`[WorkflowExecution] Finalized cast ${castId} with status 'completed'`);
                } catch (err) {
                    this.logger.error(`[WorkflowExecution] Failed to finalize cast ${castId}:`, err.message);
                    // Add retry logic for final cast update
                    let retries = 3;
                    let lastError = err;
                    while (retries > 0) {
                        try {
                            await new Promise(r => setTimeout(r, 1000 * (4 - retries))); // Exponential backoff
                            await this.internalApiClient.put(`/internal/v1/data/spells/casts/${castId}`, {
                                status: 'completed',
                                costDeltaUsd: '0'
                            });
                            this.logger.info(`[WorkflowExecution] Successfully finalized cast ${castId} after retry`);
                            break; // Success
                        } catch (retryErr) {
                            lastError = retryErr;
                            retries--;
                            if (retries === 0) {
                                this.logger.error(`[WorkflowExecution] Failed to finalize cast ${castId} after 3 retries:`, lastError.message);
                            }
                        }
                    }
                }
            }

            // ---- Aggregate cost/points across all step generations ----
            let totalCostUsd = 0;
            let totalPointsSpent = 0;
            try {
                if (stepGenerationIds && stepGenerationIds.length > 0) {
                    const queryString = stepGenerationIds.map(id => `_id_in=${id}`).join('&');
                    const genRes = await this.internalApiClient.get(`/internal/v1/data/generations?${queryString}`);
                    let stepGens = genRes.data.generations || [];
                    if (stepGens.length === 0) {
                        // Possibly ObjectId mismatch; fetch each individually
                        stepGens = [];
                        for (const gid of stepGenerationIds) {
                            try {
                                const one = await this.internalApiClient.get(`/internal/v1/data/generations/${gid}`);
                                if (one.data) stepGens.push(one.data);
                            } catch (e) {
                                this.logger.warn(`[WorkflowExecution] Failed to fetch generation ${gid} individually for cost aggregation: ${e.message}`);
                            }
                        }
                    }
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