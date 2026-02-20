import { Component, h } from '@monygroupcorp/microact';
import { shortHash, formatTokenAmount, relativeTime, getTokenMetadata } from '../../lib/format.js';

/**
 * Deposit recovery section.
 * Props: { deposits, metrics, loading, error, onRefresh }
 */
export class DepositRecovery extends Component {
  static get styles() {
    return `
      .deposit-section {
        background: #1a1f2b;
        border: 1px solid #2a2f3a;
        border-radius: 8px;
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }
      .deposit-section h2 {
        margin-top: 0;
        color: #90caf9;
        font-size: 1.2rem;
        margin-bottom: 1rem;
      }
      .deposit-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85rem;
      }
      .deposit-table th {
        text-align: left;
        padding: 0.5rem;
        color: #90caf9;
        border-bottom: 1px solid #444;
      }
      .deposit-table td {
        padding: 0.5rem;
        color: #e0e0e0;
        border-bottom: 1px solid #333;
      }
      .deposit-table .mono { font-family: monospace; }
      .deposit-metrics {
        margin-bottom: 1rem;
        padding: 0.6rem;
        background: #1a1a1a;
        border-radius: 4px;
        font-size: 0.85rem;
        color: #90caf9;
      }
      .deposit-refresh-btn {
        padding: 0.4rem 0.75rem;
        background: #3f51b5;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        margin-bottom: 1rem;
      }
      .etherscan-link { color: #90caf9; }
    `;
  }

  render() {
    const { deposits = [], metrics, loading, error, onRefresh } = this.props;

    return h('section', { className: 'deposit-section' },
      h('h2', null, 'Deposit Recovery'),
      h('button', { className: 'deposit-refresh-btn', onClick: onRefresh, disabled: loading }, loading ? 'Loading...' : 'Refresh'),

      error ? h('p', { style: { color: '#f88' } }, error) : null,

      metrics && deposits.length > 0
        ? h('div', { className: 'deposit-metrics' },
            h('strong', null, 'Open Deposits: '), `${deposits.length}`,
            metrics.countByStatus
              ? Object.entries(metrics.countByStatus).map(([s, c]) => ` | ${s}: ${c}`).join('')
              : ''
          )
        : null,

      deposits.length === 0 && !loading
        ? h('p', { style: { color: '#888' } }, 'No deposits matched filters.')
        : null,

      deposits.length > 0
        ? h('div', { style: { overflowX: 'auto' } },
            h('table', { className: 'deposit-table' },
              h('thead', null,
                h('tr', null,
                  h('th', null, 'Updated'),
                  h('th', null, 'Depositor'),
                  h('th', null, 'Token'),
                  h('th', null, 'TX Hash'),
                  h('th', null, 'Amount'),
                  h('th', null, 'Status')
                )
              ),
              h('tbody', null,
                ...deposits.map((dep, i) => {
                  const txHash = dep.deposit_tx_hash || dep.confirmation_tx_hash || '';
                  const tokenAddr = dep.token_address || '';
                  const meta = getTokenMetadata(tokenAddr);
                  return h('tr', { key: i },
                    h('td', { style: { color: '#888' } }, dep.updatedAt ? new Date(dep.updatedAt).toLocaleString() : 'N/A'),
                    h('td', { className: 'mono' }, shortHash(dep.depositor_address || '')),
                    h('td', null, meta.symbol),
                    h('td', null,
                      txHash
                        ? h('a', { href: `https://etherscan.io/tx/${txHash}`, target: '_blank', className: 'etherscan-link' }, txHash.slice(0, 16) + '...')
                        : 'N/A'
                    ),
                    h('td', null, formatTokenAmount(dep.deposit_amount_wei || '0', tokenAddr)),
                    h('td', { style: { color: dep.status === 'ERROR' ? '#ff9800' : '#e0e0e0' } }, dep.status || 'N/A')
                  );
                })
              )
            )
          )
        : null
    );
  }
}
