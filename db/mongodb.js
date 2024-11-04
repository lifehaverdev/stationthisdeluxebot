const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const axios = require('axios');
const path = require('path')
const stream = require('stream');
const fs = require('fs')
const { lobby, workspace } = require('../utils/bot/bot')
const defaultUserData = require("../utils/users/defaultUserData.js");
//const { DEV_DMS } = require("../utils/utils.js");
const { getBalance } = require('../utils/users/checkBalance.js')
require("dotenv").config()
// Replace the uri string with your connection string.
const uri = process.env.MONGO_PASS
// Replace 'stationthisbot' with your database name
const dbName = process.env.BOT_NAME;
const DEV_DMS = 5472638766;
let cachedClient = null;
let inactivityTimer = null;
const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes

class DatabaseQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
    }

    // Add a job to the queue and return a promise that resolves with the result
    enqueue(job) {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await job(); // Execute the job
                    resolve(result); // Resolve the promise with the job's result
                } catch (error) {
                    reject(error); // Reject if the job fails
                }
            });

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
            await job(); // Execute the job
        } catch (error) {
            console.error('Error processing job:', error);
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
    console.log('[getCachedClient] Called');

    // If there's an existing connection attempt in progress, wait for it
    if (connectionInProgress) {
        console.log('[getCachedClient] Connection in progress. Awaiting current connection...');
        await connectionInProgress;
        console.log('[getCachedClient] Existing connection completed. Returning cached client.');
        return cachedClient;
    }

    if (!cachedClient) {
        console.log('[getCachedClient] No cached client found. Initiating new connection...');

        // Begin a new connection attempt
        connectionInProgress = (async () => {
            cachedClient = new MongoClient(uri);
            console.log('[getCachedClient] New MongoClient instance created.');

            try {
                await cachedClient.connect();
                console.log('[getCachedClient] MongoClient connected successfully.');
            } catch (error) {
                console.error('[getCachedClient] Error connecting MongoClient:', error);
                cachedClient = null; // Reset cachedClient if connection fails
                throw error; // Re-throw to ensure the caller knows it failed
            } finally {
                console.log('[getCachedClient] Connection attempt finished. Clearing connectionInProgress flag.');
                connectionInProgress = null; // Reset in-progress flag
            }
        })();

        try {
            await connectionInProgress;  // Wait for connection to complete
            console.log('[getCachedClient] New connection completed successfully.');
        } catch (error) {
            console.error('[getCachedClient] Failed to complete new connection:', error);
            throw error;
        }

    } else if (!cachedClient.topology || !cachedClient.topology.isConnected()) {
        console.log('[getCachedClient] Cached client found, but not connected. Attempting reconnection...');

        connectionInProgress = (async () => {
            try {
                await cachedClient.connect();
                console.log('[getCachedClient] Reconnected MongoClient successfully.');
            } catch (error) {
                console.error('[getCachedClient] Error reconnecting MongoClient:', error);
                cachedClient = null; // Reset cachedClient if reconnection fails
                throw error;
            } finally {
                console.log('[getCachedClient] Reconnection attempt finished. Clearing connectionInProgress flag.');
                connectionInProgress = null; // Reset in-progress flag
            }
        })();

        try {
            await connectionInProgress;  // Wait for reconnection to complete
            console.log('[getCachedClient] Reconnection completed successfully.');
        } catch (error) {
            console.error('[getCachedClient] Failed to complete reconnection:', error);
            throw error;
        }
    }

    console.log('[getCachedClient] Returning cached client.');
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
        throw error;
    }
}
// Function to get user data by userId
async function getUserDataByUserId(userId) {
    console.log('[getUserDataByUserId] Called for userId:', userId);

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            console.log('[getUserDataByUserId] hitting get user data');
            try {
                const db = client.db(dbName);
                const userSettingsCollection = db.collection('users');
                //console.log('[getUserDataByUserId] db:', db);
                //console.log('[getUserDataByUserId] usersettingcollection:', userSettingsCollection);

                // Query for user settings by userId
                const userData = await userSettingsCollection.findOne({ userId: userId }, { projection: { _id: 0 } });
                //console.log('[getUserDataByUserId] user data:', userData);
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
    const job = async () => {
        const client = await getCachedClient();
        try {
            const db = client.db(dbName);
            const userSettingsCollection = db.collection('users');

            // Create default user settings
            const userSettings = { ...defaultUserData, userId: userId };
            await userSettingsCollection.insertOne(userSettings);
            console.log('New user settings created:', userSettings.userId);
            return userSettings;
        } catch (error) {
            console.error('Error creating user settings:', error);
            throw error; // Throw error so the caller knows the request failed
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[getUserDataByUserId] Failed to get user data:', error);
        throw error;
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
        throw error;
    }
}

// Function to pull a file from GridFS and save it to the /tmp folder
async function bucketPull(loraId, slotId) {
    const job = async () => {
        const client = await getCachedClient();
        try {
            const db = client.db(dbName);
            const bucket = new GridFSBucket(db, { bucketName: 'loraImages' });

            // Define the local file path in the /tmp directory
            const tempFilePath = path.join('/tmp', `slot_image_${loraId}_${slotId}.jpg`);
            const fileId = workspace[loraId].images[slotId];

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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
        throw error;
    }
}


async function writeUserData(userId, data) {
    const job = async () => {
        const client = await getCachedClient();
        try {
            const collection = client.db(dbName).collection('users');
            const filter = { userId: userId };

            // Separate protected fields from general user data
            const { points, qoints, balance, exp, _id, ...dataToSave } = data;

            // Log the data being written, omitting sensitive fields
            //console.log('General user data to be saved:', dataToSave);

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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
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
            console.log('User data written successfully');
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
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

            // Find the LoRA document by loraId to get the image IDs
            const loraData = await collection.findOne({ loraId: loraId });
            if (!loraData) {
                console.log('LoRA data not found, nothing to delete.');
                return false;
            }

            // Delete each image from GridFS if it exists
            if (loraData.images && Array.isArray(loraData.images)) {
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

            // Delete the corresponding document in the database
            await collection.deleteOne({ loraId: loraId });

            console.log('LoRA data deleted successfully');
            return true;
        } catch (error) {
            console.error("Error deleting LoRA data:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[getUserDataByUserId] Failed to get user data:', error);
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
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

        try {
            const collection = client.db(dbName).collection('floorplan');
            const filter = { owner: group.owner };

            // Retrieve the current points
            const existingGroup = await collection.findOne(filter);

            // Calculate the new points
            const updatedPoints = Math.max(((existingGroup?.qoints || 0) - pointsToAdd),0);

            // Use the existing writeData function to save the updated points
            await writeData('floorplan', filter, { qoints: updatedPoints });

            console.log('Group points updated successfully');
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
        throw error;
    }
}

async function readStats() {
    
    const client = await getCachedClient();

    // Sets and variables to track stats
    const walletSet = new Set();
    const doubleUseSet = new Set();
    const nonUserSet = new Set();
    const keySet = new Set();
    let totalExp = 0;
    let totalHeld = 0;
    let totalBurned = 0;
    let totalDex = 0;

    try {
        const collection = client.db(dbName).collection('users');
        
        // Fetch all user settings
        const users = await collection.find().toArray();
        let count = 0;
        for (let user of users) {
            count++;
            console.log(`Processing user ${count}: userId = ${user.userId}`);

            // Track all keys in user object
            Object.keys(user).forEach(key => {
                if (!keySet.has(key)) {
                    keySet.add(key);
                }
            });

            // Add user wallet to wallet set
            if (user.wallet) {
                if (walletSet.has(user.wallet)) {
                    // If the wallet is already in the set, add it to the doubleUseSet
                    doubleUseSet.add(user.wallet);
                    console.log(`Duplicate wallet found: ${user.wallet}`);
                } else {
                    walletSet.add(user.wallet);
                    // Only check balance for non-duplicate wallets
                    user.balance = await getBalance(user.wallet);
                    //console.log(`Checking balance for wallet: ${user.wallet}`);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Add 1-second delay to avoid API rate limits
                }
            } else {
                console.log(`No wallet found for userId: ${user.userId}`);
            }

            // Add user exp to totalExp
            if (user.exp) {
                totalExp += user.exp;
            }

            // Add user balance to totalHeld
            if (user.balance) {
                totalHeld += user.balance;
            }

            // Add user burns to totalBurned (commented out for now)
            // if (user.burned) {
            //     totalBurned += user.burned;
            // }

            // Add the number of promptDex prompts to totalDex
            if (user.promptDex && Array.isArray(user.promptDex)) {
                totalDex += user.promptDex.length;
            }

            // If exp == 0, add userId to nonUserSet
            if (user.exp === 0) {
                nonUserSet.add(user._id);
            }
        }

        let msg = '';
        msg += 'total Users ' + count + '\n';
        msg += 'tourists ' + nonUserSet.size + '\n';
        msg += 'net users ' + (count - nonUserSet.size) + '\n';
        msg += 'net wallets ' + walletSet.size + '\n\n';
        // msg += 'double wallets ' + doubleUseSet.size + '\n';
        msg += 'total Exp ' + totalExp + '\n';
        msg += 'total Balance Held ' + totalHeld + ' MS2\n';
        // msg += 'total Dex ' + totalDex + '\n';
        // msg += 'totalBurned';

        console.log('All unique keys found in user objects:', [...keySet]);
        console.log('All user settings analyzed successfully');
        return msg;
    } catch (error) {
        console.error("Error updating user settings:", error);
        return false;
    } 
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
        throw error;
    }
}

//write room settings
//saves settings

//modbalanceroom
//changes rooms applied balance
//adds a negative balance to the burns db

//

async function createRoom(chatId, userId, value) {
    const job = async () => {
        console.log(value)
        // Create a new MongoClient
        const client = await getCachedClient();
        
        try {
            const collection = client.db(dbName).collection('floorplan');
            
            // Fetch the creator's settings from the lobby
            const settings = lobby[userId];
            if (!settings) {
                throw new Error("User settings not found");
            }
            const room = {
                owner: userId,
                name: lobby[userId].group, // This can be parameterized
                admins: [],
                wallet: lobby[userId].wallet,
                applied: parseInt(value), // This can be parameterized
                points: 0,
                credits: parseInt(value) * 2 / 540,
                id: chatId,
                settings: {
                    ...settings
                }
            };
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
        throw error;
    }
}


async function addPointsToAllUsers() {
    const job = async () => {
        const client = await getCachedClient();

        try {
            const collection = client.db(dbName).collection('users');
            //console.log('Here is the lobby right now:', lobby);

            const processedUserIds = new Set();  // To track processed user IDs

            for (const userId in lobby) {
                //console.log('userId and type',userId, typeof userId)
                if (userId && lobby.hasOwnProperty(userId)) {
                    //console.log('we can see the userid here');
                    if (processedUserIds.has(userId)) {
                        console.log(`Duplicate entry found for userId: ${userId}`);
                        continue;
                    }
                    processedUserIds.add(userId);

                    console.log('Adding points for:', userId);
                    const user = lobby[userId];
                    const pointsToAdd = user.points + user.boints;
                    
                    if (pointsToAdd > 0) {
                        try {
                            const result = await collection.updateOne(
                                { userId: parseInt(userId) },  // Ensure userId is treated as a string
                                { $inc: { exp: pointsToAdd } }
                            );
                            
                            if (result.matchedCount === 0) {
                                console.log(`User with ID ${userId} not found in the database.`);
                            } else if (result.modifiedCount === 0) {
                                console.log(`Points for user ${userId} were not updated.`);
                            } else {
                                console.log(`Added ${pointsToAdd} points to user ${userId} exp successfully`);
                            }
                        } catch (err) {
                            console.log('Failed to update points, error:', err);
                        }
                    } else {
                        console.log(`No points to add for user ${userId} in this period`);
                    }
                }
            }
            return true;
        } catch (error) {
            console.error("Error adding points to all users:", error);
            return false;
        }
    };

    // Enqueue the job and await its result
    try {
        const userData = await dbQueue.enqueue(job);
        return userData;  // Return the result to the caller
    } catch (error) {
        console.error('[getUserDataByUserId] Failed to get user data:', error);
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
        throw error;
    }
}
async function updateAllUserSettings() {
    const job = async () => {
        const client = await getCachedClient();

        try {
            const collection = client.db(dbName).collection('users');
            
            // Fetch all user settings
            const users = await collection.find().toArray();
            //const users = await collection.find({ userId: DEV_DMS }).toArray();
            
    //         for (let user of users) {
    //             let updatedUserSettings = { ...user };


    // // Remove the _id field to avoid attempting to update it
    // delete updatedUserSettings._id;

    //             // Add missing keys from defaultUserData
    //             for (const key in defaultUserData) {
    //                 if (!updatedUserSettings.hasOwnProperty(key)) {
    //                     updatedUserSettings[key] = defaultUserData[key];
    //                 }
    //             }
    //             let unsetFields = {}
    //             for (const key in updatedUserSettings) {
    //                 if (!defaultUserData.hasOwnProperty(key)) {
    //                     unsetFields[key] = "";
    //                 }
    //             }

        
    //             // Upsert the updated user settings
    //             const filter = { userId: user.userId };
    //             if (Object.keys(unsetFields).length > 0) {
    //                 await collection.updateOne(filter, { $set: updatedUserSettings, $unset: unsetFields });
    //             } else {
    //                 await collection.updateOne(filter, { $set: updatedUserSettings });
    //             }
                
    //             //await collection.updateOne(filter, { $set: updatedUserSettings });

    //             console.log(`User settings updated for userId: ${user.userId}`);
    //         }

    //         console.log('All user settings updated successfully');
    for (let user of users) {
        let updatedUserSettings = { ...user };
    
        // Remove the _id field to avoid attempting to update it
        delete updatedUserSettings._id;
    
        // Add missing keys from defaultUserData
        for (const key in defaultUserData) {
            if (!updatedUserSettings.hasOwnProperty(key)) {
                updatedUserSettings[key] = defaultUserData[key];
            }
        }
    
        // Initialize unsetFields as an empty object
        let unsetFields = {};
    
        // Remove keys not present in defaultUserData
        for (const key in updatedUserSettings) {
            if (!defaultUserData.hasOwnProperty(key)) {
                unsetFields[key] = "";
            }
        }
    
        // Log the values before updating
        console.log(`Updating user settings for userId: ${user.userId}`);
        console.log('Updated User Settings:', updatedUserSettings);
        console.log('Unset Fields:', unsetFields);
    
        const filter = { userId: user.userId };
    
        // Upsert the updated user settings first
        try {
            await collection.updateOne(filter, { $set: updatedUserSettings });
            console.log(`User settings successfully updated for userId: ${user.userId}`);
        } catch (error) {
            console.error(`Error updating user settings for userId ${user.userId}:`, error);
        }
    
        // Now unset deprecated fields
        try {
            if (Object.keys(unsetFields).length > 0) {
                await collection.updateOne(filter, { $unset: unsetFields });
                console.log(`Deprecated fields successfully removed for userId: ${user.userId}`);
            }
        } catch (error) {
            console.error(`Error unsetting fields for userId ${user.userId}:`, error);
        }
    }
    
    console.log('All user settings updated successfully');
    
    
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
        console.error('[getUserDataByUserId] Failed to get user data:', error);
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
    writeUserData, 
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
    createTraining, loadLora, 
    saveWorkspace, deleteWorkspace,
    saveImageToGridFS, bucketPull, deleteImageFromWorkspace,
};