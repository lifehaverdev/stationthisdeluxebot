// inspect_gens.js
// require('dotenv').config();
const { MongoClient } = require('mongodb');

async function inspectGensCollection() {
    const MONGO_URI = process.env.MONGO_PASS || process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const DB_NAME = process.env.BOT_NAME;
    const COLLECTION_NAME = 'gens';

    if (!DB_NAME) {
        console.error('Error: BOT_NAME environment variable is not set.');
        return;
    }

    const client = new MongoClient(MONGO_URI);

    try {
        await client.connect();
        console.log('Successfully connected to MongoDB.');

        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        console.log(`\nFetching the 20 most recent documents from '${COLLECTION_NAME}' sorted by 'timestamp' (descending)...`);

        const recentDocs = await collection.find({})
            .sort({ timestamp: -1 }) // Assuming timestamp is numeric and higher is newer
            .limit(20)
            .toArray();

        if (recentDocs.length === 0) {
            console.log(`No documents found in the '${COLLECTION_NAME}' collection.`);
            return;
        }

        console.log(`\nFound ${recentDocs.length} documents:\n`);
        const twentyFourHoursAgoMs = Date.now() - (24 * 60 * 60 * 1000);
        console.log(`"24 hours ago" timestamp (ms): ${twentyFourHoursAgoMs} (ISO: ${new Date(twentyFourHoursAgoMs).toISOString()})\n`);

        recentDocs.forEach(doc => {
            const docTimestamp = doc.timestamp; // Assuming the field is named 'timestamp'
            const isRecent = docTimestamp >= twentyFourHoursAgoMs;
            console.log(`  _id: ${doc._id}`);
            console.log(`    timestamp: ${docTimestamp} (Type: ${typeof docTimestamp})`);
            if (typeof docTimestamp === 'number') {
                console.log(`    ISO Date: ${new Date(docTimestamp).toISOString()}`);
                console.log(`    Should appear in last 24h stats: ${isRecent ? 'YES' : 'NO'}`);
            } else {
                console.log(`    WARNING: Timestamp is not a number. Cannot reliably convert to date or compare for recency.`);
            }
            // You can print other fields from 'doc' here if needed for context
            // console.log('    Full doc:', JSON.stringify(doc, null, 2));
            console.log('---');
        });

    } catch (err) {
        console.error('An error occurred:', err);
    } finally {
        await client.close();
        console.log('\nConnection to MongoDB closed.');
    }
}

inspectGensCollection();