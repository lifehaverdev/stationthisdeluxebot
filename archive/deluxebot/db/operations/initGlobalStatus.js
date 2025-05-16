const { MongoClient } = require('mongodb');
require('dotenv').config();

async function initializeGlobalStatus() {
    const uri = process.env.MONGO_PASS;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(process.env.BOT_NAME);
        const collection = db.collection('global_status');

        // Check if document already exists
        const existing = await collection.findOne({ type: 'globalStatus' });
        
        if (!existing) {
            // Create initial document
            const initialStatus = {
                type: 'globalStatus',
                training: [],
                cooking: [],
                chargePurchases: [],
                createdAt: new Date(),
                updatedAt: new Date()
            };

            await collection.insertOne(initialStatus);
            console.log('Global status document initialized successfully');
        } else {
            console.log('Global status document already exists');
        }
    } catch (error) {
        console.error('Error initializing global status:', error);
    } finally {
        await client.close();
    }
}

// Run if this file is executed directly
if (require.main === module) {
    initializeGlobalStatus()
        .then(() => process.exit(0))
        .catch(error => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = initializeGlobalStatus;