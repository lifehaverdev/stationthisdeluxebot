import { Component, h } from '@monygroupcorp/microact';
import { formatUnits, getTokenMetadata, formatTokenAmount, shortHash } from '../../lib/format.js';

const USD_PER_POINT = 0.000337;

/**
 * Renders Foundation + Chartered vault balances.
 * Props: { balances, onChainBalances, onWithdraw }
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
        font-size: 1rem;
        margin: 1rem 0 0.5rem;
      }
      .token-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.75rem;
        background: #2a2f3a;
        border-radius: 4px;
        margin-bottom: 0.5rem;
      }
      .token-symbol {
        font-weight: bold;
        color: #90caf9;
        min-width: 80px;
      }
      .token-details {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .token-detail-box {
        padding: 0.5rem;
        background: #1a1a1a;
        border-radius: 4px;
        font-size: 0.85rem;
        color: #ccc;
        line-height: 1.5;
      }
      .token-detail-box strong {
        color: #e0e0e0;
      }
      .withdraw-btn {
        background: #3f51b5;
        color: #fff;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
        font-size: 0.85rem;
      }
      .withdraw-btn:hover { background: #5c6bc0; }
    `;
  }

  renderFoundationToken(token) {
    const protocolEscrow = BigInt(token.protocolEscrow || '0');
    const userOwned = BigInt(token.userOwned || '0');
    const protocolOwnedNotSeized = BigInt(token.protocolOwnedNotSeized || '0');
    const pointDebtWei = BigInt(token.pointDebtWei || '0');
    const pendingSeizureWei = BigInt(token.pendingSeizureWei || '0');
    const pointsOutstanding = token.pointsOutstanding || 0;
    const pointsUsd = (pointsOutstanding * USD_PER_POINT).toFixed(2);

    const contractTotal = formatUnits((userOwned + protocolEscrow).toString(), token.decimals);
    const contractUser = formatUnits(userOwned.toString(), token.decimals);
    const contractProtocol = formatUnits(protocolEscrow.toString(), token.decimals);
    const ledgerUser = formatUnits((token.realUserOwned || '0').toString(), token.decimals);
    const ledgerProtocol = formatUnits((token.protocolOwnedNotSeized || '0').toString(), token.decimals);

    if (protocolEscrow === 0n && userOwned === 0n && protocolOwnedNotSeized === 0n) return null;

    return h('div', { className: 'token-item', key: token.tokenAddress },
      h('span', { className: 'token-symbol' }, token.symbol),
      h('div', { className: 'token-details' },
        h('div', { className: 'token-detail-box' },
          h('strong', null, 'Contract Balances'), h('br'),
          `Total Locked: ${contractTotal}`, h('br'),
          `User Owned: ${contractUser}`, h('br'),
          `Protocol Escrow: ${contractProtocol}`
        ),
        h('div', { className: 'token-detail-box' },
          h('strong', null, 'Ledger Claims'), h('br'),
          'User Claim: ', h('span', { style: { color: '#4caf50' } }, ledgerUser), h('br'),
          'Protocol Claim: ', h('span', { style: { color: '#ff9800' } }, ledgerProtocol)
        ),
        h('div', { className: 'token-detail-box' },
          h('strong', null, 'Debt & Signals'), h('br'),
          `Point Debt: ${formatUnits(pointDebtWei.toString(), token.decimals)}`, pointDebtWei > 0n ? ' \u26A0\uFE0F' : '', h('br'),
          `Pending Seizure: ${formatUnits(pendingSeizureWei.toString(), token.decimals)}`, h('br'),
          `Points Outstanding: ${pointsOutstanding.toLocaleString()} pts (~$${pointsUsd})`
        )
      ),
      protocolOwnedNotSeized > 0n
        ? h('button', {
            className: 'withdraw-btn',
            onClick: () => this.props.onWithdraw?.(token.tokenAddress, '0x01152530028bd834EDbA9744885A882D025D84F6', token.protocolOwnedNotSeized, token.symbol, token.decimals)
          }, `Withdraw ${formatUnits(token.protocolOwnedNotSeized.toString(), token.decimals)} ${token.symbol}`)
        : h('span', { style: { color: '#888', fontSize: '0.85rem' } }, 'No withdrawable amount')
    );
  }

  renderCharteredVault(vault) {
    const tokens = (vault.tokens || []).filter(t => {
      const uo = BigInt(t.userOwned || '0');
      const esc = BigInt(t.escrow || '0');
      return uo > 0n || esc > 0n;
    });
    if (!tokens.length) return null;

    return h('div', { key: vault.vaultAddress, style: { marginBottom: '1rem' } },
      h('h3', null, `${vault.vaultName} (${shortHash(vault.vaultAddress)})`),
      ...tokens.map(token => {
        const userOwned = BigInt(token.userOwned || '0');
        const amount = formatUnits(userOwned.toString(), token.decimals);
        const escrow = formatUnits((token.escrow || '0').toString(), token.decimals);

        return h('div', { className: 'token-item', key: token.tokenAddress },
          h('span', { className: 'token-symbol' }, token.symbol),
          h('div', { className: 'token-details' },
            h('div', { className: 'token-detail-box' },
              `User Owned: ${amount}`, h('br'),
              `Escrow: ${escrow}`
            )
          ),
          userOwned > 0n
            ? h('button', {
                className: 'withdraw-btn',
                onClick: () => this.props.onWithdraw?.(token.tokenAddress, vault.vaultAddress, token.userOwned, token.symbol, token.decimals)
              }, `Withdraw ${amount} ${token.symbol}`)
            : h('span', { style: { color: '#888', fontSize: '0.85rem' } }, 'No balance')
        );
      })
    );
  }

  render() {
    const { balances } = this.props;
    if (!balances) return null;

    const foundationTokens = (balances.foundation || []).map(t => this.renderFoundationToken(t)).filter(Boolean);
    const charteredVaults = (balances.charteredVaults || []).map(v => this.renderCharteredVault(v)).filter(Boolean);

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
        : null
    );
  }
}
