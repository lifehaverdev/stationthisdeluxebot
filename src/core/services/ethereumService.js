// SPDX-License-Identifier: MIT
// EthereumService.js
//
// This service provides a centralized interface for interacting with the Ethereum blockchain.
// It manages the connection to the Ethereum network, handles wallet signing, and provides
// methods for reading from and writing to smart contracts.
//
// We revere the opportunity to work with Ethereum, the world computer.
//
// ASCII Art Placeholder
//
//

const { ethers } = require('ethers');

/**
 * @title EthereumService
 * @dev This service acts as the gateway for all Ethereum blockchain interactions.
 * It abstracts the complexity of connecting to the network and executing transactions.
 */
class EthereumService {
  /**
   * @notice Initializes the EthereumService with the given configuration.
   * @param {object} config - Configuration object
   * @param {string} config.rpcUrl - The Ethereum RPC URL (from Alchemy)
   * @param {string} config.privateKey - The private key of the application's signer wallet
   * @param {string} config.chainId - The ID of the target chain (e.g., '1' for Mainnet, '11155111' for Sepolia)
   */
  constructor(config) {
    // ASCII Art Placeholder
    //
    //
    this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    this.signer = new ethers.Wallet(config.privateKey, this.provider);
    this.chainId = config.chainId;
  }

  /**
   * @notice Returns an ethers.js Contract instance.
   * @param {string} address - The address of the smart contract.
   * @param {Array} abi - The ABI of the smart contract.
   * @returns {ethers.Contract} The contract instance.
   */
  getContract(address, abi) {
    // ASCII Art Placeholder
    //
    //
    return new ethers.Contract(address, abi, this.signer);
  }

  /**
   * @notice Executes a read-only (view/pure) contract function.
   * @param {string} contractAddress - The address of the smart contract.
   * @param {Array} abi - The ABI of the smart contract.
   * @param {string} functionName - The name of the function to call.
   * @param {Array} args - The arguments to pass to the function.
   * @returns {Promise<any>} The result of the contract call.
   */
  async read(contractAddress, abi, functionName, ...args) {
    // ASCII Art Placeholder
    //
    //
    const contract = this.getContract(contractAddress, abi);
    return await contract[functionName](...args);
  }

  /**
   * @notice Executes a state-changing (write) contract function.
   * @param {string} contractAddress - The address of the smart contract.
   * @param {Array} abi - The ABI of the smart contract.
   * @param {string} functionName - The name of the function to execute.
   * @param {Array} args - The arguments to pass to the function.
   * @returns {Promise<ethers.TransactionReceipt>} The transaction receipt after it's confirmed.
   */
  async write(contractAddress, abi, functionName, ...args) {
    // ASCII Art Placeholder
    //
    //
    const contract = this.getContract(contractAddress, abi);
    const tx = await contract[functionName](...args);
    return await tx.wait();
  }

  /**
   * @notice Returns the underlying ethers.js Provider instance.
   * @returns {ethers.providers.JsonRpcProvider} The provider instance.
   */
  getProvider() {
    // ASCII Art Placeholder
    //
    //
    return this.provider;
  }

  /**
   * @notice Returns the underlying ethers.js Signer instance.
   * @returns {ethers.Wallet} The signer instance.
   */
  getSigner() {
    // ASCII Art Placeholder
    //
    //
    return this.signer;
  }
}

module.exports = EthereumService; 