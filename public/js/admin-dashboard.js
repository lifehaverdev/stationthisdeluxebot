import { setupWalletGate, adminVerified, currentAccount, onAdminStatusChange } from './wallet-gate.js';
import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@6.10.0/+esm';
import {
  createLineChart,
  createBarChart,
  createPointUsageChartData,
  createDepositsChartData,
  createActiveUsersChartData,
  createWithdrawalsChartData,
  exportChartDataToCSV,
  exportChartAsImage,
  CHART_OPTIONS,
  CHART_COLORS
} from './admin-charts.js';
import { websocketClient } from './websocketClient.js';

// Use imported CHART_OPTIONS or fallback
const CHART_CONFIG = CHART_OPTIONS || {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        color: '#e0e0e0'
      }
    },
    tooltip: {
      backgroundColor: '#23272f',
      titleColor: '#e0e0e0',
      bodyColor: '#e0e0e0',
      borderColor: '#444',
      borderWidth: 1
    }
  },
  scales: {
    x: {
      ticks: {
        color: '#e0e0e0'
      },
      grid: {
        color: '#444'
      }
    },
    y: {
      ticks: {
        color: '#e0e0e0'
      },
      grid: {
        color: '#444'
      }
    }
  }
};

// Use imported CHART_COLORS or fallback
const CHART_COLORS_CONFIG = CHART_COLORS || {
  primary: '#90caf9',
  secondary: '#4caf50',
  warning: '#ff9800',
  error: '#d32f2f',
  background: '#1a1a1a',
  grid: '#444',
  text: '#e0e0e0'
};

const TOKEN_METADATA = {
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

const DEPOSIT_QUEUE_STORAGE_KEY = 'adminDepositFollowUpQueue';
const DEPOSIT_RECOVERY_DEFAULT_STATUSES = ['PENDING_CONFIRMATION', 'ERROR', 'FAILED_RISK_ASSESSMENT', 'REJECTED_UNPROFITABLE'];

// Constants
const USD_PER_POINT = 0.000337; // 1 point = $0.000337 USD

// Foundation contract address (mainnet)
const FOUNDATION_ADDRESS = '0x01152530028bd834EDbA9744885A882D025D84F6';
const FOUNDATION_ABI = [
  'function requestRescission(address token) external',
  'function custody(bytes32) view returns (bytes32)'
];
const CHARTERED_FUND_ABI = [
  'function requestRescission(address token) external',
  'function custody(bytes32) view returns (bytes32)'
];

// Utility functions for custody key and balance decoding
const MAX_UINT_128 = 340282366920938463463374607431768211455n; // (2^128 - 1)

function getCustodyKey(userAddress, tokenAddress) {
  return ethers.solidityPackedKeccak256(
    ['address', 'address'],
    [userAddress, tokenAddress]
  );
}

function splitCustodyAmount(packedAmount) {
  const amountBN = BigInt(packedAmount);
  const escrow = amountBN >> 128n;
  const userOwned = amountBN & MAX_UINT_128;
  return { userOwned, escrow };
}

function getTokenMetadata(tokenAddress) {
  if (!tokenAddress) {
    return { symbol: 'UNKNOWN', decimals: 18 };
  }
  const normalized = tokenAddress.toLowerCase();
  return TOKEN_METADATA[normalized] || { symbol: normalized.slice(0, 6), decimals: 18 };
}

function formatTokenAmountDisplay(amountWei, tokenAddress) {
  try {
    const { decimals, symbol } = getTokenMetadata(tokenAddress);
    if (amountWei === undefined || amountWei === null) return 'N/A';
    const formatted = ethers.formatUnits(amountWei.toString(), decimals);
    return `${parseFloat(formatted).toFixed(6)} ${symbol}`;
  } catch (error) {
    console.warn('[AdminDashboard] Failed to format token amount', error);
    return `${amountWei} (raw)`;
  }
}

function shortHash(value) {
  if (!value || typeof value !== 'string') return 'N/A';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function relativeTimeFrom(timestamp) {
  if (!timestamp) return '';
  const deltaMs = Date.now() - new Date(timestamp).getTime();
  if (deltaMs < 1000) return 'just now';
  const mins = Math.floor(deltaMs / (60 * 1000));
  if (mins < 1) return 'seconds ago';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatFailureMessage(deposit) {
  const reason = deposit.failure_reason || deposit.failureReason || '';
  const details = deposit.error_details || deposit.errorDetails || '';
  if (!reason && !details) {
    return '<span style="color:#888;">None</span>';
  }
  let html = '';
  if (reason) {
    html += `<div style="color:#ff9800;">${escapeHtml(reason)}</div>`;
  }
  if (details) {
    const detailText = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
    const trimmed = detailText.length > 220 ? `${detailText.slice(0, 220)}…` : detailText;
    html += `<div style="color:#888;font-size:0.85em;margin-top:0.25rem;">${escapeHtml(trimmed)}</div>`;
  }
  return html;
}

function buildDepositPayload(deposit, masterAccountId) {
  return {
    masterAccountId: masterAccountId || deposit.master_account_id,
    depositor: deposit.depositor_address || deposit.depositorAddress,
    token: deposit.token_address || deposit.tokenAddress,
    vault: deposit.vault_account || deposit.vaultAddress,
    depositTxHash: deposit.deposit_tx_hash,
    confirmationTxHash: deposit.confirmation_tx_hash || null,
    status: deposit.status,
    amountWei: deposit.deposit_amount_wei || deposit.depositAmountWei,
    failureReason: deposit.failure_reason || deposit.failureReason || null,
    errorDetails: deposit.error_details || deposit.errorDetails || null,
    createdAt: deposit.createdAt,
    updatedAt: deposit.updatedAt
  };
}

function formatQueueAction(action) {
  switch (action) {
    case 'REFUND':
      return 'Refund / Rescind';
    case 'RECONFIRM':
    default:
      return 'Retry Confirmation';
  }
}

let provider = null;
let signer = null;
let foundationContract = null;

function loadDepositQueueFromStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(DEPOSIT_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[AdminDashboard] Failed to load deposit queue from storage', error);
    return [];
  }
}

function persistDepositQueue() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(DEPOSIT_QUEUE_STORAGE_KEY, JSON.stringify(state.depositFollowUpQueue || []));
  } catch (error) {
    console.warn('[AdminDashboard] Failed to persist deposit queue', error);
  }
}

const state = {
  loading: false,
  balances: null,
  onChainBalances: null, // On-chain verification data
  withdrawalRequests: [],
  accounts: null, // All user accounts with balances
  freePoints: null, // Free points (reward credits) data
  analytics: null, // Usage analytics data
  withdrawalAnalytics: null, // Withdrawal analytics data
  rankings: null, // Tool/command usage rankings
  rankingsSortBy: 'usage', // Sort by: usage, points, users, revenue
  rankingsServiceFilter: null, // Optional service filter
  activeUsers: null, // Most active users data
  activeUsersSortBy: 'points', // Sort by: points, generations, deposits, tenure
  accounting: null, // Business accounting data
  accountingPeriod: 'mtd', // all, ytd, mtd, custom
  charts: {}, // Chart instances
  costs: null, // Cost entries
  costTotals: null, // Cost totals by category
  dateRange: {
    period: 'daily',
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
    endDate: new Date()
  },
  activityFeed: [], // Real-time activity feed
  alerts: [], // System alerts
  userSearch: {
    query: '',
    results: [],
    selectedUser: null,
    loading: false
  },
  depositDiagnostics: {},
  depositFollowUpQueue: loadDepositQueueFromStorage(),
  depositRecovery: {
    loading: false,
    deposits: [],
    metrics: null,
    filters: {
      statuses: [...DEPOSIT_RECOVERY_DEFAULT_STATUSES],
      token: ''
    },
    error: null
  },
  error: null
};

setupWalletGate();

onAdminStatusChange(async (isAdmin) => {
  if (isAdmin && currentAccount) {
    await initializeContracts();
    await loadDashboard();
    await setupActivityFeed();
  } else {
    hideAdminContent();
    disconnectActivityFeed();
  }
});

async function setupActivityFeed() {
  if (!currentAccount) {
    console.warn('[AdminDashboard] No wallet connected, cannot setup WebSocket');
    return;
  }

  // Use imported websocketClient or fallback to window.websocketClient
  const wsClient = (typeof websocketClient !== 'undefined' && websocketClient) || (typeof window !== 'undefined' && window.websocketClient);

  if (!wsClient) {
    console.warn('[AdminDashboard] WebSocket client not available');
    return;
  }

  // Try to connect with existing JWT first (from httpOnly cookie)
  // Only request new signature if connection fails
  let needsAuth = false;

  try {
    // Attempt connection - if JWT cookie exists and is valid, this will work
    wsClient.connect();

    // Wait a bit to see if connection succeeds
    await new Promise((resolve) => {
      const checkConnection = () => {
        if (wsClient.isConnected && wsClient.isConnected()) {
          resolve();
        } else if (wsClient.connectionFailed) {
          needsAuth = true;
          resolve();
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      // Timeout after 2 seconds
      setTimeout(() => {
        if (!wsClient.isConnected || !wsClient.isConnected()) {
          needsAuth = true;
        }
        resolve();
      }, 2000);
      checkConnection();
    });
  } catch (e) {
    needsAuth = true;
  }

  // If we need fresh auth, sign and verify
  if (needsAuth && signer) {
    try {
      console.log('[AdminDashboard] WebSocket needs auth, requesting signature...');

      // Get nonce
      const nonceResponse = await fetch('/api/v1/auth/web3/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: currentAccount })
      });

      if (!nonceResponse.ok) {
        console.warn('[AdminDashboard] Failed to get nonce for WebSocket auth');
        return;
      }

      const { nonce } = await nonceResponse.json();
      const signature = await signer.signMessage(nonce);

      // Verify and get JWT
      const verifyResponse = await fetch('/api/v1/auth/web3/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: currentAccount, signature })
      });

      if (!verifyResponse.ok) {
        console.warn('[AdminDashboard] Failed to verify signature for WebSocket auth');
        return;
      }

      console.log('[AdminDashboard] JWT token obtained, reconnecting WebSocket...');
      wsClient.connect();
    } catch (error) {
      console.error('[AdminDashboard] Error setting up WebSocket authentication:', error);
      return;
    }
  }

  // Listen for admin activity events
  wsClient.on('adminActivity', (payload) => {
    const activity = {
      ...payload,
      id: Date.now() + Math.random(),
      receivedAt: new Date()
    };
    
    state.activityFeed.unshift(activity);
    // Keep only last 100 items
    if (state.activityFeed.length > 100) {
      state.activityFeed = state.activityFeed.slice(0, 100);
    }

    // If it's an alert, add to alerts array
    if (payload.eventType === 'alert') {
      state.alerts.unshift(activity);
      if (state.alerts.length > 50) {
        state.alerts = state.alerts.slice(0, 50);
      }
      // Show notification for alerts
      showNotification(payload.severity === 'error' ? 'error' : payload.severity === 'warning' ? 'warning' : 'info', payload.message || 'System alert');
    }

    render();
  });

  wsClient.on('open', () => {
    console.log('[AdminDashboard] WebSocket connected for activity feed');
  });

  wsClient.on('close', () => {
    console.log('[AdminDashboard] WebSocket disconnected');
  });
}

