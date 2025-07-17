const { ethers } = require('ethers');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const os = require('os');

// Cache for pre-mined salts
const SALT_CACHE_SIZE = 10;
const MINING_TIMEOUT_MS = 30000; // 30 seconds
const TARGET_PREFIX = '0x1152';

// Load the creation bytecode for the CharteredFund contract
let charteredFundBytecode;
try {
  // Try loading from a direct string first (e.g., from an env var or a simple JSON file)
  const bytecodeJson = require('../../contracts/abis/bytecode/charteredFund.bytecode.json');
  charteredFundBytecode = typeof bytecodeJson === 'string' ? bytecodeJson : bytecodeJson.object;
  if (!charteredFundBytecode || !charteredFundBytecode.startsWith('0x')) {
    throw new Error('Bytecode is not in the expected format.');
  }
} catch (error) {
    console.error('[SaltMiningService] CRITICAL ERROR: Could not load CharteredFund bytecode.', error);
    // Set to null to prevent the service from starting if bytecode is essential
    charteredFundBytecode = null;
}


/**
 * @class SaltMiningService
 * @description Manages a pool of workers to find CREATE2 salts for vanity addresses.
 */
class SaltMiningService {
  /**
   * @param {object} config - Configuration object.
   * @param {string} config.foundationAddress - The address of the Foundation contract
   * @param {Array} config.foundationAbi - The ABI of the Foundation contract
   * @param {object} logger - A logger instance.
   */
  constructor(config, logger) {
    this.logger = logger || console;
    
    if (!charteredFundBytecode) {
        throw new Error('[SaltMiningService] Service cannot start because CharteredFund bytecode is not loaded.');
    }

    if (!config.foundationAddress || !config.foundationAbi) {
        throw new Error('[SaltMiningService] Missing foundationAddress or foundationAbi in config.');
    }
    
    this.contractConfig = {
        address: config.foundationAddress,
        abi: config.foundationAbi
    };

    this.workerPath = path.resolve(__dirname, 'saltMiningWorker.js');
    this.saltQueue = []; // A queue to hold pre-mined salts
    this.isMining = false;

    this.logger.info(`[SaltMiningService] Initialized with Foundation address: ${this.contractConfig.address}`);
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
        this.logger.error(`[SaltMiningService] Mining attempt #${attempt} for ${ownerAddress} failed: ${error.message}. Retrying...`);
        // The loop will continue, automatically retrying.
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
      this.logger.debug(`[SaltMiningService] Spawning new worker for owner: ${ownerAddress}`);
      const worker = new Worker(this.workerPath, {
        workerData: {
          ownerAddress: ownerAddress,
          foundationAddress: this.contractConfig.address,
          targetPrefix: TARGET_PREFIX,
          creationBytecode: charteredFundBytecode
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
          this.logger.info(`[SaltMiningService] Worker for ${ownerAddress} found salt. Predicted address: ${result.predictedAddress}`);
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
          this.logger.warn(`[SaltMiningService] Worker for ${ownerAddress} exited unexpectedly with code ${code}.`);
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