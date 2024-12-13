const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const axios = require('axios');
const path = require('path')
const stream = require('stream');
require('./mongoWatch.js')
const fs = require('fs')

const { lobby, workspace } = require('../utils/bot/bot')
const { getBalance } = require('../utils/users/checkBalance.js')

const defaultUserData = require("../utils/users/defaultUserData.js");
const statsEmitter = require('./events.js');

const { updateLoraStatus } = require('./training.js')
require("dotenv").config()
// Replace the uri string with your connection string.
const uri = process.env.MONGO_PASS
// Replace 'stationthisbot' with your database name
const dbName = process.env.BOT_NAME;
// const DEV_DMS = 5472638766;
let cachedClient = null;
let inactivityTimer = null;
const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const JOB_TIMEOUT = 15000; // Increase from default (likely 5000ms) to 30 seconds

// Logging toggles
const LOG_DB_QUEUE = true;
const LOG_CLIENT = true;
const LOG_CONNECTION = true;

function logThis(active, message) {
    if (active) console.log(message);
}

class DatabaseQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
    }

    // Add a job to the queue and return a promise that resolves with the result 
    enqueue(job) {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                // Wrap the job with timeout handling to prevent hanging indefinitely
                try {
                    const result = await Promise.race([
                        job(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Job timeout')), JOB_TIMEOUT))
                    ]);
                    resolve(result); // Resolve the promise with the job's result
                } catch (error) {
                    reject(error); // Reject if the job fails
                }
            });

            // Attempt to process the next job after enqueueing
            this.processNext();
        });
    }

    // Process the next job in the queue
    async processNext() {
        if (this.processing) {
            return; // A job is already being processed
        }

        if (this.queue.length === 0) {
            return; // No jobs left in the queue
        }

        // Mark the queue as processing
        this.processing = true;

        // Get the next job
        const job = this.queue.shift();
        try {
            logThis(LOG_DB_QUEUE, '[DatabaseQueue] Processing job...');
            await job(); // Execute the job
        } catch (error) {
            console.error('[DatabaseQueue] Error processing job:', error);
        } finally {
            // Mark the processing as done and process the next job
            this.processing = false;
            this.processNext();
        }
    }
}

const dbQueue = new DatabaseQueue();

let connectionInProgress = null;

async function getCachedClient() {
    logThis(LOG_CLIENT, '[getCachedClient] Called');

    // If there's an existing connection attempt in progress, wait for it
    if (connectionInProgress) {
        logThis(LOG_CONNECTION, '[getCachedClient] Connection in progress. Awaiting current connection...');
        await connectionInProgress;
        logThis(LOG_CONNECTION, '[getCachedClient] Existing connection completed. Returning cached client.');
        return cachedClient;
    }

    if (!cachedClient) {
        logThis(LOG_CONNECTION, '[getCachedClient] No cached client found. Initiating new connection...');

        // Begin a new connection attempt
        connectionInProgress = (async () => {
            cachedClient = new MongoClient(uri);
            logThis(LOG_CLIENT, '[getCachedClient] New MongoClient instance created.');

            try {
                await cachedClient.connect();
                logThis(LOG_CONNECTION, '[getCachedClient] MongoClient connected successfully.');
            } catch (error) {
                console.error('[getCachedClient] Error connecting MongoClient:', error);
                cachedClient = null; // Reset cachedClient if connection fails
                throw error; // Re-throw to ensure the caller knows it failed
            } finally {
                logThis(LOG_CONNECTION, '[getCachedClient] Connection attempt finished. Clearing connectionInProgress flag.');
                connectionInProgress = null; // Reset in-progress flag
            }
        })();

        try {
            await connectionInProgress;  // Wait for connection to complete
            logThis(LOG_CONNECTION, '[getCachedClient] New connection completed successfully.');
        } catch (error) {
            console.error('[getCachedClient] Failed to complete new connection:', error);
            throw error;
        }

    } else if (!cachedClient.topology || !cachedClient.topology.isConnected()) {
        logThis(LOG_CONNECTION, '[getCachedClient] Cached client found, but not connected. Attempting reconnection...');

        connectionInProgress = (async () => {
            try {
                await cachedClient.connect();
                logThis(LOG_CONNECTION, '[getCachedClient] Reconnected MongoClient successfully.');
            } catch (error) {
                console.error('[getCachedClient] Error reconnecting MongoClient:', error);
                cachedClient = null; // Reset cachedClient if reconnection fails
                throw error;
            } finally {
                logThis(LOG_CONNECTION, '[getCachedClient] Reconnection attempt finished. Clearing connectionInProgress flag.');
                connectionInProgress = null; // Reset in-progress flag
            }
        })();

        try {
            await connectionInProgress;  // Wait for reconnection to complete
            logThis(LOG_CONNECTION, '[getCachedClient] Reconnection completed successfully.');
        } catch (error) {
            console.error('[getCachedClient] Failed to complete reconnection:', error);
            throw error;
        }
    }

    logThis(LOG_CLIENT, '[getCachedClient] Returning cached client.');
    resetInactivityTimer();
    return cachedClient;
}