async function loadDepositRecoveryData(options = {}) {
  const { suppressRender = false } = options;
  if (!currentAccount) return;
  if (!suppressRender) {
    state.depositRecovery.loading = true;
    render();
  } else {
    state.depositRecovery.loading = true;
  }

  try {
    const params = new URLSearchParams();
    params.set('wallet', currentAccount);
    params.set('chainId', '1');
    if (state.depositRecovery.filters.statuses.length > 0) {
      params.set('statuses', state.depositRecovery.filters.statuses.join(','));
    }
    if (state.depositRecovery.filters.token) {
      params.set('token', state.depositRecovery.filters.token.trim());
    }

    const response = await fetch(`/api/v1/admin/vaults/deposits/pending?${params.toString()}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || 'Failed to fetch pending deposits');
    }

    const data = await response.json();
    state.depositRecovery.deposits = data.deposits || [];
    state.depositRecovery.metrics = data.metrics || null;
    state.depositRecovery.error = null;
  } catch (error) {
    console.error('[AdminDashboard] Failed to load deposit recovery data:', error);
    state.depositRecovery.error = error.message;
  } finally {
    state.depositRecovery.loading = false;
    if (!suppressRender) {
      render();
    }
  }
}

function disconnectActivityFeed() {
  const wsClient = (typeof websocketClient !== 'undefined' && websocketClient) || (typeof window !== 'undefined' && window.websocketClient);
  if (wsClient) {
    wsClient.off('adminActivity');
    wsClient.off('open');
    wsClient.off('close');
  }
}

async function initializeContracts() {
  if (!window.ethereum) {
    state.error = 'No Ethereum wallet found';
    return;
  }

  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    
    // Get chain ID to determine Foundation address
    const network = await provider.getNetwork();
    // For now, assume mainnet (chainId 1)
    foundationContract = new ethers.Contract(FOUNDATION_ADDRESS, FOUNDATION_ABI, signer);
  } catch (error) {
    console.error('Error initializing contracts:', error);
    state.error = 'Failed to initialize contracts';
  }
}

async function loadDashboard() {
  if (!currentAccount) return;

  state.loading = true;
  state.error = null;
  render();

  try {
    // Fetch vault balances
    const balancesResponse = await fetch(`/api/v1/admin/vaults/vault-balances?wallet=${currentAccount}&chainId=1`);
    if (!balancesResponse.ok) {
      throw new Error(`Failed to fetch balances: ${balancesResponse.statusText}`);
    }
    const balancesData = await balancesResponse.json();
    state.balances = balancesData;
    
    // Debug log to see what we got
    console.log('[AdminDashboard] Received balances data:', balancesData);

    // Fetch on-chain balances for verification
    if (provider && foundationContract) {
      state.onChainBalances = await fetchOnChainBalances(balancesData);
      console.log('[AdminDashboard] On-chain balances:', state.onChainBalances);
    }

    // Fetch withdrawal requests
    const requestsResponse = await fetch(`/api/v1/admin/vaults/withdrawal-requests?wallet=${currentAccount}&status=PENDING_PROCESSING`);
    if (requestsResponse.ok) {
      const requestsData = await requestsResponse.json();
      state.withdrawalRequests = requestsData.requests || [];
    }

    // Fetch all accounts
    const accountsResponse = await fetch(`/api/v1/admin/vaults/accounts?wallet=${currentAccount}&chainId=1`);
    if (accountsResponse.ok) {
      const accountsData = await accountsResponse.json();
      state.accounts = accountsData.accounts || [];
      console.log('[AdminDashboard] Received accounts data:', accountsData);
    }

    // Fetch free points data
    const freePointsResponse = await fetch(`/api/v1/admin/vaults/free-points?wallet=${currentAccount}&chainId=1`);
    if (freePointsResponse.ok) {
      const freePointsData = await freePointsResponse.json();
      state.freePoints = freePointsData;
      console.log('[AdminDashboard] Received free points data:', freePointsData);
    }

    // Fetch analytics data
    await loadAnalytics();

    // Fetch costs data
    await loadCosts();

    // Fetch deposit recovery telemetry
    await loadDepositRecoveryData({ suppressRender: true });

    state.loading = false;
    render();
  } catch (error) {
    console.error('Error loading dashboard:', error);
    state.error = error.message;
    state.loading = false;
    render();
  }
}

/**
 * Fetches on-chain balances for all tokens and vaults
 * @param {object} dbBalances - The balances from the database
 * @returns {Promise<object>} On-chain balance data
 */
async function fetchOnChainBalances(dbBalances) {
  if (!provider || !foundationContract) {
    console.warn('[AdminDashboard] Provider or contract not initialized');
    return null;
  }

  const onChainData = {
    foundation: [],
    charteredVaults: []
  };

  try {
    // Fetch Foundation protocol escrow balances
    if (dbBalances.foundation && dbBalances.foundation.length > 0) {
      for (const token of dbBalances.foundation) {
        try {
          // Protocol escrow is at custody key (FOUNDATION_ADDRESS, tokenAddress)
          const custodyKey = getCustodyKey(FOUNDATION_ADDRESS, token.tokenAddress);
          const packedAmount = await foundationContract.custody(custodyKey);
          const { userOwned, escrow } = splitCustodyAmount(packedAmount);

          onChainData.foundation.push({
            tokenAddress: token.tokenAddress,
            symbol: token.symbol,
            decimals: token.decimals,
            protocolEscrow: escrow.toString(),
            userOwned: userOwned.toString()
          });
        } catch (error) {
          console.error(`[AdminDashboard] Error fetching on-chain balance for ${token.symbol}:`, error);
          onChainData.foundation.push({
            tokenAddress: token.tokenAddress,
            symbol: token.symbol,
            decimals: token.decimals,
            protocolEscrow: '0',
            userOwned: '0',
            error: error.message
          });
        }
      }
    }

    // Fetch chartered vault balances
    if (dbBalances.charteredVaults && dbBalances.charteredVaults.length > 0) {
      for (const vault of dbBalances.charteredVaults) {
        const vaultOnChain = {
          vaultAddress: vault.vaultAddress,
          vaultName: vault.vaultName,
          tokens: []
        };

        // Create contract instance for this vault
        const vaultContract = new ethers.Contract(vault.vaultAddress, CHARTERED_FUND_ABI, provider);

        if (vault.tokens && vault.tokens.length > 0) {
          for (const token of vault.tokens) {
            try {
              const custodyKey = getCustodyKey(vault.vaultAddress, token.tokenAddress);
              const packedAmount = await vaultContract.custody(custodyKey);
              const { userOwned, escrow } = splitCustodyAmount(packedAmount);

              vaultOnChain.tokens.push({
                tokenAddress: token.tokenAddress,
                symbol: token.symbol,
                decimals: token.decimals,
                userOwned: userOwned.toString(),
                escrow: escrow.toString()
              });
            } catch (error) {
              console.error(`[AdminDashboard] Error fetching on-chain balance for vault ${vault.vaultName} token ${token.symbol}:`, error);
              vaultOnChain.tokens.push({
                tokenAddress: token.tokenAddress,
                symbol: token.symbol,
                decimals: token.decimals,
                userOwned: '0',
                escrow: '0',
                error: error.message
              });
            }
          }
        }

        onChainData.charteredVaults.push(vaultOnChain);
      }
    }
  } catch (error) {
    console.error('[AdminDashboard] Error fetching on-chain balances:', error);
    return null;
  }

  return onChainData;
}

function formatUnits(value, decimals = 18) {
  const val = BigInt(value);
  const divisor = 10n ** BigInt(decimals);
  const whole = val / divisor;
  const fraction = (val % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
}

async function loadAnalytics() {
  if (!currentAccount) return;

  try {
    const { period, startDate, endDate } = state.dateRange;
    const params = new URLSearchParams({
      wallet: currentAccount,
      chainId: '1',
      period: period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });

    // Fetch usage analytics
    const usageResponse = await fetch(`/api/v1/admin/vaults/analytics/usage?${params}`);
    if (usageResponse.ok) {
      const usageData = await usageResponse.json();
      state.analytics = usageData;
      console.log('[AdminDashboard] Received analytics data:', usageData);
    }

    // Fetch withdrawal analytics
    const withdrawalResponse = await fetch(`/api/v1/admin/vaults/analytics/withdrawals?${params}`);
    if (withdrawalResponse.ok) {
      const withdrawalData = await withdrawalResponse.json();
      state.withdrawalAnalytics = withdrawalData;
      console.log('[AdminDashboard] Received withdrawal analytics data:', withdrawalData);
    }

    // Fetch rankings
    const rankingsParams = new URLSearchParams({
      wallet: currentAccount,
      chainId: '1',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      sortBy: state.rankingsSortBy || 'usage',
      limit: '50'
    });
    if (state.rankingsServiceFilter) {
      rankingsParams.append('serviceName', state.rankingsServiceFilter);
    }
    const rankingsResponse = await fetch(`/api/v1/admin/vaults/analytics/rankings?${rankingsParams}`);
    if (rankingsResponse.ok) {
      const rankingsData = await rankingsResponse.json();
      state.rankings = rankingsData;
      console.log('[AdminDashboard] Received rankings data:', rankingsData);
    }

    // Fetch active users
    const activeUsersParams = new URLSearchParams({
      wallet: currentAccount,
      chainId: '1',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      sortBy: state.activeUsersSortBy || 'points',
      limit: '50'
    });
    const activeUsersResponse = await fetch(`/api/v1/admin/vaults/analytics/active-users?${activeUsersParams}`);
    if (activeUsersResponse.ok) {
      const activeUsersData = await activeUsersResponse.json();
      state.activeUsers = activeUsersData;
      console.log('[AdminDashboard] Received active users data:', activeUsersData);
    }

    // Fetch accounting data
    const accountingParams = new URLSearchParams({
      wallet: currentAccount,
      chainId: '1',
      period: state.accountingPeriod || 'mtd'
    });
    if (state.accountingPeriod === 'custom') {
      accountingParams.append('startDate', startDate.toISOString());
      accountingParams.append('endDate', endDate.toISOString());
    }
    const accountingResponse = await fetch(`/api/v1/admin/vaults/analytics/accounting?${accountingParams}`);
    if (accountingResponse.ok) {
      const accountingData = await accountingResponse.json();
      state.accounting = accountingData;
      console.log('[AdminDashboard] Received accounting data:', accountingData);
    }
  } catch (error) {
    console.error('Error loading analytics:', error);
  }
}

async function loadCosts() {
  if (!currentAccount) return;

  try {
    const params = new URLSearchParams({
      wallet: currentAccount,
      limit: '50'
    });

    // Fetch costs
    const costsResponse = await fetch(`/api/v1/admin/vaults/costs?${params}`);
    if (costsResponse.ok) {
      const costsData = await costsResponse.json();
      state.costs = costsData.costs || [];
      console.log('[AdminDashboard] Received costs data:', costsData);
    }

    // Fetch cost totals
    const totalsResponse = await fetch(`/api/v1/admin/vaults/costs/totals/by-category?wallet=${currentAccount}`);
    if (totalsResponse.ok) {
      const totalsData = await totalsResponse.json();
      state.costTotals = totalsData.totals || [];
      console.log('[AdminDashboard] Received cost totals data:', totalsData);
    }
  } catch (error) {
    console.error('Error loading costs:', error);
  }
}

function render() {
  const container = document.querySelector('.admin-content-placeholder');
  if (!container) return;

  if (!adminVerified || !currentAccount) {
    container.innerHTML = '<p>Please connect your wallet and verify admin status.</p>';
    return;
  }

  if (state.loading) {
    container.innerHTML = '<div class="loading">Loading dashboard...</div>';
    return;
  }

  if (state.error) {
    container.innerHTML = `<div class="error">Error: ${state.error}</div>`;
    return;
  }

  let html = '<div class="admin-dashboard">';
  html += renderDepositRecoverySection();
  html += renderDepositFollowUpQueue();
  
  // Foundation balances
  if (state.balances && state.balances.foundation) {
    console.log('[AdminDashboard] Rendering foundation balances:', state.balances.foundation);
    html += '<section class="vault-section">';
    html += '<h2>Foundation Protocol Escrow</h2>';
    html += '<div class="token-list">';
    
    let hasAnyBalance = false;
    state.balances.foundation.forEach((token, index) => {
      const protocolEscrow = BigInt(token.protocolEscrow || '0');
      const userOwned = BigInt(token.userOwned || '0');
      
      // Get on-chain balance if available (match by token address, not index)
      let onChainProtocolEscrow = null;
      let onChainUserOwned = null;
      let hasMismatch = false;
      
      if (state.onChainBalances && state.onChainBalances.foundation) {
        const onChain = state.onChainBalances.foundation.find(t => 
          t.tokenAddress && token.tokenAddress && 
          t.tokenAddress.toLowerCase() === token.tokenAddress.toLowerCase()
        );
        if (onChain) {
          onChainProtocolEscrow = BigInt(onChain.protocolEscrow || '0');
          onChainUserOwned = BigInt(onChain.userOwned || '0');
          hasMismatch = (protocolEscrow !== onChainProtocolEscrow) || (userOwned !== onChainUserOwned);
        }
      }
      
      console.log(`[AdminDashboard] Token ${token.symbol}: protocolEscrow=${protocolEscrow.toString()}, userOwned=${userOwned.toString()}, onChain=${onChainProtocolEscrow !== null ? `${onChainProtocolEscrow.toString()}/${onChainUserOwned.toString()}` : 'N/A'}, hasMismatch=${hasMismatch}`);
      
      // Get real user-owned and protocol-owned values from API
      const realUserOwned = BigInt(token.realUserOwned || '0');
      const protocolOwnedNotSeized = BigInt(token.protocolOwnedNotSeized || '0');
      const totalDeposited = BigInt(token.totalDeposited || '0');
      const totalUserEscrowOnChain = BigInt(token.totalUserEscrowOnChain || '0');
      
      // Show token if it has any balance (protocolEscrow, userOwned, realUserOwned, or protocolOwnedNotSeized) or if there's a mismatch
      if (protocolEscrow > 0n || userOwned > 0n || realUserOwned > 0n || protocolOwnedNotSeized > 0n || hasMismatch || (onChainProtocolEscrow !== null && (onChainProtocolEscrow > 0n || onChainUserOwned > 0n))) {
        hasAnyBalance = true;
        const contractTotalWei = BigInt(token.contractTotalWei || (BigInt(token.userOwned || '0') + BigInt(token.protocolEscrow || '0')));
        const contractUserWei = BigInt(token.contractUserOwnedWei || token.userOwned || '0');
        const contractProtocolWei = BigInt(token.contractProtocolEscrowWei || token.protocolEscrow || '0');
        const ledgerUserClaimWei = BigInt(token.ledgerUserClaimWei || token.realUserOwned || '0');
        const ledgerProtocolClaimWei = BigInt(token.ledgerProtocolClaimWei || token.protocolOwnedNotSeized || '0');
        const pointDebtWei = BigInt(token.pointDebtWei || '0');
        const pendingSeizureWei = BigInt(token.pendingSeizureWei || '0');
        const pointsOutstanding = token.pointsOutstanding || 0;
        const pointsOutstandingUsd = typeof token.pointsOutstandingUsd === 'number'
          ? token.pointsOutstandingUsd
          : Number((pointsOutstanding * USD_PER_POINT).toFixed(2));

        const contractTotalAmount = formatUnits(contractTotalWei.toString(), token.decimals);
        const contractUserAmount = formatUnits(contractUserWei.toString(), token.decimals);
        const contractProtocolAmount = formatUnits(contractProtocolWei.toString(), token.decimals);
        const ledgerUserAmount = formatUnits(ledgerUserClaimWei.toString(), token.decimals);
        const ledgerProtocolAmount = formatUnits(ledgerProtocolClaimWei.toString(), token.decimals);
        const pointDebtAmount = formatUnits(pointDebtWei.toString(), token.decimals);
        const pendingSeizureAmount = formatUnits(pendingSeizureWei.toString(), token.decimals);

        const contractMismatch = pointDebtWei > 0n || pendingSeizureWei > 0n || hasMismatch;
        const tokenHtml = `
          <div class="token-item" style="${contractMismatch ? 'border: 2px solid #ff6b6b;' : ''}">
            <span class="token-symbol">${token.symbol} ${contractMismatch ? '⚠️' : ''}</span>
            <div class="token-amount" style="flex:1; display:flex; flex-direction:column; gap:0.5rem;">
              <div style="padding:0.5rem; background:#1a1a1a; border-radius:4px;">
                <strong>Contract Balances</strong><br>
                Total Locked: ${contractTotalAmount}<br>
                User Owned (on-chain): ${contractUserAmount}<br>
                Protocol Escrow (on-chain): ${contractProtocolAmount}
              </div>
              <div style="padding:0.5rem; background:#1a1a1a; border-radius:4px;">
                <strong>Ledger Claims (Points)</strong><br>
                User Claim: <span style="color:#4caf50;">${ledgerUserAmount}</span><br>
                Protocol Claim (earned but not seized): <span style="color:#ff9800;">${ledgerProtocolAmount}</span>
              </div>
              <div style="padding:0.5rem; background:#1a1a1a; border-radius:4px;">
                <strong>Debt &amp; Signals</strong><br>
                Point-Denominated Debt: ${pointDebtAmount}${pointDebtWei > 0n ? ' ⚠️' : ''}<br>
                Pending Seizure Opportunity: ${pendingSeizureAmount}${pendingSeizureWei > 0n ? ' ⚠️' : ''}<br>
                Points Outstanding: ${pointsOutstanding.toLocaleString()} pts (~$${pointsOutstandingUsd.toFixed(2)})
              </div>
            </div>
            ${protocolOwnedNotSeized > 0n ? `
            <button class="withdraw-btn" data-token="${token.tokenAddress}" data-vault="${FOUNDATION_ADDRESS}" data-amount="${token.protocolOwnedNotSeized}" data-symbol="${token.symbol}" data-decimals="${token.decimals}">
              Withdraw ${formatUnits(token.protocolOwnedNotSeized.toString(), token.decimals)} ${token.symbol}
            </button>
            ` : contractProtocolWei > 0n ? '<span style="color: #888;">No withdrawable amount (all user-owned)</span>' : '<span style="color: #888;">No protocol escrow</span>'}
          </div>
        `;
        html += tokenHtml;
      }
    });
    
    if (!hasAnyBalance && state.balances.foundation.length > 0) {
      html += '<p style="color: #888;">Tokens found but all have zero protocol escrow balances (funds may be in user escrow).</p>';
      // Show them anyway for debugging
      state.balances.foundation.forEach(token => {
        const protocolEscrow = BigInt(token.protocolEscrow || '0');
        const userOwned = BigInt(token.userOwned || '0');
        html += `<p style="color: #666; font-size: 0.9em;">${token.symbol}: protocolEscrow=${protocolEscrow.toString()}, userOwned=${userOwned.toString()}</p>`;
      });
    }
    
    html += '</div></section>';
  }

  // Chartered vaults
  if (state.balances && state.balances.charteredVaults) {
    console.log('[AdminDashboard] Rendering chartered vaults:', state.balances.charteredVaults);
    html += '<section class="vault-section">';
    html += '<h2>Chartered Vaults</h2>';
    
    let hasAnyVault = false;
    state.balances.charteredVaults.forEach((vault, vaultIndex) => {
      console.log(`[AdminDashboard] Vault ${vault.vaultName}: tokens=`, vault.tokens);
      
      // Find matching on-chain vault
      const onChainVault = state.onChainBalances && state.onChainBalances.charteredVaults 
        ? state.onChainBalances.charteredVaults.find(v => v.vaultAddress.toLowerCase() === vault.vaultAddress.toLowerCase())
        : null;
      
      if (vault.tokens && vault.tokens.length > 0) {
        hasAnyVault = true;
        html += `<div class="vault-group">`;
        html += `<h3>${vault.vaultName} (${vault.vaultAddress.slice(0, 10)}...)</h3>`;
        html += '<div class="token-list">';
        
        let hasAnyTokenBalance = false;
        vault.tokens.forEach((token, tokenIndex) => {
          const userOwned = BigInt(token.userOwned || '0');
          const escrow = BigInt(token.escrow || '0');
          
          // Get on-chain balance if available
          let onChainUserOwned = null;
          let onChainEscrow = null;
          let hasMismatch = false;
          
          if (onChainVault && onChainVault.tokens) {
            const onChainToken = onChainVault.tokens.find(t => 
              t.tokenAddress.toLowerCase() === token.tokenAddress.toLowerCase()
            );
            if (onChainToken) {
              onChainUserOwned = BigInt(onChainToken.userOwned || '0');
              onChainEscrow = BigInt(onChainToken.escrow || '0');
              hasMismatch = (userOwned !== onChainUserOwned) || (escrow !== onChainEscrow);
            }
          }
          
          console.log(`[AdminDashboard] Vault token ${token.symbol}: userOwned=${userOwned.toString()}, onChain=${onChainUserOwned !== null ? onChainUserOwned.toString() : 'N/A'}`);
          
          // Show token if it has any balance or if there's a mismatch
          if (userOwned > 0n || escrow > 0n || hasMismatch || (onChainUserOwned !== null && (onChainUserOwned > 0n || onChainEscrow > 0n))) {
            hasAnyTokenBalance = true;
            const amount = formatUnits(userOwned.toString(), token.decimals);
            const escrowAmount = formatUnits(escrow.toString(), token.decimals);
            
            let onChainDisplay = '';
            if (onChainUserOwned !== null) {
              const onChainAmount = formatUnits(onChainUserOwned.toString(), token.decimals);
              const onChainEscrowAmount = formatUnits(onChainEscrow.toString(), token.decimals);
              const mismatchStyle = hasMismatch ? 'background: #ff6b6b20; border-left: 3px solid #ff6b6b; padding-left: 0.5rem;' : '';
              onChainDisplay = `
                <div style="${mismatchStyle} margin-top: 0.5rem; font-size: 0.9em; color: #888;">
                  <strong>On-Chain:</strong><br>
                  User Owned: ${onChainAmount} ${hasMismatch && userOwned !== onChainUserOwned ? '⚠️' : ''}<br>
                  Escrow: ${onChainEscrowAmount} ${hasMismatch && escrow !== onChainEscrow ? '⚠️' : ''}
                </div>
              `;
            }
            
            html += `
              <div class="token-item" style="${hasMismatch ? 'border: 2px solid #ff6b6b;' : ''}">
                <span class="token-symbol">${token.symbol} ${hasMismatch ? '⚠️ MISMATCH' : ''}</span>
                <span class="token-amount">
                  <strong>Database:</strong><br>
                  User Owned: ${amount}<br>
                  Escrow: ${escrowAmount}
                  ${onChainDisplay}
                </span>
                ${userOwned > 0n ? `
                <button class="withdraw-btn" data-token="${token.tokenAddress}" data-vault="${vault.vaultAddress}" data-amount="${token.userOwned}" data-symbol="${token.symbol}" data-decimals="${token.decimals}">
                  Withdraw ${formatUnits(token.userOwned.toString(), token.decimals)} ${token.symbol}
                </button>
                ` : '<span style="color: #888;">No balance</span>'}
              </div>
            `;
          }
        });
        
        if (!hasAnyTokenBalance) {
          html += '<p style="color: #888;">No user-owned balances in this vault.</p>';
        }
        
        html += '</div></div>';
      }
    });
    
    if (!hasAnyVault) {
      html += '<p style="color: #888;">No active chartered vaults with balances.</p>';
    }
    
    html += '</section>';
  }

  // Accounts table
  if (state.accounts && state.accounts.length > 0) {
    html += '<section class="vault-section">';
    html += '<h2>All Accounts & Balances</h2>';
    html += `<p style="color: #888; margin-bottom: 1rem;">Total accounts: ${state.accounts.length}</p>`;
    html += '<div style="overflow-x: auto;">';
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
    html += '<thead>';
    html += '<tr style="background: #1a1a1a; border-bottom: 2px solid #444;">';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Address</th>';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Token</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Total Deposited</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Points Credited</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Points Remaining</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Real User Owned</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">On-Chain Escrow</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Protocol Owned</th>';
    html += '<th style="padding: 0.75rem; text-align: center; color: #90caf9;">Deposits</th>';
    html += '<th style="padding: 0.75rem; text-align: center; color: #90caf9;">Actions</th>';
    html += '</tr>';
    html += '</thead>';
    html += '<tbody>';
    
    state.accounts.forEach((account, index) => {
      const totalDeposited = formatUnits(account.totalDeposited, account.decimals);
      const pointsCredited = parseInt(account.totalPointsCredited).toLocaleString();
      const pointsRemaining = parseInt(account.totalPointsRemaining).toLocaleString();
      const realUserOwned = formatUnits(account.realUserOwned, account.decimals);
      const onChainEscrow = formatUnits(account.onChainEscrow, account.decimals);
      const protocolOwned = formatUnits(account.protocolOwnedNotSeized, account.decimals);
      
      // Debug log for first account
      if (index === 0) {
        console.log('[AdminDashboard] Account data sample:', {
          totalDeposited: account.totalDeposited,
          realUserOwned: account.realUserOwned,
          protocolOwnedNotSeized: account.protocolOwnedNotSeized,
          formatted: { totalDeposited, realUserOwned, protocolOwned }
        });
      }
      
      const rowStyle = index % 2 === 0 ? 'background: #2a2f3a;' : 'background: #23272f;';
      const addressShort = `${account.depositorAddress.slice(0, 6)}...${account.depositorAddress.slice(-4)}`;
      
      html += `<tr style="${rowStyle}">`;
      html += `<td style="padding: 0.75rem; font-family: monospace; color: #c0c0c0;" title="${account.depositorAddress}">${addressShort}</td>`;
      html += `<td style="padding: 0.75rem; color: #e0e0e0;">${account.symbol}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #e0e0e0;">${totalDeposited}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #e0e0e0;">${pointsCredited}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #4caf50;">${pointsRemaining}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #4caf50; font-weight: bold;">${realUserOwned}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #e0e0e0;">${onChainEscrow}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #ff9800;">${protocolOwned}</td>`;
      html += `<td style="padding: 0.75rem; text-align: center; color: #e0e0e0;">${account.depositCount}</td>`;
      html += '<td style="padding: 0.75rem; text-align: center;">';
      if (account.masterAccountId) {
        html += `<button class="adjust-points-btn" data-master-account-id="${account.masterAccountId}" data-address="${account.depositorAddress}" style="padding: 0.4rem 0.75rem; background: #4caf50; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-size: 0.85em;">Add Points</button>`;
      } else {
        html += '<span style="color: #666; font-size: 0.85em;">No account</span>';
      }
      html += '</td>';
      html += '</tr>';
    });
    
    html += '</tbody>';
    html += '</table>';
    html += '</div>';
    html += '</section>';
  }

  // Free Points Dashboard
  if (state.freePoints && state.freePoints.summary) {
    const summary = state.freePoints.summary;
    html += '<section class="vault-section">';
    html += '<h2>Free Points in Circulation</h2>';
    
    // Summary
    html += '<div style="margin-bottom: 1.5rem; padding: 1rem; background: #1a1a1a; border-radius: 4px;">';
    html += '<h3 style="margin-top: 0; color: #90caf9;">Summary</h3>';
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">';
    html += `<div><strong>Total Points Credited:</strong><br><span style="color: #4caf50; font-size: 1.2em;">${parseInt(summary.totalPointsCredited).toLocaleString()}</span><br><span style="color: #888; font-size: 0.9em;">$${parseFloat(summary.usdValueCredited).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>`;
    html += `<div><strong>Points Remaining:</strong><br><span style="color: #4caf50; font-size: 1.2em;">${parseInt(summary.totalPointsRemaining).toLocaleString()}</span><br><span style="color: #888; font-size: 0.9em;">$${parseFloat(summary.usdValueRemaining).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>`;
    html += `<div><strong>Points Spent:</strong><br><span style="color: #ff9800; font-size: 1.2em;">${parseInt(summary.totalPointsSpent).toLocaleString()}</span><br><span style="color: #888; font-size: 0.9em;">$${parseFloat(summary.usdValueSpent).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>`;
    html += `<div><strong>Total Entries:</strong><br><span style="color: #e0e0e0; font-size: 1.2em;">${summary.totalEntries}</span></div>`;
    html += `<div><strong>Reward Types:</strong><br><span style="color: #e0e0e0; font-size: 1.2em;">${summary.totalRewardTypes}</span></div>`;
    html += '</div>';
    html += '</div>';

    // By reward type
    if (state.freePoints.rewardTypes && state.freePoints.rewardTypes.length > 0) {
      html += '<h3 style="color: #90caf9;">By Reward Type</h3>';
      html += '<div style="overflow-x: auto;">';
      html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
      html += '<thead>';
      html += '<tr style="background: #1a1a1a; border-bottom: 2px solid #444;">';
      html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Reward Type</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Points Credited</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">USD Value</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Points Remaining</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">USD Value</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Points Spent</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">USD Value</th>';
      html += '<th style="padding: 0.75rem; text-align: center; color: #90caf9;">Users</th>';
      html += '<th style="padding: 0.75rem; text-align: center; color: #90caf9;">Entries</th>';
      html += '</tr>';
      html += '</thead>';
      html += '<tbody>';
      
      state.freePoints.rewardTypes.forEach((typeData, index) => {
        const rowStyle = index % 2 === 0 ? 'background: #2a2f3a;' : 'background: #23272f;';
        const pointsCredited = parseInt(typeData.totalPointsCredited).toLocaleString();
        const pointsRemaining = parseInt(typeData.totalPointsRemaining).toLocaleString();
        const pointsSpent = parseInt(typeData.totalPointsSpent).toLocaleString();
        
        html += `<tr style="${rowStyle}">`;
        html += `<td style="padding: 0.75rem; color: #e0e0e0;">${typeData.rewardType}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #e0e0e0;">${pointsCredited}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #888; font-size: 0.85em;">$${parseFloat(typeData.usdValueCredited).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #4caf50;">${pointsRemaining}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #888; font-size: 0.85em;">$${parseFloat(typeData.usdValueRemaining).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #ff9800;">${pointsSpent}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #888; font-size: 0.85em;">$${parseFloat(typeData.usdValueSpent).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>`;
        html += `<td style="padding: 0.75rem; text-align: center; color: #e0e0e0;">${typeData.userCount}</td>`;
        html += `<td style="padding: 0.75rem; text-align: center; color: #e0e0e0;">${typeData.entryCount}</td>`;
        html += '</tr>';
      });
      
      html += '</tbody>';
      html += '</table>';
      html += '</div>';
    }
    
    html += '</section>';
  }

  // Withdrawal requests
  if (state.withdrawalRequests && state.withdrawalRequests.length > 0) {
    html += '<section class="vault-section">';
    html += '<h2>Pending Withdrawal Requests</h2>';
    html += '<div style="overflow-x: auto;">';
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
    html += '<thead>';
    html += '<tr style="background: #1a1a1a; border-bottom: 2px solid #444;">';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Transaction Hash</th>';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Token</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Amount</th>';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">User Address</th>';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Status</th>';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Created</th>';
    html += '</tr>';
    html += '</thead>';
    html += '<tbody>';
    
    state.withdrawalRequests.forEach((req, index) => {
      const rowStyle = index % 2 === 0 ? 'background: #2a2f3a;' : 'background: #23272f;';
      const txHash = req.request_tx_hash || 'N/A';
      const txHashShort = txHash !== 'N/A' ? `${txHash.slice(0, 10)}...${txHash.slice(-8)}` : 'N/A';
      const etherscanUrl = txHash !== 'N/A' ? `https://etherscan.io/tx/${txHash}` : '#';
      const userAddressShort = req.user_address ? `${req.user_address.slice(0, 6)}...${req.user_address.slice(-4)}` : 'N/A';
      const statusColor = req.status === 'PENDING_PROCESSING' ? '#ff9800' : req.status === 'COMPLETED' ? '#4caf50' : req.status === 'FAILED' ? '#d32f2f' : '#e0e0e0';
      
      html += `<tr style="${rowStyle}">`;
      html += `<td style="padding: 0.75rem; font-family: monospace; color: #c0c0c0;">`;
      if (txHash !== 'N/A') {
        html += `<a href="${etherscanUrl}" target="_blank" style="color: #90caf9; text-decoration: none;">${txHashShort}</a>`;
      } else {
        html += txHashShort;
      }
      html += `</td>`;
      html += `<td style="padding: 0.75rem; color: #e0e0e0; font-family: monospace; font-size: 0.85em;">${req.token_address ? `${req.token_address.slice(0, 6)}...${req.token_address.slice(-4)}` : 'N/A'}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #e0e0e0;">${formatUnits(req.collateral_amount_wei || '0', 18)}</td>`;
      html += `<td style="padding: 0.75rem; font-family: monospace; color: #c0c0c0;" title="${req.user_address || 'N/A'}">${userAddressShort}</td>`;
      html += `<td style="padding: 0.75rem; color: ${statusColor}; font-weight: bold;">${req.status || 'UNKNOWN'}</td>`;
      html += `<td style="padding: 0.75rem; color: #e0e0e0;">${req.createdAt ? new Date(req.createdAt).toLocaleString() : 'N/A'}</td>`;
      html += '</tr>';
    });
    
    html += '</tbody>';
    html += '</table>';
    html += '</div>';
    html += '</section>';
  }

  // Analytics & Charts Section
  html += '<section class="vault-section">';
  html += '<h2>Usage Analytics</h2>';
  
  // Date range selector
  html += '<div style="margin-bottom: 1.5rem; padding: 1rem; background: #1a1a1a; border-radius: 4px;">';
  html += '<div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">';
  html += '<label style="color: #e0e0e0;">Period:</label>';
  html += '<select id="analytics-period" style="padding: 0.5rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;">';
  html += `<option value="daily" ${state.dateRange.period === 'daily' ? 'selected' : ''}>Daily</option>`;
  html += `<option value="weekly" ${state.dateRange.period === 'weekly' ? 'selected' : ''}>Weekly</option>`;
  html += `<option value="monthly" ${state.dateRange.period === 'monthly' ? 'selected' : ''}>Monthly</option>`;
  html += '</select>';
  html += '<label style="color: #e0e0e0;">Start Date:</label>';
  html += `<input type="date" id="analytics-start-date" value="${state.dateRange.startDate.toISOString().split('T')[0]}" style="padding: 0.5rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;">`;
  html += '<label style="color: #e0e0e0;">End Date:</label>';
  html += `<input type="date" id="analytics-end-date" value="${state.dateRange.endDate.toISOString().split('T')[0]}" style="padding: 0.5rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;">`;
  html += '<button id="refresh-analytics" style="padding: 0.5rem 1rem; background: #3f51b5; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Refresh</button>';
  html += '</div>';
  html += '</div>';

  if (state.analytics) {
    // Summary totals
    if (state.analytics.totals) {
      html += '<div style="margin-bottom: 2rem; padding: 1rem; background: #1a1a1a; border-radius: 4px;">';
      html += '<h3 style="color: #90caf9; margin-top: 0;">Summary</h3>';
      html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">';
      html += `<div><strong style="color: #90caf9;">Total Points Spent:</strong><br><span style="color: #4caf50; font-size: 1.2em;">${parseInt(state.analytics.totals.totalPointsSpent || '0').toLocaleString()}</span></div>`;
      html += `<div><strong style="color: #90caf9;">Total Cost (USD):</strong><br><span style="color: #ff9800; font-size: 1.2em;">$${parseFloat(state.analytics.totals.totalCostUsd || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>`;
      html += `<div><strong style="color: #90caf9;">Total Generations:</strong><br><span style="color: #e0e0e0; font-size: 1.2em;">${parseInt(state.analytics.totals.totalGenerations || '0').toLocaleString()}</span></div>`;
      html += '</div>';
      html += '</div>';
    }

    // Service Breakdown
    if (state.analytics.serviceBreakdown && state.analytics.serviceBreakdown.length > 0) {
      html += '<div style="margin-bottom: 2rem;">';
      html += '<h3 style="color: #90caf9;">Point Usage by Service</h3>';
      html += '<div style="overflow-x: auto;">';
      html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
      html += '<thead>';
      html += '<tr style="background: #1a1a1a; border-bottom: 2px solid #444;">';
      html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Service</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Points Spent</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Cost (USD)</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Generations</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Avg Points/Gen</th>';
      html += '</tr>';
      html += '</thead>';
      html += '<tbody>';
      
      state.analytics.serviceBreakdown.forEach((service, index) => {
        const rowStyle = index % 2 === 0 ? 'background: #2a2f3a;' : 'background: #23272f;';
        const pointsSpent = parseInt(service.totalPointsSpent || '0');
        const costUsd = parseFloat(service.costUsd || '0');
        const genCount = parseInt(service.generationCount || '0');
        const avgPoints = genCount > 0 ? (pointsSpent / genCount).toFixed(2) : '0';
        const percentage = state.analytics.totals && parseInt(state.analytics.totals.totalPointsSpent) > 0
          ? ((pointsSpent / parseInt(state.analytics.totals.totalPointsSpent)) * 100).toFixed(1)
          : '0';
        
        html += `<tr style="${rowStyle}">`;
        html += `<td style="padding: 0.75rem; color: #e0e0e0; font-weight: bold;">${service.serviceName}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #4caf50;">${pointsSpent.toLocaleString()}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #ff9800;">$${costUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #e0e0e0;">${genCount.toLocaleString()}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #888;">${avgPoints} <span style="color: #666; font-size: 0.85em;">(${percentage}%)</span></td>`;
        html += '</tr>';
      });
      
      html += '</tbody>';
      html += '</table>';
      html += '</div>';
      html += '</div>';
    }

    // ComfyUI GPU Breakdown
    if (state.analytics.comfyuiGpuBreakdown && state.analytics.comfyuiGpuBreakdown.length > 0) {
      html += '<div style="margin-bottom: 2rem;">';
      html += '<h3 style="color: #90caf9;">ComfyUI Point Usage by GPU Type</h3>';
      html += '<div style="overflow-x: auto;">';
      html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
      html += '<thead>';
      html += '<tr style="background: #1a1a1a; border-bottom: 2px solid #444;">';
      html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">GPU Type</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Points Spent</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Cost (USD)</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Generations</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Avg Points/Gen</th>';
      html += '</tr>';
      html += '</thead>';
      html += '<tbody>';
      
      // Calculate total comfyui points for percentage
      const totalComfyuiPoints = state.analytics.comfyuiGpuBreakdown.reduce((sum, gpu) => 
        sum + parseInt(gpu.totalPointsSpent || '0'), 0);
      
      state.analytics.comfyuiGpuBreakdown.forEach((gpu, index) => {
        const rowStyle = index % 2 === 0 ? 'background: #2a2f3a;' : 'background: #23272f;';
        const pointsSpent = parseInt(gpu.totalPointsSpent || '0');
        const costUsd = parseFloat(gpu.costUsd || '0');
        const genCount = parseInt(gpu.generationCount || '0');
        const avgPoints = genCount > 0 ? (pointsSpent / genCount).toFixed(2) : '0';
        const percentage = totalComfyuiPoints > 0
          ? ((pointsSpent / totalComfyuiPoints) * 100).toFixed(1)
          : '0';
        
        html += `<tr style="${rowStyle}">`;
        html += `<td style="padding: 0.75rem; color: #e0e0e0; font-weight: bold;">${gpu.gpuType}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #4caf50;">${pointsSpent.toLocaleString()}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #ff9800;">$${costUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #e0e0e0;">${genCount.toLocaleString()}</td>`;
        html += `<td style="padding: 0.75rem; text-align: right; color: #888;">${avgPoints} <span style="color: #666; font-size: 0.85em;">(${percentage}%)</span></td>`;
        html += '</tr>';
      });
      
      html += '</tbody>';
      html += '</table>';
      html += '</div>';
      html += '</div>';
    }

    // Point Usage Chart
    html += '<div style="margin-bottom: 2rem;">';
    html += '<h3 style="color: #90caf9;">Point Usage Over Time</h3>';
    html += '<div style="position: relative; height: 300px; background: #1a1a1a; padding: 1rem; border-radius: 4px;">';
    html += '<canvas id="point-usage-chart"></canvas>';
    html += '</div>';
    html += '<button onclick="exportChartData(\'pointUsage\')" style="margin-top: 0.5rem; padding: 0.5rem 1rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px; cursor: pointer;">Export CSV</button>';
    html += '</div>';

    // Deposits Chart
    html += '<div style="margin-bottom: 2rem;">';
    html += '<h3 style="color: #90caf9;">Deposits Over Time</h3>';
    html += '<div style="position: relative; height: 300px; background: #1a1a1a; padding: 1rem; border-radius: 4px;">';
    html += '<canvas id="deposits-chart"></canvas>';
    html += '</div>';
    html += '<button onclick="exportChartData(\'deposits\')" style="margin-top: 0.5rem; padding: 0.5rem 1rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px; cursor: pointer;">Export CSV</button>';
    html += '</div>';

    // Active Users Chart
    html += '<div style="margin-bottom: 2rem;">';
    html += '<h3 style="color: #90caf9;">Active Users Over Time</h3>';
    html += '<div style="position: relative; height: 300px; background: #1a1a1a; padding: 1rem; border-radius: 4px;">';
    html += '<canvas id="active-users-chart"></canvas>';
    html += '</div>';
    html += '<button onclick="exportChartData(\'activeUsers\')" style="margin-top: 0.5rem; padding: 0.5rem 1rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px; cursor: pointer;">Export CSV</button>';
    html += '</div>';
  } else {
    html += '<p style="color: #888;">Loading analytics data...</p>';
  }

  // Tool/Command Usage Rankings
  html += '<section class="vault-section">';
  html += '<h2>Tool & Command Usage Rankings</h2>';
  
  if (state.rankings && state.rankings.rankings) {
    // Controls
    html += '<div style="margin-bottom: 1.5rem; padding: 1rem; background: #1a1a1a; border-radius: 4px;">';
    html += '<div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">';
    html += '<label style="color: #e0e0e0;">Sort By:</label>';
    html += `<select id="rankings-sort-by" style="padding: 0.5rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;">`;
    html += `<option value="usage" ${state.rankingsSortBy === 'usage' ? 'selected' : ''}>Usage Count</option>`;
    html += `<option value="points" ${state.rankingsSortBy === 'points' ? 'selected' : ''}>Points Spent</option>`;
    html += `<option value="users" ${state.rankingsSortBy === 'users' ? 'selected' : ''}>Unique Users</option>`;
    html += `<option value="cost" ${state.rankingsSortBy === 'cost' ? 'selected' : ''}>Cost (USD)</option>`;
    html += '</select>';
    html += '<label style="color: #e0e0e0;">Service Filter:</label>';
    html += '<select id="rankings-service-filter" style="padding: 0.5rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;">';
    html += '<option value="">All Services</option>';
    const uniqueServices = [...new Set(state.rankings.rankings.map(r => r.serviceName))];
    uniqueServices.forEach(service => {
      html += `<option value="${service}">${service}</option>`;
    });
    html += '</select>';
    html += '<button id="refresh-rankings" style="padding: 0.5rem 1rem; background: #3f51b5; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Refresh</button>';
    html += '</div>';
    html += '</div>';

    // Rankings Table
    html += '<div style="overflow-x: auto;">';
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
    html += '<thead>';
    html += '<tr style="background: #1a1a1a; border-bottom: 2px solid #444;">';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Rank</th>';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Tool</th>';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Service</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Usage</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Points Spent</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Cost (USD)</th>';
      html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Unique Users</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Avg Points/Use</th>';
    html += '</tr>';
    html += '</thead>';
    html += '<tbody>';
    
    state.rankings.rankings.forEach((tool, index) => {
      const rowStyle = index % 2 === 0 ? 'background: #2a2f3a;' : 'background: #23272f;';
      const rank = index + 1;
      const usageCount = parseInt(tool.usageCount || '0');
      const pointsSpent = parseInt(tool.totalPointsSpent || '0');
      const revenue = parseFloat(tool.totalCostUsd || '0');
      const uniqueUsers = parseInt(tool.uniqueUsers || '0');
      const avgPoints = parseFloat(tool.avgPointsPerUse || '0');
      
      html += `<tr style="${rowStyle}">`;
      html += `<td style="padding: 0.75rem; color: #888; font-weight: bold;">#${rank}</td>`;
      html += `<td style="padding: 0.75rem; color: #e0e0e0; font-weight: bold;">${tool.toolDisplayName || tool.toolId}</td>`;
      html += `<td style="padding: 0.75rem; color: #888; font-size: 0.85em;">${tool.serviceName}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #4caf50;">${usageCount.toLocaleString()} <span style="color: #666; font-size: 0.85em;">(${tool.usagePercentage}%)</span></td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #4caf50;">${pointsSpent.toLocaleString()} <span style="color: #666; font-size: 0.85em;">(${tool.pointsPercentage}%)</span></td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #ff9800;">$${revenue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} <span style="color: #666; font-size: 0.85em;">(${tool.costPercentage || '0'}%)</span></td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #e0e0e0;">${uniqueUsers.toLocaleString()} <span style="color: #666; font-size: 0.85em;">(${tool.usersPercentage}%)</span></td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #888;">${avgPoints.toFixed(2)}</td>`;
      html += '</tr>';
    });
    
    html += '</tbody>';
    html += '</table>';
    html += '</div>';

    // Summary
    if (state.rankings.totals) {
      html += '<div style="margin-top: 1rem; padding: 1rem; background: #1a1a1a; border-radius: 4px; font-size: 0.9em;">';
      html += '<strong style="color: #90caf9;">Summary:</strong> ';
      html += `<span style="color: #e0e0e0;">Total Usage: ${state.rankings.totals.totalUsage.toLocaleString()}</span> | `;
      html += `<span style="color: #4caf50;">Total Points: ${parseInt(state.rankings.totals.totalPoints).toLocaleString()}</span> | `;
      html += `<span style="color: #ff9800;">Total Revenue: $${parseFloat(state.rankings.totals.totalRevenue).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span> | `;
      html += `<span style="color: #e0e0e0;">Unique Users: ${state.rankings.totals.totalUsers.toLocaleString()}</span>`;
      html += '</div>';
    }
  } else {
    html += '<p style="color: #888;">Loading rankings data...</p>';
  }
  
  html += '</section>';

  // Most Active Users Dashboard
  html += '<section class="vault-section">';
  html += '<h2>Most Active Users</h2>';
  
  if (state.activeUsers && state.activeUsers.users) {
    // Controls
    html += '<div style="margin-bottom: 1.5rem; padding: 1rem; background: #1a1a1a; border-radius: 4px;">';
    html += '<div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">';
    html += '<label style="color: #e0e0e0;">Sort By:</label>';
    html += `<select id="active-users-sort-by" style="padding: 0.5rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;">`;
    html += `<option value="points" ${state.activeUsersSortBy === 'points' ? 'selected' : ''}>Points Spent</option>`;
    html += `<option value="generations" ${state.activeUsersSortBy === 'generations' ? 'selected' : ''}>Generations</option>`;
    html += `<option value="deposits" ${state.activeUsersSortBy === 'deposits' ? 'selected' : ''}>Deposits</option>`;
    html += `<option value="tenure" ${state.activeUsersSortBy === 'tenure' ? 'selected' : ''}>Account Age</option>`;
    html += '</select>';
    html += '<button id="refresh-active-users" style="padding: 0.5rem 1rem; background: #3f51b5; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Refresh</button>';
    html += '</div>';
    html += '</div>';

    // Users Table
    html += '<div style="overflow-x: auto;">';
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
    html += '<thead>';
    html += '<tr style="background: #1a1a1a; border-bottom: 2px solid #444;">';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Rank</th>';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">User ID</th>';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Wallet</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Points Spent</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Generations</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Deposits</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Total Deposited</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Account Age</th>';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Top Tools</th>';
    html += '</tr>';
    html += '</thead>';
    html += '<tbody>';
    
    state.activeUsers.users.forEach((user, index) => {
      const rowStyle = index % 2 === 0 ? 'background: #2a2f3a;' : 'background: #23272f;';
      const rank = index + 1;
      const pointsSpent = parseInt(user.pointsSpent || '0');
      const generationsCount = parseInt(user.generationsCount || '0');
      const depositsCount = parseInt(user.depositsCount || '0');
      const totalDeposited = parseFloat(user.totalDeposited || '0');
      const accountAge = user.accountAgeDays !== null ? `${user.accountAgeDays} days` : 'N/A';
      const walletShort = user.walletAddress ? `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}` : 'N/A';
      const topTools = user.favoriteTools && user.favoriteTools.length > 0
        ? user.favoriteTools.map(t => t.tool).join(', ')
        : 'N/A';
      
      html += `<tr style="${rowStyle}">`;
      html += `<td style="padding: 0.75rem; color: #888; font-weight: bold;">#${rank}</td>`;
      html += `<td style="padding: 0.75rem; color: #e0e0e0; font-family: monospace; font-size: 0.85em;">${user.masterAccountId.slice(0, 8)}...</td>`;
      html += `<td style="padding: 0.75rem; color: #888; font-family: monospace; font-size: 0.85em;">${walletShort}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #4caf50;">${pointsSpent.toLocaleString()}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #e0e0e0;">${generationsCount.toLocaleString()}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #e0e0e0;">${depositsCount.toLocaleString()}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #4caf50;">${totalDeposited.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #888;">${accountAge}</td>`;
      html += `<td style="padding: 0.75rem; color: #888; font-size: 0.85em;">${topTools}</td>`;
      html += '</tr>';
    });
    
    html += '</tbody>';
    html += '</table>';
    html += '</div>';

    // Summary
    if (state.activeUsers.totals) {
      html += '<div style="margin-top: 1rem; padding: 1rem; background: #1a1a1a; border-radius: 4px; font-size: 0.9em;">';
      html += '<strong style="color: #90caf9;">Summary:</strong> ';
      html += `<span style="color: #e0e0e0;">Total Active Users: ${state.activeUsers.totals.totalUsers.toLocaleString()}</span> | `;
      html += `<span style="color: #4caf50;">Total Points Spent: ${state.activeUsers.totals.totalPointsSpent.toLocaleString()}</span> | `;
      html += `<span style="color: #e0e0e0;">Total Generations: ${state.activeUsers.totals.totalGenerations.toLocaleString()}</span> | `;
      html += `<span style="color: #4caf50;">Total Deposits: ${state.activeUsers.totals.totalDeposits.toLocaleString()}</span>`;
      html += '</div>';
    }
  } else {
    html += '<p style="color: #888;">Loading active users data...</p>';
  }
  
  html += '</section>';

  if (state.withdrawalAnalytics && state.withdrawalAnalytics.withdrawals) {
    html += '<div style="margin-bottom: 2rem;">';
    html += '<h3 style="color: #90caf9;">Withdrawals Over Time</h3>';
    html += '<div style="position: relative; height: 300px; background: #1a1a1a; padding: 1rem; border-radius: 4px;">';
    html += '<canvas id="withdrawals-chart"></canvas>';
    html += '</div>';
    html += '<button onclick="exportChartData(\'withdrawals\')" style="margin-top: 0.5rem; padding: 0.5rem 1rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px; cursor: pointer;">Export CSV</button>';
    html += '</div>';
  }

  html += '</section>';

  // Business Accounting Dashboard
  html += '<section class="vault-section">';
  html += '<h2>Business Accounting</h2>';
  
  if (state.accounting) {
    // Period selector
    html += '<div style="margin-bottom: 1.5rem; padding: 1rem; background: #1a1a1a; border-radius: 4px;">';
    html += '<div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">';
    html += '<label style="color: #e0e0e0;">Period:</label>';
    html += `<select id="accounting-period" style="padding: 0.5rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;">`;
    html += `<option value="all" ${state.accountingPeriod === 'all' ? 'selected' : ''}>All Time</option>`;
    html += `<option value="ytd" ${state.accountingPeriod === 'ytd' ? 'selected' : ''}>Year to Date</option>`;
    html += `<option value="mtd" ${state.accountingPeriod === 'mtd' ? 'selected' : ''}>Month to Date</option>`;
    html += `<option value="custom" ${state.accountingPeriod === 'custom' ? 'selected' : ''}>Custom Range</option>`;
    html += '</select>';
    html += '<button id="refresh-accounting" style="padding: 0.5rem 1rem; background: #3f51b5; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Refresh</button>';
    html += '</div>';
    html += '</div>';

    // Key Metrics Cards
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">';
    
    // Revenue Card
    html += '<div style="padding: 1.5rem; background: #1a1a1a; border-radius: 4px; border-left: 4px solid #4caf50;">';
    html += '<h3 style="color: #90caf9; margin-top: 0; font-size: 0.9em;">Total Revenue</h3>';
    html += `<div style="font-size: 1.8em; font-weight: bold; color: #4caf50;">$${parseFloat(state.accounting.revenue.totalDeposits || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>`;
    html += `<div style="font-size: 0.85em; color: #888; margin-top: 0.5rem;">Net: $${parseFloat(state.accounting.revenue.netRevenue || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>`;
    html += '</div>';

    // Expenses Card
    html += '<div style="padding: 1.5rem; background: #1a1a1a; border-radius: 4px; border-left: 4px solid #ff9800;">';
    html += '<h3 style="color: #90caf9; margin-top: 0; font-size: 0.9em;">Total Expenses</h3>';
    html += `<div style="font-size: 1.8em; font-weight: bold; color: #ff9800;">$${parseFloat(state.accounting.expenses.totalExpenses || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>`;
    html += `<div style="font-size: 0.85em; color: #888; margin-top: 0.5rem;">Logged: $${parseFloat(state.accounting.expenses.loggedCosts || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>`;
    html += `<div style="font-size: 0.85em; color: #888;">Infrastructure: $${parseFloat(state.accounting.expenses.infrastructureCosts || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>`;
    html += '</div>';

    // Profit Card
    const profitValue = parseFloat(state.accounting.profitLoss.grossProfit || '0');
    const profitColor = profitValue >= 0 ? '#4caf50' : '#d32f2f';
    html += '<div style="padding: 1.5rem; background: #1a1a1a; border-radius: 4px; border-left: 4px solid ' + profitColor + ';">';
    html += '<h3 style="color: #90caf9; margin-top: 0; font-size: 0.9em;">Gross Profit</h3>';
    html += `<div style="font-size: 1.8em; font-weight: bold; color: ${profitColor};">$${profitValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>`;
    html += `<div style="font-size: 0.85em; color: #888; margin-top: 0.5rem;">Margin: ${parseFloat(state.accounting.profitLoss.operatingMargin || '0').toFixed(1)}%</div>`;
    html += '</div>';

    // Protocol Funds Card
    html += '<div style="padding: 1.5rem; background: #1a1a1a; border-radius: 4px; border-left: 4px solid #90caf9;">';
    html += '<h3 style="color: #90caf9; margin-top: 0; font-size: 0.9em;">Protocol Owned</h3>';
    html += `<div style="font-size: 1.8em; font-weight: bold; color: #90caf9;">$${parseFloat(state.accounting.revenue.protocolOwnedNotSeized || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>`;
    html += '<div style="font-size: 0.85em; color: #888; margin-top: 0.5rem;">Not seized funds</div>';
    html += '</div>';

    html += '</div>';

    // Detailed Breakdown
    html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem;">';
    
    // Revenue Breakdown
    html += '<div style="padding: 1rem; background: #1a1a1a; border-radius: 4px;">';
    html += '<h3 style="color: #90caf9; margin-top: 0;">Revenue Breakdown</h3>';
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
    html += '<tr><td style="padding: 0.5rem; color: #e0e0e0;">Total Deposits:</td><td style="padding: 0.5rem; text-align: right; color: #4caf50;">$' + parseFloat(state.accounting.revenue.totalDeposits || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</td></tr>';
    html += '<tr><td style="padding: 0.5rem; color: #e0e0e0;">Total Withdrawn:</td><td style="padding: 0.5rem; text-align: right; color: #ff9800;">$' + parseFloat(state.accounting.revenue.totalWithdrawn || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</td></tr>';
    html += '<tr style="border-top: 1px solid #444;"><td style="padding: 0.5rem; color: #e0e0e0; font-weight: bold;">Net Revenue:</td><td style="padding: 0.5rem; text-align: right; color: #4caf50; font-weight: bold;">$' + parseFloat(state.accounting.revenue.netRevenue || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</td></tr>';
    html += '<tr><td style="padding: 0.5rem; color: #888; font-size: 0.85em;">Unique Depositors:</td><td style="padding: 0.5rem; text-align: right; color: #888; font-size: 0.85em;">' + (state.accounting.revenue.uniqueDepositors || 0) + '</td></tr>';
    html += '<tr><td style="padding: 0.5rem; color: #888; font-size: 0.85em;">Avg Revenue/User:</td><td style="padding: 0.5rem; text-align: right; color: #888; font-size: 0.85em;">$' + parseFloat(state.accounting.revenue.averageRevenuePerUser || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</td></tr>';
    html += '</table>';
    html += '</div>';

    // Expense Breakdown
    html += '<div style="padding: 1rem; background: #1a1a1a; border-radius: 4px;">';
    html += '<h3 style="color: #90caf9; margin-top: 0;">Expense Breakdown</h3>';
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
    html += '<tr><td style="padding: 0.5rem; color: #e0e0e0;">Logged Costs:</td><td style="padding: 0.5rem; text-align: right; color: #ff9800;">$' + parseFloat(state.accounting.expenses.loggedCosts || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</td></tr>';
    html += '<tr><td style="padding: 0.5rem; color: #e0e0e0;">Infrastructure:</td><td style="padding: 0.5rem; text-align: right; color: #ff9800;">$' + parseFloat(state.accounting.expenses.infrastructureCosts || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</td></tr>';
    html += '<tr style="border-top: 1px solid #444;"><td style="padding: 0.5rem; color: #e0e0e0; font-weight: bold;">Total Expenses:</td><td style="padding: 0.5rem; text-align: right; color: #ff9800; font-weight: bold;">$' + parseFloat(state.accounting.expenses.totalExpenses || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</td></tr>';
    
    // Cost breakdown by category
    if (state.accounting.expenses.costBreakdown && Object.keys(state.accounting.expenses.costBreakdown).length > 0) {
      html += '<tr><td colspan="2" style="padding: 0.5rem 0; color: #888; font-size: 0.85em; border-top: 1px solid #444; margin-top: 0.5rem;"><strong>By Category:</strong></td></tr>';
      Object.entries(state.accounting.expenses.costBreakdown).forEach(([category, amount]) => {
        html += `<tr><td style="padding: 0.5rem; color: #888; font-size: 0.85em; padding-left: 1rem;">${category}:</td><td style="padding: 0.5rem; text-align: right; color: #888; font-size: 0.85em;">$${parseFloat(amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>`;
      });
    }
    
    html += '</table>';
    html += '</div>';

    html += '</div>';

    // P/L Statement
    html += '<div style="padding: 1rem; background: #1a1a1a; border-radius: 4px;">';
    html += '<h3 style="color: #90caf9; margin-top: 0;">Profit & Loss Statement</h3>';
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
    html += '<tr><td style="padding: 0.75rem; color: #e0e0e0;">Revenue:</td><td style="padding: 0.75rem; text-align: right; color: #4caf50;">$' + parseFloat(state.accounting.revenue.netRevenue || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</td></tr>';
    html += '<tr><td style="padding: 0.75rem; color: #e0e0e0;">Less: Expenses:</td><td style="padding: 0.75rem; text-align: right; color: #ff9800;">($' + parseFloat(state.accounting.expenses.totalExpenses || '0').toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ')</td></tr>';
    html += '<tr style="border-top: 2px solid #444; border-bottom: 2px solid #444;"><td style="padding: 0.75rem; color: #e0e0e0; font-weight: bold; font-size: 1.1em;">Gross Profit:</td><td style="padding: 0.75rem; text-align: right; color: ' + profitColor + '; font-weight: bold; font-size: 1.1em;">$' + profitValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</td></tr>';
    html += '<tr><td style="padding: 0.75rem; color: #888; font-size: 0.85em;">Operating Margin:</td><td style="padding: 0.75rem; text-align: right; color: #888; font-size: 0.85em;">' + parseFloat(state.accounting.profitLoss.operatingMargin || '0').toFixed(1) + '%</td></tr>';
    html += '</table>';
    html += '</div>';
  } else {
    html += '<p style="color: #888;">Loading accounting data...</p>';
  }
  
  html += '</section>';

  // Real-Time Activity Feed Section
  html += '<section class="vault-section">';
  html += '<h2>Real-Time Activity Feed</h2>';
  html += '<div class="activity-feed-container">';
  html += '<div class="activity-feed-header">';
  html += '<span>Live Activity Monitor</span>';
  html += `<span class="activity-count">${state.activityFeed.length} events</span>`;
  html += '</div>';
  html += '<div class="activity-feed" id="activity-feed">';
  if (state.activityFeed.length === 0) {
    html += '<p class="no-activity">No activity yet. Events will appear here in real-time.</p>';
  } else {
    state.activityFeed.slice(0, 50).forEach(activity => {
      html += renderActivityItem(activity);
    });
  }
  html += '</div>';
  html += '</div>';
  html += '</section>';

  // Alerts Section
  if (state.alerts.length > 0) {
    html += '<section class="vault-section">';
    html += '<h2>System Alerts</h2>';
    html += '<div class="alerts-container">';
    state.alerts.slice(0, 20).forEach(alert => {
      html += renderAlertItem(alert);
    });
    html += '</div>';
    html += '</section>';
  }

  // User Management Section
  html += '<section class="vault-section">';
  html += '<h2>User Management</h2>';
  
  // User Search
  html += '<div style="margin-bottom: 2rem; padding: 1rem; background: #1a1a1a; border-radius: 4px;">';
  html += '<h3 style="color: #90caf9; margin-top: 0;">Search Users</h3>';
  html += '<div style="display: flex; gap: 1rem; margin-bottom: 1rem;">';
  html += '<input type="text" id="user-search-input" placeholder="Search by wallet, masterAccountId, or platform:platformId" style="flex: 1; padding: 0.5rem; background: #2a2f3a; border: 1px solid #444; border-radius: 4px; color: #e0e0e0;" value="' + (state.userSearch.query || '') + '">';
  html += '<select id="user-search-type" style="padding: 0.5rem; background: #2a2f3a; border: 1px solid #444; border-radius: 4px; color: #e0e0e0;">';
  html += '<option value="">Auto-detect</option>';
  html += '<option value="wallet">Wallet Address</option>';
  html += '<option value="masterAccountId">Master Account ID</option>';
  html += '<option value="platform">Platform ID (format: platform:platformId)</option>';
  html += '</select>';
  html += '<button id="user-search-btn" style="padding: 0.5rem 1.5rem; background: #3f51b5; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Search</button>';
  html += '</div>';
  
  if (state.userSearch.loading) {
    html += '<p style="color: #90caf9;">Searching...</p>';
  } else if (state.userSearch.results.length > 0) {
    html += '<div class="user-search-results" style="display: flex; flex-direction: column; gap: 0.5rem;">';
    state.userSearch.results.forEach(user => {
      const wallet = user.wallets && user.wallets.length > 0 ? user.wallets[0].address : 'N/A';
      const accountAge = user.userCreationTimestamp ? Math.floor((Date.now() - new Date(user.userCreationTimestamp).getTime()) / (1000 * 60 * 60 * 24)) : 'N/A';
      html += `<div class="user-result-item" data-user-id="${user._id}" style="padding: 1rem; background: #2a2f3a; border-radius: 4px; cursor: pointer; border: 2px solid transparent;" onmouseover="this.style.borderColor='#3f51b5'" onmouseout="this.style.borderColor='transparent'">`;
      html += `<div style="display: flex; justify-content: space-between; align-items: center;">`;
      html += `<div>`;
      html += `<div style="font-weight: bold; color: #90caf9;">${user._id}</div>`;
      html += `<div style="font-size: 0.9em; color: #888;">Wallet: ${wallet.slice(0, 20)}... | Account Age: ${accountAge} days</div>`;
      html += `</div>`;
      html += `<button class="view-user-btn" data-user-id="${user._id}" style="padding: 0.5rem 1rem; background: #4caf50; color: #fff; border: none; border-radius: 4px; cursor: pointer;">View Details</button>`;
      html += `</div>`;
      html += `</div>`;
    });
    html += '</div>';
  } else if (state.userSearch.query && !state.userSearch.loading) {
    html += '<p style="color: #888;">No users found. Try a different search term.</p>';
  }
  html += '</div>';

  // Selected User Details
  if (state.userSearch.selectedUser) {
    html += renderUserDetails(state.userSearch.selectedUser);
  }
  
  html += '</section>';

  // Cost Logging Section
  html += '<section class="vault-section">';
  html += '<h2>Cost Logging</h2>';
  
  // Cost entry form
  html += '<div style="margin-bottom: 2rem; padding: 1rem; background: #1a1a1a; border-radius: 4px;">';
  html += '<h3 style="color: #90caf9; margin-top: 0;">Add Cost Entry</h3>';
  html += '<form id="cost-entry-form" style="display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">';
  html += '<div><label style="color: #e0e0e0; display: block; margin-bottom: 0.5rem;">Date:</label><input type="date" id="cost-date" required style="width: 100%; padding: 0.5rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;"></div>';
  html += '<div><label style="color: #e0e0e0; display: block; margin-bottom: 0.5rem;">Category:</label><select id="cost-category" required style="width: 100%; padding: 0.5rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;"><option value="infrastructure">Infrastructure</option><option value="third-party">Third-Party</option><option value="development">Development</option><option value="marketing">Marketing</option><option value="other">Other</option></select></div>';
  html += '<div><label style="color: #e0e0e0; display: block; margin-bottom: 0.5rem;">Amount (USD):</label><input type="number" id="cost-amount" step="0.01" required style="width: 100%; padding: 0.5rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;"></div>';
  html += '<div><label style="color: #e0e0e0; display: block; margin-bottom: 0.5rem;">Vendor (optional):</label><input type="text" id="cost-vendor" style="width: 100%; padding: 0.5rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;"></div>';
  html += '<div style="grid-column: 1 / -1;"><label style="color: #e0e0e0; display: block; margin-bottom: 0.5rem;">Description:</label><textarea id="cost-description" required rows="3" style="width: 100%; padding: 0.5rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px; resize: vertical;"></textarea></div>';
  html += '<div style="grid-column: 1 / -1;"><label style="color: #e0e0e0; display: block; margin-bottom: 0.5rem;">Receipt URL (optional):</label><input type="url" id="cost-receipt-url" style="width: 100%; padding: 0.5rem; background: #2a2f3a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px;"></div>';
  html += '<div style="grid-column: 1 / -1;"><button type="submit" style="padding: 0.75rem 1.5rem; background: #3f51b5; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 1em;">Add Cost Entry</button></div>';
  html += '</form>';
  html += '</div>';

  // Cost totals by category
  if (state.costTotals && state.costTotals.length > 0) {
    html += '<div style="margin-bottom: 2rem; padding: 1rem; background: #1a1a1a; border-radius: 4px;">';
    html += '<h3 style="color: #90caf9; margin-top: 0;">Totals by Category</h3>';
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">';
    state.costTotals.forEach(total => {
      const amount = parseFloat(total.total || '0');
      html += `<div style="padding: 1rem; background: #2a2f3a; border-radius: 4px;"><strong style="color: #90caf9;">${total.category}</strong><br><span style="color: #e0e0e0; font-size: 1.2em;">$${amount.toFixed(2)}</span><br><span style="color: #888; font-size: 0.9em;">${total.count} entries</span></div>`;
    });
    html += '</div>';
    html += '</div>';
  }

  // Cost entries list
  if (state.costs && state.costs.length > 0) {
    html += '<h3 style="color: #90caf9;">Recent Cost Entries</h3>';
    html += '<div style="overflow-x: auto;">';
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
    html += '<thead>';
    html += '<tr style="background: #1a1a1a; border-bottom: 2px solid #444;">';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Date</th>';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Category</th>';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Description</th>';
    html += '<th style="padding: 0.75rem; text-align: right; color: #90caf9;">Amount</th>';
    html += '<th style="padding: 0.75rem; text-align: left; color: #90caf9;">Vendor</th>';
    html += '</tr>';
    html += '</thead>';
    html += '<tbody>';
    
    state.costs.slice(0, 20).forEach((cost, index) => {
      const rowStyle = index % 2 === 0 ? 'background: #2a2f3a;' : 'background: #23272f;';
      const amount = parseFloat(cost.amount || '0');
      const date = cost.date ? new Date(cost.date).toLocaleDateString() : 'N/A';
      
      html += `<tr style="${rowStyle}">`;
      html += `<td style="padding: 0.75rem; color: #e0e0e0;">${date}</td>`;
      html += `<td style="padding: 0.75rem; color: #e0e0e0;">${cost.category || 'N/A'}</td>`;
      html += `<td style="padding: 0.75rem; color: #e0e0e0;">${cost.description || 'N/A'}</td>`;
      html += `<td style="padding: 0.75rem; text-align: right; color: #e0e0e0;">$${amount.toFixed(2)}</td>`;
      html += `<td style="padding: 0.75rem; color: #e0e0e0;">${cost.vendor || '-'}</td>`;
      html += '</tr>';
    });
    
    html += '</tbody>';
    html += '</table>';
    html += '</div>';
  } else {
    html += '<p style="color: #888;">No cost entries yet. Add your first cost entry above.</p>';
  }

  html += '</section>';

  // If no data at all, show a message
  if ((!state.balances || (!state.balances.foundation || state.balances.foundation.length === 0)) &&
      (!state.balances || (!state.balances.charteredVaults || state.balances.charteredVaults.length === 0)) &&
      (!state.withdrawalRequests || state.withdrawalRequests.length === 0)) {
    html += '<section class="vault-section">';
    html += '<h2>No Vault Data</h2>';
    html += '<p>No deposits or vaults found. Balances will appear here once funds are deposited.</p>';
    html += '</section>';
  }

  html += '</div>';
  
  console.log('[AdminDashboard] Setting innerHTML, container:', container);
  console.log('[AdminDashboard] HTML length:', html.length);
  container.innerHTML = html;

  // Attach event listeners to withdraw buttons
  document.querySelectorAll('.withdraw-btn').forEach(btn => {
    btn.addEventListener('click', handleWithdraw);
  });

  // Attach event listeners to analytics controls
  const periodSelect = document.getElementById('analytics-period');
  const startDateInput = document.getElementById('analytics-start-date');
  const endDateInput = document.getElementById('analytics-end-date');
  const refreshBtn = document.getElementById('refresh-analytics');

  if (periodSelect) {
    periodSelect.addEventListener('change', async (e) => {
      state.dateRange.period = e.target.value;
      await loadAnalytics();
      render();
    });
  }

  if (startDateInput) {
    startDateInput.addEventListener('change', async (e) => {
      state.dateRange.startDate = new Date(e.target.value);
      await loadAnalytics();
      render();
    });
  }

  if (endDateInput) {
    endDateInput.addEventListener('change', async (e) => {
      state.dateRange.endDate = new Date(e.target.value);
      await loadAnalytics();
      render();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await loadAnalytics();
      render();
    });
  }

  // Rankings controls
  const rankingsSortBy = document.getElementById('rankings-sort-by');
  const rankingsServiceFilter = document.getElementById('rankings-service-filter');
  const refreshRankingsBtn = document.getElementById('refresh-rankings');

  if (rankingsSortBy) {
    rankingsSortBy.addEventListener('change', async (e) => {
      state.rankingsSortBy = e.target.value;
      await loadAnalytics();
      render();
    });
  }

  if (rankingsServiceFilter) {
    rankingsServiceFilter.addEventListener('change', async (e) => {
      state.rankingsServiceFilter = e.target.value || null;
      await loadAnalytics();
      render();
    });
  }

  if (refreshRankingsBtn) {
    refreshRankingsBtn.addEventListener('click', async () => {
      await loadAnalytics();
      render();
    });
  }

  // Active users controls
  const activeUsersSortBy = document.getElementById('active-users-sort-by');
  const refreshActiveUsersBtn = document.getElementById('refresh-active-users');

  if (activeUsersSortBy) {
    activeUsersSortBy.addEventListener('change', async (e) => {
      state.activeUsersSortBy = e.target.value;
      await loadAnalytics();
      render();
    });
  }

  if (refreshActiveUsersBtn) {
    refreshActiveUsersBtn.addEventListener('click', async () => {
      await loadAnalytics();
      render();
    });
  }

  // User Management Event Listeners
  const userSearchBtn = document.getElementById('user-search-btn');
  const userSearchInput = document.getElementById('user-search-input');
  const userSearchType = document.getElementById('user-search-type');

  if (userSearchBtn) {
    userSearchBtn.addEventListener('click', handleUserSearch);
  }

  if (userSearchInput) {
    userSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleUserSearch();
      }
    });
  }

  // View user details buttons
  document.querySelectorAll('.view-user-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const masterAccountId = e.target.dataset.userId;
      await loadUserDetails(masterAccountId);
      render();
    });
  });

  // Close user details
  const closeUserDetailsBtn = document.getElementById('close-user-details');
  if (closeUserDetailsBtn) {
    closeUserDetailsBtn.addEventListener('click', () => {
      state.userSearch.selectedUser = null;
      render();
    });
  }

  // Activity tab switching
  document.querySelectorAll('.activity-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.target.dataset.tab;
      document.querySelectorAll('.activity-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.borderBottom = 'none';
        b.style.color = '#888';
      });
      e.target.classList.add('active');
      e.target.style.borderBottom = '2px solid #3f51b5';
      e.target.style.color = '#90caf9';

      document.querySelectorAll('.activity-tab-content').forEach(content => {
        content.style.display = 'none';
      });
      const content = document.getElementById(`activity-tab-${tab}`);
      if (content) {
        content.style.display = 'block';
      }
    });
  });

  // Deposit diagnostics & follow-up queue controls
  document.querySelectorAll('.diagnose-deposit-btn').forEach(btn => {
    btn.addEventListener('click', handleDepositDiagnostics);
  });

  document.querySelectorAll('.queue-deposit-btn').forEach(btn => {
    btn.addEventListener('click', handleQueueDeposit);
  });

  document.querySelectorAll('.copy-deposit-btn').forEach(btn => {
    btn.addEventListener('click', handleCopyDepositPayload);
  });

  document.querySelectorAll('.copy-queue-entry-btn').forEach(btn => {
    btn.addEventListener('click', handleCopyQueueEntry);
  });

  document.querySelectorAll('.remove-queue-entry-btn').forEach(btn => {
    btn.addEventListener('click', handleRemoveQueueEntry);
  });

  const exportQueueBtn = document.getElementById('export-deposit-queue');
  if (exportQueueBtn) {
    exportQueueBtn.addEventListener('click', handleExportDepositQueue);
  }

  // Account adjust points buttons
  document.querySelectorAll('.adjust-points-btn').forEach(btn => {
    btn.addEventListener('click', handleOpenAdjustPointsModal);
  });

  document.querySelectorAll('.deposit-status-checkbox').forEach(cb => {
    cb.addEventListener('change', handleDepositStatusFilterChange);
  });
  const depositTokenInput = document.getElementById('deposit-token-filter');
  if (depositTokenInput) {
    depositTokenInput.addEventListener('change', handleDepositTokenFilterChange);
  }
  const depositRefreshBtn = document.getElementById('deposit-refresh-btn');
  if (depositRefreshBtn) {
    depositRefreshBtn.addEventListener('click', () => loadDepositRecoveryData());
  }

  // Adjust points form
  const adjustPointsForm = document.getElementById('adjust-points-form');
  if (adjustPointsForm) {
    adjustPointsForm.addEventListener('submit', handleAdjustPoints);
  }

  // Save user notes
  const saveUserNotesBtn = document.getElementById('save-user-notes-btn');
  if (saveUserNotesBtn) {
    saveUserNotesBtn.addEventListener('click', handleSaveUserNotes);
  }

  // Accounting controls
  const accountingPeriod = document.getElementById('accounting-period');
  const refreshAccountingBtn = document.getElementById('refresh-accounting');

  if (accountingPeriod) {
    accountingPeriod.addEventListener('change', async (e) => {
      state.accountingPeriod = e.target.value;
      await loadAnalytics();
      render();
    });
  }

  if (refreshAccountingBtn) {
    refreshAccountingBtn.addEventListener('click', async () => {
      await loadAnalytics();
      render();
    });
  }

  // Render charts after a short delay to ensure DOM is ready
  setTimeout(() => {
    renderCharts();
  }, 100);

  // Attach cost entry form handler
  const costForm = document.getElementById('cost-entry-form');
  if (costForm) {
    costForm.addEventListener('submit', handleCostEntrySubmit);
  }
}

