const readline = require('readline');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGO_PASS;
const dbName = process.env.BOT_NAME || 'stationthisbot';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function addLoraInteractive() {
    const client = new MongoClient(uri);
    
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('loras');
        
        console.log('\nWelcome to the LoRA addition wizard! 🧙‍♂️\n');
        
        // Basic Information
        const loraName = await question('Enter the LoRA name (e.g., mimany_2flux): ');
        const version = await question('Enter the LoRA version (FLUX or SDXL): ');
        const category = await question('Enter the category (e.g., style, character): ');
        
        // Default weight
        const defaultWeight = await question('Enter the default weight (default is 1): ') || '1';
        
        // Gate value
        const gate = await question('Enter the gate value (default is 0): ') || '0';
        
        // Trigger word
        const triggerWord = await question('Enter the primary trigger word: ');
        
        // Cognates
        console.log('\nNow let\'s set up cognates (words that should be replaced with the trigger word)');
        console.log('Enter each word that should be replaced with "' + triggerWord + '"');
        console.log('Press Enter without typing anything when done.\n');
        
        const cognates = [];
        while (true) {
            const word = await question('Enter a word to replace (or press Enter to finish): ');
            if (!word) break;
            cognates.push({ word, replaceWith: triggerWord });
        }

        // Tags
        console.log('\nNow let\'s add tags for this LoRA');
        console.log('Common tags: ct (community trained), meme, nsfw');
        console.log('Press Enter without typing anything when done.\n');
        
        const tags = {};
        tags[category] = true;
        // Add user-specified tags
        while (true) {
            const tag = await question('Enter a tag (or press Enter to finish): ');
            if (!tag) break;
            tags[tag.toLowerCase()] = true;
        }

        // Metadata
        const metadata = {};
        metadata[category] = true;
        // Add tags to metadata
        for (const tag of Object.keys(tags)) {
            metadata[tag] = true;
        }
        
        // Construct the LoRA object with empty tags
        const newLora = {
            lora_name: loraName,
            default_weight: parseFloat(defaultWeight),
            version: version.toUpperCase(),
            type: category,
            gate: parseInt(gate),
            civitaiLink: null,
            description: null,
            triggerWords: [triggerWord],
            uses: 0,
            exampleImagePath: `loraExamples/${loraName}.jpg`,
            tags: {},
            cognates: cognates,
            disabled: false,
            rating: 0,
            addedDate: Date.now()
        };

        // Populate tags
        newLora.tags[category] = true;
        while (true) {
            const tag = await question('Enter a tag (or press Enter to finish): ');
            if (!tag) break;
            newLora.tags[tag.toLowerCase()] = true;
        }

        // Confirm
        console.log('\nReview your LoRA configuration:');
        console.log(JSON.stringify(newLora, null, 2));
        const confirm = await question('\nDoes this look correct? (y/n): ');

        if (confirm.toLowerCase() !== 'y') {
            console.log('Cancelled. No changes were made.');
            return;
        }

        // Save to database
        const result = await collection.insertOne(newLora);
        if (result.acknowledged) {
            console.log('\nLoRA added successfully! 🎉');
        } else {
            console.error('\nFailed to add LoRA');
        }

    } catch (error) {
        console.error("Error:", error);
    } finally {
        await client.close();
        rl.close();
    }
}

addLoraInteractive();
