#!/usr/bin/env node
/**
 * service-worker.js - VastAI Service Worker (Test Harness)
 *
 * PURPOSE:
 *   Test harness that proves the VastAI service system works end-to-end.
 *   Polls for queued jobs, routes them to GPU instances via the scheduler,
 *   and processes them through the ServiceJobProcessor.
 *
 * WHAT IT DOES:
 *   1. Polls ServiceJobDB for queued jobs
 *   2. Uses GPUScheduler to route jobs to available instances
 *   3. Uses WarmPoolManager to manage instance lifecycle
 *   4. Processes jobs via ServiceJobProcessor
 *
 * USAGE:
 *   ./run-with-env.sh node scripts/vastai/service-worker.js
 *
 * OPTIONS:
 *   --verbose    Enable verbose logging
 *   --dryRun     Log what would happen without executing
 *   --once       Process one job and exit (useful for testing)
 *
 * ENVIRONMENT:
 *   VASTAI_API_KEY         - Required: VastAI API key
 *   VASTAI_SSH_KEY_PATH    - Required: Path to SSH private key
 *   MONGODB_URI            - Required: MongoDB connection string
 *
 * SEE ALSO:
 *   - src/core/services/vastai/GPUScheduler.js - Job scheduling
 *   - src/core/services/vastai/WarmPoolManager.js - Instance lifecycle
 *   - src/core/services/vastai/ServiceJobProcessor.js - Job processing
 *   - src/core/services/vastai/ServiceRunner.js - Remote execution
 *   - scripts/vastai/launch-training.js - Similar script pattern
 */
const minimist = require('minimist');
const path = require('path');

const { VastAIService } = require('../../src/core/services/vastai');
const WarmPoolManager = require('../../src/core/services/vastai/WarmPoolManager');
const GPUScheduler = require('../../src/core/services/vastai/GPUScheduler');
const ServiceRunner = require('../../src/core/services/vastai/ServiceRunner');
const ServiceJobProcessor = require('../../src/core/services/vastai/ServiceJobProcessor');
const ServiceJobDB = require('../../src/core/services/db/serviceJobDb');
const SshTransport = require('../../src/core/services/remote/SshTransport');
const { getServiceConfig } = require('../../src/config/vastaiService');
const { getVastAIConfig } = require('../../src/config/vastai');

// Polling configuration
const POLL_INTERVAL_MS = 5000;  // 5 seconds between checks
const COOLDOWN_MS = 1000;       // 1 second cooldown after processing a job
const PROVISION_WAIT_MS = 10000; // 10 seconds between provision checks

const args = minimist(process.argv.slice(2), {
  boolean: ['verbose', 'dryRun', 'once', 'help'],
  alias: {
    v: 'verbose',
    d: 'dryRun',
    h: 'help'
  }
});

if (args.help) {
  console.log(`
VastAI Service Worker - Test harness for GPU service system

Usage:
  ./run-with-env.sh node scripts/vastai/service-worker.js [options]

Options:
  --verbose, -v    Enable verbose logging
  --dryRun, -d     Log what would happen without executing
  --once           Process one job and exit
  --help, -h       Show this help message

Environment Variables:
  VASTAI_API_KEY         VastAI API key (required)
  VASTAI_SSH_KEY_PATH    Path to SSH private key (required)
  MONGODB_URI            MongoDB connection string (required)
`);
  process.exit(0);
}

/**
 * ServiceWorker - Main worker class that orchestrates job processing
 */
class ServiceWorker {
  constructor() {
    this.logger = console;
    this.running = false;
    this.dryRun = args.dryRun || false;
    this.verbose = args.verbose || false;
    this.processOnce = args.once || false;

    // Track SSH transports per instance for reuse
    this.sshTransports = new Map();

    // Will be initialized in start()
    this.vastaiService = null;
    this.serviceJobDb = null;
    this.warmPoolManager = null;
    this.scheduler = null;
    this.config = null;
    this.vastaiConfig = null;

    // Metrics
    this.metrics = {
      jobsProcessed: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      startTime: null
    };
  }

