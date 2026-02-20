const { ethers, JsonRpcProvider, Contract } = require('ethers');
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
    // Keep the original service to know the transactional network (e.g., Sepolia).
    this.ethereumService = ethereumService; 
    
    // For quoting, we ALWAYS use mainnet as it has the real liquidity pools.
    const quoteNetwork = 'mainnet';
    let mainnetRpcUrl = process.env.ETHEREUM_MAINNET_RPC_URL;
    
    // If the specific mainnet RPC URL isn't set, try to construct it from the Alchemy secret.
    if (!mainnetRpcUrl && process.env.ALCHEMY_SECRET) {
      mainnetRpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_SECRET}`;
      this.logger.debug('[DexService] Constructed mainnet RPC URL from ALCHEMY_SECRET.');
    }

    if (!mainnetRpcUrl) {
      this.logger.error('[DexService] ETHEREUM_MAINNET_RPC_URL or ALCHEMY_SECRET is not set in .env. Quoting will be disabled.');
      // Allow the service to start but log that it can't quote.
      this.quoterContract = null; 
      return;
    }

    this.quoteProvider = new JsonRpcProvider(mainnetRpcUrl);

    const quoterAddress = contracts.uniswapV3QuoterV2.addresses[quoteNetwork];
    if (!quoterAddress) {
        throw new Error(`DexService: No Uniswap V3 QuoterV2 address found for network: ${quoteNetwork}`);
    }

    // Create the quoter contract instance using the mainnet provider.
    this.quoterContract = new Contract(
        quoterAddress,
        contracts.uniswapV3QuoterV2.abi,
        this.quoteProvider
    );

    const transactionalNetworkName = this._getNetworkName(this.ethereumService.chainId);
    this.logger.debug(`[DexService] Initialized for on-chain TX on network ${transactionalNetworkName}.`);
    this.logger.debug(`[DexService] Configured for swap quoting on ${quoteNetwork} with Quoter at ${quoterAddress}`);
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
    this.logger.debug(`[DexService] Getting swap quote for ${amountIn} of ${tokenInAddress} -> ${tokenOutAddress} on mainnet`);

    if (!this.quoterContract) {
      this.logger.error('[DexService] Quoting is disabled because no mainnet RPC URL is configured.');
      return BigInt(0);
    }

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

    try {
      const quoteParams = {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        amountIn: amountIn,
        fee: fee,
        sqrtPriceLimitX96: 0, // 0 for no limit
      };
      
      this.logger.debug('[DexService] Calling mainnet quoter with params:', quoteParams);

      // Use callStatic for read-only calls to get the return value without sending a transaction.
      const { 0: amountOut } = await this.quoterContract.quoteExactInputSingle.staticCall(
          quoteParams
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