const { ethers } = require('ethers');
const { predictDeterministicAddressERC1967BeaconProxy, encodeCharteredFundInitArgs, hasVanityPrefix } = require('../../src/core/services/alchemy/beaconProxyHelper');
const { getFoundationAddress, getCharterBeaconAddress } = require('../../src/core/services/alchemy/foundationConfig');

// Known successful CharteredFund deployment transaction
const CHAIN_ID = '1'; // Mainnet
const TEST_CASE = {
    txHash: '0x1234...', // TODO: Replace with actual tx hash
    ownerAddress: '0xabcd...', // TODO: Replace with actual owner
    salt: '0xefgh...', // TODO: Replace with actual salt
    deployedAddress: '0x1152...', // TODO: Replace with actual deployed address
};

async function validateSaltMining() {
    console.log('Validating salt mining implementation against on-chain deployment...');
    
    const foundationAddress = getFoundationAddress(CHAIN_ID);
    const beaconAddress = getCharterBeaconAddress(CHAIN_ID);
    
    console.log(`Foundation Address: ${foundationAddress}`);
    console.log(`Beacon Address: ${beaconAddress}`);
    console.log(`Owner Address: ${TEST_CASE.ownerAddress}`);
    console.log(`Salt Used: ${TEST_CASE.salt}`);
    console.log(`Actual Deployed Address: ${TEST_CASE.deployedAddress}`);

    // Encode initialization args exactly as they would be on-chain
    const initArgs = encodeCharteredFundInitArgs(foundationAddress, TEST_CASE.ownerAddress);

    // Predict the address using our implementation
    const predictedAddress = predictDeterministicAddressERC1967BeaconProxy(
        beaconAddress,
        initArgs,
        TEST_CASE.salt,
        foundationAddress // Foundation contract is the deployer
    );

    console.log(`Our Predicted Address: ${predictedAddress}`);

    // Validate the prediction
    if (predictedAddress.toLowerCase() !== TEST_CASE.deployedAddress.toLowerCase()) {
        console.error('❌ VALIDATION FAILED: Predicted address does not match deployed address!');
        console.error('This means our implementation does not match the on-chain behavior.');
        process.exit(1);
    }

    // Validate vanity prefix
    if (!hasVanityPrefix(predictedAddress)) {
        console.error('❌ VALIDATION FAILED: Predicted address does not have required vanity prefix!');
        console.error('This means our vanity check implementation may be incorrect.');
        process.exit(1);
    }

    console.log('✅ VALIDATION PASSED: Our implementation exactly matches on-chain behavior!');

    // Optional: Test mining performance
    console.log('\nTesting mining performance...');
    const startTime = Date.now();
    let attempts = 0;
    let foundSalt = null;

    while (attempts < 500) {
        attempts++;
        const salt = ethers.randomBytes(32);
        const saltHex = ethers.hexlify(salt);
        
        const testAddress = predictDeterministicAddressERC1967BeaconProxy(
            beaconAddress,
            initArgs,
            saltHex,
            foundationAddress
        );

        if (hasVanityPrefix(testAddress)) {
            foundSalt = saltHex;
            break;
        }
    }

    const duration = Date.now() - startTime;
    
    if (foundSalt) {
        console.log(`✅ Found valid salt in ${attempts} attempts (${duration}ms)`);
        console.log(`Salt: ${foundSalt}`);
    } else {
        console.log(`❌ Failed to find valid salt within 500 attempts (${duration}ms)`);
    }
}

// If running directly (not imported as module)
if (require.main === module) {
    validateSaltMining().catch(error => {
        console.error('Validation failed with error:', error);
        process.exit(1);
    });
}

module.exports = { validateSaltMining };
