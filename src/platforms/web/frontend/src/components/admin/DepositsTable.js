import { Component, h } from '@monygroupcorp/microact';
import { shortHash, formatUnits, relativeTime, getTokenMetadata } from '../../lib/format.js';

/**
 * Clean deposit list for CreditVault deposits.
 * Props: { deposits }
 */
export class DepositsTable extends Component {
  static get styles() {
    return `
      .deposits-section {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }
      .deposits-section h2 {
        margin-top: 0;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        margin-bottom: 1rem;
      }
      .deposits-table {
        width: 100%;
        border-collapse: collapse;
      }
      .deposits-table th {
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        text-align: left;
        padding: 0.5rem;
        border-bottom: var(--border-width) solid var(--border);
      }
      .deposits-table td {
        padding: 0.5rem;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-primary);
        border-bottom: var(--border-width) solid var(--border);
      }
      .deposits-table tr:nth-child(even) td { background: var(--surface-1); }
      .deposits-table tr:nth-child(odd) td { background: var(--surface-2); }
      .deposits-table a {
        color: var(--accent);
        text-decoration: none;
        opacity: 0.75;
      }
      .deposits-table a:hover { opacity: 1; }
      .deposits-empty {
        color: var(--text-secondary);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        padding: 1rem 0;
      }
    `;
  }

  render() {
    const { deposits } = this.props;

    if (!deposits || deposits.length === 0) {
      return h('section', { id: 'deposits', className: 'deposits-section' },
        h('h2', null, 'Deposits'),
        h('div', { className: 'deposits-empty' }, 'No deposits found.')
      );
    }

    return h('section', { id: 'deposits', className: 'deposits-section' },
      h('h2', null, 'Deposits'),
      h('table', { className: 'deposits-table' },
        h('thead', null,
          h('tr', null,
            h('th', null, 'Time'),
            h('th', null, 'Address'),
            h('th', null, 'Token'),
            h('th', null, 'Amount'),
            h('th', null, 'Points'),
            h('th', null, 'Tx'),
          )
        ),
        h('tbody', null,
          ...deposits.map((d, i) => {
            const meta = getTokenMetadata(d.tokenAddress);
            const amount = d.totalDeposited
              ? formatUnits(d.totalDeposited, meta.decimals)
              : '—';
            const txHash = d.deposits?.[0]?.tx_hash || d.txHash || d.transactionHash;

            return h('tr', { key: d.depositorAddress + '_' + i },
              h('td', null, relativeTime(d.createdAt || d.deposits?.[0]?.created_at)),
              h('td', { title: d.depositorAddress }, shortHash(d.depositorAddress || '')),
              h('td', null, d.symbol || meta.symbol),
              h('td', null, parseFloat(amount).toFixed(4)),
              h('td', null, (d.totalPointsCredited || 0).toLocaleString()),
              h('td', null,
                txHash
                  ? h('a', { href: `https://etherscan.io/tx/${txHash}`, target: '_blank' }, shortHash(txHash))
                  : '—'
              ),
            );
          })
        )
      )
    );
  }
}
