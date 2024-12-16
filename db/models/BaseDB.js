const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const { dbQueue, getCachedClient } = require('../utils/queue');
class BaseDB {
    constructor(collectionName) {
        this.collectionName = collectionName;
        this.dbName = process.env.BOT_NAME;
        this.batchOperations = [];

        // Add operation monitoring
        this.operationCount = 0;
        this.lastOperation = null;
        this.errors = [];
    }

    // Validation helper
    validateData(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid data: must be an object');
        }

        // Remove undefined/null values
        Object.keys(data).forEach(key => {
            if (data[key] === undefined || data[key] === null) {
                delete data[key];
            }
        });

        return data;
    }

    // Monitor wrapper
    async monitorOperation(operation, type) {
        const startTime = Date.now();
        try {
            const result = await operation();
            
            this.lastOperation = {
                type,
                collection: this.collectionName,
                timestamp: new Date(),
                duration: Date.now() - startTime,
                success: true
            };
            
            this.operationCount++;
            return result;
        } catch (error) {
            const errorLog = {
                type,
                collection: this.collectionName,
                timestamp: new Date(),
                duration: Date.now() - startTime,
                error: error.message,
                stack: error.stack
            };
            
            this.errors.push(errorLog);
            console.error(`DB Operation Error [${type}]:`, errorLog);
            throw error;
        }
    }

    // Batch Operations
    startBatch() {
        this.batchOperations = [];
        return this;
    }

    async executeBatch() {
        if (this.batchOperations.length === 0) return [];

        return dbQueue.enqueue(() => 
            this.monitorOperation(async () => {
                const client = await getCachedClient();
                const collection = client.db(this.dbName).collection(this.collectionName);
                const results = [];

                try {
                    for (const op of this.batchOperations) {
                        const result = await op(collection);
                        results.push(result);
                    }
                    return results;
                } finally {
                    this.batchOperations = [];
                }
            }, 'batchExecution')
        );
    }

    // Basic Operations
    async findOne(filter) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            return collection.findOne(filter);
        });
    }

    async findMany(filter = {}) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            return collection.find(filter).toArray();
        });
    }

    async updateOne(filter, update, options = {}, batch = false) {
        const validatedUpdate = this.validateData(update);
        
        const operation = async (collection) => 
            collection.updateOne(filter, { $set: validatedUpdate }, options);

        if (batch) {
            this.batchOperations.push(operation);
            return this;
        }

        return dbQueue.enqueue(() => 
            this.monitorOperation(async () => {
                const client = await getCachedClient();
                const collection = client.db(this.dbName).collection(this.collectionName);
                return operation(collection);
            }, 'updateOne')
        );
    }

    async deleteOne(filter) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            return collection.deleteOne(filter);
        });
    }

    // Common Operations
    async increment(filter, field, amount = 1) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            return collection.updateOne(
                filter,
                { $inc: { [field]: amount } }
            );
        });
    }

    async push(filter, field, value) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            return collection.updateOne(
                filter,
                { $push: { [field]: value } }
            );
        });
    }

    async pull(filter, field, value) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            return collection.updateOne(
                filter,
                { $pull: { [field]: value } }
            );
        });
    }

    // GridFS Operations
    async getBucket(bucketName = 'fs') {  // Default to 'fs' if no bucket name provided
        const client = await getCachedClient();
        return new GridFSBucket(client.db(this.dbName), {
            bucketName: bucketName
        });
    }

    async saveFile(filename, stream) {
        return dbQueue.enqueue(async () => {
            const bucket = await this.getBucket();
            const uploadStream = bucket.openUploadStream(filename);
            
            // Pipe the stream and return a promise that resolves with the ObjectId
            return new Promise((resolve, reject) => {
                stream.pipe(uploadStream)
                    .on('finish', () => {
                        console.log(`File ${filename} saved to GridFS with id:`, uploadStream.id.toString());
                        resolve(new ObjectId(uploadStream.id));  // Return actual ObjectId instance
                    })
                    .on('error', (error) => {
                        console.error('Error saving to GridFS:', error);
                        reject(error);
                    });
            });
        });
    }

    async getFile(fileId) {
        return dbQueue.enqueue(async () => {
            const bucket = await this.getBucket();
            try {
                // Convert string to ObjectId if needed
                const objectId = typeof fileId === 'string' ? new ObjectId(fileId) : fileId;
                return bucket.openDownloadStream(objectId);
            } catch (error) {
                console.error('Error opening download stream:', error);
                return null;
            }
        });
    }

    // Utility Methods
    async exists(filter) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            const doc = await collection.findOne(filter, { projection: { _id: 1 } });
            return !!doc;
        });
    }

    async count(filter = {}) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            return collection.countDocuments(filter);
        });
    }

    // Monitoring methods
    getOperationStats() {
        return {
            totalOperations: this.operationCount,
            lastOperation: this.lastOperation,
            errorCount: this.errors.length,
            recentErrors: this.errors.slice(-5) // Last 5 errors
        };
    }

    clearErrorLog() {
        this.errors = [];
    }
}

module.exports = {BaseDB};