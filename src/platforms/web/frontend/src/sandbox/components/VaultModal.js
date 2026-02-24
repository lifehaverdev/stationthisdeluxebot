import { Component, h } from '@monygroupcorp/microact';
import { Modal, Loader, ModalError } from './Modal.js';
import { CopyButton, AsyncButton, EmptyState, ConfirmInline } from './ModalKit.js';
import { fetchJson, postWithCsrf } from '../../lib/api.js';
import { shortenAddress, formatUnits } from '../../lib/format.js';
import { websocketClient } from '../ws.js';

// ── Views ──────────────────────────────────────────────────

const VIEW = { LIST: 'list', DETAIL: 'detail', CREATE: 'create' };
const CREATE_STEP = { NAME: 1, REVIEW: 2, DEPLOYING: 3, RECEIPT: 4 };

/**
 * VaultModal — unified referral vault management.
 *
 * Props:
 *   onClose — close handler
 */
export class VaultModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      view: VIEW.LIST,
      // List
      vaults: [],
      vaultsLoading: true,
      vaultsError: null,
      // Detail
      selectedVault: null,
      dashboard: null,
      dashLoading: false,
      dashError: null,
      confirmWithdraw: false,
      withdrawing: false,
      withdrawResult: null,
      // Create
      createStep: CREATE_STEP.NAME,
      createName: '',
      nameAvailable: false,
      nameChecking: false,
      createError: null,
      deploying: false,
      deployMessage: null,
      deployTxHash: null,
      deployedAddress: null,
    };
    this._nameDebounce = null;
    this._wsHandler = null;
  }

  didMount() {
    this._fetchVaults();
    this._wsHandler = (evt) => this._onVaultUpdate(evt);
    websocketClient.on('referralVaultUpdate', this._wsHandler);
    this.registerCleanup(() => {
      websocketClient.off('referralVaultUpdate', this._wsHandler);
      clearTimeout(this._nameDebounce);
    });
  }

  // ── Data fetching ────────────────────────────────────────

  async _fetchVaults() {
    this.setState({ vaultsLoading: true, vaultsError: null });
    try {
      const data = await fetchJson('/api/v1/referral-vault/my-vaults');
      this.setState({ vaults: data.vaults || [], vaultsLoading: false });
    } catch (err) {
      this.setState({ vaultsError: err.message, vaultsLoading: false });
    }
  }

  async _fetchDashboard(vault) {
    this.setState({
      view: VIEW.DETAIL,
      selectedVault: vault,
      dashLoading: true,
      dashError: null,
      dashboard: null,
      confirmWithdraw: false,
      withdrawing: false,
      withdrawResult: null,
    });
    try {
      const data = await fetchJson(`/api/v1/referral-vault/${vault.vault_address}/dashboard`);
      this.setState({ dashboard: data, dashLoading: false });
    } catch (err) {
      this.setState({ dashError: err.message, dashLoading: false });
    }
  }

  // ── Withdraw ─────────────────────────────────────────────

  async _withdrawAll(tokens) {
    const { selectedVault } = this.state;
    this.setState({ withdrawing: true, withdrawResult: null });
    const errors = [];
    for (const token of tokens) {
      try {
        const res = await postWithCsrf(`/api/v1/referral-vault/${selectedVault.vault_address}/withdraw`, { tokenAddress: token.tokenAddress });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          errors.push(`${token.symbol}: ${data.error?.message || res.status}`);
        }
      } catch (err) {
        errors.push(`${token.symbol}: ${err.message}`);
      }
    }
    if (errors.length > 0) {
      this.setState({ withdrawing: false, withdrawResult: `Errors: ${errors.join('; ')}` });
    } else {
      this.setState({ withdrawing: false, confirmWithdraw: false, withdrawResult: 'Withdrawal request submitted. Processing may take a few minutes.' });
    }
  }

  // ── Create flow ──────────────────────────────────────────

  _onNameInput(e) {
    const name = e.target.value.trim();
    this.setState({ createName: name, nameAvailable: false, createError: null });
    clearTimeout(this._nameDebounce);
    if (name.length > 3) {
      this._nameDebounce = setTimeout(() => this._checkName(name), 400);
    }
  }

  async _checkName(name) {
    this.setState({ nameChecking: true });
    try {
      const res = await postWithCsrf('/api/v1/referral-vault/check-name', { name });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Check failed.');
      if (this.state.createName === name) {
        this.setState({ nameAvailable: data.isAvailable, nameChecking: false });
      }
    } catch (err) {
      this.setState({ createError: err.message, nameChecking: false });
    }
  }

  async _deploy() {
    this.setState({ createStep: CREATE_STEP.DEPLOYING, deploying: true, createError: null, deployMessage: 'Mining a valid salt...' });
    try {
      const res = await postWithCsrf('/api/v1/referral-vault/create', { name: this.state.createName });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to create vault.');
      this.setState({
        deployTxHash: data.deployment_tx_hash,
        deployedAddress: data.vault_address,
        deployMessage: 'Transaction sent! Waiting for confirmation...',
        deploying: false,
      });
    } catch (err) {
      this.setState({ createError: err.message, createStep: CREATE_STEP.REVIEW, deploying: false });
    }
  }

  _onVaultUpdate({ status, reason, txHash }) {
    if (this.state.view !== VIEW.CREATE || this.state.createStep !== CREATE_STEP.DEPLOYING) return;
    if (txHash && txHash !== this.state.deployTxHash) return;
    if (status === 'active') {
      this.setState({ createStep: CREATE_STEP.RECEIPT, deploying: false });
    } else if (status === 'failed') {
      this.setState({ createError: reason || 'Deployment failed.', deployMessage: null, deploying: false, createStep: CREATE_STEP.REVIEW });
    }
  }

  _goToCreatedVault() {
    this._fetchVaults();
    if (this.state.deployedAddress) {
      this._fetchDashboard({
        vault_name: this.state.createName,
        vault_address: this.state.deployedAddress,
      });
    } else {
      this._resetCreate();
      this.setState({ view: VIEW.LIST });
    }
  }

  _resetCreate() {
    this.setState({
      createStep: CREATE_STEP.NAME,
      createName: '',
      nameAvailable: false,
      nameChecking: false,
      createError: null,
      deploying: false,
      deployMessage: null,
      deployTxHash: null,
      deployedAddress: null,
    });
  }

  // ── Navigation ───────────────────────────────────────────

  _goList() {
    this._resetCreate();
    this.setState({ view: VIEW.LIST, selectedVault: null, dashboard: null });
  }

  _goCreate() {
    this._resetCreate();
    this.setState({ view: VIEW.CREATE });
  }

  // ── Render: List ─────────────────────────────────────────

  _renderList() {
    const { vaults, vaultsLoading, vaultsError } = this.state;

    if (vaultsLoading) return h(Loader, { message: 'Loading vaults...' });

    if (vaultsError) {
      return h('div', null,
        ModalError({ message: vaultsError }),
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._fetchVaults), label: 'Retry' })
      );
    }

    if (vaults.length === 0) {
      return h(EmptyState, {
        icon: '\uD83C\uDFE6',
        message: 'You don\'t have any referral vaults yet. Create one to start earning rewards when others use your referral code.',
        action: 'Create Your First Vault',
        onAction: this.bind(this._goCreate),
      });
    }

    return h('div', null,
      h('div', { className: 'vm-list-header' },
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._goCreate), label: '+ New Vault' })
      ),
      ...vaults.map(v =>
        h('div', {
          className: `vm-card${v.status === 'ACTIVE' ? '' : ' vm-card--pending'}`,
          key: v.vault_address,
          onclick: () => this._fetchDashboard(v),
        },
          h('div', { className: 'vm-card-name' }, v.vault_name || '(unnamed)'),
          h('div', { className: 'vm-card-addr' }, shortenAddress(v.vault_address)),
          v.status && v.status !== 'ACTIVE'
            ? h('span', { className: 'vm-card-badge' }, v.status.replace(/_/g, ' '))
            : null
        )
      )
    );
  }

  // ── Render: Detail ───────────────────────────────────────

  _renderDetail() {
    const { selectedVault, dashboard, dashLoading, dashError, confirmWithdraw, withdrawing, withdrawResult } = this.state;

    return h('div', null,
      h('button', { className: 'vm-back', onclick: this.bind(this._goList) }, '\u2190 All Vaults'),

      // Vault header
      h('div', { className: 'vm-detail-header' },
        h('h3', { className: 'vm-detail-name' }, selectedVault.vault_name || '(unnamed)'),
        h('div', { className: 'vm-detail-row' },
          h('span', { className: 'vm-detail-label' }, 'Address'),
          h('code', { className: 'vm-detail-mono' }, shortenAddress(selectedVault.vault_address)),
          h(CopyButton, { text: selectedVault.vault_address })
        ),
        h('div', { className: 'vm-detail-row' },
          h('span', { className: 'vm-detail-label' }, 'Referral Link'),
          h('code', { className: 'vm-detail-mono' }, `noema.art/referral/${selectedVault.vault_name}`),
          h(CopyButton, { text: `noema.art/referral/${selectedVault.vault_name}` })
        )
      ),

      // Dashboard body
      dashLoading ? h(Loader, { message: 'Loading vault stats...' }) : null,
      dashError ? h('div', null,
        ModalError({ message: dashError }),
        h(AsyncButton, { variant: 'secondary', onclick: () => this._fetchDashboard(selectedVault), label: 'Retry' })
      ) : null,

      dashboard && dashboard.tokens && dashboard.tokens.length > 0
        ? h('div', { className: 'vm-tokens' },
          ...dashboard.tokens.map(token => this._renderToken(token))
        )
        : null,

      dashboard && (!dashboard.tokens || dashboard.tokens.length === 0)
        ? h('div', { className: 'vm-no-tokens' }, 'No deposit history for this vault yet.')
        : null,

      // Withdraw section
      dashboard && dashboard.tokens && dashboard.tokens.some(t => BigInt(t.currentWithdrawable) > 0n)
        ? this._renderWithdrawSection()
        : null,

      withdrawResult
        ? h('div', { className: `vm-withdraw-result${withdrawResult.startsWith('Error') ? ' vm-withdraw-result--err' : ''}` }, withdrawResult)
        : null
    );
  }

  _renderToken(token) {
    const { symbol, iconUrl, decimals, currentWithdrawable, currentWithdrawableUsd, totalDepositsUsd } = token;
    const formatted = parseFloat(formatUnits(currentWithdrawable, decimals)).toFixed(6);
    const hasBalance = BigInt(currentWithdrawable) > 0n;

    return h('div', { className: 'vm-token', key: token.tokenAddress },
      h('div', { className: 'vm-token-head' },
        iconUrl ? h('img', { src: iconUrl, className: 'vm-token-icon', alt: symbol }) : h('div', { className: 'vm-token-icon vm-token-icon--placeholder' }),
        h('span', { className: 'vm-token-symbol' }, symbol)
      ),
      h('div', { className: 'vm-token-stat' },
        h('span', null, 'Withdrawable'),
        h('span', { className: hasBalance ? 'vm-token-val--has' : '' }, `${formatted} (~$${currentWithdrawableUsd.toFixed(2)})`)
      ),
      h('div', { className: 'vm-token-stat' },
        h('span', null, 'Total Deposits'),
        h('span', null, `~$${totalDepositsUsd.toFixed(2)}`)
      )
    );
  }

  _renderWithdrawSection() {
    const { confirmWithdraw, withdrawing, dashboard } = this.state;

    if (!confirmWithdraw) {
      return h('div', { className: 'vm-withdraw' },
        h(AsyncButton, {
          variant: 'primary',
          onclick: () => this.setState({ confirmWithdraw: true }),
          label: 'Withdraw All',
        })
      );
    }

    // Withdraw all tokens that have balance
    const tokensWithBalance = dashboard.tokens.filter(t => BigInt(t.currentWithdrawable) > 0n);
    const summary = tokensWithBalance.map(t =>
      `${parseFloat(formatUnits(t.currentWithdrawable, t.decimals)).toFixed(4)} ${t.symbol}`
    ).join(', ');

    return h(ConfirmInline, {
      message: `Withdraw ${summary}? A withdrawal request will be created and processed shortly.`,
      confirmLabel: withdrawing ? 'Submitting...' : 'Withdraw',
      onCancel: () => this.setState({ confirmWithdraw: false }),
      onConfirm: () => this._withdrawAll(tokensWithBalance),
    });
  }

  // ── Render: Create ───────────────────────────────────────

  _renderCreate() {
    const { createStep } = this.state;
    switch (createStep) {
      case CREATE_STEP.NAME: return this._renderCreateName();
      case CREATE_STEP.REVIEW: return this._renderCreateReview();
      case CREATE_STEP.DEPLOYING: return this._renderCreateDeploying();
      case CREATE_STEP.RECEIPT: return this._renderCreateReceipt();
      default: return h('div', { style: 'display:none' });
    }
  }

  _renderCreateName() {
    const { createName, nameChecking, nameAvailable } = this.state;
    let statusCls = '', statusText = 'Enter a name (4+ characters).';
    if (nameChecking) { statusCls = 'vm-status--checking'; statusText = 'Checking...'; }
    else if (createName.length > 3 && nameAvailable) { statusCls = 'vm-status--ok'; statusText = `"${createName}" is available!`; }
    else if (createName.length > 3) { statusCls = 'vm-status--bad'; statusText = `"${createName}" is unavailable.`; }

    return h('div', null,
      h('button', { className: 'vm-back', onclick: this.bind(this._goList) }, '\u2190 Back'),
      h('p', { style: 'color:var(--text-secondary);font-size:var(--fs-md);margin:12px 0' }, 'Create a unique code name for your referral vault. When someone uses your code, their contribution goes to your vault and you earn 5% rewards.'),
      h('div', { className: 'vm-form' },
        h('label', null, 'Vault Code Name'),
        h('input', {
          type: 'text',
          value: createName,
          placeholder: "e.g., crypto-king",
          oninput: this.bind(this._onNameInput),
        }),
        h('div', { className: `vm-status ${statusCls}` }, statusText)
      ),
      h('div', { className: 'vm-nav' },
        h(AsyncButton, {
          disabled: !nameAvailable || nameChecking,
          onclick: () => this.setState({ createStep: CREATE_STEP.REVIEW, createError: null }),
          label: 'Next',
        })
      )
    );
  }

  _renderCreateReview() {
    return h('div', null,
      h('button', { className: 'vm-back', onclick: () => this.setState({ createStep: CREATE_STEP.NAME }) }, '\u2190 Back'),
      h('div', { className: 'vm-review' },
        h('p', null, 'You are about to create a referral vault:'),
        h('p', null, h('strong', null, 'Code Name: '), this.state.createName),
        h('p', null, 'This will deploy a new contract. The address will start with 0x1152.')
      ),
      h('div', { className: 'vm-nav' },
        h(AsyncButton, { variant: 'secondary', onclick: () => this.setState({ createStep: CREATE_STEP.NAME }), label: 'Back' }),
        h(AsyncButton, { onclick: this.bind(this._deploy), label: 'Confirm & Deploy' })
      )
    );
  }

  _renderCreateDeploying() {
    const { deployMessage, deployTxHash } = this.state;
    return h('div', { className: 'vm-deploy' },
      h(Loader, { message: deployMessage }),
      deployTxHash ? h('p', { style: 'font-size:var(--fs-xs);color:var(--text-label);word-break:break-all;margin-top:8px' }, `Tx: ${deployTxHash}`) : null
    );
  }

  _renderCreateReceipt() {
    return h('div', { className: 'vm-receipt' },
      h('h3', null, 'Deployment Successful!'),
      h('p', null, 'Your referral vault is now active.'),
      h('p', null, h('strong', null, 'Name: '), this.state.createName),
      h('p', { className: 'vm-receipt-addr' }, this.state.deployedAddress),
      h('div', { className: 'vm-nav' },
        h(AsyncButton, { onclick: this.bind(this._goToCreatedVault), label: 'View Vault' })
      )
    );
  }

  // ── Styles ───────────────────────────────────────────────

  static get styles() {
    return `
      /* List */
      .vm-list-header { display: flex; justify-content: flex-end; margin-bottom: 12px; }
      .vm-card { background: var(--surface-2); border: var(--border-width) solid var(--border); border-radius: 0; padding: 14px 16px; margin-bottom: 8px; cursor: pointer; transition: border-color var(--dur-interact) var(--ease); }
      .vm-card:hover { border-color: var(--border-hover); }
      .vm-card--pending { opacity: 0.6; }
      .vm-card-name { font-weight: 600; font-size: var(--fs-lg); color: var(--text-primary); margin-bottom: 4px; }
      .vm-card-addr { font-family: var(--ff-mono); font-size: var(--fs-xs); color: var(--text-secondary); }
      .vm-card-badge { display: inline-block; font-size: var(--fs-xs); color: var(--accent-dim); background: var(--accent-glow); padding: 2px 8px; border-radius: 0; margin-top: 6px; text-transform: uppercase; letter-spacing: var(--ls-wide); }

      /* Detail */
      .vm-back { background: none; border: none; color: var(--accent); cursor: pointer; font-size: var(--fs-base); padding: 0; margin-bottom: 16px; }
      .vm-back:hover { text-decoration: underline; }
      .vm-detail-header { margin-bottom: 20px; }
      .vm-detail-name { margin: 0 0 12px; font-size: var(--fs-xl); color: var(--text-primary); }
      .vm-detail-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: var(--fs-base); }
      .vm-detail-label { color: var(--text-secondary); min-width: 90px; }
      .vm-detail-mono { font-family: var(--ff-mono); color: var(--text-primary); font-size: var(--fs-xs); }

      /* Tokens */
      .vm-tokens { margin-bottom: 16px; }
      .vm-token { border: var(--border-width) solid var(--border); border-radius: 0; padding: 14px; margin-bottom: 8px; }
      .vm-token-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .vm-token-icon { width: 24px; height: 24px; border-radius: 50%; }
      .vm-token-icon--placeholder { background: var(--surface-3); }
      .vm-token-symbol { font-weight: 600; font-size: var(--fs-lg); color: var(--text-primary); }
      .vm-token-stat { display: flex; justify-content: space-between; padding: 4px 0; font-size: var(--fs-base); }
      .vm-token-stat span:first-child { color: var(--text-secondary); }
      .vm-token-stat span:last-child { color: var(--text-primary); }
      .vm-token-val--has { color: var(--accent) !important; font-weight: 600; }
      .vm-no-tokens { color: var(--text-secondary); font-size: var(--fs-md); padding: 20px 0; text-align: center; }

      /* Withdraw */
      .vm-withdraw { margin-top: 16px; display: flex; justify-content: flex-end; }
      .vm-withdraw-result { margin-top: 12px; padding: 10px 14px; border-radius: 0; font-size: var(--fs-base); color: var(--accent); background: var(--accent-glow); border: var(--border-width) solid var(--accent-border); }
      .vm-withdraw-result--err { color: var(--danger); background: var(--danger-dim); border-color: var(--danger); }

      /* Create */
      .vm-form { margin: 16px 0; }
      .vm-form label { display: block; margin-bottom: 8px; color: var(--text-secondary); font-weight: 600; font-size: var(--fs-base); }
      .vm-form input { width: 100%; padding: 10px 14px; background: var(--surface-1); border: var(--border-width) solid var(--border); border-radius: 0; color: var(--text-primary); font-size: var(--fs-md); box-sizing: border-box; outline: none; }
      .vm-form input:focus { border-color: var(--accent-border); }
      .vm-status { font-size: var(--fs-base); margin-top: 8px; min-height: 1.2em; }
      .vm-status--checking { color: var(--accent-dim); }
      .vm-status--ok { color: var(--accent); }
      .vm-status--bad { color: var(--danger); }
      .vm-nav { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
      .vm-review { background: var(--surface-2); border-radius: 0; padding: 16px; margin: 16px 0; color: var(--text-secondary); line-height: 1.6; border: var(--border-width) solid var(--border); }
      .vm-review strong { color: var(--accent); }
      .vm-deploy { text-align: center; padding: 24px 0; }
      .vm-receipt { text-align: center; }
      .vm-receipt h3 { color: var(--accent); margin-bottom: 12px; }
      .vm-receipt-addr { font-family: var(--ff-mono); font-size: var(--fs-base); color: var(--accent); word-break: break-all; }
    `;
  }

  // ── Main render ──────────────────────────────────────────

  render() {
    const { view, createStep, createError, dashError } = this.state;

    const titles = {
      [VIEW.LIST]: 'Referral Vaults',
      [VIEW.DETAIL]: null, // detail has its own header
      [VIEW.CREATE]: {
        [CREATE_STEP.NAME]: 'Create Vault',
        [CREATE_STEP.REVIEW]: 'Review',
        [CREATE_STEP.DEPLOYING]: 'Deploying...',
        [CREATE_STEP.RECEIPT]: 'Success',
      }[createStep] || 'Create Vault',
    };

    const title = titles[view];
    const error = view === VIEW.CREATE ? createError : null;

    let body;
    switch (view) {
      case VIEW.LIST: body = this._renderList(); break;
      case VIEW.DETAIL: body = this._renderDetail(); break;
      case VIEW.CREATE: body = this._renderCreate(); break;
      default: body = h('div', { style: 'display:none' });
    }

    return h(Modal, { onClose: this.props.onClose, title, wide: true, content: [
      error ? ModalError({ message: error }) : null,
      body
    ] });
  }
}
