import { Component, h } from '@monygroupcorp/microact';
import { eventBus } from '@monygroupcorp/microact';
import { Modal, ModalError } from './Modal.js';
import { postWithCsrf } from '../../lib/api.js';

/**
 * ReauthModal — re-authenticate within the sandbox without leaving the workspace.
 * Supports wallet connect, username/password, and API key flows.
 *
 * Props:
 *   onClose — called to dismiss the modal
 *
 * Emits 'reauth-success' on eventBus when authentication succeeds.
 */

const VIEWS = { INITIAL: 'initial', PASSWORD: 'password', APIKEY: 'apikey' };

export class ReauthModal extends Component {
  constructor(props) {
    super(props);
    this.state = { view: VIEWS.INITIAL, error: null, submitting: false };
  }

  _onSuccess() {
    eventBus.emit('reauth-success');
    this.props.onClose?.();
  }

  // ── Wallet Connect ─────────────────────────────────────────
  async _walletConnect() {
    if (typeof window.ethereum === 'undefined') {
      return this.setState({ error: 'Please install MetaMask!' });
    }

    this.setState({ error: null, submitting: true });
    try {
      await this._ensureEthers();
      const provider = new window.ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();

      const nonceRes = await postWithCsrf('/api/v1/auth/web3/nonce', { address });
      if (!nonceRes.ok) throw new Error((await nonceRes.json()).error?.message || 'Failed to get nonce.');
      const { nonce } = await nonceRes.json();

      const signature = await signer.signMessage(nonce);

      const verifyRes = await postWithCsrf('/api/v1/auth/web3/verify', { address, signature });
      if (!verifyRes.ok) throw new Error((await verifyRes.json()).error?.message || 'Verification failed.');

      this._onSuccess();
    } catch (err) {
      this.setState({ error: err.message, submitting: false });
    }
  }

  async _ensureEthers() {
    if (window.ethers) return;
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[data-ethers]')) {
        const el = document.querySelector('script[data-ethers]');
        el.addEventListener('load', resolve);
        el.addEventListener('error', () => reject(new Error('Failed to load wallet library.')));
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.umd.min.js';
      script.async = true;
      script.setAttribute('data-ethers', 'true');
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load wallet library.'));
      document.head.appendChild(script);
    });
  }

  // ── Password Login ─────────────────────────────────────────
  async _passwordLogin(e) {
    e.preventDefault();
    const form = e.target;
    const username = form.username.value;
    const password = form.password.value;
    this.setState({ error: null, submitting: true });
    try {
      const res = await postWithCsrf('/api/v1/auth/password', { username, password });
      if (!res.ok) throw new Error((await res.json()).error?.message || 'Login failed.');
      this._onSuccess();
    } catch (err) {
      this.setState({ error: err.message, submitting: false });
    }
  }

  // ── API Key Login ──────────────────────────────────────────
  async _apikeyLogin(e) {
    e.preventDefault();
    const apikey = e.target.apikey.value;
    this.setState({ error: null, submitting: true });
    try {
      const res = await postWithCsrf('/api/v1/auth/apikey', { apikey });
      if (!res.ok) throw new Error((await res.json()).error?.message || 'API key login failed.');
      this._onSuccess();
    } catch (err) {
      this.setState({ error: err.message, submitting: false });
    }
  }

  static get styles() {
    return `
      .reauth-body { display: flex; flex-direction: column; gap: 16px; text-align: center; }
      .reauth-wallet-btn {
        padding: 16px 32px; font-size: var(--fs-md); background: var(--surface-2); border: var(--border-width) solid var(--border);
        color: var(--text-primary); border-radius: 0; cursor: pointer; font-weight: 600;
      }
      .reauth-wallet-btn:hover { border-color: var(--border-hover); }
      .reauth-wallet-btn:disabled { opacity: 0.5; cursor: default; }
      .reauth-alt { font-size: var(--fs-base); color: var(--text-secondary); }
      .reauth-alt a { color: var(--accent); cursor: pointer; text-decoration: none; }
      .reauth-alt a:hover { text-decoration: underline; }
      .reauth-form { display: flex; flex-direction: column; gap: 12px; }
      .reauth-form input {
        background: var(--surface-1); border: var(--border-width) solid var(--border); color: var(--text-primary);
        padding: 10px 14px; border-radius: 0; font-size: var(--fs-md); outline: none;
      }
      .reauth-form input:focus { border-color: var(--accent-border); }
      .reauth-form button[type="submit"] {
        background: var(--surface-2); border: var(--border-width) solid var(--border); color: var(--text-primary);
        padding: 10px; border-radius: 0; cursor: pointer; font-weight: 600;
      }
      .reauth-form button[type="submit"]:hover { border-color: var(--border-hover); }
      .reauth-form button[type="submit"]:disabled { opacity: 0.5; }
      .reauth-back { color: var(--text-secondary); font-size: var(--fs-base); cursor: pointer; background: none; border: none; }
      .reauth-back:hover { color: var(--text-primary); }
    `;
  }

  _renderInitial() {
    const { submitting } = this.state;
    return h('div', { className: 'reauth-body' },
      h('button', {
        className: 'reauth-wallet-btn',
        disabled: submitting,
        onclick: this.bind(this._walletConnect)
      }, submitting ? 'Connecting...' : 'Connect Wallet'),
      h('div', { className: 'reauth-alt' },
        h('a', { onclick: () => this.setState({ view: VIEWS.PASSWORD, error: null }) }, 'Username/Password'),
        ' or ',
        h('a', { onclick: () => this.setState({ view: VIEWS.APIKEY, error: null }) }, 'API Key')
      )
    );
  }

  _renderPasswordForm() {
    const { submitting } = this.state;
    return h('form', { className: 'reauth-form', onsubmit: this.bind(this._passwordLogin) },
      h('input', { type: 'text', name: 'username', placeholder: 'Username', required: true }),
      h('input', { type: 'password', name: 'password', placeholder: 'Password', required: true }),
      h('button', { type: 'submit', disabled: submitting }, submitting ? 'Logging in...' : 'Login'),
      h('button', { type: 'button', className: 'reauth-back', onclick: () => this.setState({ view: VIEWS.INITIAL, error: null }) }, '\u2190 Back')
    );
  }

  _renderApikeyForm() {
    const { submitting } = this.state;
    return h('form', { className: 'reauth-form', onsubmit: this.bind(this._apikeyLogin) },
      h('input', { type: 'text', name: 'apikey', placeholder: 'API Key', required: true }),
      h('button', { type: 'submit', disabled: submitting }, submitting ? 'Verifying...' : 'Login'),
      h('button', { type: 'button', className: 'reauth-back', onclick: () => this.setState({ view: VIEWS.INITIAL, error: null }) }, '\u2190 Back')
    );
  }

  render() {
    const { view, error } = this.state;

    let body;
    switch (view) {
      case VIEWS.PASSWORD: body = this._renderPasswordForm(); break;
      case VIEWS.APIKEY: body = this._renderApikeyForm(); break;
      default: body = this._renderInitial();
    }

    return h(Modal, { onClose: this.props.onClose, title: 'Re-authenticate', content: [
      ModalError({ message: error }),
      body
    ] });
  }
}
