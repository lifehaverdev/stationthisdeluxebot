// Import necessary dependencies
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Workspace } = require('./index');
// Define constants
const uri = process.env.MONGO_PASS;
const dbName = 'stationthisbot'//process.env.MONGO_DB_NAME;
const parentFolderPath = '/Users/lifehaver/Desktop/test';

// Create a new MongoClient
let client;

// Initialize MongoDB Client
async function getCachedClient() {
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }
  return client;
}

async function updateLoraStatus(loraId, newStatus) {
  try {
      const client = await getCachedClient();
      const db = client.db(dbName);
      const collection = db.collection('trains');

      // Update the status of the LoRA training data
      const result = await collection.updateOne(
          { loraId: parseInt(loraId) }, // Filter by loraId
          { $set: { status: newStatus } } // Update the status field
      );

      if (result.modifiedCount === 1) {
          console.log(`LoRA ${loraId} status updated to ${newStatus}`);
          return true;
      } else if (result.matchedCount === 0) {
          console.log(`LoRA ${loraId} not found.`);
          return false;
      } else {
          console.warn(`No changes made to the status of LoRA ${loraId}.`);
          return false;
      }
  } catch (error) {
      console.error(`Error updating status for LoRA ${loraId}:`, error);
      return false;
  }
}

// Command Router
async function main() {
  console.log('Script started');
  const args = process.argv.slice(2);
  console.log('Arguments:', args);
  const command = args[0];
  const loraId = args[1];

  switch (command) {
    case 'download':
      if (loraId) {
        await downloadDataset(loraId);
      } else {
        console.log('Please provide a loraId for downloading the dataset.');
      }
      break;
    case 'set-status':
      const status = args[2];
      if (loraId && status) {
        await setStatus(loraId, status);
      } else {
        console.log('Please provide a loraId and status to set.');
      }
      break;
    case 'reject':
      if (loraId) {
        await rejectDataset(loraId);
      } else {
        console.log('Please provide a loraId to reject the dataset.');
      }
      break;
    case 'info':
      await displayInfo();
      break;
    case 'set-global-status':
      const globalStatus = args[1];
      if (globalStatus) {
        await setGlobalStatus(globalStatus);
      } else {
        console.log('Please provide a global status to set.');
      }
      break;
    case 'clean':
      const days = parseInt(args[1], 10);
      if (isNaN(days)) {
          console.log('Please provide a valid number of days for the cleanup.');
      } else {
          await cleanOldTrainings(days);
      }
      break;
    default:
      console.log('Invalid command. Available commands: download, set-status, reject, info, set-global-status');
  }

  // Close the client when done
  if (client) {
    await client.close();
  }
}

// 1. Download Dataset
async function downloadDataset(loraId) {
  try {
    const loraDB = new Workspace();
    // Find the lora data using our LoraDB class
    const loraData = await loraDB.findOne({ loraId: parseInt(loraId) });
    if (!loraData) {
      console.log(`No LoRA data found for loraId: ${loraId}`);
      return;
    }

    // Create a folder for the dataset
    const datasetFolderPath = path.join(parentFolderPath, `lora_${loraId}`);
    if (!fs.existsSync(datasetFolderPath)) {
      fs.mkdirSync(datasetFolderPath, { recursive: true });
    }

    // Download images and captions
    for (let i = 0; i < loraData.images.length; i++) {
      if (loraData.images[i]) {
        try {
          // Use our bucketPull method to get the file
          const tempFilePath = await loraDB.bucketPull(loraData.images[i], loraId, i);
          if (tempFilePath) {
            const imagePath = path.join(datasetFolderPath, `image_${i}.png`);
            // Copy from temp to final location
            fs.copyFileSync(tempFilePath, imagePath);
            // Clean up temp file
            fs.unlinkSync(tempFilePath);
            console.log(`Image ${i} downloaded successfully`);
          }
        } catch (error) {
          console.error(`Error downloading image ${i}:`, error);
          continue; // Continue with next image if one fails
        }
      }

      if (loraData.captions[i]) {
        const captionPath = path.join(datasetFolderPath, `caption_${i}.txt`);
        fs.writeFileSync(captionPath, loraData.captions[i]);
      }
    }

    console.log(`Dataset for loraId ${loraId} downloaded successfully.`);

    // Update status to TOUCHED
    // Update status to TOUCHED
    const statusUpdated = await loraDB.updateLoraStatus(loraId, 'TOUCHED');
    if (!statusUpdated) {
        console.error(`Failed to update status for LoRA ${loraId}.`);
    }
 
  } catch (error) {
    console.error('Error downloading dataset:', error);
  }
}

// 2. Set Status
async function setStatus(loraId, status) {
  try {
    const client = await getCachedClient();
    const collection = client.db(dbName).collection('trains');

    const result = await collection.updateOne(
      { loraId: parseInt(loraId) },
      { $set: { status: status, updatedAt: new Date() } }
    );

    if (result.modifiedCount > 0) {
      console.log(`Status of LoRA ${loraId} updated to '${status}'.`);
      if (status === 'training') {
        await setGlobalStatus(`Currently training LoRA ID: ${loraId}`);
      }
    } else {
      console.log(`No LoRA found with loraId ${loraId}.`);
    }
  } catch (error) {
    console.error('Error setting status:', error);
  }
}

// 3. Reject Dataset
async function rejectDataset(loraId) {
  await setStatus(loraId, 'rejected');
  console.log(`Dataset for LoRA ${loraId} has been rejected.`);
}