  /**
   * Initialize all services
   */
  async _initializeServices() {
    this.logger.info('[ServiceWorker] Initializing services...');

    // Load configs
    this.config = getServiceConfig();
    this.vastaiConfig = getVastAIConfig();

    this._log(`Config loaded: maxInstances=${this.config.maxInstances}, spinupThreshold=${this.config.spinupThreshold}`);

    // Initialize VastAI service
    this.vastaiService = new VastAIService({
      logger: this.verbose ? this.logger : null
    });

    // Initialize ServiceJobDB
    this.serviceJobDb = new ServiceJobDB(this.logger);

    // Initialize WarmPoolManager
    this.warmPoolManager = new WarmPoolManager({
      logger: this.logger,
      vastaiService: this.vastaiService,
      config: this.config
    });

    // Initialize GPUScheduler
    this.scheduler = new GPUScheduler({
      logger: this.logger,
      serviceJobDb: this.serviceJobDb,
      warmPoolManager: this.warmPoolManager,
      config: this.config
    });

    this.logger.info('[ServiceWorker] Services initialized');
  }

  /**
   * Start the worker
   */
  async start() {
    this.logger.info('[ServiceWorker] Starting...');
    this.metrics.startTime = Date.now();

    // Initialize services
    await this._initializeServices();

    this.running = true;

    // Setup graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());

    this.logger.info('[ServiceWorker] Entering main loop');
    this.logger.info(`[ServiceWorker] Poll interval: ${POLL_INTERVAL_MS}ms, Dry run: ${this.dryRun}`);

    // Main loop
    while (this.running) {
      try {
        const didWork = await this.tick();

        if (didWork) {
          // Processed a job, short cooldown
          await this._wait(COOLDOWN_MS);

          // If --once flag, exit after processing one job
          if (this.processOnce) {
            this.logger.info('[ServiceWorker] --once flag set, exiting after processing job');
            await this.stop();
            break;
          }
        } else {
          // No work, wait for poll interval
          await this._wait(POLL_INTERVAL_MS);
        }
      } catch (err) {
        this.logger.error(`[ServiceWorker] Tick error: ${err.message}`);
        if (this.verbose) {
          this.logger.error(err.stack);
        }
        // Wait before retrying
        await this._wait(POLL_INTERVAL_MS);
      }
    }

    this.logger.info('[ServiceWorker] Main loop exited');
    this._logMetrics();
  }

  /**
   * Stop the worker gracefully
   */
  async stop() {
    if (!this.running) {
      return;
    }

    this.logger.info('[ServiceWorker] Stopping...');
    this.running = false;

    // Shutdown warm pool (terminates instances)
    if (this.warmPoolManager) {
      this.logger.info('[ServiceWorker] Shutting down warm pool...');
      await this.warmPoolManager.shutdown();
    }

    // Close SSH transports
    this.sshTransports.clear();

    this.logger.info('[ServiceWorker] Stopped');
    this._logMetrics();
  }

