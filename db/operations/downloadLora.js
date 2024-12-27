require('dotenv').config();
const LoraDB = require('../models/loralist');
const fs = require('fs').promises;
const path = require('path');

async function downloadLoraTriggers() {
    try {
        console.log('Initializing LoraDB...');
        const loraDB = new LoraDB();

        console.log('Fetching LoRA triggers document...');
        const document = await loraDB.findOne();

        if (!document || !document.loraTriggers) {
            console.log('No LoRA triggers found');
            return [];
        }

        console.log(`Found ${document.loraTriggers.length} LoRA triggers`);
        
        // Create CSV header
        const csvHeader = [
            'lora_name',
            'default_weight',
            'version',
            'type',
            'gate',
            'civitaiLink',
            'description',
            'triggerWords',
            'uses'
        ].join(',') + '\n';

        // Convert each trigger to CSV row
        const csvRows = document.loraTriggers.map(trigger => {
            return [
                `"${trigger.lora_name || ''}"`,
                trigger.default_weight || '',
                `"${trigger.version || ''}"`,
                `"${trigger.type || ''}"`,
                trigger.gate || '0',
                `"${trigger.civitaiLink || ''}"`,
                `"${(trigger.description || '').replace(/"/g, '""')}"`, // Escape quotes in description
                `"${(trigger.triggerWords || []).join('|')}"`,
                trigger.uses || '0'
            ].join(',');
        }).join('\n');

        // Combine header and rows
        const csvContent = csvHeader + csvRows;

        // Create timestamp for filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputPath = path.join(__dirname, '..', 'data', `lora_triggers_${timestamp}.csv`);

        // Ensure the data directory exists
        await fs.mkdir(path.join(__dirname, '..', 'data'), { recursive: true });

        // Write CSV file
        await fs.writeFile(outputPath, csvContent);

        console.log(`Successfully saved CSV to: ${outputPath}`);
        
        return document.loraTriggers;
    } catch (error) {
        console.error('Error downloading LoRA triggers:', error);
        throw error;
    }
}

// Run the script if called directly
if (require.main === module) {
    downloadLoraTriggers()
        .then(() => process.exit(0))
        .catch(error => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = { downloadLoraTriggers };
