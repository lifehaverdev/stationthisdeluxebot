import { Component, h } from '@monygroupcorp/microact';
import { formatUsd } from '../../lib/format.js';

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7d' },
  { key: 'mtd', label: 'MTD' },
  { key: 'custom', label: 'Custom' },
];

/**
 * KPI cards row + period selector.
 * Props: { accounting, period, onPeriodChange, vaultBalance }
 */
export class PLHero extends Component {
  static get styles() {
    return `
      .pl-hero {
        margin-bottom: 1.5rem;
      }
      .pl-cards {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 1rem;
        margin-bottom: 1rem;
      }
      @media (max-width: 800px) {
        .pl-cards { grid-template-columns: repeat(2, 1fr); }
      }
      .pl-card {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 1rem;
      }
      .pl-card-label {
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        margin-bottom: 0.5rem;
      }
      .pl-card-value {
        color: var(--text-primary);
        font-family: var(--ff-mono);
        font-size: var(--fs-xl, 1.5rem);
      }
      .pl-card-value.positive { color: var(--accent); }
      .pl-card-value.negative { color: var(--danger); }
      .pl-periods {
        display: flex;
        gap: 0.5rem;
      }
      .pl-periods button {
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
      .pl-periods button:hover { color: var(--text-secondary); border-color: var(--border-hover); }
      .pl-periods button.active { color: var(--accent); border-color: var(--accent); }
    `;
  }

  render() {
    const { accounting, period, onPeriodChange, vaultBalance } = this.props;

    const revenue = accounting?.revenue?.totalDeposits || 0;
    const costs = accounting?.expenses?.totalExpenses || 0;
    const grossProfit = accounting?.profitLoss?.grossProfit ?? (revenue - costs);
    const margin = accounting?.profitLoss?.operatingMargin ?? (revenue > 0 ? ((grossProfit / revenue) * 100) : 0);

    const cards = [
      { label: 'Vault Balance', value: vaultBalance != null ? formatUsd(vaultBalance) : '—' },
      { label: 'Revenue', value: formatUsd(revenue) },
      { label: 'Costs', value: formatUsd(costs) },
      { label: 'Gross Profit', value: formatUsd(grossProfit), cls: grossProfit >= 0 ? 'positive' : 'negative' },
      { label: 'Margin', value: `${margin.toFixed(1)}%`, cls: margin >= 0 ? 'positive' : 'negative' },
    ];

    return h('section', { id: 'pl', className: 'pl-hero' },
      h('div', { className: 'pl-cards' },
        ...cards.map(c =>
          h('div', { className: 'pl-card', key: c.label },
            h('div', { className: 'pl-card-label' }, c.label),
            h('div', { className: `pl-card-value ${c.cls || ''}` }, c.value),
          )
        )
      ),
      h('div', { className: 'pl-periods' },
        ...PERIODS.map(p =>
          h('button', {
            key: p.key,
            className: period === p.key ? 'active' : '',
            onClick: () => onPeriodChange?.(p.key),
          }, p.label)
        )
      )
    );
  }
}