  /**
   * Main tick - check for work and process if available
   *
   * @returns {Promise<boolean>} True if work was processed
   */
  async tick() {
    // Check for work via scheduler
    const scheduled = await this.scheduler.scheduleNext();

    if (!scheduled) {
      this._log('No work available');
      return false;
    }

    const { job, instance, needsProvisioning } = scheduled;
    const jobId = job._id.toString();

    this.logger.info(`[ServiceWorker] Scheduled job ${jobId} (type: ${job.requestType})`);

    if (this.dryRun) {
      this.logger.info(`[ServiceWorker] DRY RUN: Would process job ${jobId}`);
      this.logger.info(`[ServiceWorker] DRY RUN: Instance: ${instance?.instanceId || 'needs provisioning'}`);
      return true;
    }

    // If needs provisioning, wait for instance to become ready
    let targetInstance = instance;
    if (needsProvisioning) {
      this.logger.info('[ServiceWorker] Provisioning new instance...');
      targetInstance = await this._waitForProvisionedInstance(job);

      if (!targetInstance) {
        this.logger.error('[ServiceWorker] Failed to provision instance');
        return false;
      }
    }

    // Get or create SSH transport for this instance
    const sshTransport = await this._getSshTransport(targetInstance);
    if (!sshTransport) {
      this.logger.error(`[ServiceWorker] Failed to create SSH transport for instance ${targetInstance.instanceId}`);
      return false;
    }

    // Create ServiceRunner with transport
    const serviceRunner = new ServiceRunner({
      logger: this.verbose ? this.logger : null,
      sshTransport
    });

    // Create ServiceJobProcessor
    const processor = new ServiceJobProcessor({
      logger: this.logger,
      serviceJobDb: this.serviceJobDb,
      scheduler: this.scheduler,
      serviceRunner,
      pointsService: this._getMockPointsService(),
      storageService: null, // No storage service in test harness
      config: this.config
    });

    // Claim job via scheduler
    const claimedJob = await this.scheduler.claimJob(jobId, targetInstance.instanceId);
    if (!claimedJob) {
      this.logger.warn(`[ServiceWorker] Failed to claim job ${jobId} - may have been claimed by another worker`);
      return false;
    }

    // Process via processor
    this.logger.info(`[ServiceWorker] Processing job ${jobId} on instance ${targetInstance.instanceId}`);
    const result = await processor.process(claimedJob, {
      instanceId: targetInstance.instanceId,
      hourlyRate: targetInstance.hourlyUsd || 0
    });

    // Update metrics
    this.metrics.jobsProcessed++;
    if (result.success) {
      this.metrics.jobsSucceeded++;
      this.logger.info(`[ServiceWorker] Job ${jobId} completed successfully`);
      this.logger.info(`[ServiceWorker]   GPU seconds: ${result.gpuSeconds?.toFixed(2) || 0}`);
      this.logger.info(`[ServiceWorker]   Cost: $${result.costUsd?.toFixed(6) || 0}`);
    } else {
      this.metrics.jobsFailed++;
      this.logger.error(`[ServiceWorker] Job ${jobId} failed: ${result.error}`);
    }

    return true;
  }

