const { ethers } = require('ethers');
// This service requires 'node-fetch'. Please install it with `npm install node-fetch@2`
const fetch = require('node-fetch');

// This is the address for native ETH in many contexts.
const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';

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
    
    this.logger.info('[PriceFeedService] Initialized.');
  }

  /**
   * Fetches the current USD price for a given token contract address.
   * @param {string} tokenAddress - The address of the ERC20 token contract, or the zero address for native ETH.
   * @returns {Promise<number>} The price of the token in USD. Returns 0 if no price can be found.
   */
  async getPriceInUsd(tokenAddress) {
    this.logger.info(`[PriceFeedService] Fetching price for token: ${tokenAddress}`);
    const network = 'eth-mainnet'; // This should be configured if supporting other chains

    if (tokenAddress.toLowerCase() === NATIVE_ETH_ADDRESS) {
      // Use "Token Prices By Symbol" for native ETH
      this.logger.info(`[PriceFeedService] Identified native ETH, using 'by-symbol' endpoint.`);
      const fetchURL = `https://api.g.alchemy.com/prices/v1/${this.alchemyApiKey}/tokens/by-symbol`;
      const params = new URLSearchParams({ symbols: 'ETH', currency: 'USD' });
      const urlWithParams = `${fetchURL}?${params.toString()}`;

      try {
        const response = await fetch(urlWithParams, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const json = await response.json();
        const ethData = json.data?.find(d => d.symbol === 'ETH');
        const price = ethData?.prices?.find(p => p.currency === 'usd')?.value;

        if (!price) throw new Error('Could not parse ETH price from Alchemy response.');
        
        return parseFloat(price);
      } catch (error) {
        this.logger.error(`[PriceFeedService] Failed to fetch price for ETH by symbol:`, error);
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
        const response = await fetch(fetchURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const json = await response.json();
        const tokenData = json.data?.[0];
        const price = tokenData?.prices?.find(p => p.currency === 'usd')?.value;
        
        if (!price) throw new Error(`Could not parse price for ${tokenAddress} from Alchemy response.`);

        return parseFloat(price);
      } catch (error) {
        this.logger.error(`[PriceFeedService] Failed to fetch price for ${tokenAddress}:`, error);
        return 0;
      }
    }
  }
}

module.exports = PriceFeedService; 