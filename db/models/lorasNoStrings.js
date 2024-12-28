const { BaseDB } = require('./BaseDB');

class LorasDb extends BaseDB {
    constructor() {
        super('loras');
    }

    async addLora(loraData) {
        // Check if LoRA already exists
        const existing = await this.findOne({ lora_name: loraData.lora_name });
        if (existing) {
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

module.exports = { LorasDb };