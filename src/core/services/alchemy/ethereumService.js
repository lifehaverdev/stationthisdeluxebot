const { JsonRpcProvider, Wallet, Contract, formatEther, Interface, isAddress } = require('ethers');

/**
 * @class EthereumService
 * @description A low-level service for all direct blockchain communications.
 * This service acts as the single gateway for all interactions with the Ethereum blockchain,
 * as outlined in ADR-010. It manages the connection, signer, and provides generic methods
 * to read from and write to smart contracts.
 */
class EthereumService {
  /**
   * @param {object} config - Configuration object.
   * @param {string} config.rpcUrl - The Ethereum RPC URL (from Alchemy).
   * @param {object} services - A container for required service instances.
   * @param {PriceFeedService} services.priceFeedService - Instance of PriceFeedService for price lookups.
   * @param {object} logger - A logger instance.
   */
  constructor(config, services, logger) {
    this.logger = logger || console;
    
    const privateKey = process.env.ETHEREUM_SIGNER_PRIVATE_KEY;

    if (!config || !config.rpcUrl || !privateKey) {
      this.logger.error('[EthereumService] RPC URL and a PRIVATE_KEY environment variable are required.');
      throw new Error('EthereumService: Missing configuration or private key.');
    }
    if (!services || !services.priceFeedService) {
        this.logger.error('[EthereumService] PriceFeedService is required for gas cost estimation.');
        throw new Error('EthereumService: Missing PriceFeedService.');
    }
    this.priceFeedService = services.priceFeedService;

    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.signer = new Wallet(privateKey, this.provider);
    this.chainId = config.chainId; // Allow chainId to be passed in.
    this.interfaceCache = new Map(); // For caching ethers.Interface objects
    this.MAX_CACHE_SIZE = 100; // LRU cache size limit
    this.cacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0
    };

