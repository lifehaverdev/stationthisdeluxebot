const { ethers } = require('ethers');

async function debugFoundationBytecode() {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL || process.env.ALCHEMY_RPC_URL);
    
    console.log('=== Foundation Bytecode Analysis ===');
    
    // Get the Foundation contract bytecode
    const foundationCode = await provider.getCode(process.env.FOUNDATION_ADDRESS);
    console.log('Foundation bytecode:', foundationCode);
    console.log('Foundation bytecode length:', foundationCode.length);
    
    // The Foundation contract bytecode is very short, which suggests it's a proxy
    // Let me check if it's using a different approach
    
    // Try to find the actual implementation by looking at the storage
    try {
        // Get the implementation address from storage slot 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
        const implSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
        const implAddress = await provider.getStorage(process.env.FOUNDATION_ADDRESS, implSlot);
        console.log('Implementation address:', implAddress);
        
        if (implAddress !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
            const implCode = await provider.getCode(implAddress);
            console.log('Implementation bytecode length:', implCode.length);
            console.log('Implementation bytecode (first 200 chars):', implCode.slice(0, 200));
        }
    } catch (error) {
        console.error('Error getting implementation:', error.message);
    }
    
    // Let me also check if there are any other storage slots that might contain the beacon address
    try {
        const beaconSlot = await provider.getStorage(process.env.FOUNDATION_ADDRESS, '0x0');
        console.log('Storage slot 0:', beaconSlot);
        
        const beaconSlot1 = await provider.getStorage(process.env.FOUNDATION_ADDRESS, '0x1');
        console.log('Storage slot 1:', beaconSlot1);
        
        const beaconSlot2 = await provider.getStorage(process.env.FOUNDATION_ADDRESS, '0x2');
        console.log('Storage slot 2:', beaconSlot2);
    } catch (error) {
        console.error('Error getting storage:', error.message);
    }
}

debugFoundationBytecode().catch(console.error);
