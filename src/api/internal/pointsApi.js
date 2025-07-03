const express = require('express');

// Mock data based on constants in creditService.js
// In a real implementation, this might come from a config file or a database.
const TOKEN_FUNDING_RATES = {
    // Tier 1: 0.95
    '0x98ed411b8cf8536657c660db8aa55d9d4baaf820': { symbol: 'MS2', name: 'MS2', fundingRate: 0.95, tier: 1, decimals: 18, iconUrl: '/images/tokens/ms2.png' },
    '0x0000000000c5dc95539589fbd24be07c6c14eca4': { symbol: 'CULT', name: 'CULT', fundingRate: 0.95, tier: 1, decimals: 18, iconUrl: '/images/tokens/cult.png' },
    // Tier 2: 0.70
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', name: 'USD Coin', fundingRate: 0.70, tier: 2, decimals: 6, iconUrl: '/images/tokens/usdc.png' },
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', name: 'Wrapped Ether', fundingRate: 0.70, tier: 2, decimals: 18, iconUrl: '/images/tokens/weth.png' },
    '0x0000000000000000000000000000000000000000': { symbol: 'ETH', name: 'Ethereum', fundingRate: 0.70, tier: 2, decimals: 18, iconUrl: '/images/tokens/eth.png' },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', name: 'Tether', fundingRate: 0.70, tier: 2, decimals: 6, iconUrl: '/images/tokens/usdt.png' },
    // Tier 3: 0.60
    '0x6982508145454ce325ddbe47a25d4ec3d2311933': { symbol: 'PEPE', name: 'Pepe', fundingRate: 0.60, tier: 3, decimals: 18, iconUrl: '/images/tokens/pepe.png' },
    '0xaaeE1A9723aaDB7afA2810263653A34bA2C21C7a': { symbol: 'MOG', name: 'Mog Coin', fundingRate: 0.60, tier: 3, decimals: 18, iconUrl: '/images/tokens/mog.png' },
    '0xe0f63a424a4439cbe457d80e4f4b51ad25b2c56c': { symbol: 'SPX6900', name: 'SPX6900', fundingRate: 0.60, tier: 3, decimals: 18, iconUrl: '/images/tokens/spx6900.png' },
};

const TRUSTED_NFT_COLLECTIONS = {
    "0x524cab2ec69124574082676e6f654a18df49a048": { fundingRate: 1, name: "MiladyStation", tier: 1, iconUrl: "/images/nfts/miladystation.png" },
    "0xd3d9ddd0cf0a5f0bfb8f7fc9e046c5318a33c168": { fundingRate: 1, name: "Remilio", tier: 1, iconUrl: "/images/nfts/remilio.png" },
    "0x7bd29408f11d2bfc23c34f18275bbf23cf646e9c": { fundingRate: 1, name: "Milady", tier: 1, iconUrl: "/images/nfts/milady.png" },
};

function createPointsApi(dependencies) {
    const router = express.Router();
    const { creditService, priceFeedService, nftPriceService, logger } = dependencies;

    /**
     * @route GET /internal/v1/points/supported-assets
     * @description Fetches the list of all configured tokens and NFTs.
     * @access Internal
     */
    router.get('/supported-assets', (req, res, next) => {
        try {
            const tokens = Object.entries(TOKEN_FUNDING_RATES).map(([address, data]) => ({
                address,
                ...data
            }));

            const nfts = Object.entries(TRUSTED_NFT_COLLECTIONS).map(([address, data]) => ({
                address,
                ...data
            }));

            res.json({ tokens, nfts });
        } catch (error) {
            logger.error('Failed to get supported assets:', error);
            next(error);
        }
    });

    return router;
}

module.exports = createPointsApi; 