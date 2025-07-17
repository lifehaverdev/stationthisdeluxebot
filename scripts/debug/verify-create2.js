#!/usr/bin/env node
const { ethers } = require('ethers');
// --- Configuration ---
// These values should be set to match your environment for a valid test.
const CREDIT_VAULT_ADDRESS = '0x011528b1d5822B3269d919e38872cC33bdec6d17'; // The deployed CreditVault contract
const OWNER_ADDRESS = '0x1821bd18cbdd267ce4e389f893ddfe7beb333ab6';      // A sample owner address
const SAMPLE_SALT = ethers.hexlify(ethers.randomBytes(32));                     // A random salt for testing


const path = require('path');
const fs = require('fs');

// Load ABI and bytecode
const foundationAbi = require(path.resolve(__dirname, '../../src/core/contracts/abis/foundation.json'));
const charteredFundBytecode = require(path.resolve(__dirname, '../../src/core/contracts/abis/bytecode/charteredFund.bytecode.json'));

async function main() {
  let [,, foundationAddress, ownerAddress, saltHex] = process.argv;
  if (!foundationAddress || !ownerAddress || !saltHex) {
    foundationAddress = CREDIT_VAULT_ADDRESS;
    ownerAddress = OWNER_ADDRESS;
    saltHex = SAMPLE_SALT;
    console.error('Usage: node verify-create2.js <foundationAddress> <ownerAddress> <saltHex>');
    console.log('Using default values:');
    console.log('Foundation Address:', foundationAddress);
    console.log('Owner Address:', ownerAddress);
    console.log('Salt Hex:', saltHex);
    //process.exit(1);
  }

  // 1. Off-chain computation (must match saltMiningWorker.js)
  const constructorArgTypes = ['address', 'address'];
  const constructorArgs = [foundationAddress, ownerAddress];
  const encodedArgs = ethers.AbiCoder.defaultAbiCoder().encode(constructorArgTypes, constructorArgs);
  const bytecode = typeof charteredFundBytecode === 'string' ? charteredFundBytecode : charteredFundBytecode.object;
  const initCode = bytecode + encodedArgs.slice(2);
  const initCodeHash = ethers.keccak256(initCode);
  const predictedOffchain = ethers.getCreate2Address(foundationAddress, saltHex, initCodeHash);

  // 2. On-chain computation
  const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
  const foundation = new ethers.Contract(foundationAddress, foundationAbi, provider);
  const predictedOnchain = await foundation.computeCharterAddress(ownerAddress, saltHex);

  // 3. Compare and print result
  console.log('Off-chain predicted:', predictedOffchain);
  console.log('On-chain predicted:', predictedOnchain);
  if (predictedOffchain.toLowerCase() === predictedOnchain.toLowerCase()) {
    console.log('✅ SUCCESS: Off-chain and on-chain predictions match!');
  } else {
    console.error('❌ FAILURE: Off-chain and on-chain predictions DO NOT match!');
    process.exit(2);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
}); 