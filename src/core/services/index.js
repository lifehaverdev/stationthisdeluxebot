/**
 * Core Services Index
 * 
 * Exports all core services for easy importing
 */

const { ToolRegistry } = require('../tools/ToolRegistry.js');
const { getUserSettingsService } = require('./userSettingsService');
const OpenAIService = require('./openai/openaiService');
const HuggingFaceService = require('./huggingface/huggingfaceService');

const ComfyUIService = require('./comfydeploy/comfyui');
const PointsService = require('./points');
const WorkflowsService = require('./comfydeploy/workflows');
const MediaService = require('./media');
const SpellsService = require('./SpellsService');
const WorkflowExecutionService = require('./WorkflowExecutionService.js');
const dbService = require('./db');
const { initializeAPI } = require('../../api');
const loraResolutionService = require('./loraResolutionService');
const internalApiClient = require('../../utils/internalApiClient'); // Import the singleton client
const { longRunningApiClient } = require('../../utils/internalApiClient'); // Import the long-running client

// Import new StorageService
const StorageService = require('./storageService');

// Import new Alchemy/Ethereum services
const EthereumService = require('./alchemy/ethereumService');
const CreditService = require('./alchemy/creditService');
const PriceFeedService = require('./alchemy/priceFeedService');
const NftPriceService = require('./alchemy/nftPriceService');
const DexService = require('./alchemy/dexService');
const TokenRiskEngine = require('./alchemy/tokenRiskEngine');
const { contracts, getNetworkName } = require('../contracts');
const WalletLinkingService = require('./walletLinkingService');
const SaltMiningService = require('./alchemy/saltMiningService');
const SpellStatsService = require('./analytics/SpellStatsService');
// --- New Service: ModelDiscoveryService ---
const ModelDiscoveryService = require('./comfydeploy/modelDiscoveryService');
const { initializeCookServices, CollectionExportService } = require('./cook');
const StringService = require('./stringService');
const { initializeTrainingServices } = require('./training');
// --- Guest Account Services ---
const GuestAccountService = require('./guestAccountService');
const GuestAuthService = require('./guestAuthService');
const SpellPaymentService = require('./spellPaymentService');
const createCaptionTaskService = require('./CaptionTaskService');

/**
 * Initialize all core services
 * @param {Object} options - Configuration options
 * @returns {Object} - Initialized services
 */
