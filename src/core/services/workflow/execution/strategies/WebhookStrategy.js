/**
 * WebhookStrategy - Execution strategy for webhook tools (ComfyUI)
 * 
 * Handles tools that rely on webhooks for completion notification.
 */

const ExecutionStrategy = require('./ExecutionStrategy');
const { ObjectId } = require('mongodb');

class WebhookStrategy extends ExecutionStrategy {
    constructor({ logger }) {
        super({ type: 'webhook', logger });
    }

    /**
     * Executes webhook tool
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

        this.logger.info(`[WebhookStrategy] Executing webhook tool ${tool.toolId}`);

        // Create generation record with spell metadata
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
                run_id: null, // Will be set by webhook processor
            }
        };

        const { generationId } = await generationRecordManager.createGenerationRecord(generationParams);
        this.logger.info(`[WebhookStrategy] Created generation record ${generationId} for webhook job`);

        // Start job via adapter
        const runInfo = await adapter.startJob(pipelineContext);

        // Update with runId
        try {
            await generationRecordManager.updateGenerationRecord(generationId, {
                'metadata.run_id': runInfo.runId
            });
            this.logger.info(`[WebhookStrategy] Updated generation ${generationId} with run_id ${runInfo.runId}`);
        } catch (updateErr) {
            this.logger.error(`[WebhookStrategy] Failed to update generation ${generationId} with run_id:`, updateErr.message);
            // Don't throw - webhook processor can still find by run_id in metadata
        }

        // Webhook will handle completion
        return {
            generationId,
            runId: runInfo.runId,
            status: 'processing',
            webhookExpected: true
        };
    }

    /**
     * Normalizes webhook tool output
     */
    normalizeOutput(rawOutput) {
        // ComfyUI-specific normalization
        if (rawOutput?.images) {
            return { images: rawOutput.images };
        }
        return rawOutput;
    }

    /**
     * Handles errors for webhook tools
     */
    async handleError(error, executionContext, dependencies) {
        // Webhook tools don't poll, errors come via webhook
        return { handled: false, shouldRetry: false };
    }
}

module.exports = WebhookStrategy;

