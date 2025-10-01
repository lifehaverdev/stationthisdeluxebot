/**
 * Training Services Index
 * 
 * Service registry and dependency injection for the training system
 */

const TrainingOrchestrator = require('./TrainingOrchestrator');
const DockerService = require('./DockerService');
const CloudflareService = require('./CloudflareService');
const MongoService = require('./MongoService');
const TrainingRecipeService = require('./TrainingRecipeService');

/**
 * Initialize all training services
 * @param {Object} options - Configuration options
 * @returns {Object} - Initialized training services
 */
async function initializeTrainingServices(options = {}) {
  const logger = options.logger || console;
  const db = options.db;
  const storageService = options.storageService;
  const pointsService = options.pointsService;
  
  if (!db) {
    throw new Error('Database services required for training system');
  }
  if (!storageService) {
    throw new Error('StorageService required for training system');
  }
  if (!pointsService) {
    throw new Error('PointsService required for training system');
  }

  logger.info('Initializing training services...');

  try {
    // Initialize core services
    const mongoService = new MongoService({ logger, db });
    const cloudflareService = new CloudflareService({ logger, storageService });
    const dockerService = new DockerService({ logger });
    const recipeService = new TrainingRecipeService({ logger });
    
    // Initialize orchestrator with all dependencies
    const orchestrator = new TrainingOrchestrator({
      logger,
      mongoService,
      cloudflareService,
      dockerService,
      recipeService,
      pointsService
    });

    logger.info('Training services initialized successfully');

    return {
      orchestrator,
      mongoService,
      cloudflareService,
      dockerService,
      recipeService
    };
  } catch (error) {
    logger.error('Failed to initialize training services:', error);
    throw error;
  }
}

module.exports = {
  initializeTrainingServices,
  TrainingOrchestrator,
  DockerService,
  CloudflareService,
  MongoService,
  TrainingRecipeService
};