    this.logger.info(`[EthereumService] Initialized for address: ${this.signer.address} on chainId: ${this.chainId}`);
    this.logger.info(`[EthereumService] DEBUG: Private key loaded from ETHEREUM_SIGNER_PRIVATE_KEY: ${privateKey ? 'YES' : 'NO'}`);
    this.logger.info(`[EthereumService] DEBUG: Signer address: ${this.signer.address}`);
  }

  /**
   * Helper to get or create a cached Interface object from an ABI.
   * Implements LRU cache with size limit to prevent memory leaks.
   * @param {Array} abi - The contract ABI.
   * @returns {import('ethers').Interface}
   * @private
   */
  _getInterface(abi) {
    if (!Array.isArray(abi) || abi.length === 0) {
      throw new Error('ABI must be a non-empty array');
    }
    
    const abiString = JSON.stringify(abi);
    
    // Check cache (LRU: move to end on access)
    if (this.interfaceCache.has(abiString)) {
      this.cacheStats.hits++;
      const iface = this.interfaceCache.get(abiString);
      // Move to end (most recently used)
      this.interfaceCache.delete(abiString);
      this.interfaceCache.set(abiString, iface);
      return iface;
    }
    
    // Cache miss
    this.cacheStats.misses++;
    
    // Evict oldest if cache is full
    if (this.interfaceCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.interfaceCache.keys().next().value;
      this.interfaceCache.delete(firstKey);
      this.cacheStats.evictions++;
      this.logger.debug(`[EthereumService] Evicted oldest Interface from cache. Cache size: ${this.interfaceCache.size}`);
    }
    
    this.logger.debug('[EthereumService] Caching new ethers.Interface for a given ABI.');
    const iface = new Interface(abi);
    this.interfaceCache.set(abiString, iface);
    return iface;
  }

  /**
   * Get cache statistics for monitoring and tuning.
   * @returns {object} Cache statistics including hit rate, size, and max size.
   */
  getCacheStats() {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return {
      ...this.cacheStats,
      hitRate: total > 0 ? (this.cacheStats.hits / total * 100).toFixed(2) + '%' : '0%',
      size: this.interfaceCache.size,
      maxSize: this.MAX_CACHE_SIZE
    };
  }

  /**
   * Returns the underlying ethers.js Provider instance.
   * @returns {import('ethers').Provider}
   */
  getProvider() {
    return this.provider;
  }

  /**
   * Returns the underlying ethers.js Signer instance.
   * @returns {import('ethers').Signer}
   */
  getSigner() {
    return this.signer;
  }

  /**
   * Returns an ethers.js Contract instance.
   * @param {string} address - The address of the smart contract.
   * @param {Array} abi - The ABI of the smart contract.
   * @param {boolean} [asSigner=false] - Whether to connect the contract to the signer.
   * @returns {Contract}
   */
  getContract(address, abi, asSigner = false) {
    const contract = new Contract(address, abi, this.provider);
    return asSigner ? contract.connect(this.signer) : contract;
  }

  /**
   * Executes a read-only (view/pure) contract function.
   * @param {string} contractAddress - The address of the smart contract.
   * @param {Array} abi - The ABI of the smart contract.
   * @param {string} functionName - The name of the function to call.
   * @param {Array} args - The arguments to pass to the function.
   * @returns {Promise<any>} The result of the contract call.
   */
  async read(contractAddress, abi, functionName, ...args) {
    this.logger.info(`[EthereumService] Executing read operation: ${functionName} on ${contractAddress}`);
    
    if (!isAddress(contractAddress)) {
      throw new Error(`Invalid contract address: ${contractAddress}`);
    }
    
    return await this._retryOperation(async () => {
      const contract = this.getContract(contractAddress, abi, false);
      return await contract[functionName](...args);
    }, `read(${functionName})`);
  }

  /**
   * Executes a state-changing (write) contract function and returns the response immediately.
   * Does NOT wait for the transaction to be mined.
   * @param {string} contractAddress - The address of the smart contract.
   * @param {Array} abi - The ABI of the smart contract.
   * @param {string} functionName - The name of the function to execute.
   * @param {Array} args - The arguments to pass to the function.
   * @returns {Promise<import('ethers').TransactionResponse>} The initial transaction response.
   */
  async write(contractAddress, abi, functionName, ...args) {
    this.logger.info(`[EthereumService] Sending write transaction: ${functionName} on ${contractAddress}`);
    this.logger.info(`[EthereumService] DEBUG: Transaction will be signed by: ${this.signer.address}`);
    
    if (!isAddress(contractAddress)) {
      throw new Error(`Invalid contract address: ${contractAddress}`);
    }
    
    try {
      const contract = this.getContract(contractAddress, abi, true);
      const txResponse = await contract[functionName](...args);
      this.logger.info(`[EthereumService] Transaction sent with hash: ${txResponse.hash}.`);
      this.logger.info(`[EthereumService] DEBUG: Transaction from address: ${txResponse.from}`);
      return txResponse;
    } catch (error) {
      const context = {
        operation: 'write',
        contractAddress,
        functionName,
        args: args.map(a => typeof a === 'bigint' ? a.toString() : a),
        originalError: error.message
      };
      this.logger.error(`[EthereumService] Error sending transaction '${functionName}':`, context);
      const enhancedError = new Error(`Write operation failed: ${functionName} on ${contractAddress}. ${error.message}`);
      enhancedError.cause = error;
      throw enhancedError;
    }
  }

  /**
   * Waits for a transaction to be confirmed and returns the receipt.
   * @param {import('ethers').TransactionResponse} txResponse - The response object from a `write` call.
   * @param {object} [options={}] - Options for confirmation.
   * @param {number} [options.confirmations=1] - Number of block confirmations to wait for.
   * @param {number} [options.timeoutMs=300000] - Timeout in milliseconds (default: 5 minutes).
   * @returns {Promise<import('ethers').TransactionReceipt>} The transaction receipt after it's confirmed.
   */
  async waitForConfirmation(txResponse, options = {}) {
    const {
      confirmations = 1,
      timeoutMs = 300000 // 5 minutes default
    } = options;
    
    if (!txResponse || typeof txResponse.wait !== 'function') {
      this.logger.error('[EthereumService] waitForConfirmation received an invalid transaction response object.');
      throw new Error('Invalid input: txResponse must be a valid TransactionResponse object.');
    }
    
    this.logger.info(`[EthereumService] Waiting for ${confirmations} confirmation(s) of tx: ${txResponse.hash}...`);
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Transaction confirmation timeout after ${timeoutMs}ms. Hash: ${txResponse.hash}`));
      }, timeoutMs);
    });
    
    try {
      const receipt = await Promise.race([
        txResponse.wait(confirmations),
        timeoutPromise
      ]);
      
      this.logger.info(`[EthereumService] Transaction ${txResponse.hash} confirmed in block: ${receipt.blockNumber}`);
      
      if (!receipt || !receipt.hash || receipt.hash !== txResponse.hash) {
        this.logger.error(`[EthereumService] CRITICAL: Received an invalid receipt for a confirmed transaction! Hash: ${txResponse.hash}`, { receipt });
        throw new Error(`Invalid receipt received for transaction ${txResponse.hash}`);
      }
      
      if (receipt.status === 0) {
        throw new Error(`Transaction ${txResponse.hash} reverted. Check contract execution.`);
      }
      
      return receipt;
    } catch (error) {
      if (error.message.includes('timeout')) {
        // Check if transaction is still pending
        try {
          const tx = await this.provider.getTransaction(txResponse.hash);
          if (tx && tx.blockNumber === null) {
            this.logger.warn(`[EthereumService] Transaction ${txResponse.hash} still pending after timeout`);
          }
        } catch (checkError) {
          this.logger.error(`[EthereumService] Failed to check transaction status:`, checkError);
        }
      }
      this.logger.error(`[EthereumService] Error waiting for confirmation of tx ${txResponse.hash}:`, error);
      throw error;
    }
  }

  /**
   * Gets the latest block number from the blockchain.
   * Required for the startup reconciliation process.
   * @returns {Promise<number>} The latest block number.
   */
  async getLatestBlock() {
    this.logger.info('[EthereumService] Fetching latest block number...');
    return await this._retryOperation(async () => {
      return await this.provider.getBlockNumber();
    }, 'getLatestBlock');
  }

  /**
   * Health check for provider connectivity.
   * @returns {Promise<object>} Health status with blockNumber and chainId.
   */
  async healthCheck() {
    try {
      const blockNumber = await this.provider.getBlockNumber();
      return { healthy: true, blockNumber, chainId: this.chainId };
    } catch (error) {
      return { healthy: false, error: error.message, chainId: this.chainId };
    }
  }

  /**
   * Fetches historical events for a given contract and event name.
   * Required for the startup reconciliation process.
   * @param {string} contractAddress - The address of the smart contract.
   * @param {Array} abi - The ABI of the smart contract.
   * @param {string} eventName - The name of the event to query.
   * @param {number} fromBlock - The starting block number.
   * @param {number|string} toBlock - The ending block number (or 'latest').
   * @param {Array} [topics=[]] - An array of topics to filter by (for indexed event parameters).
   * @returns {Promise<Array<import('ethers').EventLog>>} A list of event logs.
   */
  async getPastEvents(contractAddress, abi, eventName, fromBlock, toBlock, topics = []) {
    this.logger.info(`[EthereumService] Fetching past '${eventName}' events from block ${fromBlock} to ${toBlock}`);
    
    if (!isAddress(contractAddress)) {
      throw new Error(`Invalid contract address: ${contractAddress}`);
    }
    
    // Resolve 'latest' to actual block number
    let resolvedToBlock = toBlock;
    if (toBlock === 'latest') {
      resolvedToBlock = await this.provider.getBlockNumber();
    }
    
    if (fromBlock > resolvedToBlock) {
      throw new Error(`Invalid block range: fromBlock (${fromBlock}) > toBlock (${resolvedToBlock})`);
    }
    
    const contract = this.getContract(contractAddress, abi);
    
    // Node providers often limit the block range for event queries.
    // We will chunk the requests to stay within common limits (e.g., 500 blocks for Alchemy).
    const MAX_BLOCK_RANGE = 499;
    let allEvents = [];
    
    try {
      const eventFilter = contract.filters[eventName](...topics);
      let currentBlock = fromBlock;
      while (currentBlock <= resolvedToBlock) {
        const endBlock = Math.min(currentBlock + MAX_BLOCK_RANGE, resolvedToBlock);
        this.logger.debug(`[EthereumService] Querying chunk for '${eventName}' from ${currentBlock} to ${endBlock}`);
        const events = await contract.queryFilter(eventFilter, currentBlock, endBlock);
        allEvents = allEvents.concat(events);
        currentBlock = endBlock + 1;
      }
      
      this.logger.info(`[EthereumService] Found ${allEvents.length} total '${eventName}' events across all chunks.`);
      return allEvents;
    } catch (error) {
      const context = {
        operation: 'getPastEvents',
        contractAddress,
        eventName,
        fromBlock,
        toBlock: resolvedToBlock,
        originalError: error.message
      };
      this.logger.error(`[EthereumService] Error fetching past events '${eventName}':`, context);
      throw error;
    }
  }

  /**
   * Estimates the gas cost for a transaction in USD.
   * @param {string} contractAddress - The address of the smart contract.
   * @param {Array} abi - The ABI of the smart contract.
   * @param {string} functionName - The name of the function to estimate.
   * @param {Array} args - The arguments to pass to the function.
   * @returns {Promise<number>} The estimated cost of the transaction in USD.
   */
  async estimateGasCostInUsd(contractAddress, abi, functionName, ...args) {
    this.logger.info(`[EthereumService] Estimating gas for ${functionName} on ${contractAddress}...`);
    
    if (!isAddress(contractAddress)) {
      throw new Error(`Invalid contract address: ${contractAddress}`);
    }
    
    try {
        const contract = this.getContract(contractAddress, abi, true); // Connect to signer for estimation
        
        let gasEstimate;
        try {
          gasEstimate = await contract[functionName].estimateGas(...args);
        } catch (error) {
          // Distinguish between simulation failures and network errors
          if (error.code === 'CALL_EXCEPTION' || error.reason) {
            throw new Error(`Gas estimation failed: Transaction would revert. ${error.reason || error.message}`);
          }
          throw error;
        }
        
        const feeData = await this.provider.getFeeData();

        // Use realistic gas price instead of worst-case maxFeePerGas
        // For EIP-1559: actual cost = baseFee + priorityFee (not maxFeePerGas which is a cap)
        // maxFeePerGas can be 2-3x higher than actual execution cost
        let effectiveGasPrice;
        if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
          // EIP-1559: Use current baseFee + priority fee for realistic estimate
          // baseFee is approximately: maxFeePerGas - maxPriorityFeePerGas (with some buffer)
          // For a more accurate estimate, use about 60% of maxFeePerGas
          const realisticGasPrice = (feeData.maxFeePerGas * 60n) / 100n;
          effectiveGasPrice = realisticGasPrice > feeData.maxPriorityFeePerGas
            ? realisticGasPrice
            : feeData.maxPriorityFeePerGas;
          this.logger.debug(`[EthereumService] EIP-1559 gas: maxFee=${feeData.maxFeePerGas}, using realistic=${effectiveGasPrice}`);
        } else if (feeData.gasPrice) {
          // Legacy: use gasPrice directly
          effectiveGasPrice = feeData.gasPrice;
          this.logger.debug(`[EthereumService] Legacy gas price: ${effectiveGasPrice}`);
        } else {
          throw new Error('Could not retrieve gas price from provider.');
        }

        const estimatedCostEth = gasEstimate * effectiveGasPrice;

        const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
        const ethPriceUsd = await this.priceFeedService.getPriceInUsd(NATIVE_ETH_ADDRESS);
        
        if (!ethPriceUsd || ethPriceUsd <= 0) {
            throw new Error('Could not retrieve a valid ETH price to calculate gas cost in USD.');
        }
        
        const estimatedCostUsd = parseFloat(formatEther(estimatedCostEth)) * ethPriceUsd;

        this.logger.info(`[EthereumService] Gas estimation complete. Est. Gas: ${gasEstimate}, Gas Price: ${formatEther(effectiveGasPrice * 1000000000n)} gwei, Est. Cost: ~${estimatedCostUsd.toFixed(4)} USD`);
        this.logger.debug('[EthereumService] Note: Using realistic gas price (60% of maxFeePerGas) instead of worst-case for profitability checks.');
        return estimatedCostUsd;

    } catch (error) {
        const context = {
          operation: 'estimateGasCostInUsd',
          contractAddress,
          functionName,
          originalError: error.message
        };
        this.logger.error(`[EthereumService] Error during gas estimation for '${functionName}':`, context);
        throw error;
    }
  }

  /**
   * Retrieves an event fragment (metadata) from a contract's ABI.
   * @param {string} eventName - The name of the event.
   * @param {Array} abi - The contract's ABI.
   * @returns {import('ethers').EventFragment | null} The event fragment or null if not found.
   */
  getEventFragment(eventName, abi) {
    const iface = this._getInterface(abi);
    return iface.getEvent(eventName);
  }

  /**
   * Calculates the topic hash for a given event fragment.
   * @param {import('ethers').EventFragment} eventFragment - The event fragment.
   * @returns {string} The topic hash (event signature).
   */
  getEventTopic(eventFragment) {
    if (!eventFragment) return null;
    return eventFragment.topicHash;
  }

  /**
   * Decodes the data and topics of an event log.
   * @param {import('ethers').EventFragment} eventFragment - The fragment for the event to decode.
   * @param {string} data - The data field from the raw event log.
   * @param {Array<string>} topics - The topics from the raw event log.
   * @param {Array} abi - The contract ABI, needed to get the interface.
   * @returns {import('ethers').Result} The decoded log arguments.
   */
  decodeEventLog(eventFragment, data, topics, abi) {
    if (!eventFragment) {
      throw new Error('Event fragment is required for decoding');
    }
    
    try {
      const iface = this._getInterface(abi);
      return iface.decodeEventLog(eventFragment, data, topics);
    } catch (error) {
      this.logger.error(`[EthereumService] Failed to decode event log:`, {
        eventFragment: eventFragment?.name,
        data,
        topics,
        error: error.message
      });
      throw new Error(`Event decoding failed: ${error.message}`);
    }
  }

  /**
   * Retry an operation with exponential backoff for transient failures.
   * @param {Function} operation - Async function to retry.
   * @param {string} operationName - Name of the operation for logging.
   * @param {number} maxRetries - Maximum number of retry attempts (default: 3).
   * @returns {Promise<any>} Result of the operation.
   * @private
   */
  async _retryOperation(operation, operationName, maxRetries = 3) {
    let lastError;
    const baseDelay = 1000; // 1 second
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Check if error is retryable
        const isRetryable = this._isRetryableError(error);
        
        if (!isRetryable || attempt >= maxRetries) {
          // Non-retryable error or exhausted retries
          const context = {
            operation: operationName,
            attempt,
            maxRetries,
            originalError: error.message
          };
          this.logger.error(`[EthereumService] ${operationName} failed:`, context);
          throw error;
        }
        
        // Calculate exponential backoff
        const delay = baseDelay * Math.pow(2, attempt - 1);
        this.logger.warn(`[EthereumService] ${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`, error.message);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  /**
   * Check if an error is retryable (transient failure).
   * @param {Error} error - The error to check.
   * @returns {boolean} Whether the error is retryable.
   * @private
   */
  _isRetryableError(error) {
    // Network errors
    if (error.code === 'NETWORK_ERROR' || 
        error.code === 'TIMEOUT' ||
        error.message?.includes('timeout') ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('ENOTFOUND') ||
        error.message?.includes('ETIMEDOUT')) {
      return true;
    }
    
    // Rate limiting
    if (error.status === 429 || error.code === 429) {
      return true;
    }
    
    // RPC errors that might be transient
    if (error.code === -32005 || // Request limit exceeded
        error.code === -32002) { // Too many requests
      return true;
    }
    
    // Non-retryable: contract reverts, invalid transactions, etc.
    return false;
  }
}

module.exports = EthereumService; 