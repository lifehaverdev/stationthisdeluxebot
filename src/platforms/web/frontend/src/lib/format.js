/**
 * Shared formatting utilities for the admin dashboard.
 */

export const TOKEN_METADATA = {
  '0x0000000000000000000000000000000000000000': { symbol: 'ETH', decimals: 18 },
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6 },
  '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', decimals: 18 },
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', decimals: 18 },
  '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', decimals: 6 },
  '0x98ed411b8cf8536657c660db8aa55d9d4baaf820': { symbol: 'MS2', decimals: 6 },
  '0x6982508145454ce325ddbe47a25d4ec3d2311933': { symbol: 'PEPE', decimals: 18 },
  '0xaaee1a9723aadb7afa2810263653a34ba2c21c7a': { symbol: 'MOG', decimals: 18 },
  '0xe0f63a424a4439cbe457d80e4f4b51ad25b2c56c': { symbol: 'SPX6900', decimals: 18 }
};

export const USD_PER_POINT = 0.000337;

export function getTokenMetadata(tokenAddress) {
  if (!tokenAddress) return { symbol: 'UNKNOWN', decimals: 18 };
  return TOKEN_METADATA[tokenAddress.toLowerCase()] || { symbol: tokenAddress.slice(0, 6), decimals: 18 };
}

export function formatUnits(value, decimals = 18) {
  const val = BigInt(value);
  const divisor = 10n ** BigInt(decimals);
  const whole = val / divisor;
  const fraction = (val % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
}

export function formatTokenAmount(amountWei, tokenAddress) {
  try {
    const { decimals, symbol } = getTokenMetadata(tokenAddress);
    if (amountWei === undefined || amountWei === null) return 'N/A';
    const formatted = formatUnits(amountWei.toString(), decimals);
    return `${parseFloat(formatted).toFixed(6)} ${symbol}`;
  } catch {
    return `${amountWei} (raw)`;
  }
}

export function shortHash(value) {
  if (!value || typeof value !== 'string') return 'N/A';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function relativeTime(timestamp) {
  if (!timestamp) return '';
  const deltaMs = Date.now() - new Date(timestamp).getTime();
  if (deltaMs < 1000) return 'just now';
  const mins = Math.floor(deltaMs / (60 * 1000));
  if (mins < 1) return 'seconds ago';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatNumber(num) {
  return parseInt(num).toLocaleString();
}

export function formatUsd(val) {
  return '$' + parseFloat(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
