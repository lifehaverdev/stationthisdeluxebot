const { MongoClient } = require("mongodb");
//const { updateAllUsersWithCheckpoint, updateAllUserSettings } = require('./mongodb')
require("dotenv").config()
const { loraTriggers } = require('../utils/models/loraTriggerTranslate')

//updateAllUsersWithCheckpoint();
//updateAllUserSettings()

async function insertLoraTriggers() {
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();

        // Access the database and the specified collection
        const db = client.db(process.env.BOT_NAME);
        const collection = db.collection('loralist');

        // Insert the loraTriggers array into the collection
        const result = await collection.insertOne({ loraTriggers });

        console.log(`Inserted document with _id: ${result.insertedId}`);
    } catch (error) {
        console.error('Error inserting document:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}

// Call the function to insert the loraTriggers array
insertLoraTriggers();