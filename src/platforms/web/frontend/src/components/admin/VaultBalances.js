import { Component, h } from '@monygroupcorp/microact';
import { formatUnits, shortHash } from '../../lib/format.js';

const USD_PER_POINT = 0.000337;

/**
 * Renders Foundation + Chartered vault balances.
 * Props: { balances, onWithdraw }
 */
export class VaultBalances extends Component {
  static get styles() {
    return `
      .vault-section {
        background: #1a1f2b;
        border: 1px solid #2a2f3a;
        border-radius: 8px;
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }
      .vault-section h2 {
        margin-top: 0;
        color: #90caf9;
        font-size: 1.2rem;
        margin-bottom: 1rem;
      }
      .vault-section h3 {
        color: #c0c0c0;
        font-size: 0.95rem;
        margin: 1rem 0 0.5rem;
        font-weight: 500;
      }
      .token-row {
        display: grid;
        grid-template-columns: 80px 1fr auto;
        align-items: center;
        gap: 1rem;
        padding: 0.65rem 0.75rem;
        background: #2a2f3a;
        border-radius: 4px;
        margin-bottom: 0.5rem;
      }
      .token-symbol {
        font-weight: bold;
        color: #90caf9;
        font-size: 0.95rem;
      }
      .token-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1.5rem;
        font-size: 0.8rem;
        color: #aaa;
      }
      .token-stats .stat-item {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .token-stats .stat-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #666;
      }
      .token-stats .stat-val { color: #e0e0e0; }
      .token-stats .stat-val.green { color: #4caf50; }
      .token-stats .stat-val.orange { color: #ff9800; }
      .token-stats .stat-val.warn { color: #f44336; }
      .withdraw-btn {
        background: #3f51b5;
        color: #fff;
        border: none;
        padding: 0.4rem 0.9rem;
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
        font-size: 0.8rem;
        flex-shrink: 0;
      }
      .withdraw-btn:hover { background: #5c6bc0; }
      .no-balance {
        color: #555;
        font-size: 0.8rem;
        white-space: nowrap;
      }
    `;
  }

  // grandTotal: cross-vault total (Foundation + all CharterFunds) for this token
  renderFoundationToken(token, grandTotal) {
    const protocolEscrow = BigInt(token.protocolEscrow || '0');
    const userOwned = BigInt(token.userOwned || '0');
    const protocolOwnedNotSeized = BigInt(token.protocolOwnedNotSeized || '0');
    const pointDebtWei = BigInt(token.pointDebtWei || '0');
    const pendingSeizureWei = BigInt(token.pendingSeizureWei || '0');
    const pointsOutstanding = token.pointsOutstanding || 0;

    if (protocolEscrow === 0n && userOwned === 0n && protocolOwnedNotSeized === 0n && pendingSeizureWei === 0n) return null;

    const fmtProtocol = formatUnits(protocolEscrow.toString(), token.decimals);
    const fmtUser = formatUnits(userOwned.toString(), token.decimals);
    const fmtPendingSeizure = formatUnits(pendingSeizureWei.toString(), token.decimals);
    const fmtGrandTotal = formatUnits(grandTotal.toString(), token.decimals);
    const pointsUsd = (pointsOutstanding * USD_PER_POINT).toFixed(2);
    const hasDebt = pointDebtWei > 0n;
    const hasPendingSeizure = pendingSeizureWei > 0n;

    return h('div', { className: 'token-row', key: token.tokenAddress },
      h('span', { className: 'token-symbol' }, token.symbol),
      h('div', { className: 'token-stats' },
        h('div', { className: 'stat-item' },
          h('span', { className: 'stat-label' }, 'On-chain Escrow'),
          h('span', { className: 'stat-val orange' }, fmtProtocol),
        ),
        h('div', { className: 'stat-item' },
          h('span', { className: 'stat-label' }, 'User Owned'),
          h('span', { className: 'stat-val' }, fmtUser),
        ),
        hasPendingSeizure ? h('div', { className: 'stat-item' },
          h('span', { className: 'stat-label' }, 'Pending Seizure'),
          h('span', { className: 'stat-val orange' }, fmtPendingSeizure),
        ) : null,
        h('div', { className: 'stat-item' },
          h('span', { className: 'stat-label' }, 'Will Withdraw (all vaults)'),
          h('span', { className: `stat-val ${grandTotal > 0n ? 'green' : ''}` }, fmtGrandTotal),
        ),
        h('div', { className: 'stat-item' },
          h('span', { className: 'stat-label' }, 'Pts Outstanding'),
          h('span', { className: 'stat-val' }, `${pointsOutstanding.toLocaleString()} (~$${pointsUsd})`),
        ),
        hasDebt ? h('div', { className: 'stat-item' },
          h('span', { className: 'stat-label' }, 'Point Debt'),
          h('span', { className: 'stat-val warn' }, `${formatUnits(pointDebtWei.toString(), token.decimals)} ⚠`),
        ) : null,
      ),
      grandTotal > 0n
        ? h('button', {
            className: 'withdraw-btn',
            onClick: () => this.props.onWithdraw?.(token.tokenAddress, '0x01152530028bd834EDbA9744885A882D025D84F6', grandTotal.toString(), token.symbol, token.decimals)
          }, `Seize + Withdraw ${fmtGrandTotal} ${token.symbol}`)
        : h('span', { className: 'no-balance' }, 'Nothing to withdraw'),
    );
  }

