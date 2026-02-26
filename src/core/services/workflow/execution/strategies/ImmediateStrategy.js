/**
 * ImmediateStrategy - Execution strategy for immediate tools (ChatGPT, String Primitive)
 * 
 * Handles tools that return results immediately via the centralized execution endpoint.
 */

const ExecutionStrategy = require('./ExecutionStrategy');

class ImmediateStrategy extends ExecutionStrategy {
    constructor({ logger, workflowNotifier, generationExecutionService }) {
        super({ type: 'immediate', logger });
        this.workflowNotifier = workflowNotifier;
        this.generationExecutionService = generationExecutionService || null;
    }

    /**
     * Executes immediate tool via centralized execution endpoint
     */
    async execute(inputs, executionContext, dependencies) {
        const { tool, spell, stepIndex, originalContext, loraResolutionData } = executionContext;
        const { internalApiClient, eventId } = dependencies;

        this.logger.debug(`[ImmediateStrategy] Executing immediate tool ${tool.toolId}`);

        const executionPayload = {
            toolId: tool.toolId,
            inputs,
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
                pipelineContext: executionContext.pipelineContext,
                originalContext,
                loraResolutionData,
                notificationContext: {
                    type: 'spell_step_completion',
                    spellId: spell._id,
                    stepIndex,
                },
                // Cook integration
                ...(originalContext.collectionId ? { collectionId: originalContext.collectionId } : {}),
                ...(originalContext.cookId ? { cookId: originalContext.cookId } : {}),
                ...(originalContext.jobId ? { jobId: originalContext.jobId } : {}),
                ...(originalContext.pieceIndex !== undefined ? { pieceIndex: originalContext.pieceIndex } : {}),
            },
        };

        try {
            let executionData;
            if (this.generationExecutionService) {
                const result = await this.generationExecutionService.execute(executionPayload);
                executionData = result.body;
                this.logger.debug(`[ImmediateStrategy] Step ${stepIndex + 1} executed in-process. GenID: ${executionData.generationId}`);
            } else {
                const executionResponse = await internalApiClient.post('/internal/v1/data/execute', executionPayload);
                executionData = executionResponse.data;
                this.logger.debug(`[ImmediateStrategy] Step ${stepIndex + 1} submitted via HTTP. GenID: ${executionData.generationId}`);
            }

            return {
                generationId: executionData.generationId,
                response: executionData.response,
                status: executionData.response ? 'completed' : 'processing',
                runId: executionData.runId
            };
        } catch (err) {
            // For immediate tools, timeout errors are acceptable - generation continues in background
            if (err.message?.includes('timeout') || err.message?.includes('exceeded')) {
                this.logger.warn(`[ImmediateStrategy] Timeout submitting step ${stepIndex + 1} to execution endpoint. Generation continues in background, event-driven continuation will handle completion. Error: ${err.message}`);
                return {
                    status: 'processing',
                    timeoutHandled: true
                };
            }
            throw err;
        }
    }

    /**
     * Handles immediate tool response
     */
    async handleResponse(executionResponse, executionContext, dependencies) {
        const { tool, stepIndex, originalContext } = executionContext;
        const { generationRecordManager, internalApiClient } = dependencies;

        if (!executionResponse.response) {
            return; // No response to handle
        }

        this.logger.debug(`[ImmediateStrategy] Handling immediate tool response for step ${stepIndex + 1}`);

        // Validate generationId exists (required for spell continuation)
        if (!executionResponse.generationId) {
            this.logger.error('[ImmediateStrategy] Immediate tool returned no generationId, cannot continue spell');
            throw new Error('Immediate tool execution did not return generationId');
        }

        // Update generation record with responsePayload
        try {
            await generationRecordManager.updateGenerationRecord(executionResponse.generationId, {
                responsePayload: { result: executionResponse.response },
                status: 'completed'
            });
            this.logger.debug(`[ImmediateStrategy] Updated generation ${executionResponse.generationId} with responsePayload`);
        } catch (err) {
            this.logger.error('[ImmediateStrategy] Failed to update generation with immediate response:', err.message);
            // Don't throw - centralized endpoint already emitted event, continuation should still work
        }

        // Send WebSocket notifications via WorkflowNotifier
        if (this.workflowNotifier) {
            try {
                await this.workflowNotifier.notifyStepCompletion(
                    executionContext,
                    executionResponse.generationId,
                    tool,
                    executionResponse.response
                );
            } catch (err) {
                this.logger.error(`[ImmediateStrategy] Failed to send notifications: ${err.message}`);
            }
        }

        // NOTE: Centralized execution endpoint already emits generationUpdated event with deliveryStrategy='spell_step'
        // NotificationDispatcher will handle spell continuation automatically
        return executionResponse.response;
    }

    /**
     * Normalizes immediate tool output
     */
    normalizeOutput(rawOutput) {
        // ChatGPT returns text directly
        if (typeof rawOutput === 'string') {
            return { text: [rawOutput] };
        }
        if (rawOutput?.result) {
            return { text: [rawOutput.result] };
        }
        return rawOutput;
    }

    /**
     * Handles errors for immediate tools
     */
    async handleError(error, executionContext, dependencies) {
        // For immediate tools, timeout errors are acceptable
        if (error.message?.includes('timeout') || error.message?.includes('exceeded')) {
            // Generation continues in background, event-driven continuation handles it
            return { handled: true, shouldRetry: false };
        }
        return { handled: false, shouldRetry: true };
    }
}

module.exports = ImmediateStrategy;

