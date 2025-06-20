const { solidityPackedKeccak256, ZeroAddress, toBigInt } = require('ethers');

// (2n ** 128n) - 1n;
const MAX_UINT_128 = 340282366920938463463374607431768211455n;

/**
 * Replicates the on-chain logic for creating a custody lookup key.
 * The key is used to look up a user's balance for a specific token
 * within a specific vault account.
 * Key Schema: keccak256(abi.encodePacked(userAddress, tokenAddress))
 * @param {string} userAddress - The user's wallet address.
 * @param {string} tokenAddress - The token's contract address ('0x0000...' for ETH).
 * @returns {string} The keccak256 hash to be used as the custody key.
 */
function getCustodyKey(userAddress, tokenAddress) {
  const custodyKey = solidityPackedKeccak256(
    ['address', 'address'],
    [userAddress, tokenAddress]
  );
  
  return custodyKey;
}

/**
 * Replicates the on-chain logic for splitting a packed balance into its components.
 * The on-chain value is a bytes32, packing two uint128 values.
 * - userOwned = lower 128 bits
 * - escrow = upper 128 bits
 * @param {string} packedAmount - The bytes32 string from the custody mapping.
 * @returns {{userOwned: BigInt, escrow: BigInt}} An object containing the decoded BigInt values.
 */
function splitCustodyAmount(packedAmount) {
    const amountBN = toBigInt(packedAmount);
    
    // escrow is the upper 128 bits, so we shift right by 128
    const escrow = amountBN >> 128n;

    // userOwned is the lower 128 bits, so we apply a mask of (2^128 - 1)
    const userOwned = amountBN & MAX_UINT_128;
    
    return {
        userOwned,
        escrow
    };
}

module.exports = {
  getCustodyKey,
  splitCustodyAmount,
}; 