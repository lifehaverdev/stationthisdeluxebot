require('dotenv').config({ path: '../../.env' }); // Adjust path to root .env file

const EthereumService = require('../../src/core/services/alchemy/ethereumService');
const { createLogger } = require('../../src/utils/logger');
const { formatEther } = require('ethers'); // Ethers is needed for formatting results

// --- Configuration ---
// Make sure these environment variables are set in your .env file
const { 
  ETHEREUM_RPC_URL, 
  ETHEREUM_SIGNER_PRIVATE_KEY, 
  CHAIN_ID,
  CREDIT_VAULT_ADDRESS // The address of your deployed CreditVault contract
} = process.env;

// Import the contract ABI and new utils
const { creditVault } = require('../../src/core/contracts');
const { getCustodyKey, splitCustodyAmount } = require('../../src/core/services/alchemy/contractUtils');

// --- Main Script ---
async function main() {
  const logger = createLogger('test-script');
  logger.info('--- Starting EthereumService Test Script ---');

  // 1. Validate environment variables
  if (!ETHEREUM_RPC_URL || !ETHEREUM_SIGNER_PRIVATE_KEY || !CHAIN_ID) {
    logger.error('Missing required environment variables: ETHEREUM_RPC_URL, ETHEREUM_SIGNER_PRIVATE_KEY, CHAIN_ID');
    return;
  }
  
  // 2. Initialize EthereumService
  logger.info('Initializing EthereumService...');
  const ethereumService = new EthereumService({
    rpcUrl: ETHEREUM_RPC_URL,
    privateKey: ETHEREUM_SIGNER_PRIVATE_KEY,
    chainId: CHAIN_ID,
  }, logger);
  logger.info(`Service initialized. Signer Address: ${ethereumService.getSigner().address}`);
  
  
  // 3. Test 1: Get Latest Block Number
  try {
    logger.info('\n--- Test 1: Fetching latest block number ---');
    const latestBlock = await ethereumService.getLatestBlock();
    logger.info(`✅ Success! Latest block number: ${latestBlock}`);
  } catch (error) {
    logger.error('❌ Test 1 Failed:', error.message);
  }
  
  
  // 4. Test 2: Read from a contract's public mapping
  //    This is a placeholder example. You will need to:
  //    a) Make sure CREDIT_VAULT_ADDRESS is set in your .env file.
  //    b) Ensure the function/mapping name and arguments are correct for your contract.
  try {
    logger.info('\n--- Test 2: Reading from a contract ---');
    if (!CREDIT_VAULT_ADDRESS) {
      logger.warn('⚠️ Test 2 Skipped: CREDIT_VAULT_ADDRESS is not set in .env file.');
      return;
    }

    // --- Replace with your actual function name and arguments ---
    const functionNameToCall = 'isVaultAccount'; // e.g., your 'custody' mapping name
    const addressToCheck = ethereumService.getSigner().address; // e.g., an address to check in the mapping
    // ---

    logger.info(`Attempting to call '${functionNameToCall}(${addressToCheck})' on contract: ${CREDIT_VAULT_ADDRESS}`);

    const result = await ethereumService.read(
      CREDIT_VAULT_ADDRESS,
      creditVault.abi,
      functionNameToCall,
      addressToCheck
    );

    logger.info(`✅ Success! Raw result from contract:`);
    console.log(result);

  } catch (error) {
    // This might fail if the function doesn't exist in the ABI or on the contract.
    logger.error(`❌ Test 2 Failed: ${error.message}`);
    logger.error('   Please check that the contract address, function name, arguments, and ABI are all correct.');
  }

  // 5. Test 3: Read a specific custody balance
  try {
    logger.info('\n--- Test 3: Reading a packed custody balance ---');
    if (!CREDIT_VAULT_ADDRESS) {
      logger.warn('⚠️ Test 3 Skipped: CREDIT_VAULT_ADDRESS is not set in .env file.');
      return;
    }

    // --- Configuration for this test ---
    const vaultAccountForCustody = CREDIT_VAULT_ADDRESS; // For main vault, this is the same
    const userAddressToCheck = '0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6';
    const tokenAddressToCheck = '0x0000000000000000000000000000000000000000'; // address(0) for ETH
    const custodyMappingName = 'custody';
    // ---

    logger.info(`Checking balance for user ${userAddressToCheck} in vault ${vaultAccountForCustody}`);

    // a) Replicate the on-chain key generation
    const custodyKey = getCustodyKey(userAddressToCheck, tokenAddressToCheck);
    logger.info(`Generated Custody Key: ${custodyKey}`);

    // b) Read from the public mapping using the generated key
    const packedBalance = await ethereumService.read(
      CREDIT_VAULT_ADDRESS,
      creditVault.abi,
      custodyMappingName,
      custodyKey
    );
    logger.info(`Raw packed balance from contract: ${packedBalance}`);

    // c) Decode the packed value using our utility
    const { userOwned, escrow } = splitCustodyAmount(packedBalance);

    logger.info(`✅ Success! Decoded Balance:`);
    logger.info(`   - User Owned: ${formatEther(userOwned)} ETH`);
    logger.info(`   - Escrow: ${formatEther(escrow)} ETH`);

  } catch (error) {
    logger.error(`❌ Test 3 Failed: ${error.message}`);
    logger.error('   This can happen if the custody key does not exist, which may return an error or a zero value depending on the node.');
  }
}

main();