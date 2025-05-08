/**
 * @file Aggregates and exports database service modules.
 * This serves as the main access point for database operations within the application.
 */

// Import the new Noema DB service instances
const UserCoreDB = require('./userCoreDb');
const UserSessionsDB = require('./userSessionsDb'); // Placeholder for when it's created
const UserEventsDB = require('./userEventsDb');       // Placeholder
const GenerationOutputsDB = require('./generationOutputsDb'); // Placeholder
const UserEconomyDB = require('./userEconomyDb');
const UserPreferencesDB = require('./userPreferencesDb');
const TransactionsDB = require('./transactionsDb');
// ... import other Noema DB services as they are created

// Placeholder for any existing/legacy DB service exports if this file already exists
// For example:
// const LegacyUserDB = require('./legacy/legacyUserDb');

const noemaDbServices = {
  userCore: UserCoreDB,
  userSessions: UserSessionsDB,
  userEvents: UserEventsDB,
  generationOutputs: GenerationOutputsDB,
  userEconomy: UserEconomyDB,
  userPreferences: UserPreferencesDB,
  transactions: TransactionsDB,
  // ... add other services here
};

module.exports = {
  // ...any existing exports from the old db/index.js could be spread here if needed
  // e.g., ...legacyDbService,
  noema: noemaDbServices, // All new Noema DB services are namespaced under 'noema'
}; 