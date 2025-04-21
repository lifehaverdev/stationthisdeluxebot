/**
 * Database connection and repository initialization module
 * 
 * Initializes MongoDB connection and creates repository instances
 */

const { MongoClient } = require('mongodb');
const { MongoDbRepository } = require('./repositories/mongoDbRepository');
const { WorkflowRepository } = require('./repositories/workflowRepository');
const { OpenAiRepository } = require('./repositories/openAiRepository');
const { ChatMessageRepository } = require('./repositories/chatMessageRepository');
const { Logger } = require('../utils/logger');

// Create logger instance
const appLogger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'db'
});

let mongoDb;
let workflowRepository;
let openAiRepository;
let chatMessageRepository;

/**
 * Initialize database connection and repositories
 * 
 * @param {Object} options Connection and configuration options
 * @param {Object} options.config Application configuration
 * @param {Object} options.logger Logger instance
 * @returns {Object} Repository instances
 */
const initialize = async ({ config, logger }) => {
  try {
    const mongoConfig = config.mongodb || {};
    const connectionString = mongoConfig.connectionString || process.env.MONGODB_CONNECTION_STRING;
    
    logger.info('Initializing MongoDB connection', { 
      host: new URL(connectionString).hostname,
      dbName: mongoConfig.dbName || 'station-this-deluxe-bot',
      options: mongoConfig.options || {}
    });

    // Keep track of connection attempt start time
    const startTime = Date.now();

    // Initialize MongoDB repository
    mongoDb = new MongoDbRepository({
      uri: connectionString,
      options: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        dbName: process.env.BOT_NAME || mongoConfig.dbName || 'station-this-deluxe-bot',
        ...mongoConfig.options || {}
      },
      logger: logger || appLogger
    });

    // Connect to MongoDB
    await mongoDb.connect();
    
    const connectionTime = Date.now() - startTime;
    logger.info(`MongoDB connection established successfully in ${connectionTime}ms`, {
      connectionTime,
      isConnected: mongoDb.isConnected(),
      client: !!mongoDb.client
    });

    // Initialize repositories
    workflowRepository = new WorkflowRepository({ db: mongoDb, logger });
    openAiRepository = new OpenAiRepository({ db: mongoDb, logger });
    chatMessageRepository = new ChatMessageRepository({ db: mongoDb, logger });
    
    // Verify collections exist
    try {
      const db = await mongoDb.db();
      const collections = await db.listCollections().toArray();
      logger.info('Available collections in database:', {
        collections: collections.map(c => c.name),
        count: collections.length
      });
    } catch (err) {
      logger.error('Failed to list collections:', {
        error: err.message,
        stack: err.stack
      });
    }

    return {
      mongoDb,
      workflowRepository,
      openAiRepository,
      chatMessageRepository
    };
  } catch (error) {
    logger.error('Failed to initialize MongoDB:', {
      error: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name
    });
    throw error;
  }
};

module.exports = {
  initialize,
  
  // Export repositories for direct access
  getMongoDb: () => mongoDb,
  getWorkflowRepository: () => workflowRepository,
  getOpenAiRepository: () => openAiRepository,
  getChatMessageRepository: () => chatMessageRepository
}; 