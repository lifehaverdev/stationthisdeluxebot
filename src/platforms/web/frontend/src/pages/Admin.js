import { Component, h, eventBus } from '@monygroupcorp/microact';
import { ethers } from 'ethers';
import { FloatingWalletButton, WalletService } from '@monygroupcorp/micro-web3';
import * as adminApi from '../lib/adminApi.js';
import { websocketClient } from '../lib/websocket.js';
import { VaultBalances } from '../components/admin/VaultBalances.js';
import { AccountsTable } from '../components/admin/AccountsTable.js';
import { AnalyticsCharts } from '../components/admin/AnalyticsCharts.js';
import { ActivityFeed } from '../components/admin/ActivityFeed.js';
import { UserSearch } from '../components/admin/UserSearch.js';
import { DepositRecovery } from '../components/admin/DepositRecovery.js';

const FOUNDATION_ADDRESS = '0x01152530028bd834EDbA9744885A882D025D84F6';
const FOUNDATION_ABI = ['function requestRescission(address token) external'];
const CHARTERED_FUND_ABI = ['function requestRescission(address token) external'];
const MILADY_STATION_ADDRESS = '0xB24BaB1732D34cAD0A7C7035C3539aEC553bF3a0';
const ERC721A_ABI = ['function ownerOf(uint256 tokenId) view returns (address)'];
const ADMIN_TOKEN_ID = 598;
const MAINNET_CHAIN_ID = 1;

export class Admin extends Component {
  constructor(props) {
    super(props);
    this.walletService = new WalletService(eventBus);
    this.state = {
      verified: false,
      verifying: false,
      verifyError: null,
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
      // Withdrawal: confirmation → in-flight tracking
      pendingWithdrawal: null, // { tokenAddress, vaultAddress, amount, symbol, decimals }
      withdrawalTx: null,      // { status: 'submitting'|'mining'|'done'|'error', hash, error }
      // Inline points adjustment panel
      adjustPoints: null,      // { masterAccountId, address, points, description, submitting, error }
    };
  }

  didMount() {
    eventBus.on('wallet:connected', ({ address, provider: rawProvider, signer }) => {
      this.verifyAdmin(address, rawProvider, signer);
    });
    if (this.walletService.isConnected?.()) {
      const address = this.walletService.getAddress?.();
      const signer = this.walletService.getSigner?.();
      const rawProvider = this.walletService.getProvider?.();
      if (address) this.verifyAdmin(address, rawProvider, signer);
    }
  }

