const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const { dbQueue, getCachedClient, PRIORITY } = require('./utils/queue'); // Updated path
const { Readable } = require('stream');

// Global batch lock tracking
const batchLocks = new Map();

class BaseDB {
    constructor(collectionName) {
        this.collectionName = collectionName;
        this.dbName = 'noema'; // Hardcoded to noema
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
        const lockKey = `${this.dbName}.${this.collectionName}`;
        
        if (batchLocks.has(lockKey)) {
            throw new Error(`Batch operation already in progress for ${lockKey}`);
        }
        
        batchLocks.set(lockKey, Date.now());
        this.batchOperations = [];
        return this;
    }

    async executeBatch() {
        const lockKey = `${this.dbName}.${this.collectionName}`;
        
        if (!batchLocks.has(lockKey)) {
            throw new Error('No batch operation was started');
        }

        if (this.batchOperations.length === 0) {
            batchLocks.delete(lockKey);
            return [];
        }

        try {
            return await dbQueue.enqueue(() => 
                this.monitorOperation(async () => {
                    const client = await getCachedClient();
                    const collection = client.db(this.dbName).collection(this.collectionName);
                    const results = [];

                    for (const op of this.batchOperations) {
                        const result = await op(collection);
                        results.push(result);
                    }
                    return results;
                }, 'batchExecution'),
                PRIORITY.MEDIUM // Defaulting batch executions to medium priority
            );
        } finally {
            // Clean up the lock and batch operations
            batchLocks.delete(lockKey);
            this.batchOperations = [];
        }
    }

