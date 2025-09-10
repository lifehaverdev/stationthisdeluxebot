const { ethers } = require('ethers');

/**
 * Computes the initialization code hash for an ERC1967 beacon proxy.
 * This is a direct port of LibClone.initCodeHashERC1967BeaconProxy from Solady.
 * @param {string} beacon - The beacon contract address
 * @param {Uint8Array} args - The initialization arguments as bytes
 * @returns {string} The initialization code hash
 */
function initCodeHashERC1967BeaconProxy(beacon, args) {
    // Validate inputs
    if (!ethers.isAddress(beacon)) {
        throw new Error('Invalid beacon address');
    }
    if (args.length > 0xffad) {
        throw new Error('Args too long');
    }

    // Create the initialization code by concatenating components in memory
    const argsLength = args.length;
    const prefix = ethers.concat([
        // Prefix bytes that set up the proxy
        ethers.toBeArray(BigInt('0x6100523d8160233d3973' + argsLength.toString(16).padStart(2, '0'))), // Dynamic sizing
        ethers.getAddress(beacon), // Beacon address (20 bytes)
        ethers.toBeArray(BigInt('0x60195155f3363d3d373d3d363d602036600436635c60da')), // First code chunk
        ethers.toBeArray(BigInt('0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c')), // Second code chunk
        ethers.toBeArray(BigInt('0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3')) // Final code chunk
    ]);

    // Concatenate the prefix with the args
    const fullCode = ethers.concat([prefix, args]);

    // Hash the full initialization code
    return ethers.keccak256(fullCode);
}

/**
 * Predicts the deterministic address of an ERC1967 beacon proxy.
 * @param {string} beacon - The beacon contract address
 * @param {Uint8Array} args - The initialization arguments
 * @param {string} salt - The 32-byte salt as a hex string
 * @param {string} deployer - The deployer's address
 * @returns {string} The predicted proxy address
 */
function predictDeterministicAddressERC1967BeaconProxy(beacon, args, salt, deployer) {
    if (!ethers.isAddress(deployer)) {
        throw new Error('Invalid deployer address');
    }
    if (!salt.startsWith('0x') || salt.length !== 66) {
        throw new Error('Invalid salt format - must be 0x-prefixed 32 bytes');
    }

    const initCodeHash = initCodeHashERC1967BeaconProxy(beacon, args);
    
    // CREATE2 address formula: keccak256(0xff ++ deployer ++ salt ++ initCodeHash)[12:]
    const create2Input = ethers.concat([
        '0xff',
        deployer,
        salt,
        initCodeHash
    ]);
    
    const hash = ethers.keccak256(create2Input);
    return ethers.getAddress('0x' + hash.slice(-40)); // Last 20 bytes
}

/**
 * Encodes the initialization arguments for a CharteredFund proxy.
 * @param {string} foundation - The foundation contract address
 * @param {string} owner - The owner's address
 * @returns {Uint8Array} The encoded initialization arguments
 */
function encodeCharteredFundInitArgs(foundation, owner) {
    // From the CharteredFund ABI: initialize(address _foundation, address _owner)
    const initSelector = '0x' + ethers.id('initialize(address,address)').slice(2, 10);
    return ethers.concat([
        initSelector,
        ethers.zeroPadValue(foundation, 32),
        ethers.zeroPadValue(owner, 32)
    ]);
}

/**
 * Helper to check if an address has the required vanity prefix.
 * @param {string} address - The address to check
 * @returns {boolean} True if address starts with 0x1152
 */
function hasVanityPrefix(address) {
    const addressNum = BigInt(address);
    return (addressNum >> 144n) === 0x1152n;
}

module.exports = {
    initCodeHashERC1967BeaconProxy,
    predictDeterministicAddressERC1967BeaconProxy,
    encodeCharteredFundInitArgs,
    hasVanityPrefix
};
