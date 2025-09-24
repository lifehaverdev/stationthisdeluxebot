const { ethers } = require('ethers');

function debugInitCode(beacon, args) {
    console.log('=== Init Code Debug ===');
    console.log('Beacon:', beacon);
    console.log('Args length:', args.length);
    console.log('Args hex:', ethers.hexlify(args));
    console.log();
    
    const argsLength = args.length;
    const totalLength = 0x16 + argsLength + 0x75;
    console.log('Total length:', totalLength);
    console.log('Hash start offset: 0x16');
    console.log('Hash length:', argsLength + 0x75);
    console.log();
    
    const initCode = new Uint8Array(totalLength);
    
    // 1. Store the prefix with args length
    const prefix = 0x6100523d8160233d3973n + (BigInt(argsLength) << 48n);
    console.log('Prefix (hex):', '0x' + prefix.toString(16));
    const prefixBytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
        prefixBytes[7 - i] = Number((prefix >> (BigInt(i) * 8n)) & 0xFFn);
    }
    initCode.set(prefixBytes, 0);
    console.log('Prefix bytes:', ethers.hexlify(prefixBytes));
    
    // 2. Store the beacon address at offset 0x14
    const beaconBytes = ethers.getBytes(beacon);
    initCode.set(beaconBytes, 0x14);
    console.log('Beacon bytes at 0x14:', ethers.hexlify(beaconBytes));
    
    // 3. Store the args data at offset 0x8b
    initCode.set(args, 0x8b);
    console.log('Args at 0x8b:', ethers.hexlify(args));
    
    // 4. Store the runtime code parts
    const runtimeCode1 = '0x60195155f3363d3d373d3d363d602036600436635c60da';
    const runtimeCode2 = '0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c';
    const runtimeCode3 = '0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3';
    
    initCode.set(ethers.getBytes(runtimeCode1), 0x2b);
    initCode.set(ethers.getBytes(runtimeCode2), 0x4b);
    initCode.set(ethers.getBytes(runtimeCode3), 0x6b);
    
    console.log('Runtime code 1 at 0x2b:', runtimeCode1);
    console.log('Runtime code 2 at 0x4b:', runtimeCode2);
    console.log('Runtime code 3 at 0x6b:', runtimeCode3);
    
    // Calculate hash starting from offset 0x16
    const hashStart = 0x16;
    const hashLength = argsLength + 0x75;
    const hashData = initCode.slice(hashStart, hashStart + hashLength);
    
    console.log('Hash data length:', hashData.length);
    console.log('Hash data (first 100 bytes):', ethers.hexlify(hashData.slice(0, 100)));
    console.log('Hash data (last 100 bytes):', ethers.hexlify(hashData.slice(-100)));
    
    const hash = ethers.keccak256(hashData);
    console.log('Init code hash:', hash);
    
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

debugInitCode(beacon, args);
