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
   * Gets a salt that will create a vault address starting with 0x1152
   * First checks cache, then mines if needed
   * @param {string} ownerAddress - The address that will own the vault
   * @returns {Promise<{salt: string, predictedAddress: string}>}
   */
  getSalt(ownerAddress) {
    return new Promise((resolve, reject) => {
      this.logger.info('[SaltMiningService] Salt requested. Checking queue...');
      if (this.saltQueue.length > 0) {
        const result = this.saltQueue.shift();
        this.logger.info(`[SaltMiningService] Found pre-mined salt for request. Predicted Address: ${result.predictedAddress}`);
        this.fillQueue(); // Trigger a refill in the background
        return resolve(result);
      }

      this.logger.info('[SaltMiningService] No pre-mined salt available. Mining a new one directly...');
      const worker = new Worker(this.workerPath, {
        workerData: {
          ownerAddress: ownerAddress,
          foundationAddress: this.contractConfig.address,
          targetPrefix: '0x1152',
          creationBytecode: charteredFundBytecode // Pass the bytecode to the worker
        }
      });

      worker.on('message', (result) => {
                clearTimeout(timeoutId);
                this.miningPromises.delete(ownerAddress);
                resolve(result);
            });

            worker.on('error', (err) => {
                clearTimeout(timeoutId);
                this.miningPromises.delete(ownerAddress);
                reject(err);
            });

            worker.on('exit', (code) => {
                clearTimeout(timeoutId);
                this.miningPromises.delete(ownerAddress);
                if (code !== 0) {
                    reject(new Error(`Worker stopped with exit code ${code}`));
                }
            });
        });

        this.miningPromises.set(ownerAddress, promise);
        return promise;
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