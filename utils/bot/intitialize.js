const { MongoClient } = require("mongodb");
const { loraTriggers } = require('../bot/bot')
// read mongodb for burns, return object for addresses
async function readBurns() {
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();

        // Access the database and the specified collection
        const db = client.db(process.env.BOT_NAME);
        const collection = db.collection('burns');

        // Find all documents in the collection
        const documents = await collection.find().toArray();
        documents.forEach(doc => {
            console.log('Document:', doc);
        });

        console.log('All documents printed successfully');
    } catch (error) {
        console.error('Error printing documents:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}

// read mongodb for loras, return loraTrigger object
async function readLoraList() {
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

        // Find all documents in the collection
        const document = await collection.findOne()
        if (document && document.loraTriggers) {
            // Parse the loraTriggers field and update the existing array
            loraTriggers.length = 0; // Clear the existing array
            //const parsedTriggers = 
            document.loraTriggers.map(triggerStr => loraTriggers.push(triggerStr))//JSON.parse(triggerStr));
            
            //loraTriggers.push(...parsedTriggers); // Push new elements into the array
        }

        console.log('loraTriggers loaded');
        console.log(JSON.stringify(loraTriggers))
    } catch (error) {
        console.error('Error printing documents:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}

async function initialize() {
    console.log('initializing...')
    console.log('getting lora list');
    await readLoraList();
    console.log('reading burns');
    //await readBurns();
    console.log('ready...!')
}

module.exports = {
    initialize
}