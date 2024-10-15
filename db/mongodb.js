const { MongoClient, ObjectId } = require("mongodb");
const { lobby } = require('../utils/bot/bot')
const defaultUserData = require("../utils/users/defaultUserData.js");
const { DEV_DMS } = require("../utils/utils.js");
const { getBalance } = require('../utils/users/checkBalance.js')
require("dotenv").config()
// Replace the uri string with your connection string.
const uri = process.env.MONGO_PASS
// Replace 'stationthisbot' with your database name
const dbName = process.env.BOT_NAME;

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

// async function writeUserData(userId, data) {
//     const uri = process.env.MONGO_PASS;

//     // Create a new MongoClient
//     const client = new MongoClient(uri);
    
//     try {
//         const collection = client.db(dbName).collection('users');
//         // Upsert the document with wallet address as the filter
//         const filter = { userId: userId };
//         const { points, balance, ...dataToSave } = data;
//         await collection.updateOne( filter,
//             { $set: { ...dataToSave }}, { upsert: true} ,
//         );
//         console.log('User data written successfully');
//         return true
//     } catch (error) {
//         console.error("Error writing user data:", error);
//         return false
//     } finally {
//         // Close the connection if it was established within this function
//         await client.close();
//     }
// }
async function writeUserData(userId, data) {
    const uri = process.env.MONGO_PASS;
    const client = new MongoClient(uri);
    
    try {
        const collection = client.db(dbName).collection('users');
        const filter = { userId: userId };

        // Separate points and balance from the rest of the data
        const { points, balance, _id, ...dataToSave } = data;

        // Log what is being written to MongoDB for debugging
        //console.log('Data to be saved:', dataToSave);

        const result = await collection.updateOne(
            filter,
            { $set: { ...dataToSave } }
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
    } finally {
        await client.close();
    }
}




async function getGroupDataByChatId(chatId) {
    //deleteUserSettingsByUserId(dbName,userId);
    // Connection URI
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);
    let groupData
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
    } finally {
        // Close the connection
        await client.close();
    }
}

async function writeData(collectionName, filter, data) {
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);
    
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
    } finally {
        // Close the connection if it was established within this function
        await client.close();
    }
}

