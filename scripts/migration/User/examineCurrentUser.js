// require('dotenv').config();
const { MongoClient } = require('mongodb');

const dbName = process.env.BOT_NAME;
const mongoUri = process.env.MONGO_PASS;

async function fetchSourceUserData(userIdToExamine) {
    if (!mongoUri) {
        console.error('Error: MONGO_PASS environment variable is not set.');
        throw new Error('MONGO_PASS not set');
    }
    if (!dbName) {
        console.error('Error: BOT_NAME environment variable is not set.');
        throw new Error('BOT_NAME not set');
    }

    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        const db = client.db(dbName);

        const userCoreCollection = db.collection('users_core');
        const coreData = await userCoreCollection.findOne({ userId: userIdToExamine });

        const userEconomyCollection = db.collection('users_economy');
        const economyData = await userEconomyCollection.findOne({ userId: userIdToExamine });

        const userPreferencesCollection = db.collection('users_preferences');
        const preferencesData = await userPreferencesCollection.findOne({ userId: userIdToExamine });

        return { coreData, economyData, preferencesData };

    } finally {
        if (client) {
            await client.close();
        }
    }
}

if (require.main === module) {
    const userIdToExamine = 5472638766;
    console.log('Successfully connected to MongoDB.');

    fetchSourceUserData(userIdToExamine)
        .then(({ coreData, economyData, preferencesData }) => {
            console.log(`\n--- Examining User Data for userId: ${userIdToExamine} in database: ${dbName} ---`);
            console.log('\n--- users_core Data ---');
            console.log(JSON.stringify(coreData, null, 2) || 'No data found in users_core.');
            console.log('\n--- users_economy Data ---');
            console.log(JSON.stringify(economyData, null, 2) || 'No data found in users_economy.');
            console.log('\n--- users_preferences Data ---');
            console.log(JSON.stringify(preferencesData, null, 2) || 'No data found in users_preferences.');
            console.log('\nConnection to MongoDB closed.');
        })
        .catch(err => {
            console.error('An error occurred during direct execution:', err);
            console.log('\nConnection to MongoDB closed (or connection failed).');
        });
}

module.exports = { fetchSourceUserData }; 