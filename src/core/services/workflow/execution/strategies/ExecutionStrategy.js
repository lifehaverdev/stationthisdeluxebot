/**
 * ExecutionStrategy - Base class for tool execution strategies
 * 
 * Defines the contract that all execution strategies must implement.
 * Each strategy encapsulates how a specific type of tool should be executed.
 */

class ExecutionStrategy {
    constructor({ type, logger }) {
        this.type = type;
        this.logger = logger;
    }

    /**
     * Executes the tool with the given inputs and context
     * @param {Object} inputs - Tool inputs (pipeline context)
     * @param {Object} executionContext - Execution context (tool, spell, stepIndex, etc.)
     * @param {Object} dependencies - Dependencies (adapter, generationRecordManager, etc.)
     * @returns {Promise<Object>} - Execution result with { generationId, status, ... }
     */
    async execute(inputs, executionContext, dependencies) {
        throw new Error('execute() must be implemented by subclass');
    }

    /**
     * Handles the execution response (optional)
     * Called after execute() if status is 'completed'
     * @param {Object} executionResponse - Result from execute()
     * @param {Object} executionContext - Execution context
     * @param {Object} dependencies - Dependencies
     * @returns {Promise<any>} - Processed response
     */
    async handleResponse(executionResponse, executionContext, dependencies) {
        // Default: no-op
        return executionResponse;
    }

    /**
     * Normalizes tool output to a standard format
     * @param {any} rawOutput - Raw output from tool
     * @returns {Object} - Normalized output
     */
    normalizeOutput(rawOutput) {
        // Default: return as-is
        return rawOutput;
    }

    /**
     * Handles errors during execution (optional)
     * @param {Error} error - The error that occurred
     * @param {Object} executionContext - Execution context
     * @param {Object} dependencies - Dependencies
     * @returns {Promise<{handled: boolean, shouldRetry: boolean}>} - Error handling result
     */
    async handleError(error, executionContext, dependencies) {
        // Default: don't handle, allow to propagate
        return { handled: false, shouldRetry: false };
    }
}

module.exports = ExecutionStrategy;

