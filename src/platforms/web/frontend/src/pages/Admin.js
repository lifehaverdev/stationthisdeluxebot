import { Component, h, eventBus } from '@monygroupcorp/microact';
import { ethers } from 'ethers';
import { FloatingWalletButton, WalletService } from '@monygroupcorp/micro-web3';
import * as adminApi from '../lib/adminApi.js';
import { PLHero } from '../components/admin/PLHero.js';
import { AnalyticsCharts } from '../components/admin/AnalyticsCharts.js';
import { CreatorActivity } from '../components/admin/CreatorActivity.js';
import { DepositsTable } from '../components/admin/DepositsTable.js';
import { CostManager } from '../components/admin/CostManager.js';
import { UserSearch } from '../components/admin/UserSearch.js';

const MILADY_STATION_ADDRESS = '0xB24BaB1732D34cAD0A7c7035C3539aEC553bF3a0';
const ERC721A_ABI = ['function ownerOf(uint256 tokenId) view returns (address)'];
const ADMIN_TOKEN_ID = 598;
const MAINNET_CHAIN_ID = 1;

const NAV_ITEMS = [
  { href: '#pl', label: 'P&L' },
  { href: '#activity', label: 'Activity' },
  { href: '#creators', label: 'Creators' },
  { href: '#deposits', label: 'Deposits' },
  { href: '#costs', label: 'Costs' },
  { href: '#users', label: 'Users' },
];

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
      accounting: null,
      analytics: null,
      creatorStats: null,
      expenditure: null,
      accounts: null,
      costs: null,
      costTotals: null,
      freePoints: null,
      vaultBalance: null,
      period: 'mtd',
      dateRange: {
        period: 'daily',
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date()
      },
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
      await this.loadDashboard(address);
    } catch (e) {
      this.setState({ verifying: false, verifyError: 'Error verifying admin: ' + e.message });
    }
  }

  _getDateRangeForPeriod(period) {
    const now = new Date();
    let startDate;
    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case '7d':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'mtd':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      default:
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }
    return { period: 'daily', startDate, endDate: now };
  }

  async loadDashboard(wallet) {
    wallet = wallet || this.state.wallet;
    if (!wallet) return;

    this.setState({ loading: true, error: null });
    const dateRange = this._getDateRangeForPeriod(this.state.period);

    try {
      const [
        accounting,
        analytics,
        creatorStats,
        expenditure,
        accountsData,
        costsData,
        costTotals,
        freePoints,
        balances,
      ] = await Promise.all([
        adminApi.fetchAccounting(wallet, this.state.period, dateRange),
        adminApi.fetchAnalytics(wallet, dateRange),
        adminApi.fetchCreatorStats(wallet),
        adminApi.fetchExpenditure(wallet, dateRange),
        adminApi.fetchAccounts(wallet),
        adminApi.fetchCosts(wallet),
        adminApi.fetchCostTotals(wallet),
        adminApi.fetchFreePoints(wallet),
        adminApi.fetchVaultBalances(wallet).catch(() => null),
      ]);

      // Extract vault balance from balances response
      let vaultBalance = null;
      if (balances?.vaults) {
        // Sum all vault balances in USD
        vaultBalance = 0;
        for (const vault of Object.values(balances.vaults)) {
          for (const token of Object.values(vault.tokens || {})) {
            vaultBalance += parseFloat(token.usdValue || 0);
          }
        }
      }

      this.setState({
        accounting,
        analytics,
        creatorStats,
        expenditure,
        accounts: accountsData?.accounts || [],
        costs: costsData?.costs || [],
        costTotals: costTotals?.totals || [],
        freePoints,
        vaultBalance,
        loading: false,
        dateRange,
      });
    } catch (err) {
      this.setState({ error: err.message, loading: false });
    }
  }

  async handlePeriodChange(period) {
    this.setState({ period });
    const dateRange = this._getDateRangeForPeriod(period);
    const wallet = this.state.wallet;

    try {
      const [accounting, analytics] = await Promise.all([
        adminApi.fetchAccounting(wallet, period, dateRange),
        adminApi.fetchAnalytics(wallet, dateRange),
      ]);
      this.setState({ accounting, analytics, dateRange });
    } catch (err) {
      this.setState({ error: err.message });
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
      .admin-nav {
        display: flex;
        gap: 1rem;
        padding: 0.5rem 0;
        margin-bottom: 1rem;
        position: sticky;
        top: 0;
        background: var(--surface-1);
        z-index: 10;
        border-bottom: var(--border-width) solid var(--border);
      }
      .admin-nav a {
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        text-decoration: none;
        padding: 4px 8px;
        transition: color var(--dur-micro) var(--ease);
      }
      .admin-nav a:hover { color: var(--accent); }
      /* Shared banner style for confirmations */
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
      .admin-banner.info {
        background: rgba(144,202,249,0.06);
        border: var(--border-width) solid rgba(144,202,249,0.25);
        color: var(--accent);
      }
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
    `;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    const {
      verified, verifying, verifyError,
      wallet, loading, error,
      accounting, analytics, creatorStats, expenditure,
      accounts, costs, costTotals, freePoints, vaultBalance, period,
    } = this.state;

    return h('div', { className: 'admin-page' },
      h(FloatingWalletButton, { walletService: this.walletService }),

      h('h1', null, 'Admin Dashboard'),

      verifying ? h('div', { className: 'admin-loading' }, 'Verifying admin...') : null,
      verifyError ? h('div', { className: 'admin-error' }, verifyError) : null,
      !verified && !verifying && !verifyError ? h('div', { className: 'admin-loading' }, 'Connect wallet to continue.') : null,

      verified ? h('div', null,
        error ? h('div', { className: 'admin-error' }, error) : null,

        // Section nav
        h('nav', { className: 'admin-nav' },
          ...NAV_ITEMS.map(item =>
            h('a', {
              href: item.href,
              key: item.href,
              onClick: e => {
                e.preventDefault();
                const el = document.querySelector(item.href);
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              },
            }, item.label)
          )
        ),

        loading
          ? h('div', { className: 'admin-loading' }, 'Loading dashboard...')
          : h('div', null,
              // Free points summary
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

              // 1. P&L Hero
              h(PLHero, {
                accounting,
                period,
                onPeriodChange: this.bind(this.handlePeriodChange),
                vaultBalance,
              }),

              // 2. Analytics Charts
              h(AnalyticsCharts, { analytics }),

              // 3. Creator Activity
              h(CreatorActivity, { creatorStats }),

              // 4. Deposits Table
              h(DepositsTable, { deposits: accounts }),

              // 5. Cost Manager
              h(CostManager, {
                costs,
                costTotals,
                expenditure,
                wallet,
                onCostAdded: () => this.loadDashboard(),
              }),

              // 6. User Search
              h(UserSearch, { wallet }),
            )
      ) : null
    );
  }
}
