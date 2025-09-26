const { ethers } = require('ethers');
const { getFoundationAddress, getRpcUrl } = require('../../src/core/services/alchemy/foundationConfig');

async function checkMarshalAuth() {
    const chainId = process.env.CHAIN_ID || '1';
    const rpcUrl = getRpcUrl(chainId);
    const foundationAddress = getFoundationAddress(chainId);
    
    console.log('=== Marshal Authorization Check ===');
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
        console.log('Please run with: ./run-with-env.sh node scripts/debug/check_marshal_auth.js');
        process.exit(1);
    }
    
    const wallet = new ethers.Wallet(privateKey, provider);
    const signerAddress = wallet.address;
    
    console.log('🔑 Signer address from loaded private key:', signerAddress);
    console.log();
    
    // Check if the signer is authorized as a marshal
    try {
        const isMarshal = await foundation.isMarshal(signerAddress);
        console.log('✅ Is signer a marshal?', isMarshal);
        
        if (!isMarshal) {
            console.log('❌ PROBLEM FOUND: The loaded private key address is NOT authorized as a marshal!');
            console.log('This explains the Auth() error - the contract is rejecting the transaction.');
            return;
        }
    } catch (error) {
        console.error('❌ Error checking marshal status:', error.message);
        return;
    }
    
    // Check if marshal is frozen
    try {
        const marshalFrozen = await foundation.marshalFrozen();
        console.log('🔒 Is marshal frozen?', marshalFrozen);
        
        if (marshalFrozen) {
            console.log('❌ PROBLEM FOUND: The marshal is frozen!');
            console.log('This would cause Auth() errors even if the address is authorized.');
            return;
        }
    } catch (error) {
        console.error('❌ Error checking marshal frozen status:', error.message);
        return;
    }
    
    // Test charterFund with a static call to see if it would succeed
    const owner = '0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6';
    const salt = '0x0000000000000000000000000000000000000000000000000000000000000001';
    
    console.log('\n=== Testing charterFund Static Call ===');
    console.log('Owner:', owner);
    console.log('Salt:', salt);
    
    try {
        // Try a static call to see if it would succeed
        const staticResult = await foundation.charterFund.staticCall(owner, salt);
        console.log('✅ Static call result:', staticResult);
        console.log('✅ The transaction should succeed - no Auth() error expected');
        
    } catch (error) {
        console.error('❌ Static call failed:', error.message);
        
        // Try to decode the error
        try {
            const iface = new ethers.Interface(foundationAbi);
            const parsed = iface.parseError(error.data || error.error?.data || error);
            console.log('🔍 Decoded error:', parsed?.name || 'Unknown error');
            
            if (parsed?.name === 'Auth') {
                console.log('❌ CONFIRMED: Auth() error is coming from the contract');
                console.log('This means the marshal authorization check is failing');
            }
        } catch (decodeError) {
            console.log('Could not decode error:', decodeError.message);
        }
    }
    
    console.log('\n=== Summary ===');
    console.log('If the signer address is authorized as a marshal and not frozen,');
    console.log('but you still get Auth() errors, the issue might be:');
    console.log('1. The transaction is being sent from a different address');
    console.log('2. The contract state has changed since this check');
    console.log('3. There are additional authorization checks in the contract');
}

checkMarshalAuth().catch(console.error);
