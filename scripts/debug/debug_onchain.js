const { ethers } = require('ethers');

async function debugOnChain() {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL || process.env.ALCHEMY_RPC_URL);
    const foundationAbi = require('./src/core/contracts/abis/foundation.json');
    const foundation = new ethers.Contract(process.env.FOUNDATION_ADDRESS, foundationAbi, provider);
    
    const owner = '0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6';
    const salt = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    
    console.log('=== On-Chain Debug ===');
    console.log('Foundation address:', process.env.FOUNDATION_ADDRESS);
    console.log('Beacon address:', process.env.CHARTER_BEACON_ADDRESS);
    console.log('Owner:', owner);
    console.log('Salt:', salt);
    console.log();
    
    try {
        const result = await foundation.computeCharterAddress.staticCall(owner, salt);
        console.log('On-chain result:', result);
        console.log('Expected: 0x6DFeD3087CbfAA7E8C920AcCEcb20C985C7961Fc');
        console.log('Match:', result.toLowerCase() === '0x6dfed3087cbfaa7e8c920accecb20c985c7961fc');
    } catch (error) {
        console.error('Error calling computeCharterAddress:', error.message);
    }
}

debugOnChain().catch(console.error);
