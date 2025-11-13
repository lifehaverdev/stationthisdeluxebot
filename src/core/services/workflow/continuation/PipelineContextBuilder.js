/**
 * PipelineContextBuilder - Builds and manages pipeline context
 * 
 * Handles pipeline context accumulation and merging for multi-step spells.
 */

class PipelineContextBuilder {
    constructor({ logger }) {
        this.logger = logger;
    }

    /**
     * Accumulates step generation IDs
     * @param {Object} pipelineContext - Current pipeline context
     * @param {string} generationId - New generation ID to add
     * @returns {string[]} - Accumulated step generation IDs
     */
    accumulateStepGenerationIds(pipelineContext, generationId) {
        if (!generationId) {
            throw new Error('Generation record missing _id');
        }

        // Get previous step generation IDs with validation
        let previousStepGenIds = [];
        if (pipelineContext && Array.isArray(pipelineContext.stepGenerationIds)) {
            previousStepGenIds = pipelineContext.stepGenerationIds;
        } else if (pipelineContext && pipelineContext.stepGenerationIds) {
            this.logger.warn(`[PipelineContextBuilder] pipelineContext.stepGenerationIds is not an array, resetting`);
        }

        const stepGenerationIds = [...previousStepGenIds, generationId];
        return stepGenerationIds;
    }

    /**
     * Builds the next pipeline context by merging current context with step output and mapped inputs
     * @param {Object} pipelineContext - Current pipeline context
     * @param {Object} stepOutput - Output from current step
     * @param {Object} next_inputs - Mapped inputs for next step
     * @returns {Object} - Next pipeline context
     */
    buildNextPipelineContext(pipelineContext, stepOutput, next_inputs) {
        // Merge: existing context + step output + mapped inputs
        return { ...pipelineContext, ...stepOutput, ...next_inputs };
    }

    /**
     * Merges pipeline context with additional data
     * @param {Object} pipelineContext - Base pipeline context
     * @param {Object} additionalData - Additional data to merge
     * @returns {Object} - Merged pipeline context
     */
    mergeContexts(pipelineContext, additionalData) {
        return { ...pipelineContext, ...additionalData };
    }
}

module.exports = PipelineContextBuilder;

