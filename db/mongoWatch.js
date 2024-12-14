const { MongoClient } = require('mongodb');
require('dotenv').config();

async function watchCollection() {
    const uri = process.env.MONGO_PASS;
    const client = new MongoClient(uri);
    
    try {
        await client.connect();
        const db = client.db(process.env.BOT_NAME);
        const collection = db.collection('users');

        // Watch for all operations on the users collection
        const changeStream = collection.watch([], {
            fullDocument: 'updateLookup'
        });

        console.log('🔍 Monitoring users collection for changes...');

        changeStream.on('change', (change) => {
            const timestamp = new Date().toISOString();
            
            switch(change.operationType) {
                case 'delete':
                    console.log(`❌ [${timestamp}] Document DELETED:`);
                    console.log(`   Document ID: ${change.documentKey._id}`);
                    console.log(`   Operation ID: ${change.operationDescription}`);
                    break;

                case 'update':
                    console.log(`📝 [${timestamp}] Document UPDATED:`);
                    console.log(`   User ID: ${change.fullDocument?.userId}`);
                    console.log(`   Changed Fields:`, Object.keys(change.updateDescription.updatedFields));
                    break;

                case 'replace':
                    console.log(`🔄 [${timestamp}] Document REPLACED:`);
                    console.log(`   User ID: ${change.fullDocument?.userId}`);
                    break;

                case 'insert':
                    console.log(`➕ [${timestamp}] Document INSERTED:`);
                    console.log(`   User ID: ${change.fullDocument?.userId}`);
                    break;
            }
        });

        // Handle errors
        changeStream.on('error', (error) => {
            console.error('Error in change stream:', error);
        });

    } catch (error) {
        console.error('Error setting up monitor:', error);
    }
}

// Start monitoring
//watchCollection().catch(console.error);

module.exports = { watchCollection };
