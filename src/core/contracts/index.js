const foundationAbi = require('./abis/foundation.json');
const charteredFundAbi = require('./abis/charteredFund.json');
const uniswapV3QuoterV2Abi = require('./abis/uniswapV3QuoterV2.json');
const { FOUNDATION_ADDRESSES, getFoundationAddress } = require('../services/alchemy/foundationConfig');

const contracts = {
  foundation: {
    abi: foundationAbi,
    addresses: {
      '1': FOUNDATION_ADDRESSES['1'] || null,
      '11155111': FOUNDATION_ADDRESSES['11155111'] || null,
      '8453': FOUNDATION_ADDRESSES['8453'] || null,
      '42161': FOUNDATION_ADDRESSES['42161'] || null,
    },
  },
  charteredFund: {
    abi: charteredFundAbi,
    // This contract is deployed via a factory, so it has no single static address.
    addresses: {}
  },
  uniswapV3QuoterV2: {
    abi: uniswapV3QuoterV2Abi,
    addresses: {
      mainnet: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      sepolia: '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3', // Example, needs verification
    }
  },
  USDC: {
    abi: [], // Using a generic ERC20 ABI is recommended for full functionality
    addresses: {
      mainnet: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    }
  },
  DAI: {
    abi: [],
    addresses: {
      mainnet: '0x6b175474e89094c44da98b954eedeac495271d0f',
    }
  },
  WETH: {
    abi: [],
    addresses: {
      mainnet: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    }
  }
};

/**
 * Gets all contract addresses for a given chain ID.
 * @param {string} chainId - The ID of the target chain (e.g., '1' for Mainnet, '11155111' for Sepolia).
 * @returns {object} An object where keys are contract names and values are their addresses for the given chain.
 */
function getContractAddresses(chainId) {
    const networkName = getNetworkName(chainId);
    if (!networkName) {
        throw new Error(`Unsupported chainId: ${chainId}`);
    }

    const addresses = {};
    for (const contractName in contracts) {
        if (contracts[contractName].addresses[networkName]) {
            addresses[contractName] = contracts[contractName].addresses[networkName];
        }
    }
    return addresses;
}

/**
 * Maps a chain ID to a network name used in the addresses object.
 * @param {string} chainId - The chain ID.
 * @returns {string|null} The corresponding network name or null if not found.
 */
function getNetworkName(chainId) {
    switch (String(chainId)) {
        case '1':
            return 'mainnet';
        case '11155111':
            return 'sepolia';
        // Add other networks here
        default:
            return null;
    }
}

module.exports = {
  contracts,
  getContractAddresses,
  getNetworkName,
}; 