async function readUserData(walletAddress) {
    // Create a new MongoClient
    const job = async () => {
        const client = await getCachedClient();
        const collection = client.db(dbName).collection('users');
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
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[readuserdata] Failed to get user data:', error);
        throw error;
    }
}
// Function to get user data by userId
async function getUserDataByUserId(userId) {
    console.log('[getUserDataByUserId] Called for userId:', userId);

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(async () => {
            try {
                console.log('[getUserDataByUserId] Fetching cached client...');
                const client = await getCachedClient();
                console.log('[getUserDataByUserId] Got client, fetching db...');
                const db = client.db(dbName);
                console.log('[getUserDataByUserId] Got db, fetching collection...');
                const userSettingsCollection = db.collection('users');
                console.log('[getUserDataByUserId] Got collection, fetching user data...');

                // Query for user settings by userId
                const userData = await userSettingsCollection.findOne({ userId: userId }, { projection: { _id: 0 } });

                if (userData) {
                    console.log('[getUserDataByUserId] User settings found:', userData.userId);
                    return userData;
                } else {
                    console.log('[getUserDataByUserId] User settings not found for userId:', userId);
                    return null; // Return null if user data isn't found
                }
            } catch (error) {
                console.error('[getUserDataByUserId] Error getting user settings:', error);
                throw error; // Throw error so the caller knows the request failed
            }
        });

        return userData;
    } catch (error) {
        console.error('[getUserDataByUserId] Failed to get user data:', error);
        throw error;
    }
}

async function getUsersByWallet(walletAddress) {
    // Assuming you have a MongoDB database
    const job = async () => {
        
        try {
            const client = await getCachedClient();
            const db = client.db(dbName);
            const users = await db.collection('users').find({ wallet: walletAddress }).toArray();
            return users;
        } catch (error) {
            console.error('Error retrieving users by wallet:', error);
            return [];
        }
    }

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[getUsersByWallet] Failed to get user data:', error);
        throw error;
    }
}

// Function to create new user data with default settings
async function createDefaultUserData(userId) {
        try {
            // Create default user settings
            const userSettings = { ...defaultUserData, userId: userId, 'newb': true };
            //await userSettingsCollection.insertOne(userSettings);
            console.log('New user settings created:', userSettings.userId);
            return userSettings;
        } catch (error) {
            console.error('Error creating user settings:', error);
            throw error; // Throw error so the caller knows the request failed
        }

}



