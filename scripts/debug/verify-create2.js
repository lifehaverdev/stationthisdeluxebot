const { ethers } = require('ethers');

// --- Configuration ---
// These values should be set to match your environment for a valid test.
const CREDIT_VAULT_ADDRESS = '0x011528b1d5822B3269d919e38872cC33bdec6d17'; // The deployed CreditVault contract
const OWNER_ADDRESS = '0x1821bd18cbdd267ce4e389f893ddfe7beb333ab6';      // A sample owner address
const SAMPLE_SALT = ethers.hexlify(ethers.randomBytes(32));                     // A random salt for testing

// --- Main Verification Logic ---
async function verifyCreate2() {
    console.log('--- CREATE2 Verification Script ---');
    console.log(`CreditVault: ${CREDIT_VAULT_ADDRESS}`);
    console.log(`Owner:       ${OWNER_ADDRESS}`);
    console.log(`Salt:        ${SAMPLE_SALT}`);
    console.log('------------------------------------');

    // 1. Load the VaultAccount creation bytecode
    let creationBytecode;
    try {
        const bytecodeJson = require('../../core/contracts/abis/creditVaultAccount.bytecode.json');
        creationBytecode = typeof bytecodeJson === 'string' ? bytecodeJson : bytecodeJson.object;
        if (!creationBytecode || !creationBytecode.startsWith('0x')) {
            throw new Error('Bytecode not found or in an invalid format.');
        }
        console.log('✅ Bytecode loaded successfully.');
    } catch (error) {
        console.error('❌ Failed to load VaultAccount bytecode:', error.message);
        return;
    }

    // 2. Construct the initCode hash (This is where the bug likely is)
    let initCodeHash;
    try {
        const constructorTypes = ['address', 'address'];
        const constructorArgs = [CREDIT_VAULT_ADDRESS, OWNER_ADDRESS];
        const encodedArgs = ethers.AbiCoder.defaultAbiCoder().encode(constructorTypes, constructorArgs);

        const initCode = creationBytecode + encodedArgs.slice(2);
        initCodeHash = ethers.keccak256(initCode);
        
        console.log('✅ initCode hash calculated:', initCodeHash);
    } catch(error) {
        console.error('❌ Error calculating initCodeHash:', error);
        return;
    }


    // 3. Compute the off-chain address
    let predictedAddress;
    try {
        predictedAddress = ethers.getCreate2Address(
            CREDIT_VAULT_ADDRESS,
            SAMPLE_SALT,
            initCodeHash
        );
        console.log('Predicted Address (Off-chain):', predictedAddress);
    } catch (error) {
        console.error('❌ Failed to compute off-chain address:', error);
        return;
    }
    
    console.log('------------------------------------');
    console.log('Next steps:');
    console.log('1. Add a `computeCreate2Address` view function to the CreditVault contract.');
    console.log('2. Call that on-chain function with the same Owner and Salt.');
    console.log('3. Compare the on-chain result with the "Predicted Address" above. They MUST match.');
}

verifyCreate2().catch(console.error); 