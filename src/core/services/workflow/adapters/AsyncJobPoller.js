/**
 * AsyncJobPoller - Handles async job polling for adapter-based tools
 * 
 * Polls adapter jobs until completion and updates generation records.
 */

class AsyncJobPoller {
    constructor({ logger, generationRecordManager }) {
        this.logger = logger;
        this.generationRecordManager = generationRecordManager;
    }

    /**
     * Starts polling an async adapter job
     * @param {string} generationId - Generation record ID
     * @param {string} runId - Adapter run ID
     * @param {Object} adapter - Adapter instance with pollJob method
     * @param {Object} options - Polling options
     * @param {number} options.maxAttempts - Maximum polling attempts (default: 60)
     * @param {number} options.pollInterval - Polling interval in ms (default: 5000)
     * @param {Function} options.normalizeOutput - Optional output normalization function
     * @returns {Promise<void>} - Resolves when polling completes (doesn't wait for background polling)
     */
    async startPolling(generationId, runId, adapter, options = {}) {
        const {
            maxAttempts = 60, // 5 min at 5s interval
            pollInterval = 5000,
            normalizeOutput = null
        } = options;

        // Start background polling (fire-and-forget)
        this._pollInBackground(generationId, runId, adapter, maxAttempts, pollInterval, normalizeOutput);
    }

    /**
     * Polls adapter job in background until completion
     * @private
     */
    _pollInBackground(generationId, runId, adapter, maxAttempts, pollInterval, normalizeOutput) {
        this.logger.info(`[AsyncJobPoller] Starting background polling for generation ${generationId}, runId ${runId}`);
        (async () => {
            try {
                let attempts = 0;
                while (attempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, pollInterval));
                    attempts++;
                    this.logger.debug(`[AsyncJobPoller] Polling attempt ${attempts}/${maxAttempts} for runId ${runId}`);
                    const pollRes = await adapter.pollJob(runId);
                    this.logger.debug(`[AsyncJobPoller] Poll result for runId ${runId}: status=${pollRes?.status}`);

                    if (pollRes.status === 'succeeded' || pollRes.status === 'failed' || pollRes.status === 'completed') {
                        const finalStatus = (pollRes.status === 'failed') ? 'failed' : 'completed';
                        let finalData = pollRes.data;

                        // Normalize output if function provided
                        if (normalizeOutput && typeof normalizeOutput === 'function') {
                            finalData = normalizeOutput({ type: pollRes.type, data: finalData });
                        }

                        // Update generation record with final result
                        const updatePayload = {
                            status: finalStatus,
                            responsePayload: [{ type: pollRes.type, data: finalData }],
                            ...(pollRes.costUsd && { costUsd: pollRes.costUsd })
                        };

                        await this.generationRecordManager.updateGenerationRecord(generationId, updatePayload);
                        this.logger.info(`[AsyncJobPoller] Updated generation ${generationId} with final status: ${finalStatus}`);
                        // NOTE: We don't emit generationUpdated here because the API endpoint (generationOutputsApi.js)
                        // already emits it when the record is updated. Emitting here would cause duplicate handling.

                        break; // Job completed, exit polling loop
                    }

                    attempts++;
                }

                if (attempts >= maxAttempts) {
                    this.logger.error(`[AsyncJobPoller] Adapter job ${runId} did not complete within ${maxAttempts * pollInterval / 1000} seconds`);
                    await this.generationRecordManager.updateGenerationRecord(generationId, {
                        status: 'failed',
                        deliveryError: 'Job did not complete within timeout period'
                    });
                }
            } catch (pollErr) {
                this.logger.error(`[AsyncJobPoller] Background poller error for adapter job ${runId}:`, pollErr.message);
                try {
                    await this.generationRecordManager.updateGenerationRecord(generationId, {
                        status: 'failed',
                        deliveryError: `Polling error: ${pollErr.message}`
                    });
                } catch (updateErr) {
                    this.logger.error(`[AsyncJobPoller] Failed to update generation ${generationId} status after polling error:`, updateErr.message);
                }
            }
        })();
    }
}

module.exports = AsyncJobPoller;