  renderCharteredVault(vault) {
    const tokens = (vault.tokens || []).filter(t => {
      const esc = BigInt(t.escrow || '0');
      const ps = BigInt(t.pendingSeizureWei || '0');
      return esc > 0n || ps > 0n;
    });
    if (!tokens.length) return null;

    return h('div', { key: vault.vaultAddress },
      h('h3', null, `${vault.vaultName} `, h('span', { style: { color: '#666', fontFamily: 'monospace', fontWeight: 400, fontSize: '0.8rem' } }, shortHash(vault.vaultAddress))),
      ...tokens.map(token => {
        const escrow = BigInt(token.escrow || '0');
        const pendingSeizure = BigInt(token.pendingSeizureWei || '0');
        const fmtEscrow = formatUnits(escrow.toString(), token.decimals);
        const fmtPending = formatUnits(pendingSeizure.toString(), token.decimals);
        const hasPending = pendingSeizure > 0n;

        return h('div', { className: 'token-row', key: token.tokenAddress },
          h('span', { className: 'token-symbol' }, token.symbol),
          h('div', { className: 'token-stats' },
            h('div', { className: 'stat-item' },
              h('span', { className: 'stat-label' }, 'On-chain Escrow'),
              h('span', { className: `stat-val ${escrow > 0n ? 'orange' : ''}` }, fmtEscrow),
            ),
            hasPending ? h('div', { className: 'stat-item' },
              h('span', { className: 'stat-label' }, 'Pending Seizure'),
              h('span', { className: 'stat-val orange' }, fmtPending),
            ) : null,
          ),
          h('span', { className: 'no-balance' }, 'Swept by Foundation withdrawal'),
        );
      })
    );
  }

  render() {
    const { balances } = this.props;
    if (!balances) return h('div', null);

    // Compute cross-vault grand total per token: Foundation + all CharterFund escrow + pending seizures.
    // This is what the single Foundation "Seize + Withdraw" button will actually collect.
    const grandTotals = new Map();
    for (const token of (balances.foundation || [])) {
      const key = token.tokenAddress.toLowerCase();
      const amt = BigInt(token.protocolEscrow || '0') + BigInt(token.pendingSeizureWei || '0');
      grandTotals.set(key, (grandTotals.get(key) || 0n) + amt);
    }
    for (const vault of (balances.charteredVaults || [])) {
      for (const token of (vault.tokens || [])) {
        const key = token.tokenAddress.toLowerCase();
        const amt = BigInt(token.escrow || '0') + BigInt(token.pendingSeizureWei || '0');
        grandTotals.set(key, (grandTotals.get(key) || 0n) + amt);
      }
    }

    const foundationTokens = (balances.foundation || []).map(t =>
      this.renderFoundationToken(t, grandTotals.get(t.tokenAddress.toLowerCase()) || 0n)
    ).filter(Boolean);
    const charteredVaults = (balances.charteredVaults || []).map(v => this.renderCharteredVault(v)).filter(Boolean);

    if (!foundationTokens.length && !charteredVaults.length) {
      return h('section', { className: 'vault-section' },
        h('h2', null, 'Vault Balances'),
        h('p', { style: { color: '#666', fontSize: '0.9rem' } }, 'No balances found.')
      );
    }

    return h('div', null,
      foundationTokens.length > 0
        ? h('section', { className: 'vault-section' },
            h('h2', null, 'Foundation Protocol Escrow'),
            ...foundationTokens
          )
        : null,
      charteredVaults.length > 0
        ? h('section', { className: 'vault-section' },
            h('h2', null, 'Chartered Vaults'),
            ...charteredVaults
          )
        : null,
    );
  }
}
