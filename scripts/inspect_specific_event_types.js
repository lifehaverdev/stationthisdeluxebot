// inspect_specific_event_types.js
// require('dotenv').config();
const { MongoClient } = require('mongodb');

async function inspectSpecificEventTypes() {
    const MONGO_URI = process.env.MONGO_PASS || process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const DB_NAME = process.env.BOT_NAME;
    const COLLECTION_NAME = 'history';
    const DAYS_TO_INSPECT = 3; // Or more if needed to capture variety

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

        const NDaysAgo = new Date();
        NDaysAgo.setDate(NDaysAgo.getDate() - DAYS_TO_INSPECT);

        console.log(`\nFetching documents from '${COLLECTION_NAME}' for the last ${DAYS_TO_INSPECT} days (since ${NDaysAgo.toISOString()})...`);

        const documents = await collection.find({
            timestamp: { $gte: NDaysAgo }
        }).toArray();

        if (documents.length === 0) {
            console.log(`No documents found in the '${COLLECTION_NAME}' collection for the specified period.`);
            return;
        }

        console.log(`\nFound ${documents.length} documents. Analyzing specific data.eventType values...\n`);

        const uniqueUserStateEventTypes = new Set();
        const uniqueGatekeepingEventTypes = new Set();

        documents.forEach(doc => {
            if (doc.type === 'user_state' && doc.data && typeof doc.data.eventType === 'string') {
                uniqueUserStateEventTypes.add(doc.data.eventType);
            } else if (doc.type === 'gatekeeping' && doc.data && typeof doc.data.eventType === 'string') {
                uniqueGatekeepingEventTypes.add(doc.data.eventType);
            }
        });

        console.log("--- Specific Event Sub-Type Analysis ---");

        if (uniqueUserStateEventTypes.size > 0) {
            console.log("\nUnique 'data.eventType' values for doc.type = 'user_state':");
            uniqueUserStateEventTypes.forEach(eventType => console.log(`- ${eventType}`));
        } else {
            console.log("\nNo 'data.eventType' found for doc.type = 'user_state' or 'user_state' docs have no 'data.eventType' string field.");
        }

        if (uniqueGatekeepingEventTypes.size > 0) {
            console.log("\nUnique 'data.eventType' values for doc.type = 'gatekeeping':");
            uniqueGatekeepingEventTypes.forEach(eventType => console.log(`- ${eventType}`));
        } else {
            console.log("\nNo 'data.eventType' found for doc.type = 'gatekeeping' or 'gatekeeping' docs have no 'data.eventType' string field.");
        }
        
        console.log("\n--- End of Analysis ---");

    } catch (err) {
        console.error('An error occurred:', err);
    } finally {
        if (client) {
            await client.close();
            console.log('\nConnection to MongoDB closed.');
        }
    }
}

inspectSpecificEventTypes();