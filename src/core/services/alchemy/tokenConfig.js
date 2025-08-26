// --- Chain-Aware Token & NFT Configuration ---------------------------------
// This file is the single source of truth for all token and NFT funding logic
// across multiple chains.  The previous implementation supported mainnet only.
// We now nest configs by `chainId` (string).  Helper functions preserve the
// original API surface while optionally accepting a `chainId` argument so that
// existing callers remain functional (they default to MAINNET_CHAIN_ID).

const MAINNET_CHAIN_ID = '1';
const SEPOLIA_CHAIN_ID = '11155111';

// NOTE:  The Sepolia addresses below are placeholders.  Replace with the actual
// deployed token addresses when available.
const TOKEN_CONFIG = {
  [MAINNET_CHAIN_ID]: {
    '0x0000000000000000000000000000000000000000': { // ETH
      symbol: 'ETH', decimals: 18, fundingRate: 0.7, iconUrl: '/images/sandbox/components/eth.png',
    },
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { // USDC
      symbol: 'USDC', decimals: 6, fundingRate: 0.7, iconUrl: '/images/sandbox/components/usdc.png',
    },
    '0x0000000000c5dc95539589fbD24BE07c6C14eCa4': { // CULT
      symbol: 'CULT', decimals: 18, fundingRate: 0.95, iconUrl: '/images/sandbox/components/cult.png',
    },
    '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820': { // MS2
      symbol: 'MS2', decimals: 9, fundingRate: 0.95, iconUrl: '/images/sandbox/components/ms2.png',
    },
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { // WETH
      symbol: 'WETH', decimals: 18, fundingRate: 0.7, iconUrl: '/images/sandbox/components/weth.png',
    },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { // USDT
      symbol: 'USDT', decimals: 6, fundingRate: 0.7, iconUrl: '/images/sandbox/components/usdt.png',
    },
    '0x6982508145454ce325ddbe47a25d4ec3d2311933': { // PEPE
      symbol: 'PEPE', decimals: 18, fundingRate: 0.6, iconUrl: '/images/sandbox/components/pepe.png',
    },
    '0xaaeE1A9723aaDB7afA2810263653A34bA2C21C7a': { // MOG
      symbol: 'MOG', decimals: 18, fundingRate: 0.6, iconUrl: '/images/sandbox/components/mog.png',
    },
    '0xe0f63a424a4439cbe457d80e4f4b51ad25b2c56c': { // SPX6900
      symbol: 'SPX6900', decimals: 18, fundingRate: 0.6, iconUrl: '/images/sandbox/components/spx6900.png',
    },
  },
  [SEPOLIA_CHAIN_ID]: {
    // ETH (Sepolia ether uses the zero-address same as mainnet)
    '0x0000000000000000000000000000000000000000': { symbol: 'ETH', decimals: 18, fundingRate: 0.7, iconUrl: '/images/sandbox/components/eth.png' },
  },
};

const TRUSTED_NFT_COLLECTIONS = {
  [MAINNET_CHAIN_ID]: {
    '0x524cab2ec69124574082676e6f654a18df49a048': { fundingRate: 1, name: 'MiladyStation', iconUrl: '/images/sandbox/components/miladystation.avif' },
    '0xd3d9ddd0cf0a5f0bfb8f7fc23c34f18275bbf23cf646e9c': { fundingRate: 1, name: 'Remilio', iconUrl: '/images/sandbox/components/remilio.gif' },
    '0x7bd29408f11d2bfc23c34f18275bbf23cf646e9c': { fundingRate: 1, name: 'Milady', iconUrl: '/images/sandbox/components/milady.png' },
    '0x139a67691b353f1d3a5b82f0223707e4a81571db': { fundingRate: 1, name: 'Kagami', iconUrl: '/images/sandbox/components/kagami.avif' },
    '0x88f253ab39797375a025e64a1324792c3a9de35d': { fundingRate: 0.65, name: 'Bonkler', iconUrl: '/images/sandbox/components/bonkler.avif' },
    '0x892972989e5a1b24d61f1c75908da684e27f46e5': { fundingRate: 0.85, name: 'Fumo', iconUrl: '/images/sandbox/components/fumo.avif' },
    '0x42069055135d56221123495f5cff5bac4115b136': { fundingRate: 0.85, name: 'Exec', iconUrl: '/images/sandbox/components/cultexecutives.avif' },
  },
  [SEPOLIA_CHAIN_ID]: {
    // Supply test-collection addresses if needed
  },
};

const BASELINE_NFT_FUNDING_RATE = 0.70;
const DEFAULT_FUNDING_RATE = 0.7;

// -------------------------- Helper Functions -------------------------------
function normaliseAddress(address) {
  return address ? address.toLowerCase() : '';
}

function normaliseChainId(chainId) {
  return chainId ? String(chainId) : MAINNET_CHAIN_ID;
}

function getChainTokenConfig(chainId = MAINNET_CHAIN_ID) {
  console.log('[tokenConfig] getChainTokenConfig(chainId=%s)', chainId);
  return TOKEN_CONFIG[normaliseChainId(chainId)] || TOKEN_CONFIG[MAINNET_CHAIN_ID];
}

// Instrument helpers for debugging
function _logKeys(label, obj) {
  if (obj && typeof obj === 'object') {
    console.log(`[tokenConfig] ${label} keys:`, Object.keys(obj));
  }
}

// Wrap original helpers with logging
const _origGetChainTokenConfig = getChainTokenConfig;
getChainTokenConfig = function(chainId = MAINNET_CHAIN_ID) {
  const cfg = _origGetChainTokenConfig(chainId);
  _logKeys('TOKEN_CONFIG[' + chainId + ']', cfg);
  return cfg;
};

function getTokenConfig(address, chainId = MAINNET_CHAIN_ID) {
  if (!address) return null;
  const chainConfig = getChainTokenConfig(chainId);
  return chainConfig[normaliseAddress(address)] || null;
}

function getFundingRate(address, chainId = MAINNET_CHAIN_ID) {
  const cfg = getTokenConfig(address, chainId);
  return cfg ? cfg.fundingRate : DEFAULT_FUNDING_RATE;
}

function getDecimals(address, chainId = MAINNET_CHAIN_ID) {
  const cfg = getTokenConfig(address, chainId);
  return cfg ? cfg.decimals : 18;
}

function getChainNftConfig(chainId = MAINNET_CHAIN_ID) {
  console.log('[tokenConfig] getChainNftConfig(chainId=%s)', chainId);
  const cfg = TRUSTED_NFT_COLLECTIONS[normaliseChainId(chainId)] || {};
  _logKeys('NFT_CONFIG[' + chainId + ']', cfg);
  return cfg;
}

const _origGetChainNftConfig = getChainNftConfig;
getChainNftConfig = function(chainId = MAINNET_CHAIN_ID) {
  console.log('[tokenConfig] getChainNftConfig(chainId=%s)', chainId);
  const cfg = _origGetChainNftConfig(chainId);
  _logKeys('NFT_CONFIG[' + chainId + ']', cfg);
  return cfg;
};

module.exports = {
  // Raw configs
  TOKEN_CONFIG,
  TRUSTED_NFT_COLLECTIONS,

  // Constants
  MAINNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  DEFAULT_FUNDING_RATE,
  BASELINE_NFT_FUNDING_RATE,

  // Helpers
  getTokenConfig,
  getFundingRate,
  getDecimals,
  getChainTokenConfig,
  getChainNftConfig,
}; 