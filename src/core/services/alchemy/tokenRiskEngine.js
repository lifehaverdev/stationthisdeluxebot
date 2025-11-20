const { ethers } = require('ethers');
const { contracts } = require('../../contracts');
const tokenDecimalService = require('../tokenDecimalService');

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
    tokenDecimalService.setLogger(this.logger);
    
    const { dexService, priceFeedService } = services;
    if (!dexService || !priceFeedService) {
      throw new Error('TokenRiskEngine: Missing required services.');
    }
    this.dexService = dexService;
    this.priceFeedService = priceFeedService;

    // Define USDC as the stablecoin for liquidity checks.
    // This could be made configurable later if needed.
    const network = 'mainnet';
    this.usdcAddress = contracts.USDC.addresses[network];
    if (!this.usdcAddress) {
        throw new Error(`TokenRiskEngine: No USDC address found for network: ${network}`);
    }

    this.logger.info(`[TokenRiskEngine] Initialized for liquidity checks against mainnet USDC.`);
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
    const amountInSmallestUnit = tokenDecimalService.parseTokenAmount(amountInHuman, tokenAddress);

    // Get a quote for swapping the token to USDC.
    const quote = await this.dexService.getSwapQuote(
      tokenAddress,
      this.usdcAddress,
      amountInSmallestUnit,
      fee
    );

    // If the quote is zero, it's a strong indicator of no liquidity.
    const hasSufficientLiquidity = quote !== 0n;

    const amountOutHuman = tokenDecimalService.formatTokenAmount(quote, this.usdcAddress);

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
   * Gets the USDC address for a given chain
   * @param {string} chainId - Chain ID (defaults to '1' for mainnet)
   * @returns {string} USDC address for the chain
   * @private
   */
  _getUsdcAddressForChain(chainId = '1') {
    // Map chain IDs to network names used in contracts
    const chainIdToNetwork = {
      '1': 'mainnet',
      '11155111': 'sepolia',
      '42161': 'arbitrum',
      '8453': 'base'
    };
    
    const network = chainIdToNetwork[String(chainId)] || 'mainnet';
    const usdcAddress = contracts.USDC.addresses[network];
    
    if (!usdcAddress) {
      this.logger.warn(`[TokenRiskEngine] No USDC address found for chain ${chainId}, falling back to mainnet`);
      return contracts.USDC.addresses['mainnet'];
    }
    
    return usdcAddress;
  }

  /**
   * Assesses a token to determine if it's acceptable as collateral.
   * @param {string} tokenAddress - The address of the token to assess.
   * @param {string} depositAmountWei - The amount of the token being deposited.
   * @param {string} chainId - Optional chain ID (defaults to '1' for mainnet)
   * @returns {Promise<{isSafe: boolean, reason: string, price: number, liquidationThreshold: number}>} An assessment result.
   */
  async assessCollateral(tokenAddress, depositAmountWei, chainId = '1') {
    this.logger.info(`[TokenRiskEngine] Assessing collateral for token: ${tokenAddress}`);
    
    // Input validation
    if (!tokenAddress || typeof tokenAddress !== 'string') {
      this.logger.error(`[TokenRiskEngine] Invalid tokenAddress: ${tokenAddress}`);
      return { isSafe: false, reason: 'INVALID_TOKEN_ADDRESS', price: 0, liquidationThreshold: 0 };
    }
    
    if (!depositAmountWei || BigInt(depositAmountWei) <= 0n) {
      this.logger.error(`[TokenRiskEngine] Invalid depositAmountWei: ${depositAmountWei}`);
      return { isSafe: false, reason: 'INVALID_DEPOSIT_AMOUNT', price: 0, liquidationThreshold: 0 };
    }
    
    const normalizedAddress = tokenAddress.toLowerCase();

    // 0. Check if it's native ETH
    if (normalizedAddress === '0x0000000000000000000000000000000000000000') {
      this.logger.info(`[TokenRiskEngine] Detected native ETH. Bypassing liquidity checks.`);
      try {
        const price = await this.priceFeedService.getPriceInUsd(normalizedAddress);
        if (price <= 0) {
          return { isSafe: false, reason: 'NO_RELIABLE_PRICE', price: 0, liquidationThreshold: 0 };
        }
        return { isSafe: true, reason: 'NATIVE_ASSET', price, liquidationThreshold: 0.85 }; // High LTV for ETH
      } catch (error) {
        this.logger.error(`[TokenRiskEngine] Failed to fetch ETH price:`, error);
        return { isSafe: false, reason: 'PRICE_FETCH_ERROR', price: 0, liquidationThreshold: 0 };
      }
    }

    // 1. Whitelist Check (Fast Path)
    if (TOKEN_WHITELIST.includes(normalizedAddress)) {
      this.logger.info(`[TokenRiskEngine] Token ${normalizedAddress} is on the whitelist. Fetching actual price.`);
      try {
        // Fetch actual price even for whitelisted tokens (whitelist only bypasses liquidity checks)
        const price = await this.priceFeedService.getPriceInUsd(normalizedAddress);
        if (price <= 0) {
          this.logger.warn(`[TokenRiskEngine] Whitelisted token ${normalizedAddress} has invalid price, using fallback`);
          // For stablecoins, use 1.0 as fallback; for WETH, this shouldn't happen
          const fallbackPrice = normalizedAddress === '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' ? 0 : 1.0;
          return { isSafe: true, reason: 'WHITELISTED', price: fallbackPrice, liquidationThreshold: 0.9 };
        }
        return { isSafe: true, reason: 'WHITELISTED', price, liquidationThreshold: 0.9 };
      } catch (error) {
        this.logger.error(`[TokenRiskEngine] Failed to fetch price for whitelisted token:`, error);
        // Fallback to safe default for whitelisted tokens
        const fallbackPrice = normalizedAddress === '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' ? 0 : 1.0;
        return { isSafe: true, reason: 'WHITELISTED', price: fallbackPrice, liquidationThreshold: 0.9 };
      }
    }

    // 2. Get Baseline Price
    let price;
    try {
      price = await this.priceFeedService.getPriceInUsd(normalizedAddress);
    } catch (error) {
      this.logger.error(`[TokenRiskEngine] Failed to fetch price:`, error);
      return { isSafe: false, reason: 'PRICE_FETCH_ERROR', price: 0, liquidationThreshold: 0 };
    }
    
    if (price <= 0) {
      return { isSafe: false, reason: 'NO_RELIABLE_PRICE', price: 0, liquidationThreshold: 0 };
    }

    // 3. Liquidity & Price Impact Check
    // We simulate selling a fixed USD value of the token (e.g., $100) to check liquidity.
    const testAmountUsd = 100;
    let testAmountTokenWei;
    try {
      testAmountTokenWei = tokenDecimalService.parseTokenAmount(String(testAmountUsd / price), normalizedAddress);
    } catch (error) {
      this.logger.error(`[TokenRiskEngine] Failed to parse test amount:`, error);
      return { isSafe: false, reason: 'AMOUNT_PARSING_ERROR', price, liquidationThreshold: 0 };
    }
    
    // Get chain-aware USDC address (note: DEX quotes are always on mainnet, but we use chain-aware address for consistency)
    const usdcAddress = this._getUsdcAddressForChain(chainId);
    const feeTier = 3000; // Common fee tier for stable pairs

    let quotedUsdcOut;
    try {
      quotedUsdcOut = await this.dexService.getSwapQuote(
          normalizedAddress, 
          usdcAddress,
          testAmountTokenWei.toString(),
          feeTier
      );
    } catch (error) {
      this.logger.error(`[TokenRiskEngine] Failed to get swap quote:`, error);
      return { isSafe: false, reason: 'DEX_QUOTE_ERROR', price, liquidationThreshold: 0 };
    }
    
    if (quotedUsdcOut === 0n) {
        return { isSafe: false, reason: 'NO_LIQUIDITY_POOL', price, liquidationThreshold: 0 };
    }

    // 4. Calculate Price Impact
    let expectedUsdcOut;
    try {
      expectedUsdcOut = tokenDecimalService.parseTokenAmount(String(testAmountUsd), usdcAddress);
    } catch (error) {
      this.logger.error(`[TokenRiskEngine] Failed to parse expected USDC amount:`, error);
      return { isSafe: false, reason: 'AMOUNT_PARSING_ERROR', price, liquidationThreshold: 0 };
    }
    
    // Convert to BigInt for proper arithmetic
    const expectedUsdcOutBN = BigInt(expectedUsdcOut.toString());
    const quotedUsdcOutBN = BigInt(quotedUsdcOut.toString());
    
    // Calculate price impact percentage: ((expected - quoted) / expected) * 100
    if (expectedUsdcOutBN === 0n) {
      this.logger.error(`[TokenRiskEngine] Expected USDC out is zero, cannot calculate price impact`);
      return { isSafe: false, reason: 'PRICE_IMPACT_CALC_ERROR', price, liquidationThreshold: 0 };
    }
    
    const priceImpactNumerator = (expectedUsdcOutBN - quotedUsdcOutBN) * 100n;
    const priceImpact = Number(priceImpactNumerator / expectedUsdcOutBN);
    
    this.logger.info(`[TokenRiskEngine] Price impact for selling $${testAmountUsd} of ${normalizedAddress}: ${priceImpact.toFixed(2)}%`);
    
    const MAX_PRICE_IMPACT = 10; // Allow up to 10% price impact
    if (priceImpact > MAX_PRICE_IMPACT) {
        return { isSafe: false, reason: 'HIGH_PRICE_IMPACT', price, liquidationThreshold: 0 };
    }

    // 5. (Optional) Add other checks like token security APIs here.

    this.logger.info(`[TokenRiskEngine] Token ${normalizedAddress} passed all checks.`);
    return { isSafe: true, reason: 'PASSED_CHECKS', price, liquidationThreshold: 0.75 }; // Stricter threshold for non-whitelisted
  }
}

module.exports = TokenRiskEngine; 