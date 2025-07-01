const fetch = require('node-fetch');

// A placeholder whitelist of trusted NFT collection contract addresses.
// In a real application, this should be managed in a more dynamic way.
const NFT_COLLECTION_WHITELIST = [
    '0xbc4ca0edb7647a8ab7c2061c2e118a18a936f13d', // Bored Ape Yacht Club
    '0xbd3531da5cf5857e76f49122f693e5c4cc6450ca', // Pudgy Penguins
    '0x7bd29408f11d2bfc23c34f18275bbf23cf646e9c'  // Milady Maker
];

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const floorPriceCache = new Map();

/**
 * @class NftPriceService
 * @description A dedicated service for fetching floor prices for NFT collections.
 */
class NftPriceService {
  /**
   * @param {object} config - Configuration object.
   * @param {string} config.alchemyApiKey - The API key for Alchemy.
   * @param {object} services - A container for required service instances.
   * @param {PriceFeedService} services.priceFeedService - Instance of PriceFeedService.
   * @param {object} logger - A logger instance.
   */
  constructor(config, services, logger) {
    this.logger = logger || console;
    
    if (!config || !config.alchemyApiKey) {
      this.logger.error('[NftPriceService] Alchemy API Key is required.');
      throw new Error('NftPriceService: Missing Alchemy API Key.');
    }
    if (!services || !services.priceFeedService) {
        this.logger.error('[NftPriceService] PriceFeedService is required.');
        throw new Error('NftPriceService: Missing PriceFeedService.');
    }
    this.priceFeedService = services.priceFeedService;
    this.alchemyApiKey = config.alchemyApiKey;
    this.baseUrl = `https://eth-mainnet.g.alchemy.com/nft/v3/${this.alchemyApiKey}`;

    this.logger.info('[NftPriceService] Initialized.');
  }

  /**
   * Checks if a given NFT collection is on the supported whitelist.
   * @param {string} collectionAddress - The contract address of the NFT collection.
   * @returns {boolean} True if the collection is whitelisted, false otherwise.
   */
  isWhitelisted(collectionAddress) {
    return NFT_COLLECTION_WHITELIST.includes(collectionAddress.toLowerCase());
  }

  /**
   * Fetches the current floor price for an NFT collection, with caching.
   * @param {string} collectionAddress - The contract address of the NFT collection.
   * @returns {Promise<number|null>} The floor price of the collection in USD, or null if an error occurs or the price isn't available.
   */
  async getFloorPriceInUsd(collectionAddress) {
    const normalizedAddress = collectionAddress.toLowerCase();
    const cached = floorPriceCache.get(normalizedAddress);

    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        this.logger.info(`[NftPriceService] Returning cached floor price for ${normalizedAddress}: $${cached.price.toFixed(2)}`);
        return cached.price;
    }
    
    this.logger.info(`[NftPriceService] Fetching floor price for collection: ${normalizedAddress}`);

    const url = `${this.baseUrl}/getFloorPrice?contractAddress=${normalizedAddress}`;
    const options = {
        method: 'GET',
        headers: {
            'accept': 'application/json'
        }
    };

    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
      }

      const data = await response.json();
      
      const floorPriceEth = data?.openSea?.floorPrice;

      if (floorPriceEth === undefined || floorPriceEth === null) {
          this.logger.warn(`[NftPriceService] Floor price not available from OpenSea for collection ${normalizedAddress}. Full response: ${JSON.stringify(data)}`);
          return null;
      }
      
      this.logger.info(`[NftPriceService] Successfully fetched floor price for ${normalizedAddress}: ${floorPriceEth} ETH`);

      // Convert the ETH floor price to USD using the PriceFeedService.
      // The native ETH address is a constant we can use for this lookup.
      const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
      const ethPriceInUsd = await this.priceFeedService.getPriceInUsd(NATIVE_ETH_ADDRESS);

      if (!ethPriceInUsd || ethPriceInUsd <= 0) {
          this.logger.error(`[NftPriceService] Could not retrieve a valid ETH price from PriceFeedService.`);
          return null;
      }

      const floorPriceUsd = floorPriceEth * ethPriceInUsd;
      this.logger.info(`[NftPriceService] Converted floor price for ${normalizedAddress} to $${floorPriceUsd.toFixed(2)} USD.`);

      // Cache the successful result
      floorPriceCache.set(normalizedAddress, { price: floorPriceUsd, timestamp: Date.now() });

      return floorPriceUsd;

    } catch (error) {
      this.logger.error(`[NftPriceService] Failed to fetch floor price for ${normalizedAddress}:`, error);
      return null;
    }
  }
}

module.exports = NftPriceService; 