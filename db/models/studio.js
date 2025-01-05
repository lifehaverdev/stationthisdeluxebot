const { BaseDB } = require('./BaseDB');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { GridFSBucket } = require('mongodb');

class StudioDB extends BaseDB {
    constructor() {
        super('studio');
    }

    async saveGenerationResult(urls, task) {
        try {
            // 1. Create studio document with all necessary information
            const studioDoc = {
                collectionId: task.promptObj.collectionId,
                userId: task.message.from.id,
                status: 'pending_review',
                files: urls.map(urlData => ({
                    url: urlData.url,
                    type: urlData.type
                })),
                prompt: task.promptObj.prompt,
                traits: task.promptObj.traits || [],
                workflow: task.promptObj.type,
                generation: {
                    timestamp: Date.now(),
                    seed: task.promptObj.input_seed,
                    cfg: task.promptObj.input_cfg,
                    checkpoint: task.promptObj.input_checkpoint,
                },
                version: 1,
                history: [],
                createdAt: new Date()
            };

            // 2. Save to database
            await this.insertOne(studioDoc);
            
            console.log('Saved generation result:', {
                collectionId: studioDoc.collectionId,
                userId: studioDoc.userId,
                timestamp: studioDoc.generation.timestamp
            });

            return { 
                success: true, 
                studioDoc 
            };

        } catch (error) {
            console.error('Error saving generation result:', error);
            return { 
                success: false, 
                error: error.message 
            };
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