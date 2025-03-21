const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const fs = require('fs');
dotenv.config();

async function extractLoraWords() {
    const uri = process.env.MONGO_PASS;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db('stationthisbot');
        
        // Get all documents from loras collection
        const loras = await db.collection('loras').find({}).toArray();

        // Create sets to store unique words
        const uniqueWords = new Set();

        // Process each LoRA
        loras.forEach(lora => {
            console.log(`Processing LoRA: ${lora.name || 'unnamed'}`);

            if (lora.version !== 'FLUX') {
                console.log(`Skipping non-FLUX LoRA: ${lora.name || 'unnamed'} (version: ${lora.version})`);
                return;
            }
            
            // Add trigger words
            if (lora.triggerWords && Array.isArray(lora.triggerWords)) {
                console.log(`  Trigger words found: ${lora.triggerWords.length}`);
                lora.triggerWords.forEach(word => {
                    console.log(`    Processing trigger word: "${word}" (${typeof word})`);
                    // Skip if it's '#' or empty
                    if (word && word !== '#' && word.length < 100) {
                        if (typeof word === 'string') {
                            uniqueWords.add(word.trim().toLowerCase());
                        } else {
                            console.log(`    Skipping non-string trigger word: ${word}`);
                        }
                    }
                });
            } else {
                console.log('  No trigger words found');
            }

            // Add cognates
            if (lora.cognates && Array.isArray(lora.cognates)) {
                console.log(`  Cognates found: ${lora.cognates.length}`);
                lora.cognates.forEach(word => {
                    console.log(`    Processing cognate: "${word}" (${typeof word})`);
                    // Skip if it's '#' or empty
                    if (word && word !== '#') {
                        if (typeof word === 'string') {
                            uniqueWords.add(word.trim().toLowerCase());
                        } else {
                            console.log(`    Skipping non-string cognate: ${word}`);
                        }
                    }
                });
            } else {
                console.log('  No cognates found');
            }
        });

        // Convert set to sorted array
        const wordList = Array.from(uniqueWords).sort();

        // Save to file
        fs.writeFileSync('lora-words.txt', wordList.join('\n'));

        console.log(`Extracted ${wordList.length} unique words and saved to lora-words.txt`);

    } catch (error) {
        console.error('Error extracting words:', error);
    } finally {
        await client.close();
    }
}

// Run the extraction
extractLoraWords().catch(console.error);