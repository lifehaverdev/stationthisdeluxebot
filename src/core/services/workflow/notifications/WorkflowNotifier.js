/**
 * WorkflowNotifier - Handles WebSocket notifications for workflow execution
 * 
 * Sends progress updates and tool responses via WebSocket.
 */

class WorkflowNotifier {
    constructor({ logger }) {
        this.logger = logger;
        this.websocketService = require('../../websocket/server');
    }

    /**
     * Notifies user of step progress
     * @param {Object} context - Execution context
     * @param {string} generationId - Generation ID
     * @param {Object} tool - Tool definition
     * @param {Object} options - Additional options
     * @param {number} options.progress - Progress value (0-1)
     * @param {string} options.status - Status string
     * @param {string} options.liveStatus - Live status string
     */
    async notifyStepProgress(context, generationId, tool, options = {}) {
        const {
            progress = 0.5,
            status = 'running',
            liveStatus = 'processing'
        } = options;

        const { originalContext, spell } = context;
        const castId = originalContext.castId || null;
        const cookId = originalContext.cookId || null;
        const collectionId = originalContext.collectionId || null;
        const spellId = spell._id;

        try {
            this.websocketService.sendToUser(
                originalContext.masterAccountId,
                {
                    type: 'generationProgress',
                    payload: {
                        generationId: generationId,
                        status: status,
                        progress: progress,
                        liveStatus: liveStatus,
                        toolId: tool.toolId,
                        spellId: spellId,
                        castId: castId,
                        cookId,
                        collectionId
                    }
                }
            );
        } catch (err) {
            this.logger.error(`[WorkflowNotifier] Failed to send step progress notification: ${err.message}`);
        }
    }

    /**
     * Notifies user of tool response
     * @param {Object} context - Execution context
     * @param {Object} tool - Tool definition
     * @param {any} output - Tool output
     * @param {Object} options - Additional options
     * @param {string} options.requestId - Request ID
     */
    async notifyToolResponse(context, tool, output, options = {}) {
        const { originalContext } = context;
        const { requestId = null } = options;
        const castId = originalContext.castId || null;
        const cookId = originalContext.cookId || null;
        const collectionId = originalContext.collectionId || null;

        try {
            this.websocketService.sendToUser(
                originalContext.masterAccountId,
                {
                    type: 'tool-response',
                    payload: {
                        toolId: tool.toolId,
                        output: output,
                        requestId: requestId,
                        castId: castId,
                        cookId,
                        collectionId
                    }
                }
            );
        } catch (err) {
            this.logger.error(`[WorkflowNotifier] Failed to send tool-response notification: ${err.message}`);
        }
    }

    /**
     * Notifies user of step completion (combines progress and response)
     * @param {Object} context - Execution context
     * @param {string} generationId - Generation ID
     * @param {Object} tool - Tool definition
     * @param {any} output - Tool output
     */
    async notifyStepCompletion(context, generationId, tool, output) {
        // Send progress indicator first
        await this.notifyStepProgress(context, generationId, tool, {
            progress: 0.5,
            status: 'running',
            liveStatus: 'processing'
        });

        // Then send the actual response
        await this.notifyToolResponse(context, tool, output);
    }
}

module.exports = WorkflowNotifier;
