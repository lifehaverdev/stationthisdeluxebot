const { MongoClient } = require("mongodb");
const { loraTriggers, burns , rooms} = require('../bot/bot')
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
        // Initialize a map to store the total burned amount for each wallet
        const burnsMap = new Map();

        // Process each document
        documents.forEach(doc => {
        const wallet = doc.wallet;
        const burnts = doc.burns;

        // Initialize the total amount for this wallet if it doesn't exist
        if (!burnsMap.has(wallet)) {
            burnsMap.set(wallet, 0);
        }

        // Sum up the burned amounts for this wallet
        burnts.forEach(burn => {
            burnsMap.set(wallet, burnsMap.get(wallet) + burn.amount);
        });
        });

        burnsMap.forEach((burned, wallet) => {
            burns.push({ wallet, burned });
        });

        // // Convert the map to the desired burns array format
        // const burnsArray = Array.from(burnsMap.entries()).map(([wallet, burned]) => ({
        // wallet,
        // burned
        // }));

        // Log the result
        //console.log('Burns:', burns);
        

        console.log('burns loaded');
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
        //console.log(JSON.stringify(loraTriggers))
    } catch (error) {
        console.error('Error printing documents:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}

async function readRooms() {
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();

        // Access the database and the specified collection
        const db = client.db(process.env.BOT_NAME);
        const collection = db.collection('floorplan');

        // Find all documents in the collection
        const document = await collection.findOne()
        console.log('document found',document)
        if (document && document.rooms) {
            // Parse the loraTriggers field and update the existing array
            rooms.length = 0; // Clear the existing array
            //const parsedTriggers = 
            document.rooms.map(room => rooms.push(room))//JSON.parse(triggerStr));
            
            //loraTriggers.push(...parsedTriggers); // Push new elements into the array
        }

        console.log('Rooms loaded');
        console.log(JSON.stringify(rooms))
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
    await readBurns();
    
    console.log('reading rooms...')
    await readRooms();
    console.log('ready...!')
}

module.exports = {
    initialize
}