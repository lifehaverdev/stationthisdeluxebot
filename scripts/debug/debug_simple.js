const { ethers } = require('ethers');

// Let's try the exact approach from the original comment
// Based on actual deployed init-code: 0x603d3d8160223d3973c24a65e0a9d028190c6830a426602ebb656dc5e160095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3

function testOriginalApproach(beacon, args) {
    console.log('=== Testing Original Approach ===');
    console.log('Beacon:', beacon);
    console.log('Args length:', args.length);
    console.log('Args hex:', ethers.hexlify(args));
    console.log();
    
    // Use the exact bytecode from the comment
    const expectedBytecode = '0x603d3d8160223d3973c24a65e0a9d028190c6830a426602ebb656dc5e160095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3';
    
    // This bytecode has a specific structure. Let's analyze it:
    // 0x603d3d8160223d3973 - prefix
    // c24a65e0a9d028190c6830a426602ebb656dc5e160095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3 - runtime code + args
    
    const expectedBytes = ethers.getBytes(expectedBytecode);
    console.log('Expected bytecode length:', expectedBytes.length);
    console.log('Expected prefix:', ethers.hexlify(expectedBytes.slice(0, 8)));
    console.log('Expected runtime code start:', ethers.hexlify(expectedBytes.slice(8, 40)));
    
    // The issue might be that the expected bytecode is for a different beacon/args combination
    // Let's try to construct the correct bytecode for our specific case
    
    // Try the original approach from the file
    const creationCode = ethers.concat([
        // Beacon address + prefix (20 bytes at offset 0x0c)
        ethers.concat([
            ethers.toBeArray(BigInt('0x60523d8160223d3973')), // 8-byte prefix
            ethers.getAddress(beacon) // 20-byte beacon address
        ]),
        
        // Runtime code part 1 (32 bytes at offset 0x20)
        ethers.toBeArray(BigInt('0x60195155f3363d3d373d3d363d602036600436635c60da')),
        
        // Runtime code part 2 (32 bytes at offset 0x40)
        ethers.toBeArray(BigInt('0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c')),
        
        // Runtime code part 3 (32 bytes at offset 0x60)
        ethers.toBeArray(BigInt('0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3')),
        
        // Constructor args
        args
    ]);
    
    console.log('Our creation code length:', creationCode.length);
    console.log('Our creation code (first 50 bytes):', ethers.hexlify(creationCode.slice(0, 50)));
    console.log('Our creation code (last 50 bytes):', ethers.hexlify(creationCode.slice(-50)));
    
    const hash = ethers.keccak256(creationCode);
    console.log('Our hash:', hash);
    
    return hash;
}

// Test with the actual values
const beacon = '0xeEd94eD20B79ED938518c6eEa4129cB1E8b8665C';
const foundation = '0x01152530028bd834EDbA9744885A882D025D84F6';
const owner = '0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6';

// Create args exactly like Solidity abi.encodeWithSelector
const selector = '0x485cc955';
const foundationEncoded = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [foundation]);
const ownerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [owner]);

const args = new Uint8Array(4 + 32 + 32);
args.set(ethers.getBytes(selector), 0);
args.set(ethers.getBytes(foundationEncoded), 4);
args.set(ethers.getBytes(ownerEncoded), 36);

testOriginalApproach(beacon, args);