async function handleCostEntrySubmit(event) {
  event.preventDefault();
  
  if (!currentAccount) {
    showNotification('Wallet not connected', 'error');
    return;
  }

  const formData = {
    date: document.getElementById('cost-date').value,
    category: document.getElementById('cost-category').value,
    description: document.getElementById('cost-description').value,
    amount: parseFloat(document.getElementById('cost-amount').value),
    vendor: document.getElementById('cost-vendor').value || null,
    receiptUrl: document.getElementById('cost-receipt-url').value || null,
    tags: [],
    createdBy: currentAccount
  };

  try {
    const response = await fetch(`/api/v1/admin/vaults/costs?wallet=${currentAccount}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });

    if (response.ok) {
      showNotification('Cost entry added successfully', 'success');
      // Reset form
      event.target.reset();
      // Reload costs
      await loadCosts();
      render();
    } else {
      const errorData = await response.json();
      showNotification(`Failed to add cost entry: ${errorData.error?.message || 'Unknown error'}`, 'error');
    }
  } catch (error) {
    console.error('Error submitting cost entry:', error);
    showNotification(`Error: ${error.message}`, 'error');
  }
}

function renderCharts() {
  if (!state.analytics) return;

  // Destroy existing charts
  Object.values(state.charts).forEach(chart => {
    if (chart && typeof chart.destroy === 'function') {
      chart.destroy();
    }
  });
  state.charts = {};

  // Point Usage Chart
  if (state.analytics.pointUsage && state.analytics.pointUsage.length > 0) {
    const pointUsageData = createPointUsageChartData(state.analytics.pointUsage);
    state.charts.pointUsage = createLineChart('point-usage-chart', pointUsageData, {
      plugins: {
        ...CHART_CONFIG.plugins,
        title: {
          display: true,
          text: 'Points Spent & Cost Over Time',
          color: '#90caf9'
        },
        tooltip: {
          ...CHART_CONFIG.plugins.tooltip,
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.datasetIndex === 0) {
                // Points
                label += formatNumber(context.parsed.y) + ' points';
              } else {
                // USD
                label += '$' + parseFloat(context.parsed.y).toFixed(2);
              }
              return label;
            }
          }
        }
      },
      scales: {
        ...CHART_CONFIG.scales,
        y: {
          ...CHART_CONFIG.scales.y,
          position: 'left',
          title: {
            display: true,
            text: 'Points',
            color: CHART_COLORS_CONFIG.primary
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          ticks: {
            color: CHART_COLORS_CONFIG.warning
          },
          grid: {
            drawOnChartArea: false
          },
          title: {
            display: true,
            text: 'Cost (USD)',
            color: CHART_COLORS_CONFIG.warning
          }
        }
      }
    });
  }

  // Deposits Chart
  if (state.analytics.deposits && state.analytics.deposits.length > 0) {
    const depositsData = createDepositsChartData(state.analytics.deposits);
    state.charts.deposits = createBarChart('deposits-chart', depositsData, {
      plugins: {
        ...CHART_CONFIG.plugins,
        title: {
          display: true,
          text: 'Deposits Count Over Time',
          color: '#90caf9'
        }
      }
    });
  }

  // Active Users Chart
  if (state.analytics.activeUsers && state.analytics.activeUsers.length > 0) {
    const activeUsersData = createActiveUsersChartData(state.analytics.activeUsers);
    state.charts.activeUsers = createLineChart('active-users-chart', activeUsersData, {
      plugins: {
        ...CHART_CONFIG.plugins,
        title: {
          display: true,
          text: 'Active Users Over Time',
          color: '#90caf9'
        }
      }
    });
  }

  // Withdrawals Chart
  if (state.withdrawalAnalytics && state.withdrawalAnalytics.withdrawals && state.withdrawalAnalytics.withdrawals.length > 0) {
    const withdrawalsData = createWithdrawalsChartData(state.withdrawalAnalytics.withdrawals);
    state.charts.withdrawals = createBarChart('withdrawals-chart', withdrawalsData, {
      plugins: {
        ...CHART_CONFIG.plugins,
        title: {
          display: true,
          text: 'Withdrawals Over Time',
          color: '#90caf9'
        }
      }
    });
  }
}

// Export function for chart data export (needs to be on window for onclick)
window.exportChartData = function(chartType) {
  let data = null;
  let filename = '';

  switch (chartType) {
    case 'pointUsage':
      data = state.analytics?.pointUsage || [];
      filename = `point-usage-${state.dateRange.period}-${Date.now()}.csv`;
      break;
    case 'deposits':
      data = state.analytics?.deposits || [];
      filename = `deposits-${state.dateRange.period}-${Date.now()}.csv`;
      break;
    case 'activeUsers':
      data = state.analytics?.activeUsers || [];
      filename = `active-users-${state.dateRange.period}-${Date.now()}.csv`;
      break;
    case 'withdrawals':
      data = state.withdrawalAnalytics?.withdrawals || [];
      filename = `withdrawals-${state.dateRange.period}-${Date.now()}.csv`;
      break;
  }

  if (data && data.length > 0) {
    exportChartDataToCSV(data, filename);
  } else {
    alert('No data to export');
  }
};

function hideAdminContent() {
  const container = document.querySelector('.admin-content-placeholder');
  if (container) {
    container.innerHTML = '<p>Admin features will appear here after wallet verification.</p>';
  }
}

async function handleWithdraw(event) {
  const btn = event.target;
  const tokenAddress = btn.dataset.token;
  const vaultAddress = btn.dataset.vault;
  const amount = btn.dataset.amount;
  const symbol = btn.dataset.symbol || 'tokens';
  const decimals = parseInt(btn.dataset.decimals || '18');

  if (!signer) {
    showNotification('Wallet not connected. Please connect your wallet.', 'error');
    return;
  }

  const amountFormatted = formatUnits(amount, decimals);
  const vaultName = vaultAddress.toLowerCase() === FOUNDATION_ADDRESS.toLowerCase() 
    ? 'Foundation Protocol Escrow' 
    : `Vault ${vaultAddress.slice(0, 10)}...`;
  
  // Enhanced confirmation dialog
  const confirmed = confirm(
    `Request withdrawal from ${vaultName}?\n\n` +
    `Token: ${symbol}\n` +
    `Amount: ${amountFormatted} ${symbol}\n\n` +
    `The marshal will process this withdrawal automatically after confirmation.`
  );
  
  if (!confirmed) {
    return;
  }

  const originalText = btn.textContent;
  const originalDisabled = btn.disabled;

  try {
    btn.disabled = true;
    btn.textContent = 'Processing...';

    // Determine which contract to use based on vault address
    let contract;
    if (vaultAddress.toLowerCase() === FOUNDATION_ADDRESS.toLowerCase()) {
      // Foundation vault
      contract = foundationContract;
    } else {
      // Chartered vault - create contract instance for the specific vault
      contract = new ethers.Contract(vaultAddress, CHARTERED_FUND_ABI, signer);
    }
    
    // Call requestRescission on the appropriate contract
    const tx = await contract.requestRescission(tokenAddress);
    btn.textContent = 'Waiting for confirmation...';
    
    // Show pending notification
    showNotification(`Transaction submitted: ${tx.hash.slice(0, 10)}...`, 'info');
    
    const receipt = await tx.wait();
    
    // Success notification with transaction link
    const txHash = receipt.hash;
    const etherscanUrl = `https://etherscan.io/tx/${txHash}`;
    showNotification(
      `Withdrawal requested successfully!\n\nTransaction: ${txHash}\n\nThe marshal will process this withdrawal automatically.`,
      'success',
      etherscanUrl
    );
    
    // Reload dashboard after a short delay
    setTimeout(() => {
      loadDashboard();
    }, 2000);
    
  } catch (error) {
    console.error('Error requesting withdrawal:', error);
    const errorMsg = error.message || 'Unknown error occurred';
    showNotification(`Withdrawal failed: ${errorMsg}`, 'error');
    btn.disabled = originalDisabled;
    btn.textContent = originalText;
  }
}

function showNotification(message, type = 'info', link = null) {
  // Create notification element
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    color: #fff;
    background: ${type === 'error' ? '#d32f2f' : type === 'success' ? '#4caf50' : '#3f51b5'};
    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    z-index: 10000;
    max-width: 400px;
    word-wrap: break-word;
    font-size: 0.9em;
    line-height: 1.5;
  `;
  
  const messageText = document.createElement('div');
  messageText.textContent = message;
  messageText.style.marginBottom = link ? '0.5rem' : '0';
  notification.appendChild(messageText);
  
  if (link) {
    const linkEl = document.createElement('a');
    linkEl.href = link;
    linkEl.target = '_blank';
    linkEl.textContent = 'View on Etherscan →';
    linkEl.style.cssText = 'color: #fff; text-decoration: underline; display: block; margin-top: 0.5rem;';
    notification.appendChild(linkEl);
  }
  
  document.body.appendChild(notification);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 5000);
}

function renderActivityItem(activity) {
  const time = new Date(activity.timestamp || activity.receivedAt).toLocaleTimeString();
  const eventType = activity.eventType || 'unknown';
  let icon = '📊';
  let color = '#90caf9';
  
  switch (eventType) {
    case 'deposit':
      icon = '💰';
      color = '#4caf50';
      break;
    case 'withdrawalRequest':
    case 'withdrawalProcessed':
      icon = '💸';
      color = '#ff9800';
      break;
    case 'pointSpend':
      icon = '⚡';
      color = '#2196f3';
      break;
    case 'alert':
      icon = activity.severity === 'error' ? '🚨' : activity.severity === 'warning' ? '⚠️' : 'ℹ️';
      color = activity.severity === 'error' ? '#d32f2f' : activity.severity === 'warning' ? '#ff9800' : '#2196f3';
      break;
  }

  let details = '';
  if (eventType === 'deposit') {
    details = `Deposit: ${Number(activity.points || 0).toLocaleString()} points from ${activity.depositorAddress?.slice(0, 10)}...`;
    if (activity.txHash) {
      details += ` <a href="https://etherscan.io/tx/${activity.txHash}" target="_blank" style="color: ${color}">View TX</a>`;
    }
  } else if (eventType === 'withdrawalRequest' || eventType === 'withdrawalProcessed') {
    details = `${eventType === 'withdrawalRequest' ? 'Request' : 'Processed'}: ${activity.amount ? Number(activity.amount).toLocaleString() : 'N/A'} from ${activity.depositorAddress?.slice(0, 10)}...`;
    if (activity.txHash) {
      details += ` <a href="https://etherscan.io/tx/${activity.txHash}" target="_blank" style="color: ${color}">View TX</a>`;
    }
  } else if (eventType === 'pointSpend') {
    details = `Spent ${Number(activity.points || 0).toLocaleString()} points on ${activity.toolDisplayName || activity.toolId || 'unknown'} (${activity.serviceName || 'unknown'})`;
    if (activity.costUsd) {
      details += ` - $${Number(activity.costUsd).toFixed(4)}`;
    }
  } else if (eventType === 'alert') {
    details = activity.message || 'System alert';
  }

  return `
    <div class="activity-item" style="border-left: 3px solid ${color}">
      <div class="activity-header">
        <span class="activity-icon">${icon}</span>
        <span class="activity-type">${eventType}</span>
        <span class="activity-time">${time}</span>
      </div>
      <div class="activity-details">${details}</div>
    </div>
  `;
}

function renderAlertItem(alert) {
  const time = new Date(alert.timestamp || alert.receivedAt).toLocaleTimeString();
  const severity = alert.severity || 'info';
  const bgColor = severity === 'error' ? 'rgba(211, 47, 47, 0.1)' : severity === 'warning' ? 'rgba(255, 152, 0, 0.1)' : 'rgba(33, 150, 243, 0.1)';
  const borderColor = severity === 'error' ? '#d32f2f' : severity === 'warning' ? '#ff9800' : '#2196f3';
  
  return `
    <div class="alert-item" style="background: ${bgColor}; border-left: 4px solid ${borderColor}">
      <div class="alert-header">
        <span class="alert-severity">${severity.toUpperCase()}</span>
        <span class="alert-time">${time}</span>
      </div>
      <div class="alert-message">${alert.message || 'System alert'}</div>
      ${alert.category ? `<div class="alert-category">Category: ${alert.category}</div>` : ''}
    </div>
  `;
}

function renderUserDetails(userData) {
  const user = userData.user || {};
  const economy = userData.economy || {};
  const transactions = userData.transactions || [];
  const generations = userData.generations || [];
  const deposits = userData.deposits || [];

  const wallet = user.wallets && user.wallets.length > 0 ? user.wallets[0].address : 'N/A';
  const accountAge = user.userCreationTimestamp ? Math.floor((Date.now() - new Date(user.userCreationTimestamp).getTime()) / (1000 * 60 * 60 * 24)) : 'N/A';
  const balanceUsd = economy.usdCredit ? parseFloat(economy.usdCredit.toString()) : 0;
  const balancePoints = Math.floor(balanceUsd / USD_PER_POINT);

  let html = '<div style="margin-top: 2rem; padding: 1.5rem; background: #1a1a1a; border-radius: 4px; border: 2px solid #3f51b5;">';
  html += '<div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1.5rem;">';
  html += '<h3 style="color: #90caf9; margin-top: 0;">User Details: ' + user._id + '</h3>';
  html += '<button id="close-user-details" style="padding: 0.5rem 1rem; background: #d32f2f; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Close</button>';
  html += '</div>';

  // User Info Cards
  html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">';
  html += '<div style="padding: 1rem; background: #2a2f3a; border-radius: 4px;">';
  html += '<div style="color: #888; font-size: 0.9em;">Balance (USD)</div>';
  html += '<div style="font-size: 1.5em; font-weight: bold; color: #4caf50;">$' + balanceUsd.toFixed(4) + '</div>';
  html += '<div style="color: #888; font-size: 0.85em;">≈ ' + balancePoints.toLocaleString() + ' points</div>';
  html += '</div>';
  html += '<div style="padding: 1rem; background: #2a2f3a; border-radius: 4px;">';
  html += '<div style="color: #888; font-size: 0.9em;">Account Age</div>';
  html += '<div style="font-size: 1.5em; font-weight: bold; color: #90caf9;">' + accountAge + ' days</div>';
  html += '</div>';
  html += '<div style="padding: 1rem; background: #2a2f3a; border-radius: 4px;">';
  html += '<div style="color: #888; font-size: 0.9em;">Status</div>';
  html += '<div style="font-size: 1.2em; font-weight: bold; color: ' + (user.status === 'active' ? '#4caf50' : '#ff9800') + ';">' + (user.status || 'active') + '</div>';
  html += '</div>';
  html += '</div>';

  // Wallet & Platform Info
  html += '<div style="margin-bottom: 1.5rem;">';
  html += '<h4 style="color: #c0c0c0;">Wallet Address</h4>';
  html += '<div style="padding: 0.75rem; background: #2a2f3a; border-radius: 4px; font-family: monospace; color: #90caf9;">' + wallet + '</div>';
  if (user.platformIdentities && Object.keys(user.platformIdentities).length > 0) {
    html += '<h4 style="color: #c0c0c0; margin-top: 1rem;">Platform Identities</h4>';
    html += '<div style="padding: 0.75rem; background: #2a2f3a; border-radius: 4px;">';
    Object.entries(user.platformIdentities).forEach(([platform, id]) => {
      html += `<div style="margin-bottom: 0.25rem;"><span style="color: #90caf9;">${platform}:</span> <span style="color: #e0e0e0;">${id}</span></div>`;
    });
    html += '</div>';
  }
  html += '</div>';

  // Admin Notes & Flags
  html += '<div style="margin-bottom: 1.5rem; padding: 1rem; background: #2a2f3a; border-radius: 4px;">';
  html += '<h4 style="color: #c0c0c0; margin-top: 0;">Admin Notes & Flags</h4>';
  html += '<textarea id="user-admin-note" placeholder="Add admin notes..." style="width: 100%; min-height: 80px; padding: 0.5rem; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; color: #e0e0e0; margin-bottom: 0.5rem;">' + (user.adminNotes?.note || '') + '</textarea>';
  html += '<div style="display: flex; gap: 1rem; align-items: center; margin-bottom: 0.5rem;">';
  html += '<label style="color: #e0e0e0;">Flag:</label>';
  html += '<select id="user-admin-flag" style="flex: 1; padding: 0.5rem; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; color: #e0e0e0;">';
  html += '<option value="">None</option>';
  html += '<option value="flagged"' + (user.adminFlags === 'flagged' ? ' selected' : '') + '>Flagged</option>';
  html += '<option value="banned"' + (user.adminFlags === 'banned' ? ' selected' : '') + '>Banned</option>';
  html += '<option value="vip"' + (user.adminFlags === 'vip' ? ' selected' : '') + '>VIP</option>';
  html += '</select>';
  html += '</div>';
  html += '<button id="save-user-notes-btn" data-user-id="' + user._id + '" style="padding: 0.5rem 1rem; background: #3f51b5; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Save Notes/Flags</button>';
  if (user.adminNotes) {
    html += '<div style="margin-top: 0.5rem; padding: 0.5rem; background: #1a1a1a; border-radius: 4px; font-size: 0.9em; color: #888;">';
    html += 'Last updated by ' + (user.adminNotes.updatedBy || 'admin') + ' on ' + new Date(user.adminNotes.updatedAt).toLocaleString();
    html += '</div>';
  }
  html += '</div>';

  // Point Adjustment
  html += '<div style="margin-bottom: 1.5rem; padding: 1rem; background: #2a2f3a; border-radius: 4px;">';
  html += '<h4 style="color: #c0c0c0; margin-top: 0;">Adjust Points/Credits</h4>';
  html += '<form id="adjust-points-form" data-user-id="' + user._id + '" style="display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">';
  html += '<div>';
  html += '<label style="color: #e0e0e0; display: block; margin-bottom: 0.25rem;">Amount (USD)</label>';
  html += '<input type="number" id="adjust-amount-usd" step="0.0001" placeholder="0.0000" style="width: 100%; padding: 0.5rem; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; color: #e0e0e0;">';
  html += '</div>';
  html += '<div>';
  html += '<label style="color: #e0e0e0; display: block; margin-bottom: 0.25rem;">Or Points</label>';
  html += '<input type="number" id="adjust-points" step="1" placeholder="0" style="width: 100%; padding: 0.5rem; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; color: #e0e0e0;">';
  html += '</div>';
  html += '<div>';
  html += '<label style="color: #e0e0e0; display: block; margin-bottom: 0.25rem;">Description *</label>';
  html += '<input type="text" id="adjust-description" required placeholder="Reason for adjustment" style="width: 100%; padding: 0.5rem; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; color: #e0e0e0;">';
  html += '</div>';
  html += '<div>';
  html += '<label style="color: #e0e0e0; display: block; margin-bottom: 0.25rem;">Reason (optional)</label>';
  html += '<input type="text" id="adjust-reason" placeholder="Additional context" style="width: 100%; padding: 0.5rem; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; color: #e0e0e0;">';
  html += '</div>';
  html += '<div style="grid-column: 1 / -1;">';
  html += '<button type="submit" style="padding: 0.75rem 1.5rem; background: #4caf50; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Apply Adjustment</button>';
  html += '</div>';
  html += '</form>';
  html += '</div>';

  // Recent Activity Tabs
  html += '<div style="margin-bottom: 1.5rem;">';
  html += '<div style="display: flex; gap: 0.5rem; margin-bottom: 1rem; border-bottom: 1px solid #444;">';
  html += '<button class="activity-tab-btn active" data-tab="transactions" style="padding: 0.5rem 1rem; background: transparent; border: none; border-bottom: 2px solid #3f51b5; color: #90caf9; cursor: pointer;">Transactions (' + transactions.length + ')</button>';
  html += '<button class="activity-tab-btn" data-tab="generations" style="padding: 0.5rem 1rem; background: transparent; border: none; color: #888; cursor: pointer;">Generations (' + generations.length + ')</button>';
  html += '<button class="activity-tab-btn" data-tab="deposits" style="padding: 0.5rem 1rem; background: transparent; border: none; color: #888; cursor: pointer;">Deposits (' + deposits.length + ')</button>';
  html += '</div>';
  
  // Transactions Tab
  html += '<div id="activity-tab-transactions" class="activity-tab-content">';
  if (transactions.length > 0) {
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
    html += '<thead><tr style="border-bottom: 1px solid #444;">';
    html += '<th style="text-align: left; padding: 0.5rem; color: #90caf9;">Date</th>';
    html += '<th style="text-align: left; padding: 0.5rem; color: #90caf9;">Type</th>';
    html += '<th style="text-align: right; padding: 0.5rem; color: #90caf9;">Amount (USD)</th>';
    html += '<th style="text-align: left; padding: 0.5rem; color: #90caf9;">Description</th>';
    html += '</tr></thead><tbody>';
    transactions.slice(0, 20).forEach(tx => {
      const amount = parseFloat(tx.amountUsd?.toString() || '0');
      const color = amount >= 0 ? '#4caf50' : '#ff9800';
      html += '<tr style="border-bottom: 1px solid #333;">';
      html += '<td style="padding: 0.5rem; color: #888;">' + new Date(tx.createdAt || tx.timestamp).toLocaleString() + '</td>';
      html += '<td style="padding: 0.5rem; color: #e0e0e0;">' + (tx.type || 'N/A') + '</td>';
      html += '<td style="padding: 0.5rem; text-align: right; color: ' + color + ';">' + (amount >= 0 ? '+' : '') + amount.toFixed(4) + '</td>';
      html += '<td style="padding: 0.5rem; color: #e0e0e0;">' + (tx.description || 'N/A') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
  } else {
    html += '<p style="color: #888;">No transactions found.</p>';
  }
  html += '</div>';

  // Generations Tab
  html += '<div id="activity-tab-generations" class="activity-tab-content" style="display: none;">';
  if (generations.length > 0) {
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
    html += '<thead><tr style="border-bottom: 1px solid #444;">';
    html += '<th style="text-align: left; padding: 0.5rem; color: #90caf9;">Date</th>';
    html += '<th style="text-align: left; padding: 0.5rem; color: #90caf9;">Tool</th>';
    html += '<th style="text-align: right; padding: 0.5rem; color: #90caf9;">Points</th>';
    html += '<th style="text-align: right; padding: 0.5rem; color: #90caf9;">Cost (USD)</th>';
    html += '<th style="text-align: left; padding: 0.5rem; color: #90caf9;">Status</th>';
    html += '</tr></thead><tbody>';
    generations.forEach(gen => {
      html += '<tr style="border-bottom: 1px solid #333;">';
      html += '<td style="padding: 0.5rem; color: #888;">' + new Date(gen.createdAt || gen.timestamp).toLocaleString() + '</td>';
      html += '<td style="padding: 0.5rem; color: #e0e0e0;">' + (gen.toolDisplayName || gen.toolId || 'N/A') + '</td>';
      html += '<td style="padding: 0.5rem; text-align: right; color: #ff9800;">' + (gen.pointsSpent || 0).toLocaleString() + '</td>';
      html += '<td style="padding: 0.5rem; text-align: right; color: #ff9800;">$' + (gen.costUsd ? parseFloat(gen.costUsd.toString()).toFixed(4) : '0.0000') + '</td>';
      html += '<td style="padding: 0.5rem; color: ' + (gen.status === 'completed' ? '#4caf50' : '#888') + ';">' + (gen.status || 'N/A') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
  } else {
    html += '<p style="color: #888;">No generations found.</p>';
  }
  html += '</div>';

  // Deposits Tab
  html += '<div id="activity-tab-deposits" class="activity-tab-content" style="display: none;">';
  if (deposits.length > 0) {
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
    html += '<thead><tr style="border-bottom: 1px solid #444;">';
    html += '<th style="text-align: left; padding: 0.5rem; color: #90caf9;">Date</th>';
    html += '<th style="text-align: left; padding: 0.5rem; color: #90caf9;">Token</th>';
    html += '<th style="text-align: left; padding: 0.5rem; color: #90caf9;">TX Hash</th>';
    html += '<th style="text-align: right; padding: 0.5rem; color: #90caf9;">Points</th>';
    html += '<th style="text-align: right; padding: 0.5rem; color: #90caf9;">USD Value</th>';
    html += '<th style="text-align: left; padding: 0.5rem; color: #90caf9;">Status</th>';
    html += '<th style="text-align: left; padding: 0.5rem; color: #90caf9;">Failure / Notes</th>';
    html += '<th style="text-align: left; padding: 0.5rem; color: #90caf9;">On-Chain State</th>';
    html += '<th style="text-align: left; padding: 0.5rem; color: #90caf9;">Actions</th>';
    html += '</tr></thead><tbody>';
    deposits.forEach((deposit, index) => {
      const points = deposit.points_credited || 0;
      const usdValue = deposit.user_credited_usd ? parseFloat(deposit.user_credited_usd.toString()) : 0;
      const txHash = deposit.deposit_tx_hash || deposit.confirmation_tx_hash || '';
      const tokenAddress = (deposit.token_address || deposit.tokenAddress || '').toLowerCase();
      const tokenMeta = getTokenMetadata(tokenAddress);
      const diag = state.depositDiagnostics[txHash];
      const diagError = diag?.error;
      const diagChecked = diag?.checkedAt ? relativeTimeFrom(diag.checkedAt) : null;
      const isQueued = state.depositFollowUpQueue?.some(entry => entry.txHash === txHash);
      const isConfirmed = deposit.status === 'CONFIRMED';
      const dateLabel = new Date(deposit.createdAt || deposit.timestamp).toLocaleString();
      let onChainHtml = '';
      if (diag && !diagError) {
        onChainHtml += `<div>Unconfirmed: <strong>${formatTokenAmountDisplay(diag.userOwned, tokenAddress)}</strong></div>`;
        onChainHtml += `<div style="color:#888;">Escrow: ${formatTokenAmountDisplay(diag.escrow, tokenAddress)}</div>`;
        onChainHtml += `<div style="color:#555;font-size:0.8em;">${diagChecked || 'just now'}</div>`;
        onChainHtml += `<button class="diagnose-deposit-btn" data-context="user" data-index="${index}" style="margin-top:0.25rem; padding:0.3rem 0.5rem; background:#2a2f3a; border:1px solid #444; border-radius:4px; color:#90caf9; cursor:pointer;">Refresh</button>`;
      } else if (diag && diagError) {
        onChainHtml += `<div style="color:#d32f2f;">${escapeHtml(diagError)}</div>`;
        onChainHtml += `<button class="diagnose-deposit-btn" data-context="user" data-index="${index}" style="margin-top:0.25rem; padding:0.3rem 0.5rem; background:#2a2f3a; border:1px solid #444; border-radius:4px; color:#90caf9; cursor:pointer;">Retry</button>`;
      } else {
        onChainHtml += `<button class="diagnose-deposit-btn" data-context="user" data-index="${index}" style="padding:0.4rem 0.75rem; background:#2a2f3a; border:1px solid #444; border-radius:4px; color:#90caf9; cursor:pointer;">Check</button>`;
      }

      html += '<tr style="border-bottom: 1px solid #333;">';
      html += `<td style="padding: 0.5rem; color: #888;">${dateLabel}</td>`;
      html += `<td style="padding: 0.5rem; color: #e0e0e0;">${tokenMeta.symbol}<div style="color:#888;font-size:0.8em;">${shortHash(tokenAddress)}</div></td>`;
      html += '<td style="padding: 0.5rem; color: #90caf9;"><a href="https://etherscan.io/tx/' + txHash + '" target="_blank" style="color: #90caf9;">' + (txHash ? txHash.slice(0, 16) + '...' : 'N/A') + '</a></td>';
      html += '<td style="padding: 0.5rem; text-align: right; color: #4caf50;">' + points.toLocaleString() + '</td>';
      html += '<td style="padding: 0.5rem; text-align: right; color: #4caf50;">$' + usdValue.toFixed(4) + '</td>';
      html += '<td style="padding: 0.5rem; color: ' + (isConfirmed ? '#4caf50' : '#ff9800') + ';">' + (deposit.status || 'N/A') + '</td>';
      html += `<td style="padding: 0.5rem;">${formatFailureMessage(deposit)}</td>`;
      html += `<td style="padding: 0.5rem; color:#e0e0e0;">${onChainHtml}</td>`;
      html += '<td style="padding: 0.5rem;">';
      html += `<button class="queue-deposit-btn" data-context="user" data-index="${index}" ${isConfirmed || isQueued ? 'disabled' : ''} style="display:block; width:100%; margin-bottom:0.35rem; padding:0.4rem; background:${isConfirmed || isQueued ? '#555' : '#3f51b5'}; color:#fff; border:none; border-radius:4px; cursor:${isConfirmed || isQueued ? 'not-allowed' : 'pointer'};">${isQueued ? 'Queued' : 'Queue Follow-Up'}</button>`;
      html += `<button class="copy-deposit-btn" data-context="user" data-index="${index}" style="display:block; width:100%; padding:0.4rem; background:#2a2f3a; color:#90caf9; border:1px solid #444; border-radius:4px; cursor:pointer;">Copy Payload</button>`;
      html += '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
  } else {
    html += '<p style="color: #888;">No deposits found.</p>';
  }
  html += '</div>';
  html += '</div>';
  return html;
}

function renderDepositRecoverySection() {
  const recovery = state.depositRecovery;
  const statusOptions = Array.from(new Set([...DEPOSIT_RECOVERY_DEFAULT_STATUSES, ...(recovery.filters.statuses || [])]));
  let html = '<section class="vault-section">';
  html += '<h2>Deposit Recovery</h2>';
  html += '<div style="margin-bottom: 1rem; padding: 1rem; background: #1a1a1a; border-radius: 4px;">';
  html += '<div style="display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center;">';
  html += '<label style="color:#e0e0e0;">Statuses:</label>';
  statusOptions.forEach((status, idx) => {
    const checkboxId = `deposit-status-${idx}`;
    const checked = recovery.filters.statuses.includes(status) ? 'checked' : '';
    html += `
      <label for="${checkboxId}" style="color:#e0e0e0; font-size:0.9em;">
        <input type="checkbox" class="deposit-status-checkbox" id="${checkboxId}" value="${status}" ${checked}>
        ${status.replace(/_/g, ' ')}
      </label>
    `;
  });
  html += '<label style="color:#e0e0e0; margin-left:1rem;">Token:</label>';
  const tokenFilterValue = escapeHtml(recovery.filters.token || '');
  html += `<input type="text" id="deposit-token-filter" placeholder="0x..." value="${tokenFilterValue}" style="padding:0.4rem; background:#2a2f3a; border:1px solid #444; border-radius:4px; color:#e0e0e0; min-width:220px;">`;
  html += '<button id="deposit-refresh-btn" style="padding:0.5rem 1rem; background:#3f51b5; color:#fff; border:none; border-radius:4px; cursor:pointer;">Refresh</button>';
  html += '</div>';
  html += '</div>';

  if (recovery.error) {
    html += `<div class="error" style="margin-bottom:1rem;">${escapeHtml(recovery.error)}</div>`;
  }

  if (recovery.metrics && recovery.deposits.length > 0) {
    const total = recovery.deposits.length;
    const countByStatus = recovery.metrics.countByStatus || {};
    html += '<div style="margin-bottom: 1rem; padding: 0.75rem; background: #1a1a1a; border-radius: 4px; font-size: 0.9em;">';
    html += `<strong style="color:#90caf9;">Open Deposits:</strong> ${total}`;
    html += ' &nbsp;|&nbsp; ';
    html += Object.entries(countByStatus).map(([status, count]) => `<span style="margin-right:0.75rem;">${status}: ${count}</span>`).join('');
    if (recovery.metrics.totalAmountWei) {
      html += ` &nbsp;|&nbsp; Total Raw: ${recovery.metrics.totalAmountWei} wei`;
    }
    html += '</div>';
  }

  if (recovery.loading) {
    html += '<div class="loading">Loading pending deposits…</div>';
  } else if (!recovery.deposits || recovery.deposits.length === 0) {
    html += '<p style="color:#888;">No deposits matched the current filters.</p>';
  } else {
    html += '<div style="overflow-x:auto;">';
    html += '<table style="width:100%; border-collapse:collapse; font-size:0.9em;">';
    html += '<thead><tr style="border-bottom:1px solid #444;">';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">Updated</th>';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">Depositor</th>';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">Token</th>';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">TX Hash</th>';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">Amount</th>';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">Status</th>';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">Failure / Notes</th>';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">On-Chain</th>';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">Actions</th>';
    html += '</tr></thead><tbody>';

    recovery.deposits.forEach((deposit, index) => {
      const txHash = deposit.deposit_tx_hash || deposit.confirmation_tx_hash || '';
      const tokenAddress = deposit.token_address || '';
      const tokenMeta = getTokenMetadata(tokenAddress);
      const amountDisplay = formatTokenAmountDisplay(deposit.deposit_amount_wei || '0', tokenAddress);
      const diag = txHash ? state.depositDiagnostics[txHash] : null;
      const diagError = diag?.error;
      const diagChecked = diag?.checkedAt ? relativeTimeFrom(diag.checkedAt) : null;
      const isQueued = state.depositFollowUpQueue?.some(entry => entry.txHash === txHash);
      const updatedLabel = deposit.updatedAt ? new Date(deposit.updatedAt).toLocaleString() : 'N/A';
      const depoShort = deposit.depositor_address ? shortHash(deposit.depositor_address) : 'Unknown';

      let onChainHtml = '';
      if (diag && !diagError) {
        onChainHtml = `
          <div>Unconfirmed: <strong>${formatTokenAmountDisplay(diag.userOwned, tokenAddress)}</strong></div>
          <div style="color:#888;">Escrow: ${formatTokenAmountDisplay(diag.escrow, tokenAddress)}</div>
          <div style="color:#555;font-size:0.8em;">${diagChecked || 'just now'}</div>
          <button class="diagnose-deposit-btn" data-context="recovery" data-index="${index}" style="margin-top:0.25rem; padding:0.3rem 0.5rem; background:#2a2f3a; border:1px solid #444; border-radius:4px; color:#90caf9; cursor:pointer;">Refresh</button>
        `;
      } else if (diag && diagError) {
        onChainHtml = `
          <div style="color:#d32f2f;">${escapeHtml(diagError)}</div>
          <button class="diagnose-deposit-btn" data-context="recovery" data-index="${index}" style="margin-top:0.25rem; padding:0.3rem 0.5rem; background:#2a2f3a; border:1px solid #444; border-radius:4px; color:#90caf9; cursor:pointer;">Retry</button>
        `;
      } else {
        onChainHtml = `<button class="diagnose-deposit-btn" data-context="recovery" data-index="${index}" style="padding:0.4rem 0.75rem; background:#2a2f3a; border:1px solid #444; border-radius:4px; color:#90caf9; cursor:pointer;">Check</button>`;
      }

      html += '<tr style="border-bottom:1px solid #333;">';
      html += `<td style="padding:0.5rem; color:#888;">${updatedLabel}</td>`;
      html += `<td style="padding:0.5rem; color:#e0e0e0; font-family:monospace;">${depoShort}<br><span style="color:#888; font-size:0.8em;">${deposit.master_account_id || 'n/a'}</span></td>`;
      html += `<td style="padding:0.5rem; color:#e0e0e0;">${tokenMeta.symbol}<div style="color:#888; font-size:0.8em;">${shortHash(tokenAddress)}</div></td>`;
      html += `<td style="padding:0.5rem; color:#90caf9;"><a href="https://etherscan.io/tx/${txHash}" target="_blank" style="color:#90caf9;">${txHash ? txHash.slice(0, 16) + '...' : 'N/A'}</a></td>`;
      html += `<td style="padding:0.5rem; color:#e0e0e0;">${amountDisplay}</td>`;
      html += `<td style="padding:0.5rem; color:${deposit.status === 'ERROR' ? '#ff9800' : '#e0e0e0'};">${deposit.status || 'N/A'}</td>`;
      html += `<td style="padding:0.5rem;">${formatFailureMessage(deposit)}</td>`;
      html += `<td style="padding:0.5rem; color:#e0e0e0;">${onChainHtml}</td>`;
      html += '<td style="padding:0.5rem;">';
      html += `<button class="queue-deposit-btn" data-context="recovery" data-index="${index}" ${isQueued ? 'disabled' : ''} style="display:block; width:100%; margin-bottom:0.35rem; padding:0.4rem; background:${isQueued ? '#555' : '#3f51b5'}; color:#fff; border:none; border-radius:4px; cursor:${isQueued ? 'not-allowed' : 'pointer'};">${isQueued ? 'Queued' : 'Queue Follow-Up'}</button>`;
      html += `<button class="copy-deposit-btn" data-context="recovery" data-index="${index}" style="display:block; width:100%; padding:0.4rem; background:#2a2f3a; color:#90caf9; border:1px solid #444; border-radius:4px; cursor:pointer;">Copy Payload</button>`;
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table>';
    html += '</div>';
  }

  html += '</section>';
  return html;
}

function renderDepositFollowUpQueue() {
  const queue = state.depositFollowUpQueue || [];
  let html = '<section class="vault-section">';
  html += '<h2>Deposit Follow-Up Queue</h2>';
  html += '<div style="margin-top: 1rem; padding: 1.5rem; background: #2a2f3a; border-radius: 4px;">';
  html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; gap: 1rem; flex-wrap: wrap;">';
  html += '<h4 style="color: #c0c0c0; margin: 0;">Deposit Recovery Queue</h4>';
  html += '<div>';
  html += `<span style="color:#90caf9; margin-right:0.75rem;">${queue.length} queued</span>`;
  html += '<button id="export-deposit-queue" style="padding:0.4rem 0.75rem; background:#2a2f3a; border:1px solid #444; border-radius:4px; color:#90caf9; cursor:pointer;">Export JSON</button>';
  html += '</div>';
  html += '</div>';
  html += '<p style="color:#888; font-size:0.9em; margin-top:0; margin-bottom:1rem;">Queue entries are stored locally. Each entry only prepares data for a manual on-chain transaction signed with the verified admin wallet—no server-side balance changes are performed from this UI.</p>';

  if (queue.length === 0) {
    html += '<p style="color:#888;">No deposits queued. Use “Queue Follow-Up” beside a deposit to stage a manual confirmation or rescission.</p>';
  } else {
    html += '<div style="overflow-x:auto;">';
    html += '<table style="width:100%; border-collapse:collapse; font-size:0.9em;">';
    html += '<thead><tr style="border-bottom:1px solid #444;">';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">TX Hash</th>';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">Token / Amount</th>';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">Action</th>';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">Failure Reason</th>';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">Queued</th>';
    html += '<th style="text-align:left; padding:0.5rem; color:#90caf9;">Controls</th>';
    html += '</tr></thead><tbody>';
    queue.forEach((entry, index) => {
      const tokenMeta = getTokenMetadata(entry.token);
      const queuedAgo = relativeTimeFrom(entry.queuedAt);
      html += '<tr style="border-bottom:1px solid #333;">';
      html += `<td style="padding:0.5rem; color:#90caf9;"><a href="https://etherscan.io/tx/${entry.txHash}" target="_blank" style="color:#90caf9;">${entry.txHash ? entry.txHash.slice(0, 16) + '...' : 'N/A'}</a></td>`;
      html += `<td style="padding:0.5rem; color:#e0e0e0;">${tokenMeta.symbol}<div style="color:#888;font-size:0.8em;">${formatTokenAmountDisplay(entry.amountWei || '0', entry.token)}</div></td>`;
      html += `<td style="padding:0.5rem; color:#e0e0e0;">${formatQueueAction(entry.action)}</td>`;
      html += `<td style="padding:0.5rem; color:#ff9800;">${entry.failureReason ? escapeHtml(entry.failureReason) : '—'}</td>`;
      html += `<td style="padding:0.5rem; color:#888;">${queuedAgo || 'just now'}</td>`;
      html += '<td style="padding:0.5rem;">';
      html += `<button class="copy-queue-entry-btn" data-queue-index="${index}" style="margin-bottom:0.35rem; padding:0.4rem; background:#2a2f3a; border:1px solid #444; border-radius:4px; color:#90caf9; cursor:pointer;">Copy Payload</button>`;
      html += `<button class="remove-queue-entry-btn" data-queue-index="${index}" style="padding:0.4rem; background:#d32f2f; border:none; border-radius:4px; color:#fff; cursor:pointer;">Remove</button>`;
      html += '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '</div>';
  }

  html += '</div></section>';
  return html;
}

function handleDepositStatusFilterChange() {
  const selected = Array.from(document.querySelectorAll('.deposit-status-checkbox'))
    .filter(cb => cb.checked)
    .map(cb => cb.value);
  state.depositRecovery.filters.statuses = selected.length > 0 ? selected : [...DEPOSIT_RECOVERY_DEFAULT_STATUSES];
  loadDepositRecoveryData();
}

function handleDepositTokenFilterChange(e) {
  state.depositRecovery.filters.token = (e.target.value || '').trim();
}

function getSelectedMasterAccountId() {
  return state.userSearch?.selectedUser?.user?._id || state.userSearch?.selectedUser?.user?._id || null;
}

function getDepositsForContext(context = 'user') {
  if (context === 'recovery') {
    return state.depositRecovery?.deposits || [];
  }
  return state.userSearch?.selectedUser?.deposits || [];
}

function getDepositFromContext(context, index) {
  const deposits = getDepositsForContext(context);
  if (typeof index !== 'number' || Number.isNaN(index)) return null;
  return deposits[index] || null;
}

async function handleDepositDiagnostics(event) {
  event.preventDefault();
  const btn = event.currentTarget;
  const index = parseInt(btn.dataset.index, 10);
  const context = btn.dataset.context || 'user';
  const deposit = getDepositFromContext(context, index);
  if (!deposit) {
    showNotification('Deposit not found for diagnostics', 'error');
    return;
  }
  if (!foundationContract) {
    await initializeContracts();
  }
  if (!foundationContract) {
    showNotification('Connect wallet to run on-chain diagnostics', 'error');
    return;
  }
  const userAddress = deposit.depositor_address || deposit.depositorAddress;
  const tokenAddress = deposit.token_address || deposit.tokenAddress;
  const txHash = deposit.deposit_tx_hash || deposit.confirmation_tx_hash;
  if (!userAddress || !tokenAddress || !txHash) {
    showNotification('Deposit is missing metadata required for diagnostics', 'error');
    return;
  }
  try {
    btn.disabled = true;
    btn.textContent = 'Checking...';
    const custodyKey = getCustodyKey(userAddress, tokenAddress);
    const packedAmount = await foundationContract.custody(custodyKey);
    const { userOwned, escrow } = splitCustodyAmount(packedAmount);
    state.depositDiagnostics[txHash] = {
      userOwned: userOwned.toString(),
      escrow: escrow.toString(),
      custodyKey,
      checkedAt: new Date().toISOString()
    };
    const tokenMeta = getTokenMetadata(tokenAddress);
    const hasBalance = userOwned > 0n || escrow > 0n;
    if (hasBalance) {
      showNotification(`Found ${formatTokenAmountDisplay(userOwned.toString(), tokenAddress)} unconfirmed on-chain`, 'success');
    } else {
      showNotification('No unconfirmed balance found on-chain (may already be confirmed or withdrawn)', 'info');
    }
  } catch (error) {
    console.error('[AdminDashboard] Deposit diagnostics failed', error);
    state.depositDiagnostics[txHash] = {
      error: error.message || 'Failed to read custody state',
      checkedAt: new Date().toISOString()
    };
    showNotification(`On-chain check failed: ${error.message || 'Unknown error'}`, 'error');
  } finally {
    btn.disabled = false;
    render();
  }
}

function handleQueueDeposit(event) {
  event.preventDefault();
  const btn = event.currentTarget;
  const index = parseInt(btn.dataset.index, 10);
  const context = btn.dataset.context || 'user';
  const deposit = getDepositFromContext(context, index);
  if (!deposit) {
    showNotification('Unable to queue deposit (deposit not found)', 'error');
    return;
  }
  const txHash = deposit.deposit_tx_hash || deposit.confirmation_tx_hash;
  if (!txHash) {
    showNotification('Deposit missing transaction hash', 'error');
    return;
  }
  // masterAccountId is optional for pending deposits (will be linked during confirmation)
  const fallbackMasterAccountId = context === 'user' ? getSelectedMasterAccountId() : null;
  const masterAccountId = deposit.master_account_id || fallbackMasterAccountId || null;
  const existing = state.depositFollowUpQueue?.find(entry => entry.txHash === txHash);
  if (existing) {
    showNotification('Deposit already queued', 'info');
    return;
  }
  const tokenAddress = deposit.token_address || deposit.tokenAddress;
  const entry = {
    txHash,
    masterAccountId,
    depositor: deposit.depositor_address || deposit.depositorAddress,
    token: tokenAddress,
    amountWei: deposit.deposit_amount_wei || '0',
    status: deposit.status,
    failureReason: deposit.failure_reason || deposit.failureReason || null,
    action: 'RECONFIRM',
    queuedAt: new Date().toISOString()
  };
  state.depositFollowUpQueue = [entry, ...(state.depositFollowUpQueue || [])];
  persistDepositQueue();
  showNotification('Deposit queued for manual follow-up', 'success');
  render();
}

function handleCopyDepositPayload(event) {
  event.preventDefault();
  const context = event.currentTarget.dataset.context || 'user';
  const index = parseInt(event.currentTarget.dataset.index, 10);
  const deposit = getDepositFromContext(context, index);
  if (!deposit) {
    showNotification('Deposit not found', 'error');
    return;
  }
  const fallbackMasterAccountId = context === 'user' ? getSelectedMasterAccountId() : null;
  const payload = buildDepositPayload(deposit, deposit.master_account_id || fallbackMasterAccountId);
  copyTextToClipboard(JSON.stringify(payload, null, 2));
  showNotification('Deposit payload copied', 'success');
}

function handleCopyQueueEntry(event) {
  event.preventDefault();
  const index = parseInt(event.currentTarget.dataset.queueIndex, 10);
  const queue = state.depositFollowUpQueue || [];
  const entry = queue[index];
  if (!entry) {
    showNotification('Queue entry not found', 'error');
    return;
  }
  copyTextToClipboard(JSON.stringify(entry, null, 2));
  showNotification('Queue entry copied', 'success');
}

function handleRemoveQueueEntry(event) {
  event.preventDefault();
  const index = parseInt(event.currentTarget.dataset.queueIndex, 10);
  if (Number.isNaN(index)) return;
  if (!Array.isArray(state.depositFollowUpQueue)) {
    state.depositFollowUpQueue = [];
    render();
    return;
  }
  state.depositFollowUpQueue.splice(index, 1);
  persistDepositQueue();
  showNotification('Queue entry removed', 'info');
  render();
}

function handleExportDepositQueue() {
  const queue = state.depositFollowUpQueue || [];
  if (queue.length === 0) {
    showNotification('Queue is empty', 'warning');
    return;
  }
  copyTextToClipboard(JSON.stringify(queue, null, 2));
  showNotification('Queue exported to clipboard', 'success');
}

function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(err => {
      console.error('Clipboard write failed', err);
    });
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      console.error('Fallback clipboard copy failed', err);
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

async function handleUserSearch() {
  const query = document.getElementById('user-search-input')?.value.trim();
  const type = document.getElementById('user-search-type')?.value || '';

  if (!query) {
    showNotification('Please enter a search query', 'warning');
    return;
  }

  state.userSearch.query = query;
  state.userSearch.loading = true;
  render();

  try {
    const wallet = currentAccount;
    const url = `/api/v1/admin/vaults/users/search?query=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}&wallet=${wallet}`;
    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Search failed');
    }

    const data = await response.json();
    state.userSearch.results = data.users || [];
    state.userSearch.loading = false;
    render();
  } catch (error) {
    console.error('Error searching users:', error);
    showNotification(`Search failed: ${error.message}`, 'error');
    state.userSearch.loading = false;
    render();
  }
}

async function loadUserDetails(masterAccountId) {
  try {
    const wallet = currentAccount;
    const response = await fetch(`/api/v1/admin/vaults/users/${masterAccountId}?wallet=${wallet}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to load user details');
    }

    const data = await response.json();
    state.userSearch.selectedUser = data;
    state.depositDiagnostics = {};
    render();
  } catch (error) {
    console.error('Error loading user details:', error);
    showNotification(`Failed to load user details: ${error.message}`, 'error');
  }
}

