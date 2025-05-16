const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();

async function clearStudio() {
    let client;
    try {
        console.log('Connecting to MongoDB...');
        client = await MongoClient.connect(process.env.MONGO_PASS);
        const db = client.db('stationthisbot');
        const studio = db.collection('studio');

        console.log('Counting pieces...');
        const count = await studio.countDocuments({});
        console.log(`Found ${count} pieces in studio`);

        if (count > 0) {
            console.log('Deleting all pieces...');
            const result = await studio.deleteMany({});
            console.log(`Deleted ${result.deletedCount} pieces`);
        }

        console.log('Studio cleared successfully!');
    } catch (error) {
        console.error('Error clearing studio:', error);
    } finally {
        if (client) {
            await client.close();
            console.log('MongoDB connection closed');
        }
    }
}

// Run the script
clearStudio();