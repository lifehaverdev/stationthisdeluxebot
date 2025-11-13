/**
 * ParameterResolver - Resolves and validates step parameters
 * 
 * Handles parameter mapping, input pruning, and validation.
 */

const { validateRequiredInputs } = require('../utils/ValidationUtils');

class ParameterResolver {
    constructor({ logger }) {
        this.logger = logger;
    }

    /**
     * Resolves parameter mappings from step definition
     * @param {Object} step - Step definition with parameterMappings
     * @param {Object} pipelineContext - Current pipeline context
     * @returns {Object} - Resolved parameter inputs
     */
    resolveMappings(step, pipelineContext) {
        const resolvedParamInputs = {};
        
        if (!step.parameterMappings) {
            return resolvedParamInputs;
        }

        Object.entries(step.parameterMappings).forEach(([paramKey, mapping]) => {
            if (!mapping || typeof mapping !== 'object') return;
            
            switch (mapping.type) {
                case 'static': {
                    const v = mapping.value;
                    const isEmptyString = typeof v === 'string' && v.trim() === '';
                    if (v !== undefined && v !== null && !isEmptyString) {
                        resolvedParamInputs[paramKey] = v;
                    }
                    break;
                }
                case 'nodeOutput': {
                    const val =
                        pipelineContext[mapping.outputKey] ||
                        pipelineContext[`${mapping.nodeId}_${mapping.outputKey}`] ||
                        pipelineContext[mapping.paramKey];
                    if (val !== undefined) resolvedParamInputs[paramKey] = val;
                    break;
                }
                default:
                    // Unsupported mapping type – ignore silently for now
                    break;
            }
        });

        return resolvedParamInputs;
    }

    /**
     * Prunes inputs based on tool input schema
     * @param {Object} stepInput - Input to prune
     * @param {Object} tool - Tool definition with inputSchema
     * @returns {Object} - Pruned inputs
     */
    pruneInputs(stepInput, tool) {
        if (!tool || !tool.inputSchema || Object.keys(tool.inputSchema).length === 0) {
            return stepInput;
        }

        const allowed = new Set(Object.keys(tool.inputSchema));
        const pruned = {};
        Object.entries(stepInput).forEach(([k, v]) => {
            if (allowed.has(k)) pruned[k] = v;
        });
        
        const removed = Object.keys(stepInput).filter(k => !allowed.has(k));
        if (removed.length) {
            this.logger.debug(`[ParameterResolver] Pruned unmapped inputs for ${tool.displayName}: ${removed.join(', ')}`);
        }
        
        return pruned;
    }

    /**
     * Validates required inputs for a tool
     * @param {Object} tool - Tool definition
     * @param {Object} stepInput - Input to validate
     * @returns {string[]} - Array of missing required input keys
     */
    validateRequiredInputs(tool, stepInput) {
        return validateRequiredInputs(tool, stepInput);
    }

    /**
     * Resolves legacy nodeOutput objects in parameterOverrides
     * @param {Object} step - Step definition
     * @param {Object} pipelineContext - Current pipeline context
     * @param {Object} stepInput - Current step input (will be modified)
     */
    resolveLegacyNodeOutputs(step, pipelineContext, stepInput) {
        Object.entries(step.parameterOverrides || {}).forEach(([key, val]) => {
            if (val && val.type === 'nodeOutput') {
                const mappedVal =
                    pipelineContext[val.outputKey] ||
                    pipelineContext[val.paramKey] ||
                    pipelineContext[`${val.nodeId}_${val.outputKey}`];
                if (mappedVal !== undefined) {
                    stepInput[key] = mappedVal;
                }
            }
        });
    }

    /**
     * Resolves all parameters for a step
     * @param {Object} step - Step definition
     * @param {Object} pipelineContext - Current pipeline context
     * @param {Object} tool - Tool definition
     * @returns {Object} - Fully resolved and pruned inputs
     */
    resolveStepInputs(step, pipelineContext, tool) {
        // 1. Resolve parameterMappings (preferred)
        const resolvedParamInputs = this.resolveMappings(step, pipelineContext);

        // 2. Merge with precedence:
        //    - existing context from previous steps / user inputs
        //    - resolved mappings for this step (explicit wiring)
        //    - legacy parameterOverrides (highest priority)
        let stepInput = { ...pipelineContext, ...resolvedParamInputs, ...step.parameterOverrides };

        // 3. Prune based on tool schema
        stepInput = this.pruneInputs(stepInput, tool);

        // 4. Resolve legacy nodeOutput objects
        this.resolveLegacyNodeOutputs(step, pipelineContext, stepInput);

        return stepInput;
    }
}

module.exports = ParameterResolver;

