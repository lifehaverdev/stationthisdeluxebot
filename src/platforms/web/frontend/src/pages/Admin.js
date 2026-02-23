import { Component, h } from '@monygroupcorp/microact';
import { ethers } from 'ethers';
import * as adminApi from '../lib/adminApi.js';
import { websocketClient } from '../lib/websocket.js';
import { WalletGate } from '../components/admin/WalletGate.js';
import { VaultBalances } from '../components/admin/VaultBalances.js';
import { AccountsTable } from '../components/admin/AccountsTable.js';
import { AnalyticsCharts } from '../components/admin/AnalyticsCharts.js';
import { ActivityFeed } from '../components/admin/ActivityFeed.js';
import { UserSearch } from '../components/admin/UserSearch.js';
import { DepositRecovery } from '../components/admin/DepositRecovery.js';

const FOUNDATION_ADDRESS = '0x01152530028bd834EDbA9744885A882D025D84F6';
const FOUNDATION_ABI = ['function requestRescission(address token) external'];
const CHARTERED_FUND_ABI = ['function requestRescission(address token) external'];

export class Admin extends Component {
  constructor(props) {
    super(props);
    this.state = {
      verified: false,
      wallet: null,
      provider: null,
      signer: null,
      loading: false,
      error: null,
      // Data
      balances: null,
      accounts: null,
      freePoints: null,
      analytics: null,
      withdrawalAnalytics: null,
      costs: null,
      costTotals: null,
      depositRecovery: { deposits: [], metrics: null, loading: false, error: null },
      activityFeed: [],
      alerts: [],
      dateRange: {
        period: 'daily',
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date()
      },
      // Withdrawal confirmation state: { tokenAddress, vaultAddress, amount, symbol, decimals } | null
      pendingWithdrawal: null,
    };
  }

  async onVerified(account, provider, signer) {
    this.setState({ verified: true, wallet: account, provider, signer });
    await this.loadDashboard(account, provider, signer);
    this.setupActivityFeed(account);
  }

  async loadDashboard(wallet, provider, signer) {
    wallet = wallet || this.state.wallet;
    if (!wallet) return;

    this.setState({ loading: true, error: null });

    try {
      const [balances, requestsData, accountsData, freePoints, analytics, withdrawalAnalytics, costsData, costTotals] = await Promise.all([
        adminApi.fetchVaultBalances(wallet),
        adminApi.fetchWithdrawalRequests(wallet),
        adminApi.fetchAccounts(wallet),
        adminApi.fetchFreePoints(wallet),
        adminApi.fetchAnalytics(wallet, this.state.dateRange),
        adminApi.fetchWithdrawalAnalytics(wallet, this.state.dateRange),
        adminApi.fetchCosts(wallet),
        adminApi.fetchCostTotals(wallet),
      ]);

      this.setState({
        balances,
        accounts: accountsData?.accounts || [],
        freePoints,
        analytics,
        withdrawalAnalytics,
        costs: costsData?.costs || [],
        costTotals: costTotals?.totals || [],
        loading: false
      });

      // Load deposit recovery separately (non-blocking)
      this.loadDepositRecovery(wallet);
    } catch (err) {
      this.setState({ error: err.message, loading: false });
    }
  }

  async loadDepositRecovery(wallet) {
    wallet = wallet || this.state.wallet;
    this.setState({ depositRecovery: { ...this.state.depositRecovery, loading: true, error: null } });
    try {
      const data = await adminApi.fetchPendingDeposits(wallet);
      this.setState({
        depositRecovery: {
          deposits: data.deposits || [],
          metrics: data.metrics || null,
          loading: false,
          error: null
        }
      });
    } catch (err) {
      this.setState({
        depositRecovery: { ...this.state.depositRecovery, loading: false, error: err.message }
      });
    }
  }

  setupActivityFeed(wallet) {
    websocketClient.connect();
    websocketClient.on('adminActivity', (payload) => {
      const activity = { ...payload, id: Date.now() + Math.random(), receivedAt: new Date() };
      const feed = [activity, ...this.state.activityFeed].slice(0, 100);
      const updates = { activityFeed: feed };

      if (payload.eventType === 'alert') {
        updates.alerts = [activity, ...this.state.alerts].slice(0, 50);
      }
      this.setState(updates);
    });
  }

  handleWithdraw(tokenAddress, vaultAddress, amount, symbol, decimals) {
    // Show inline confirmation instead of browser confirm()
    this.setState({ pendingWithdrawal: { tokenAddress, vaultAddress, amount, symbol, decimals } });
  }

