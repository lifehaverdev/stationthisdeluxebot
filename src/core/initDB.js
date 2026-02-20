/**
 * @file Initializes and manages the database connection for the application.
 */

const { getCachedClient } = require('./services/db/utils/queue');

let connectionPromise = null;

/**
 * Initializes the database connection.
 * This function should be called once at application startup.
 * It's idempotent, meaning calling it multiple times won't create new connections if one is already established or in progress.
 * @returns {Promise<void>} A promise that resolves when the connection is established, or rejects on failure.
 */
async function initializeDatabase() {
  if (!connectionPromise) {
    connectionPromise = getCachedClient()
      .then((client) => {
        if (client) {
          // connection established; getCachedClient already logs at info level
          // The client is cached by queue.js, no need to store it here again.
          // The main purpose here is to ensure the connection is attempted at startup.
        } else {
          // This case should ideally not be reached if getCachedClient throws on critical failure
          console.error('getCachedClient resolved but client is null. This should not happen.');
          throw new Error('Failed to get a valid database client.');
        }
      })
      .catch((error) => {
        console.error('Critical error during database initialization:', error);
        connectionPromise = null; // Allow retrying if it failed
        throw error; // Re-throw to indicate failure to the application
      });
  }
  return connectionPromise;
}

/**
 * Placeholder for a graceful shutdown function if needed, though queue.js doesn't expose a direct disconnect for the cached client.
 * For applications that need explicit disconnect, queue.js might need a shutdown mechanism.
 */
async function closeDatabaseConnection() {
    // getCachedClient does not offer a direct disconnect for the shared client
    // If you implement a specific shutdown in queue.js that closes cachedClient, call it here.
    // For now, this is a conceptual placeholder.
}

module.exports = {
  initializeDatabase,
  closeDatabaseConnection,
}; 