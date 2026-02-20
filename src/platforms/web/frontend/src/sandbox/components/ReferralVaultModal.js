import { Component, h } from '@monygroupcorp/microact';
import { Modal, Loader, ModalError } from './Modal.js';
import { postWithCsrf } from '../../lib/api.js';
import { websocketClient } from '../ws.js';

const STEPS = { NAME: 1, REVIEW: 2, DEPLOYING: 3, RECEIPT: 4 };

export class ReferralVaultModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      step: STEPS.NAME,
      name: '',
      nameAvailable: false,
      nameChecking: false,
      error: null,
      deploying: false,
      deployMessage: null,
      txHash: null,
      vaultAddress: null,
    };
    this._debounce = null;
    this._wsHandler = null;
  }

  didMount() {
    // Listen for deployment status via WebSocket
    this._wsHandler = (event) => this._onVaultUpdate(event);
    websocketClient.on('referralVaultUpdate', this._wsHandler);
    this.registerCleanup(() => {
      websocketClient.off('referralVaultUpdate', this._wsHandler);
      clearTimeout(this._debounce);
    });
  }

  _onVaultUpdate({ status, reason, txHash }) {
    if (this.state.step !== STEPS.DEPLOYING) return;
    if (txHash && txHash !== this.state.txHash) return;

    if (status === 'active') {
      this.setState({ step: STEPS.RECEIPT, deploying: false });
    } else if (status === 'failed') {
      this.setState({ error: reason || 'Deployment failed.', deployMessage: null, deploying: false, step: STEPS.REVIEW });
    }
  }

  // ── Step 1: Name input with debounced availability check ───
  _onNameInput(e) {
    const name = e.target.value.trim();
    this.setState({ name, nameAvailable: false, error: null });
    clearTimeout(this._debounce);
    if (name.length > 3) {
      this._debounce = setTimeout(() => this._checkName(name), 400);
    }
  }

  async _checkName(name) {
    this.setState({ nameChecking: true });
    try {
      const res = await postWithCsrf('/api/v1/referral-vault/check-name', { name });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Check failed.');
      // Only apply if user hasn't changed input since
      if (this.state.name === name) {
        this.setState({ nameAvailable: data.isAvailable, nameChecking: false });
      }
    } catch (err) {
      this.setState({ error: err.message, nameChecking: false });
    }
  }

  // ── Step 2 → 3: Deploy vault ──────────────────────────────
  async _deploy() {
    this.setState({ step: STEPS.DEPLOYING, deploying: true, error: null, deployMessage: 'Mining a valid salt...' });
    try {
      const res = await postWithCsrf('/api/v1/referral-vault/create', { name: this.state.name });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to create vault.');
      this.setState({
        txHash: data.deployment_tx_hash,
        vaultAddress: data.vault_address,
        deployMessage: 'Transaction sent! Waiting for confirmation...',
        deploying: false,
      });
    } catch (err) {
      this.setState({ error: err.message, step: STEPS.REVIEW, deploying: false });
    }
  }

  static get styles() {
    return `
      .rv-form { margin: 16px 0; }
      .rv-form label { display: block; margin-bottom: 8px; color: #aaa; font-weight: 600; font-size: 13px; }
      .rv-form input { width: 100%; padding: 10px 14px; background: #222; border: 1px solid #444; border-radius: 6px; color: #e0e0e0; font-size: 14px; }
      .rv-status { font-size: 13px; margin-top: 8px; min-height: 1.2em; }
      .rv-status--checking { color: #f39c12; }
      .rv-status--ok { color: #2ecc71; }
      .rv-status--bad { color: #e74c3c; }
      .rv-nav { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
      .rv-btn { padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
      .rv-btn--primary { background: #3f51b5; color: #fff; }
      .rv-btn--primary:disabled { background: #444; cursor: default; }
      .rv-btn--secondary { background: #333; color: #ccc; border: 1px solid #555; }
      .rv-review { background: #222; border-radius: 6px; padding: 16px; margin: 16px 0; color: #bbb; line-height: 1.6; }
      .rv-review strong { color: #90caf9; }
      .rv-deploy { text-align: center; padding: 24px 0; }
      .rv-deploy p { color: #888; margin: 8px 0; }
      .rv-receipt { text-align: center; }
      .rv-receipt h3 { color: #2ecc71; margin-bottom: 12px; }
      .rv-receipt .addr { font-family: monospace; font-size: 13px; color: #90caf9; word-break: break-all; }
    `;
  }

  _renderStep1() {
    const { name, nameChecking, nameAvailable } = this.state;
    let statusCls = '', statusText = 'Enter a name (4+ characters).';
    if (nameChecking) { statusCls = 'rv-status--checking'; statusText = 'Checking...'; }
    else if (name.length > 3 && nameAvailable) { statusCls = 'rv-status--ok'; statusText = `"${name}" is available!`; }
    else if (name.length > 3) { statusCls = 'rv-status--bad'; statusText = `"${name}" is unavailable.`; }

    return h('div', null,
      h('p', { style: 'color:#aaa;font-size:14px' }, 'Create a unique code name for your referral vault.'),
      h('div', { className: 'rv-form' },
        h('label', null, 'Vault Code Name'),
        h('input', { type: 'text', value: name, placeholder: "e.g., 'crypto-king'", oninput: this.bind(this._onNameInput) }),
        h('div', { className: `rv-status ${statusCls}` }, statusText)
      ),
      h('div', { className: 'rv-nav' },
        h('button', {
          className: 'rv-btn rv-btn--primary',
          disabled: !nameAvailable || nameChecking,
          onclick: () => this.setState({ step: STEPS.REVIEW, error: null })
        }, 'Next')
      )
    );
  }

  _renderStep2() {
    return h('div', null,
      h('div', { className: 'rv-review' },
        h('p', null, 'You are about to create a referral vault:'),
        h('p', null, h('strong', null, 'Code Name: '), this.state.name),
        h('p', null, 'This will deploy a new contract. The address will start with 0x1152.')
      ),
      h('div', { className: 'rv-nav' },
        h('button', { className: 'rv-btn rv-btn--secondary', onclick: () => this.setState({ step: STEPS.NAME }) }, 'Back'),
        h('button', { className: 'rv-btn rv-btn--primary', onclick: this.bind(this._deploy) }, 'Confirm & Deploy')
      )
    );
  }

  _renderStep3() {
    const { deployMessage, txHash } = this.state;
    return h('div', { className: 'rv-deploy' },
      h(Loader, { message: deployMessage }),
      txHash ? h('p', { style: 'font-size:12px;color:#666;word-break:break-all' }, `Tx: ${txHash}`) : null
    );
  }

  _renderStep4() {
    return h('div', { className: 'rv-receipt' },
      h('h3', null, 'Deployment Successful!'),
      h('p', null, 'Your referral vault is now active.'),
      h('p', null, h('strong', null, 'Name: '), this.state.name),
      h('p', { className: 'addr' }, this.state.vaultAddress),
      h('div', { className: 'rv-nav' },
        h('button', { className: 'rv-btn rv-btn--primary', onclick: () => this.props.onClose?.() }, 'Done')
      )
    );
  }

  render() {
    const { step, error } = this.state;
    const titles = { [STEPS.NAME]: 'Set Up Referral Vault', [STEPS.REVIEW]: 'Review', [STEPS.DEPLOYING]: 'Deploying...', [STEPS.RECEIPT]: 'Success' };

    let body;
    switch (step) {
      case STEPS.NAME: body = this._renderStep1(); break;
      case STEPS.REVIEW: body = this._renderStep2(); break;
      case STEPS.DEPLOYING: body = this._renderStep3(); break;
      case STEPS.RECEIPT: body = this._renderStep4(); break;
    }

    return h(Modal, { onClose: this.props.onClose, title: titles[step] },
      ModalError({ message: error }),
      body
    );
  }
}