async function handleAdjustPoints(e) {
  e.preventDefault();
  const form = e.target;
  const masterAccountId = form.dataset.userId;
  const amountUsd = parseFloat(document.getElementById('adjust-amount-usd')?.value || '0');
  const points = parseFloat(document.getElementById('adjust-points')?.value || '0');
  const description = document.getElementById('adjust-description')?.value.trim();
  const reason = document.getElementById('adjust-reason')?.value.trim();

  if (!description) {
    showNotification('Description is required', 'warning');
    return;
  }

  if (amountUsd === 0 && points === 0) {
    showNotification('Please enter either an amount (USD) or points', 'warning');
    return;
  }

  try {
    const wallet = currentAccount;
    const response = await fetch(`/api/v1/admin/vaults/users/${masterAccountId}/adjust-points?wallet=${wallet}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountUsd: amountUsd || undefined, points: points || undefined, description, reason })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to adjust points');
    }

    const data = await response.json();
    showNotification(data.message || 'Points adjusted successfully', 'success');
    
    // Reload user details
    await loadUserDetails(masterAccountId);
    
    // Clear form
    form.reset();
  } catch (error) {
    console.error('Error adjusting points:', error);
    showNotification(`Failed to adjust points: ${error.message}`, 'error');
  }
}

async function handleSaveUserNotes(e) {
  const masterAccountId = e.target.dataset.userId;
  const note = document.getElementById('user-admin-note')?.value.trim();
  const flag = document.getElementById('user-admin-flag')?.value || null;

  try {
    const wallet = currentAccount;
    const response = await fetch(`/api/v1/admin/vaults/users/${masterAccountId}/notes?wallet=${wallet}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, flag })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to save notes');
    }

    showNotification('Notes/flags saved successfully', 'success');
    
    // Reload user details
    await loadUserDetails(masterAccountId);
  } catch (error) {
    console.error('Error saving notes:', error);
    showNotification(`Failed to save notes: ${error.message}`, 'error');
  }
}

