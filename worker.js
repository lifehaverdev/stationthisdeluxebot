/**
 * Collection Export Worker Entry Point
 *
 * Runs the CollectionExportService in processing mode only, without the web stack.
 */

const { createLogger } = require('./src/utils/logger');
const { initializeDatabase } = require('./src/core/initDB');
const { initializeServices } = require('./src/core/services');

const logger = createLogger('export-worker');

async function startWorker() {
  try {
    logger.info('[ExportWorker] Initializing database connection...');
    await initializeDatabase();
    logger.info('[ExportWorker] Database connection ready.');

    const services = await initializeServices({
      logger,
      webSocketService: null,
      collectionExportProcessingEnabled: true
    });

    if (!services.collectionExportService) {
      logger.error('[ExportWorker] CollectionExportService not available. Exiting.');
      process.exit(1);
    }

    logger.info('[ExportWorker] Collection export worker started. Awaiting jobs...');

    const gracefulShutdown = async (signal) => {
      logger.info(`[ExportWorker] Received ${signal}. Shutting down worker...`);
      process.exit(0);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (err) {
    logger.error('[ExportWorker] Fatal error while starting worker:', err);
    process.exit(1);
  }
}

startWorker();
