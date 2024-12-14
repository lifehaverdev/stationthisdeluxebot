const { MongoClient } = require('mongodb');
const { logThis } = require('../../utils/utils');

const LOG_DB_QUEUE = 'db_queue';
const LOG_CLIENT = 'client';
const LOG_CONNECTION = 'connection';
const JOB_TIMEOUT = 30000; // 30 seconds

let cachedClient = null;
let connectionInProgress = null;

class DatabaseQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
    }

    enqueue(job) {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
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
            });

            this.processNext();
        });
    }

    async processNext() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        const job = this.queue.shift();
        
        try {
            logThis(LOG_DB_QUEUE, '[DatabaseQueue] Processing job...');
            await job();
        } catch (error) {
            console.error('[DatabaseQueue] Error processing job:', error);
        } finally {
            this.processing = false;
            this.processNext();
        }
    }
}

async function getCachedClient() {
    logThis(LOG_CLIENT, '[getCachedClient] Called');

    if (connectionInProgress) {
        logThis(LOG_CONNECTION, '[getCachedClient] Connection in progress. Awaiting current connection...');
        await connectionInProgress;
        return cachedClient;
    }

    if (!cachedClient) {
        logThis(LOG_CONNECTION, '[getCachedClient] No cached client found. Initiating new connection...');
        
        connectionInProgress = (async () => {
            cachedClient = new MongoClient(process.env.MONGO_PASS);
            logThis(LOG_CLIENT, '[getCachedClient] New MongoClient instance created.');

            try {
                await cachedClient.connect();
                logThis(LOG_CONNECTION, '[getCachedClient] MongoClient connected successfully.');
            } catch (error) {
                console.error('[getCachedClient] Error connecting MongoClient:', error);
                cachedClient = null;
                throw error;
            } finally {
                connectionInProgress = null;
            }
        })();

        try {
            await connectionInProgress;
        } catch (error) {
            console.error('[getCachedClient] Failed to complete new connection:', error);
            throw error;
        }
    } else if (!cachedClient.topology || !cachedClient.topology.isConnected()) {
        logThis(LOG_CONNECTION, '[getCachedClient] Cached client found, but not connected. Attempting reconnection...');

        connectionInProgress = (async () => {
            try {
                await cachedClient.connect();
                logThis(LOG_CONNECTION, '[getCachedClient] Reconnected MongoClient successfully.');
            } catch (error) {
                console.error('[getCachedClient] Error reconnecting MongoClient:', error);
                cachedClient = null;
                throw error;
            } finally {
                connectionInProgress = null;
            }
        })();

        try {
            await connectionInProgress;
        } catch (error) {
            console.error('[getCachedClient] Failed to complete reconnection:', error);
            throw error;
        }
    }

    logThis(LOG_CLIENT, '[getCachedClient] Returning cached client.');
    return cachedClient;
}

const dbQueue = new DatabaseQueue();

module.exports = {
    dbQueue,
    getCachedClient
};
