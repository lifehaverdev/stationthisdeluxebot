/**
 * @file Instantiates and exports database service modules.
 * This serves as the main access point for database operations within the application.
 */

// Import the DB service CLASSES
const UserCoreDB = require('./userCoreDb');
// Assuming other DB files also export classes now or will be updated later
const UserEventsDB = require('./userEventsDb');       
const GenerationOutputsDB = require('./generationOutputsDb'); 
const UserEconomyDB = require('./userEconomyDb');
const UserPreferencesDB = require('./userPreferencesDb');
const TransactionsDB = require('./transactionsDb');
const LoRATrainingsDB = require('./trainingDb'); // Import LoRATrainingsDB
const LoRAModelsDB = require('./loRAModelDb'); // Import LoRAModelsDB
const LoRAPermissionsDB = require('./loRAPermissionsDb'); // Import LoRAPermissionsDB
const SpellsDB = require('./spellsDb'); // Import SpellsDB
const SpellPermissionsDB = require('./spellPermissionsDb'); // Import SpellPermissionsDB
const CookCollectionsDB = require('./cookCollectionsDb');
const WalletLinkingRequestDB = require('./walletLinkingRequestDb'); // Import WalletLinkingRequestDB
const PlatformLinkRequestsDB = require('./platformLinkRequestsDb'); // Import PlatformLinkRequestsDB
const CastsDB = require('./castsDb');
const CooksDB = require('./cooksDb');
const WorkspacesDB = require('./workspacesDb');
const DatasetDB = require('./datasetDb'); // ADDED: dataset service
const CostsDB = require('./costsDb'); // ADDED: costs service
const CollectionExportsDB = require('./collectionExportsDb');

// Import new on-chain DB services
const CreditLedgerDB = require('./alchemy/creditLedgerDb');
const SystemStateDB = require('./alchemy/systemStateDb');

// Placeholder for any existing/legacy DB service exports if this file already exists
// For example:
// const LegacyUserDB = require('./legacy/legacyUserDb');

/**
 * Initializes all database services with the provided logger.
 * @param {Object} logger - The logger instance to be used by DB services.
 * @returns {Object} - An object containing instantiated DB services.
 */
function initializeDbServices(logger) {
  if (!logger) {
    // Fallback to console if logger is not provided, to ensure these critical logs are seen
    (console.warn || console.log)('[DB Index] Logger not provided to initializeDbServices. DB services may lack logging. Using console for init logs.');
    logger = console;
  }
  
  logger.info(`[DB Index] LoRATrainingsDB class loaded, type: ${typeof LoRATrainingsDB}`);

  const databaseServices = {
    userCore: new UserCoreDB(logger), // Instantiate with logger
    // Instantiate others similarly (assuming they accept logger or will be updated)
    // For now, handle potential errors if they don't accept logger gracefully
    userEvents: UserEventsDB ? new UserEventsDB(logger) : null,
    generationOutputs: GenerationOutputsDB ? new GenerationOutputsDB(logger) : null,
    userEconomy: UserEconomyDB ? new UserEconomyDB(logger) : null,
    userPreferences: UserPreferencesDB ? new UserPreferencesDB(logger) : null,
    transactions: TransactionsDB ? new TransactionsDB(logger) : null,
    loraTrainings: LoRATrainingsDB ? new LoRATrainingsDB(logger) : null, // ADDED: Instantiate LoRATrainingsDB
    dataset: DatasetDB ? new DatasetDB(logger) : null, // ADDED
    loraModels: LoRAModelsDB ? new LoRAModelsDB(logger) : null, // ADDED: Instantiate LoRAModelsDB
    loraPermissions: LoRAPermissionsDB ? new LoRAPermissionsDB(logger) : null, // ADDED: Instantiate LoRAPermissionsDB
    spells: SpellsDB ? new SpellsDB(logger) : null, // ADDED: Instantiate SpellsDB
    spellPermissions: SpellPermissionsDB ? new SpellPermissionsDB(logger) : null, // ADDED: Instantiate SpellPermissionsDB
    cookCollections: CookCollectionsDB ? new CookCollectionsDB(logger) : null,
    walletLinkingRequests: WalletLinkingRequestDB ? new WalletLinkingRequestDB(logger) : null,
    platformLinkRequests: PlatformLinkRequestsDB ? new PlatformLinkRequestsDB(logger) : null,
    casts: CastsDB ? new CastsDB(logger) : null,
    cooks: CooksDB ? new CooksDB(logger) : null,
    workspaces: WorkspacesDB ? new WorkspacesDB(logger) : null,
    costs: CostsDB ? new CostsDB(logger) : null, // ADDED: costs service
    collectionExports: CollectionExportsDB ? new CollectionExportsDB(logger) : null,
    
    // On-chain services
    creditLedger: CreditLedgerDB ? new CreditLedgerDB(logger) : null,
    systemState: SystemStateDB ? new SystemStateDB(logger) : null,

    // ... add other services here
  };

  // Filter out null services if any failed instantiation or weren't classes
  Object.keys(databaseServices).forEach(key => {
    if (databaseServices[key] === null) {
      logger?.warn(`[DB Index] Service '${key}' was initially null (or failed instantiation) and is being removed from databaseServices.`);
      delete databaseServices[key];
    }
  });

  logger.info(`[DB Index] Final check of databaseServices.loraTrainings type: ${typeof databaseServices.loraTrainings}`);
  logger.info(`[DB Index] Is databaseServices.loraTrainings strictly null: ${databaseServices.loraTrainings === null}`);
  if (databaseServices.loraTrainings && typeof databaseServices.loraTrainings.findTrainingsByUser === 'function') {
    logger.info(`[DB Index] LoRATrainingsDB instance appears valid in databaseServices.`);
  } else {
    logger.warn(`[DB Index] LoRATrainingsDB instance IS MISSING or INVALID in databaseServices. Check loading of LoRATrainingsDB class and its instantiation.`);
  }

  return {
    // ...any existing exports from the old db/index.js could be spread here if needed
    // e.g., ...legacyDbService,
    data: databaseServices, // All DB services are now INSTANCES namespaced under 'data'
  };
}

// Export the initialization function instead of the direct object
module.exports = { initializeDbServices }; 
module.exports.WorkspacesDB = WorkspacesDB; 
