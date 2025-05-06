require('dotenv').config(); // To load MONGO_PASS
const { MongoClient } = require('mongodb');
const { transformUserDataForNoema } = require('./transformUserData.js');

const userIdToMigrate = 5472638766;
const NOEMA_DATABASE_NAME = 'noema';
const mongoUri = process.env.MONGO_PASS;

async function saveMigratedUser() {
    if (!mongoUri) {
        console.error('Error: MONGO_PASS environment variable is not set.');
        process.exit(1);
    }

    let transformedData;
    try {
        transformedData = await transformUserDataForNoema(userIdToMigrate);
        if (!transformedData) {
            console.error(`Failed to transform data for userId: ${userIdToMigrate}. Aborting save.`);
            return;
        }
    } catch (error) {
        console.error(`Error during data transformation: ${error.message}. Aborting save.`);
        return;
    }

    const { newUserCore, newUserEconomy, newUserPreferences } = transformedData;
    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        console.log('Successfully connected to MongoDB for saving to Noema.');

        const db = client.db(NOEMA_DATABASE_NAME);
        console.log(`Targeting database: '${NOEMA_DATABASE_NAME}'`);

        // Insert into userCore collection
        const userCoreCollection = db.collection('userCore'); // New collection name matches ADR
        const coreInsertResult = await userCoreCollection.insertOne(newUserCore);
        console.log(`Inserted into userCore: ${coreInsertResult.insertedId} (Original masterAccountId: ${newUserCore._id})`);

        // Insert into userEconomy collection
        const userEconomyCollection = db.collection('userEconomy'); // New collection name matches ADR
        const economyInsertResult = await userEconomyCollection.insertOne(newUserEconomy);
        console.log(`Inserted into userEconomy: ${economyInsertResult.insertedId} (Linked to masterAccountId: ${newUserEconomy.masterAccountId})`);

        // Insert into userPreferences collection
        const userPreferencesCollection = db.collection('userPreferences'); // New collection name matches ADR
        const prefsInsertResult = await userPreferencesCollection.insertOne(newUserPreferences);
        console.log(`Inserted into userPreferences: ${prefsInsertResult.insertedId} (Linked to masterAccountId: ${newUserPreferences.masterAccountId})`);

        console.log(`\nSuccessfully migrated user ${userIdToMigrate} to the '${NOEMA_DATABASE_NAME}' database.`);

    } catch (err) {
        console.error(`An error occurred while saving to '${NOEMA_DATABASE_NAME}':`, err);
        if (err.code === 11000) { // Duplicate key error
            console.error('This might be a duplicate key error. Has this user already been migrated?');
        }
    } finally {
        await client.close();
        console.log('Connection to MongoDB (Noema) closed.');
    }
}

saveMigratedUser(); 