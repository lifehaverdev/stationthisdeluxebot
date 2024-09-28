const { MongoClient } = require('mongodb');
require('dotenv').config();

// Command line arguments
const [LORANAME, LORATYPE, LORAVERSION, TRIGGERWORD] = process.argv.slice(2);

if (!LORANAME || !LORATYPE || !LORAVERSION || !TRIGGERWORD) {
    console.error('Please provide all arguments: LORANAME, LORATYPE, LORAVERSION, TRIGGERWORD');
    process.exit(1);
}

async function addLora(loraName, loraType, loraVersion, triggerWord) {
    const uri = process.env.MONGO_PASS; // Ensure you have your MongoDB URI in your .env file
    const dbName = process.env.BOT_NAME || 'stationthisbot'; // Replace with your actual database name
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const collection = client.db(dbName).collection('loralist');

        // Construct the new LoRA object
        const newLora = {
            lora_name: loraName,
            default_weight: 1,
            type: loraType,
            version: loraVersion,
            gate: 0,
            triggerWords: [triggerWord]
        };

        // Update the document by pushing the new LoRA object into the loraTriggers array
        await collection.updateOne(
            {}, // Assuming there's only one document in the collection
            { $push: { loraTriggers: newLora } }
        );

        console.log('LoRA added successfully');
    } catch (error) {
        console.error("Error adding LoRA:", error);
    } finally {
        await client.close();
    }
}

// Call the function with command line arguments
addLora(LORANAME, LORATYPE, LORAVERSION, TRIGGERWORD);
