const { ethers } = require('ethers');

async function debugFoundation() {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL || process.env.ALCHEMY_RPC_URL);
    const foundationAbi = require('./src/core/contracts/abis/foundation.json');
    const foundation = new ethers.Contract(process.env.FOUNDATION_ADDRESS, foundationAbi, provider);
    
    console.log('=== Foundation Contract Debug ===');
    console.log('Foundation address:', process.env.FOUNDATION_ADDRESS);
    console.log('Beacon address:', process.env.CHARTER_BEACON_ADDRESS);
    console.log();
    
    // Get the beacon address from the contract
    try {
        const beaconFromContract = await foundation.charterBeacon();
        console.log('Beacon from contract:', beaconFromContract);
        console.log('Beacon matches env:', beaconFromContract.toLowerCase() === process.env.CHARTER_BEACON_ADDRESS.toLowerCase());
    } catch (error) {
        console.error('Error getting beacon:', error.message);
    }
    
    // Test with a simple salt
    const owner = '0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6';
    const salt = '0x0000000000000000000000000000000000000000000000000000000000000001';
    
    try {
        const result = await foundation.computeCharterAddress.staticCall(owner, salt);
        console.log('Simple test result:', result);
    } catch (error) {
        console.error('Error with simple test:', error.message);
    }
    
    // Test with the original salt
    const originalSalt = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    try {
        const result = await foundation.computeCharterAddress.staticCall(owner, originalSalt);
        console.log('Original salt result:', result);
    } catch (error) {
        console.error('Error with original salt:', error.message);
    }
}

debugFoundation().catch(console.error);
