// Chain-aware Foundation.sol deployment addresses
// Keyed by chainId (string).
const FOUNDATION_ADDRESSES = {
  // Sepolia testnet
  '11155111': '0x011528b1d5822B3269d919e38872cC33bdec6d17',
  // Add mainnet and other networks when deployed
};

// Human-readable chain names mapped by chainId
const CHAIN_NAMES = {
  '1': 'Ethereum Mainnet',
  '11155111': 'Sepolia',
  '42161': 'Arbitrum One',
  '8453': 'Base',
};

function getFoundationAddress(chainId) {
  const addr = FOUNDATION_ADDRESSES[String(chainId)] || null;
  if (!addr) {
    throw new Error(`No Foundation deployment configured for chainId=${chainId}`);
  }
  return addr;
}

module.exports = {
  FOUNDATION_ADDRESSES,
  getFoundationAddress,
  CHAIN_NAMES,
};
