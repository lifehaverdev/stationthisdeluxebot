const { ethers } = require('ethers');
const { contracts } = require('../../contracts'); // Import contract details

/**
 * @class DexService
 * @description An abstraction layer for interacting with a Decentralized Exchange protocol.
 * This service will handle tasks like getting swap quotes and eventually executing swaps.
 * It will primarily interact with Uniswap V3 contracts.
 */
class DexService {
  /**
   * @param {object} services - A container for required service instances.
   * @param {EthereumService} services.ethereumService - Instance of EthereumService.
   * @param {object} logger - A logger instance.
   */
  constructor(services, logger) {
    this.logger = logger || console;
    
    const { ethereumService } = services;
    if (!ethereumService) {
      throw new Error('DexService: Missing required EthereumService.');
    }
    this.ethereumService = ethereumService;
    
    // Get the network name and quoter address based on the EthereumService's chainId
    const networkName = this._getNetworkName(this.ethereumService.chainId);
    if (!networkName) {
      throw new Error(`DexService: Unsupported chainId: ${this.ethereumService.chainId}`);
    }
    const quoterAddress = contracts.uniswapV3QuoterV2.addresses[networkName];
    if (!quoterAddress) {
        throw new Error(`DexService: No Uniswap V3 QuoterV2 address found for network: ${networkName}`);
    }

    this.quoterContract = this.ethereumService.getContract(
        quoterAddress,
        contracts.uniswapV3QuoterV2.abi
    );

    this.logger.info(`[DexService] Initialized for network ${networkName} with Quoter at ${quoterAddress}`);
  }

  /**
   * Maps a chain ID to a network name used in the addresses object.
   * @param {string} chainId - The chain ID.
   * @returns {string|null} The corresponding network name or null if not found.
   * @private
   */
  _getNetworkName(chainId) {
    switch (String(chainId)) {
        case '1':
            return 'mainnet';
        case '11155111':
            return 'sepolia';
        default:
            return null;
    }
  }

  /**
   * Gets a quote for a single-hop swap from a DEX protocol.
   * This is a read-only operation that simulates a trade without executing it.
   * @param {string} tokenInAddress - The address of the token to sell.
   * @param {string} tokenOutAddress - The address of the token to buy.
   * @param {string} amountIn - The amount of tokenIn to sell, in its smallest unit (e.g., wei).
   * @param {number} fee - The pool fee tier (e.g., 3000 for 0.3%).
   * @returns {Promise<ethers.BigNumber>} The amount of tokenOut that would be received.
   */
  async getSwapQuote(tokenInAddress, tokenOutAddress, amountIn, fee) {
    this.logger.info(`[DexService] Getting swap quote for ${amountIn} of ${tokenInAddress} -> ${tokenOutAddress}`);

    // TODO: IMPROVE QUOTING LOGIC.
    // The current implementation is a single-hop quote using the V3 QuoterV2 contract.
    // This is simple but has a major limitation: it will fail to find a quote if a direct
    // liquidity pool for the exact tokenIn -> tokenOut pair at the specified fee does not exist.
    // For many tokens (like PEPE/USDC), a direct pool is not the most liquid path.
    //
    // A robust solution requires a multi-hop routing capability. This would involve:
    // 1. Identifying common base pairs (e.g., WETH).
    // 2. Checking for quotes along different paths (e.g., TokenA -> WETH -> TokenB).
    // 3. Comparing the results to find the best possible quote.
    // This could be implemented using the Uniswap Universal Router or by building a path-finding logic.

    // This implementation now uses a real contract instance.
    // It will fail if the quoterAddress in the config is incorrect or
    // if a liquidity pool for the given pair and fee does not exist.
    try {
      const quoteParams = {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        amountIn: amountIn,
        fee: fee,
        sqrtPriceLimitX96: 0, // 0 for no limit
      };
      
      this.logger.debug('[DexService] Calling quoter with params:', quoteParams);

      // Use callStatic for read-only calls to get the return value without sending a transaction.
      const amountOut = await this.quoterContract.callStatic.quoteExactInputSingle(
          quoteParams.tokenIn,
          quoteParams.tokenOut,
          quoteParams.fee,
          quoteParams.amountIn,
          quoteParams.sqrtPriceLimitX96
      );
      
      return amountOut;
    } catch (error) {
      this.logger.error(`[DexService] Failed to get quote from Uniswap V3 Quoter:`, error.message);
      // If the quote fails, it often means no liquidity pool exists. Return 0.
      return BigInt(0);
    }
  }
}

module.exports = DexService; 