// Adjust Points Modal for Accounts Table
function handleOpenAdjustPointsModal(e) {
  const masterAccountId = e.target.dataset.masterAccountId;
  const address = e.target.dataset.address;

  if (!masterAccountId) {
    showNotification('No account ID available for this address', 'error');
    return;
  }

  // Create modal if it doesn't exist
  let modal = document.getElementById('adjust-points-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'adjust-points-modal';
    modal.innerHTML = `
      <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000;">
        <div style="background: #2a2f3a; padding: 2rem; border-radius: 8px; max-width: 400px; width: 90%;">
          <h3 style="margin-top: 0; color: #90caf9;">Adjust Points</h3>
          <p id="modal-address" style="color: #888; font-family: monospace; margin-bottom: 1rem;"></p>
          <form id="modal-adjust-points-form">
            <input type="hidden" id="modal-master-account-id">
            <div style="margin-bottom: 1rem;">
              <label style="color: #e0e0e0; display: block; margin-bottom: 0.25rem;">Points to Add (negative to subtract)</label>
              <input type="number" id="modal-points" step="1" required placeholder="1000" style="width: 100%; padding: 0.5rem; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; color: #e0e0e0; box-sizing: border-box;">
            </div>
            <div style="margin-bottom: 1rem;">
              <label style="color: #e0e0e0; display: block; margin-bottom: 0.25rem;">Description *</label>
              <input type="text" id="modal-description" required placeholder="Reason for adjustment" style="width: 100%; padding: 0.5rem; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; color: #e0e0e0; box-sizing: border-box;">
            </div>
            <div style="display: flex; gap: 1rem; justify-content: flex-end;">
              <button type="button" id="modal-cancel" style="padding: 0.5rem 1rem; background: #444; border: none; border-radius: 4px; color: #e0e0e0; cursor: pointer;">Cancel</button>
              <button type="submit" style="padding: 0.5rem 1rem; background: #4caf50; border: none; border-radius: 4px; color: #fff; cursor: pointer;">Apply</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Cancel button
    document.getElementById('modal-cancel').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    // Form submit
    document.getElementById('modal-adjust-points-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const masterAccountId = document.getElementById('modal-master-account-id').value;
      const points = parseInt(document.getElementById('modal-points').value, 10);
      const description = document.getElementById('modal-description').value.trim();

      if (!description) {
        showNotification('Description is required', 'warning');
        return;
      }

      if (isNaN(points) || points === 0) {
        showNotification('Please enter a valid point value', 'warning');
        return;
      }

      try {
        const wallet = currentAccount;
        const response = await fetch(`/api/v1/admin/vaults/users/${masterAccountId}/adjust-points?wallet=${wallet}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points, description })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || 'Failed to adjust points');
        }

        const data = await response.json();
        showNotification(data.message || 'Points adjusted successfully', 'success');
        modal.style.display = 'none';

        // Reload data
        await loadBalances();
        render();
      } catch (error) {
        console.error('Error adjusting points:', error);
        showNotification(`Failed to adjust points: ${error.message}`, 'error');
      }
    });
  }

  // Populate and show modal
  document.getElementById('modal-master-account-id').value = masterAccountId;
  document.getElementById('modal-address').textContent = address;
  document.getElementById('modal-points').value = '';
  document.getElementById('modal-description').value = '';
  modal.style.display = 'block';
}

// Initial render
render();
