/**
 * Database Queue Utility
 * 
 * Manages database operation queuing and client caching
 */

const { MongoClient } = require('mongodb');
//const { logThis } = require('../../utils/utils');
require('dotenv').config();

// Import our custom logger
const { createLogger } = require('../../../../utils/logger');
const logger = createLogger('db-queue');

const JOB_TIMEOUT = 300000; // 30 seconds

const PRIORITY = {
    CRITICAL: 0,    // User payments, wallet operations
    HIGH: 1,        // Generations, user state changes
    MEDIUM: 2,      // Settings updates, group operations
    LOW: 3          // Analytics, metrics, stats
};

let cachedClient = null;
let connectionInProgress = null;

class DatabaseQueue {
    constructor() {
        this.processing = false;
        this.priorityQueues = {
            [PRIORITY.CRITICAL]: [],
            [PRIORITY.HIGH]: [],
            [PRIORITY.MEDIUM]: [],
            [PRIORITY.LOW]: []
        };
        this.batchSize = 50;
        this.batchTimeout = 5000;
        this.lowPriorityBatch = [];
        this.batchTimer = null;
    }

    enqueue(job, priority = PRIORITY.HIGH) {
        return new Promise((resolve, reject) => {
            const wrappedJob = async () => {
                try {
                    const result = await Promise.race([
                        job(),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Job timeout')), JOB_TIMEOUT)
                        )
                    ]);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };

            if (priority === PRIORITY.LOW) {
                this.enqueueLowPriority(wrappedJob);
            } else {
                this.priorityQueues[priority].push(wrappedJob);
                this.processNext();
            }
        });
    }

    enqueueLowPriority(job) {
        this.lowPriorityBatch.push(job);
        
        if (this.lowPriorityBatch.length >= this.batchSize) {
            this.processBatch();
        } else if (!this.batchTimer) {
            this.batchTimer = setTimeout(() => this.processBatch(), this.batchTimeout);
        }
    }

    async processBatch() {
        if (this.lowPriorityBatch.length === 0) return;
        
        clearTimeout(this.batchTimer);
        this.batchTimer = null;

        const batch = this.lowPriorityBatch;
        this.lowPriorityBatch = [];

        // Only process batch if no higher priority operations are pending
        if (Object.entries(this.priorityQueues)
            .filter(([key]) => key < PRIORITY.LOW)
            .every(([_, queue]) => queue.length === 0)) {
            
            const batchJob = async () => {
                for (const job of batch) {
                    try {
                        await job();
                    } catch (error) {
                        logger.error('Error processing batch job:', error);
                    }
                }
            };
            
            this.priorityQueues[PRIORITY.MEDIUM].push(batchJob);
            this.processNext();
        } else {
            // Requeue the batch if higher priority jobs exist
            this.lowPriorityBatch = [...batch, ...this.lowPriorityBatch];
            this.batchTimer = setTimeout(() => this.processBatch(), this.batchTimeout);
        }
    }

    async processNext() {
        if (this.processing) return;
        
        this.processing = true;
        
        try {
            // Process queues in priority order
            for (const priority of Object.keys(this.priorityQueues).sort()) {
                while (this.priorityQueues[priority].length > 0) {
                    const job = this.priorityQueues[priority].shift();
                    await job();
                }
            }
        } finally {
            this.processing = false;
            
            // Check if there are more jobs to process
            if (Object.values(this.priorityQueues).some(queue => queue.length > 0)) {
                this.processNext();
            }
        }
    }
}

/**
 * Get a cached MongoDB client or create a new one
 * @returns {Promise<MongoClient>} MongoDB client
 */
async function getCachedClient() {
    logger.debug('[getCachedClient] Called');

    if (connectionInProgress) {
        logger.debug('[getCachedClient] Connection in progress. Awaiting current connection...');
        await connectionInProgress;
        return cachedClient;
    }

    if (!cachedClient) {
        logger.info('[getCachedClient] No cached client found. Initiating new connection...');
        
        connectionInProgress = (async () => {
            // Use MONGO_PASS environment variable instead of MONGODB_URI
            const uri = process.env.MONGO_PASS || process.env.MONGODB_URI || 'mongodb://localhost:27017';
            //logger.info('[getCachedClient] Connecting to MongoDB with URI:', { uri: uri.replace(/mongodb\+srv:\/\/[^:]+:[^@]+@/, 'mongodb+srv://[hidden]:[hidden]@') });
            cachedClient = new MongoClient(uri);
            logger.debug('[getCachedClient] New MongoClient instance created.');

            try {
                await cachedClient.connect();
                logger.info('[getCachedClient] MongoClient connected successfully.');
            } catch (error) {
                logger.error('[getCachedClient] Error connecting MongoClient:', error);
                cachedClient = null;
                throw error;
            } finally {
                connectionInProgress = null;
            }
        })();

        await connectionInProgress;
    } else if (!cachedClient.topology || !cachedClient.topology.isConnected()) {
        logger.info('[getCachedClient] Cached client found, but not connected. Attempting reconnection...');

        connectionInProgress = (async () => {
            try {
                await cachedClient.connect();
                logger.info('[getCachedClient] Reconnected MongoClient successfully.');
            } catch (error) {
                logger.error('[getCachedClient] Error reconnecting MongoClient:', error);
                cachedClient = null;
                throw error;
            } finally {
                connectionInProgress = null;
            }
        })();

        await connectionInProgress;
    }

    logger.debug('[getCachedClient] Returning cached client.');
    return cachedClient;
}

// Create a singleton instance
const dbQueue = new DatabaseQueue();

module.exports = {
    dbQueue,
    getCachedClient,
    PRIORITY
}; 