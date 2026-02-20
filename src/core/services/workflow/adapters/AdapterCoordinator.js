/**
 * AdapterCoordinator - Coordinates adapter-based tool execution
 * 
 * Handles adapter job creation, execution, and coordination.
 */

const { ObjectId } = require('mongodb');

class AdapterCoordinator {
    constructor({ logger, adapterRegistry, generationRecordManager, asyncJobPoller }) {
        this.logger = logger;
        this.adapterRegistry = adapterRegistry;
        this.generationRecordManager = generationRecordManager;
        this.asyncJobPoller = asyncJobPoller;
    }

    /**
     * Executes a tool using its adapter
     * @param {Object} tool - Tool definition
     * @param {Object} inputs - Tool inputs (resolved finalInputs from StepExecutor)
     * @param {Object} executionContext - Execution context
     * @param {Object} dependencies - Dependencies (eventId, etc.)
     * @returns {Promise<Object>} - Execution result with { generationId, runId, status }
     */
    async executeWithAdapter(tool, inputs, executionContext, dependencies) {
        const { spell, stepIndex, pipelineContext, originalContext } = executionContext;
        const { eventId } = dependencies;

        const adapter = this.adapterRegistry.get(tool.service);
        if (!adapter) {
            throw new Error(`No adapter found for service ${tool.service}`);
        }

        if (typeof adapter.startJob !== 'function') {
            throw new Error(`Adapter for ${tool.service} does not support startJob()`);
        }

        this.logger.debug(`[AdapterCoordinator] Executing tool ${tool.toolId} via adapter with inputs: ${JSON.stringify(Object.keys(inputs || {}))}`);

        // Create generation record FIRST
        const generationParams = {
            masterAccountId: new ObjectId(originalContext.masterAccountId),
            initiatingEventId: new ObjectId(eventId),
            serviceName: tool.service,
            toolId: tool.toolId,
            toolDisplayName: tool.displayName || tool.name || tool.toolId,
            requestPayload: inputs, // Use resolved inputs, not empty pipelineContext
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

        const { generationId } = await this.generationRecordManager.createGenerationRecord(generationParams);
        this.logger.debug(`[AdapterCoordinator] Created generation record ${generationId} for adapter job`);

        // Merge defaultAdapterParams and costTable from tool metadata before calling startJob
        const jobInputs = {
            ...(tool.metadata?.defaultAdapterParams || {}),
            ...inputs,
            // Pass costTable for DALL-E tools so adapter can calculate actual cost
            ...(tool.metadata?.costTable && { costTable: tool.metadata.costTable })
        };

        // Start async job with merged inputs
        this.logger.debug(`[AdapterCoordinator] Calling adapter.startJob() with inputs: ${JSON.stringify(jobInputs)}`);
        const runInfo = await adapter.startJob(jobInputs);
        this.logger.debug(`[AdapterCoordinator] adapter.startJob() returned runId: ${runInfo?.runId}`);

        // Update generation record with runId
        try {
            await this.generationRecordManager.updateGenerationRecord(generationId, {
                'metadata.run_id': runInfo.runId
            });
            this.logger.debug(`[AdapterCoordinator] Updated generation ${generationId} with run_id ${runInfo.runId}`);
        } catch (updateErr) {
            this.logger.error(`[AdapterCoordinator] Failed to update generation ${generationId} with run_id:`, updateErr.message);
            // Don't throw - webhook processor can still find by run_id in metadata
        }

        return {
            generationId,
            runId: runInfo.runId,
            runInfo
        };
    }

    /**
     * Creates an async adapter job and starts polling
     * @param {Object} tool - Tool definition
     * @param {Object} inputs - Tool inputs
     * @param {Object} executionContext - Execution context
     * @param {Object} dependencies - Dependencies
     * @param {Function} normalizeOutput - Output normalization function
     * @returns {Promise<Object>} - Execution result
     */
    async createAsyncJob(tool, inputs, executionContext, dependencies, normalizeOutput) {
        this.logger.debug(`[AdapterCoordinator] createAsyncJob called for tool ${tool.toolId}`);
        try {
            const result = await this.executeWithAdapter(tool, inputs, executionContext, dependencies);
            this.logger.debug(`[AdapterCoordinator] executeWithAdapter completed. GenID: ${result.generationId}, RunId: ${result.runId}`);

            const adapter = this.adapterRegistry.get(tool.service);
            if (!adapter) {
                throw new Error(`Adapter not found for service ${tool.service}`);
            }

            // Start polling for async adapter jobs
            this.logger.debug(`[AdapterCoordinator] Starting polling for generation ${result.generationId}, runId ${result.runId}`);
            await this.asyncJobPoller.startPolling(
                result.generationId,
                result.runId,
                adapter,
                {
                    maxAttempts: 60,
                    pollInterval: 5000,
                    normalizeOutput: normalizeOutput
                }
            );

            this.logger.debug(`[AdapterCoordinator] Started async job via adapter. GenID: ${result.generationId}, RunId: ${result.runId}`);

            return {
                generationId: result.generationId,
                runId: result.runId,
                status: 'processing',
                pollingRequired: true
            };
        } catch (error) {
            this.logger.error(`[AdapterCoordinator] Error in createAsyncJob for tool ${tool.toolId}: ${error.stack || error}`);
            throw error;
        }
    }

    /**
     * Handles immediate tools (no adapter needed)
     * @param {Object} tool - Tool definition
     * @returns {boolean} - True if tool is immediate and should skip adapter path
     */
    shouldSkipAdapter(tool) {
        return tool.deliveryMode === 'immediate';
    }

    /**
     * Checks if adapter supports async jobs
     * @param {Object} tool - Tool definition
     * @returns {boolean} - True if adapter supports async jobs
     */
    adapterSupportsAsyncJobs(tool) {
        const adapter = this.adapterRegistry.get(tool.service);
        return adapter && typeof adapter.startJob === 'function';
    }
}

module.exports = AdapterCoordinator;

