#!/usr/bin/env node

/**
 * Training Worker
 *
 * Master entry point script that runs continuously and polls for training jobs.
 * This is the main orchestrator that coordinates the entire training pipeline.
 *
 * NOTE: This file is executed in an ES-module context (Node ≥20 with "type":"module").
 * We therefore create our own `require` using `createRequire` so that the *rest* of the
 * file can keep using CommonJS style `require()` calls without a full rewrite.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { initializeServices } = require('../../src/core/services');
const { initializeTrainingServices } = require('../../src/core/services/training');

// Add the src directory to the module search paths so deep imports using absolute
// paths (e.g. "require('models/foo')") still resolve as expected.
require('module').globalPaths.push(path.join(__dirname, '../../src'));

class TrainingWorker {
  constructor() {
    this.logger = console;
    this.services = null;
    this.trainingServices = null;
    this.isRunning = false;
  }

  /**
   * Initialize the training worker
   */
  async initialize() {
    try {
      this.logger.info('Initializing Training Worker...');
      
      // Initialize core services
      this.services = await initializeServices({
        logger: this.logger,
        version: '1.0.0'
      });
      
      // Initialize training services
      this.trainingServices = await initializeTrainingServices({
        logger: this.logger,
        db: this.services.db,
        storageService: this.services.storageService,
        pointsService: this.services.points
      });
      
      this.logger.info('Training Worker initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize Training Worker:', error);
      throw error;
    }
  }

  /**
   * Start the training worker
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('Training Worker is already running');
      return;
    }

    try {
      await this.initialize();
      
      this.isRunning = true;
      this.logger.info('Starting Training Worker...');
      
      // Start the training orchestrator
      await this.trainingServices.orchestrator.start();
      
      // Set up graceful shutdown
      this.setupGracefulShutdown();
      
      this.logger.info('Training Worker started successfully');
      
    } catch (error) {
      this.logger.error('Failed to start Training Worker:', error);
      process.exit(1);
    }
  }

  /**
   * Stop the training worker
   */
  async stop() {
    if (!this.isRunning) {
      this.logger.warn('Training Worker is not running');
      return;
    }

    try {
      this.logger.info('Stopping Training Worker...');
      
      // Stop the training orchestrator
      if (this.trainingServices && this.trainingServices.orchestrator) {
        await this.trainingServices.orchestrator.stop();
      }
      
      this.isRunning = false;
      this.logger.info('Training Worker stopped successfully');
      
    } catch (error) {
      this.logger.error('Error stopping Training Worker:', error);
    }
  }

  /**
   * Set up graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      this.logger.info(`Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // For nodemon

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught Exception:', error);
      this.stop().then(() => process.exit(1));
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      this.stop().then(() => process.exit(1));
    });
  }

  /**
   * Get worker status
   */
  getStatus() {
    const orchestratorStatus = this.trainingServices?.orchestrator?.getStatus() || {};
    
    return {
      isRunning: this.isRunning,
      orchestrator: orchestratorStatus,
      services: {
        core: !!this.services,
        training: !!this.trainingServices
      }
    };
  }

  /**
   * Log status information
   */
  logStatus() {
    const status = this.getStatus();
    this.logger.info('Training Worker Status:', JSON.stringify(status, null, 2));
  }
}

// ---------------------------------------------------------------------------
// Main routine – starts the worker in long-running mode
// ---------------------------------------------------------------------------

async function main() {
  const worker = new TrainingWorker();
  try {
    await worker.start();

    // Periodically log status so we know it's alive.
    setInterval(() => {
      worker.logStatus();
    }, 30_000);
  } catch (err) {
    console.error('Failed to start Training Worker:', err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint detection
// ---------------------------------------------------------------------------
// In an ES-module there is no `require.main`. We replicate the common-JS check
// by comparing the currently executed script path with `process.argv[1]`.
const isMain = process.argv[1] === __filename;

if (isMain) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Training Worker - StationThis LoRA Training System

Usage: node trainingWorker.js [options]

Options:
  --help, -h     Show this help message
  --version, -v  Show version information
  --status       Show current status and exit

Environment Variables:
  NODE_ENV       Set to 'production' for production mode
  LOG_LEVEL      Set logging level (debug, info, warn, error)
  
Examples:
  node trainingWorker.js                    # Start the worker
  node trainingWorker.js --status          # Show status and exit
  NODE_ENV=production node trainingWorker.js # Start in production mode
`);
    process.exit(0);
  }
  
  if (args.includes('--version') || args.includes('-v')) {
    console.log('Training Worker v1.0.0');
    process.exit(0);
  }
  
  if (args.includes('--status')) {
    const worker = new TrainingWorker();
    try {
      await worker.initialize();
      worker.logStatus();
      process.exit(0);
    } catch (error) {
      console.error('Failed to get status:', error);
      process.exit(1);
    }
  }
  
  // Start the worker
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Named export so other ESM modules can import it.
export { TrainingWorker };
