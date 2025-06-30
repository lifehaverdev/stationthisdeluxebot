const { ethers } = require('ethers');
const { workerData, parentPort } = require('worker_threads');

// Get data passed to worker
const { ownerAddress, creditVaultAddress, targetPrefix } = workerData;

// CREATE2 address calculation
function computeCreate2Address(salt, ownerAddress, creditVaultAddress) {
    // keccak256(0xff ++ deployingAddress ++ salt ++ keccak256(bytecode))
    const prefix = '0xff';
    
    // The init code hash for a minimal proxy contract
    // This is the bytecode that creates a new vault account
    const initCodeHash = ethers.keccak256('0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + creditVaultAddress.slice(2) + '5af43d82803e903d91602b57fd5bf3');
    
    const saltHex = ethers.hexlify(salt);
    
    const addressBytes = ethers.concat([
        prefix,
        creditVaultAddress,
        saltHex,
        initCodeHash
    ]);
    
    return ethers.getAddress('0x' + ethers.keccak256(addressBytes).slice(26));
}

// Mine for a salt that generates an address with the target prefix
function mineSalt() {
    let attempts = 0;
    const maxAttempts = 1000000; // Reasonable limit to prevent infinite loops
    
    while (attempts < maxAttempts) {
        // Generate a random salt
        const salt = ethers.randomBytes(32);
        
        // Compute the address that would be created
        const predictedAddress = computeCreate2Address(salt, ownerAddress, creditVaultAddress);
        
        // Check if it matches our target prefix
        if (predictedAddress.toLowerCase().startsWith(targetPrefix.toLowerCase())) {
            return {
                salt: ethers.hexlify(salt),
                predictedAddress
            };
        }
        
        attempts++;
    }
    
    throw new Error('Failed to find matching salt within attempt limit');
}

// Start mining and send result back to main thread
try {
    const result = mineSalt();
    parentPort.postMessage(result);
} catch (error) {
    parentPort.postMessage({ error: error.message });
} 