// inspect_history_events.js
// require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb'); // ObjectId might be useful if we need to inspect specific docs later

async function inspectHistoryEvents() {
    const MONGO_URI = process.env.MONGO_PASS || process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const DB_NAME = process.env.BOT_NAME;
    const COLLECTION_NAME = 'history';
    const DAYS_TO_INSPECT = 3;

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
            timestamp: { $gte: NDaysAgo } // Assuming timestamp is a BSON Date or ISO string
        }).sort({ timestamp: 1 }).toArray(); // Sort by time ascending to see sequence

        if (documents.length === 0) {
            console.log(`No documents found in the '${COLLECTION_NAME}' collection for the specified period.`);
            return;
        }

        console.log(`\nFound ${documents.length} documents. Analyzing event types...\n`);

        const uniqueTypes = new Set();
        const uniqueDataEventTypes = new Set(); // For type: 'queue_event' or similar
        const uniqueDataCommands = new Set();   // For type: 'command'
        const otherDataStructures = {}; // To catch other interesting data structures

        documents.forEach(doc => {
            uniqueTypes.add(doc.type);

            if (doc.type === 'queue_event' && doc.data && typeof doc.data.eventType === 'string') {
                uniqueDataEventTypes.add(doc.data.eventType);
            } else if (doc.type === 'command' && doc.data && typeof doc.data.command === 'string') {
                uniqueDataCommands.add(doc.data.command);
            } else if (doc.data) {
                // For other types with a 'data' field, let's list the type and an example of its data keys
                if (!otherDataStructures[doc.type]) {
                    otherDataStructures[doc.type] = new Set();
                }
                Object.keys(doc.data).forEach(key => otherDataStructures[doc.type].add(key));
            }
        });

        console.log("--- Unique Event Analysis ---");
        console.log("\nUnique 'type' values found:");
        uniqueTypes.forEach(type => console.log(`- ${type}`));

        if (uniqueDataEventTypes.size > 0) {
            console.log("\nUnique 'data.eventType' values (for type: 'queue_event' or similar):");
            uniqueDataEventTypes.forEach(eventType => console.log(`- ${eventType}`));
        }

        if (uniqueDataCommands.size > 0) {
            console.log("\nUnique 'data.command' values (for type: 'command'):");
            uniqueDataCommands.forEach(command => console.log(`- ${command}`));
        }

        if (Object.keys(otherDataStructures).length > 0) {
            console.log("\nOther 'type' values with 'data' fields (listing keys found in data object):");
            for (const type in otherDataStructures) {
                console.log(`- Type: '${type}', Data Keys: [${Array.from(otherDataStructures[type]).join(', ')}]`);
            }
        }
        
        console.log("\n--- End of Analysis ---");
        console.log(`\nConsider manually inspecting some full documents for types you want to understand better, e.g., using MongoDB Compass or another script with specific document IDs.`);


    } catch (err) {
        console.error('An error occurred:', err);
    } finally {
        if (client) {
            await client.close();
            console.log('\nConnection to MongoDB closed.');
        }
    }
}

inspectHistoryEvents();