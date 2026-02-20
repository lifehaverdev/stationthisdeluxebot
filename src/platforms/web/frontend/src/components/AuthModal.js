import { Component, h, eventBus } from '@monygroupcorp/microact';
import { WalletService, WalletModal } from '@monygroupcorp/micro-web3';
import { postWithCsrf } from '../lib/api.js';

const APP_URL = window.location.hostname === 'localhost'
  ? 'http://app.localhost:4000'
  : 'https://app.noema.art';

/**
 * AuthModal — handles wallet connect, password, and API key login.
 * After successful auth the user is redirected to the app subdomain.
 */
export class AuthModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      visible: false,
      view: 'main',   // 'main' | 'password' | 'apikey'
      error: null,
      loading: false,
    };
    this.walletService = new WalletService(eventBus);
  }

  async didMount() {
    await this.walletService.initialize();
  }

  show() {
    this.setState({ visible: true, view: 'main', error: null });
  }

  hide() {
    this.setState({ visible: false, error: null, loading: false });
  }

  async connectWallet() {
    this.setState({ loading: true, error: null });
    try {
      const wallets = this.walletService.getAvailableWallets();
      if (!wallets || wallets.size === 0) {
        this.setState({ error: 'No wallet detected. Please install a wallet extension.', loading: false });
        return;
      }

      // Pick first available wallet (or could show picker)
      const walletKey = wallets.keys().next().value;
      await this.walletService.selectWallet(walletKey);
      await this.walletService.connect();
      const address = this.walletService.getAddress();

      // 1. Fetch nonce
      const nonceRes = await postWithCsrf('/api/v1/auth/web3/nonce', { address });
      if (!nonceRes.ok) {
        const err = await nonceRes.json();
        throw new Error(err.error?.message || 'Failed to get nonce.');
      }
      const { nonce } = await nonceRes.json();

      // 2. Sign
      const provider = this.walletService.ethersProvider;
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(nonce);

      // 3. Verify
      const verifyRes = await postWithCsrf('/api/v1/auth/web3/verify', { address, signature });
      if (!verifyRes.ok) {
        const err = await verifyRes.json();
        throw new Error(err.error?.message || 'Verification failed.');
      }

      window.location.href = APP_URL;
    } catch (err) {
      this.setState({ error: err.message, loading: false });
    }
  }

  async submitPassword(e) {
    e.preventDefault();
    this.setState({ loading: true, error: null });
    try {
      const form = e.target;
      const username = form.querySelector('[name="username"]').value;
      const password = form.querySelector('[name="password"]').value;

      const res = await postWithCsrf('/api/v1/auth/password', { username, password });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Login failed.');
      }
      window.location.href = APP_URL;
    } catch (err) {
      this.setState({ error: err.message, loading: false });
    }
  }

  async submitApiKey(e) {
    e.preventDefault();
    this.setState({ loading: true, error: null });
    try {
      const form = e.target;
      const apikey = form.querySelector('[name="apikey"]').value;

      const res = await postWithCsrf('/api/v1/auth/apikey', { apikey });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'API key login failed.');
      }
      window.location.href = APP_URL;
    } catch (err) {
      this.setState({ error: err.message, loading: false });
    }
  }

  static get styles() {
    return `
      .auth-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.7);
        display: flex; align-items: center; justify-content: center;
        z-index: 1000;
      }
      .auth-overlay[hidden] { display: none; }
      .auth-modal {
        background: #141414;
        border: 1px solid #2a2a2a;
        border-radius: 8px;
        padding: 2rem;
        width: 100%;
        max-width: 400px;
      }
      .auth-modal h2 {
        color: #fff;
        margin-bottom: 1.5rem;
        font-size: 1.2rem;
      }
      .auth-modal .auth-error {
        background: #2a1010;
        border: 1px solid #5a2020;
        color: #f88;
        padding: 0.5rem 0.75rem;
        border-radius: 4px;
        margin-bottom: 1rem;
        font-size: 0.85rem;
      }
      .auth-modal button, .auth-modal input[type="submit"] {
        width: 100%;
        padding: 0.6rem;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.95rem;
        margin-bottom: 0.5rem;
      }
      .auth-modal .btn-wallet {
        background: #fff;
        color: #0a0a0a;
        font-weight: 600;
      }
      .auth-modal .btn-wallet:hover { background: #e0e0e0; }
      .auth-modal .btn-wallet:disabled { opacity: 0.5; cursor: wait; }
      .auth-modal .btn-submit {
        background: #fff;
        color: #0a0a0a;
        font-weight: 600;
      }
      .auth-modal .auth-alt {
        margin-top: 1rem;
        text-align: center;
        font-size: 0.85rem;
        color: #888;
      }
      .auth-modal .auth-alt a {
        color: #aaa;
        text-decoration: underline;
        cursor: pointer;
      }
      .auth-modal .auth-alt a:hover { color: #fff; }
      .auth-modal input[type="text"],
      .auth-modal input[type="password"] {
        width: 100%;
        padding: 0.6rem;
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 4px;
        color: #e0e0e0;
        font-size: 0.95rem;
        margin-bottom: 0.75rem;
        box-sizing: border-box;
      }
      .auth-modal .back-link {
        display: block;
        text-align: center;
        margin-top: 0.75rem;
        color: #888;
        font-size: 0.85rem;
        cursor: pointer;
        text-decoration: none;
      }
      .auth-modal .back-link:hover { color: #fff; }
      .auth-close {
        float: right;
        background: none;
        border: none;
        color: #888;
        font-size: 1.5rem;
        cursor: pointer;
        width: auto !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .auth-close:hover { color: #fff; }
    `;
  }

  renderMain() {
    return [
      h('button', {
        className: 'btn-wallet',
        disabled: this.state.loading,
        onClick: this.bind(this.connectWallet)
      }, this.state.loading ? 'Connecting...' : 'Connect Wallet'),
      h('div', { className: 'auth-alt' },
        h('a', { onClick: () => this.setState({ view: 'password', error: null }) }, 'Username / Password'),
        ' or ',
        h('a', { onClick: () => this.setState({ view: 'apikey', error: null }) }, 'API Key')
      )
    ];
  }

  renderPasswordForm() {
    return h('form', { onSubmit: this.bind(this.submitPassword) },
      h('input', { type: 'text', name: 'username', placeholder: 'Username', required: true }),
      h('input', { type: 'password', name: 'password', placeholder: 'Password', required: true }),
      h('button', { type: 'submit', className: 'btn-submit', disabled: this.state.loading },
        this.state.loading ? 'Logging in...' : 'Login'),
      h('a', { className: 'back-link', onClick: () => this.setState({ view: 'main', error: null }) }, '\u2190 Back')
    );
  }

  renderApiKeyForm() {
    return h('form', { onSubmit: this.bind(this.submitApiKey) },
      h('input', { type: 'text', name: 'apikey', placeholder: 'API Key', required: true }),
      h('button', { type: 'submit', className: 'btn-submit', disabled: this.state.loading },
        this.state.loading ? 'Logging in...' : 'Login'),
      h('a', { className: 'back-link', onClick: () => this.setState({ view: 'main', error: null }) }, '\u2190 Back')
    );
  }

  render() {
    const { visible, view, error } = this.state;

    return h('div', {
      className: 'auth-overlay',
      hidden: !visible,
      onClick: (e) => { if (e.target.classList.contains('auth-overlay')) this.hide(); }
    },
      h('div', { className: 'auth-modal' },
        h('button', { className: 'auth-close', onClick: this.bind(this.hide) }, '\u00D7'),
        h('h2', null, 'Sign In'),
        error ? h('div', { className: 'auth-error' }, error) : null,
        view === 'main' ? this.renderMain() : null,
        view === 'password' ? this.renderPasswordForm() : null,
        view === 'apikey' ? this.renderApiKeyForm() : null
      )
    );
  }
}
