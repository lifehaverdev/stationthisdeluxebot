const { ethers } = require('ethers');

function debugBytecode(beacon, args) {
    console.log('=== Bytecode Debug ===');
    console.log('Beacon:', beacon);
    console.log('Args length:', args.length);
    console.log('Args hex:', ethers.hexlify(args));
    console.log();
    
    const argsLength = args.length;
    
    // Let's try the original approach from the comment in the file
    // Based on actual deployed init-code: 0x603d3d8160223d3973c24a65e0a9d028190c6830a426602ebb656dc5e160095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3
    
    // Try the original approach
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
    
    console.log('Creation code length:', creationCode.length);
    console.log('Creation code (first 100 bytes):', ethers.hexlify(creationCode.slice(0, 100)));
    console.log('Creation code (last 100 bytes):', ethers.hexlify(creationCode.slice(-100)));
    
    const hash1 = ethers.keccak256(creationCode);
    console.log('Hash (original approach):', hash1);
    
    // Now try the LibClone approach
    const totalLength = 0x16 + argsLength + 0x75;
    const initCode = new Uint8Array(totalLength);
    
    // 1. Store the prefix with args length
    const prefix = 0x6100523d8160233d3973n + BigInt(argsLength);
    const prefixBytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
        prefixBytes[7 - i] = Number((prefix >> (BigInt(i) * 8n)) & 0xFFn);
    }
    initCode.set(prefixBytes, 0);
    
    // 2. Store the beacon address at offset 0x14
    const beaconBytes = ethers.getBytes(beacon);
    initCode.set(beaconBytes, 0x14);
    
    // 3. Store the args data at offset 0x8b
    initCode.set(args, 0x8b);
    
    // 4. Store the runtime code parts
    const runtimeCode1 = '0x60195155f3363d3d373d3d363d602036600436635c60da';
    const runtimeCode2 = '0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c';
    const runtimeCode3 = '0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3';
    
    initCode.set(ethers.getBytes(runtimeCode1), 0x2b);
    initCode.set(ethers.getBytes(runtimeCode2), 0x4b);
    initCode.set(ethers.getBytes(runtimeCode3), 0x6b);
    
    // Calculate hash starting from offset 0x16
    const hashStart = 0x16;
    const hashLength = argsLength + 0x75;
    const hashData = initCode.slice(hashStart, hashStart + hashLength);
    
    const hash2 = ethers.keccak256(hashData);
    console.log('Hash (LibClone approach):', hash2);
    
    // Compare with the expected bytecode from the comment
    const expectedBytecode = '0x603d3d8160223d3973c24a65e0a9d028190c6830a426602ebb656dc5e160095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3';
    console.log('Expected bytecode:', expectedBytecode);
    console.log('Expected length:', expectedBytecode.length / 2 - 1);
    
    // Try to match the expected bytecode structure
    const expectedBytes = ethers.getBytes(expectedBytecode);
    console.log('Expected bytes (first 50):', ethers.hexlify(expectedBytes.slice(0, 50)));
    console.log('Expected bytes (last 50):', ethers.hexlify(expectedBytes.slice(-50)));
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

debugBytecode(beacon, args);
