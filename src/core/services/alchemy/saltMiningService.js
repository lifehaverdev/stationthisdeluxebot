const { ethers } = require('ethers');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const os = require('os');

// Cache for pre-mined salts
const SALT_CACHE_SIZE = 10;
const MINING_TIMEOUT_MS = 30000; // 30 seconds
const TARGET_PREFIX = '0x1152';

class SaltMiningService {
    /**
     * @param {object} services - Required service instances
     * @param {EthereumService} services.ethereumService - Instance of EthereumService
     * @param {object} config - Configuration object
     * @param {string} config.creditVaultAddress - The address of the CreditVault contract
     * @param {Array} config.creditVaultAbi - The ABI of the CreditVault contract
     * @param {object} logger - Logger instance
     */
    constructor(services, config, logger) {
        if (!services.ethereumService) {
            throw new Error('SaltMiningService: Missing ethereumService');
        }
        this.ethereumService = services.ethereumService;
        
        if (!config.creditVaultAddress || !config.creditVaultAbi) {
            throw new Error('SaltMiningService: Missing contract configuration');
        }
        this.contractConfig = {
            address: config.creditVaultAddress,
            abi: config.creditVaultAbi
        };

        this.logger = logger || console;
        this.saltCache = new Map(); // ownerAddress -> [salts]
        this.miningPromises = new Map(); // ownerAddress -> Promise
        
        // Start background cache filling
        this.startCacheFilling();
    }

    /**
     * Gets a salt that will create a vault address starting with 0x1152
     * First checks cache, then mines if needed
     * @param {string} ownerAddress - The address that will own the vault
     * @returns {Promise<{salt: string, predictedAddress: string}>}
     */
    async getSalt(ownerAddress) {
        // Check cache first
        const cachedSalts = this.saltCache.get(ownerAddress);
        if (cachedSalts && cachedSalts.length > 0) {
            const { salt, predictedAddress } = cachedSalts.pop();
            
            // If cache is getting low, trigger background mining
            if (cachedSalts.length < SALT_CACHE_SIZE / 2) {
                this.fillCache(ownerAddress).catch(err => {
                    this.logger.error('[SaltMiningService] Background cache filling failed:', err);
                });
            }
            
            return { salt, predictedAddress };
        }

        // No cache hit, mine a new salt
        return this.mineSalt(ownerAddress);
    }

    /**
     * Mines a new salt that will create a vault address starting with 0x1152
     * @param {string} ownerAddress - The address that will own the vault
     * @returns {Promise<{salt: string, predictedAddress: string}>}
     */
    async mineSalt(ownerAddress) {
        // Check if there's already a mining operation in progress
        let existingPromise = this.miningPromises.get(ownerAddress);
        if (existingPromise) {
            return existingPromise;
        }

        const promise = new Promise(async (resolve, reject) => {
            const worker = new Worker(path.join(__dirname, 'saltMiningWorker.js'), {
                workerData: {
                    ownerAddress,
                    creditVaultAddress: this.contractConfig.address,
                    targetPrefix: TARGET_PREFIX
                }
            });

            const timeoutId = setTimeout(() => {
                worker.terminate();
                reject(new Error('Salt mining timed out after 30 seconds'));
            }, MINING_TIMEOUT_MS);

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