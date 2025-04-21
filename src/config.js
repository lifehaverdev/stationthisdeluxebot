const { Logger } = require('./utils/logger');
const { MongoDbRepository } = require('./db/repositories/mongoDbRepository');

// Set up logger
const logger = new Logger({
  level: process.env.LOG_LEVEL || 'info',
  name: 'config'
});

// Configure MongoDB
const mongoConfig = {
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/station-this-deluxe-bot',
  options: {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000,
  },
  logger: logger,
};

const mongoRepository = new MongoDbRepository(mongoConfig); 