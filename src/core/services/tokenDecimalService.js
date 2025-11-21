const { formatUnits, parseUnits } = require('ethers');
const { getDecimals, getTokenConfig } = require('./alchemy/tokenConfig');

/**
 * Centralized Token Decimal Service
 * 
 * This service provides consistent decimal handling across all services,
 * eliminating hardcoded decimal assumptions and special cases.
 */
class TokenDecimalService {
  constructor() {
    this.logger = console; // Will be injected by calling service
  }

  /**
   * Get token decimals with proper error handling
   * @param {string} tokenAddress - Token contract address
   * @param {string} chainId - Chain ID (defaults to mainnet)
   * @returns {number} Token decimals
   */
  getTokenDecimals(tokenAddress, chainId = '1') {
    try {
      const decimals = getDecimals(tokenAddress, chainId);
      this.logger.debug(`[TokenDecimalService] Token ${tokenAddress} has ${decimals} decimals`);
      return decimals;
    } catch (error) {
      this.logger.error(`[TokenDecimalService] Failed to get decimals for ${tokenAddress}:`, error);
      // Fallback to 18 for unknown tokens (most common case)
      return 18;
    }
  }

  /**
   * Format token amount to human readable string
   * @param {string|BigInt} amount - Amount in smallest unit
   * @param {string} tokenAddress - Token contract address
   * @param {string} chainId - Chain ID (defaults to mainnet)
   * @returns {string} Human readable amount
   */
  formatTokenAmount(amount, tokenAddress, chainId = '1') {
    try {
      const decimals = this.getTokenDecimals(tokenAddress, chainId);
      return formatUnits(amount, decimals);
    } catch (error) {
      this.logger.error(`[TokenDecimalService] Failed to format amount for ${tokenAddress}:`, error);
      return '0';
    }
  }

  /**
   * Parse human readable amount to smallest unit
   * @param {string} amount - Human readable amount
   * @param {string} tokenAddress - Token contract address
   * @param {string} chainId - Chain ID (defaults to mainnet)
   * @returns {BigInt} Amount in smallest unit
   */
  parseTokenAmount(amount, tokenAddress, chainId = '1') {
    try {
      const decimals = this.getTokenDecimals(tokenAddress, chainId);
      let normalizedAmount = amount;
      if (typeof normalizedAmount !== 'string') {
        normalizedAmount = normalizedAmount?.toString();
      }
      if (typeof normalizedAmount !== 'string') {
        throw new Error(`Invalid amount type: ${typeof amount}`);
      }
      normalizedAmount = normalizedAmount.trim();
      try {
        return parseUnits(normalizedAmount, decimals);
      } catch (innerError) {
        if (innerError?.code === 'NUMERIC_FAULT' && innerError?.fault === 'underflow') {
          const sanitized = this._sanitizeAmountString(normalizedAmount, decimals);
          return parseUnits(sanitized, decimals);
        }
        throw innerError;
      }
    } catch (error) {
      this.logger.error(`[TokenDecimalService] Failed to parse amount for ${tokenAddress}:`, error);
      return 0n;
    }
  }

  _sanitizeAmountString(amount, decimals) {
    let value = amount.trim();
    if (!value.includes('.') || decimals <= 0) {
      return value;
    }
    const negative = value.startsWith('-');
    if (negative) {
      value = value.slice(1);
    }
    const [wholePartRaw, fractionRaw = ''] = value.split('.');
    const wholePart = wholePartRaw || '0';
    if (fractionRaw.length === 0) {
      return negative ? `-${wholePart}` : wholePart;
    }
    const trimmedFraction = fractionRaw.slice(0, decimals).replace(/0+$/, '');
    const sanitized = trimmedFraction.length ? `${wholePart}.${trimmedFraction}` : wholePart;
    return negative ? `-${sanitized}` : sanitized;
  }

  /**
   * Calculate USD value of token amount
   * @param {string|BigInt} amount - Amount in smallest unit
   * @param {string} tokenAddress - Token contract address
   * @param {number} priceInUsd - Token price in USD
   * @param {string} chainId - Chain ID (defaults to mainnet)
   * @returns {number} USD value
   */
  calculateUsdValue(amount, tokenAddress, priceInUsd, chainId = '1') {
    try {
      const humanReadable = this.formatTokenAmount(amount, tokenAddress, chainId);
      return parseFloat(humanReadable) * priceInUsd;
    } catch (error) {
      this.logger.error(`[TokenDecimalService] Failed to calculate USD value for ${tokenAddress}:`, error);
      return 0;
    }
  }

  /**
   * Get token metadata including decimals
   * @param {string} tokenAddress - Token contract address
   * @param {string} chainId - Chain ID (defaults to mainnet)
   * @returns {Object} Token metadata
   */
  getTokenMetadata(tokenAddress, chainId = '1') {
    try {
      const config = getTokenConfig(tokenAddress, chainId);
      if (!config) {
        return {
          symbol: 'UNKNOWN',
          decimals: 18,
          fundingRate: 0.7,
          donationFundingRate: 0.8,
          iconUrl: null
        };
      }
      return config;
    } catch (error) {
      this.logger.error(`[TokenDecimalService] Failed to get metadata for ${tokenAddress}:`, error);
      return {
        symbol: 'UNKNOWN',
        decimals: 18,
        fundingRate: 0.7,
        donationFundingRate: 0.8,
        iconUrl: null
      };
    }
  }

  /**
   * Validate token amount format
   * @param {string} amount - Amount to validate
   * @param {string} tokenAddress - Token contract address
   * @param {string} chainId - Chain ID (defaults to mainnet)
   * @returns {boolean} Whether amount is valid
   */
  validateTokenAmount(amount, tokenAddress, chainId = '1') {
    try {
      const decimals = this.getTokenDecimals(tokenAddress, chainId);
      const parsed = parseUnits(amount, decimals);
      return parsed >= 0n;
    } catch (error) {
      this.logger.error(`[TokenDecimalService] Invalid amount format for ${tokenAddress}:`, error);
      return false;
    }
  }

  /**
   * Set logger instance
   * @param {Object} logger - Logger instance
   */
  setLogger(logger) {
    this.logger = logger;
  }
}

// Export singleton instance
const tokenDecimalService = new TokenDecimalService();
module.exports = tokenDecimalService;
