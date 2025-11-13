/**
 * OutputProcessor - Processes and maps step outputs
 * 
 * Handles output extraction, normalization, and mapping to next step inputs.
 */

class OutputProcessor {
    constructor({ logger }) {
        this.logger = logger;
    }

    /**
     * Extracts output from a completed generation record
     * @param {Object} completedGeneration - Completed generation record
     * @returns {Object} - Extracted output
     */
    extractOutput(completedGeneration) {
        // Extract generic output formats
        let stepOutput = (completedGeneration.responsePayload?.[0]?.data) || completedGeneration.responsePayload || {};
        
        // Handle null case
        if (stepOutput === null) {
            stepOutput = {};
        }
        
        return stepOutput;
    }

    /**
     * Normalizes output to common fields
     * @param {Object} stepOutput - Raw step output
     * @returns {Object} - Normalized output
     */
    normalizeOutput(stepOutput) {
        // OpenAI/LLM variants - normalize to 'text' field
        if (stepOutput.result && !stepOutput.text) {
            stepOutput.text = stepOutput.result;
        }
        if (stepOutput.response && !stepOutput.text) {
            stepOutput.text = stepOutput.response;
        }
        if (Array.isArray(stepOutput.choices) && stepOutput.choices[0]?.message?.content && !stepOutput.text) {
            stepOutput.text = stepOutput.choices[0].message.content;
        }
        if (stepOutput.output && typeof stepOutput.output === 'string' && !stepOutput.text) {
            stepOutput.text = stepOutput.output;
        }
        
        return stepOutput;
    }

    /**
     * Maps output to next step inputs based on outputMappings
     * @param {Object} stepOutput - Normalized step output
     * @param {Object} outputMappings - Output mappings from step definition
     * @returns {Object} - Mapped inputs for next step
     */
    mapOutput(stepOutput, outputMappings) {
        const next_inputs = {};
        
        if (!stepOutput || Object.keys(stepOutput).length === 0) {
            this.logger.warn(`[OutputProcessor] Step produced empty output. Next step may fail if it requires inputs.`);
            return next_inputs;
        }

        // Handle the common case of chaining image outputs to image inputs
        if (Array.isArray(stepOutput.images) && stepOutput.images.length > 0 && stepOutput.images[0].url) {
            // If there's no explicit mapping for 'images', default to mapping it to 'input_image'
            if (!outputMappings || !outputMappings.images) {
                const imageUrl = stepOutput.images[0].url;
                next_inputs.input_image = imageUrl;
                this.logger.info(`[OutputProcessor] Mapped "images" output to "input_image" via default convention with URL: ${imageUrl}`);
            }
        }

        // Process each output field
        for (const outputKey in stepOutput) {
            // 1. Check for an explicit mapping
            if (outputMappings && outputMappings[outputKey]) {
                const inputKey = outputMappings[outputKey];
                next_inputs[inputKey] = stepOutput[outputKey];
                this.logger.info(`[OutputProcessor] Mapped output "${outputKey}" to input "${inputKey}".`);
            // 2. Fallback to the prefix convention if no explicit mapping exists
            } else if (outputKey.startsWith('output_')) {
                const inputKey = 'input_' + outputKey.substring('output_'.length);
                next_inputs[inputKey] = stepOutput[outputKey];
                this.logger.info(`[OutputProcessor] Mapped output "${outputKey}" to input "${inputKey}" via default convention.`);
            } else {
                // 3. Carry over any other fields that don't match
                // Avoid overwriting a more specific mapping (like input_image) with a broader one (like the images array)
                if (!next_inputs[outputKey]) {
                    next_inputs[outputKey] = stepOutput[outputKey];
                }
            }
        }

        return next_inputs;
    }

    /**
     * Processes output and builds inputs for next step
     * @param {Object} completedGeneration - Completed generation record
     * @param {Object} step - Current step definition
     * @returns {Object} - { stepOutput, next_inputs }
     */
    processOutput(completedGeneration, step) {
        const outputMappings = step.outputMappings || {};
        
        // Extract output
        let stepOutput = this.extractOutput(completedGeneration);
        
        // Normalize output
        stepOutput = this.normalizeOutput(stepOutput);
        
        // Map output to next step inputs
        const next_inputs = this.mapOutput(stepOutput, outputMappings);
        
        return { stepOutput, next_inputs };
    }
}

module.exports = OutputProcessor;