  /**
   * Wait for a provisioned instance to become ready
   *
   * @param {object} job - Job that triggered provisioning
   * @returns {Promise<object|null>} Ready instance or null
   */
  async _waitForProvisionedInstance(job) {
    const instanceType = this._getInstanceTypeForJob(job);
    const instanceConfig = this.config.instanceTypes?.[instanceType] || {};

    try {
      // Request new instance
      const provisioned = await this.warmPoolManager.requestInstance(instanceType, {
        image: instanceConfig.image,
        jobId: job._id.toString()
      });

      if (!provisioned?.instanceId) {
        this.logger.error('[ServiceWorker] Provisioning returned no instance ID');
        return null;
      }

      const instanceId = provisioned.instanceId;
      this.logger.info(`[ServiceWorker] Instance ${instanceId} provisioning started`);

      // Wait for instance to become ready
      const maxWaitMs = 5 * 60 * 1000; // 5 minutes
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitMs) {
        const status = await this.vastaiService.getInstanceStatus(instanceId);
        this.logger.info(`[ServiceWorker] Instance ${instanceId} status: ${status.status}`);

        if (status.status === 'running' && (status.sshHost || status.publicIp)) {
          // Mark ready in warm pool
          this.warmPoolManager.markReady(instanceId);
          return status;
        }

        await this._wait(PROVISION_WAIT_MS);
      }

      this.logger.error(`[ServiceWorker] Instance ${instanceId} did not become ready in time`);
      return null;

    } catch (err) {
      this.logger.error(`[ServiceWorker] Provisioning error: ${err.message}`);
      return null;
    }
  }

  /**
   * Get or create SSH transport for an instance
   *
   * @param {object} instance - Instance data with sshHost/publicIp, sshPort
   * @returns {Promise<SshTransport|null>} SSH transport or null
   */
  async _getSshTransport(instance) {
    const instanceId = instance.instanceId;

    // Check cache
    if (this.sshTransports.has(instanceId)) {
      return this.sshTransports.get(instanceId);
    }

    const sshHost = instance.sshHost || instance.publicIp;
    if (!sshHost) {
      this.logger.error(`[ServiceWorker] Instance ${instanceId} has no SSH endpoint`);
      return null;
    }

    if (!this.vastaiConfig.sshKeyPath) {
      this.logger.error('[ServiceWorker] No SSH key path configured');
      return null;
    }

    try {
      const transport = new SshTransport({
        host: sshHost,
        port: instance.sshPort || 22,
        username: instance.sshUser || 'root',
        privateKeyPath: this.vastaiConfig.sshKeyPath,
        logger: this.verbose ? this.logger : null
      });

      // Cache for reuse
      this.sshTransports.set(instanceId, transport);

      this.logger.info(`[ServiceWorker] Created SSH transport for ${instanceId} (${sshHost}:${instance.sshPort || 22})`);
      return transport;

    } catch (err) {
      this.logger.error(`[ServiceWorker] Failed to create SSH transport: ${err.message}`);
      return null;
    }
  }

  /**
   * Get instance type for a job based on request type
   *
   * @param {object} job - Job with requestType
   * @returns {string} Instance type
   */
  _getInstanceTypeForJob(job) {
    const requestType = job?.requestType;
    const mapping = {
      'comfy-workflow': 'comfy-worker',
      'lora-inference': 'comfy-worker',
      'image-gen': 'comfy-worker'
    };
    return mapping[requestType] || 'custom-runner';
  }

  /**
   * Mock points service for test harness
   *
   * @returns {object} Mock points service
   */
  _getMockPointsService() {
    return {
      deductPointsForService: async (data) => {
        this.logger.info(`[MockPoints] Would deduct ${data.pointsToDeduct} points from ${data.walletAddress}`);
        return true;
      },
      deductPointsForTraining: async (data) => {
        this.logger.info(`[MockPoints] Would deduct ${data.pointsToDeduct} points from ${data.walletAddress}`);
        return true;
      },
      addPoints: async () => true
    };
  }

  /**
   * Wait for specified milliseconds
   *
   * @param {number} ms - Milliseconds to wait
   * @returns {Promise<void>}
   */
  async _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log message if verbose mode enabled
   *
   * @param {string} msg - Message to log
   */
  _log(msg) {
    if (this.verbose) {
      this.logger.info(`[ServiceWorker] ${msg}`);
    }
  }

  /**
   * Log final metrics
   */
  _logMetrics() {
    const runtime = this.metrics.startTime
      ? Math.round((Date.now() - this.metrics.startTime) / 1000)
      : 0;

    console.log('\n' + '='.repeat(60));
    console.log('  SERVICE WORKER METRICS');
    console.log('='.repeat(60));
    console.log(`  Runtime:         ${runtime}s`);
    console.log(`  Jobs processed:  ${this.metrics.jobsProcessed}`);
    console.log(`  Jobs succeeded:  ${this.metrics.jobsSucceeded}`);
    console.log(`  Jobs failed:     ${this.metrics.jobsFailed}`);
    if (this.metrics.jobsProcessed > 0) {
      const successRate = ((this.metrics.jobsSucceeded / this.metrics.jobsProcessed) * 100).toFixed(1);
      console.log(`  Success rate:    ${successRate}%`);
    }
    console.log('='.repeat(60) + '\n');
  }
}

// Main entry point
if (require.main === module) {
  const worker = new ServiceWorker();
  worker.start().catch(err => {
    console.error('Worker failed:', err);
    process.exit(1);
  });
}

module.exports = ServiceWorker;
