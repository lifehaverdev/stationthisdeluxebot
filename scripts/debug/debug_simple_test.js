const { ethers } = require('ethers');

// Test with a simple case to understand the memory layout
function testSimple() {
    const beacon = '0xeEd94eD20B79ED938518c6eEa4129cB1E8b8665C';
    const args = new Uint8Array(68); // 68 bytes of zeros
    args.fill(0);
    
    console.log('=== Simple Test ===');
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
    
    // Store beacon address at offset 0x14
    const beaconBytes = ethers.getBytes(beacon);
    initCode.set(beaconBytes, 0x14);
    
    // Store runtime code parts
    const runtimeCode1 = '0x60195155f3363d3d373d3d363d602036600436635c60da';
    const runtimeCode2 = '0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c';
    const runtimeCode3 = '0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3';
    
    initCode.set(ethers.getBytes(runtimeCode1), 0x2b);
    initCode.set(ethers.getBytes(runtimeCode2), 0x4b);
    initCode.set(ethers.getBytes(runtimeCode3), 0x6b);
    
    // Store args at offset 0x8b (copied 32 bytes at a time)
    for (let i = 0; i < argsLength; i += 32) {
        const chunkSize = Math.min(32, argsLength - i);
        initCode.set(args.slice(i, i + chunkSize), 0x8b + i);
    }
    
    // Show the complete memory layout
    console.log('Complete memory layout:');
    console.log('0x00-0x15 (prefix):', ethers.hexlify(initCode.slice(0, 0x16)));
    console.log('0x16-0x2a (beacon):', ethers.hexlify(initCode.slice(0x16, 0x2b)));
    console.log('0x2b-0x4a (runtime1):', ethers.hexlify(initCode.slice(0x2b, 0x4b)));
    console.log('0x4b-0x6a (runtime2):', ethers.hexlify(initCode.slice(0x4b, 0x6b)));
    console.log('0x6b-0x8a (runtime3):', ethers.hexlify(initCode.slice(0x6b, 0x8b)));
    console.log('0x8b+ (args):', ethers.hexlify(initCode.slice(0x8b, 0x8b + argsLength)));
    
    // Calculate hash from offset 0x16 with length argsLength + 0x75
    const hashStart = 0x16;
    const hashLength = argsLength + 0x75;
    const hashData = initCode.slice(hashStart, hashStart + hashLength);
    
    console.log('\nHash calculation:');
    console.log('Hash start offset:', hashStart);
    console.log('Hash length:', hashLength);
    console.log('Hash data length:', hashData.length);
    console.log('Hash data (first 50 bytes):', ethers.hexlify(hashData.slice(0, 50)));
    console.log('Hash data (last 50 bytes):', ethers.hexlify(hashData.slice(-50)));
    
    const hash = ethers.keccak256(hashData);
    console.log('Init code hash:', hash);
    
    return hash;
}

testSimple();
