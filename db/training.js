// Import necessary dependencies
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const LoraDB = require('./models/workspace');
const GlobalStatusDB = require('./models/globalStatus');
// Define constants
const uri = process.env.MONGO_PASS;
const dbName = 'stationthisbot'//process.env.MONGO_DB_NAME;
const parentFolderPath = '/Users/lifehaver/Desktop/test';

// Initialize DB classes
const loraDB = new LoraDB();
const globalStatusDB = new GlobalStatusDB();

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
    case 'set-training-status':
      const globalStatus = args[1];
      if (globalStatus) {
        await setTrainingGlobalStatus(globalStatus);
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
    case 'set-global-status':
      const trainingId = args[1];
      const trainingStatus = args[2];
      if (trainingId && trainingStatus) {
        console.log('setting global status for trainingId', trainingId, 'to', trainingStatus);
        await setGlobalTrainingStatus(trainingId, trainingStatus);
      } else {
        console.log('Please provide a trainingId and status.');
      }
      break;
    default:
      console.log('Invalid command. Available commands: download, set-status, reject, info, set-global-status');
  }
}

// 1. Download Dataset
async function downloadDataset(loraId) {
  try {
    const loraDB = new LoraDB();
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
    const loraDB = new LoraDB();
    const result = await loraDB.updateLoraStatus(loraId, status);
    
    if (result) {
      console.log(`Status of LoRA ${loraId} updated to '${status}'.`);
      if (status === 'training') {
        await setTrainingGlobalStatus(`Currently training LoRA ID: ${loraId}`);
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
        const trainings = await loraDB.getIncompleteTrainings();
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
        const globalStatus = await getTrainingGlobalStatus();
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
      const cleanedCount = await loraDB.cleanOldTrainings(days);
      console.log(`Cleaned ${cleanedCount} old trainings`);
      return cleanedCount;
  } catch (error) {
      console.error('Error cleaning old trainings:', error);
      throw error;
  }
}

// Set Global Status
async function setTrainingGlobalStatus(status) {
  try {
    const result = await loraDB.updateLoraStatus(loraId, status);
    if (result) {
      console.log(`Training global status updated to: '${status}'`);
    } else {
      console.log(`Failed to update training status`);
    }
  } catch (error) {
    console.error('Error setting training global status:', error);
  }
}

// Get Global Status
async function getTrainingGlobalStatus() {
  try {
    const status = await globalStatusDB.getGlobalStatus();
    return status?.training || null;
  } catch (error) {
    console.error('Error getting training global status:', error);
    return null;
  }
}


// New method to handle global status updates
async function setGlobalTrainingStatus(trainingId, status) {
  try {
      const globalStatusDB = new GlobalStatusDB();
      const currentStatus = await globalStatusDB.getGlobalStatus();
      const training = await loraDB.getTrainingInfo(trainingId);
      // Remove any existing entry for this training
      const updatedTraining = (currentStatus.training || [])
          .filter(t => t.loraId !== parseInt(trainingId));
      
      // Add new training status
      updatedTraining.push({
          loraId: parseInt(trainingId),
          name: training.name,
          status: status,
          updatedAt: new Date()
      });

      await globalStatusDB.updateStatus({
          training: updatedTraining
      });

      console.log(`Global training status updated for LoRA ${trainingId}: ${status}`);
  } catch (error) {
      console.error('Error updating global training status:', error);
  }
}

// async function clearLoraImagesBucket() {
//   try {
//       const client = await getCachedClient(); // Assuming getCachedClient is defined elsewhere
//       const db = client.db(dbName); // Replace `dbName` with your database name
//       const bucket = new GridFSBucket(db, { bucketName: 'loraImages' });

//       console.log('[clearLoraImagesBucket] Fetching all files from the loraImages bucket...');
//       const filesCursor = bucket.find();

//       const fileIds = [];
//       await filesCursor.forEach(file => fileIds.push(file._id));

//       if (fileIds.length === 0) {
//           console.log('[clearLoraImagesBucket] No files found in the loraImages bucket.');
//           return;
//       }

//       console.log(`[clearLoraImagesBucket] Found ${fileIds.length} files. Deleting...`);
//       for (const fileId of fileIds) {
//           try {
//               await bucket.delete(fileId);
//               console.log(`[clearLoraImagesBucket] File with ID ${fileId} deleted successfully.`);
//           } catch (error) {
//               console.error(`[clearLoraImagesBucket] Error deleting file with ID ${fileId}:`, error);
//           }
//       }

//       console.log('[clearLoraImagesBucket] All files deleted successfully.');
//   } catch (error) {
//       console.error('[clearLoraImagesBucket] Error clearing loraImages bucket:', error);
//   }
// }
// Run the main function
main();
//clearLoraImagesBucket();

module.exports = {
  downloadDataset,
  setStatus,
  // ... other exports as needed ...
}