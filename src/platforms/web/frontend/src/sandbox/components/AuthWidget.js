import { Component, h, eventBus } from '@monygroupcorp/microact';
import { WalletService } from '@monygroupcorp/micro-web3';
import { postWithCsrf } from '../../lib/api.js';

/**
 * AuthWidget — persistent minimizable auth card for the sandbox.
 *
 * States: 'card' (full visible), 'badge' (corner icon), 'hidden' (authed).
 * Listens for sandbox:executeAttempt / sandbox:requireAuth to re-expand.
 * Emits auth:success on successful sign-in.
 *
 * Render note: always produces the same DOM structure — only style/disabled
 * attributes change. This avoids microact null→element diff crashes that occur
 * when conditional null children are used.
 */
export class AuthWidget extends Component {
  constructor(props) {
    super(props);
    this.state = {
      mode: props?.initialMode || 'card',  // 'card' | 'badge' | 'hidden'
      view: 'main',                         // 'main' | 'password' | 'apikey'
      error: '',
      loading: false,
    };
    this.walletService = new WalletService(eventBus);
  }

  async didMount() {
    await this.walletService.initialize();
    this.subscribe('sandbox:executeAttempt', () => {
      if (this.state.mode === 'badge') this.setState({ mode: 'card' });
    });
    this.subscribe('sandbox:requireAuth', () => {
      this.setState({ mode: 'card' });
    });
  }

  _minimize() { this.setState({ mode: 'badge', error: '' }); }
  _expand()   { this.setState({ mode: 'card' }); }

  _success() {
    this.setState({ mode: 'hidden' });
    eventBus.emit('auth:success');
    if (this.props.onSuccess) this.props.onSuccess();
  }

  async connectWallet() {
    this.setState({ loading: true, error: '' });
    try {
      const wallets = this.walletService.getAvailableWallets();
      if (!wallets || wallets.length === 0) {
        this.setState({ error: 'No wallet detected. Please install a wallet extension.', loading: false });
        return;
      }
      await this.walletService.connect();
      const address = this.walletService.getAddress();

      const nonceRes = await postWithCsrf('/api/v1/auth/web3/nonce', { address });
      if (!nonceRes.ok) { const e = await nonceRes.json(); throw new Error(e.error?.message || 'Failed to get nonce.'); }
      const { nonce } = await nonceRes.json();

      const provider = this.walletService.ethersProvider;
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(nonce);

      const verifyRes = await postWithCsrf('/api/v1/auth/web3/verify', { address, signature });
      if (!verifyRes.ok) { const e = await verifyRes.json(); throw new Error(e.error?.message || 'Verification failed.'); }

      this._success();
    } catch (err) {
      this.setState({ error: err.message || 'Connection failed.', loading: false });
    }
  }

