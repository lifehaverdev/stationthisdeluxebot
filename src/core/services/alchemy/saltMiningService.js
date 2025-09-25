const { ethers } = require('ethers');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');

// Cache for pre-mined salts
const SALT_CACHE_SIZE = 10;
const MINING_TIMEOUT_MS = 120000; // 2 minutes - increased for systematic mining

/**
 * @class SaltMiningService
 * @description Manages a pool of workers to find CREATE2 salts for vanity addresses.
 */
class SaltMiningService {
  /**
   * @param {object} config - Configuration object.
   * @param {string} config.foundationAddress - The address of the Foundation contract
   * @param {string} config.charterBeacon - The address of the CharteredFund beacon contract
   * @param {object} logger - A logger instance.
   */
  constructor(config, logger) {
    this.logger = logger || console;
    
    if (!config.foundationAddress || !config.charterBeacon) {
        throw new Error('[SaltMiningService] Missing foundationAddress or charterBeacon in config.');
    }

    if (!ethers.isAddress(config.charterBeacon)) {
        throw new Error('[SaltMiningService] Invalid charterBeacon address format.');
    }
    
    this.contractConfig = {
        address: config.foundationAddress,
        beaconAddress: config.charterBeacon
    };

    this.workerPath = path.resolve(__dirname, 'saltMiningWorker.cjs');
    this.saltQueue = []; // A queue to hold pre-mined salts
    this.isMining = false;

    this.logger.info(`[SaltMiningService] Initialized with Foundation: ${this.contractConfig.address}, Beacon: ${this.contractConfig.beaconAddress}`);
  }

  /**
   * Gets a salt that will create a vault address starting with 0x1152.
   * This method will continuously retry until a salt is found.
   * @param {string} ownerAddress - The address that will own the vault
   * @returns {Promise<{salt: string, predictedAddress: string}>}
   */
  async getSalt(ownerAddress) {
    this.logger.info(`[SaltMiningService] Salt requested for owner: ${ownerAddress}. Checking queue...`);
    if (this.saltQueue.length > 0) {
      const result = this.saltQueue.shift();
      this.logger.info(`[SaltMiningService] Found pre-mined salt for request. Predicted Address: ${result.predictedAddress}`);
      // this.fillQueue(); // TODO: Implement queue refilling logic if desired
      return result;
    }

    this.logger.info(`[SaltMiningService] No pre-mined salt available for ${ownerAddress}. Starting live mining...`);
    
    let attempt = 0;
    // This loop will run indefinitely until a salt is successfully mined.
    while (true) {
      attempt++;
      try {
        this.logger.info(`[SaltMiningService] Mining attempt #${attempt} for owner ${ownerAddress}.`);
        const result = await this.mineNewSalt(ownerAddress);
        this.logger.info(`[SaltMiningService] Successfully mined salt on attempt #${attempt} for owner ${ownerAddress}.`);
        return result;
      } catch (error) {
        // Check if this is a prediction logic mismatch - if so, fail immediately
        if (error.message.includes('PREDICTION_LOGIC_MISMATCH')) {
          this.logger.error(`[SaltMiningService] CRITICAL: Prediction logic mismatch detected. Salt mining cannot continue.`);
          this.logger.error(`[SaltMiningService] This indicates a fundamental issue with our local prediction logic.`);
          this.logger.error(`[SaltMiningService] Aborting salt mining to prevent invalid results.`);
          throw new Error(`PREDICTION_LOGIC_MISMATCH: ${error.message}`);
        }
        
        this.logger.error(`[SaltMiningService] Mining attempt #${attempt} for ${ownerAddress} failed: ${error.message}. Retrying...`);
        // The loop will continue, automatically retrying for other types of errors.
      }
    }
  }

  /**
   * Spawns a worker to mine a single salt, with a timeout.
   * @param {string} ownerAddress - The owner of the vault.
   * @returns {Promise<{salt: string, predictedAddress: string}>}
   * @private
   */
  mineNewSalt(ownerAddress) {
    return new Promise((resolve, reject) => {
      // Reduced logging for production
      const worker = new Worker(this.workerPath, {
        workerData: {
          ownerAddress: ownerAddress,
          foundationAddress: this.contractConfig.address,
          beaconAddress: this.contractConfig.beaconAddress
        }
      });

      const timeoutId = setTimeout(() => {
        worker.terminate();
        reject(new Error(`Mining worker timed out after ${MINING_TIMEOUT_MS / 1000}s.`));
      }, MINING_TIMEOUT_MS);

      worker.on('message', (result) => {
        clearTimeout(timeoutId);
        if (result.error) {
          this.logger.error(`[SaltMiningService] Worker for ${ownerAddress} returned an error: ${result.error}`);
          reject(new Error(result.error));
        } else {
          this.logger.debug(`[SaltMiningService] Worker for ${ownerAddress} found salt. Predicted address: ${result.predictedAddress}`);
          resolve(result);
        }
      });

      worker.on('error', (err) => {
        clearTimeout(timeoutId);
        this.logger.error(`[SaltMiningService] Worker for ${ownerAddress} encountered a critical error:`, err);
        reject(err);
      });

      worker.on('exit', (code) => {
        clearTimeout(timeoutId);
        // A non-zero exit code in other contexts could be an error, but 'message' and 'error' events handle outcomes.
        // This log is for diagnostics. If exit happens without a message/error, it's noteworthy.
        if (code !== 0) {
          this.logger.debug(`[SaltMiningService] Worker for ${ownerAddress} exited with code ${code}.`);
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }

  /**
   * Starts background cache filling process
   * @private
   */
  async startCacheFilling() {
    // Fill cache for any owner addresses we're tracking
    const fillAll = async () => {
      const addresses = Array.from(this.saltCache.keys());
      for (const address of addresses) {
        try {
          await this.fillCache(address);
        } catch (err) {
          this.logger.error(`[SaltMiningService] Failed to fill cache for ${address}:`, err);
        }
      }
    };

    // Run initial fill
    fillAll().catch(err => {
      this.logger.error('[SaltMiningService] Initial cache fill failed:', err);
    });

    // Schedule periodic fills
    setInterval(fillAll, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Fills the salt cache for a given owner address
   * @param {string} ownerAddress - The address to fill cache for
   * @private
   */
  async fillCache(ownerAddress) {
    if (!this.saltCache.has(ownerAddress)) {
      this.saltCache.set(ownerAddress, []);
    }

    const cache = this.saltCache.get(ownerAddress);
    while (cache.length < SALT_CACHE_SIZE) {
      try {
        const result = await this.mineSalt(ownerAddress);
        cache.push(result);
      } catch (err) {
        this.logger.error(`[SaltMiningService] Failed to mine salt for cache:`, err);
        break;
      }
    }
  }
}

module.exports = SaltMiningService;