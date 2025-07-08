// Shared token config for funding rates and decimals
// This should be the single source of truth for all token-related funding logic

const TOKEN_CONFIG = {
  '0x0000000000000000000000000000000000000000': { // ETH
    symbol: 'ETH',
    decimals: 18,
    fundingRate: 0.7,
    iconUrl: '/images/sandbox/components/eth.png',
  },
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { // USDC
    symbol: 'USDC',
    decimals: 6,
    fundingRate: 0.7,
    iconUrl: '/images/sandbox/components/usdc.png',
  },
  '0x0000000000c5dc95539589fbD24BE07c6C14eCa4': { // CULT
    symbol: 'CULT',
    decimals: 18,
    fundingRate: 0.95,
    iconUrl: '/images/sandbox/components/cult.png',
  },
  '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820': { // MS2
    symbol: 'MS2',
    decimals: 9,
    fundingRate: 0.95,
    iconUrl: '/images/sandbox/components/ms2.png',
  },
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { // WETH
    symbol: 'WETH',
    decimals: 18,
    fundingRate: 0.7,
    iconUrl: '/images/sandbox/components/weth.png',
  },
  '0xdac17f958d2ee523a2206206994597c13d831ec7': { // USDT
    symbol: 'USDT',
    decimals: 6,
    fundingRate: 0.7,
    iconUrl: '/images/sandbox/components/usdt.png',
  },
  '0x6982508145454ce325ddbe47a25d4ec3d2311933': { // PEPE
    symbol: 'PEPE',
    decimals: 18,
    fundingRate: 0.6,
    iconUrl: '/images/sandbox/components/pepe.png',
  },
  '0xaaeE1A9723aaDB7afA2810263653A34bA2C21C7a': { // MOG
    symbol: 'MOG',
    decimals: 18,
    fundingRate: 0.6,
    iconUrl: '/images/sandbox/components/mog.png',
  },
  '0xe0f63a424a4439cbe457d80e4f4b51ad25b2c56c': { // SPX6900
    symbol: 'SPX6900',
    decimals: 18,
    fundingRate: 0.6,
    iconUrl: '/images/sandbox/components/spx6900.png',
  },
};

const TRUSTED_NFT_COLLECTIONS = {
    // Mainnet Addresses
    "0x524cab2ec69124574082676e6f654a18df49a048": { fundingRate: 1, name: "MiladyStation" },
    "0xd3d9ddd0cf0a5f0bfb8f7fc9e046c5318a33c168": { fundingRate: 1, name: "Remilio" },
    "0x7bd29408f11d2bfc23c34f18275bbf23cf646e9c": { fundingRate: 1, name: "Milady" },
    "0x139a67691b353f1d3a5b82f0223707e4a81571db": { fundingRate: 1, name: "Kagami" },
    "0x88f253ab39797375a025e64a1324792c3a9de35d": { fundingRate: 0.65, name: "Bonkler" },
    "0x892972989e5a1b24d61f1c75908da684e27f46e5": { fundingRate: 0.85, name: "Fumo" },
    "0x42069055135d56221123495f5cff5bac4115b136": { fundingRate: 0.85, name: "CultExec" },
  };
  const BASELINE_NFT_FUNDING_RATE = 0.70;

const DEFAULT_FUNDING_RATE = 0.7;
const getTokenConfig = (address) => {
  if (!address) return null;
  return TOKEN_CONFIG[address.toLowerCase()] || null;
};

const getFundingRate = (address) => {
  const config = getTokenConfig(address);
  return config ? config.fundingRate : DEFAULT_FUNDING_RATE;
};

const getDecimals = (address) => {
  const config = getTokenConfig(address);
  return config ? config.decimals : 18;
};

module.exports = {
  TOKEN_CONFIG,
  DEFAULT_FUNDING_RATE,
  TRUSTED_NFT_COLLECTIONS,
  BASELINE_NFT_FUNDING_RATE,
  getTokenConfig,
  getFundingRate,
  getDecimals,
}; 