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
     * @param {Object} inputs - Tool inputs
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

        this.logger.info(`[AdapterCoordinator] Executing tool ${tool.toolId} via adapter`);

        // Create generation record FIRST
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

        const { generationId } = await this.generationRecordManager.createGenerationRecord(generationParams);
        this.logger.info(`[AdapterCoordinator] Created generation record ${generationId} for adapter job`);

        // Start async job
        const runInfo = await adapter.startJob(pipelineContext);

        // Update generation record with runId
        try {
            await this.generationRecordManager.updateGenerationRecord(generationId, {
                'metadata.run_id': runInfo.runId
            });
            this.logger.info(`[AdapterCoordinator] Updated generation ${generationId} with run_id ${runInfo.runId}`);
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
        const result = await this.executeWithAdapter(tool, inputs, executionContext, dependencies);

        // Start polling for async adapter jobs
        await this.asyncJobPoller.startPolling(
            result.generationId,
            result.runId,
            this.adapterRegistry.get(tool.service),
            {
                maxAttempts: 60,
                pollInterval: 5000,
                normalizeOutput: normalizeOutput
            }
        );

        this.logger.info(`[AdapterCoordinator] Started async job via adapter. GenID: ${result.generationId}, RunId: ${result.runId}`);

        return {
            generationId: result.generationId,
            runId: result.runId,
            status: 'processing',
            pollingRequired: true
        };
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

