const { ethers } = require('ethers');
const { workerData, parentPort } = require('worker_threads');
const { predictDeterministicAddressERC1967BeaconProxy, encodeCharteredFundInitArgs, hasVanityPrefix } = require('./beaconProxyHelper');

// Get data passed to worker
const { ownerAddress, foundationAddress, beaconAddress } = workerData;

if (!beaconAddress) {
    throw new Error('SaltMiningWorker: Missing beaconAddress from workerData.');
}

// Pre-calculate the initialization args once, as they're constant for this worker run
const initArgs = encodeCharteredFundInitArgs(foundationAddress, ownerAddress);

/**
 * Computes the predicted address for a new CharteredFund beacon proxy.
 * @param {string} salt - The 32-byte salt, as a hex string.
 * @returns {string} The predicted proxy address.
 */
function computeProxyAddress(salt) {
    return predictDeterministicAddressERC1967BeaconProxy(
        beaconAddress,
        initArgs,
        salt,
        foundationAddress // The foundation contract is the deployer
    );
}

// Mine for a salt that generates an address with the target prefix
function mineSalt() {
    let attempts = 0;
    const maxAttempts = 1000000; // A reasonable limit to prevent infinite loops

    while (attempts < maxAttempts) {
        // Generate a random 32-byte salt
        const salt = ethers.randomBytes(32);
        const saltHex = ethers.hexlify(salt);

        // Compute the address that would be created
        const predictedAddress = computeProxyAddress(saltHex);

        // Check if it has our vanity prefix
        if (hasVanityPrefix(predictedAddress)) {
            return {
                salt: saltHex,
                predictedAddress
            };
        }

        attempts++;
    }

    throw new Error(`Failed to find a salt with vanity prefix within ${maxAttempts} attempts.`);
}

// Start mining and send result back to main thread
try {
    const result = mineSalt();
    parentPort.postMessage(result);
} catch (error) {
    // Post the error back to the main thread so it can be properly handled
    parentPort.postMessage({ error: error.message });
}