async function loadLora(hashId) {
    const job = async () => {
        const collectionName = 'trains';
        try {
            const client = await getCachedClient();
            const collection = client.db(dbName).collection(collectionName);
            // Find the document with the provided hashId, excluding the _id field
            const loraData = await collection.findOne({ loraId: hashId }, { projection: { _id: 0 } });
            if (loraData) {
                console.log('LoRA data loaded successfully');
                return loraData;
            } else {
                console.log('LoRA data not found');
                return null;
            }
        } catch (error) {
            console.error("Error loading LoRA data:", error);
            return null;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[loadlora] Failed to get user data:', error);
        throw error;
    }
}
async function loadCollection(hashId) {
    const job = async () => {
        const collectionName = 'gallery';
        try {
            console.log('Attempting to load collection with hashId:', hashId);
            const client = await getCachedClient();
            const collection = client.db(dbName).collection(collectionName);

            // Convert hashId to number to match the stored type in MongoDB
            const parsedHashId = Number(hashId);
            if (isNaN(parsedHashId)) {
                console.error(`Invalid hashId passed for loading collection: ${hashId}`);
                return null;
            }

            // Find the document with the provided hashId
            const collectionData = await collection.findOne(
                { collectionId: parsedHashId }, 
                { projection: { _id: 0 } }
            );

            if (collectionData) {
                console.log('Collection data loaded successfully');
                return collectionData;
            } else {
                console.log('Collection data not found');
                return null;
            }
        } catch (error) {
            console.error("Error loading collection data:", error);
            return null;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[loadCollection] Failed to get user data:', error);
        throw error;
    }
}

async function getCollectionsByUserId(userId) {
    const job = async () => {
        const collectionName = 'gallery';
        try {
            console.log('Attempting to load collections for userId:', userId);
            const client = await getCachedClient();
            const collection = client.db(dbName).collection(collectionName);

            // Find all documents matching the userId
            const collections = await collection.find(
                { userId: userId },
                { projection: { _id: 0 } }
            ).toArray();

            if (collections && collections.length > 0) {
                console.log(`Found ${collections.length} collections for user`);
                return collections;
            } else {
                console.log('No collections found for user');
                return [];
            }
        } catch (error) {
            console.error("Error loading user collections:", error);
            return [];
        }
    };

    // Enqueue the job and await its result
    try {
        const collections = await dbQueue.enqueue(job);
        return collections;
    } catch (error) {
        console.error('[getCollectionsByUserId] Failed to get collections:', error);
        throw error;
    }
}



// Function to pull a file from GridFS and save it to the /tmp folder
async function bucketPull(userId, loraId, slotId) {
    const job = async () => {
        const client = await getCachedClient();
        try {
            const db = client.db(dbName);
            const bucket = new GridFSBucket(db, { bucketName: 'loraImages' });

            // Define the local file path in the /tmp directory
            const tempFilePath = path.join('/tmp', `slot_image_${loraId}_${slotId}.jpg`);
            console.log(workspace)
            const fileId = workspace[userId][loraId].images[slotId];

            if (!fileId) {
                console.error('No file found in this slot');
                return false;
            }

            const downloadStream = bucket.openDownloadStream(fileId);
            const writeStream = fs.createWriteStream(tempFilePath);

            // Pipe the download stream to the write stream
            downloadStream.pipe(writeStream);

            // Wait for the file to be fully written
            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });

            console.log(`Image for lora ${loraId}, slot ${slotId} saved to /tmp.`);
            return tempFilePath;
        } catch (error) {
            console.error('Error pulling image from GridFS:', error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[bucketpull] Failed to get user data:', error);
        throw error;
    }
}

// Function to reset the inactivity timer
function resetInactivityTimer() {
        if (inactivityTimer) {
            clearTimeout(inactivityTimer);
        }
        inactivityTimer = setTimeout(async () => {
            if (cachedClient) {
                await cachedClient.close();
                console.log('Cached MongoClient closed due to inactivity');
                cachedClient = null;
            }
        }, INACTIVITY_TIMEOUT);
}

// Save image to MongoDB using GridFS
async function saveImageToGridFS(fileUrl, loraId, slotId) {
    const job = async () => {
        console.log('calling save image to grid')
        const client = await getCachedClient();
        try {
            const db = client.db(dbName);
            const bucket = new GridFSBucket(db, { bucketName: 'loraImages' });

            // Get the image file from the URL
            const response = await axios({
                method: 'GET',
                url: fileUrl,
                responseType: 'stream',
            });

            // Create a stream to upload the file to GridFS
            const uploadStream = bucket.openUploadStream(`lora_${loraId}_slot_${slotId}.jpg`);

            // Pipe the image stream into the GridFS upload stream
            response.data.pipe(uploadStream);

            // Return a promise that resolves when the upload completes
            return new Promise((resolve, reject) => {
                uploadStream.on('finish', () => {
                    console.log(`Image for lora ${loraId}, slot ${slotId} saved to GridFS.`);
                    resolve(uploadStream.id);
                });

                uploadStream.on('error', (error) => {
                    console.error('Error saving image to GridFS:', error);
                    reject(error);
                });
            });
        } catch (error) {
            console.error("Error saving image to GridFS:", error);
            throw error;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[saveimagetogrid] Failed to get user data:', error);
        throw error;
    }
}

//defanged doesnt touch points
async function writeUserData(userId, data) {
    const job = async () => {
        const client = await getCachedClient();
        try {
            const collection = client.db(dbName).collection('users');
            const filter = { userId: userId };

            // Separate protected fields from general user data
            const { points, doints, qoints, boints, balance, exp, newb, _id, ...dataToSave } = data;

            // Log the data being written, omitting sensitive fields
            //console.log('General user data to be saved:');

            // Perform an update to save non-protected user data
            const result = await collection.updateOne(
                filter,
                { $set: { ...dataToSave } },
                { upsert: false } // Ensure we do not create new records here
            );

            if (result.modifiedCount === 0) {
                console.log(`No changes made to user ${userId} data.`);
            } else {
                console.log(`User data updated successfully for user ${userId}.`);
            }

            return true;
        } catch (error) {
            console.error("Error writing user data:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[writeuserdata] Failed to get user data:', error);
        throw error;
    }
}
//fanged
async function writeNewUserData(userId, data) {
    const job = async () => {
        const client = await getCachedClient();
        try {
            const collection = client.db(dbName).collection('users');
            const filter = { userId: userId };

            // Log the incoming data and filter
            console.log('[writeNewUserData] Input userId:', userId);
            console.log('[writeNewUserData] Input data:', JSON.stringify(data, null, 2));
            console.log('[writeNewUserData] Filter:', JSON.stringify(filter, null, 2));

            // Check if the user already exists
            const existingDoc = await collection.findOne(filter);
            if (existingDoc) {
                console.log('[writeNewUserData] Existing document found:', JSON.stringify(existingDoc, null, 2));
            } else {
                console.log('[writeNewUserData] No existing document found for userId:', userId);
            }

            // Log fields being written, excluding protected fields
            const { newb, _id, ...dataToSave } = data;
            //console.log('[writeNewUserData] Data to save (excluding protected fields):', JSON.stringify(dataToSave, null, 2));

            // Perform the update with upsert enabled
            console.log('[writeNewUserData] Attempting updateOne with upsert: true...');
            const result = await collection.updateOne(
                filter,
                {
                    $setOnInsert: { createdAt: new Date() }, // Insert default fields if new (exclude userId)
                    $set: dataToSave // Update other fields
                },
                { upsert: true }
            );

            // Log the result of the update operation
            console.log('[writeNewUserData] Update result:', JSON.stringify(result, null, 2));
            console.log('[writeNewUserData] Matched count:', result.matchedCount);
            console.log('[writeNewUserData] Modified count:', result.modifiedCount);
            console.log('[writeNewUserData] Upserted ID (if new document):', result.upsertedId);

            //post write diagnostics
            if (result.matchedCount === 0 && result.upsertedId) {
                console.log(`[writeNewUserData] New document created with ID: ${result.upsertedId.toString()}`);
            } else if (result.modifiedCount === 0) {
                console.warn(`[writeNewUserData] No changes made to user ${userId} data. Data may already match.`);
            } else {
                console.log(`[writeNewUserData] Document successfully updated for user ${userId}.`);
            }

            return true; // Indicate success
        } catch (error) {
            console.error('[writeNewUserData] Error during write operation:', error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData; // Return the result to the caller
    } catch (error) {
        console.error('[writeNewUserData] Failed to complete operation:', error);
        throw error;
    }
}

async function writeUserDataPoint(userId, key, value) {
    const job = async () => {
        const client = await getCachedClient();
        try {
            const collection = client.db(dbName).collection('users');
            const filter = { userId: userId };

            // Build the update object dynamically
            const update = { $set: { [key]: value } };

            // Log the key and value being updated
            console.log(`[writeUserDataPoint] Updating user ${userId}:`, update);

            // Perform the update operation
            const result = await collection.updateOne(filter, update, { upsert: false });

            if (result.modifiedCount === 0) {
                console.log(`[writeUserDataPoint] No changes made to user ${userId} data.`);
            } else {
                console.log(`[writeUserDataPoint] Successfully updated key '${key}' for user ${userId}.`);
            }

            return true;
        } catch (error) {
            console.error(`[writeUserDataPoint] Error updating key '${key}' for user ${userId}:`, error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const updateSuccess = await dbQueue.enqueue(job);
        return updateSuccess; // Return the result to the caller
    } catch (error) {
        console.error('[writeUserDataPoint] Failed to enqueue job:', error);
        throw error;
    }
}


async function writeQoints(targetCollection, targetFilter, qoints) {
    const job = async () => {
        const client = await getCachedClient();
        try {
            const collection = client.db(dbName).collection(targetCollection);
            const filter = targetFilter//{ userId: userId };

            // Perform an update to save non-protected user data
            const result = await collection.updateOne(
                filter,
                { $set: { qoints } },
                { upsert: false } // Ensure we do not create new records here
            );

            if (result.modifiedCount === 0) {
                console.log(`No changes made to ${JSON.stringify(targetCollection)} ${JSON.stringify(filter)} qoints.`);
            } else {
                console.log(`User data updated successfully for ${JSON.stringify(targetCollection)} ${JSON.stringify(filter)}  qoints.`);
            }

            return true;
        } catch (error) {
            console.error("Error writing user qoints:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[writeqoints] Failed to get user data:', error);
        throw error;
    }
}

async function getGroupDataByChatId(chatId) {
    const job = async () => {
        //deleteUserSettingsByUserId(dbName,userId);
        // Connection URI

        // Create a new MongoClient
        let groupData
        const client = await getCachedClient();
        //console.log('this is what we think default is',defaultUserData)
        try {
            // Connect to the MongoDB server
            //await client.connect();

            // Access the database and the "users" collection
            const db = client.db(dbName);
            const groupSettingsCollection = db.collection('rooms');

            // Query for the user settings by userId
            groupData = await groupSettingsCollection.findOne({ id: chatId });
            //console.log('groupData in get groupDatabyuserid',userData);
            if (groupData != null){
                console.log('Group settings found:', groupData.userId);
                return groupData;
            } else {
                console.log('empty group settings');
                groupSettings = { ...defaultGroupData, id: chatId };
                console.log('groupSettings we are writing',groupSettings.userId);
                await groupSettingsCollection.insertOne(groupSettings);
                console.log('New group settings created:', groupSettings.userId);
                return groupSettings
            }
        } catch (error) {
            console.error('Error getting user settings:', error);
            //throw error;
            return false;
        } 
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[getGroupDataByChatId] Failed to get user data:', error);
        throw error;
    }
}

async function rareCandy(whom, exp) {
    // Define the collection name and the filter for the user
    const collectionName = 'users';
    const filter = { userId: whom };

    // Define the data to write (updating the user's exp)
    const data = { exp: exp };

    // Use the writeData function to perform the update
    const success = await writeData(collectionName, filter, data);

    if (success) {
        console.log(`Successfully updated exp for user ${whom} to ${exp}`);
    } else {
        console.error(`Failed to update exp for user ${whom}`);
    }
}

async function writeData(collectionName, filter, data) {
    const job = async () => {
        // Create a new MongoClient
        const client = await getCachedClient();
        
        try {
            const collection = client.db(dbName).collection(collectionName);
            // Upsert the document with wallet address as the filter
            //const filter = { userId: userId };
            const { ...dataToSave } = data;
            await collection.updateOne( filter,
                { $set: { ...dataToSave } },
            );
            console.log(`${collectionName} ${filter} data written successfully`);
            return true
        } catch (error) {
            console.error("Error writing user data:", error);
            return false
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[writeData] Failed to get user data:', error);
        throw error;
    }
}




async function createTraining(loraData) {
    const job = async () => {
        const collectionName = 'trains';
        try {
            const client = await getCachedClient();
            const collection = client.db(dbName).collection(collectionName);
            // Insert the new LoRA document
            await collection.insertOne(loraData);
            console.log('LoRA data added successfully');
            return true;
        } catch (error) {
            console.error("Error adding new LoRA data:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[createTraining] Failed to get user data:', error);
        throw error;
    }
}

async function createCollection(collectionData) {
    const job = async () => {
        const collectionName = 'gallery';
        try {
            const client = await getCachedClient();
            const collection = client.db(dbName).collection(collectionName);
            // Insert the new LoRA document
            await collection.insertOne(collectionData);
            console.log('Collection data added successfully');
            return true;
        } catch (error) {
            console.error("Error adding new Collection data:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[createCollection] Failed to get user data:', error);
        throw error;
    }
}

async function saveWorkspace(loraObject) {
    const job = async () => {
        const collectionName = 'trains';
        try {
        const client = await getCachedClient();
        const collection = client.db(dbName).collection(collectionName);
    
        // Extract the loraId from the loraObject
        const { loraId, ...dataToSave } = loraObject;
    
        // Update the corresponding document in the database
        await collection.updateOne(
            { loraId: loraId }, // Filter to find the specific document by loraId
            { $set: { ...dataToSave } } // Update all key-value pairs in loraObject
        );
    
        console.log('LoRA data saved successfully');
        return true;
        } catch (error) {
        console.error("Error saving LoRA data:", error);
        return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[saveWorkspace] Failed to get user data:', error);
        throw error;
    }
  }

async function saveStudio(collectionObject) {
    const job = async () => {
        const collectionName = 'gallery';
        try {
            const client = await getCachedClient();
            const collection = client.db(dbName).collection(collectionName);
            
            // Extract the collectionId and log the data being saved
            const { collectionId, ...dataToSave } = collectionObject;
            console.log('[saveStudio] Saving collection:', collectionId);
            console.log('[saveStudio] Data to save:', dataToSave);

            // Ensure collectionId is the correct type (if it's stored as a number)
            const parsedCollectionId = Number(collectionId);
            
            // Update the corresponding document and get the result
            const result = await collection.updateOne(
                { collectionId: parsedCollectionId },
                { $set: dataToSave }
            );
    
            console.log('[saveStudio] Update result:', {
                matchedCount: result.matchedCount,
                modifiedCount: result.modifiedCount
            });

            // Check if the update actually modified a document
            if (result.matchedCount === 0) {
                console.error('[saveStudio] No matching document found for collectionId:', parsedCollectionId);
                return false;
            }
            if (result.modifiedCount === 0) {
                console.warn('[saveStudio] Document found but no changes were made');
            }
    
            return true;
        } catch (error) {
            console.error("[saveStudio] Error saving collection data:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const success = await dbQueue.enqueue(job);
        return success;
    } catch (error) {
        console.error('[saveStudio] Failed to process job:', error);
        throw error;
    }
}

  async function deleteWorkspace(loraId) {
    const job = async () => {
        const collectionName = 'trains';
        try {
            const client = await getCachedClient();
            const db = client.db(dbName);
            const collection = db.collection(collectionName);
            const bucket = new GridFSBucket(db, { bucketName: 'loraImages' });

            // Find the LoRa document by loraId
            const loraData = await collection.findOne({ loraId });
            if (!loraData) {
                console.log(`LoRA data with ID ${loraId} not found. Nothing to delete.`);
                return false;
            }

            // Delete each image from GridFS
            if (Array.isArray(loraData.images)) {
                for (const fileId of loraData.images) {
                    if (fileId) {
                        try {
                            await bucket.delete(new ObjectId(fileId));
                            console.log(`Image with ID ${fileId} deleted successfully from GridFS.`);
                        } catch (error) {
                            console.error(`Error deleting image with ID ${fileId}:`, error);
                        }
                    }
                }
            }

            // Delete the LoRa document
            const deleteResult = await collection.deleteOne({ loraId });
            if (deleteResult.deletedCount > 0) {
                console.log(`LoRA data with ID ${loraId} deleted successfully.`);
            } else {
                console.warn(`LoRA data with ID ${loraId} was not found for deletion.`);
            }

            return true;
        } catch (error) {
            console.error("Error deleting LoRA data:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const success = await dbQueue.enqueue(job);
        return success;
    } catch (error) {
        console.error('[deleteWorkspace] Failed to enqueue job:', error);
        throw error;
    }
}


async function deleteStudio(collectionId) {
    const job = async () => {
        const collectionName = 'gallery';
        try {
            const client = await getCachedClient();
            const db = client.db(dbName);
            const collection = db.collection(collectionName);

            // Find the LoRa document by collectionId
            const collectionData = await collection.findOne({ collectionId });
            if (!collectionData) {
                console.log(`collection data with ID ${collectionId} not found. Nothing to delete.`);
                return false;
            }

            // Delete the LoRa document
            const deleteResult = await collection.deleteOne({ collectionId });
            if (deleteResult.deletedCount > 0) {
                console.log(`LoRA data with ID ${collectionId} deleted successfully.`);
            } else {
                console.warn(`LoRA data with ID ${collectionId} was not found for deletion.`);
            }

            return true;
        } catch (error) {
            console.error("Error deleting LoRA data:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const success = await dbQueue.enqueue(job);
        return success;
    } catch (error) {
        console.error('[deleteWorkspace] Failed to enqueue job:', error);
        throw error;
    }
}


async function deleteImageFromWorkspace(loraId, slotId) {
    const job = async () => {
        const collectionName = 'trains';
        try {
            const client = await getCachedClient();
            const db = client.db(dbName);
            const collection = db.collection(collectionName);
            const bucket = new GridFSBucket(db, { bucketName: 'loraImages' });

            // Find the LoRA document by loraId
            const loraData = await collection.findOne({ loraId: loraId });
            if (!loraData || !loraData.images || !loraData.images[slotId]) {
                console.log('Image not found in the specified slot.');
                return false;
            }

            const fileId = loraData.images[slotId];

            // Delete the image from GridFS
            await bucket.delete(new ObjectId(fileId));
            console.log(`Image with ID ${fileId} deleted successfully from GridFS.`);

            // Update the LoRA document to remove the image reference
            loraData.images[slotId] = ''; // Or set to null, depending on your preference
            await collection.updateOne({ loraId: loraId }, { $set: { images: loraData.images } });

            console.log(`Image reference removed from slot ${slotId} in LoRA document.`);
            return true;
        } catch (error) {
            console.error("Error deleting image from LoRA data:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[deleteImagefromworkspace] Failed to get user data:', error);
        throw error;
    }
}


async function addGenDocument(collectionName, data) {
    const job = async () => {
        try {
            // Create a new MongoClient
            const client = await getCachedClient();
            const collection = client.db(dbName).collection(collectionName);
            // Insert the new document
            const result = await collection.insertOne(data);
            //console.log('New document inserted successfully:', result.insertedId);
            return true;
        } catch (error) {
            console.error("Error inserting document:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[addgendocument] Failed to get user data:', error);
        throw error;
    }
}

async function saveGen({task, run, out}) {

    // Combine the data into one object
    const dataToSave = {...task, ...run, ...out};
    
    // Call addGenDocument to save the new document to the 'gens' collection
    await addGenDocument('gens', dataToSave);
}

async function updateGroupPoints(group, pointsToAdd) {
    const job = async () => {
        const client = await getCachedClient();
        const newQoints = group.qoints + pointsToAdd;
        const chatId = group.chat.id;
        try {
            const collection = client.db(dbName).collection('floorplan');
            // Only update the qoints field
            const result = await collection.updateOne(
                { id: chatId },
                { $set: { qoints: newQoints } }
            );
            
            if (result.matchedCount === 0) {
                console.log(`No group found with chatId: ${chatId}`);
                return false;
            }
            
            console.log(`Group ${chatId} qoints updated to ${newQoints}`);
            return true;
        } catch (error) {
            console.error("Error updating group qoints:", error);
            return false;
        }
    };

    try {
        return await dbQueue.enqueue(job);
    } catch (error) {
        console.error('[updateGroupQoints] Failed to update qoints:', error);
        throw error;
    }
}

async function readStats() {
    const job = async () => {
        const client = await getCachedClient();

        try {
            const collection = client.db(dbName).collection('users');
            
            // Fetch all user settings from the database
            const users = await collection.find().toArray();
            console.log(`Fetched ${users.length} users from database`);

            return users;  // Return the users array to be processed later
        } catch (error) {
            console.error("Error fetching user settings from the database:", error);
            throw error;  // Ensure error is thrown so job properly fails
        }
    };

    let users = [];
    try {
        // Enqueue the job and await its result
        users = await dbQueue.enqueue(job);
    } catch (error) {
        console.error('[readStats] Failed to get user data from the queue:', error);
        statsEmitter.emit('stats-error', 'Failed to get user data from the queue.');
        return;
    }

    // Now process the fetched users array
    const walletSet = new Set();
    const doubleUseSet = new Set();
    const nonUserSet = new Set();
    const keySet = new Set();
    let totalExp = 0;
    let totalHeld = 0;
    let totalBurned = 0;
    let totalDex = 0;

    let count = 0;
    const totalUsers = users.length;
    const progressInterval = Math.ceil(totalUsers / 10); // Set interval for 10% progress updates

    for (let user of users) {
        count++;

        // Send progress updates at defined intervals
        if (count % progressInterval === 0 || count === totalUsers) {
            const progressPercentage = Math.round((count / totalUsers) * 100);
            statsEmitter.emit('stats-progress', `Progress stats: ${progressPercentage}% (${count}/${totalUsers} users processed)`);
        }

        // Track all keys in user object
        Object.keys(user).forEach(key => {
            if (!keySet.has(key)) {
                keySet.add(key);
            }
        });

        // Add user wallet to wallet set
        if (user.wallet) {
            if (walletSet.has(user.wallet)) {
                doubleUseSet.add(user.wallet);
            } else {
                walletSet.add(user.wallet);
                try {
                    user.balance = await getBalance(user.wallet);
                    totalHeld += user.balance; // Add user balance to totalHeld
                } catch (error) {
                    console.error(`Error getting balance for wallet ${user.wallet}:`, error);
                }
                await new Promise(resolve => setTimeout(resolve, 1000)); // Adding delay
            }
        }

        // Add user exp to totalExp
        if (user.exp) {
            totalExp += user.exp;
        }

        // Add the number of promptDex prompts to totalDex
        if (user.promptDex && Array.isArray(user.promptDex)) {
            totalDex += user.promptDex.length;
        }

        // If exp == 0, add userId to nonUserSet
        if (user.exp === 0) {
            nonUserSet.add(user._id);
        }
    }

    // Summarize the stats
    let msg = '';
    msg += 'total Users: ' + count + '\n';
    msg += 'tourists (exp=0): ' + nonUserSet.size + '\n';
    msg += 'net users: ' + (count - nonUserSet.size) + '\n';
    msg += 'net wallets: ' + walletSet.size + '\n\n';
    msg += 'total Exp: ' + totalExp + '\n';
    msg += 'total Balance Held: ' + totalHeld + ' MS2\n';

    statsEmitter.emit('stats-completed', msg);
}


async function incrementLoraUseCounter(names) {
    const job = async () => {
        const client = await getCachedClient();

        try {
            const collection = client.db(dbName).collection('loralist');
                    // Find the single document in the collection
                    const loraListDoc = await collection.findOne({});
            
                    if (!loraListDoc) {
                        console.error('No loraList document found');
                        return false;
                    }
            
                    // Iterate over the 'names' array and find the corresponding object to update
                    const updatedLoraTriggers = loraListDoc.loraTriggers.map(lora => {
                        if (names.includes(lora.lora_name)) {
                            // Increment or set the 'uses' key
                            lora.uses = (lora.uses || 0) + 1;
                        }
                        return lora;
                    });
            
                    // Update the document in the collection with the modified array
                    await collection.updateOne({}, { $set: { loraTriggers: updatedLoraTriggers } });
            
            console.log('Lora Use Counter updated successfully',names);
            return true;
        } catch (error) {
            console.error("Error updating group points:", error);
            return false;
        } 
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[incrementloracounter] Failed to get user data:', error);
        throw error;
    }
}

//write room settings
//saves settings

//modbalanceroom
//changes rooms applied balance
//adds a negative balance to the burns db

//

async function createRoom(chatId, groupData) {
    const job = async () => {
        console.log(groupData)
        // Create a new MongoClient
        const client = await getCachedClient();
        
        try {
            const collection = client.db(dbName).collection('floorplan');
            
            const room = groupData;
            
            try {
                await collection.updateOne( 
                    { id: chatId},
                    { $set: { ...room } },
                    { upsert: true }
                );
            } catch(err) {
                console.log('error writing room')
            }
            
            console.log('Room written successfully');
            return true;
        } catch (error) {
            console.error("Error writing room data:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[createRoom] Failed to get user data:', error);
        throw error;
    }
}

async function writeBurnData(userId, amount) {
    const job = async () => {
        //this is for subtracting from burns when applying balance to group chats
        //const { wallet, amount, service, projectName, twitterHandle, telegramHandle, hash } = {...lobby[userId]}
        const wallet = lobby[userId].wallet;
        const service = 'Group apply';
        const projectName = lobby[userId].group;
        const telegramHandle = userId;
        const hash = 'botTx(;'
        if (!wallet || !amount || !service || !hash) {
        //res.status(400).json({ message: 'Missing required fields' });
        return;
        }
        //console.log(value)
        // Create a new MongoClient
        const client = await getCachedClient();
        amount = -amount * 1000000;
        try {
            const collection = client.db(dbName).collection('burns');

        // Find the wallet document
        let walletDoc = await collection.findOne({ wallet });

        if (walletDoc) {
            // If the document exists, push the new burn data to the wallet array
            await collection.updateOne(
            { wallet },
            {
                $push: {
                burns: {
                    amount,
                    service,
                    projectName,
                    //twitterHandle,
                    telegramHandle,
                    hash,
                },
                },
            }
            );
        } else {
            // If the document does not exist, create a new document
            await collection.insertOne({
            wallet,
            burns: [
                {
                amount,
                service,
                projectName,
                //twitterHandle,
                telegramHandle,
                hash,
                },
            ],
            });
        }

        
        console.log('anti burn successful')
        } catch (error) {
        console.error('Error saving burn data:', error);
        
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[writeBurnData] Failed to get user data:', error);
        throw error;
    }
}


async function addPointsToAllUsers() {
    const job = async () => {
        const client = await getCachedClient();
        const collection = client.db(dbName).collection('users');
        const bulkOperations = [];
        const results = {
            updated: 0,
            skipped: 0,
            errors: []
        };

        for (const userId in lobby) {
            if (lobby.hasOwnProperty(userId)) {
                const user = lobby[userId];
                if (!user || typeof user.points !== 'number' || typeof user.boints !== 'number') {
                    console.log(`Skipping invalid user data for userId: ${userId}`);
                    results.skipped++;
                    continue;
                }

                const pointsToAdd = user.points + user.boints;
                if (pointsToAdd > 0) {
                    bulkOperations.push({
                        updateOne: {
                            filter: { userId }, // Ensure userId matches the database type
                            update: { $inc: { exp: pointsToAdd } },
                            upsert: true
                        }
                    });
                } else {
                    console.log(`No points to add for userId: ${userId}`);
                    results.skipped++;
                }
            }
        }

        // Execute bulk operations
        if (bulkOperations.length > 0) {
            try {
                const bulkResult = await collection.bulkWrite(bulkOperations);
                results.updated = bulkResult.modifiedCount;
                console.log(`${results.updated} users updated successfully.`);
            } catch (error) {
                console.error('Bulk update failed:', error);
                results.errors.push(error);
            }
        } else {
            console.log('No updates to perform.');
        }

        return results;
    };

    // Enqueue the job and await its result
    try {
        const result = await dbQueue.enqueue(job);
        return result;
    } catch (error) {
        console.error('[addPointsToAllUsers] Failed to process job:', error);
        throw error;
    }
}

async function updateAllUsersWithCheckpoint() {
    const job = async () => {
        const client = await getCachedClient();

        try {
            const collection = client.db(dbName).collection('users');

            // Fetch all user settings
            const users = await collection.find().toArray();
            console.log(defaultUserData.points)
            for (let user of users) {
                // Update user's checkpoint to match defaultUserData
                const filter = { userId: user.userId };
                
                const updateDoc = {
                    $set: { points: defaultUserData.points }
                };

                // Update the document in the collection
                const result = await collection.updateOne(filter, updateDoc);

                if (result.modifiedCount === 1) {
                    console.log(`Checkpoint updated successfully for userId: ${user.userId}`);
                } else {
                    console.log(`No update needed for userId: ${user.userId}`);
                }
            }

            console.log('All users updated with checkpoint successfully');
            return true;
        } catch (error) {
            console.error("Error updating users with checkpoint:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[updatealluserswithcheckpoint] Failed to get user data:', error);
        throw error;
    }
}
async function updateAllUserSettings() {
    const job = async () => {
        const client = await getCachedClient();

        try {
            const collection = client.db(dbName).collection('users');

            // Fetch all user settings
            console.log('Fetching all users from the database...');
            const users = await collection.find().toArray();

            if (users.length === 0) {
                console.log('No users found to update');
                return true;
            }

            console.log(`Total users fetched: ${users.length}`);

            // Prepare the three separate bulk operations
            const deleteOperations = [];
            const removeKeyOperations = [];
            const addDefaultsOperations = [];

            // Iterate over each user to determine which operations to perform
            for (let user of users) {
                const { _id, exp, verified, wallet, ...userSettings } = user; // Remove _id immediately

                // 1. Users to be deleted
                if (exp === 0 && verified === false && wallet === '') {
                    deleteOperations.push({
                        deleteOne: {
                            filter: { userId: user.userId }
                        }
                    });
                    continue; // Skip further processing for this user since they will be deleted
                }

                // 2. Remove keys not present in defaultUserData
                const unsetFields = {};
                for (const key in userSettings) {
                    if (!defaultUserData.hasOwnProperty(key)) {
                        unsetFields[key] = "";
                    }
                }
                if (Object.keys(unsetFields).length > 0) {
                    removeKeyOperations.push({
                        updateOne: {
                            filter: { userId: user.userId },
                            update: { $unset: unsetFields }
                        }
                    });
                }

                // 3. Add missing keys from defaultUserData
                const setFields = {};
                for (const key in defaultUserData) {
                    if (!userSettings.hasOwnProperty(key)) {
                        setFields[key] = defaultUserData[key];
                    }
                }
                if (Object.keys(setFields).length > 0) {
                    addDefaultsOperations.push({
                        updateOne: {
                            filter: { userId: user.userId },
                            update: { $set: setFields }
                        }
                    });
                }
            }

            // Execute the delete operations
            if (deleteOperations.length > 0) {
                console.log('Executing delete operations...');
                try {
                    const deleteResult = await collection.bulkWrite(deleteOperations);
                    console.log('Delete operations completed successfully', deleteResult);
                } catch (error) {
                    console.error('Error executing delete operations:', error);
                }
            } else {
                console.log('No users to delete.');
            }

            // Execute the remove key operations
            if (removeKeyOperations.length > 0) {
                console.log('Executing remove key operations...');
                try {
                    const removeKeyResult = await collection.bulkWrite(removeKeyOperations);
                    console.log('Remove key operations completed successfully', removeKeyResult);
                } catch (error) {
                    console.error('Error executing remove key operations:', error);
                }
            } else {
                console.log('No keys to remove.');
            }

            // Execute the add default operations
            if (addDefaultsOperations.length > 0) {
                console.log('Executing add default key operations...');
                try {
                    const addDefaultsResult = await collection.bulkWrite(addDefaultsOperations);
                    console.log('Add default key operations completed successfully', addDefaultsResult);
                } catch (error) {
                    console.error('Error executing add default key operations:', error);
                }
            } else {
                console.log('No default keys to add.');
            }

            return true;

        } catch (error) {
            console.error("Error updating user settings:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[updateAllUserSettings] Failed to get user data:', error);
        throw error;
    }
}


async function removeDuplicateWallets() {
    const job = async () => {
        const client = await getCachedClient();
        console.log('removing duplicate wallets')
        try {
            const collection = client.db(dbName).collection('users');
            
            // Fetch all user settings
            const users = await collection.find().toArray();

            // Step 1: Gather all wallet addresses and track userIds
            const walletMap = new Map();
            for (const user of users) {
                if (user.wallet) {
                    if (!walletMap.has(user.wallet)) {
                        walletMap.set(user.wallet, []);
                    }
                    walletMap.get(user.wallet).push(user._id); // Assuming _id is the unique user identifier
                }
            }

            // Step 2: Identify duplicate wallets
            const duplicateWallets = Array.from(walletMap.entries())
                .filter(([, userIds]) => userIds.length > 1);

            // Step 3: Cleanse duplicate wallets
            for (const [wallet, userIds] of duplicateWallets) {
                for (const userId of userIds) {
                    await collection.updateOne(
                        { _id: userId },
                        { $set: { wallet: '', verified: false } }
                    );
                }
                console.log(`Cleared wallet: ${wallet} for users: ${userIds.join(', ')}`);
            }

            return { message: 'Duplicate wallets removed successfully' };
        } catch (err) {
            console.log('[removeDuplicateWallets] Error:', err);
            throw err;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[removeDuplicateWallets] Failed to get user data:', error);
        throw error;
    }
}



// Replace dbName with your desired database name
//const dbName = dbName;


// Call the function to list databases
//listDatabases();

async function printAllDocuments(dbName, collectionName) {
    // Connection URI

    // Create a new MongoClient
    const client = await getCachedClient();

    try {
        // Connect to the MongoDB server

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
    }
}
async function createDatabase(dbName) {
    // Connection URI

    // Create a new MongoClient
    const client = await getCachedClient();

    try {
        // Connect to the MongoDB server

        // Create the new database
        await client.db(dbName).createCollection('users'); // Creating a dummy collection

        console.log(`Database '${dbName}' created successfully`);
    } catch (error) {
        console.error('Error creating database:', error);
    } 
}
async function printAllCollections(dbName) {
    // Connection URI

    // Create a new MongoClient
    const client = await getCachedClient();

    try {
        // Connect to the MongoDB server

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
    }
}
async function listDatabases() {
    // Connection URI

    // Create a new MongoClient
    const client = await getCachedClient();

    try {
        // Connect to the MongoDB server


        // List the databases
        const databasesList = await client.db().admin().listDatabases();

        console.log('Databases:');
        databasesList.databases.forEach(db => {
            console.log(`- ${db.name}`);
        });
    } catch (error) {
        console.error('Error listing databases:', error);
    } 
}
async function removeDuplicates(dbName, collectionName, criteria) {
    // Connection URI

    // Create a new MongoClient
    const client = await getCachedClient();

    try {
        // Connect to the MongoDB server

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
    }
}
async function deleteUserSettingsByUserId(dbName, userId) {
    // Connection URI

    // Create a new MongoClient
    const client = await getCachedClient();

    try {
        // Connect to the MongoDB server

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
    } 
}
async function deleteAllDocuments(dbName, collectionName) {

    // Create a new MongoClient
    const client = await getCachedClient();

    try {
        // Connect to the MongoDB server

        // Access the database and the specified collection
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Delete all documents from the collection
        const result = await collection.deleteMany({});

        console.log(`Deleted ${result.deletedCount} documents from the collection '${collectionName}'`);
    } catch (error) {
        console.error('Error deleting documents:', error);
    } 
}


//removeDuplicates(dbName, collectionName, '_id');
// Call the function to print all documents in the collection
//printAllDocuments(dbName, collectionName);
//deleteAllDocuments(dbName,'users')
//printAllCollections(dbName)
//connectToMongoDB();
//createDatabase(dbName);

module.exports = { 
    
    readUserData, 
    writeUserData, writeQoints, writeNewUserData, writeUserDataPoint,
    writeBurnData,
    updateAllUserSettings,
    getUserDataByUserId, getUsersByWallet,
    createDefaultUserData,
    updateAllUsersWithCheckpoint, removeDuplicateWallets,
    addPointsToAllUsers,
    createRoom,
    writeData, rareCandy,
    readStats,
    updateGroupPoints,
    incrementLoraUseCounter,
    saveGen,
    createTraining, loadLora, updateLoraStatus,
    saveWorkspace, deleteWorkspace,
    createCollection, loadCollection, getCollectionsByUserId,
    saveStudio, deleteStudio,
    saveImageToGridFS, bucketPull, deleteImageFromWorkspace,
};