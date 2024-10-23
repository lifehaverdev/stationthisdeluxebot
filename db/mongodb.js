const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const axios = require('axios');
const path = require('path')
const stream = require('stream');
const fs = require('fs')
const { lobby, workspace } = require('../utils/bot/bot')
const defaultUserData = require("../utils/users/defaultUserData.js");
const { DEV_DMS } = require("../utils/utils.js");
const { getBalance } = require('../utils/users/checkBalance.js')
require("dotenv").config()
// Replace the uri string with your connection string.
const uri = process.env.MONGO_PASS
// Replace 'stationthisbot' with your database name
const dbName = process.env.BOT_NAME;

//const client = await getCachedClient();

let cachedClient = null;
let inactivityTimer = null;
const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes


// Function to get the cached client or create a new one
async function getCachedClient() {
    if (!cachedClient) {
        cachedClient = new MongoClient(uri);
        try {
            await cachedClient.connect();
            console.log('MongoClient connected successfully');
        } catch (error) {
            console.error('Error connecting MongoClient:', error);
            cachedClient = null; // Reset cachedClient if connection fails
            throw error; // Re-throw to ensure the caller knows it failed
        }
    } else if (!cachedClient.topology || !cachedClient.topology.isConnected()) {
        // Ensure the cached client is connected before returning it
        try {
            await cachedClient.connect();
            console.log('Reconnected MongoClient');
        } catch (error) {
            console.error('Error reconnecting MongoClient:', error);
            cachedClient = null;
            throw error;
        }
    }
    resetInactivityTimer();
    return cachedClient;
}

async function readUserData(walletAddress) {
    // Create a new MongoClient
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
}
async function getUserDataByUserId(userId) {
    const client = await getCachedClient();
    let userData;

    try {
        const db = client.db(dbName);
        const userSettingsCollection = db.collection('users');

        // First query for user settings by userId
        userData = await userSettingsCollection.findOne({ userId: userId }, { projection: { _id: 0 } });
        if (userData != null) {
            console.log('User settings found:', userData.userId);
            return userData;
        } else {
            // Add a secondary check before inserting defaults
            console.log('Initial lookup for user settings returned null, performing a double-check.');
            userData = await userSettingsCollection.findOne({ userId: userId }, { projection: { _id: 0 } });
            if (userData != null) {
                console.log('User settings found on second check:', userData.userId);
                return userData;
            }

            // If the user still isn't found, create default settings
            console.log('User settings not found, creating new user settings.');
            const userSettings = { ...defaultUserData, userId: userId };
            await userSettingsCollection.insertOne(userSettings);
            console.log('New user settings created:', userSettings.userId);
            return userSettings;
        }
    } catch (error) {
        console.error('Error getting user settings:', error);
        return false;
    }
}


async function loadLora(hashId) {
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
}

// Function to pull a file from GridFS and save it to the /tmp folder
async function bucketPull(loraId, slotId) {
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
}


async function writeUserData(userId, data) {
    const client = await getCachedClient();
    try {
        const collection = client.db(dbName).collection('users');
        const filter = { userId: userId };

        // Separate protected fields from general user data
        const { points, qoints, balance, exp, _id, ...dataToSave } = data;

        // Log the data being written, omitting sensitive fields
        console.log('General user data to be saved:', dataToSave);

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
}

async function getGroupDataByChatId(chatId) {
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
}

async function writeData(collectionName, filter, data) {

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
}




async function createTraining(loraData) {
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
}

async function saveWorkspace(loraObject) {
    const collectionName = 'trains';
    try {
        const client = await getCachedClient();
        const collection = client.db(dbName).collection(collectionName);

        // Extract the loraId from the loraObject
        const { loraId, images, captions } = loraObject;

        // Update the corresponding document in the database
        await collection.updateOne(
            { loraId: loraId }, // Filter to find the specific document by loraId
            { $set: { images: images, captions: captions } } // Update images and captions
        );

        console.log('LoRA data saved successfully');
        return true;
    } catch (error) {
        console.error("Error saving LoRA data:", error);
        return false;
    }
}

async function deleteWorkspace(loraId) {
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
}

async function deleteImageFromWorkspace(loraId, slotId) {
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
}


async function addGenDocument(collectionName, data) {
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
    } finally {
        // Close the connection
        await client.close();
    }
}

