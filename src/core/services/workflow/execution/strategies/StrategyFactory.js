/**
 * StrategyFactory - Creates default execution strategies for tools
 * 
 * Analyzes tool properties and creates appropriate strategy when tool doesn't define one.
 */

const ImmediateStrategy = require('./ImmediateStrategy');
const AsyncAdapterStrategy = require('./AsyncAdapterStrategy');
const WebhookStrategy = require('./WebhookStrategy');

class StrategyFactory {
    constructor({ logger, adapterRegistry }) {
        this.logger = logger;
        this.adapterRegistry = adapterRegistry;
    }

    /**
     * Creates a default execution strategy for a tool based on its properties
     * @param {Object} tool - Tool definition
     * @returns {ExecutionStrategy} - Appropriate strategy instance
     */
    createDefaultStrategy(tool) {
        // If tool has explicit executionStrategy, use it
        if (tool.executionStrategy) {
            // If it's already an instance, return it
            if (tool.executionStrategy.execute && typeof tool.executionStrategy.execute === 'function') {
                return tool.executionStrategy;
            }
            // If it's a type string, create strategy
            if (typeof tool.executionStrategy === 'string' || tool.executionStrategy.type) {
                const type = typeof tool.executionStrategy === 'string' ? tool.executionStrategy : tool.executionStrategy.type;
                return this._createStrategyByType(type);
            }
        }

        // Determine strategy based on tool properties
        if (tool.deliveryMode === 'immediate') {
            return new ImmediateStrategy({ logger: this.logger });
        }

        // Check if adapter exists and supports async jobs
        const adapter = this.adapterRegistry.get(tool.service);
        if (adapter && typeof adapter.startJob === 'function') {
            // For now, default to AsyncAdapterStrategy
            // In Phase 5, we'll distinguish between async adapter and webhook based on adapter capabilities
            return new AsyncAdapterStrategy({ logger: this.logger });
        }

        // Fallback to immediate strategy
        this.logger.warn(`[StrategyFactory] No adapter found for ${tool.service}, defaulting to immediate strategy`);
        return new ImmediateStrategy({ logger: this.logger });
    }

    /**
     * Creates a strategy instance by type string
     * @param {string} type - Strategy type ('immediate', 'async_adapter', 'webhook')
     * @returns {ExecutionStrategy} - Strategy instance
     */
    _createStrategyByType(type) {
        switch (type) {
            case 'immediate':
                return new ImmediateStrategy({ logger: this.logger });
            case 'async_adapter':
                return new AsyncAdapterStrategy({ logger: this.logger });
            case 'webhook':
                return new WebhookStrategy({ logger: this.logger });
            default:
                this.logger.warn(`[StrategyFactory] Unknown strategy type: ${type}, defaulting to immediate`);
                return new ImmediateStrategy({ logger: this.logger });
        }
    }
}

module.exports = StrategyFactory;

