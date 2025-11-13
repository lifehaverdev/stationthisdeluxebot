/**
 * WebhookStrategy - Execution strategy for webhook tools (ComfyUI)
 * 
 * Handles tools that rely on webhooks for completion notification.
 */

const ExecutionStrategy = require('./ExecutionStrategy');

class WebhookStrategy extends ExecutionStrategy {
    constructor({ logger, adapterCoordinator }) {
        super({ type: 'webhook', logger });
        this.adapterCoordinator = adapterCoordinator;
    }

    /**
     * Executes webhook tool
     */
    async execute(inputs, executionContext, dependencies) {
        const { tool } = executionContext;

        this.logger.info(`[WebhookStrategy] Executing webhook tool ${tool.toolId}`);

        // Use AdapterCoordinator to create job (no polling for webhook tools)
        const result = await this.adapterCoordinator.executeWithAdapter(
            tool,
            inputs,
            executionContext,
            dependencies
        );

        // Webhook will handle completion
        return {
            generationId: result.generationId,
            runId: result.runId,
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

