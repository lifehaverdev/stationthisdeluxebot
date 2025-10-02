// AdapterRegistry provides a centralized place to register and retrieve
// ToolAdapter implementations keyed by their service identifier (e.g. "openai", "huggingface").
// Each adapter module should call `AdapterRegistry.register(serviceName, adapterInstance)`
// once at module load time so that the rest of the application can dynamically
// dispatch tool execution without switch/case blocks.

class AdapterRegistry {
  constructor() {
    /** @type {Map<string, import('./types').ToolAdapter>} */
    this.adapters = new Map();
  }

  /**
   * Register an adapter implementation for a service key.
   * @param {string} service - Unique identifier for the provider (e.g. "openai").
   * @param {import('./types').ToolAdapter} adapter - Object implementing the ToolAdapter interface.
   */
  register(service, adapter) {
    if (!service || typeof service !== 'string') {
      throw new Error('AdapterRegistry.register: "service" must be a non-empty string');
    }
    if (!adapter) {
      throw new Error(`AdapterRegistry.register: adapter for service \"${service}\" is undefined/null`);
    }
    this.adapters.set(service, adapter);
  }

  /**
   * Retrieve the adapter for the given service key.
   * @param {string} service
   * @returns {import('./types').ToolAdapter | undefined}
   */
  get(service) {
    if (!this.adapters.has(service)) {
      // Attempt lazy load for common adapters
      const mapping = {
        openai: './openai/openAIAdapter',
        huggingface: './huggingface/huggingFaceAdapter'
      };
      const rel = mapping[service];
      if (rel) {
        try {
          require(rel);
        } catch (e) {
          // ignore load failure
        }
      }
    }
    return this.adapters.get(service);
  }

  /**
   * Check if an adapter exists for the service key.
   * @param {string} service
   * @returns {boolean}
   */
  has(service) {
    return this.adapters.has(service);
  }

  /**
   * Expose list of all registered adapters (useful for debugging & tests)
   * @returns {IterableIterator<[string, import('./types').ToolAdapter]>}
   */
  entries() {
    return this.adapters.entries();
  }
}

// Export a singleton instance so consumers share the same registry.
module.exports = new AdapterRegistry();
