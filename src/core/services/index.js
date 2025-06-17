/**
 * Core Services Index
 * 
 * Exports all core services for easy importing
 */

const { ToolRegistry } = require('../tools/ToolRegistry.js');
const { getUserSettingsService } = require('./userSettingsService');
const OpenAIService = require('./openai/openaiService');

const ComfyUIService = require('./comfydeploy/comfyui');
const PointsService = require('./points');
const WorkflowsService = require('./comfydeploy/workflows');
const MediaService = require('./media');
const SessionService = require('./session');
const SpellsService = require('./SpellsService');
const WorkflowExecutionService = require('./WorkflowExecutionService.js');
const dbService = require('./db');
const { initializeAPI } = require('../../api');
const loraResolutionService = require('./loraResolutionService');

/**
 * Initialize all core services
 * @param {Object} options - Configuration options
 * @returns {Object} - Initialized services
 */
async function initializeServices(options = {}) {
  const logger = options.logger || console;
  const appStartTime = new Date();
  
  // Initialize ToolRegistry Singleton
  const toolRegistry = ToolRegistry.getInstance();
  toolRegistry.loadStaticTools(); // Load hardcoded tools
  logger.info('ToolRegistry initialized.');
  
  // DIAGNOSTIC LOGGING REMOVED
  
  try {
    logger.info('Initializing core services...');
    
    // Initialize services with proper dependencies
    const sessionService = new SessionService({ logger });
    const mediaService = new MediaService({ 
      logger,
      tempDir: options.mediaConfig?.tempDir,
      storageDir: options.mediaConfig?.storageDir
    });
    const pointsService = new PointsService({ logger });
    const comfyUIService = new ComfyUIService({ logger });
    const openAIService = new OpenAIService({ logger });
    
    // Create a compatible logger for WorkflowsService if needed
    // The WorkflowsService expects logger to be a function, but we want to use logger.info method
    const workflowsLogger = {
      info: (message) => logger.info(message),
      warn: (message) => logger.warn ? logger.warn(message) : logger.info(`WARN: ${message}`),
      error: (message) => logger.error ? logger.error(message) : logger.info(`ERROR: ${message}`),
      debug: (message, ...args) => logger.debug ? logger.debug(message, ...args) : logger.info(`DEBUG: ${message}`, ...args)
    };
    
    const workflowsService = new WorkflowsService({ 
      logger: workflowsLogger
    });
    
    // Initialize Database Services with Logger
    if (!dbService || typeof dbService.initializeDbServices !== 'function') {
      logger.error('Failed to initialize DB services: initializeDbServices function not found in db module.');
      throw new Error('DB service initialization function not found.');
    }
    const initializedDbServices = dbService.initializeDbServices(logger);
    logger.info('Database services initialized.');

    // Initialize API services
    const apiServices = initializeAPI({
      logger, 
      appStartTime,
      version: options.version,
      db: initializedDbServices, // Pass the INSTANTIATED services
      toolRegistry, // Pass toolRegistry to API initialization
      openai: openAIService // Pass the newly instantiated openai service
    });
    
    // Initialize UserSettingsService after API client and toolRegistry are available
    const userSettingsService = getUserSettingsService({ 
      logger, 
      toolRegistry, 
      internalApiClient: apiServices.internal?.client 
    });
    logger.info('UserSettingsService initialized globally in core services.');
    
    // Initialize WorkflowExecutionService
    const workflowExecutionService = new WorkflowExecutionService({
      logger,
      toolRegistry,
      comfyUIService: comfyUIService,
      internalApiClient: apiServices.internal?.client,
      db: initializedDbServices.data,
      workflowsService: workflowsService,
    });
    logger.info('WorkflowExecutionService initialized.');

    // Initialize SpellsService
    const spellsService = new SpellsService({
      logger,
      db: initializedDbServices.data,
      workflowExecutionService,
      spellPermissionsDb: initializedDbServices.data.spellPermissions,
    });
    logger.info('SpellsService initialized.');

    logger.info('Core services created successfully');
    
    const returnedServices = {
      session: sessionService,
      media: mediaService,
      points: pointsService,
      comfyUI: comfyUIService,
      workflows: workflowsService,
      openai: openAIService,
      db: initializedDbServices, // Return the INSTANTIATED services
      internal: apiServices.internal, // This contains router, status
      userSettingsService, // Added userSettingsService
      spellsService, // Added spellsService
      workflowExecutionService, // Added workflowExecutionService
      logger,
      appStartTime,
      toolRegistry, // geniusoverhaul: Added toolRegistry to returned services
      loraResolutionService
    };

    // DIAGNOSTIC LOGGING REMOVED

    // Return instantiated services
    return returnedServices;
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    throw error;
  }
}

module.exports = {
  ComfyUIService,
  PointsService,
  WorkflowsService,
  MediaService,
  SessionService,
  SpellsService,
  OpenAIService,
  WorkflowExecutionService,
  initializeServices,
  ToolRegistry // geniusoverhaul: Export ToolRegistry for access if needed elsewhere
}; 