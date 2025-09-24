#!/usr/bin/env node
/**
 * Salt Mining Worker Wrapper
 * 
 * This wrapper ensures the worker runs in CommonJS mode regardless of the parent process context.
 * It's a workaround for the ES module context issues when spawning workers.
 */

// Force CommonJS execution by using require() at the top level
const { workerData, parentPort } = require('worker_threads');

// Import the actual worker logic
const { ethers } = require('ethers');
const { predictDeterministicAddressERC1967BeaconProxy, encodeCharteredFundInitArgs, hasVanityPrefix } = require('./beaconProxyHelper');

// Get data passed to worker
const { ownerAddress, foundationAddress, beaconAddress } = workerData;

if (!beaconAddress) {
    throw new Error('SaltMiningWorker: Missing beaconAddress from workerData.');
}

// Pre-calculate the initialization args once, as they're constant for this worker run
const initArgs = encodeCharteredFundInitArgs(foundationAddress, ownerAddress);

// Pre-initialize provider and contract to avoid recreating them for each salt check
let provider, foundation;
try {
    provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL || process.env.ALCHEMY_RPC_URL);
    const foundationAbi = require('../../contracts/abis/foundation.json');
    foundation = new ethers.Contract(foundationAddress, foundationAbi, provider);
} catch (error) {
    console.warn('[SaltMiningWorker] Failed to initialize provider/contract, will use local-only mode:', error.message);
}

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
async function mineSalt() {
    let attempts = 0;
    const maxAttempts = 1000000; // A reasonable limit to prevent infinite loops
    const batchSize = 10000; // Larger batches for better performance
    let batchAttempts = 0;

    while (attempts < maxAttempts) {
        // Generate a random 32-byte salt
        const salt = ethers.randomBytes(32);
        const saltHex = ethers.hexlify(salt);

        // Compute the address that would be created (local prediction)
        const predictedAddress = computeProxyAddress(saltHex);

        // Quick vanity check first (cheap)
        if (!hasVanityPrefix(predictedAddress)) {
            attempts++; 
            batchAttempts++;
            
            // Minimal progress logging for production
            if (batchAttempts >= batchSize) {
                batchAttempts = 0;
            }
            continue;
        }

        // Found a potential salt with vanity prefix - verify with on-chain call
        if (foundation && provider) {
            try {
                // Double-check prediction matches on-chain calculation
                const onChainPredicted = await foundation.computeCharterAddress.staticCall(ownerAddress, saltHex);
                if (onChainPredicted.toLowerCase() !== predictedAddress.toLowerCase()) {
                    attempts++; continue; // mismatch, keep mining
                }
                
                // Ensure deployment would succeed (including Foundation.Vanity error and any other guards)
                await foundation.charterFund.staticCall(ownerAddress, saltHex);
                return { salt: saltHex, predictedAddress };
            } catch (e) {
                // If RPC fails, fallback to local check only
                return { salt: saltHex, predictedAddress };
            }
        } else {
            // No provider available, use local prediction only
            return { salt: saltHex, predictedAddress };
        }

        attempts++;
    }

    throw new Error(`Failed to find a salt with vanity prefix within ${maxAttempts} attempts.`);
}

// Start mining and send result back to main thread
try {
    const result = await mineSalt();
    parentPort.postMessage(result);
} catch (error) {
    // Post the error back to the main thread so it can be properly handled
    parentPort.postMessage({ error: error.message });
}
