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
    this.registerCleanup(subscribe('costs', (totals) => {
      this.setState({ totals });
    }));
    this.setState({ totals: getTotalWorkspaceCost() });
    this._fetchRates();
    this._ratesInterval = this.setInterval(() => this._fetchRates(), RATES_TTL);

    // Stay in sync with per-window CostDisplay denomination toggles
    this._onDenomChange = (e) => {
      if (e.detail?.denomination && e.detail.denomination !== this.state.denomination) {
        localStorage.setItem(DENOM_KEY, e.detail.denomination);
        this.setState({ denomination: e.detail.denomination });
      }
    };
    window.addEventListener('denominationChange', this._onDenomChange);
    this.registerCleanup(() => window.removeEventListener('denominationChange', this._onDenomChange));
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
    window.dispatchEvent(new CustomEvent('denominationChange', { detail: { denomination: next } }));
  }

  _reset(e) {
    e.stopPropagation();
    if (confirm('Reset all costs?')) dispatch('RESET_ALL_COSTS');
  }

  static get styles() {
    return `
      .hud-root {
        position: fixed;
        bottom: 16px;
        left: 16px;
        z-index: var(--z-hud);
        display: flex;
        flex-direction: column;
        gap: 6px;
        pointer-events: none;
      }

      .hud-panel {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 6px 10px;
        display: flex;
        align-items: center;
        gap: 8px;
        pointer-events: auto;
        cursor: pointer;
        position: relative;
        transition: border-color var(--dur-micro) var(--ease);
      }
      .hud-panel:hover { border-color: var(--border-hover); }

      /* Top-left corner bracket */
      .hud-panel::before {
        content: '';
        position: absolute;
        top: -1px; left: -1px;
        width: 6px; height: 6px;
        border: 1px solid var(--border-hover);
        border-right: none;
        border-bottom: none;
      }

      .hud-label {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        flex-shrink: 0;
      }

      .hud-value {
        font-family: var(--ff-mono);
        font-size: var(--fs-sm);
        color: var(--text-primary);
        font-weight: var(--fw-medium);
      }

      .hud-unit {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        text-transform: uppercase;
        letter-spacing: var(--ls-wide);
      }

      .hud-reset {
        background: none;
        border: none;
        color: var(--text-label);
        cursor: pointer;
        font-size: 16px;
        padding: 0;
        margin-left: auto;
        line-height: 1;
        transition: color var(--dur-micro) var(--ease);
      }
      .hud-reset:hover { color: var(--danger); }
    `;
  }

  render() {
    const { denomination, totals } = this.state;
    const usd = totals.usd || 0;
    const main = this._format(this._convert(usd, denomination), denomination);

    return h('div', { className: 'hud-root' },
      h('div', { className: 'hud-panel', onclick: this.bind(this._cycle) },
        h('span', { className: 'hud-label' }, 'cost'),
        h('span', { className: 'hud-value' }, main),
        h('span', { className: 'hud-unit' }, denomination),
        h('button', {
          className: 'hud-reset',
          title: 'Reset all costs',
          onclick: this.bind(this._reset),
        }, '\u21BB'),
      )
    );
  }
}
