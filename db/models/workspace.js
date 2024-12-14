const { BaseDB } = require('./BaseDB');
const fs = require('fs');
const path = require('path');
const { GridFSBucket, ObjectId } = require('mongodb');

class LoraDB extends BaseDB {
    constructor() {
        super('loras');
        this.bucket = null;
    }

    async initBucket(db) {
        this.bucket = new GridFSBucket(db, {
            bucketName: 'loraImages'
        });
    }

    async createTraining(loraData) {
        return this.insertOne(loraData);
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

    async saveImageToGridFS(userId, loraId, slotId, imagePath) {
        if (!this.bucket) throw new Error('Bucket not initialized');

        const filename = `${userId}_${loraId}_${slotId}${path.extname(imagePath)}`;
        const uploadStream = this.bucket.openUploadStream(filename);

        return new Promise((resolve, reject) => {
            fs.createReadStream(imagePath)
                .pipe(uploadStream)
                .on('error', reject)
                .on('finish', () => resolve(uploadStream.id));
        });
    }

    async bucketPull(userId, loraId, slotId) {
        if (!this.bucket) throw new Error('Bucket not initialized');

        const files = await this.bucket.find({ 
            filename: new RegExp(`^${userId}_${loraId}_${slotId}`) 
        }).toArray();

        if (!files.length) return null;

        const tempPath = path.join('/tmp', `temp_${Date.now()}${path.extname(files[0].filename)}`);
        const downloadStream = this.bucket.openDownloadStream(files[0]._id);

        return new Promise((resolve, reject) => {
            const writeStream = fs.createWriteStream(tempPath);
            downloadStream
                .pipe(writeStream)
                .on('error', reject)
                .on('finish', () => resolve(tempPath));
        });
    }

    async deleteImageFromWorkspace(loraId, slotId) {
        if (!this.bucket) throw new Error('Bucket not initialized');

        const files = await this.bucket.find({ 
            filename: new RegExp(`_${loraId}_${slotId}`) 
        }).toArray();

        for (const file of files) {
            await this.bucket.delete(file._id);
        }
    }
}

module.exports = LoraDB;