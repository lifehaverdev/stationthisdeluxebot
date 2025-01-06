const { BaseDB } = require('./BaseDB');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { GridFSBucket, ObjectId } = require('mongodb');

class StudioDB extends BaseDB {
    constructor() {
        super('studio');
    }

    async saveGenerationResult(urls, task) {
        try {
            // Calculate points if available from task
            const pointsSpent = task.pointsToAdd || 
                ((task.runningStop - task.runningStart) / 1000) * (task.rate || 1);

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
                    duration: task.runningStop - task.runningStart,
                    rate: task.rate || 1,
                    pointsSpent: task.pointsSpent
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
            try {
                // Get all pieces for this collection
                const pieces = await this.findMany({ collectionId });
                
                // Calculate stats
                const stats = {
                    total: pieces.length,
                    approved: pieces.filter(p => p.status === 'approved').length,
                    rejected: pieces.filter(p => p.status === 'rejected').length,
                    reviewed: pieces.filter(p => ['approved', 'rejected'].includes(p.status)).length,
                    // TODO: Add average cost calculation once we implement cost tracking
                    // averageCost: pieces.reduce((sum, p) => sum + (p.cost || 0), 0) / pieces.length
                };
    
                console.log('Collection stats calculated:', {
                    collectionId,
                    ...stats
                });
    
                return stats;
    
            } catch (error) {
                console.error('Error getting collection stats:', {
                    error: error.message,
                    collectionId
                });
                throw error;
            }
        }
    
        // TODO: Update studio document structure to include cost
        // When implementing cost tracking, add these fields to the document:
        // cost: Number,          // Points spent on this generation
        // timestamp: Date        // When the cost was incurred

    // Update piece status
    async updatePieceStatus(collectionId, pieceId, status) {
        // console.log('Updating piece status:', {
        //     pieceId,
        //     collectionId,
        //     newStatus: status,
        //     timestamp: new Date().toISOString()
        // });

        try {
            // Convert string ID to ObjectId
            const objectId = new ObjectId(pieceId);
            const numericCollectionId = parseInt(collectionId);
            
            const result = await this.updateOne(
                { _id: objectId, collectionId: numericCollectionId },
                { status, statusUpdatedAt: new Date() }  // Remove $set since BaseDB adds it
            );

            // console.log('Update result:', {
            //     matchedCount: result.matchedCount,
            //     modifiedCount: result.modifiedCount,
            //     upsertedCount: result.upsertedCount
            // });

            if (result.matchedCount === 0) {
                console.warn('No document found matching criteria:', {
                    pieceId,
                    collectionId: numericCollectionId
                });
            }

            return result;
        } catch (error) {
            console.error('Error updating piece status:', {
                error: error.message,
                pieceId,
                collectionId,
                status
            });
            throw error;
        }
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