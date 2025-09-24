const { ethers } = require('ethers');
const { predictDeterministicAddressERC1967BeaconProxy, encodeCharteredFundInitArgs, initCodeHashERC1967BeaconProxy } = require('./src/core/services/alchemy/beaconProxyHelper');

async function debugAddressPrediction() {
    const beacon = '0xeEd94eD20B79ED938518c6eEa4129cB1E8b8665C';
    const owner = '0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6';
    const foundation = '0x01152530028bd834EDbA9744885A882D025D84F6';
    const salt = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    
    console.log('=== Debug Address Prediction ===');
    console.log('Beacon:', beacon);
    console.log('Owner:', owner);
    console.log('Foundation:', foundation);
    console.log('Salt:', salt);
    console.log();
    
    // Test the args encoding
    const args = encodeCharteredFundInitArgs(foundation, owner);
    console.log('Args length:', args.length);
    console.log('Args hex:', ethers.hexlify(args));
    console.log();
    
    // Test the init code hash
    const initCodeHash = initCodeHashERC1967BeaconProxy(beacon, args);
    console.log('Init code hash:', initCodeHash);
    console.log();
    
    // Test the final prediction
    const predicted = predictDeterministicAddressERC1967BeaconProxy(beacon, args, salt, foundation);
    console.log('Predicted address:', predicted);
    console.log();
    
    // Expected result
    console.log('Expected result: 0x6DFeD3087CbfAA7E8C920AcCEcb20C985C7961Fc');
    console.log('Match:', predicted.toLowerCase() === '0x6dfed3087cbfaa7e8c920accecb20c985c7961fc');
}

debugAddressPrediction().catch(console.error);
