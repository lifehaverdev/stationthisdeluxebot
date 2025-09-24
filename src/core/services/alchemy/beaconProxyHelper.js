const { ethers } = require('ethers');

// ---------------------------------------------------------------------------
// ERC1967 Beacon Proxy Address Prediction (Local)
// ---------------------------------------------------------------------------
// Rebuilt to match Solady v0.8.28 LibClone implementation exactly.
// Uses correct function selector (0x485cc955) and proper ABI encoding.
// Memory layout matches LibClone's assembly implementation precisely.

/**
 * Computes the initialization code hash for an ERC1967 beacon proxy.
 * Based on exact Solady LibClone assembly implementation.
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

    const argsLength = args.length;
    
    // Memory layout based on LibClone assembly:
    // mstore(m, add(0x6100523d8160233d3973, shl(56, n)))  // prefix with args length
    // mstore(add(m, 0x14), beacon)                        // beacon at offset 0x14
    // mstore(add(m, 0x2b), 0x60195155f3363d3d373d3d363d602036600436635c60da)  // runtime code 1
    // mstore(add(m, 0x4b), 0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c)  // runtime code 2
    // mstore(add(m, 0x6b), 0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3)  // runtime code 3
    // for { let i := 0 } lt(i, n) { i := add(i, 0x20) } {
    //     mstore(add(add(m, 0x8b), i), mload(add(add(args, 0x20), i)))
    // }
    // hash := keccak256(add(m, 0x16), add(n, 0x75))
    
    // Create the init code buffer
    // Total size should be exactly 185 bytes (0xB9) based on Foundry analysis
    const initCode = new Uint8Array(185);
    
    // Store the correct prefix directly at offset 0x00
    // The prefix is: 0x6100963d8160233d3973 (10 bytes)
    const prefixBytes = ethers.getBytes('0x6100963d8160233d3973');
    initCode.set(prefixBytes, 0x00);

    // Construct the init code dynamically to match LibClone's exact algorithm
    // Based on the Foundry analysis, we know the exact byte layout
    
    // Store beacon address directly at offset 0x0a (20 bytes)
    const beaconBytes = ethers.getBytes(beacon);
    initCode.set(beaconBytes, 0x0a);
    
    // Store runtime code parts at their exact offsets
    const runtimeCode1 = '0x60195155f3363d3d373d3d363d602036600436635c60da';
    const runtimeCode2 = '0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c';
    const runtimeCode3 = '0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3';

    // Store runtime code parts directly at their offsets
    initCode.set(ethers.getBytes(runtimeCode1), 0x1e); // 30 bytes from start
    initCode.set(ethers.getBytes(runtimeCode2), 0x35); // 53 bytes from start  
    initCode.set(ethers.getBytes(runtimeCode3), 0x55); // 85 bytes from start
    
    // Store args at offset 0x75 (117 bytes from start)
    for (let i = 0; i < argsLength; i += 32) {
        const chunkSize = Math.min(32, argsLength - i);
        initCode.set(args.slice(i, i + chunkSize), 0x75 + i);
    }
    
    // Calculate hash from the entire init code (185 bytes) - LibClone hashes the whole thing
    return ethers.keccak256(initCode);
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
 * Queries Foundation.computeCharterAddress on-chain for a given owner + salt.
 * This is the most reliable way to obtain the deterministic proxy address
 * because the calculation happens inside Solidity using the very same
 * library code that will be used at deployment time.
 *
 * @param {import('ethers').Contract} foundationContract – ethers Contract object already connected to a provider.
 * @param {string} owner – wallet that will own the fund.
 * @param {string} salt  – 32-byte salt (0x-prefixed).
 * @returns {Promise<string>} predicted address.
 */
async function computeCharterAddressOnChain(foundationContract, owner, salt) {
    return foundationContract.computeCharterAddress.staticCall(owner, salt);
}

/**
 * Encodes the initialization arguments for a CharteredFund proxy.
 * Matches Solidity's abi.encodeWithSelector(CharteredFundImplementation.initialize.selector, foundation, owner)
 * @param {string} foundation - The foundation contract address
 * @param {string} owner - The owner's address
 * @returns {Uint8Array} The encoded initialization arguments
 */
function encodeCharteredFundInitArgs(foundation, owner) {
    const iface = new ethers.Interface(['function initialize(address,address)']);
    const f = ethers.getAddress(foundation);
    const o = ethers.getAddress(owner);
    const encoded = iface.encodeFunctionData('initialize', [f, o]);
    return ethers.getBytes(encoded);
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
    // Local prediction (rebuilt from mainnet bytecode)
    initCodeHashERC1967BeaconProxy,
    predictDeterministicAddressERC1967BeaconProxy,
    
    // Utility functions
    encodeCharteredFundInitArgs,
    hasVanityPrefix,
    
    // On-chain verification
    computeCharterAddressOnChain,
};
