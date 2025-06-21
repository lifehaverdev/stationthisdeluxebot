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

// Import new Alchemy/Ethereum services
const EthereumService = require('./alchemy/ethereumService');
const CreditService = require('./alchemy/creditService');
const PriceFeedService = require('./alchemy/priceFeedService');
const DexService = require('./alchemy/dexService');
const TokenRiskEngine = require('./alchemy/tokenRiskEngine');
const { contracts, getNetworkName } = require('../contracts');

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

    // --- Initialize On-Chain Services ---
    let ethereumService;
    let creditService;
    let priceFeedService;
    let dexService;
    let tokenRiskEngine;
    try {
      logger.info('Initializing on-chain services (Ethereum, Credit)...');
      // 1. Initialize EthereumService
      const ethereumConfig = {
        rpcUrl: process.env.ETHEREUM_RPC_URL,
        privateKey: process.env.ETHEREUM_SIGNER_PRIVATE_KEY,
        chainId: process.env.ETHEREUM_CHAIN_ID,
      };
      if (!ethereumConfig.rpcUrl || !ethereumConfig.privateKey) {
        logger.warn('[EthereumService] Not initialized: ETHEREUM_RPC_URL or ETHEREUM_SIGNER_PRIVATE_KEY is missing from .env. On-chain features will be disabled.');
      } else {
        ethereumService = new EthereumService(ethereumConfig, logger);

        // 2. Initialize supporting on-chain services
        priceFeedService = new PriceFeedService({ alchemyApiKey: process.env.ALCHEMY_SECRET }, logger);
        dexService = new DexService({ ethereumService }, logger);
        tokenRiskEngine = new TokenRiskEngine({ priceFeedService, dexService }, logger);

        // 3. Initialize CreditService (depends on EthereumService and supporting services)
        const networkName = getNetworkName(ethereumService.chainId);
        const creditServiceConfig = {
          creditVaultAddress: contracts.creditVault.addresses[networkName],
          creditVaultAbi: contracts.creditVault.abi,
        };
        
        if (!creditServiceConfig.creditVaultAddress || !creditServiceConfig.creditVaultAbi || creditServiceConfig.creditVaultAbi.length === 0) {
            logger.warn(`[CreditService] Not initialized: Could not find contract address or ABI for network '${networkName}'. Credit service will be disabled.`);
        } else {
            const creditServiceDependencies = {
                ethereumService,
                creditLedgerDb: initializedDbServices.data.creditLedger, // Assuming db/index wires this up
                systemStateDb: initializedDbServices.data.systemState, // Assuming db/index wires this up
                userCoreDb: initializedDbServices.data.userCore,
                userEconomyDb: initializedDbServices.data.userEconomy,
                priceFeedService: priceFeedService, // Use the real service instance
                tokenRiskEngine, // Pass the risk engine
            };
            creditService = new CreditService(creditServiceDependencies, creditServiceConfig, logger);
        }
        logger.info('On-chain services initialized.');
      }
    } catch (error) {
        logger.error('Failed to initialize on-chain services:', error);
        // Continue without on-chain features
    }
    // --- End On-Chain Services ---

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
      ethereumService, // Add new service
      creditService, // Add new service
      priceFeedService,
      dexService,
      tokenRiskEngine,
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
  ToolRegistry, // geniusoverhaul: Export ToolRegistry for access if needed elsewhere
  // Export new services
  EthereumService,
  CreditService,
  PriceFeedService,
  DexService,
  TokenRiskEngine,
}; 