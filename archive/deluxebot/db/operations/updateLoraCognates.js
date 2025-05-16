const fs = require('fs');
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config();

const uri = process.env.MONGO_PASS;
const dbName = 'stationthisbot';

function fixJsonString(str) {
    if (!str || str === '[]' || str === 'cognatesJson') {
        console.log('Empty or invalid string:', str);
        return null;
    }
    
    console.log('\nFixing JSON string:');
    console.log('Input:', str);
    
    // First try to parse it directly
    try {
        const parsed = JSON.parse(str);
        console.log('Direct parse successful:', parsed);
        return JSON.stringify(parsed); // Return clean JSON string
    } catch (e) {
        console.log('Not valid JSON, attempting to fix...');
    }
    
    // Handle the backslash format
    let cleaned = str
        .replace(/\\"/g, '"')  // Replace escaped quotes with quotes
        .replace(/\\/g, '"')   // Replace remaining backslashes with quotes
        .replace(/\s+/g, ' ')  // Normalize whitespace
        .replace(/"{/g, '{')   // Remove extra quotes around objects
        .replace(/}"/g, '}');  // Remove extra quotes around objects
    
    // Add missing closing braces if needed
    if (!cleaned.endsWith('}]')) {
        cleaned = cleaned.replace(/}*$/, '') + '}]';
    }
        
    console.log('Cleaned string:', cleaned);
    
    try {
        const parsed = JSON.parse(cleaned);
        console.log('Parsed result:', parsed);
        
        if (!Array.isArray(parsed)) {
            console.log('Not an array, rejecting');
            return null;
        }
        
        // Validate each cognate object has required fields
        for (const cognate of parsed) {
            console.log('Checking cognate:', cognate);
            if (!cognate.word) {
                console.log('Missing word field, rejecting');
                return null;
            }
            // Only set default replaceWith if it's missing
            if (!cognate.replaceWith) {
                console.log(`No replaceWith for "${cognate.word}", using word as default`);
                cognate.replaceWith = cognate.word;
            }
        }
        
        console.log('Final validated cognates:', parsed);
        return JSON.stringify(parsed);
        
    } catch (e) {
        console.log('Failed to parse:', e.message);
        return null;
    }
}

async function updateLoraCognates() {
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('Connected to MongoDB');

        const db = client.db(dbName);
        const lorasCollection = db.collection('loras');

        // Read and parse the CSV
        const csvContent = fs.readFileSync('./db/data/enriched_loras.csv', 'utf8');
        const lines = csvContent.trim().split('\n');

        console.log('Processing cognates updates...');
        let updateCount = 0;
        let skipCount = 0;
        let errorCount = 0;

        for (const line of lines) {
            const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            
            const loraName = values[0].replace(/"/g, '');
            const cognatesStr = values[11]; // The cognates column

            console.log('\n=== DETAILED DEBUG ===');
            console.log('Full CSV line:', line);
            console.log('Values array:', values);
            console.log('LoRA name:', loraName);
            console.log('Raw cognates (with quotes):', cognatesStr);
            const unescapedStr = cognatesStr?.replace(/\\"/g, '"').replace(/^"|"$/g, '');
            console.log('Raw cognates (unescaped and trimmed):', unescapedStr);
            console.log('===================\n');

            if (!cognatesStr || cognatesStr === '[]') {
                console.log('Skipping empty cognates');
                skipCount++;
                continue;
            }

            try {
                // Use the unescaped and trimmed string
                const cognates = JSON.parse(unescapedStr);
                console.log('Parsed cognates:', cognates);
                
                if (Array.isArray(cognates) && cognates.length > 0) {
                    console.log(`Updating ${loraName} with cognates:`, cognates);
                    
                    // Force update
                    const result = await lorasCollection.updateOne(
                        { lora_name: loraName },
                        { $set: { cognates: cognates } },
                        { upsert: true }
                    );

                    if (result.modifiedCount > 0 || result.upsertedCount > 0) {
                        updateCount++;
                        console.log(`Successfully updated ${loraName}`);
                    } else {
                        console.log(`No update needed for ${loraName} (data unchanged)`);
                    }
                }
            } catch (e) {
                console.error(`Error processing ${loraName}:`, e);
                errorCount++;
            }
        }

        console.log('\nUpdate Summary:');
        console.log(`Total LoRAs processed: ${lines.length}`);
        console.log(`LoRAs updated: ${updateCount}`);
        console.log(`LoRAs skipped (no cognates): ${skipCount}`);
        console.log(`Errors encountered: ${errorCount}`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.close();
        console.log('Disconnected from MongoDB');
    }
}

updateLoraCognates().catch(console.error);