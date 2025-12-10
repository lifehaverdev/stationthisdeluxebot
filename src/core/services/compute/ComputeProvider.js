/**
 * Base class for remote compute providers (VastAI, RunPod, local SSH, etc.).
 * Providers should extend this class and implement all abstract methods.
 */
class ComputeProvider {
  constructor({ logger }) {
    if (!logger) {
      throw new Error('ComputeProvider requires a logger');
    }
    this.logger = logger;
  }

  /**
   * Search for available offers/machines matching the desired spec.
   * @param {Object} criteria - GPU count, VRAM, price caps, etc.
   * @returns {Promise<Array>} Ranked offers with provider-specific metadata.
   */
  async searchOffers(criteria) { // eslint-disable-line no-unused-vars
    throw new Error('searchOffers() not implemented');
  }

  /**
   * Provision a machine for a specific training job.
   * @param {Object} jobContext - jobId, dataset info, preferred template, etc.
   * @returns {Promise<Object>} Connection metadata (sshHost, instanceId, cleanup token, etc.).
   */
  async provisionInstance(jobContext) { // eslint-disable-line no-unused-vars
    throw new Error('provisionInstance() not implemented');
  }

  /**
   * Fetch current status / metrics for an active instance.
   * @param {string} instanceId
   * @returns {Promise<Object>}
   */
  async getInstanceStatus(instanceId) { // eslint-disable-line no-unused-vars
    throw new Error('getInstanceStatus() not implemented');
  }

  /**
   * Terminate an instance and release all resources.
   * @param {string} instanceId
   * @param {Object} options - additional provider-specific cleanup hints.
   */
  async terminateInstance(instanceId, options = {}) { // eslint-disable-line no-unused-vars
    throw new Error('terminateInstance() not implemented');
  }
}

module.exports = ComputeProvider;