  async submitPassword(e) {
    e.preventDefault();
    this.setState({ loading: true, error: '' });
    try {
      const form = e.target;
      const username = form.querySelector('[name="username"]').value;
      const password = form.querySelector('[name="password"]').value;
      const res = await postWithCsrf('/api/v1/auth/password', { username, password });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'Login failed.'); }
      this._success();
    } catch (err) {
      this.setState({ error: err.message || 'Login failed.', loading: false });
    }
  }

  async submitApiKey(e) {
    e.preventDefault();
    this.setState({ loading: true, error: '' });
    try {
      const form = e.target;
      const apikey = form.querySelector('[name="apikey"]').value;
      const res = await postWithCsrf('/api/v1/auth/apikey', { apikey });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'API key login failed.'); }
      this._success();
    } catch (err) {
      this.setState({ error: err.message || 'Login failed.', loading: false });
    }
  }

  static get styles() {
    return `
      .aw-badge {
        position: fixed; top: 12px; right: 12px; z-index: 500;
        background: #1a1a1a; border: 1px solid #333; border-radius: 6px;
        padding: 6px 12px; color: #888; font-size: 13px; cursor: pointer;
      }
      .aw-badge:hover { border-color: #555; color: #fff; }
      .aw-overlay {
        position: fixed; inset: 0; z-index: 400;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.55); pointer-events: all;
      }
      .aw-card {
        background: #141414; border: 1px solid #2a2a2a; border-radius: 12px;
        padding: 2rem; width: 360px;
        box-shadow: 0 16px 48px rgba(0,0,0,0.8);
      }
      .aw-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
      .aw-header h3 { color: #fff; font-size: 1.1rem; margin: 0; }
      .aw-minimize { background: none; border: none; color: #888; font-size: 1.2rem; cursor: pointer; padding: 0; width: auto; }
      .aw-minimize:hover { color: #fff; }
      .aw-error {
        background: #2a1010; border: 1px solid #5a2020; color: #f88;
        padding: 0.5rem 0.75rem; border-radius: 4px; margin-bottom: 1rem; font-size: 0.85rem;
      }
      .aw-card button, .aw-card input[type="submit"] {
        width: 100%; padding: 0.65rem; border: none; border-radius: 4px;
        cursor: pointer; font-size: 0.95rem; margin-bottom: 0.5rem;
      }
      .aw-btn-wallet { background: #fff; color: #0a0a0a; font-weight: 600; }
      .aw-btn-wallet:hover { background: #e0e0e0; }
      .aw-btn-wallet:disabled { opacity: 0.5; cursor: wait; }
      .aw-btn-submit { background: #fff; color: #0a0a0a; font-weight: 600; }
      .aw-alt { margin-top: 0.75rem; text-align: center; font-size: 0.85rem; color: #888; }
      .aw-alt a { color: #aaa; text-decoration: underline; cursor: pointer; }
      .aw-alt a:hover { color: #fff; }
      .aw-card input[type="text"], .aw-card input[type="password"] {
        width: 100%; padding: 0.6rem; background: #1a1a1a; border: 1px solid #333;
        border-radius: 4px; color: #e0e0e0; font-size: 0.95rem; margin-bottom: 0.75rem;
        box-sizing: border-box;
      }
      .aw-back { display: block; text-align: center; margin-top: 0.75rem; color: #888; font-size: 0.85rem; cursor: pointer; }
      .aw-back:hover { color: #fff; }
    `;
  }

  render() {
    const { mode, view, error, loading } = this.state;
    const isHidden = mode === 'hidden';
    const isBadge = mode === 'badge';

    // Always render the same DOM structure — style attributes control visibility.
    // This prevents microact null→element diff crashes from conditional children.
    return h('div', { className: 'aw-root', style: isHidden ? 'display:none' : '' },

      // Badge (minimized corner button)
      h('button', {
        className: 'aw-badge',
        style: isBadge ? '' : 'display:none',
        onClick: this.bind(this._expand),
      }, 'Sign In'),

      // Card (centered modal)
      h('div', {
        className: 'aw-overlay',
        style: isBadge ? 'display:none' : '',
      },
        h('div', { className: 'aw-card' },
          h('div', { className: 'aw-header' },
            h('h3', null, 'Sign In'),
            h('button', { className: 'aw-minimize', onClick: this.bind(this._minimize) }, '\u2212')
          ),

          // Error — always rendered, hidden when empty
          h('div', {
            className: 'aw-error',
            style: error ? '' : 'display:none',
          }, error),

          // Main view
          h('div', { style: view !== 'main' ? 'display:none' : '' },
            h('button', {
              className: 'aw-btn-wallet',
              disabled: loading,
              onClick: this.bind(this.connectWallet),
            }, loading ? 'Connecting...' : 'Connect Wallet'),
            h('div', { className: 'aw-alt' },
              h('a', { onClick: () => this.setState({ view: 'password', error: '' }) }, 'Username / Password'),
              ' or ',
              h('a', { onClick: () => this.setState({ view: 'apikey', error: '' }) }, 'API Key')
            )
          ),

          // Password view
          h('form', {
            style: view !== 'password' ? 'display:none' : '',
            onSubmit: this.bind(this.submitPassword),
          },
            h('input', { type: 'text', name: 'username', placeholder: 'Username', required: true }),
            h('input', { type: 'password', name: 'password', placeholder: 'Password', required: true }),
            h('button', { type: 'submit', className: 'aw-btn-submit', disabled: loading },
              loading ? 'Logging in...' : 'Login'),
            h('a', { className: 'aw-back', onClick: () => this.setState({ view: 'main', error: '' }) }, '\u2190 Back')
          ),

          // API Key view
          h('form', {
            style: view !== 'apikey' ? 'display:none' : '',
            onSubmit: this.bind(this.submitApiKey),
          },
            h('input', { type: 'text', name: 'apikey', placeholder: 'API Key', required: true }),
            h('button', { type: 'submit', className: 'aw-btn-submit', disabled: loading },
              loading ? 'Logging in...' : 'Login'),
            h('a', { className: 'aw-back', onClick: () => this.setState({ view: 'main', error: '' }) }, '\u2190 Back')
          )
        )
      )
    );
  }
}
