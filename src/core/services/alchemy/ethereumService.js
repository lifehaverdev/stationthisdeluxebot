const { JsonRpcProvider, Wallet, Contract, formatEther } = require('ethers');

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

    this.logger.info(`[EthereumService] Initialized for address: ${this.signer.address} on chainId: ${this.chainId}`);
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
    try {
      // For read operations, we don't need a signer.
      const contract = this.getContract(contractAddress, abi, false);
      return await contract[functionName](...args);
    } catch (error) {
      this.logger.error(`[EthereumService] Error during read operation '${functionName}':`, error);
      throw error;
    }
  }

  /**
   * Executes a state-changing (write) contract function.
   * Handles the full transaction lifecycle.
   * @param {string} contractAddress - The address of the smart contract.
   * @param {Array} abi - The ABI of the smart contract.
   * @param {string} functionName - The name of the function to execute.
   * @param {Array} args - The arguments to pass to the function.
   * @returns {Promise<import('ethers').TransactionReceipt>} The transaction receipt after it's confirmed.
   */
  async write(contractAddress, abi, functionName, ...args) {
    this.logger.info(`[EthereumService] Executing write operation: ${functionName} on ${contractAddress}`);
    try {
      const contract = this.getContract(contractAddress, abi, true);
      const txResponse = await contract[functionName](...args);
      this.logger.info(`[EthereumService] Transaction sent: ${txResponse.hash}. Waiting for confirmation...`);
      const receipt = await txResponse.wait();
      this.logger.info(`[EthereumService] Transaction confirmed in block: ${receipt.blockNumber}`);
      return receipt;
    } catch (error) {
      this.logger.error(`[EthereumService] Error during write operation '${functionName}':`, error);
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
    try {
      return await this.provider.getBlockNumber();
    } catch (error) {
      this.logger.error('[EthereumService] Error fetching latest block:', error);
      throw error;
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
    const contract = this.getContract(contractAddress, abi);
    
    // Node providers often limit the block range for event queries.
    // We will chunk the requests to stay within common limits (e.g., 500 blocks for Alchemy).
    const MAX_BLOCK_RANGE = 499;
    let allEvents = [];
    
    try {
      const eventFilter = contract.filters[eventName](...topics);
      let currentBlock = fromBlock;
      while (currentBlock <= toBlock) {
        const endBlock = Math.min(currentBlock + MAX_BLOCK_RANGE, toBlock);
        this.logger.debug(`[EthereumService] Querying chunk for '${eventName}' from ${currentBlock} to ${endBlock}`);
        const events = await contract.queryFilter(eventFilter, currentBlock, endBlock);
        allEvents = allEvents.concat(events);
        currentBlock = endBlock + 1;
      }
      
      this.logger.info(`[EthereumService] Found ${allEvents.length} total '${eventName}' events across all chunks.`);
      return allEvents;
    } catch (error) {
      this.logger.error(`[EthereumService] Error fetching past events '${eventName}':`, error);
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
    try {
        const contract = this.getContract(contractAddress, abi, true); // Connect to signer for estimation
        const gasEstimate = await contract[functionName].estimateGas(...args);
        
        const feeData = await this.provider.getFeeData();
        const gasPrice = feeData.gasPrice; // Using gasPrice for simplicity; can be upgraded to EIP-1559 fields
        
        if (!gasPrice) {
            throw new Error('Could not retrieve gas price from provider.');
        }

        const estimatedCostEth = gasEstimate * gasPrice;

        const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
        const ethPriceUsd = await this.priceFeedService.getPriceInUsd(NATIVE_ETH_ADDRESS);
        
        if (!ethPriceUsd || ethPriceUsd <= 0) {
            throw new Error('Could not retrieve a valid ETH price to calculate gas cost in USD.');
        }
        
        const estimatedCostUsd = parseFloat(formatEther(estimatedCostEth)) * ethPriceUsd;

        this.logger.info(`[EthereumService] Gas estimation complete. Est. Gas: ${gasEstimate}, Est. Cost: ~${estimatedCostUsd.toFixed(4)} USD`);
        return estimatedCostUsd;

    } catch (error) {
        this.logger.error(`[EthereumService] Error during gas estimation for '${functionName}':`, error);
        // Return a high number to prevent proceeding with a failing transaction
        return Infinity;
    }
  }
}

module.exports = EthereumService; 