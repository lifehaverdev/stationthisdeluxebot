import { Component, h } from '@monygroupcorp/microact';
import { subscribe, getTotalWorkspaceCost, dispatch } from '../store.js';
import { fetchJson } from '../../lib/api.js';

const DENOMINATIONS = ['POINTS', 'MS2', 'USD', 'CULT'];
const FALLBACK_RATES = { POINTS_per_USD: 2967, MS2_per_USD: 2, CULT_per_USD: 50 };
const RATES_CACHE_KEY = 'exchangeRatesCache';
const DENOM_KEY = 'costDenom';
const RATES_TTL = 60 * 60 * 1000; // 1h

export class CostHUD extends Component {
  constructor(props) {
    super(props);
    const saved = localStorage.getItem(DENOM_KEY);
    this.state = {
      denomination: DENOMINATIONS.includes(saved) ? saved : 'POINTS',
      rates: this._loadCachedRates() || FALLBACK_RATES,
      totals: { usd: 0, points: 0, ms2: 0, cult: 0 }
    };
  }

  didMount() {
    this.registerCleanup(subscribe('costs', () => {
      this.setState({ totals: getTotalWorkspaceCost() });
    }));
    this.setState({ totals: getTotalWorkspaceCost() });
    this._fetchRates();
    this._ratesInterval = this.setInterval(() => this._fetchRates(), RATES_TTL);
  }

  _loadCachedRates() {
    try {
      const raw = localStorage.getItem(RATES_CACHE_KEY);
      if (!raw) return null;
      const { timestamp, rates } = JSON.parse(raw);
      if (Date.now() - timestamp < RATES_TTL) return rates;
    } catch {}
    return null;
  }

  async _fetchRates() {
    try {
      const data = await fetchJson('/api/external/economy/rates');
      const rates = data.data || data;
      this.setState({ rates });
      try { localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), rates })); } catch {}
    } catch {
      // keep existing rates
    }
  }

  _convert(usd, denom) {
    const r = this.state.rates;
    if (!r) return 0;
    switch (denom) {
      case 'USD': return usd;
      case 'POINTS': return usd * (r.POINTS_per_USD || 2967);
      case 'MS2': return usd * (r.MS2_per_USD || 2);
      case 'CULT': return usd * (r.CULT_per_USD || 50);
      default: return usd;
    }
  }

  _format(amount, denom) {
    if (amount === 0) return '0';
    switch (denom) {
      case 'USD': return `$${amount.toFixed(2)}`;
      case 'POINTS': return `${Math.round(amount)} POINTS`;
      case 'MS2': return `${amount.toFixed(2)} MS2`;
      case 'CULT': return `${Math.round(amount)} CULT`;
      default: return `${amount.toFixed(2)}`;
    }
  }

  _cycle() {
    const i = DENOMINATIONS.indexOf(this.state.denomination);
    const next = DENOMINATIONS[(i + 1) % DENOMINATIONS.length];
    localStorage.setItem(DENOM_KEY, next);
    this.setState({ denomination: next });
  }

  _reset(e) {
    e.stopPropagation();
    if (confirm('Reset all costs?')) dispatch('RESET_ALL_COSTS');
  }

  static get styles() {
    return `
      .cost-hud {
        position: fixed; top: 80px; right: 20px; z-index: 90;
        background: rgba(0,0,0,0.9); border: 1px solid #333; border-radius: 8px;
        padding: 12px 16px; color: #fff; font-size: 14px; min-width: 150px;
        backdrop-filter: blur(10px); box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        cursor: pointer; transition: all 0.2s ease;
      }
      .cost-hud:hover { background: rgba(0,0,0,0.95); border-color: #555; }
      .cost-hud-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .cost-hud-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #888; }
      .cost-hud-reset { background: none; border: none; color: #888; cursor: pointer; font-size: 16px; padding: 2px 4px; border-radius: 3px; }
      .cost-hud-reset:hover { color: #fff; background: rgba(255,255,255,0.1); }
      .cost-hud-amount { font-size: 18px; font-weight: 700; line-height: 1.2; }
      .cost-hud-details { font-size: 11px; color: #888; line-height: 1.3; }
    `;
  }

  render() {
    const { denomination, totals } = this.state;
    const usd = totals.usd || 0;
    const main = this._format(this._convert(usd, denomination), denomination);
    const others = DENOMINATIONS
      .filter(d => d !== denomination)
      .map(d => this._format(this._convert(usd, d), d))
      .join(' | ');

    return h('div', { className: 'cost-hud', onclick: this.bind(this._cycle) },
      h('div', { className: 'cost-hud-header' },
        h('span', { className: 'cost-hud-title' }, 'TOTAL COST'),
        h('button', { className: 'cost-hud-reset', title: 'Reset all costs', onclick: this.bind(this._reset) }, '\u21BB')
      ),
      h('div', { className: 'cost-hud-amount' }, main),
      h('div', { className: 'cost-hud-details' }, others || 'No costs yet')
    );
  }
}
