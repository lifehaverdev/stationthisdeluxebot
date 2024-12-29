const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGO_PASS;
const dbName = process.env.BOT_NAME || 'stationthisbot';

async function addTimestamps() {
    console.log('Connecting to database...');
    const client = new MongoClient(uri);
    
    try {
        await client.connect();
        const db = client.db(dbName);
        const loras = db.collection('loras');

        // Get all loras ordered by _id
        const allLoras = await loras.find({}).toArray();
        console.log(`Found ${allLoras.length} loras to update`);

        // Define our date range
        const startDate = new Date('2023-04-01').getTime();
        const endDate = new Date('2023-12-15').getTime();
        const today = Date.now();

        // Calculate distribution
        const totalLoras = allLoras.length;
        const regularLoras = totalLoras - 5; // Leave last 5 for today
        const timeSpan = endDate - startDate;

        // Update each lora
        for (let i = 0; i < allLoras.length; i++) {
            const lora = allLoras[i];
            const timestamp = i >= regularLoras
                ? today  // Last 5 get today's date
                : Math.floor(startDate + (timeSpan * (i / regularLoras))); // Rest are distributed

            console.log(`Updating ${lora.lora_name} with timestamp ${new Date(timestamp).toISOString()}`);
            
            await loras.updateOne(
                { _id: lora._id },
                { $set: { addedDate: timestamp } }
            );
        }

        console.log('\nTimestamp updates complete!');
        console.log(`Updated ${totalLoras} LoRAs:`);
        console.log(`- ${regularLoras} distributed between April and December 2023`);
        console.log(`- Last 5 set to today (${new Date().toISOString()})`);

    } catch (error) {
        console.error("Error:", error);
    } finally {
        await client.close();
    }
}

addTimestamps().catch(console.error);