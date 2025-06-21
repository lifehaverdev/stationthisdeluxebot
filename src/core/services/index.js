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
const internalApiClient = require('../../utils/internalApiClient'); // Import the singleton client

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
      
      const ethConfig = {
        rpcUrl: process.env.ETHEREUM_RPC_URL,
        chainId: process.env.ETHEREUM_CHAIN_ID,
      };

      if (!ethConfig.rpcUrl || !process.env.ETHEREUM_SIGNER_PRIVATE_KEY) {
        logger.warn('[EthereumService] Not initialized: ETHEREUM_RPC_URL or ETHEREUM_SIGNER_PRIVATE_KEY is missing from .env. On-chain features will be disabled.');
      } else {
        // 1. Initialize services with no dependencies first.
        priceFeedService = new PriceFeedService({ alchemyApiKey: process.env.ALCHEMY_SECRET }, logger);

        // 2. Initialize EthereumService, which now requires priceFeedService for gas estimates.
        const ethereumServiceDependencies = { priceFeedService };
        ethereumService = new EthereumService(ethConfig, ethereumServiceDependencies, logger);

        // 3. Initialize remaining services that depend on the above.
        dexService = new DexService({ ethereumService }, logger);
        tokenRiskEngine = new TokenRiskEngine({ priceFeedService, dexService }, logger);

        // 4. Initialize CreditService
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
                creditLedgerDb: initializedDbServices.data.creditLedger,
                systemStateDb: initializedDbServices.data.systemState,
                priceFeedService, // Pass the price feed service
                tokenRiskEngine,
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

    // Initialize UserSettingsService before the API so it can be injected.
    const userSettingsService = getUserSettingsService({
      logger,
      toolRegistry,
      internalApiClient // Use the directly imported singleton
    });
    logger.info('UserSettingsService initialized globally in core services.');

    // Initialize API services, now with userSettingsService
    const apiServices = initializeAPI({
      logger,
      appStartTime,
      version: options.version,
      db: initializedDbServices,
      toolRegistry,
      openai: openAIService,
      userSettingsService // Pass the service to the API layer
    });
    
    // The internalApiClient is a singleton utility, not from apiServices.
    // The old logic to extract it from apiServices is removed.
    
    // Initialize WorkflowExecutionService
    const workflowExecutionService = new WorkflowExecutionService({
      logger,
      toolRegistry,
      comfyUIService: comfyUIService,
      internalApiClient: apiServices.internal?.client,
      db: initializedDbServices.data,
      workflowsService: workflowsService,
      userSettingsService, // Added userSettingsService
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