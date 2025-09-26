const { ethers } = require('ethers');
const { getFoundationAddress, getRpcUrl } = require('../../src/core/services/alchemy/foundationConfig');

async function debugMarshalAuth() {
    const chainId = process.env.CHAIN_ID || '1';
    const rpcUrl = getRpcUrl(chainId);
    const foundationAddress = getFoundationAddress(chainId);
    
    console.log('=== Marshal Authorization Debug ===');
    console.log('Chain ID:', chainId);
    console.log('Foundation address:', foundationAddress);
    console.log('RPC URL:', rpcUrl);
    console.log();
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const foundationAbi = require('../../src/core/contracts/abis/foundation.json');
    const foundation = new ethers.Contract(foundationAddress, foundationAbi, provider);
    
    // Get the private key from environment
    const privateKey = process.env.ETHEREUM_SIGNER_PRIVATE_KEY;
    if (!privateKey) {
        console.error('ERROR: ETHEREUM_SIGNER_PRIVATE_KEY not set');
        process.exit(1);
    }
    
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log('Signer address:', wallet.address);
    console.log();
    
    // Check if the signer is authorized as a marshal
    try {
        const isMarshal = await foundation.isMarshal(wallet.address);
        console.log('Is signer a marshal?', isMarshal);
    } catch (error) {
        console.error('Error checking marshal status:', error.message);
    }
    
    // Check if marshal is frozen
    try {
        const marshalFrozen = await foundation.marshalFrozen();
        console.log('Is marshal frozen?', marshalFrozen);
    } catch (error) {
        console.error('Error checking marshal frozen status:', error.message);
    }
    
    // Test charterFund with a simple call
    const owner = '0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6';
    const salt = '0x0000000000000000000000000000000000000000000000000000000000000001';
    
    console.log('\n=== Testing charterFund ===');
    console.log('Owner:', owner);
    console.log('Salt:', salt);
    
    try {
        // First try a static call to see if it would succeed
        const staticResult = await foundation.charterFund.staticCall(owner, salt);
        console.log('Static call result:', staticResult);
        
        // If static call succeeds, try the actual transaction
        const connectedFoundation = foundation.connect(wallet);
        const tx = await connectedFoundation.charterFund(owner, salt);
        console.log('Transaction sent:', tx.hash);
        
        const receipt = await tx.wait();
        console.log('Transaction confirmed in block:', receipt.blockNumber);
        
    } catch (error) {
        console.error('Error with charterFund:', error.message);
        
        // Try to decode the error
        try {
            const iface = new ethers.Interface(foundationAbi);
            const parsed = iface.parseError(error.data || error.error?.data || error);
            console.log('Decoded error:', parsed?.name || 'Unknown error');
        } catch (decodeError) {
            console.log('Could not decode error:', decodeError.message);
        }
    }
}

debugMarshalAuth().catch(console.error);
