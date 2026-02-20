import { Component, h } from '@monygroupcorp/microact';
import { formatUnits, shortHash } from '../../lib/format.js';

/**
 * All accounts & balances table.
 * Props: { accounts, onAdjustPoints }
 */
export class AccountsTable extends Component {
  static get styles() {
    return `
      .accounts-section {
        background: #1a1f2b;
        border: 1px solid #2a2f3a;
        border-radius: 8px;
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }
      .accounts-section h2 {
        margin-top: 0;
        color: #90caf9;
        font-size: 1.2rem;
        margin-bottom: 0.5rem;
      }
      .accounts-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85rem;
      }
      .accounts-table th {
        padding: 0.6rem;
        text-align: left;
        color: #90caf9;
        background: #1a1a1a;
        border-bottom: 2px solid #444;
      }
      .accounts-table td {
        padding: 0.6rem;
        color: #e0e0e0;
      }
      .accounts-table tr:nth-child(even) { background: #2a2f3a; }
      .accounts-table tr:nth-child(odd) { background: #23272f; }
      .accounts-table .mono { font-family: monospace; color: #c0c0c0; }
      .accounts-table .positive { color: #4caf50; font-weight: 600; }
      .accounts-table .warning { color: #ff9800; }
      .add-points-btn {
        padding: 0.3rem 0.6rem;
        background: #4caf50;
        border: none;
        border-radius: 4px;
        color: #fff;
        cursor: pointer;
        font-size: 0.8rem;
      }
      .add-points-btn:hover { background: #66bb6a; }
    `;
  }

  render() {
    const { accounts, onAdjustPoints } = this.props;
    if (!accounts || !accounts.length) return null;

    return h('section', { className: 'accounts-section' },
      h('h2', null, 'All Accounts & Balances'),
      h('p', { style: { color: '#888', marginBottom: '0.75rem', fontSize: '0.9rem' } }, `Total accounts: ${accounts.length}`),
      h('div', { style: { overflowX: 'auto' } },
        h('table', { className: 'accounts-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, 'Address'),
              h('th', null, 'Token'),
              h('th', { style: { textAlign: 'right' } }, 'Deposited'),
              h('th', { style: { textAlign: 'right' } }, 'Pts Credited'),
              h('th', { style: { textAlign: 'right' } }, 'Pts Remaining'),
              h('th', { style: { textAlign: 'right' } }, 'User Owned'),
              h('th', { style: { textAlign: 'right' } }, 'Protocol Owned'),
              h('th', { style: { textAlign: 'center' } }, 'Actions')
            )
          ),
          h('tbody', null,
            ...accounts.map(acct =>
              h('tr', { key: acct.depositorAddress + acct.tokenAddress },
                h('td', { className: 'mono', title: acct.depositorAddress }, shortHash(acct.depositorAddress)),
                h('td', null, acct.symbol),
                h('td', { style: { textAlign: 'right' } }, formatUnits(acct.totalDeposited, acct.decimals)),
                h('td', { style: { textAlign: 'right' } }, parseInt(acct.totalPointsCredited).toLocaleString()),
                h('td', { className: 'positive', style: { textAlign: 'right' } }, parseInt(acct.totalPointsRemaining).toLocaleString()),
                h('td', { className: 'positive', style: { textAlign: 'right' } }, formatUnits(acct.realUserOwned, acct.decimals)),
                h('td', { className: 'warning', style: { textAlign: 'right' } }, formatUnits(acct.protocolOwnedNotSeized, acct.decimals)),
                h('td', { style: { textAlign: 'center' } },
                  acct.masterAccountId
                    ? h('button', {
                        className: 'add-points-btn',
                        onClick: () => onAdjustPoints?.(acct.masterAccountId, acct.depositorAddress)
                      }, 'Add Points')
                    : h('span', { style: { color: '#666', fontSize: '0.8rem' } }, 'No account')
                )
              )
            )
          )
        )
      )
    );
  }
}