// 4. Display Info
async function displayInfo() {
    try {
      const client = await getCachedClient();
      const collection = client.db(dbName).collection('trains');
  
      const trainings = await collection.find({ status: { $ne: 'completed' } }).sort({ submitted: 1 }).toArray();
      console.log('Training Information:');
  
      // Organize trainings by status
      const organizedTrainings = trainings.reduce((acc, training) => {
        if (!acc[training.status]) {
          acc[training.status] = [];
        }
        acc[training.status].push(training);
        return acc;
      }, {});
  
      // Display organized trainings with highest priority status first
      const statusOrder = ['SUBMITTED', 'incomplete', 'pending review', 'rejected', 'training'];
      for (const status of statusOrder) {
        if (organizedTrainings[status]) {
          console.log(`
  Status: ${status.toUpperCase()}`);
          console.log('----------------------------------------');
          organizedTrainings[status].forEach((training) => {
            const submittedDate = training.submitted ? new Date(training.submitted).toLocaleString() : 'Not Submitted';
            console.log(`LoRA ID: ${training.loraId}, Name: ${training.name}, Submitted: ${submittedDate}`);
          });
        }
      }
  
      // Display global status
      const globalStatus = await getGlobalStatus();
      if (globalStatus) {
        console.log(`
  Global Training Status: ${globalStatus.status}`);
      }
    } catch (error) {
      console.error('Error displaying training info:', error);
    }
  }
  
//5. clean old trainings
async function cleanOldTrainings(days) {
  try {
      const client = await getCachedClient();
      const db = client.db(dbName);
      const trainsCollection = db.collection('trains');
      const usersCollection = db.collection('users');
      const bucket = new GridFSBucket(db, { bucketName: 'loraImages' });

      const threshold = Date.now() - days * 24 * 60 * 60 * 1000; // Convert days to milliseconds

      // Find all outdated training entries
      const oldTrainings = await trainsCollection.find({
          $or: [
              { submitted: { $exists: false } },
              { initiated: { $exists: false } },
              { initiated: { $lt: new Date(threshold) } },
              { submitted: { $lt: new Date(threshold) } }
          ]
      }).toArray();

      console.log(`[cleanOldTrainings] Found ${oldTrainings.length} outdated trainings.`);

      for (const training of oldTrainings) {
          const { loraId, userId, images } = training;

          console.log(`[cleanOldTrainings] Cleaning LoRA ${loraId} for user ${userId}.`);

          // Delete associated images from GridFS
          for (const fileId of images) {
              if (fileId) {
                  try {
                      await bucket.delete(new ObjectId(fileId));
                      console.log(`[cleanOldTrainings] Deleted image with ID ${fileId}.`);
                  } catch (error) {
                      console.error(`[cleanOldTrainings] Error deleting image with ID ${fileId}:`, error);
                  }
              }
          }

          // Remove the LoRA ID from the user's loras array
          const userUpdateResult = await usersCollection.updateOne(
              { userId: userId },
              { $pull: { loras: loraId } }
          );
          console.log(`[cleanOldTrainings] Updated user ${userId} loras array:`, userUpdateResult);

          // Delete the training entry from the trains collection
          const deleteResult = await trainsCollection.deleteOne({ loraId: loraId });
          console.log(`[cleanOldTrainings] Deleted training ${loraId}:`, deleteResult);
      }

      console.log('[cleanOldTrainings] Cleanup complete.');
  } catch (error) {
      console.error('[cleanOldTrainings] Error during cleanup:', error);
  }
}


// Set Global Status
async function setGlobalStatus(status) {
  try {
    const client = await getCachedClient();
    const collection = client.db(dbName).collection('trains');
    const filter = { type: 'globalStatus' };
    const update = { $set: { status: status, updatedAt: new Date() } };
    const options = { upsert: true };

    await collection.updateOne(filter, update, options);
    console.log(`Global status updated to: '${status}'`);
  } catch (error) {
    console.error('Error setting global status:', error);
  }
}

// Get Global Status
async function getGlobalStatus() {
  try {
    const client = await getCachedClient();
    const collection = client.db(dbName).collection('trains');
    const globalStatus = await collection.findOne({ type: 'globalStatus' });
    return globalStatus;
  } catch (error) {
    console.error('Error getting global status:', error);
    return null;
  }
}

async function clearLoraImagesBucket() {
  try {
      const client = await getCachedClient(); // Assuming getCachedClient is defined elsewhere
      const db = client.db(dbName); // Replace `dbName` with your database name
      const bucket = new GridFSBucket(db, { bucketName: 'loraImages' });

      console.log('[clearLoraImagesBucket] Fetching all files from the loraImages bucket...');
      const filesCursor = bucket.find();

      const fileIds = [];
      await filesCursor.forEach(file => fileIds.push(file._id));

      if (fileIds.length === 0) {
          console.log('[clearLoraImagesBucket] No files found in the loraImages bucket.');
          return;
      }

      console.log(`[clearLoraImagesBucket] Found ${fileIds.length} files. Deleting...`);
      for (const fileId of fileIds) {
          try {
              await bucket.delete(fileId);
              console.log(`[clearLoraImagesBucket] File with ID ${fileId} deleted successfully.`);
          } catch (error) {
              console.error(`[clearLoraImagesBucket] Error deleting file with ID ${fileId}:`, error);
          }
      }

      console.log('[clearLoraImagesBucket] All files deleted successfully.');
  } catch (error) {
      console.error('[clearLoraImagesBucket] Error clearing loraImages bucket:', error);
  }
}
// Run the main function
//main();
//clearLoraImagesBucket();

module.exports = {
  updateLoraStatus
}