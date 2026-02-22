import { Component, h } from '@monygroupcorp/microact';

const DENOMINATIONS = ['POINTS', 'USD', 'MS2', 'CULT'];

/**
 * CostDisplay — clickable denomination-cycling cost pill for tool windows.
 *
 * Props:
 *   windowId — window ID (used to look up cost from state)
 *   initialCost — { usd, points, ms2, cult } (optional starting values)
 */
export class CostDisplay extends Component {
  constructor(props) {
    super(props);
    const saved = localStorage.getItem('costDenom');
    this.state = {
      denomination: DENOMINATIONS.includes(saved) ? saved : 'POINTS',
      cost: props.initialCost || { usd: 0, points: 0, ms2: 0, cult: 0 },
    };
  }

  didMount() {
    // Listen for cost updates dispatched by the execution system
    this._onCostUpdate = (e) => {
      if (e.detail?.windowId === this.props.windowId) {
        this.setState({ cost: e.detail.costData || this.state.cost });
      }
    };
    this._onDenomChange = (e) => {
      if (e.detail?.denomination) {
        this.setState({ denomination: e.detail.denomination });
      }
    };
    this._onCostReset = () => {
      this.setState({ cost: { usd: 0, points: 0, ms2: 0, cult: 0 } });
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
    // Broadcast to other windows
    window.dispatchEvent(new CustomEvent('denominationChange', { detail: { denomination: next } }));
  }

  _format() {
    const { denomination, cost } = this.state;
    const usd = cost.usd || 0;
    if (usd === 0) return `0 ${denomination}`;

    // Get exchange rates from CostHUD cache or fallback
    let rates;
    try {
      const cached = localStorage.getItem('ratesCache');
      rates = cached ? JSON.parse(cached).rates : null;
    } catch { rates = null; }

    switch (denomination) {
      case 'USD': return `$${usd.toFixed(4)}`;
      case 'POINTS': {
        const rate = rates?.POINTS_per_USD || (1 / 0.000337);
        return `${Math.round(usd * rate)} PTS`;
      }
      case 'MS2': {
        const rate = rates?.MS2_per_USD || 0;
        return rate ? `${(usd * rate).toFixed(2)} MS2` : `$${usd.toFixed(4)}`;
      }
      case 'CULT': {
        const rate = rates?.CULT_per_USD || 0;
        return rate ? `${(usd * rate).toFixed(2)} CULT` : `$${usd.toFixed(4)}`;
      }
      default: return `$${usd.toFixed(4)}`;
    }
  }

  static get styles() {
    return `
      .tw-cost { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #888; cursor: pointer; padding: 2px 6px; border-radius: 3px; user-select: none; }
      .tw-cost:hover { color: #ccc; background: rgba(255,255,255,0.05); }
    `;
  }

  render() {
    return h('span', {
      className: 'tw-cost',
      onclick: this.bind(this._cycle),
      title: 'Click to change denomination',
    }, `\uD83D\uDCB2 ${this._format()}`);
  }
}
