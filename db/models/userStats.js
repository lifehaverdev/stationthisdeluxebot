const { BaseDB } = require('./BaseDB');

class UserStats extends BaseDB {
    constructor() {
        super('gens');
    }

    async saveGen({ task, run, out }) {
        let groupId;
        task.message.chat.id ? groupId = task.message.chat.id : groupId = 'unknown';

        // 1. Deep clone promptObj to break circular references and work on a copy
        let sanitizedPromptObj;
        try {
            sanitizedPromptObj = structuredClone(task.promptObj);
        } catch (e) {
            // Fallback for environments where structuredClone might not be available or fails
            // This is a simpler clone and might not handle all circular refs as well as structuredClone
            console.warn('structuredClone failed, using JSON.parse(JSON.stringify) fallback for promptObj sanitization. Error:', e);
            try {
                sanitizedPromptObj = JSON.parse(JSON.stringify(task.promptObj));
            } catch (jsonError) {
                console.error('Failed to sanitize promptObj even with JSON fallback:', jsonError);
                // If even JSON stringify/parse fails, store a placeholder or minimal data
                sanitizedPromptObj = { _error: "Failed to serialize promptObj", type: task.promptObj.type, originalPrompt: task.promptObj.prompt };
            }
        }
        
        // 2. Define and remove problematic top-level keys
        // These are examples; adjust based on your actual promptObj structure
        const keysToDelete = ['message', 'bot', 'client', 'api', 'logger', '_isTask', '_alreadySanitized']; 
        for (const key of keysToDelete) {
            delete sanitizedPromptObj[key];
        }

        // 3. Sanitize specific known complex nested fields
        // Example for controlnet_units: remove potentially large base64 image/mask data
        if (Array.isArray(sanitizedPromptObj.controlnet_units)) {
            sanitizedPromptObj.controlnet_units = sanitizedPromptObj.controlnet_units.map(unit => {
                if (unit && typeof unit === 'object') {
                    const saneUnit = { ...unit };
                    // Remove fields that might contain large data or complex objects
                    delete saneUnit.image; 
                    delete saneUnit.mask;
                    // Potentially delete other large or unserializable fields from the unit
                    // delete saneUnit.control_net_module_args; // If this can be very large or complex
                    return saneUnit;
                }
                return unit; // Return as-is if not an object (e.g. already processed or bad data)
            });
        }
        
        // Remove any functions, as BSON cannot store them
        // structuredClone and JSON.stringify usually handle this, but an explicit pass can be safer
        for (const key in sanitizedPromptObj) {
            if (typeof sanitizedPromptObj[key] === 'function') {
                delete sanitizedPromptObj[key];
            }
        }

        // 2. Sanitize run.outputs (which becomes out.urls)
        let sanitizedRunOutputs = [];
        // Ensure run and run.outputs are valid before trying to sanitize
        if (run && Array.isArray(run.outputs)) {
            try {
                sanitizedRunOutputs = structuredClone(run.outputs);
            } catch (e) {
                console.warn('structuredClone failed for run.outputs, using JSON.parse(JSON.stringify) fallback. Error:', e);
                try {
                    sanitizedRunOutputs = JSON.parse(JSON.stringify(run.outputs));
                } catch (jsonError) {
                    console.error('Failed to sanitize run.outputs even with JSON fallback:', jsonError);
                    sanitizedRunOutputs = [{ _error: "Failed to serialize run.outputs. Original data may be lost." }];
                }
            }
        } else if (run && run.outputs) {
            // If run.outputs is not an array but exists, log a warning and keep it empty or as an error marker.
            console.warn('run.outputs was expected to be an array, but was not. Storing empty for outputs.urls.', run.outputs);
            sanitizedRunOutputs = [{ _error: "run.outputs was not an array. Original data may be lost." }];
        }

        // 3. Construct the final 'out' object with sanitized urls and cloned tags/texts
        const finalOut = {
            urls: sanitizedRunOutputs,
            tags: (Array.isArray(out.tags) ? structuredClone(out.tags) : []) || [],
            texts: (Array.isArray(out.texts) ? structuredClone(out.texts) : []) || []
        };

        const genData = {
            userId: task.promptObj.userId, // Original userId is fine
            username: task.promptObj.username || 'unknown', // Original username
            groupId: groupId,
            timestamp: new Date(),
            promptObj: sanitizedPromptObj, // Use the sanitized version
            runId: run.run_id,
            outputs: finalOut, // Use the fully sanitized 'finalOut'
            status: run.status,
            duration: task.runningStop - task.runningStart,
            type: task.promptObj.type // Original type
        };

        return this.insertOne(genData);
    }
    

    // We can add methods for aggregating stats later:

    // async getUserGenerations(userId, limit = 100) { ... }
    // async getGroupGenerations(groupId, limit = 100) { ... }
    // async getGenerationStats(userId) { ... }
}

module.exports = UserStats;