const { BaseDB } = require('./BaseDB');
const { dbQueue, getCachedClient } = require('../utils/queue');
const fs = require('fs');
const path = require('path');
const { ObjectId,  GridFSBucket } = require('mongodb');
const axios = require('axios');
const { getBotInstance } = require('../../utils/bot/bot');

class LoraDB extends BaseDB {
    constructor() {
        super('trains');
    }

    async createTraining(loraData) {
        return this.updateOne(
            { loraId: loraData.loraId },
            loraData,
            { upsert: true }
        );
    }

    async getTrainingsByUserId(userId) {
        return this.findMany({ userId }, {
            sort: { initiated: -1 }
        });
    }

    async getIncompleteTrainings() {
        return this.findMany(
            { status: { $ne: 'completed' } },
            { sort: { submitted: 1 } }
        );
    }

    async getTrainingInfo(loraId) {
        return this.findOne({ loraId: parseInt(loraId) });
    }

    async loadLora(loraId) {
        return this.findOne({ loraId });
    }

    async deleteWorkspace(loraId) {
        // Delete images from GridFS first
        const lora = await this.loadLora(loraId);
        if (lora?.images) {
            for (const imageId of lora.images) {
                if (imageId) {
                    await this.deleteImageFromWorkspace(loraId, imageId);
                }
            }
        }
        return this.deleteOne({ loraId });
    }

    async saveWorkspace(loraData) {
        return this.updateOne(
            { loraId: loraData.loraId },
            loraData
        );
    }
    // Clean old trainings
    async cleanOldTrainings(days) {
        const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        
        const oldTrainings = await this.findMany({
            $or: [
                { submitted: { $exists: false } },
                { initiated: { $exists: false } },
                { initiated: { $lt: threshold } },
                { submitted: { $lt: threshold } }
            ]
        });

        console.log(`[cleanOldTrainings] Found ${oldTrainings.length} trainings to clean`);

        for (const training of oldTrainings) {
            const { loraId, userId, images } = training;
            
            console.log(`[cleanOldTrainings] Processing LoRA ${loraId} for user ${userId}`);

            // Delete associated images using existing method
            if (images) {
                for (let slotId = 0; slotId < images.length; slotId++) {
                    if (images[slotId]) {
                        try {
                            await this.deleteImageFromWorkspace(loraId, slotId);
                            console.log(`[cleanOldTrainings] Deleted image for LoRA ${loraId}, slot ${slotId}`);
                        } catch (error) {
                            console.error(`[cleanOldTrainings] Error deleting image for LoRA ${loraId}, slot ${slotId}:`, error);
                        }
                    }
                }
            }

            // Delete the training entry
            await this.deleteOne({ loraId });
            console.log(`[cleanOldTrainings] Deleted training entry for LoRA ${loraId}`);
        }

        return oldTrainings.length;
    }

    async saveImageToGridFS(fileUrl, loraId, slotId) {
        try {
            console.log('[saveImageToGridFS] Downloading file from URL:', fileUrl);
            
            // Get the image file from the URL using axios
            const response = await axios({
                method: 'GET',
                url: fileUrl,
                responseType: 'stream'
            });
    
            // Create filename for GridFS
            const filename = `lora_${loraId}_slot_${slotId}.jpg`;
            console.log('[saveImageToGridFS] Saving as:', filename);
    
            // Use the base class method to save the stream
            return await this.saveFile(filename, response.data);
        } catch (error) {
            console.error('[saveImageToGridFS] Error:', error);
            throw error;
        }
    }

    async bucketPull(fileId, loraId, slotId) {
        try {
            if (!fileId) {
                console.error('No fileId provided');
                return null;
            }

            const downloadStream = await this.getFile(fileId);
            if (!downloadStream) return null;

            // Define the local file path in the /tmp directory
            const tempFilePath = path.join('/tmp', `slot_image_${loraId}_${slotId}.jpg`);
            const writeStream = fs.createWriteStream(tempFilePath);

            // Return a promise that resolves with the file path
            return new Promise((resolve, reject) => {
                downloadStream.pipe(writeStream)
                    .on('error', (error) => {
                        console.error('Error downloading file:', error);
                        reject(error);
                    })
                    .on('finish', () => {
                        console.log(`Image for lora ${loraId}, slot ${slotId} saved to ${tempFilePath}`);
                        resolve(tempFilePath);
                    });
            });
        } catch (error) {
            console.error('Error in bucketPull:', error);
            return null;
        }
    }

    async deleteImageFromWorkspace(loraId, slotId) {
        const bucket = await this.getBucket('loraImages');  // Specify the bucket name
        const files = await bucket.find({ 
            filename: new RegExp(`_${loraId}_${slotId}`) 
        }).toArray();
    
        for (const file of files) {
            await bucket.delete(file._id);
        }
    }
    async updateLoraStatus(loraId, status) {
        try {
            const result = await this.updateOne(
                { loraId: parseInt(loraId) },
                { status: status }
            );
            return result.modifiedCount > 0 || result.upsertedCount > 0;
        } catch (error) {
            console.error('Error updating LoRA status:', error);
            return false;
        }
    }
}

module.exports = LoraDB;