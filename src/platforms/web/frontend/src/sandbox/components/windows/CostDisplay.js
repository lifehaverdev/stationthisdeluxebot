import { Component, h } from '@monygroupcorp/microact';

const DENOMINATIONS = ['POINTS', 'USD', 'MS2', 'CULT'];
const RATES_CACHE_KEY = 'exchangeRatesCache'; // must match CostHUD
const FALLBACK_RATES = { POINTS_per_USD: 2967, MS2_per_USD: 2, CULT_per_USD: 50 };

/**
 * CostDisplay — denomination-cycling cost pill for a single tool window.
 * Denomination is shared with CostHUD via the `denominationChange` window event
 * and the `costDenom` localStorage key.
 *
 * Props:
 *   windowId — window ID (looks up cost from store on mount, then listens for updates)
 */
export class CostDisplay extends Component {
  constructor(props) {
    super(props);
    const saved = localStorage.getItem('costDenom');
    this.state = {
      denomination: DENOMINATIONS.includes(saved) ? saved : 'POINTS',
      cost: { usd: 0, points: 0, ms2: 0, cult: 0 },
    };
  }

  didMount() {
    this._onCostUpdate = (e) => {
      if (e.detail?.windowId === this.props.windowId) {
        // Use totalCost (running sum), not costData (single-execution delta)
        if (e.detail.totalCost) this.setState({ cost: e.detail.totalCost });
      }
    };
    this._onDenomChange = (e) => {
      if (e.detail?.denomination) this.setState({ denomination: e.detail.denomination });
    };
    this._onCostReset = (e) => {
      // Global reset or targeted reset for this window
      if (!e.detail?.windowId || e.detail.windowId === this.props.windowId) {
        this.setState({ cost: { usd: 0, points: 0, ms2: 0, cult: 0 } });
      }
    };

    window.addEventListener('costUpdate', this._onCostUpdate);
    window.addEventListener('denominationChange', this._onDenomChange);
    window.addEventListener('costReset', this._onCostReset);

    this.registerCleanup(() => {
      window.removeEventListener('costUpdate', this._onCostUpdate);
      window.removeEventListener('denominationChange', this._onDenomChange);
      window.removeEventListener('costReset', this._onCostReset);
    });
  }

  _cycle() {
    const idx = DENOMINATIONS.indexOf(this.state.denomination);
    const next = DENOMINATIONS[(idx + 1) % DENOMINATIONS.length];
    localStorage.setItem('costDenom', next);
    this.setState({ denomination: next });
    window.dispatchEvent(new CustomEvent('denominationChange', { detail: { denomination: next } }));
  }

  _getRates() {
    try {
      const raw = localStorage.getItem(RATES_CACHE_KEY);
      if (raw) {
        const { rates } = JSON.parse(raw);
        return rates || FALLBACK_RATES;
      }
    } catch {}
    return FALLBACK_RATES;
  }

  _format() {
    const { denomination, cost } = this.state;
    const usd = cost.usd || 0;
    if (usd === 0) return null; // hide when no cost

    const rates = this._getRates();
    switch (denomination) {
      case 'USD':    return `$${usd.toFixed(4)}`;
      case 'POINTS': return `${Math.round(usd * (rates.POINTS_per_USD || 2967))} PTS`;
      case 'MS2':    return `${(usd * (rates.MS2_per_USD || 0)).toFixed(2)} MS2`;
      case 'CULT':   return `${Math.round(usd * (rates.CULT_per_USD || 0))} CULT`;
      default:       return `$${usd.toFixed(4)}`;
    }
  }

  static get styles() {
    return `
      .tw-cost {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        color: var(--text-label);
        cursor: pointer;
        padding: 2px 6px;
        border: var(--border-width) solid transparent;
        transition:
          color        var(--dur-micro) var(--ease),
          border-color var(--dur-micro) var(--ease);
        user-select: none;
      }
      .tw-cost:hover {
        color: var(--text-secondary);
        border-color: var(--border);
      }
    `;
  }

  render() {
    const label = this._format();
    if (!label) return h('span', null);

    return h('span', {
      className: 'tw-cost',
      onclick: this.bind(this._cycle),
      title: 'Click to change denomination',
    }, label);
  }
}
