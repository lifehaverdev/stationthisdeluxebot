/**
 * AsyncAdapterStrategy - Execution strategy for async adapter tools (HuggingFace)
 * 
 * Handles tools that use adapters with async job polling.
 */

const ExecutionStrategy = require('./ExecutionStrategy');

class AsyncAdapterStrategy extends ExecutionStrategy {
    constructor({ logger, adapterCoordinator }) {
        super({ type: 'async_adapter', logger });
        this.adapterCoordinator = adapterCoordinator;
    }

    /**
     * Executes async adapter tool
     */
    async execute(inputs, executionContext, dependencies) {
        const { tool } = executionContext;

        this.logger.info(`[AsyncAdapterStrategy] Executing async adapter tool ${tool.toolId}`);

        // Use AdapterCoordinator to create async job and start polling
        const result = await this.adapterCoordinator.createAsyncJob(
            tool,
            inputs,
            executionContext,
            dependencies,
            (rawOutput) => this.normalizeOutput(rawOutput)
        );

        return result;
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

