/**
 * SpellExecutor - Orchestrates spell-level execution
 * 
 * Handles spell initialization and delegates to StepExecutor.
 */

const StepExecutor = require('./StepExecutor');

class SpellExecutor {
    constructor({ logger, stepExecutor }) {
        this.logger = logger;
        this.stepExecutor = stepExecutor;
    }

    /**
     * Executes a spell starting from the first step
     * @param {Object} spell - Spell definition
     * @param {Object} context - Initial execution context from /cast command
     * @returns {Promise<void>}
     */
    async execute(spell, context) {
        this.logger.info(`[SpellExecutor] Starting execution for spell: "${spell.name}" (ID: ${spell._id})`);

        // Normalize the 'prompt' parameter to 'input_prompt' for consistency
        if (context.parameterOverrides && context.parameterOverrides.prompt && !context.parameterOverrides.input_prompt) {
            this.logger.info('[SpellExecutor] Adding alias "input_prompt" for provided "prompt" input.');
            context.parameterOverrides.input_prompt = context.parameterOverrides.prompt;
            // Keep original 'prompt' key so tools that expect it still work
        }

        // The initial pipeline context starts with the global parameters from the /cast command
        const initialPipelineContext = { ...context.parameterOverrides };

        // Execute first step
        await this.stepExecutor.executeStep(spell, 0, initialPipelineContext, context);
    }
}

module.exports = SpellExecutor;

