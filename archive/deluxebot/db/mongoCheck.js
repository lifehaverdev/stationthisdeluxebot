const { MongoClient } = require('mongodb');
require("dotenv").config()
// Replace the uri string with your connection string.
const uri = process.env.MONGO_PASS
// Replace 'stationthisbot' with your database name
const dbName = process.env.BOT_NAME;

async function checkMongoDBInfo(uri) {
    const client = new MongoClient(uri);
    
    try {
        await client.connect();
        console.log('\n🔌 Connected to MongoDB successfully!\n');

        // Get list of databases
        const databases = await client.db().admin().listDatabases();
        console.log('📚 Databases:', databases.databases.length);
        console.log('------------------');
        for (const db of databases.databases) {
            console.log(`Database: ${db.name}`);
            console.log(`Size: ${(db.sizeOnDisk / 1024 / 1024).toFixed(2)} MB`);
            console.log(`Empty: ${db.empty}`);
            console.log('------------------');
        }

        // For each database, get collections and sample data
        for (const db of databases.databases) {
            const database = client.db(db.name);
            const collections = await database.listCollections().toArray();
            
            if (collections.length > 0) {
                console.log(`\n📁 Collections in ${db.name}:`);
                console.log('------------------');
                
                for (const collection of collections) {
                    console.log(`Collection: ${collection.name}`);
                    // Get document count
                    const count = await database.collection(collection.name).countDocuments();
                    console.log(`Documents: ${count}`);
                }
            }
        }

        // Check Sharding Status
        console.log('\n🔄 Sharding Configuration:');
        console.log('------------------');
        try {
            const shardInfo = await client.db('admin').command({ listShards: 1 });
            console.log('Sharding is enabled');
            console.log('Number of shards:', shardInfo.shards.length);
            console.log('Shards:', shardInfo.shards.map(shard => shard._id));
        } catch (e) {
            console.log('Sharding is not enabled on this server');
        }

        // Check Replica Set Status
        console.log('\n🔄 Replication Status:');
        console.log('------------------');
        try {
            const replStatus = await client.db('admin').command({ replSetGetStatus: 1 });
            console.log('Replica Set Name:', replStatus.set);
            console.log('Current State:', replStatus.myState);
            console.log('Members:', replStatus.members.map(member => ({
                host: member.name,
                state: member.stateStr,
                health: member.health
            })));
        } catch (e) {
            console.log('Not running as part of a replica set');
        }

        // Get Write Concern Configuration
        console.log('\n✍️ Write Concern Configuration:');
        console.log('------------------');
        try {
            const getParameter = await client.db('admin').command({ 
                getParameter: 1, 
                'getLastErrorDefaults': 1 
            });
            console.log('Default Write Concern:', getParameter.getLastErrorDefaults || 'Not explicitly set');

            // Get current write concern
            const serverConfig = await client.db('admin').command({ getCmdLineOpts: 1 });
            if (serverConfig.parsed && serverConfig.parsed.replication) {
                console.log('Replication Write Concern:', serverConfig.parsed.replication.writeConcernMajorityJournalDefault);
            }
        } catch (e) {
            console.log('Unable to fetch write concern configuration');
        }

        // Add TTL Index Check
        console.log('\n⏰ Checking for TTL Indexes:');
        console.log('------------------');
        for (const db of databases.databases) {
            const database = client.db(db.name);
            const collections = await database.listCollections().toArray();
            
            for (const collection of collections) {
                const indexes = await database.collection(collection.name).indexes();
                const ttlIndexes = indexes.filter(index => index.expireAfterSeconds !== undefined);
                if (ttlIndexes.length > 0) {
                    console.log(`⚠️  TTL Indexes found in ${db.name}.${collection.name}:`);
                    console.log(JSON.stringify(ttlIndexes, null, 2));
                }
            }
        }

        // Check Delete Operations (last 24 hours)
        console.log('\n🗑️  Checking Recent Delete Operations:');
        console.log('------------------');
        try {
            const adminDb = client.db('admin');
            // Try to enable profiling
            try {
                await adminDb.command({ setParameter: 1, profileLevel: 1 });
            } catch (e) {
                console.log('Note: Could not enable profiling (requires additional permissions)');
            }

            // Check system.profile collection in each database
            for (const db of databases.databases) {
                const database = client.db(db.name);
                try {
                    const profileData = await database.collection('system.profile')
                        .find({
                            op: 'delete',
                            ts: { 
                                $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) 
                            }
                        })
                        .toArray();

                    if (profileData.length > 0) {
                        console.log(`\nFound delete operations in ${db.name}:`);
                        profileData.forEach(op => {
                            console.log(`Timestamp: ${op.ts}`);
                            console.log(`Collection: ${op.ns}`);
                            console.log(`Query: ${JSON.stringify(op.command || op.query)}`);
                            console.log('------------------');
                        });
                    }
                } catch (e) {
                    // system.profile might not exist, that's okay
                }
            }
        } catch (e) {
            console.log('Unable to check delete operations:', e.message);
        }

        // Validate Collections
        console.log('\n🔍 Collection Validation:');
        console.log('------------------');
        for (const db of databases.databases) {
            const database = client.db(db.name);
            const collections = await database.listCollections().toArray();
            
            for (const collection of collections) {
                try {
                    const validation = await database.command({
                        validate: collection.name,
                        full: true
                    });
                    if (!validation.valid) {
                        console.log(`⚠️  Issues found in ${db.name}.${collection.name}:`);
                        console.log(JSON.stringify(validation, null, 2));
                    }
                } catch (e) {
                    console.log(`Unable to validate ${db.name}.${collection.name}: ${e.message}`);
                }
            }
        }

        // Check User Collections Specifically
        console.log('\n👤 User Collections Analysis:');
        console.log('------------------');
        for (const db of databases.databases) {
            const database = client.db(db.name);
            const collections = await database.listCollections().toArray();
            
            for (const collection of collections) {
                if (collection.name === 'users') {
                    console.log(`\nChecking ${db.name}.users:`);
                    
                    // Check document structure
                    const sampleUsers = await database.collection('users')
                        .find({})
                        .limit(5)
                        .toArray();
                    
                    if (sampleUsers.length > 0) {
                        console.log('Sample Document Structure:');
                        console.log(Object.keys(sampleUsers[0]));
                        
                        // Check for potentially corrupted/incomplete documents
                        const incompleteUsers = await database.collection('users')
                            .countDocuments({ 
                                $or: [
                                    { _id: { $exists: false } },
                                    { _id: null }
                                ]
                            });
                        
                        if (incompleteUsers > 0) {
                            console.log(`⚠️  Found ${incompleteUsers} potentially corrupted documents`);
                        }

                        // Check for recent modifications
                        const recentChanges = await database.collection('users')
                            .find({
                                $or: [
                                    { updatedAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
                                    { createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
                                ]
                            })
                            .sort({ updatedAt: -1 })
                            .limit(5)
                            .toArray();

                        if (recentChanges.length > 0) {
                            console.log('\nRecent Changes:');
                            recentChanges.forEach(doc => {
                                console.log(`ID: ${doc._id}`);
                                console.log(`Last Updated: ${doc.updatedAt}`);
                                console.log('------------------');
                            });
                        }
                    }

                    // Check for any unusual patterns
                    const totalUsers = await database.collection('users').countDocuments();
                    console.log(`Total Users: ${totalUsers}`);
                    
                    // Check for null fields that should not be null
                    const nullFieldsCount = await database.collection('users')
                        .countDocuments({
                            $or: [
                                { username: null },
                                { username: '' },
                                { username: { $exists: false } }
                            ]
                        });
                    
                    if (nullFieldsCount > 0) {
                        console.log(`⚠️  Found ${nullFieldsCount} users with missing/null required fields`);
                    }
                }
            }
        }

        // Get server information
        const serverStatus = await client.db().admin().serverStatus();
        console.log('\n🖥️  Server Information:');
        console.log('------------------');
        console.log(`Version: ${serverStatus.version}`);
        console.log(`Uptime: ${(serverStatus.uptime / 3600).toFixed(2)} hours`);
        console.log(`Active Connections: ${serverStatus.connections.current}`);
        
        // Additional replication metrics if available
        if (serverStatus.repl) {
            console.log('\n📊 Replication Metrics:');
            console.log('------------------');
            console.log('Role:', serverStatus.repl.ismaster ? 'Primary' : 'Secondary');
            console.log('Set Name:', serverStatus.repl.setName);
            if (serverStatus.metrics && serverStatus.metrics.repl) {
                console.log('Replication Lag:', serverStatus.metrics.repl.network.ops);
            }
        }

    } catch (error) {
        console.error('\n❌ Error:', error);
    } finally {
        await client.close();
        console.log('\n🔌 Connection closed');
    }
}

checkMongoDBInfo(uri)
    .catch(console.error);