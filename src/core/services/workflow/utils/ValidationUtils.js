/**
 * ValidationUtils - Utility functions for validating workflow execution inputs
 * 
 * Provides validation functions for steps, tools, and metadata.
 */

/**
 * Validates step index bounds
 * @param {number} stepIndex - Step index to validate
 * @param {number} totalSteps - Total number of steps in spell
 * @param {string} spellName - Name of the spell (for error messages)
 * @throws {Error} - If stepIndex is invalid
 */
function validateStepIndex(stepIndex, totalSteps, spellName) {
    if (stepIndex < 0 || stepIndex >= totalSteps) {
        throw new Error(`Invalid stepIndex ${stepIndex} for spell "${spellName}" with ${totalSteps} steps`);
    }
}

/**
 * Validates that a step exists and has required properties
 * @param {Object} step - Step object to validate
 * @param {number} stepIndex - Index of the step (for error messages)
 * @param {string} spellName - Name of the spell (for error messages)
 * @throws {Error} - If step is invalid
 */
function validateStep(step, stepIndex, spellName) {
    if (!step) {
        throw new Error(`Step at index ${stepIndex} is undefined in spell "${spellName}"`);
    }
    
    if (!step.toolIdentifier) {
        throw new Error(`Step ${step.stepId || stepIndex} in spell "${spellName}" is missing toolIdentifier`);
    }
}

/**
 * Validates that a tool exists
 * @param {Object} tool - Tool object (can be null/undefined)
 * @param {string} toolIdentifier - Tool identifier that was looked up (for error messages)
 * @param {number|string} stepId - Step ID (for error messages)
 * @param {number} stepIndex - Step index (for error messages)
 * @param {string} spellName - Name of the spell (for error messages)
 * @throws {Error} - If tool is not found
 */
function validateTool(tool, toolIdentifier, stepId, stepIndex, spellName) {
    if (!tool) {
        throw new Error(`Tool with name or ID '${toolIdentifier}' not found in registry for step ${stepId || stepIndex} of spell "${spellName}".`);
    }
}

/**
 * Validates required inputs for a tool based on its input schema
 * @param {Object} tool - Tool object with inputSchema
 * @param {Object} stepInput - Input values to validate
 * @returns {string[]} - Array of missing required input keys
 */
function validateRequiredInputs(tool, stepInput) {
    if (!tool || !tool.inputSchema) {
        return [];
    }

    const missing = Object.entries(tool.inputSchema)
        .filter(([key, def]) => {
            const required = def.required !== false; // default to required
            if (!required) return false;
            const val = stepInput[key];
            if (val === undefined || val === null) return true;
            if (typeof val === 'string' && val.trim() === '') return true;
            return false;
        })
        .map(([key]) => key);

    return missing;
}

/**
 * Validates that a generation record has required metadata
 * @param {Object} completedGeneration - Generation record to validate
 * @throws {Error} - If metadata is missing or invalid
 */
function validateGenerationMetadata(completedGeneration) {
    if (!completedGeneration.metadata) {
        throw new Error('Generation record missing metadata');
    }
    
    const { spell, stepIndex, pipelineContext, originalContext } = completedGeneration.metadata;
    
    if (!spell) {
        throw new Error('Generation metadata missing spell definition');
    }
    
    if (typeof stepIndex !== 'number' || stepIndex < 0) {
        throw new Error(`Generation metadata missing or invalid stepIndex: ${stepIndex}`);
    }
    
    if (!pipelineContext || typeof pipelineContext !== 'object') {
        throw new Error('Generation metadata missing pipelineContext');
    }
    
    if (!originalContext || typeof originalContext !== 'object') {
        throw new Error('Generation metadata missing originalContext');
    }
}

module.exports = {
    validateStepIndex,
    validateStep,
    validateTool,
    validateRequiredInputs,
    validateGenerationMetadata
};