async function initializeServices(options = {}) {
  const logger = options.logger || console;
  const webSocketService = options.webSocketService; // Extract WebSocket service
  const appStartTime = new Date();
  
  // Initialize ToolRegistry Singleton
  const toolRegistry = ToolRegistry.getInstance();
  toolRegistry.loadStaticTools(); // Load hardcoded tools
  logger.info('ToolRegistry initialized.');
  
  // DIAGNOSTIC LOGGING REMOVED
  
  try {
    logger.info('Initializing core services...');
    
    // Initialize services with proper dependencies
    const mediaService = new MediaService({ 
      logger,
      tempDir: options.mediaConfig?.tempDir,
      storageDir: options.mediaConfig?.storageDir
    });
    const pointsService = new PointsService({ logger });
    const comfyUIService = new ComfyUIService({ logger });
    // Instantiate the unified ModelDiscoveryService (used by menus, quoting, etc.)
    const modelDiscoveryService = new ModelDiscoveryService({ comfyService: comfyUIService });
    const openAIService = new OpenAIService({ logger });
    const huggingfaceService = new HuggingFaceService({ logger });
    const storageService = new StorageService(logger); // Initialize StorageService
    const stringService = new StringService({ logger });
    
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
    try {
      const generationOutputsDb = initializedDbServices?.data?.generationOutputs;
      if (generationOutputsDb && typeof generationOutputsDb.ensureIndexes === 'function') {
        await generationOutputsDb.ensureIndexes();
      }
    } catch (indexErr) {
      logger.error('Failed to ensure generation outputs indexes:', indexErr);
    }
    try {
      createCaptionTaskService({
        logger,
        db: initializedDbServices.data,
        websocketService: webSocketService,
      });
      logger.info('[initializeServices] CaptionTaskService initialized.');
    } catch (err) {
      logger.error('[initializeServices] Failed to initialize CaptionTaskService:', err);
    }

    // --- Initialize On-Chain Services ---
    const ethereumServices = {}; // chainId -> EthereumService
    const creditServices = {};   // chainId -> CreditService
    let priceFeedService;
    let nftPriceService;
    let dexService;
    let tokenRiskEngine;
    let saltMiningService;
    let walletLinkingService = new WalletLinkingService({ logger, db: initializedDbServices.data });

    // Initialize AdminActivityService for real-time monitoring (before on-chain services so it's in scope)
    let adminActivityService = null;
    try {
      const AdminActivityService = require('./adminActivityService');
      adminActivityService = new AdminActivityService({
        webSocketService: webSocketService,
        logger
      });
      logger.info('[initializeServices] AdminActivityService initialized.');
    } catch (err) {
      logger.error('[initializeServices] Failed to initialize AdminActivityService:', err);
    }

    try {
      logger.info('Initializing on-chain services (Ethereum, Credit)...');
      
      // --- MULTICHAIN INITIALISATION ---
      const { RPC_ENV_VARS, getRpcUrl, getFoundationAddress, getCharterBeaconAddress } = require('./alchemy/foundationConfig');
      // Get unique chainIds - normalize 'mainnet' -> '1', etc. to avoid duplicates
      const CHAIN_NAME_TO_ID = {
        'mainnet': '1',
        'ethereum': '1',
        'sepolia': '11155111',
        'arbitrum': '42161',
        'base': '8453',
      };
      const normalizeChainId = (cid) => CHAIN_NAME_TO_ID[String(cid).toLowerCase()] || String(cid);
      const chainIdSet = new Set();
      const targetChains = Object.keys(contracts.foundation.addresses)
        .filter(cid => contracts.foundation.addresses[cid])
        .map(cid => {
          const normalized = normalizeChainId(cid);
          if (!chainIdSet.has(normalized)) {
            chainIdSet.add(normalized);
            return normalized;
          }
          return null;
        })
        .filter(cid => cid !== null);

      priceFeedService = new PriceFeedService({ alchemyApiKey: process.env.ALCHEMY_SECRET }, logger);
      nftPriceService = new NftPriceService({ alchemyApiKey: process.env.ALCHEMY_SECRET }, { priceFeedService }, logger);
      dexService = null; // Will be instantiated when mainnet EthereumService is ready
      tokenRiskEngine = null; // Defer until dexService ready

      // --- Instantiate shared SaltMiningService (mainnet assumed) ---
      try {
        saltMiningService = new SaltMiningService({
          foundationAddress: getFoundationAddress('1'),
          foundationAbi: contracts.foundation.abi,
          charterBeacon: getCharterBeaconAddress('1'),
        }, logger);
        logger.info('[initializeServices] SaltMiningService initialized.');
      } catch (err) {
        logger.error('[initializeServices] Failed to initialize SaltMiningService:', err);
      }

      for (const chainId of targetChains) {
        try {
          const rpcUrl = getRpcUrl(chainId);
          const ethConfig = { rpcUrl, chainId };
          const ethereumServiceDependencies = { priceFeedService };
          const ethService = new EthereumService(ethConfig, ethereumServiceDependencies, logger);
          ethereumServices[chainId] = ethService;

          // Lazily instantiate shared dexService & tokenRiskEngine using the first available EthereumService (prefer mainnet)
          if (!dexService) {
            dexService = new DexService({ ethereumService: ethService }, logger);
            logger.info('[initializeServices] DexService initialized.');
          }
          if (!tokenRiskEngine) {
            tokenRiskEngine = new TokenRiskEngine({ dexService, priceFeedService }, logger);
            logger.info('[initializeServices] TokenRiskEngine initialized.');
          }

          const creditServiceConfig = {
            foundationAddress: getFoundationAddress(chainId),
            foundationAbi: contracts.foundation.abi,
            disableWebhookActions: process.env.DISABLE_CREDIT_WEBHOOK_ACTIONS === '1',
          };
          const creditDeps = {
            ethereumService: ethService,
            creditLedgerDb: initializedDbServices.data.creditLedger,
            systemStateDb: initializedDbServices.data.systemState,
            priceFeedService,
            tokenRiskEngine,
            internalApiClient,
            userCoreDb: initializedDbServices.data.userCore,
            walletLinkingRequestDb: initializedDbServices.data.walletLinkingRequests,
            walletLinkingService,
            webSocketService,
            saltMiningService,
            adminActivityService, // Add admin activity service for real-time monitoring
            spellPaymentService: null, // Will be injected after SpellPaymentService is created
          };
          creditServices[chainId] = new CreditService(creditDeps, creditServiceConfig, logger);
        } catch (err) {
          logger.error(`[initializeServices] Failed to init on-chain services for chain ${chainId}:`, err);
        }
      }
      logger.info('On-chain services initialized.');
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

    // --- Initialize WorkflowExecutionService & SpellsService BEFORE API so they can be injected ---
    const workflowExecutionService = new WorkflowExecutionService({
      logger,
      toolRegistry,
      comfyUIService: comfyUIService,
      internalApiClient, // Use the singleton directly
      db: initializedDbServices.data,
      workflowsService: workflowsService,
      userSettingsService,
    });
    logger.info('WorkflowExecutionService initialized (pre-API).');

    const spellsService = new SpellsService({
      logger,
      db: initializedDbServices.data,
      workflowExecutionService,
      spellPermissionsDb: initializedDbServices.data.spellPermissions,
      creditService: creditServices && creditServices['1'] ? creditServices['1'] : null, // Mainnet credit service for upfront payments
    });
    logger.info('SpellsService initialized (pre-API).');

    // Initialize Guest Account Services
    const guestAccountService = new GuestAccountService({
      logger,
      internalApiClient,
      userCoreDb: initializedDbServices.data.userCore
    });
    logger.info('GuestAccountService initialized.');

    const guestAuthService = new GuestAuthService({
      logger,
      userCoreDb: initializedDbServices.data.userCore
    });
    logger.info('GuestAuthService initialized.');

    // Initialize SpellPaymentService (uses mainnet credit service)
    // Note: This must be after creditServices are initialized
    let spellPaymentService = null;
    if (creditServices && creditServices['1'] && guestAccountService && guestAuthService) {
      try {
        // Import getFoundationAddress here since it's scoped to the try block above
        const { getFoundationAddress } = require('./alchemy/foundationConfig');
        spellPaymentService = new SpellPaymentService({
          logger,
          ethereumService: ethereumServices['1'],
          creditService: creditServices['1'],
          guestAccountService,
          guestAuthService,
          foundationConfig: {
            address: getFoundationAddress('1'),
            abi: contracts.foundation.abi
          }
        });
        logger.info('SpellPaymentService initialized.');
        
        // Inject SpellPaymentService back into CreditService (mainnet only)
        // This allows CreditService to track spell payments when processing deposits
        if (creditServices['1']) {
          creditServices['1'].spellPaymentService = spellPaymentService;
          logger.info('SpellPaymentService injected into mainnet CreditService.');
        }
      } catch (error) {
        logger.error('Failed to initialize SpellPaymentService:', error);
      }
    } else {
      logger.warn('SpellPaymentService not initialized: missing dependencies (creditServices, guestAccountService, or guestAuthService)');
    }

    // After database services initialized and toolRegistry loaded, enrich tools with stats
    const spellStatsService = new SpellStatsService({ generationOutputsDb: initializedDbServices.data.generationOutputs, logger });
    spellStatsService.startAutoRefresh(toolRegistry);
    logger.info('SpellStatsService initialized and ToolRegistry stats enrichment scheduled.');

    let collectionExportService = null;
    if (initializedDbServices.data.collectionExports && initializedDbServices.data.cookCollections && initializedDbServices.data.generationOutputs && storageService) {
      collectionExportService = new CollectionExportService({
        logger,
        cookCollectionsDb: initializedDbServices.data.cookCollections,
        generationOutputsDb: initializedDbServices.data.generationOutputs,
        collectionExportsDb: initializedDbServices.data.collectionExports,
        storageService,
        systemStateDb: initializedDbServices.data.systemState,
        processingEnabled: options.collectionExportProcessingEnabled !== false
      });
      logger.info('CollectionExportService initialized.');
    } else {
      logger.warn('CollectionExportService not initialized: missing DB or storage dependencies.');
    }

    // Initialize API services, now with userSettingsService
    const apiServices = initializeAPI({
      logger,
      appStartTime,
      version: options.version,
      db: initializedDbServices,
      toolRegistry,
      openai: openAIService,
      huggingface: huggingfaceService,
      comfyUIService: comfyUIService,
      loraResolutionService: loraResolutionService,
      internalApiClient, // pass canonical client to API layer
      longRunningApiClient, // pass long-running client for salt mining
      userSettingsService, // Pass the service to the API layer
      walletLinkingService,
      storageService, // Pass the storage service to the API layer
      priceFeedService,
      creditServices: creditServices, // map
      creditService: creditServices['1'] || null, // legacy singleton for mainnet
      ethereumService: ethereumServices, // Pass the multi-chain ethereum services
      nftPriceService,
      saltMiningService,
      spellsService, // Inject spellsService so internal API can use it
      workflowExecutionService,
      webSocketService, // Add the service here
      modelDiscoveryService, // Add the service here
      stringService, // Add the service here
      adminActivityService, // Add admin activity service
      guestAccountService, // Add guest account service
      guestAuthService, // Add guest auth service
      spellPaymentService // Add spell payment service
      ,
      collectionExportService
    });
    
    // The internalApiClient is a singleton utility, not from apiServices.
    // The old logic to extract it from apiServices is removed.
    
    // Initialize WorkflowExecutionService
    // const workflowExecutionService = new WorkflowExecutionService({
    //   logger,
    //   toolRegistry,
    //   comfyUIService: comfyUIService,
    //   internalApiClient: apiServices.internal?.client,
    //   db: initializedDbServices.data,
    //   workflowsService: workflowsService,
    //   userSettingsService, // Added userSettingsService
    // });
    // logger.info('WorkflowExecutionService initialized.');

    // Initialize SpellsService
    // const spellsService = new SpellsService({
    //   logger,
    //   db: initializedDbServices.data,
    //   workflowExecutionService,
    //   spellPermissionsDb: initializedDbServices.data.spellPermissions,
    // });
    // logger.info('SpellsService initialized.');

    logger.info('Core services created successfully');
    
    const dbInstances = initializedDbServices?.data || {};
    const dbWrapper = {
      ...dbInstances,
      data: dbInstances,
      models: dbInstances
    };

    const returnedServices = {
      media: mediaService,
      points: pointsService,
      comfyUI: comfyUIService,
      workflows: workflowsService,
      openai: openAIService,
      huggingface: huggingfaceService,
      db: dbWrapper, // Expose db services with legacy-compatible shape
      internal: apiServices.internal, // This contains router, status
      external: apiServices.external, // This contains the external router
      internalApiClient, // <-- expose the singleton client at top-level
      longRunningApiClient, // <-- expose the long-running client for salt mining
      userSettingsService, // Added userSettingsService
      spellsService, // Added spellsService
      workflowExecutionService, // Added workflowExecutionService
      storageService, // Add new service
      ethereumService: ethereumServices, // Add new service
      creditService: creditServices, // Add new service
      priceFeedService,
      nftPriceService,
      dexService,
      tokenRiskEngine,
      walletLinkingService,
      modelDiscoveryService, // expose ModelDiscoveryService
      logger,
      appStartTime,
      toolRegistry, // geniusoverhaul: Added toolRegistry to returned services
      loraResolutionService,
      webSocketService, // Add the service here
      spellStatsService, // expose SpellStatsService
      stringService, // expose StringService
      adminActivityService, // expose AdminActivityService
      guestAccountService, // expose GuestAccountService
      guestAuthService, // expose GuestAuthService
      spellPaymentService, // expose SpellPaymentService
      collectionExportService
    };

    // DIAGNOSTIC LOGGING REMOVED

    // Initialize Cook projection services
    await initializeCookServices(logger, {
      cookCollectionsDb: dbInstances.cookCollections,
      cooksDb: dbInstances.cooks,
    });

    // Initialize Training services
    const trainingServices = await initializeTrainingServices({
      logger,
      db: initializedDbServices,
      storageService: storageService,
      pointsService: pointsService
    });

    // Return instantiated services
    return {
      ...returnedServices,
      training: trainingServices
    };
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
  SpellsService,
  OpenAIService,
  HuggingFaceService,
  GuestAccountService,
  GuestAuthService,
  WorkflowExecutionService,
  initializeServices,
  ToolRegistry, // geniusoverhaul: Export ToolRegistry for access if needed elsewhere
  StorageService, // Export new service
  // Export new services
  EthereumService,
  CreditService,
  PriceFeedService,
  DexService,
  TokenRiskEngine,
  WalletLinkingService,
  SaltMiningService,
  ModelDiscoveryService,
  StringService,  // Export StringService
  initializeTrainingServices, // Export training services
}; 