  async _confirmWithdraw() {
    const { signer, pendingWithdrawal: w } = this.state;
    if (!signer || !w) return;
    this.setState({ pendingWithdrawal: null });
    try {
      let contract;
      if (w.vaultAddress.toLowerCase() === FOUNDATION_ADDRESS.toLowerCase()) {
        contract = new ethers.Contract(FOUNDATION_ADDRESS, FOUNDATION_ABI, signer);
      } else {
        contract = new ethers.Contract(w.vaultAddress, CHARTERED_FUND_ABI, signer);
      }
      const tx = await contract.requestRescission(w.tokenAddress);
      await tx.wait();
      await this.loadDashboard();
    } catch (err) {
      this.setState({ error: 'Withdrawal failed: ' + err.message });
    }
  }

  handleAdjustPoints(masterAccountId, address) {
    const points = prompt(`Points to add/subtract for ${address}:`);
    if (!points) return;
    const description = prompt('Reason:');
    if (!description) return;
    adminApi.adjustUserPoints(this.state.wallet, masterAccountId, {
      points: parseInt(points, 10),
      description,
      walletAddress: address
    }).then(() => this.loadDashboard()).catch(err => this.setState({ error: err.message }));
  }

  static get styles() {
    return `
      .admin-page {
        max-width: 1200px;
        margin: 0 auto;
        padding: 1rem;
        color: var(--text-primary);
        font-family: var(--ff-sans);
      }
      .admin-page h1 {
        color: var(--text-primary);
        text-align: center;
        margin-bottom: 1.5rem;
        font-family: var(--ff-display);
        font-size: 1.5rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .admin-loading {
        text-align: center;
        color: var(--accent);
        padding: 2rem;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
      }
      .admin-error {
        background: rgba(255,75,75,0.08);
        border: var(--border-width) solid rgba(255,75,75,0.35);
        color: var(--danger);
        padding: 0.75rem;
        margin-bottom: 1rem;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
      }
      .admin-free-points {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        margin-bottom: 1rem;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        color: var(--text-label);
      }
      .admin-free-points-val {
        color: var(--accent);
        font-weight: 600;
      }
      .admin-confirm-banner {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        background: rgba(255,75,75,0.08);
        border: var(--border-width) solid rgba(255,75,75,0.35);
        margin-bottom: 1rem;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-secondary);
      }
      .admin-confirm-banner button {
        background: none;
        border: var(--border-width) solid var(--border);
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        cursor: pointer;
        padding: 3px 10px;
        transition: color var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease);
      }
      .admin-confirm-banner button:hover { color: var(--text-secondary); border-color: var(--border-hover); }
      .admin-confirm-banner button.danger { color: var(--danger); border-color: rgba(255,75,75,0.35); }
      .admin-confirm-banner button.danger:hover { border-color: var(--danger); }
    `;
  }

  render() {
    const { verified, wallet, loading, error, balances, accounts, freePoints, analytics, withdrawalAnalytics, depositRecovery, activityFeed, alerts, pendingWithdrawal } = this.state;

    return h('div', { className: 'admin-page' },
      h('h1', null, 'Admin Dashboard'),

      // Wallet gate
      h(WalletGate, { onVerified: this.bind(this.onVerified) }),

      // Dashboard content (only after verification)
      verified ? h('div', null,
        error ? h('div', { className: 'admin-error' }, error) : null,

        // Inline withdrawal confirmation
        pendingWithdrawal
          ? h('div', { className: 'admin-confirm-banner' },
              h('span', null, `Confirm withdrawal of ${pendingWithdrawal.symbol} from vault?`),
              h('button', { className: 'danger', onclick: this.bind(this._confirmWithdraw) }, 'Confirm'),
              h('button', { onclick: () => this.setState({ pendingWithdrawal: null }) }, 'Cancel'),
            )
          : null,

        loading
          ? h('div', { className: 'admin-loading' }, 'Loading dashboard...')
          : h('div', null,
              // Free points summary
              freePoints != null
                ? h('div', { className: 'admin-free-points' },
                    h('span', null, 'Circulating free points:'),
                    h('span', { className: 'admin-free-points-val' },
                      typeof freePoints === 'object'
                        ? (freePoints.total ?? freePoints.totalFreePoints ?? JSON.stringify(freePoints))
                        : freePoints
                    ),
                  )
                : null,

              // Deposit recovery
              h(DepositRecovery, {
                deposits: depositRecovery.deposits,
                metrics: depositRecovery.metrics,
                loading: depositRecovery.loading,
                error: depositRecovery.error,
                onRefresh: () => this.loadDepositRecovery()
              }),

              // Vault balances
              h(VaultBalances, {
                balances,
                onWithdraw: this.bind(this.handleWithdraw)
              }),

              // Accounts table
              h(AccountsTable, {
                accounts,
                onAdjustPoints: this.bind(this.handleAdjustPoints)
              }),

              // Analytics charts
              h(AnalyticsCharts, {
                analytics,
                withdrawalAnalytics
              }),

              // User search
              h(UserSearch, { wallet }),

              // Activity feed
              h(ActivityFeed, {
                activities: activityFeed,
                alerts
              })
            )
      ) : null
    );
  }
}