  async verifyAdmin(address, rawProvider, signer) {
    this.setState({ verifying: true, verifyError: null });
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== MAINNET_CHAIN_ID) {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x1' }],
        });
      }
      const contract = new ethers.Contract(MILADY_STATION_ADDRESS, ERC721A_ABI, provider);
      const owner = await contract.ownerOf(ADMIN_TOKEN_ID);
      if (owner.toLowerCase() !== address.toLowerCase()) {
        this.setState({ verifying: false, verifyError: 'Not authorized: wallet does not own miladystation #598' });
        return;
      }
      const resolvedSigner = signer || await provider.getSigner();
      this.setState({ verified: true, verifying: false, verifyError: null, wallet: address, provider, signer: resolvedSigner, loading: true });
      await this.loadDashboard(address, provider, resolvedSigner);
      this.setupActivityFeed(address);
    } catch (e) {
      this.setState({ verifying: false, verifyError: 'Error verifying admin: ' + e.message });
    }
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

  // ── Withdrawal ────────────────────────────────────────────────────────────

  handleWithdraw(tokenAddress, vaultAddress, amount, symbol, decimals) {
    this.setState({ pendingWithdrawal: { tokenAddress, vaultAddress, amount, symbol, decimals } });
  }

  async _confirmWithdraw() {
    const { signer, pendingWithdrawal: w } = this.state;
    if (!signer || !w) return;
    this.setState({ pendingWithdrawal: null, withdrawalTx: { status: 'submitting', hash: null, error: null } });
    try {
      const contract = w.vaultAddress.toLowerCase() === FOUNDATION_ADDRESS.toLowerCase()
        ? new ethers.Contract(FOUNDATION_ADDRESS, FOUNDATION_ABI, signer)
        : new ethers.Contract(w.vaultAddress, CHARTERED_FUND_ABI, signer);

      const tx = await contract.requestRescission(w.tokenAddress);
      this.setState({ withdrawalTx: { status: 'mining', hash: tx.hash, error: null } });
      await tx.wait();
      this.setState({ withdrawalTx: { status: 'done', hash: tx.hash, error: null } });
      await this.loadDashboard();
      setTimeout(() => this.setState({ withdrawalTx: null }), 10000);
    } catch (err) {
      this.setState({ withdrawalTx: { status: 'error', hash: null, error: err.message } });
    }
  }

  // ── Points adjustment ─────────────────────────────────────────────────────

  handleAdjustPoints(masterAccountId, address) {
    this.setState({ adjustPoints: { masterAccountId, address, points: '', description: '', submitting: false, error: null } });
  }

  async _submitAdjustPoints() {
    const { wallet, adjustPoints: ap } = this.state;
    if (!ap) return;
    const pts = parseInt(ap.points, 10);
    if (isNaN(pts) || !ap.description.trim()) return;
    this.setState({ adjustPoints: { ...ap, submitting: true, error: null } });
    try {
      await adminApi.adjustUserPoints(wallet, ap.masterAccountId, {
        points: pts,
        description: ap.description.trim(),
        walletAddress: ap.address
      });
      this.setState({ adjustPoints: null });
      await this.loadDashboard();
    } catch (err) {
      this.setState({ adjustPoints: { ...this.state.adjustPoints, submitting: false, error: err.message } });
    }
  }

  // ── Styles ────────────────────────────────────────────────────────────────

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
      /* Shared banner style for confirmations + tx status */
      .admin-banner {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        margin-bottom: 1rem;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-secondary);
      }
      .admin-banner.danger {
        background: rgba(255,75,75,0.08);
        border: var(--border-width) solid rgba(255,75,75,0.35);
      }
      .admin-banner.info {
        background: rgba(144,202,249,0.06);
        border: var(--border-width) solid rgba(144,202,249,0.25);
        color: #90caf9;
      }
      .admin-banner.success {
        background: rgba(76,175,80,0.08);
        border: var(--border-width) solid rgba(76,175,80,0.3);
        color: #4caf50;
      }
      .admin-banner a { color: inherit; opacity: 0.75; }
      .admin-banner a:hover { opacity: 1; }
      .admin-banner button {
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
        flex-shrink: 0;
      }
      .admin-banner button:hover { color: var(--text-secondary); border-color: var(--border-hover); }
      .admin-banner button:disabled { opacity: 0.4; cursor: default; }
      .admin-banner button.danger { color: var(--danger); border-color: rgba(255,75,75,0.35); }
      .admin-banner button.danger:hover { border-color: var(--danger); }
      /* Inline points adjustment panel */
      .admin-adjust-panel {
        padding: 12px 14px;
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        margin-bottom: 1rem;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
      }
      .admin-adjust-panel .panel-title {
        color: var(--text-label);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        margin-bottom: 10px;
      }
      .admin-adjust-panel .panel-addr {
        color: var(--accent);
        margin-bottom: 10px;
      }
      .admin-adjust-panel .panel-row {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
      }
      .admin-adjust-panel label {
        color: var(--text-label);
        min-width: 80px;
        flex-shrink: 0;
      }
      .admin-adjust-panel input, .admin-adjust-panel textarea {
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        color: var(--text-primary);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        padding: 4px 8px;
        flex: 1;
        outline: none;
      }
      .admin-adjust-panel input:focus, .admin-adjust-panel textarea:focus {
        border-color: var(--accent);
      }
      .admin-adjust-panel textarea { resize: vertical; min-height: 48px; }
      .admin-adjust-panel .panel-actions { display: flex; gap: 8px; margin-top: 4px; }
      .admin-adjust-panel .panel-error { color: var(--danger); margin-top: 6px; }
    `;
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  _renderWithdrawalConfirm() {
    const { pendingWithdrawal: w } = this.state;
    if (!w) return null;
    return h('div', { className: 'admin-banner danger' },
      h('span', null, `Withdraw ${w.symbol} from ${w.vaultAddress.toLowerCase() === FOUNDATION_ADDRESS.toLowerCase() ? 'Foundation' : 'vault'}? This sends requestRescission on-chain.`),
      h('button', { className: 'danger', onClick: this.bind(this._confirmWithdraw) }, 'Confirm'),
      h('button', { onClick: () => this.setState({ pendingWithdrawal: null }) }, 'Cancel'),
    );
  }

  _renderWithdrawalTx() {
    const { withdrawalTx: tx } = this.state;
    if (!tx) return null;
    const etherscanBase = 'https://etherscan.io/tx/';
    if (tx.status === 'submitting') {
      return h('div', { className: 'admin-banner info' }, 'Waiting for wallet signature...');
    }
    if (tx.status === 'mining') {
      return h('div', { className: 'admin-banner info' },
        'Mining — ',
        h('a', { href: etherscanBase + tx.hash, target: '_blank' }, tx.hash.slice(0, 18) + '...')
      );
    }
    if (tx.status === 'done') {
      return h('div', { className: 'admin-banner success' },
        'Rescission requested — ',
        h('a', { href: etherscanBase + tx.hash, target: '_blank' }, tx.hash.slice(0, 18) + '...'),
        h('span', null, ' · Server will execute shortly'),
        h('button', { onClick: () => this.setState({ withdrawalTx: null }) }, 'Dismiss'),
      );
    }
    if (tx.status === 'error') {
      return h('div', { className: 'admin-banner danger' },
        'Withdrawal failed: ' + tx.error,
        h('button', { onClick: () => this.setState({ withdrawalTx: null }) }, 'Dismiss'),
      );
    }
    return null;
  }

  _renderAdjustPanel() {
    const { adjustPoints: ap } = this.state;
    if (!ap) return null;
    return h('div', { className: 'admin-adjust-panel' },
      h('div', { className: 'panel-title' }, 'Adjust Points'),
      h('div', { className: 'panel-addr' }, ap.address),
      h('div', { className: 'panel-row' },
        h('label', null, 'Points'),
        h('input', {
          type: 'number',
          placeholder: '+100 or -50',
          value: ap.points,
          onInput: e => this.setState({ adjustPoints: { ...ap, points: e.target.value } }),
          disabled: ap.submitting,
          autofocus: true,
        }),
      ),
      h('div', { className: 'panel-row' },
        h('label', null, 'Reason'),
        h('textarea', {
          placeholder: 'Brief description...',
          value: ap.description,
          onInput: e => this.setState({ adjustPoints: { ...ap, description: e.target.value } }),
          disabled: ap.submitting,
        }),
      ),
      h('div', { className: 'panel-actions' },
        h('button', {
          className: 'danger',
          onClick: this.bind(this._submitAdjustPoints),
          disabled: ap.submitting || !ap.points || !ap.description.trim(),
        }, ap.submitting ? 'Submitting...' : 'Apply'),
        h('button', { onClick: () => this.setState({ adjustPoints: null }), disabled: ap.submitting }, 'Cancel'),
      ),
      ap.error ? h('div', { className: 'panel-error' }, ap.error) : null,
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    const {
      verified, verifying, verifyError,
      wallet, loading, error,
      balances, accounts, freePoints,
      analytics, withdrawalAnalytics,
      depositRecovery, activityFeed, alerts,
    } = this.state;

    return h('div', { className: 'admin-page' },
      h(FloatingWalletButton, { walletService: this.walletService }),

      h('h1', null, 'Admin Dashboard'),

      verifying ? h('div', { className: 'admin-loading' }, 'Verifying admin...') : null,
      verifyError ? h('div', { className: 'admin-error' }, verifyError) : null,
      !verified && !verifying && !verifyError ? h('div', { className: 'admin-loading' }, 'Connect wallet to continue.') : null,

      verified ? h('div', null,
        error ? h('div', { className: 'admin-error' }, error) : null,

        this._renderWithdrawalConfirm(),
        this._renderWithdrawalTx(),
        this._renderAdjustPanel(),

        loading
          ? h('div', { className: 'admin-loading' }, 'Loading dashboard...')
          : h('div', null,
              freePoints != null
                ? h('div', { className: 'admin-free-points' },
                    h('span', null, 'Circulating free points:'),
                    h('span', { className: 'admin-free-points-val' },
                      typeof freePoints === 'object'
                        ? (freePoints.summary?.totalPointsCredited ?? freePoints.total ?? freePoints.totalFreePoints ?? JSON.stringify(freePoints))
                        : freePoints
                    ),
                  )
                : null,

              h(DepositRecovery, {
                deposits: depositRecovery.deposits,
                metrics: depositRecovery.metrics,
                loading: depositRecovery.loading,
                error: depositRecovery.error,
                onRefresh: () => this.loadDepositRecovery()
              }),

              h(VaultBalances, {
                balances,
                onWithdraw: this.bind(this.handleWithdraw)
              }),

              h(AccountsTable, {
                accounts,
                onAdjustPoints: this.bind(this.handleAdjustPoints)
              }),

              h(AnalyticsCharts, {
                analytics,
                withdrawalAnalytics
              }),

              h(UserSearch, { wallet }),

              h(ActivityFeed, {
                activities: activityFeed,
                alerts
              })
            )
      ) : null
    );
  }
}
