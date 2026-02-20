const { ethers } = require('ethers');
// This service requires 'node-fetch'. Please install it with `npm install node-fetch@2`
const fetch = require('node-fetch');

// This is the address for native ETH in many contexts.
const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';

// MS2 token addresses
const MS2_ADDRESSES = {
  ETH: '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820',
  SOL: 'AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg'
};

// Price cache to avoid hammering external APIs
const priceCache = new Map();
const PRICE_CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * @class PriceFeedService
 * @description A dedicated service for fetching real-time and historical token prices.
 * This service will abstract the specific logic for interacting with price oracles
 * like Alchemy's Price Feed API or Chainlink Data Feeds.
 */
class PriceFeedService {
  /**
   * @param {object} config - Configuration object.
   * @param {string} config.alchemyApiKey - The API key for Alchemy.
   * @param {object} logger - A logger instance.
   */
  constructor(config, logger) {
    this.logger = logger || console;
    
    if (!config || !config.alchemyApiKey) {
      this.logger.warn('[PriceFeedService] Alchemy API Key is missing. Service will use placeholder data.');
    }
    this.alchemyApiKey = config.alchemyApiKey;
    
    this.logger.debug('[PriceFeedService] Initialized.');
  }

  /**
   * Fetches metadata for a given token, such as its name, symbol, and decimals.
   * @param {string} tokenAddress - The address of the ERC20 token contract.
   * @returns {Promise<{name: string, symbol: string, decimals: number}>} An object with token metadata.
   */
  async getMetadata(tokenAddress) {
    this.logger.info(`[PriceFeedService] Fetching metadata for token: ${tokenAddress}`);
    // Note: This uses the public Alchemy RPC endpoint format.
    const fetchURL = `https://eth-mainnet.g.alchemy.com/v2/${this.alchemyApiKey}`;

    const requestBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'alchemy_getTokenMetadata',
      params: [tokenAddress]
    };

