const { MongoClient } = require('mongodb');
require('dotenv').config();
const { defaultUserData } = require('../utils/users/defaultUserData');

async function migrateUsers() {
    const client = new MongoClient(process.env.MONGO_PASS);
    
    try {
        await client.connect();
        //const db = client.db(process.env.BOT_NAME);
        const db = client.db('stationthisdeluxebot');
        // Collections setup
        const usersCollection = db.collection('users');
        const userCore = db.collection('users_core');
        const userEconomy = db.collection('users_economy');
        const userPrefs = db.collection('users_preferences');
        const userStats = db.collection('users_stats');

        const users = await usersCollection.find({}).toArray();
        console.log(`Found ${users.length} users to migrate`);

        const migrationStats = {
            total: users.length,
            successful: 0,
            errors: [],
            skipped: 0
        };

        for (const user of users) {
            try {
                // Validate critical data
                if (!user.userId || (!user.exp && !user.qoints)) {
                    console.log(`Skipping invalid user:`, user.userId || 'NO_ID');
                    migrationStats.skipped++;
                    continue;
                }

                // Core user data (identity and verification)
                const coreData = {
                    userId: user.userId,
                    wallet: user.wallet || '',
                    verified: user.verified || false,
                    createdAt: user.createdAt || new Date(),
                    lastActive: user.lastActive || new Date(),
                    kickedAt: user.kickedAt || '',
                    state: user.state || defaultUserData.state,
                    type: user.type || ''
                };

                // Economy data (all currencies and balances)
                const economyData = {
                    userId: user.userId,
                    balance: user.balance || '0',
                    exp: user.exp || 0,
                    points: user.points || 0,
                    doints: user.doints || 0,
                    qoints: user.qoints || 0,
                    boints: user.boints || 0,
                    pendingQoints: user.pendingQoints || 0,
                    assets: user.assets || []
                };

                // User preferences (generation settings and preferences)
                const prefsData = {
                    userId: user.userId,
                    advancedUser: user.advancedUser || false,
                    
                    input_batch: user.input_batch || 1,
                    input_steps: user.input_steps || 30,
                    input_cfg: user.input_cfg || 7,
                    input_strength: user.input_strength || 0.6,
                    input_height: user.input_height || 1024,
                    input_width: user.input_width || 1024,
                    basePrompt: user.basePrompt || "MS2",
                    input_negative: user.input_negative || '-1',
                    input_checkpoint: user.input_checkpoint || "zavychromaxl_v60",
                    advancedUser: user.advancedUser || false,
                    waterMark: user.waterMark || 'mslogo',
                    createSwitch: user.createSwitch || 'SDXL',
                    voiceModel: user.voiceModel || "165UvtZp7kKnmrVrVQwx",
                    favorites: user.favorites || defaultUserData.favorites,
                    commandList: user.commandList || defaultUserData.commandList
                };

                // User stats (generation history and activity)
                const statsData = {
                    userId: user.userId,
                    lastRunTime: user.lastRunTime || '',
                    lastSeed: user.lastSeed || -1,
                    lastImage: user.lastImage || '',
                    runs: user.runs || []
                };

                // Perform insertions
                await Promise.all([
                    userCore.updateOne(
                        { userId: user.userId },
                        { $set: coreData },
                        { upsert: true }
                    ),
                    userEconomy.updateOne(
                        { userId: user.userId },
                        { $set: economyData },
                        { upsert: true }
                    ),
                    userPrefs.updateOne(
                        { userId: user.userId },
                        { $set: prefsData },
                        { upsert: true }
                    ),
                    userStats.updateOne(
                        { userId: user.userId },
                        { $set: statsData },
                        { upsert: true }
                    )
                ]);

                migrationStats.successful++;
                console.log(`Successfully migrated user ${user.userId}`);

            } catch (error) {
                console.error(`Error migrating user ${user.userId}:`, error);
                migrationStats.errors.push({
                    userId: user.userId,
                    error: error.message
                });
            }
        }

        // Backup original collection
        await db.collection('users_backup').insertMany(users);

        console.log('\nMigration Complete!');
        console.log('Stats:', JSON.stringify(migrationStats, null, 2));

    } finally {
        await client.close();
    }
}

// Run migration
migrateUsers().catch(console.error);