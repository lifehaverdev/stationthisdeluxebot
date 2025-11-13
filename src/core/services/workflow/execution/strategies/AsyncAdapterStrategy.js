/**
 * AsyncAdapterStrategy - Execution strategy for async adapter tools (HuggingFace)
 * 
 * Handles tools that use adapters with async job polling.
 */

const ExecutionStrategy = require('./ExecutionStrategy');
const { ObjectId } = require('mongodb');

class AsyncAdapterStrategy extends ExecutionStrategy {
    constructor({ logger }) {
        super({ type: 'async_adapter', logger });
    }

    /**
     * Executes async adapter tool
     */
    async execute(inputs, executionContext, dependencies) {
        const { tool, spell, stepIndex, pipelineContext, originalContext } = executionContext;
        const { adapter, generationRecordManager, eventId } = dependencies;

        if (!adapter) {
            throw new Error(`No adapter found for service ${tool.service}`);
        }

        if (typeof adapter.startJob !== 'function') {
            throw new Error(`Adapter for ${tool.service} does not support startJob()`);
        }

        this.logger.info(`[AsyncAdapterStrategy] Executing async adapter tool ${tool.toolId}`);

        // CRITICAL: Create generation record FIRST with spell metadata before starting async job
        const generationParams = {
            masterAccountId: new ObjectId(originalContext.masterAccountId),
            initiatingEventId: new ObjectId(eventId),
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
                run_id: null, // Will be set after startJob
            }
        };

        const { generationId } = await generationRecordManager.createGenerationRecord(generationParams);
        this.logger.info(`[AsyncAdapterStrategy] Created generation record ${generationId} for async adapter job`);

        // Start async job
        const runInfo = await adapter.startJob(pipelineContext);

        // Update generation record with runId
        try {
            await generationRecordManager.updateGenerationRecord(generationId, {
                'metadata.run_id': runInfo.runId
            });
            this.logger.info(`[AsyncAdapterStrategy] Updated generation ${generationId} with run_id ${runInfo.runId}`);
        } catch (updateErr) {
            this.logger.error(`[AsyncAdapterStrategy] Failed to update generation ${generationId} with run_id:`, updateErr.message);
            // Don't throw - webhook processor can still find by run_id in metadata
        }

        // Start background polling (delegated to AsyncJobPoller in Phase 5)
        // For now, start polling inline
        this._startPolling(generationId, runInfo.runId, adapter, dependencies, executionContext);

        this.logger.info(`[AsyncAdapterStrategy] Started async job via adapter. GenID: ${generationId}, RunId: ${runInfo.runId}`);

        return {
            generationId,
            runId: runInfo.runId,
            status: 'processing',
            pollingRequired: true
        };
    }

    /**
     * Starts background polling for async adapter jobs
     * TODO: Move to AsyncJobPoller in Phase 5
     */
    _startPolling(generationId, runId, adapter, dependencies, executionContext) {
        const { generationRecordManager, logger } = dependencies;
        const { tool, stepIndex } = executionContext;

        (async () => {
            try {
                let attempts = 0;
                const maxAttempts = 60; // 5 min at 5s interval
                while (attempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, 5000));
                    const pollRes = await adapter.pollJob(runId);

                    if (pollRes.status === 'succeeded' || pollRes.status === 'failed' || pollRes.status === 'completed') {
                        const finalStatus = (pollRes.status === 'failed') ? 'failed' : 'completed';
                        let finalData = pollRes.data;

                        // Normalize text data format
                        finalData = this.normalizeOutput({ type: pollRes.type, data: finalData });

                        // Update generation record with final result
                        const updatePayload = {
                            status: finalStatus,
                            responsePayload: [{ type: pollRes.type, data: finalData }],
                            ...(pollRes.costUsd && { costUsd: pollRes.costUsd })
                        };

                        await generationRecordManager.updateGenerationRecord(generationId, updatePayload);
                        logger.info(`[AsyncAdapterStrategy] Updated generation ${generationId} with final status: ${finalStatus}`);

                        // Fetch updated record and emit event to trigger spell continuation
                        const notificationEvents = require('../../../events/notificationEvents');
                        const updatedRecord = await generationRecordManager.getGenerationRecord(generationId);

                        if (updatedRecord) {
                            const recordToEmit = {
                                ...updatedRecord,
                                deliveryStrategy: 'spell_step'
                            };
                            notificationEvents.emit('generationUpdated', recordToEmit);
                            logger.info(`[AsyncAdapterStrategy] Emitted generationUpdated for completed adapter job ${generationId}`);
                        }

                        break; // Job completed, exit polling loop
                    }

                    attempts++;
                }

                if (attempts >= maxAttempts) {
                    logger.error(`[AsyncAdapterStrategy] Adapter job ${runId} did not complete within ${maxAttempts * 5} seconds`);
                    await generationRecordManager.updateGenerationRecord(generationId, {
                        status: 'failed',
                        deliveryError: 'Job did not complete within timeout period'
                    });
                }
            } catch (pollErr) {
                logger.error(`[AsyncAdapterStrategy] Background poller error for adapter job ${runId}:`, pollErr.message);
                try {
                    await generationRecordManager.updateGenerationRecord(generationId, {
                        status: 'failed',
                        deliveryError: `Polling error: ${pollErr.message}`
                    });
                } catch (updateErr) {
                    logger.error(`[AsyncAdapterStrategy] Failed to update generation ${generationId} status after polling error:`, updateErr.message);
                }
            }
        })();
    }

    /**
     * Normalizes async adapter output
     */
    normalizeOutput(rawOutput) {
        // Handle text data format normalization
        if (rawOutput?.type === 'text' && rawOutput?.data) {
            if (typeof rawOutput.data.text === 'string') {
                return { text: [rawOutput.data.text] };
            } else if (typeof rawOutput.data.description === 'string') {
                return { text: [rawOutput.data.description] };
            }
        }
        return rawOutput.data || rawOutput;
    }

    /**
     * Handles errors for async adapter tools
     */
    async handleError(error, executionContext, dependencies) {
        const { generationId } = executionContext;
        const { generationRecordManager } = dependencies;

        if (generationId) {
            await generationRecordManager.updateGenerationRecord(generationId, {
                status: 'failed',
                deliveryError: error.message
            });
        }
        return { handled: true, shouldRetry: false };
    }
}

module.exports = AsyncAdapterStrategy;

