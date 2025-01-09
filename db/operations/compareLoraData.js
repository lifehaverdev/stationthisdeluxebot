const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();

async function compareLoraData() {
    const uri = process.env.MONGO_PASS;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db('stationthisbot');
        
        // Get the single document from loralist
        const loraListDoc = await db.collection('loralist').findOne({});
        const oldLoraList = loraListDoc?.loraTriggers || [];
        
        // Get all documents from loras collection
        const newLoras = await db.collection('loras').find({}).toArray();

        console.log(`Found ${oldLoraList.length} entries in loralist array`);
        console.log(`Found ${newLoras.length} entries in loras collection`);

        const triggerIssues = [];

        // Compare triggerWords for each entry
        for (const oldLora of oldLoraList) {
            const newLora = newLoras.find(l => l.lora_name === oldLora.lora_name);
            
            if (!newLora) {
                console.log(`Missing in new collection: ${oldLora.lora_name}`);
                continue;
            }

            // Check for incorrect triggerWords (description in triggerWords)
            if (newLora.triggerWords?.length === 1 && 
                (newLora.triggerWords[0].includes('hand-tagged screenshots') ||
                 newLora.triggerWords[0].length > 100)) {  // Long string likely means it's a description
                
                triggerIssues.push({
                    lora_name: oldLora.lora_name,
                    oldTriggers: oldLora.triggerWords || [],
                    newTriggers: newLora.triggerWords || [],
                    needsUpdate: true
                });
            }
            // Check if triggerWords are different
            else if (JSON.stringify(oldLora.triggerWords?.sort()) !== 
                     JSON.stringify(newLora.triggerWords?.sort())) {
                
                triggerIssues.push({
                    lora_name: oldLora.lora_name,
                    oldTriggers: oldLora.triggerWords || [],
                    newTriggers: newLora.triggerWords || [],
                    needsUpdate: true
                });
            }
        }

        // Print summary
        console.log('\n=== TriggerWords Issues ===');
        console.log(`Found ${triggerIssues.length} LoRAs with trigger word issues`);
        
        // Print detailed issues
        triggerIssues.forEach(issue => {
            console.log(`\n${issue.lora_name}:`);
            console.log('Old triggers:', issue.oldTriggers);
            console.log('New triggers:', issue.newTriggers);
        });

        // Save issues to a file for reference
        const fs = require('fs');
        fs.writeFileSync('lora-trigger-issues.json', JSON.stringify(triggerIssues, null, 2));

        return triggerIssues;

    } catch (error) {
        console.error('Error comparing data:', error);
    } finally {
        await client.close();
    }
}

// Run the comparison
compareLoraData().catch(console.error);