function saveGen({task, run, out}) {
    // Combine the data into one object
    const dataToSave = {...task, ...run, ...out};
    
    // Call addGenDocument to save the new document to the 'gens' collection
    addGenDocument('gens', dataToSave);
}

async function updateGroupPoints(group, pointsToAdd) {
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
    } finally {
        await client.close();
    }
}

async function readStats() {
    const client = await getCachedClient();

    // Sets and variables to track stats
    const walletSet = new Set();
    const doubleUseSet = new Set();
    const nonUserSet = new Set();
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
         // Add user wallet to wallet set
            count++
         if (user.wallet) {
            if (walletSet.has(user.wallet)) {
                // If the wallet is already in the set, add it to the doubleUseSet
                doubleUseSet.add(user.wallet);
                user.balance = await getBalance(user.wallet)
                console.log(user.wallet);
            } else {
                walletSet.add(user.wallet);
            }
        }

        // Add user exp to totalExp
        if (user.exp) {
            totalExp += user.exp;
        }

        // Add user balance to totalHeld
        if (user.balance) {
            totalHeld += user.balance;
        }

        // Add user burns to totalBurned
        // if (user.burned) {
        //     totalBurned += user.burned;
        // }

        // Add the number of promptDex prompts to totalDex
        if (user.promptDex && Array.isArray(user.promptDex)) {
            totalDex += user.promptdex.length;
        }

        // If exp == 0, add userId to nonUserSet
        if (user.exp === 0) {
            nonUserSet.add(user._id);
        }
        }
        let msg = ''
        msg += 'total Users '+count+`\n`
        msg += 'tourists ' + nonUserSet.size+'\n'
        msg += 'net users ' + (count - nonUserSet.size) +'\n'
        msg += 'net wallets ' + walletSet.size+`\n\n`
        //msg += 'double wallets ' + doubleUseSet.size+`\n`
        msg += 'total Exp '+totalExp+`\n`
        msg += 'total Balance Held '+totalHeld+`MS2\n`
        //msg += 'total Dex ' + totalDex+`\n`
        
        //msg += 'totalBurned'
        //bot.sendMessage(DEV_DMS, msg);
        console.log('All user settings analyzed successfully');
        return msg;
    } catch (error) {
        console.error("Error updating user settings:", error);
        return false;
    } finally {
        await client.close();
    }
}

async function incrementLoraUseCounter(names) {
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
    } finally {
        await client.close();
    }
}

//write room settings
//saves settings

//modbalanceroom
//changes rooms applied balance
//adds a negative balance to the burns db

//

async function createRoom(chatId, userId, value) {
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
}

async function writeBurnData(userId, amount) {
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
}


async function addPointsToAllUsers() {
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
}
async function updateAllUsersWithCheckpoint() {
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
}
async function updateAllUserSettings() {
    const client = await getCachedClient();

    try {
        const collection = client.db(dbName).collection('users');
        
        // Fetch all user settings
        const users = await collection.find().toArray();
        
        for (let user of users) {
            let updatedUserSettings = { ...user };

            // Add missing keys from defaultUserData
            for (const key in defaultUserData) {
                if (!updatedUserSettings.hasOwnProperty(key)) {
                    updatedUserSettings[key] = defaultUserData[key];
                }
            }

            // Remove keys not present in defaultUserData
            for (const key in updatedUserSettings) {
                if (!defaultUserData.hasOwnProperty(key)) {
                    delete updatedUserSettings[key];
                }
            }

            // Upsert the updated user settings
            const filter = { userId: user.userId };
            await collection.updateOne(filter, { $set: updatedUserSettings });

            console.log(`User settings updated for userId: ${user.userId}`);
        }

        console.log('All user settings updated successfully');
        return true;
    } catch (error) {
        console.error("Error updating user settings:", error);
        return false;
    } finally {
        await client.close();
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
    getUserDataByUserId, 
    updateAllUsersWithCheckpoint,
    addPointsToAllUsers,
    createRoom,
    writeData,
    readStats,
    updateGroupPoints,
    incrementLoraUseCounter,
    saveGen,
    createTraining, loadLora, 
    saveWorkspace, deleteWorkspace,
    saveImageToGridFS, bucketPull, deleteImageFromWorkspace,
};