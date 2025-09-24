const { ethers } = require('ethers');

function debugDetailed(beacon, args) {
    console.log('=== Detailed Debug ===');
    console.log('Beacon:', beacon);
    console.log('Args length:', args.length);
    console.log('Args hex:', ethers.hexlify(args));
    console.log();
    
    const argsLength = args.length;
    
    // Calculate the prefix: 0x6100523d8160233d3973 - ((0x52 - argsLength) << 56)
    const base = 0x6100523d8160233d3973n;
    const diff = 0x52n - BigInt(argsLength);
    const prefix = base - (diff << 56n);
    console.log('Prefix (hex):', '0x' + prefix.toString(16));
    
    // Create the init code buffer
    const initCode = new Uint8Array(0x16 + argsLength + 0x75);
    console.log('Init code buffer size:', initCode.length);
    
    // Store prefix at offset 0x00-0x15
    const prefixBytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
        prefixBytes[7 - i] = Number((prefix >> (BigInt(i) * 8n)) & 0xFFn);
    }
    initCode.set(prefixBytes, 0);
    console.log('Prefix bytes:', ethers.hexlify(prefixBytes));
    console.log('Prefix at 0x00-0x15:', ethers.hexlify(initCode.slice(0, 0x16)));
    
    // Store beacon address at offset 0x14
    const beaconBytes = ethers.getBytes(beacon);
    initCode.set(beaconBytes, 0x14);
    console.log('Beacon bytes:', ethers.hexlify(beaconBytes));
    console.log('Beacon at 0x14:', ethers.hexlify(initCode.slice(0x14, 0x14 + 20)));
    
    // Store runtime code parts
    const runtimeCode1 = '0x60195155f3363d3d373d3d363d602036600436635c60da';
    const runtimeCode2 = '0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c';
    const runtimeCode3 = '0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3';
    
    initCode.set(ethers.getBytes(runtimeCode1), 0x2b);
    initCode.set(ethers.getBytes(runtimeCode2), 0x4b);
    initCode.set(ethers.getBytes(runtimeCode3), 0x6b);
    
    console.log('Runtime code 1 at 0x2b:', ethers.hexlify(initCode.slice(0x2b, 0x2b + 32)));
    console.log('Runtime code 2 at 0x4b:', ethers.hexlify(initCode.slice(0x4b, 0x4b + 32)));
    console.log('Runtime code 3 at 0x6b:', ethers.hexlify(initCode.slice(0x6b, 0x6b + 32)));
    
    // Store args at offset 0x8b (copied 32 bytes at a time)
    for (let i = 0; i < argsLength; i += 32) {
        const chunkSize = Math.min(32, argsLength - i);
        initCode.set(args.slice(i, i + chunkSize), 0x8b + i);
    }
    console.log('Args at 0x8b:', ethers.hexlify(initCode.slice(0x8b, 0x8b + argsLength)));
    
    // Calculate hash from offset 0x16 with length argsLength + 0x75
    const hashStart = 0x16;
    const hashLength = argsLength + 0x75;
    const hashData = initCode.slice(hashStart, hashStart + hashLength);
    
    console.log('Hash start offset:', hashStart);
    console.log('Hash length:', hashLength);
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

debugDetailed(beacon, args);