    // Basic Operations
    async findOne(filter, options = {}, priority = PRIORITY.HIGH, session = null) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            const findOptions = session ? { ...options, session } : options;
            return collection.findOne(filter, findOptions);
        }, priority);
    }

    async findMany(filter = {}, options = {}, priority = PRIORITY.HIGH, session = null) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            const findOptions = session ? { ...options, session } : options;
            const cursor = collection.find(filter, findOptions);
            return cursor.toArray();
        }, priority);
    }

    async aggregate(pipeline, options = {}, priority = PRIORITY.HIGH, session = null) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            const aggregateOptions = session ? { ...options, session } : options;
            const cursor = collection.aggregate(pipeline, aggregateOptions);
            return cursor.toArray();
        }, priority);
    }

    async insertOne(document, batch = false, priority = PRIORITY.HIGH, session = null) {
        const validatedDoc = this.validateData(document);
        
        const operation = async (collection) => 
            collection.insertOne(validatedDoc, { session });

        if (batch) {
            this.batchOperations.push(operation);
            return this;
        }

        return dbQueue.enqueue(() => 
            this.monitorOperation(async () => {
                const client = await getCachedClient();
                const collection = client.db(this.dbName).collection(this.collectionName);
                return operation(collection);
            }, 'insertOne'),
            priority
        );
    }

    async updateOne(filter, update, options = {}, batch = false, priority = PRIORITY.HIGH, session = null) {
        let updateDoc = update;
        if (!Object.keys(update).some(key => key.startsWith('$'))) {
            updateDoc = { $set: this.validateData(update) };
        } else {
            // If it is an operator doc, validate the parts that are not operators themselves if necessary
            // For example, if update is { $set: { field: value }, $push: { arrField: item } }, validate `value` and `item`
            // This part can be complex, for now, we assume operators are used correctly by the caller.
        }
        
        const operationOptions = { ...options, session };
        const operation = async (collection) => 
            collection.updateOne(filter, updateDoc, operationOptions);

        if (batch) {
            this.batchOperations.push(operation);
            return this;
        }

        return dbQueue.enqueue(() => 
            this.monitorOperation(async () => {
                const client = await getCachedClient();
                const collection = client.db(this.dbName).collection(this.collectionName);
                return operation(collection);
            }, 'updateOne'),
            priority
        );
    }

    async updateMany(filter, update, options = {}, priority = PRIORITY.HIGH, session = null) {
        let updateDoc = update;
        if (!Object.keys(update).some(key => key.startsWith('$'))) {
            updateDoc = { $set: this.validateData(update) };
        }
        const operationOptions = { ...options, session };
        return dbQueue.enqueue(() =>
            this.monitorOperation(async () => {
                const client = await getCachedClient();
                const collection = client.db(this.dbName).collection(this.collectionName);
                return collection.updateMany(filter, updateDoc, operationOptions);
            }, 'updateMany'),
            priority
        );
    }

    async deleteOne(filter, priority = PRIORITY.HIGH, session = null) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            return collection.deleteOne(filter, { session });
        }, priority);
    }

    // Common Operations using $operators - ensure these are passed to updateOne correctly
    async increment(filter, field, amount = 1, priority = PRIORITY.HIGH, session = null) {
        const updateDoc = { $inc: { [field]: amount } };
        return this.updateOne(filter, updateDoc, {}, false, priority, session);
    }

    async push(filter, field, value, priority = PRIORITY.HIGH, session = null) {
        const updateDoc = { $push: { [field]: value } };
        return this.updateOne(filter, updateDoc, {}, false, priority, session);
    }

    async pull(filter, field, value, priority = PRIORITY.HIGH, session = null) {
        const updateDoc = { $pull: { [field]: value } };
        return this.updateOne(filter, updateDoc, {}, false, priority, session);
    }

    async clearCollection(priority = PRIORITY.MEDIUM) {
        return dbQueue.enqueue(async () => {
            try {
                const client = await getCachedClient();
                const collection = client.db(this.dbName).collection(this.collectionName);
                this.logger.debug(`[BaseDB] Clearing all documents from collection: ${this.collectionName}`);
                const result = await collection.deleteMany({});
                this.logger.debug(`[BaseDB] Cleared ${result.deletedCount} documents from ${this.collectionName}.`);
                return result;
            } catch (error) {
                this.logger.error(`[BaseDB] Error clearing collection ${this.collectionName}:`, error);
                throw error;
            }
        }, priority);
    }

    // GridFS Operations
    async getBucket(bucketName = 'fs') {  // Default to 'fs' if no bucket name provided
        const client = await getCachedClient();
        return new GridFSBucket(client.db(this.dbName), {
            bucketName: bucketName
        });
    }

    async saveFileFromUrl(filename, url, priority = PRIORITY.MEDIUM) {
        return dbQueue.enqueue(async () => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch ${url}`);

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const readableStream = Readable.from(buffer);

            const bucket = await this.getBucket();
            const uploadStream = bucket.openUploadStream(filename);
            
            return new Promise((resolve, reject) => {
                readableStream.pipe(uploadStream)
                    .on('finish', () => {
                        resolve(new ObjectId(uploadStream.id));
                    })
                    .on('error', (error) => {
                        console.error('Error saving from URL to GridFS:', error);
                        reject(error);
                    });
            });
        }, priority);
    }

    async saveFile(filename, stream, priority = PRIORITY.MEDIUM) {
        return dbQueue.enqueue(async () => {
            const bucket = await this.getBucket();
            const uploadStream = bucket.openUploadStream(filename);
            
            return new Promise((resolve, reject) => {
                stream.pipe(uploadStream)
                    .on('finish', () => {
                        resolve(new ObjectId(uploadStream.id));
                    })
                    .on('error', (error) => {
                        console.error('Error saving to GridFS:', error);
                        reject(error);
                    });
            });
        }, priority);
    }

    async getFile(fileId, priority = PRIORITY.HIGH) {
        return dbQueue.enqueue(async () => {
            const bucket = await this.getBucket();
            try {
                const objectId = typeof fileId === 'string' ? new ObjectId(fileId) : fileId;
                return bucket.openDownloadStream(objectId);
            } catch (error) {
                // swallow – caller expects null on missing file
                return null;
            }
        }, priority);
    }

    // Utility Methods
    async exists(filter, priority = PRIORITY.HIGH) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            const doc = await collection.findOne(filter, { projection: { _id: 1 } });
            return !!doc;
        }, priority);
    }

    async count(filter = {}, priority = PRIORITY.MEDIUM) {
        return dbQueue.enqueue(async () => {
            const client = await getCachedClient();
            const collection = client.db(this.dbName).collection(this.collectionName);
            return collection.countDocuments(filter);
        }, priority);
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

    /**
     * Starts a MongoDB session for transaction support.
     * @returns {Promise<ClientSession>} The MongoDB session
     */
    async startSession() {
        const client = await getCachedClient();
        return client.startSession();
    }

    /**
     * Executes operations within a MongoDB transaction.
     * Automatically commits on success or aborts on error.
     * @param {Function} callback - Async function that receives the session and should perform operations
     * @param {object} options - Transaction options
     * @param {number} options.maxCommitTimeMS - Maximum commit time in milliseconds
     * @param {object} options.readConcern - Read concern for the transaction
     * @param {object} options.writeConcern - Write concern for the transaction
     * @returns {Promise<any>} The result of the callback
     */
    async withTransaction(callback, options = {}) {
        const session = await this.startSession();
        
        try {
            let result;
            await session.withTransaction(async () => {
                result = await callback(session);
            }, options);
            
            return result;
        } catch (error) {
            this.errors.push({
                type: 'transaction',
                collection: this.collectionName,
                timestamp: new Date(),
                error: error.message,
                stack: error.stack
            });
            throw error;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Helper method to get collection with optional session for transaction support.
     * @param {ClientSession} session - Optional MongoDB session
     * @returns {Promise<Collection>} MongoDB collection
     */
    async getCollection(session = null) {
        const client = await getCachedClient();
        const collection = client.db(this.dbName).collection(this.collectionName);
        return collection;
    }
}

module.exports = { BaseDB, ObjectId }; // Export ObjectId for convenience 
