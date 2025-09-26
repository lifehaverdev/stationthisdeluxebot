const { ethers } = require('ethers');
const { getFoundationAddress, getRpcUrl } = require('../../src/core/services/alchemy/foundationConfig');

async function checkMarshalStatus() {
    const chainId = process.env.CHAIN_ID || '1';
    const rpcUrl = getRpcUrl(chainId);
    const foundationAddress = getFoundationAddress(chainId);
    
    console.log('=== Marshal Status Check ===');
    console.log('Chain ID:', chainId);
    console.log('Foundation address:', foundationAddress);
    console.log('RPC URL:', rpcUrl);
    console.log();
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const foundationAbi = require('../../src/core/contracts/abis/foundation.json');
    const foundation = new ethers.Contract(foundationAddress, foundationAbi, provider);
    
    // The signer address from the logs
    const signerAddress = '0x428Bea9Fd786659c84b0bD62D372bb4a482aF653';
    
    console.log('🔑 Checking marshal status for address:', signerAddress);
    console.log();
    
    // Check if the signer is authorized as a marshal
    try {
        const isMarshal = await foundation.isMarshal(signerAddress);
        console.log('✅ Is signer a marshal?', isMarshal);
        
        if (!isMarshal) {
            console.log('❌ PROBLEM FOUND: The signer address is NOT authorized as a marshal!');
            console.log('This explains the Auth() error - the contract is rejecting the transaction.');
            console.log('The address needs to be authorized using the setMarshal function.');
            return;
        } else {
            console.log('✅ The signer address IS authorized as a marshal');
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
        } else {
            console.log('✅ The marshal is not frozen');
        }
    } catch (error) {
        console.error('❌ Error checking marshal frozen status:', error.message);
        return;
    }
    
    console.log('\n=== Summary ===');
    console.log('✅ Signer address is authorized as marshal');
    console.log('✅ Marshal is not frozen');
    console.log('❓ If you are still getting Auth() errors, the issue might be:');
    console.log('   1. The transaction is being sent from a different address');
    console.log('   2. There are additional authorization checks in the contract');
    console.log('   3. The contract state has changed since this check');
    console.log('   4. There is a bug in the contract logic');
}

checkMarshalStatus().catch(console.error);
