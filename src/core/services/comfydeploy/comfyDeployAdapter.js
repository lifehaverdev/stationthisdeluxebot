/**
 * ComfyDeployAdapter - Adapter wrapping ComfyUIService for the AdapterRegistry
 *
 * Implements startJob(inputs) so StrategyFactory can select WebhookStrategy
 * for comfyui tools. The deploymentId is injected via tool.metadata.defaultAdapterParams
 * by AdapterCoordinator before startJob is called.
 */

class ComfyDeployAdapter {
    constructor(comfyUIService) {
        this.svc = comfyUIService;
    }

    /**
     * Start a ComfyDeploy run.
     * @param {Object} inputs - Merged inputs including deploymentId from defaultAdapterParams
     * @returns {Promise<{ runId: string }>}
     */
    async startJob(inputs) {
        const { deploymentId, ...workflowInputs } = inputs;

        if (!deploymentId) {
            throw new Error('ComfyDeployAdapter.startJob: deploymentId is required (check tool.metadata.defaultAdapterParams)');
        }

        const runId = await this.svc.submitRequest({
            deploymentId,
            inputs: workflowInputs
        });

        return { runId };
    }
}

module.exports = ComfyDeployAdapter;
