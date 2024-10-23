// Import necessary dependencies
const { MongoClient, GridFSBucket } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Define constants
const uri = process.env.MONGO_PASS;
const dbName = 'stationthisbot'//process.env.MONGO_DB_NAME;
const parentFolderPath = '/path/to/parent/folder'; // Set this to the desired parent directory for datasets

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

// Command Router
async function main() {
  const args = process.argv.slice(2);
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
    const client = await getCachedClient();
    const db = client.db(dbName);
    const collection = db.collection('trains');
    const bucket = new GridFSBucket(db, { bucketName: 'loraImages' });

    // Find the lora data
    const loraData = await collection.findOne({ loraId: parseInt(loraId) });
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
        const fileId = loraData.images[i];
        const downloadStream = bucket.openDownloadStream(fileId);
        const imagePath = path.join(datasetFolderPath, `image_${i}.png`);
        const writeStream = fs.createWriteStream(imagePath);

        await new Promise((resolve, reject) => {
          downloadStream.pipe(writeStream);
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });
      }

      if (loraData.captions[i]) {
        const captionPath = path.join(datasetFolderPath, `caption_${i}.txt`);
        fs.writeFileSync(captionPath, loraData.captions[i]);
      }
    }

    console.log(`Dataset for loraId ${loraId} downloaded successfully.`);
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
// 4. Display Info
async function displayInfo() {
    try {
      const client = await getCachedClient();
      const collection = client.db(dbName).collection('trains');
  
      const trainings = await collection.find({ status: { $ne: 'completed' } }).sort({ submitted: 1 }).toArray();
      console.log('Training Information:');
      trainings.forEach((training) => {
        const submittedDate = training.submitted ? new Date(training.submitted).toLocaleString() : '';
        console.log(`LoRA ID: ${training.loraId}, Name: ${training.name}, Status: ${training.status} ${submittedDate}`);
      });
  
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

// Run the main function
main();
