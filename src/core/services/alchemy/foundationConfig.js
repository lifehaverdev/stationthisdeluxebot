// Chain-aware Foundation.sol deployment addresses
// Keyed by chainId (string).
const FOUNDATION_ADDRESSES = {
  // Sepolia testnet
  //'11155111': '0x01152E6f5177f2c4089612954b410820db946B5E',
  '1': '0x01152530028bd834EDbA9744885A882D025D84F6',
  //'42161': '0x01152E6f5177f2c4089612954b410820db946B5E',
  //'8453': '0x01152E6f5177f2c4089612954b410820db946B5E',
  // Add mainnet and other networks when deployed
};

// Chain-aware CharteredFund beacon addresses
// Keyed by chainId (string).
const CHARTER_BEACON_ADDRESSES = {
  // Mainnet
  '1': '0xeEd94eD20B79ED938518c6eEa4129cB1E8b8665C', 
  '11155111': '0x7C8C7D05EE257D334F90bc47EED83e5eF3e46587.',
  // Add other networks when deployed
};

// Human-readable chain names mapped by chainId
const CHAIN_NAMES = {
  '1': 'Ethereum Mainnet',
  '11155111': 'Sepolia',
  '42161': 'Arbitrum One',
  '8453': 'Base',
};

// Mapping from chainId to the name of the ENV variable that should contain the
// JSON-RPC URL for that network. Centralising this here avoids duplicating
// magic strings throughout the codebase and lets service initialisation look
// everything up via `getRpcUrl(chainId)`.
const RPC_ENV_VARS = {
  // Mainnet
  '1': 'ETHEREUM_RPC_URL',
  // Sepolia testnet
  '11155111': 'SEPOLIA_RPC_URL',
  // Arbitrum One
  '42161': 'ARBITRUM_RPC_URL',
  // Base mainnet
  '8453': 'BASE_RPC_URL',
};

function getRpcEnvVar(chainId) {
  return RPC_ENV_VARS[String(chainId)] || null;
}

function getRpcUrl(chainId) {
  const envVar = getRpcEnvVar(chainId);
  if (!envVar) {
    throw new Error(`No RPC ENV var configured for chainId=${chainId}`);
  }
  const url = process.env[envVar];
  if (!url) {
    throw new Error(`Environment variable ${envVar} is not set for chainId=${chainId}`);
  }
  return url;
}

function getFoundationAddress(chainId) {
  const addr = FOUNDATION_ADDRESSES[String(chainId)] || null;
  if (!addr) {
    throw new Error(`No Foundation deployment configured for chainId=${chainId}`);
  }
  return addr;
}

/**
 * Gets the CharteredFund beacon address for a given chain.
 * @param {string|number} chainId - The chain ID to get the beacon address for.
 * @returns {string} The beacon address for the specified chain.
 * @throws {Error} If no beacon is configured for the specified chain.
 */
function getCharterBeaconAddress(chainId) {
  const addr = CHARTER_BEACON_ADDRESSES[String(chainId)] || null;
  if (!addr) {
    throw new Error(`No CharteredFund beacon configured for chainId=${chainId}`);
  }
  return addr;
}

module.exports = {
  FOUNDATION_ADDRESSES,
  CHARTER_BEACON_ADDRESSES,
  getFoundationAddress,
  getCharterBeaconAddress,
  CHAIN_NAMES,
  RPC_ENV_VARS,
  getRpcEnvVar,
  getRpcUrl,
};