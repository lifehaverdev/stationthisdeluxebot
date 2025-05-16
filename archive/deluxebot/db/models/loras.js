const { BaseDB } = require('./BaseDB');

class Loras extends BaseDB {
    constructor() {
        super('loras');
    }

    async getLoraMapForCheckpoint(checkpointVersion) {
        console.log(`Building LoRA map for checkpoint: ${checkpointVersion}`);
        
        const loras = await this.findMany({
            version: checkpointVersion,
            disabled: false
        });

        // Create fast lookup maps
        const triggerMap = new Map();
        const cognateMap = new Map();

        loras.forEach(lora => {
            // Add trigger words
            lora.triggerWords?.forEach(trigger => {
                triggerMap.set(trigger.toLowerCase(), {
                    lora_name: lora.lora_name,
                    weight: lora.default_weight,
                    version: lora.version
                });
            });

            // Add cognates
            lora.cognates?.forEach(cognate => {
                if (cognate.word) {
                    cognateMap.set(cognate.word.toLowerCase(), {
                        lora_name: lora.lora_name,
                        weight: lora.default_weight,
                        version: lora.version,
                        replaceWith: cognate.replaceWith
                    });
                }
            });
        });

        console.log(`Found ${triggerMap.size} triggers and ${cognateMap.size} cognates`);
        return { triggerMap, cognateMap };
    }

    // For individual lookups if needed
    async incrementUses(loraName) {
        return this.increment({ lora_name: loraName }, 'uses');
    }

    async addLora(loraData) {
        // Check if LoRA already exists
        const existingLora = await this.findOne({ lora_name: loraData.lora_name });
        if (existingLora) {
            return {
                success: false,
                error: 'LoRA with this name already exists'
            };
        }

        // Validate required fields
        const requiredFields = ['lora_name', 'type', 'category', 'triggerWords'];
        for (const field of requiredFields) {
            if (!loraData[field]) {
                return {
                    success: false,
                    error: `Missing required field: ${field}`
                };
            }
        }

        // Add addedDate field if not present
        if (!loraData.addedDate) {
            loraData.addedDate = Date.now();
        }

        // Insert the new LoRA using BaseDB's insertOne method
        try {
            const result = await this.insertOne(loraData);
            return {
                success: true,
                data: result
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = { Loras };