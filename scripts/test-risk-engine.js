// require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { ethers } = require('ethers');
const EthereumService = require('../src/core/services/alchemy/ethereumService');
const PriceFeedService = require('../src/core/services/alchemy/priceFeedService');
const DexService = require('../src/core/services/alchemy/dexService');
const TokenRiskEngine = require('../src/core/services/alchemy/tokenRiskEngine');
const { contracts } = require('../src/core/contracts');

// A simple logger to be used by the services
const logger = {
  info: (message) => console.log(`[INFO] ${message}`),
  warn: (message) => console.log(`[WARN] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`),
  debug: (message) => console.log(`[DEBUG] ${message}`),
};

async function main() {
  logger.info('--- Starting Token Risk Engine Test Script ---');


  if (!process.env.ETHEREUM_SIGNER_PRIVATE_KEY) {
    logger.error('Missing required environment variable: ETHEREUM_SIGNER_PRIVATE_KEY.');
    process.exit(1);
  }
  if (!process.env.ALCHEMY_SECRET) {
    logger.error('Missing required environment variable: ALCHEMY_SECRET.');
    process.exit(1);
  }
  if (!process.env.ETHEREUM_RPC_URL) {
    logger.error('Missing required environment variable: ETHEREUM_RPC_URL.');
    process.exit(1);
  }

  try {
    // Manually initialize only the required services
    logger.info('Initializing required services in isolation for MAINNET...');

    // 1. EthereumService
    logger.info('[test-script] Creating EthereumService for Mainnet...');
    logger.warn('[test-script] Make sure your .env file has a MAINNET_RPC_URL for this test.');
    const ethereumConfig = {
        rpcUrl: process.env.MAINNET_RPC_URL || process.env.ETHEREUM_RPC_URL,
        privateKey: process.env.ETHEREUM_SIGNER_PRIVATE_KEY,
        chainId: 1 // Force Mainnet for this liquidity test
    };
    const ethereumService = new EthereumService(ethereumConfig, logger);
    logger.info('[test-script] EthereumService created.');

    // 2. PriceFeedService (using ALCHEMY_SECRET)
    logger.info('[test-script] Creating PriceFeedService...');
    const priceFeedService = new PriceFeedService({ alchemyApiKey: process.env.ALCHEMY_SECRET }, logger);
    logger.info('[test-script] PriceFeedService created.');

    // 3. DexService
    logger.info('[test-script] Creating DexService...');
    const dexService = new DexService({ ethereumService }, logger);
    logger.info('[test-script] DexService created.');

    // 4. TokenRiskEngine
    logger.info('[test-script] Creating TokenRiskEngine...');
    const tokenRiskEngine = new TokenRiskEngine({ priceFeedService, dexService }, logger);
    logger.info('[test-script] TokenRiskEngine created.');
    
    // --- Test Cases ---
    const network = dexService._getNetworkName(dexService.ethereumService.chainId);
    logger.info(`Running tests on network: ${network}`);

    // Define tokens to test. Using Mainnet addresses as an example.
    const tokensToTest = {
        PEPE: { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', fee: 3000, amount: '1000000' }, // High liquidity
        MOG:  { address: '0xaaD16585145537f71f6Be7392121c83A72175A2a', fee: 3000, amount: '1000000000' }, // High liquidity
        CULT: { address: '0xf0F9D895a5a5d82761694A232731F2E538521452', fee: 3000, amount: '10000000' }, // Lower liquidity
        BADIDEA: { address: '0x32b861694d4D141974211110D49455325b41E456', fee: 3000, amount: '1000000000' }, // Very low/no liquidity example
    };

    for (const [name, token] of Object.entries(tokensToTest)) {
        logger.info(`\n--- Assessing ${name} (${token.address}) ---`);
        try {
            // Using a dynamic fee tier from our test object
            const result = await tokenRiskEngine.assessLiquidity(token.address, token.amount, token.fee);
            logger.info(`Assessment Result for ${name}:`);
            console.log(JSON.stringify(result, null, 2));

            if (result.hasSufficientLiquidity) {
                logger.info(`✅ PASSED: ${name} has sufficient liquidity. Test swap of ${token.amount} ${name} resulted in ${result.amountOutHuman} USDC.`);
            } else {
                logger.warn(`🔶 SKIPPED: ${name} has insufficient liquidity or no direct pool. This is expected for some tokens.`);
            }
        } catch (error) {
            logger.error(`❌ FAILED: Error assessing ${name}:`);
            console.error(error);
        }
    }

  } catch (error) {
    logger.error('An error occurred during the test script execution:');
    console.error(error);
    process.exit(1);
  } finally {
    logger.info('\n--- Test Script Finished ---');
  }
}

main(); 