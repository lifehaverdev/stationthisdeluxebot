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
    const maxAttempts = 10000000; // Increased for better coverage
    const batchSize = 10000; // Larger batches for better performance
    let batchAttempts = 0;
    
    // Use a more efficient approach: start with a base salt and increment
    // This ensures we don't repeat the same salts across different attempts
    const baseSalt = ethers.randomBytes(32);
    const baseSaltBigInt = BigInt('0x' + ethers.hexlify(baseSalt).slice(2));
    
    // Add some randomness based on worker data to ensure different workers start from different points
    const workerOffset = BigInt('0x' + ownerAddress.slice(2, 10)) * BigInt(1000000);
    let currentSaltBigInt = baseSaltBigInt + workerOffset;

    while (attempts < maxAttempts) {
        // Generate salt by incrementing from base + offset
        const salt = ethers.hexlify(ethers.toBeHex(currentSaltBigInt, 32));
        currentSaltBigInt++;

        // Compute the address that would be created (local prediction)
        const predictedAddress = computeProxyAddress(salt);

        // Quick vanity check first (cheap)
        if (!hasVanityPrefix(predictedAddress)) {
            attempts++; 
            batchAttempts++;
            
            // Progress logging for production
            if (batchAttempts >= batchSize) {
                console.log(`[SaltMiningWorker] Processed ${attempts} attempts, current salt: ${salt.slice(0, 10)}...`);
                batchAttempts = 0;
            }
            continue;
        }

        // Found a potential salt with vanity prefix - verify with on-chain call
        if (foundation && provider) {
            try {
                // Double-check prediction matches on-chain calculation
                const onChainPredicted = await foundation.computeCharterAddress.staticCall(ownerAddress, salt);
                if (onChainPredicted.toLowerCase() !== predictedAddress.toLowerCase()) {
                    attempts++; continue; // mismatch, keep mining
                }
                
                // Ensure deployment would succeed (including Foundation.Vanity error and any other guards)
                await foundation.charterFund.staticCall(ownerAddress, salt);
                console.log(`[SaltMiningWorker] SUCCESS! Found salt after ${attempts} attempts: ${salt}`);
                return { salt: salt, predictedAddress };
            } catch (e) {
                // If RPC fails, fallback to local check only
                return { salt: salt, predictedAddress };
            }
        } else {
            // No provider available, use local prediction only
            console.log(`[SaltMiningWorker] SUCCESS! Found salt after ${attempts} attempts (local-only): ${salt}`);
            return { salt: salt, predictedAddress };
        }

        attempts++;
    }

    throw new Error(`Failed to find a salt with vanity prefix within ${maxAttempts} attempts.`);
}

// Start mining and send result back to main thread
(async () => {
    try {
        const result = await mineSalt();
        parentPort.postMessage(result);
    } catch (error) {
        // Post the error back to the main thread so it can be properly handled
        parentPort.postMessage({ error: error.message });
    }
})();