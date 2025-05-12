/**
 * @file Instantiates and exports database service modules.
 * This serves as the main access point for database operations within the application.
 */

// Import the DB service CLASSES
const UserCoreDB = require('./userCoreDb');
// Assuming other DB files also export classes now or will be updated later
const UserSessionsDB = require('./userSessionsDb'); 
const UserEventsDB = require('./userEventsDb');       
const GenerationOutputsDB = require('./generationOutputsDb'); 
const UserEconomyDB = require('./userEconomyDb');
const UserPreferencesDB = require('./userPreferencesDb');
const TransactionsDB = require('./transactionsDb');
// ... import other DB service classes as they are created

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
    console.warn('[DB Index] Logger not provided to initializeDbServices. DB services may lack logging.');
    // Optionally provide a default console logger here if critical
  }
  
  const databaseServices = {
    userCore: new UserCoreDB(logger), // Instantiate with logger
    // Instantiate others similarly (assuming they accept logger or will be updated)
    // For now, handle potential errors if they don't accept logger gracefully
    userSessions: UserSessionsDB ? new UserSessionsDB(logger) : null, // Add checks if unsure
    userEvents: UserEventsDB ? new UserEventsDB(logger) : null,
    generationOutputs: GenerationOutputsDB ? new GenerationOutputsDB(logger) : null,
    userEconomy: UserEconomyDB ? new UserEconomyDB(logger) : null,
    userPreferences: UserPreferencesDB ? new UserPreferencesDB(logger) : null,
    transactions: TransactionsDB ? new TransactionsDB(logger) : null,
    // ... add other services here
  };

  // Filter out null services if any failed instantiation or weren't classes
  Object.keys(databaseServices).forEach(key => {
    if (databaseServices[key] === null) {
      logger?.warn(`[DB Index] Service '${key}' could not be instantiated, possibly missing or not a class constructor.`);
      delete databaseServices[key];
    }
  });

  return {
    // ...any existing exports from the old db/index.js could be spread here if needed
    // e.g., ...legacyDbService,
    data: databaseServices, // All DB services are now INSTANCES namespaced under 'data'
  };
}

// Export the initialization function instead of the direct object
module.exports = { initializeDbServices }; 