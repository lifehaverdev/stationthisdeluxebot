/**
 * CastManager - Manages cast record operations
 * 
 * Handles cast record updates, status checks, and duplicate detection.
 */

const { retryWithBackoff } = require('../utils/RetryHandler');

class CastManager {
    constructor({ logger, internalApiClient }) {
        this.logger = logger;
        this.internalApiClient = internalApiClient;
    }

    /**
     * Gets a cast record by ID
     * @param {string} castId - Cast ID
     * @returns {Promise<Object>} - Cast record
     */
    async getCast(castId) {
        const castResponse = await this.internalApiClient.get(`/internal/v1/data/spells/casts/${castId}`);
        return castResponse.data;
    }

    /**
     * Checks if a generation has already been processed for a cast
     * @param {string} castId - Cast ID
     * @param {string} generationId - Generation ID to check
     * @param {number} stepIndex - Current step index
     * @returns {Promise<{alreadyProcessed: boolean, nextStepAlreadyExecuted: boolean}>}
     */
    async checkForDuplicateGeneration(castId, generationId, stepIndex) {
        try {
            const cast = await this.getCast(castId);
            if (!cast || !cast.stepGenerationIds || !Array.isArray(cast.stepGenerationIds)) {
                return { alreadyProcessed: false, nextStepAlreadyExecuted: false };
            }

            const generationIdStr = generationId.toString();
            // Check if this generation ID is already in the cast's stepGenerationIds
            const alreadyProcessed = cast.stepGenerationIds.some(id => 
                (typeof id === 'string' ? id : id.toString()) === generationIdStr
            );

            // CRITICAL: Also check if the NEXT step has already been executed
            // This prevents duplicate execution when continueExecution is called multiple times
            // After step N (index N) completes, we should have N+1 generations
            // If we already have N+2 generations, step N+1 was already executed
            const nextStepIndex = stepIndex + 1;
            const currentGenerationCount = cast.stepGenerationIds.length;
            const expectedCount = stepIndex + 1; // After step N, we should have N+1 generations
            const nextStepAlreadyExecuted = currentGenerationCount >= expectedCount + 1;

            return { alreadyProcessed, nextStepAlreadyExecuted };
        } catch (castErr) {
            this.logger.warn(`[CastManager] Failed to check cast ${castId} for duplicate processing:`, castErr.message);
            // Continue with execution - better to execute twice than not at all
            return { alreadyProcessed: false, nextStepAlreadyExecuted: false };
        }
    }

    /**
     * Checks if a cast is already completed
     * @param {string} castId - Cast ID
     * @returns {Promise<boolean>} - True if cast is completed
     */
    async checkCastStatus(castId) {
        try {
            const cast = await this.getCast(castId);
            return cast && cast.status === 'completed';
        } catch (castErr) {
            this.logger.warn(`[CastManager] Failed to check cast ${castId} status:`, castErr.message);
            return false;
        }
    }

    /**
     * Updates a cast with a completed generation
     * @param {string} castId - Cast ID
     * @param {string} generationId - Generation ID
     * @param {number} costUsd - Cost in USD
     * @returns {Promise<void>}
     */
    async updateCastWithGeneration(castId, generationId, costUsd) {
        const costDelta = typeof costUsd === 'number' ? costUsd : 0;
        
        try {
            await this.internalApiClient.put(`/internal/v1/data/spells/casts/${castId}`, {
                generationId: generationId.toString(),
                costDeltaUsd: costDelta,
            });
            this.logger.info(`[CastManager] Updated cast ${castId} with generation ${generationId} (costUsd=${costDelta}).`);
        } catch (err) {
            this.logger.error(`[CastManager] Failed to update cast ${castId}:`, err.message);
            // Add retry logic for transient failures
            try {
                await retryWithBackoff(
                    async () => {
                        await this.internalApiClient.put(`/internal/v1/data/spells/casts/${castId}`, {
                            generationId: generationId.toString(),
                            costDeltaUsd: costDelta,
                        });
                    },
                    {
                        maxAttempts: 3,
                        baseDelay: 1000,
                        onRetry: (error, attempt, delay) => {
                            this.logger.debug(`[CastManager] Retrying cast update (attempt ${attempt}/${3}) after ${delay}ms`);
                        },
                        onFailure: (error, attempts) => {
                            this.logger.error(`[CastManager] Failed to update cast ${castId} after ${attempts} retries:`, error.message);
                            // Consider: emit metric or alert for manual reconciliation
                        }
                    }
                );
                this.logger.info(`[CastManager] Successfully updated cast ${castId} after retry`);
            } catch (retryErr) {
                // All retries exhausted, error already logged by onFailure callback
            }
        }
    }

    /**
     * Updates cast status to failed
     * @param {string} castId - Cast ID
     * @param {string} failureReason - Reason for failure
     * @returns {Promise<void>}
     */
    async updateCastStatusToFailed(castId, failureReason) {
        try {
            await this.internalApiClient.put(`/internal/v1/data/spells/casts/${castId}`, {
                status: 'failed',
                failureReason: failureReason,
                failedAt: new Date(),
            });
            this.logger.info(`[CastManager] Updated cast ${castId} status to 'failed'`);
        } catch (err) {
            this.logger.error(`[CastManager] Failed to update cast ${castId} status to failed:`, err.message);
            // Don't throw - we've already logged the error, continue with cleanup
        }
    }

    /**
     * Finalizes a cast by setting its status to completed
     * @param {string} castId - Cast ID
     * @returns {Promise<void>}
     */
    async finalizeCast(castId) {
        try {
            await this.internalApiClient.put(`/internal/v1/data/spells/casts/${castId}`, {
                status: 'completed',
                costDeltaUsd: '0' // Final cost is already summed up from steps
            });
            this.logger.info(`[CastManager] Finalized cast ${castId} with status 'completed'`);
        } catch (err) {
            this.logger.error(`[CastManager] Failed to finalize cast ${castId}:`, err.message);
            // Add retry logic for final cast update
            try {
                await retryWithBackoff(
                    async () => {
                        await this.internalApiClient.put(`/internal/v1/data/spells/casts/${castId}`, {
                            status: 'completed',
                            costDeltaUsd: '0'
                        });
                    },
                    {
                        maxAttempts: 3,
                        baseDelay: 1000,
                        onRetry: (error, attempt, delay) => {
                            this.logger.debug(`[CastManager] Retrying cast finalization (attempt ${attempt}/${3}) after ${delay}ms`);
                        },
                        onFailure: (error, attempts) => {
                            this.logger.error(`[CastManager] Failed to finalize cast ${castId} after ${attempts} retries:`, error.message);
                        }
                    }
                );
                this.logger.info(`[CastManager] Successfully finalized cast ${castId} after retry`);
            } catch (retryErr) {
                // All retries exhausted, error already logged by onFailure callback
            }
        }
    }
}

module.exports = CastManager;

