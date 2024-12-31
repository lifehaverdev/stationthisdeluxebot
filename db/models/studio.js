const { BaseDB } = require('./BaseDB');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { GridFSBucket } = require('mongodb');

class StudioDB extends BaseDB {
    constructor() {
        super('studio');
    }

    // Save a generated piece and its image
    async savePiece(collectionId, pieceData) {
        try {
            // First save the image to GridFS
            const imageId = await this.saveImageToGridFS(
                pieceData.providerImageUrl,
                collectionId,
                pieceData.timestamp || Date.now()
            );

            // Prepare the piece document
            const pieceDocument = {
                collectionId,
                imageId,                    // GridFS object id
                providerImageUrl,           // Original URL from provider
                traits: pieceData.traits,   // Trait information
                prompt: pieceData.prompt,   // Text prompt used
                promptObj: pieceData.promptObj, // Full prompt object from request
                status: 'pending_review',   // pending_review, approved, rejected
                version: 1,                 // Initial version
                timestamp: Date.now(),
                history: []                 // Track regeneration history
            };

            return this.insertOne(pieceDocument);
        } catch (error) {
            console.error('Error saving piece:', error);
            throw error;
        }
    }

    // Save image to GridFS bucket
    async saveImageToGridFS(imageUrl, collectionId, timestamp) {
        try {
            console.log('[saveImageToGridFS] Downloading file from URL:', imageUrl);
            
            const response = await axios({
                method: 'GET',
                url: imageUrl,
                responseType: 'stream'
            });
    
            // Create unique filename using timestamp
            const filename = `collection_${collectionId}_${timestamp}.jpg`;
            console.log('[saveImageToGridFS] Saving as:', filename);
    
            return await this.saveFile(filename, response.data);
        } catch (error) {
            console.error('[saveImageToGridFS] Error:', error);
            throw error;
        }
    }

    async saveGenerationResult(urls, promptObj, task) {
        try {
            // 1. Save files to MongoDB bucket
            const bucket = new GridFSBucket(db);
            const savedFiles = await Promise.all(urls.map(async ({ url, type }) => {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to fetch ${url}`);
                
                const filename = `collection_${promptObj.collectionId}_${Date.now()}.${type}`;
                const uploadStream = bucket.openUploadStream(filename);
                
                await new Promise((resolve, reject) => {
                    response.body.pipe(uploadStream)
                        .on('finish', resolve)
                        .on('error', reject);
                });

                return {
                    fileId: uploadStream.id,
                    type,
                    originalUrl: url
                };
            }));

            // 2. Create studio document
            const studioDoc = {
                collectionId: promptObj.collectionId,
                files: savedFiles,
                task: task,
                createdAt: new Date(),
                traits: promptObj.traits
            };

            await this.insertOne(studioDoc);
            return { success: true, studioDoc };

        } catch (error) {
            console.error('Error saving generation result:', error);
            return { success: false, error };
        }
    }

    // Mark piece for regeneration
    async markForRegeneration(collectionId, pieceId) {
        const piece = await this.findOne({ _id: pieceId, collectionId });
        if (!piece) return null;

        // Add current version to history
        const historyEntry = {
            version: piece.version,
            imageId: piece.imageId,
            prompt: piece.prompt,
            promptObj: piece.promptObj,
            traits: piece.traits,
            timestamp: piece.timestamp
        };

        // Update the piece
        return this.updateOne(
            { _id: pieceId },
            {
                $set: {
                    status: 'pending_regeneration',
                    version: piece.version + 1
                },
                $push: { history: historyEntry }
            }
        );
    }

    // Get collection pieces by status
    async getCollectionPieces(collectionId, status = null) {
        const query = { collectionId };
        if (status) {
            query.status = status;
        }
        return this.findMany(query);
    }

    // Get collection statistics
    async getCollectionStats(collectionId) {
        const stats = await this.aggregate([
            { $match: { collectionId } },
            { 
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalVersions: { $sum: '$version' }
                }
            }
        ]);

        return stats.reduce((acc, stat) => {
            acc[stat._id] = {
                count: stat.count,
                totalVersions: stat.totalVersions
            };
            return acc;
        }, {
            pending_review: { count: 0, totalVersions: 0 },
            approved: { count: 0, totalVersions: 0 },
            rejected: { count: 0, totalVersions: 0 },
            pending_regeneration: { count: 0, totalVersions: 0 }
        });
    }

    // Update piece status
    async updatePieceStatus(collectionId, pieceId, status) {
        return this.updateOne(
            { _id: pieceId, collectionId },
            { $set: { status, statusUpdatedAt: Date.now() } }
        );
    }

    // Get next piece for review
    async getNextPendingPiece(collectionId) {
        return this.findOne(
            {
                collectionId,
                status: 'pending_review'
            },
            {
                sort: { timestamp: 1 } // Review oldest first
            }
        );
    }
}

module.exports = StudioDB;