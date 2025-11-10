const { formatUnits } = require('ethers');

/**
 * Fetch balances for all known tokens for a vault.
 * @param {string} vaultAddress
 * @param {object} deps
 * @param {EthereumService} deps.ethereumService
 * @param {Array<{address:string,symbol:string,decimals:number}>} deps.knownTokens
 * @returns {Promise<Array<{tokenAddress,symbol,balanceWei,decimals}>>}
 */
async function vaultBalanceService(vaultAddress, deps) {
  const { ethereumService, knownTokens } = deps;
  const results = [];
  for (const t of knownTokens) {
    try {
      const custodyKey = vaultAddress + ':' + t.address; // or proper packing
      const raw = await ethereumService.read(
        process.env.CREDIT_VAULT_ADDRESS,
        require('../../contracts/creditVaultAbi.json'),
        'custody',
        custodyKey
      );
      const balanceWei = BigInt(raw);
      if (balanceWei > 0n) {
        results.push({ tokenAddress: t.address, symbol: t.symbol, balanceWei: balanceWei.toString(), decimals: t.decimals });
      }
    } catch(e) {
      // ignore token if fails
    }
  }
  return results;
}

module.exports = vaultBalanceService;