    try {
      const response = await fetch(fetchURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} ${await response.text()}`);
      }

      const json = await response.json();
      
      this.logger.info(`[PriceFeedService] Full metadata response for ${tokenAddress}: ${JSON.stringify(json, null, 2)}`);

      if (json.error) {
        throw new Error(`Alchemy API Error: ${json.error.message}`);
      }

      const { name, symbol, decimals } = json.result;
      if (decimals === null || decimals === undefined) {
          throw new Error(`Could not parse metadata for ${tokenAddress} from Alchemy response.`);
      }

      this.logger.info(`[PriceFeedService] Found metadata for ${symbol}: ${decimals} decimals.`);
      return { name, symbol, decimals };
    } catch (error) {
      this.logger.error(`[PriceFeedService] Failed to fetch metadata for ${tokenAddress}:`, error);
      throw error; // Re-throw the error to be caught by the caller
    }
  }

  /**
   * Fetches the current USD price for a given token contract address.
   * @param {string} tokenAddress - The address of the ERC20 token contract, or the zero address for native ETH.
   * @returns {Promise<number>} The price of the token in USD. Returns 0 if no price can be found.
   */
  /**
   * Fetches MS2 token price from CoinGecko with caching
   * @returns {Promise<number>} The price of MS2 in USD
   * @private
   */
  async _getMS2Price() {
    const CACHE_KEY = 'ms2_price';
    const MAX_ATTEMPTS = 2;
    const RETRY_DELAY_MS = 2_000; // 2 seconds (was 20 - too long)

    // Check cache first
    const cached = priceCache.get(CACHE_KEY);
    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL_MS) {
      this.logger.info(`[PriceFeedService] Using cached MS2 price: $${cached.price}`);
      return cached.price;
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10 second timeout

        const response = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=station-this&vs_currencies=usd',
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();
        const price = json['station-this']?.usd;

        if (!price) {
          throw new Error('Could not parse MS2 price from CoinGecko response.');
        }

        const parsedPrice = parseFloat(price);

        // Cache the result
        priceCache.set(CACHE_KEY, { price: parsedPrice, timestamp: Date.now() });
        this.logger.info(`[PriceFeedService] Fetched and cached MS2 price: $${parsedPrice}`);

        return parsedPrice;
      } catch (error) {
        const isTimeout = error.name === 'AbortError';
        this.logger.error(`[PriceFeedService] Attempt ${attempt} to fetch MS2 price failed:`, isTimeout ? 'Request timeout' : (error?.message || error));
        if (attempt < MAX_ATTEMPTS) {
          this.logger.info(`[PriceFeedService] Retrying MS2 price fetch in ${RETRY_DELAY_MS / 1000}s...`);
          await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
          continue;
        }
        // Exhausted retries - try to use stale cache if available
        if (cached) {
          this.logger.warn(`[PriceFeedService] Using stale cached MS2 price: $${cached.price}`);
          return cached.price;
        }
        this.logger.error('[PriceFeedService] All retry attempts to fetch MS2 price failed. Returning 0.');
        return 0;
      }
    }
  }

  async getPriceInUsd(tokenAddress) {
    this.logger.info(`[PriceFeedService] Fetching price for token: ${tokenAddress}`);
    const network = 'eth-mainnet'; // This should be configured if supporting other chains

    // Check if this is MS2 token
    if (tokenAddress.toLowerCase() === MS2_ADDRESSES.ETH.toLowerCase()) {
      this.logger.info('[PriceFeedService] Identified MS2 token, using CoinGecko price feed.');
      return this._getMS2Price();
    }

    const cacheKey = `price_${tokenAddress.toLowerCase()}`;

    // Check cache first
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL_MS) {
      this.logger.info(`[PriceFeedService] Using cached price for ${tokenAddress}: $${cached.price}`);
      return cached.price;
    }

    if (tokenAddress.toLowerCase() === NATIVE_ETH_ADDRESS) {
      // Use "Token Prices By Symbol" for native ETH
      this.logger.info(`[PriceFeedService] Identified native ETH, using 'by-symbol' endpoint.`);
      const fetchURL = `https://api.g.alchemy.com/prices/v1/${this.alchemyApiKey}/tokens/by-symbol`;
      const params = new URLSearchParams({ symbols: 'ETH', currency: 'USD' });
      const urlWithParams = `${fetchURL}?${params.toString()}`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);

        const response = await fetch(urlWithParams, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const json = await response.json();
        const ethData = json.data?.find(d => d.symbol === 'ETH');
        const price = ethData?.prices?.find(p => p.currency === 'usd')?.value;

        if (!price) throw new Error('Could not parse ETH price from Alchemy response.');

        const parsedPrice = parseFloat(price);
        priceCache.set(cacheKey, { price: parsedPrice, timestamp: Date.now() });
        return parsedPrice;
      } catch (error) {
        this.logger.error(`[PriceFeedService] Failed to fetch price for ETH by symbol:`, error?.message || error);
        // Return stale cache if available
        if (cached) return cached.price;
        return 0;
      }
    } else {
      // Use "Token Prices By Address" for all ERC20 tokens
      this.logger.info(`[PriceFeedService] Identified ERC20 token, using 'by-address' endpoint.`);
      const fetchURL = `https://api.g.alchemy.com/prices/v1/${this.alchemyApiKey}/tokens/by-address`;
      const requestBody = {
          addresses: [{ network, address: tokenAddress }],
          currency: "USD"
      };

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);

        const response = await fetch(fetchURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const json = await response.json();
        const tokenData = json.data?.[0];
        const price = tokenData?.prices?.find(p => p.currency === 'usd')?.value;

        if (!price) throw new Error(`Could not parse price for ${tokenAddress} from Alchemy response.`);

        const parsedPrice = parseFloat(price);
        priceCache.set(cacheKey, { price: parsedPrice, timestamp: Date.now() });
        return parsedPrice;
      } catch (error) {
        this.logger.error(`[PriceFeedService] Failed to fetch price for ${tokenAddress}:`, error?.message || error);
        // Return stale cache if available
        if (cached) return cached.price;
        return 0;
      }
    }
  }
}

module.exports = PriceFeedService; 