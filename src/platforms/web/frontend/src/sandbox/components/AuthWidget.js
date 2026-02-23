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
      error: '',
      loading: false,
      showPicker: false,
      availableWallets: {},
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

  _minimize() { this.setState({ mode: 'badge', error: '', showPicker: false }); }
  _expand()   { this.setState({ mode: 'card' }); }

  _success() {
    this.setState({ mode: 'hidden', showPicker: false });
    eventBus.emit('auth:success');
    if (this.props.onSuccess) this.props.onSuccess();
  }

  async connectWallet() {
    this.setState({ loading: true, error: '' });
    try {
      // Re-trigger EIP-6963 discovery and wait for announcements.
      // Wallets must respond to eip6963:requestProvider per spec; this ensures
      // any wallet that announced before our listener was ready gets captured.
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      await new Promise(resolve => setTimeout(resolve, 200));

      // Diagnostics — check the raw eip6963Providers map and window injections
      const eip6963Entries = [...this.walletService.eip6963Providers.entries()]
        .map(([uuid, { info }]) => ({ uuid, rdns: info.rdns, name: info.name }));
      console.log('[AuthWidget] eip6963Providers:', eip6963Entries);
      console.log('[AuthWidget] window.phantom:', !!window.phantom, '| .ethereum:', !!window.phantom?.ethereum);
      console.log('[AuthWidget] window.ethereum:', !!window.ethereum, '| isMetaMask:', !!window.ethereum?.isMetaMask);

      const wallets = this.walletService.getAvailableWallets();
      const keys = Object.keys(wallets || {});
      console.log('[AuthWidget] getAvailableWallets() keys:', keys);

      if (keys.length === 0) {
        // Phantom installed but Ethereum not enabled (SES lockdown conflict or EVM disabled in settings)
        const phantomNoEvm = window.phantom && !window.phantom.ethereum;
        this.setState({
          error: phantomNoEvm
            ? 'Phantom detected but Ethereum is not enabled. In Phantom, go to Settings → Networks and enable Ethereum. Alternatively, install Rabby.'
            : 'No wallet extension found. Install Rabby or MetaMask to continue.',
          loading: false,
        });
        return;
      }

      if (keys.length > 1) {
        // Sort so Rabby appears first
        const sorted = {};
        const rabbyKey = keys.find(k => k === 'rabby' || k.includes('rabby'));
        if (rabbyKey) sorted[rabbyKey] = wallets[rabbyKey];
        for (const k of keys) { if (k !== rabbyKey) sorted[k] = wallets[k]; }
        this.setState({ availableWallets: sorted, showPicker: true, loading: false });
        return;
      }

      await this._connectWithKey(keys[0]);
    } catch (err) {
      this.setState({ error: err.message || 'Connection failed.', loading: false });
    }
  }

  async _connectWithKey(walletKey) {
    this.setState({ loading: true, error: '', showPicker: false });
    try {
      await this.walletService.connect(walletKey);
      const address = this.walletService.getAddress();
      console.log('[AuthWidget] connected address:', address);

      const nonceRes = await postWithCsrf('/api/v1/auth/web3/nonce', { address });
      if (!nonceRes.ok) { const e = await nonceRes.json(); throw new Error(e.error?.message || 'Failed to get nonce.'); }
      const { nonce } = await nonceRes.json();
      console.log('[AuthWidget] got nonce, signing...');

      const provider = this.walletService.ethersProvider;
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(nonce);
      console.log('[AuthWidget] signed, verifying...');

      const verifyRes = await postWithCsrf('/api/v1/auth/web3/verify', { address, signature });
      console.log('[AuthWidget] verify status:', verifyRes.status);
      if (!verifyRes.ok) { const e = await verifyRes.json(); throw new Error(e.error?.message || 'Verification failed.'); }

      console.log('[AuthWidget] auth complete, emitting success');
      this._success();
    } catch (err) {
      this.setState({ error: err.message || 'Connection failed.', loading: false });
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
      .aw-card button {
        width: 100%; padding: 0.65rem; border: none; border-radius: 4px;
        cursor: pointer; font-size: 0.95rem; margin-bottom: 0.5rem;
      }
      .aw-btn-wallet { background: #fff; color: #0a0a0a; font-weight: 600; }
      .aw-btn-wallet:hover { background: #e0e0e0; }
      .aw-btn-wallet:disabled { opacity: 0.5; cursor: wait; }
      .aw-hint { margin-top: 0.75rem; text-align: center; font-size: 0.8rem; color: #555; }
      .aw-hint a { color: #666; text-decoration: underline; }
      .aw-hint a:hover { color: #999; }
      .aw-picker-list { display: flex; flex-direction: column; gap: 8px; }
      .aw-wallet-opt {
        display: flex; align-items: center; gap: 12px;
        width: 100%; padding: 10px 14px; border: 1px solid #333;
        border-radius: 8px; background: #1a1a1a; color: #e0e0e0;
        font-size: 14px; cursor: pointer; text-align: left;
      }
      .aw-wallet-opt:hover { border-color: #555; background: #222; color: #fff; }
      .aw-wallet-opt img { width: 28px; height: 28px; border-radius: 4px; flex-shrink: 0; }
      .aw-wallet-opt span { flex: 1; }
    `;
  }

  render() {
    const { mode, error, loading, showPicker, availableWallets } = this.state;
    const isHidden = mode === 'hidden';
    const isBadge = mode === 'badge';
    const walletEntries = Object.entries(availableWallets);

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
            h('h3', null, showPicker ? 'Select Wallet' : 'Sign In'),
            h('button', { className: 'aw-minimize', onClick: this.bind(this._minimize) }, '\u2212')
          ),

          // Error — always rendered, hidden when empty
          h('div', {
            className: 'aw-error',
            style: error ? '' : 'display:none',
          }, error),

          // Connect button — hidden when picker is showing
          h('div', { style: showPicker ? 'display:none' : '' },
            h('button', {
              className: 'aw-btn-wallet',
              disabled: loading,
              onClick: this.bind(this.connectWallet),
            }, loading ? 'Connecting...' : 'Connect Wallet'),
            h('div', { className: 'aw-hint' },
              'We recommend ',
              h('a', { href: 'https://rabby.io', target: '_blank', rel: 'noopener noreferrer' }, 'Rabby Wallet')
            )
          ),

          // Wallet picker list — hidden when not needed
          h('div', { className: 'aw-picker-list', style: showPicker ? '' : 'display:none' },
            ...walletEntries.map(([key, w]) =>
              h('button', {
                className: 'aw-wallet-opt',
                onClick: () => this._connectWithKey(key),
              },
                h('img', { src: w.icon || '', alt: w.name, style: w.icon ? '' : 'display:none' }),
                h('span', null, w.name)
              )
            )
          )
        )
      )
    );
  }
}
