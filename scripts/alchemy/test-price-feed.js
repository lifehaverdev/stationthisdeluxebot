
const PriceFeedService = require('../../src/core/services/alchemy/priceFeedService');
const { createLogger } = require('../../src/utils/logger');

// --- Configuration ---
const { ALCHEMY_SECRET } = process.env;

const NATIVE_ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
const PEPE_ADDRESS = '0x6982508145454ce325ddbe47a25d4ec3d2311933';
const CULT_ADDRESS = '0x0000000000c5dc95539589fbd24be07c6c14eca4';
const MOG_ADDRESS = '0xaaee1a9723aadb7afa2810263653a34ba2c21c7a';

/**
 * Main test function.
 */
async function main() {
    const logger = createLogger('price-feed-test');
    logger.info('--- Starting PriceFeedService Test Script ---');

    if (!ALCHEMY_SECRET) {
        logger.error('ALCHEMY_SECRET is not set in your .env file. Please add it to proceed.');
        return;
    }

    const priceFeedService = new PriceFeedService({ alchemyApiKey: ALCHEMY_SECRET }, logger);

    const tokensToTest = [
        { name: 'ETH', address: NATIVE_ETH_ADDRESS },
        { name: 'PEPE', address: PEPE_ADDRESS },
        { name: 'CULT', address: CULT_ADDRESS },
        { name: 'MOG', address: MOG_ADDRESS },
        { name: 'Invalid Token', address: '0x1234567890123456789012345678901234567890' } // Should fail gracefully
    ];

    for (const token of tokensToTest) {
        try {
            logger.info(`\n--- Testing: ${token.name} (${token.address}) ---`);
            const price = await priceFeedService.getPriceInUsd(token.address);

            if (price > 0) {
                logger.info(`✅ Success! Price for ${token.name}: $${price}`);
            } else {
                logger.warn(`⚠️ Test for ${token.name} returned a zero or invalid price. This is expected for invalid tokens.`);
            }
        } catch (error) {
            logger.error(`❌ Test for ${token.name} Failed: ${error.message}`);
        }
    }

    logger.info('\n--- Test Script Finished ---');
}

main().catch(error => {
  console.error('An unexpected error occurred during the test script:', error);
  process.exit(1);
}); 