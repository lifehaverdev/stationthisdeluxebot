const { ethers } = require('ethers');
const { contracts } = require('../../contracts');

// A list of tokens that are always considered safe and can bypass deeper checks.
const TOKEN_WHITELIST = [
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC on Mainnet
    '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI on Mainnet
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'  // WETH on Mainnet
];

/**
 * @class TokenRiskEngine
 * @description Assesses the risk of accepting a given token as collateral.
 * It uses other services like DexService and PriceFeedService to analyze
 * on-chain liquidity and price data.
 */
class TokenRiskEngine {
  /**
   * @param {object} services - A container for required service instances.
   * @param {DexService} services.dexService - Instance of DexService.
   * @param {PriceFeedService} services.priceFeedService - Instance of PriceFeedService.
   * @param {object} logger - A logger instance.
   */
  constructor(services, logger) {
    this.logger = logger || console;
    
    const { dexService, priceFeedService } = services;
    if (!dexService || !priceFeedService) {
      throw new Error('TokenRiskEngine: Missing required services.');
    }
    this.dexService = dexService;
    this.priceFeedService = priceFeedService;

    // Define USDC as the stablecoin for liquidity checks.
    // This could be made configurable later if needed.
    const network = this.dexService._getNetworkName(this.dexService.ethereumService.chainId);
    this.usdcAddress = contracts.USDC.addresses[network];
    if (!this.usdcAddress) {
        throw new Error(`TokenRiskEngine: No USDC address found for network: ${network}`);
    }

    this.logger.info(`[TokenRiskEngine] Initialized for network ${network}.`);
  }

  /**
   * Assesses the risk of a token by checking its liquidity on a DEX.
   * A common way to probe for liquidity is to simulate a small swap.
   * @param {string} tokenAddress - The ERC20 address of the token to assess.
   * @param {string} amountInHuman - The amount of the token to test with, in human-readable format (e.g., "100").
   * @param {number} fee - The Uniswap V3 pool fee tier (e.g., 3000 for 0.3%).
   * @returns {Promise<object>} An object containing the risk assessment.
   */
  async assessLiquidity(tokenAddress, amountInHuman, fee) {
    this.logger.info(`[TokenRiskEngine] Assessing liquidity for token: ${tokenAddress}`);

    // First, get the token's price and decimals to calculate the amount in its smallest unit.
    const tokenMetadata = await this.priceFeedService.getMetadata(tokenAddress);
    const amountInSmallestUnit = ethers.parseUnits(amountInHuman, tokenMetadata.decimals);

    // Get a quote for swapping the token to USDC.
    const quote = await this.dexService.getSwapQuote(
      tokenAddress,
      this.usdcAddress,
      amountInSmallestUnit,
      fee
    );

    // If the quote is zero, it's a strong indicator of no liquidity.
    const hasSufficientLiquidity = quote !== 0n;

    const amountOutHuman = ethers.formatUnits(quote, 6); // USDC has 6 decimals

    this.logger.info(`[TokenRiskEngine] Liquidity assessment for ${tokenAddress}: Test swap of ${amountInHuman} yielded ${amountOutHuman} USDC. Sufficient liquidity: ${hasSufficientLiquidity}`);

    return {
      hasSufficientLiquidity,
      amountIn: amountInSmallestUnit.toString(),
      amountOut: quote.toString(),
      amountOutHuman,
      message: hasSufficientLiquidity
        ? 'Token has a liquid market against USDC.'
        : 'Token appears to have no direct liquidity pool against USDC.'
    };
  }

  /**
   * Assesses a token to determine if it's acceptable as collateral.
   * @param {string} tokenAddress - The address of the token to assess.
   * @param {string} depositAmountWei - The amount of the token being deposited.
   * @returns {Promise<{isSafe: boolean, reason: string, price: number, liquidationThreshold: number}>} An assessment result.
   */
  async assessCollateral(tokenAddress, depositAmountWei) {
    this.logger.info(`[TokenRiskEngine] Assessing collateral for token: ${tokenAddress}`);
    const normalizedAddress = tokenAddress.toLowerCase();

    // 1. Whitelist Check (Fast Path)
    if (TOKEN_WHITELIST.includes(normalizedAddress)) {
      this.logger.info(`[TokenRiskEngine] Token ${normalizedAddress} is on the whitelist. Accepting.`);
      return { isSafe: true, reason: 'WHITELISTED', price: 1.0, liquidationThreshold: 0.9 }; // Example threshold
    }

    // 2. Get Baseline Price
    const price = await this.priceFeedService.getPriceInUsd(normalizedAddress);
    if (price <= 0) {
      return { isSafe: false, reason: 'NO_RELIABLE_PRICE', price: 0, liquidationThreshold: 0 };
    }

    // 3. Liquidity & Price Impact Check
    // We simulate selling a fixed USD value of the token (e.g., $100) to check liquidity.
    const testAmountUsd = 100;
    const testAmountTokenWei = ethers.parseUnits(String(testAmountUsd / price), 18); // Assumes 18 decimals for simplicity
    
    // We need a stablecoin address to quote against, e.g., USDC
    const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const feeTier = 3000; // Common fee tier for stable pairs

    const quotedUsdcOut = await this.dexService.getSwapQuote(
        normalizedAddress, 
        usdcAddress,
        testAmountTokenWei.toString(),
        feeTier
    );
    
    if (quotedUsdcOut.isZero()) {
        return { isSafe: false, reason: 'NO_LIQUIDITY_POOL', price, liquidationThreshold: 0 };
    }

    // 4. Calculate Price Impact
    const expectedUsdcOut = ethers.parseUnits(String(testAmountUsd), 6); // USDC has 6 decimals
    const priceImpact = (expectedUsdcOut.sub(quotedUsdcOut)).mul(100).div(expectedUsdcOut); // In percentage
    
    this.logger.info(`[TokenRiskEngine] Price impact for selling $${testAmountUsd} of ${normalizedAddress}: ${priceImpact.toString()}%`);
    
    const MAX_PRICE_IMPACT = 10; // Allow up to 10% price impact
    if (priceImpact.gt(MAX_PRICE_IMPACT)) {
        return { isSafe: false, reason: 'HIGH_PRICE_IMPACT', price, liquidationThreshold: 0 };
    }

    // 5. (Optional) Add other checks like token security APIs here.

    this.logger.info(`[TokenRiskEngine] Token ${normalizedAddress} passed all checks.`);
    return { isSafe: true, reason: 'PASSED_CHECKS', price, liquidationThreshold: 0.75 }; // Stricter threshold for non-whitelisted
  }
}

module.exports = TokenRiskEngine; 