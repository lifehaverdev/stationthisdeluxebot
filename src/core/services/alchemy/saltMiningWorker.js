const { ethers } = require('ethers');
const { workerData, parentPort } = require('worker_threads');

// Get data passed to worker
const { ownerAddress, creditVaultAddress, targetPrefix, creationBytecode } = workerData;

if (!creationBytecode) {
    throw new Error('SaltMiningWorker: Missing creationBytecode from workerData.');
}

// --- Pre-calculate the initCodeHash once, as it's constant for this worker run ---
// The constructor for VaultAccount takes (address creditVaultAddress, address ownerAddress)
const constructorTypes = ['address', 'address'];
const constructorArgs = [creditVaultAddress, ownerAddress];
const encodedArgs = ethers.AbiCoder.defaultAbiCoder().encode(constructorTypes, constructorArgs);
const initCode = creationBytecode + encodedArgs.slice(2);
const initCodeHash = ethers.keccak256(initCode);
// --- End pre-calculation ---


/**
 * Computes the CREATE2 address for a new VaultAccount.
 * This function must perfectly replicate the on-chain logic.
 * @param {string} salt - The 32-byte salt, as a hex string.
 * @returns {string} The predicted contract address.
 */
function computeCreate2Address(salt) {
    // Use the pre-calculated initCodeHash
    const predictedAddress = ethers.getCreate2Address(
        creditVaultAddress, // The address of the factory contract (CreditVault)
        salt,               // The salt
        initCodeHash        // The hash of the init code
    );

    return predictedAddress;
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
        const predictedAddress = computeCreate2Address(saltHex);

        // Check if it matches our target prefix (case-insensitive)
        if (predictedAddress.toLowerCase().startsWith(targetPrefix.toLowerCase())) {
            return {
                salt: saltHex,
                predictedAddress
            };
        }

        attempts++;
    }

    throw new Error(`Failed to find a salt for prefix ${targetPrefix} within ${maxAttempts} attempts.`);
}

// Start mining and send result back to main thread
try {
    const result = mineSalt();
    parentPort.postMessage(result);
} catch (error) {
    // Post the error back to the main thread so it can be properly handled
    parentPort.postMessage({ error: error.message });
} 