async function addGenDocument(collectionName, data) {
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);
    
    try {
        // Connect to the client
        await client.connect();

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
    const uri = process.env.MONGO_PASS;
    const client = new MongoClient(uri);

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
    const uri = process.env.MONGO_PASS;
    const client = new MongoClient(uri);

    // Sets and variables to track stats
    const walletSet = new Set();
    const doubleUseSet = new Set();
    const nonUserSet = new Set();
    let totalExp = 0;
    let totalHeld = 0;
    let totalBurned = 0;
    let totalDex = 0;

    try {
        await client.connect();
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
    const uri = process.env.MONGO_PASS;
    const client = new MongoClient(uri);

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
    const uri = process.env.MONGO_PASS;
    console.log(value)
    // Create a new MongoClient
    const client = new MongoClient(uri);
    
    try {
        await client.connect();
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
    } finally {
        // Close the connection if it was established within this function
        await client.close();
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
    const uri = process.env.MONGO_PASS;
    //console.log(value)
    // Create a new MongoClient
    const client = new MongoClient(uri);
    amount = -amount * 1000000;
    try {
        await client.connect();
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
    


async function updateAllUserSettings() {
    const uri = process.env.MONGO_PASS;
    const client = new MongoClient(uri);

    try {
        await client.connect();
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
async function addPointsToAllUsers() {
    const uri = process.env.MONGO_PASS;
    const client = new MongoClient(uri);

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
    } finally {
        await client.close();
    }
}
async function updateAllUsersWithCheckpoint() {
    const uri = process.env.MONGO_PASS;
    const client = new MongoClient(uri);

    try {
        await client.connect();
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
    } finally {
        await client.close();
    }
}


async function writeCollectionData(userId, collectionName) {
    try {
        await client.connect();
        const collection = client.db(dbName).collection('collections');
        const data = { userId: userId, collectionName: collectionName, metadata: [] };
        const result = await collection.updateOne({ userId: userId, collectionName: collectionName }, { $set: data }, { upsert: true });
        return result.upsertedCount > 0 || result.modifiedCount > 0;
    } finally {
        await client.close();
    }
}

// async function getCollections(userId) {
//     try {
//         await client.connect();
//         const collection = client.db(dbName).collection('collections');
//         return await collection.find({ userId: userId }).project({ collectionName: 1, _id: 0 }).toArray();
//     } finally {
//         await client.close();
//     }
// }

async function getCollections(userId) {
    try {
        await client.connect();
        const collection = client.db(dbName).collection('collections');
        // Include basePrompt and uri in the projection
        return await collection.find({ userId: userId })
                               .project({ collectionName: 1, basePrompt: 1, uri: 1, _id: 0, metadata: 1 })
                               .toArray();
    } finally {
        await client.close();
    }
}

async function addMetadataToCollection(collectionName, metadata) {
    console.log('adding to collection')
    try {
        await client.connect();
        const collection = client.db(dbName).collection('collections');

        // First, fetch the current state of the collection to determine the next ms2tokenId
        const currentCollection = await collection.findOne({ collectionName: collectionName });
        if (!currentCollection) {
            console.error('Collection not found');
            return false;
        }

        // Determine the next ms2tokenId based on the length of the metadata array
        const nextTokenId = currentCollection.metadata.length + 1;

        // Append the ms2tokenId to the metadata object
        metadata.ms2tokenId = nextTokenId;

        // Push the updated metadata to the collection
        const updateResult = await collection.updateOne(
            { collectionName: collectionName },
            { $push: { metadata: metadata } }
        );

        if (updateResult.modifiedCount === 1) {
            console.log('Metadata added successfully');
            return true;
        } else {
            console.error('No collection document was updated');
            return false;
        }
    } catch (error) {
        console.error("Error adding metadata to collection:", error);
        return false;
    } finally {
        await client.close();
    }
}

async function editCollectionURI(userId,collectionName,uri) {
    const client = new MongoClient(process.env.MONGO_PASS);
    try {
        await client.connect();
        const collection = client.db(dbName).collection('collections');
        const filter = { userId: userId, collectionName: collectionName };
        const updateDoc = {
            $set: { uri: uri }
        };
        await collection.updateOne(filter, updateDoc);
        console.log('URI added to collection successfully');
    } catch (error) {
        console.error('Failed to add URI:', error.message);
    } finally {
        await client.close();
    }
}

async function editCollectionBasePrompt(userId,collectionName,basePrompt) {
    const client = new MongoClient(process.env.MONGO_PASS);
    try {
        await client.connect();
        const collection = client.db(dbName).collection('collections');
        const filter = { userId: userId, collectionName: collectionName };
        const updateDoc = {
            $set: { basePrompt: basePrompt }
        };
        await collection.updateOne(filter, updateDoc);
        console.log('Base Prompt added to collection successfully');
    } catch (error) {
        console.error('Failed to add URI:', error.message);
    } finally {
        await client.close();
    }
}
async function performCollectionDatabaseAction(action, dbName, collectionName, filter, update) {
    const uri = process.env.MONGO_PASS;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const collection = client.db(dbName).collection(collectionName);
        
        let result;
        switch (action) {
            case 'write':
                result = await collection.updateOne(filter, { $set: update }, { upsert: true });
                return result.upsertedCount > 0 || result.modifiedCount > 0;
            case 'addMetadata':
                // Assuming metadata is an array field in the document
                result = await collection.updateOne(filter, { $push: { metadata: update } });
                return result.modifiedCount === 1;
            case 'editField':
                result = await collection.updateOne(filter, { $set: update });
                return result.modifiedCount === 1;
            // Add more cases for other actions as needed
            case 'delete':
                result = await collection.deleteOne(filter);
                return result.deletedCount === 1;
            default:
                throw new Error('Invalid action specified');
        }
    } catch (error) {
        console.error(`Error performing ${action} operation:`, error);
        return false;
    } finally {
        await client.close();
    }
}

async function readUserData(walletAddress) {
    const uri = process.env.MONGO_PASS;

    // Create a new MongoClient
    const client = new MongoClient(uri);
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
    } finally {
        await client.close();
    }
}

async function getUserDataByUserId(userId) {
    
    //deleteUserSettingsByUserId(dbName,userId);
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
        const db = client.db(dbName);
        const userSettingsCollection = db.collection('users');

        // Query for the user settings by userId
        userData = await userSettingsCollection.findOne({ userId: userId },{ projection: { _id: 0 }});
        //console.log('userData in get userdatabyuserid',userData);
        if (userData != null){
            console.log('User settings found:', userData.userId);
            return userData;
        } else {
            console.log('empty user settings');
            userSettings = { ...defaultUserData, userId: userId };
            console.log('userSettings we are writing',userSettings.userId);
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

// Replace dbName with your desired database name
//const dbName = dbName;


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

async function updateMetadataEntry(userId, metadataId, features, imageUrl) {
    const client = new MongoClient(process.env.MONGO_PASS);
    try {
        await client.connect();
        const collection = client.db(dbName).collection('collections');
        console.log("Attempting to update:", userId, metadataId);  // Log identifiers

        const filter = { userId: userId, "metadata.ms2tokenId": metadataId };
        const update = { $set: { "metadata.$.features": features, "metadata.$.imageUrl": imageUrl } };
        const result = await collection.updateOne(filter, update);

        console.log("Matched Count:", result.matchedCount);  // How many documents were matched
        console.log("Modified Count:", result.modifiedCount);  // How many documents were modified

        return result.modifiedCount === 1;
    } catch (error) {
        console.error("Error in updateMetadataEntry:", error);
        return false;  // Ensure false is returned on error
    } finally {
        await client.close();
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
    performCollectionDatabaseAction, 
    editCollectionBasePrompt, 
    addMetadataToCollection, 
    editCollectionURI, 
    readUserData, 
    writeUserData, 
    writeBurnData,
    updateAllUserSettings,
    getUserDataByUserId, 
    getCollections, 
    writeCollectionData,
    updateAllUsersWithCheckpoint,
    addPointsToAllUsers,
    createRoom,
    writeData,
    readStats,
    updateGroupPoints,
    incrementLoraUseCounter,
    saveGen
};