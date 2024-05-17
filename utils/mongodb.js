const { MongoClient } = require("mongodb");
const defaultUserData = require("./defaultUserData.js");
require("dotenv").config()
// Replace the uri string with your connection string.
const uri = process.env.MONGO_PASS
// Replace 'stationthisbot' with your database name
const dbName = 'stationthisdeluxebot';

const client = new MongoClient(uri);

// Connect to the MongoDB server
async function connectToMongoDB() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
}

async function writeUserData(userId, data) {
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);
    
    try {
        const collection = client.db('stationthisdeluxebot').collection('users');
        // Upsert the document with wallet address as the filter
        const filter = { userId: userId };
        await collection.updateOne( filter,
            { $set: { ...data } },
        );
        console.log('User data written successfully');
        return true
    } catch (error) {
        console.error("Error writing user data:", error);
        return false
    } finally {
        // Close the connection if it was established within this function
        await client.close();
    }
}

async function readUserData(walletAddress) {
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);
    const collection = client.db('stationthisdeluxebot').collection('users');
    try {
        // Find the document with the given wallet address
        let userData = await collection.findOne({ wallet: walletAddress });

        // If document doesn't exist, insert default user data
        if (!userData) {
            const defaultUserData = { /* Your default user data */ };
            await collection.insertOne({
                wallet: walletAddress,
                ...defaultUserData
            });
            userData = defaultUserData;
            console.log('Default user data inserted');
        }

        console.log('User data retrieved successfully');
        return userData;
    } catch (error) {
        console.error("Error getting user data:", error);
        //throw error;
        return false
    } finally {
        await client.close();
    }
}

async function getUserDataByUserId(userId) {
    //deleteUserSettingsByUserId('stationthisdeluxebot',userId);
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);
    let userData
    //console.log('this is what we think default is',defaultUserData)
    try {
        // Connect to the MongoDB server
        //await client.connect();

        // Access the database and the "users" collection
        const db = client.db('stationthisdeluxebot');
        const userSettingsCollection = db.collection('users');

        // Query for the user settings by userId
        userData = await userSettingsCollection.findOne({ userId: userId });
        //console.log('userData in get userdatabyuserid',userData);
        if (userData != null){
            console.log('User settings found:', userData);
            return userData;
        } else {
            console.log('empty user settings');
            userSettings = { ...defaultUserData, userId: userId };
            console.log('userSettings we are writing',userSettings);
            await userSettingsCollection.insertOne(userSettings);
            console.log('New user settings created:', userSettings.userId);
            return userSettings
        }
    } catch (error) {
        console.error('Error getting user settings:', error);
        //throw error;
        return false;
    } finally {
        // Close the connection
        await client.close();
    }
}

async function deleteUserSettingsByUserId(dbName, userId) {
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();

        // Access the database and the "usersettings" collection
        const db = client.db(dbName);
        const userSettingsCollection = db.collection('users');

        // Delete the document with the provided userId
        const result = await userSettingsCollection.deleteOne({ userId: userId });

        if (result.deletedCount === 1) {
            console.log('User settings deleted successfully');
        } else {
            console.log('No user settings found for the provided userId');
        }
    } catch (error) {
        console.error('Error deleting user settings:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}

async function listDatabases() {
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();

        // List the databases
        const databasesList = await client.db().admin().listDatabases();

        console.log('Databases:');
        databasesList.databases.forEach(db => {
            console.log(`- ${db.name}`);
        });
    } catch (error) {
        console.error('Error listing databases:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}

async function createDatabase(dbName) {
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();

        // Create the new database
        await client.db(dbName).createCollection('users'); // Creating a dummy collection

        console.log(`Database '${dbName}' created successfully`);
    } catch (error) {
        console.error('Error creating database:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}

// Replace 'stationthisdeluxebot' with your desired database name
//const dbName = 'stationthisdeluxebot';
//createDatabase(dbName);

// Call the function to list databases
//listDatabases();

async function printAllDocuments(dbName, collectionName) {
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();

        // Access the database and the specified collection
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

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

async function printAllCollections(dbName) {
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();

        // Access the database
        const db = client.db(dbName);

        // Get a list of all collections in the database
        const collections = await db.listCollections().toArray();

        // Print the names of all collections
        console.log(`Collections in database '${dbName}':`);
        collections.forEach(collection => {
            console.log(collection.name);
        });
    } catch (error) {
        console.error('Error printing collections:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}


// Replace 'usersettings' with the name of the collection you want to print documents from
const collectionName = 'users';
async function removeDuplicates(dbName, collectionName, criteria) {
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();

        // Access the database and the specified collection
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Aggregate to find and remove duplicates based on criteria
        const pipeline = [
            // Group by criteria and count occurrences
            { $group: { _id: `$${criteria}`, count: { $sum: 1 }, docs: { $push: '$$ROOT' } } },
            // Filter only duplicates (count > 1)
            { $match: { count: { $gt: 1 } } }
        ];

        // Execute the aggregation pipeline
        const duplicates = await collection.aggregate(pipeline).toArray();

        // Iterate over duplicates and remove them
        for (const duplicate of duplicates) {
            // Sort docs by _id or any other criteria to keep one and remove others
            const sortedDocs = duplicate.docs.sort((a, b) => a._id - b._id); // Replace `_id` with your sort criteria
            // Keep the first document and remove the rest
            const [firstDoc, ...otherDocs] = sortedDocs;
            // Remove the duplicates from the collection
            for (const doc of otherDocs) {
                await collection.deleteOne({ _id: doc._id });
                console.log('Duplicate removed:', doc);
            }
        }

        console.log('Duplicates removed successfully');
    } catch (error) {
        console.error('Error removing duplicates:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}

async function deleteAllDocuments(dbName, collectionName) {

    // Create a new MongoClient
    const client = new MongoClient(uri);

    try {
        // Connect to the MongoDB server
        await client.connect();

        // Access the database and the specified collection
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Delete all documents from the collection
        const result = await collection.deleteMany({});

        console.log(`Deleted ${result.deletedCount} documents from the collection '${collectionName}'`);
    } catch (error) {
        console.error('Error deleting documents:', error);
    } finally {
        // Close the connection
        await client.close();
    }
}

//removeDuplicates(dbName, collectionName, '_id');
// Call the function to print all documents in the collection
//printAllDocuments(dbName, collectionName);
//deleteAllDocuments(dbName,'users')
//printAllCollections(dbName)

module.exports = { readUserData, writeUserData, getUserDataByUserId }