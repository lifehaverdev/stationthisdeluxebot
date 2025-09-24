const { ethers } = require('ethers');
const { 
    initCodeHashERC1967BeaconProxy, 
    encodeCharteredFundInitArgs
} = require('./src/core/services/alchemy/beaconProxyHelper');

// Test with both owner addresses
const FOUNDATION_ADDRESS = '0x01152530028BD834EDBA9744885A882D025D84F6';
const CHARTER_BEACON_ADDRESS = '0xeEd94eD20B79ED938518c6eEa4129cB1E8b8665C';

const testCases = [
    {
        owner: '0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6',
        expectedHash: '0x2402536130170f83a5fdb5d508f8fbac6f1ff75994bb967440da1308958d86e3'
    },
    {
        owner: '0x428Bea9Fd786659c84b0bD62D372bb4a482aF653',
        expectedHash: '0xece1ef3a4040739237183de9098f89b3b872d6683b960609bba8a48df7e687d4'
    }
];

console.log('🔧 Testing Dynamic Owner Address Support');
console.log('========================================');

for (const testCase of testCases) {
    console.log(`\n📝 Testing with owner: ${testCase.owner}`);
    
    // Encode initialization arguments
    const args = encodeCharteredFundInitArgs(FOUNDATION_ADDRESS, testCase.owner);
    console.log(`   Args: ${ethers.hexlify(args)} (${args.length} bytes)`);
    
    // Calculate init code hash
    const initCodeHash = initCodeHashERC1967BeaconProxy(CHARTER_BEACON_ADDRESS, args);
    console.log(`   Hash: ${initCodeHash}`);
    console.log(`   Expected: ${testCase.expectedHash}`);
    
    const matches = initCodeHash.toLowerCase() === testCase.expectedHash.toLowerCase();
    console.log(`   Match: ${matches ? '✅' : '❌'}`);
}

console.log('\n✅ Dynamic owner support test complete!');
