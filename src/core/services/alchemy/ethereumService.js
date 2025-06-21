const { JsonRpcProvider, Wallet, Contract } = require('ethers');

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
   * @param {string} config.privateKey - The private key of the application's signer wallet.
   * @param {object} logger - A logger instance.
   */
  constructor(config, logger) {
    this.logger = logger || console;
    
    if (!config || !config.rpcUrl || !config.privateKey) {
      this.logger.error('[EthereumService] RPC URL and Private Key are required for initialization.');
      throw new Error('EthereumService: Missing configuration.');
    }

    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.signer = new Wallet(config.privateKey, this.provider);
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
   * @returns {Promise<Array<import('ethers').EventLog>>} A list of event logs.
   */
  async getPastEvents(contractAddress, abi, eventName, fromBlock, toBlock) {
    this.logger.info(`[EthereumService] Fetching past '${eventName}' events from block ${fromBlock} to ${toBlock}`);
    try {
      const contract = this.getContract(contractAddress, abi);
      const eventFilter = contract.filters[eventName]();
      const events = await contract.queryFilter(eventFilter, fromBlock, toBlock);
      this.logger.info(`[EthereumService] Found ${events.length} '${eventName}' events.`);
      return events;
    } catch (error) {
      this.logger.error(`[EthereumService] Error fetching past events '${eventName}':`, error);
      throw error;
    }
  }
}

module.exports = EthereumService; 