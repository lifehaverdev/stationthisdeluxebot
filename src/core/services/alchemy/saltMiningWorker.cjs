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
    const maxAttempts = 1000000; // Reasonable limit to prevent infinite loops
    const batchSize = 10000; // Larger batches for better performance
    let batchAttempts = 0;
    let localMiningMode = false;

    // First, verify our local prediction logic matches on-chain calculation
    if (foundation && provider) {
        try {
            console.log('[SaltMiningWorker] Verifying local prediction logic matches on-chain...');
            const testSalt = ethers.randomBytes(32);
            const testSaltHex = ethers.hexlify(testSalt);
            const localPrediction = computeProxyAddress(testSaltHex);
            const onChainPrediction = await foundation.computeCharterAddress.staticCall(ownerAddress, testSaltHex);
            
            if (localPrediction.toLowerCase() === onChainPrediction.toLowerCase()) {
                console.log('[SaltMiningWorker] ✅ Local prediction matches on-chain calculation. Switching to local-only mining for speed.');
                localMiningMode = true;
            } else {
                console.log('[SaltMiningWorker] ❌ CRITICAL: Local prediction mismatch detected!');
                console.log(`[SaltMiningWorker] Local: ${localPrediction}`);
                console.log(`[SaltMiningWorker] On-chain: ${onChainPrediction}`);
                console.log('[SaltMiningWorker] This indicates a fundamental issue with our prediction logic.');
                console.log('[SaltMiningWorker] Aborting salt mining to prevent invalid results.');
                throw new Error('PREDICTION_LOGIC_MISMATCH: Local prediction does not match on-chain calculation. Check beaconProxyHelper.js implementation.');
            }
        } catch (e) {
            if (e.message.includes('PREDICTION_LOGIC_MISMATCH')) {
                throw e; // Re-throw our custom error
            }
            console.log('[SaltMiningWorker] ⚠️ Could not verify prediction logic. Will verify each salt with RPC calls.');
        }
    } else {
        console.log('[SaltMiningWorker] No RPC provider available. Using local-only mining.');
        localMiningMode = true;
    }

    while (attempts < maxAttempts) {
        // Generate a random 32-byte salt (same strategy as test worker)
        const salt = ethers.randomBytes(32);
        const saltHex = ethers.hexlify(salt);

        // Compute the address that would be created (local prediction)
        const predictedAddress = computeProxyAddress(saltHex);

        // Quick vanity check first (cheap)
        if (!hasVanityPrefix(predictedAddress)) {
            attempts++; 
            batchAttempts++;
            
            // Progress logging for production
            if (batchAttempts >= batchSize) {
                console.log(`[SaltMiningWorker] Processed ${attempts} attempts, current salt: ${saltHex.slice(0, 10)}...`);
                batchAttempts = 0;
            }
            continue;
        }

        // Found a potential salt with vanity prefix
        if (localMiningMode) {
            // Local-only mode: trust our prediction logic
            console.log(`[SaltMiningWorker] SUCCESS! Found salt after ${attempts} attempts (local-only): ${saltHex}`);
            return { salt: saltHex, predictedAddress };
        } else {
            // RPC verification mode: verify with on-chain call
            try {
                const onChainPredicted = await foundation.computeCharterAddress.staticCall(ownerAddress, saltHex);
                if (onChainPredicted.toLowerCase() !== predictedAddress.toLowerCase()) {
                    attempts++; continue; // mismatch, keep mining
                }
                
                console.log(`[SaltMiningWorker] SUCCESS! Found salt after ${attempts} attempts (RPC-verified): ${saltHex}`);
                return { salt: saltHex, predictedAddress };
            } catch (e) {
                // If RPC fails, fallback to local check only
                console.log(`[SaltMiningWorker] SUCCESS! Found salt after ${attempts} attempts (RPC-fallback): ${saltHex}`);
                return { salt: saltHex, predictedAddress };
            }
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