const { ethers } = require('ethers');

async function analyzeBytecode() {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL || process.env.ALCHEMY_RPC_URL);
    
    console.log('=== Bytecode Analysis ===');
    console.log('Foundation address:', process.env.FOUNDATION_ADDRESS);
    console.log('Beacon address:', process.env.CHARTER_BEACON_ADDRESS);
    console.log();
    
    // Get the Foundation contract bytecode
    try {
        const foundationCode = await provider.getCode(process.env.FOUNDATION_ADDRESS);
        console.log('Foundation bytecode length:', foundationCode.length);
        console.log('Foundation bytecode (first 100 chars):', foundationCode.slice(0, 100));
    } catch (error) {
        console.error('Error getting Foundation bytecode:', error.message);
    }
    
    // Get the beacon contract bytecode
    try {
        const beaconCode = await provider.getCode(process.env.CHARTER_BEACON_ADDRESS);
        console.log('Beacon bytecode length:', beaconCode.length);
        console.log('Beacon bytecode (first 100 chars):', beaconCode.slice(0, 100));
    } catch (error) {
        console.error('Error getting beacon bytecode:', error.message);
    }
    
    // Test our current implementation
    const { predictDeterministicAddressERC1967BeaconProxy, encodeCharteredFundInitArgs } = require('./src/core/services/alchemy/beaconProxyHelper');
    
    const owner = '0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6';
    const foundation = process.env.FOUNDATION_ADDRESS;
    const beacon = process.env.CHARTER_BEACON_ADDRESS;
    const salt = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    
    const args = encodeCharteredFundInitArgs(foundation, owner);
    const predicted = predictDeterministicAddressERC1967BeaconProxy(beacon, args, salt, foundation);
    
    console.log('Our prediction:', predicted);
    console.log('Expected:', '0x6DFeD3087CbfAA7E8C920AcCEcb20C985C7961Fc');
    console.log('Match:', predicted.toLowerCase() === '0x6dfed3087cbfaa7e8c920accecb20c985c7961fc');
}

analyzeBytecode().catch(console.error);
