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
      /* Badge — minimized corner state */
      .aw-badge {
        position: fixed;
        top: 12px; right: 12px;
        z-index: var(--z-modal);
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        cursor: pointer;
        padding: 5px 12px;
        transition: border-color var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease);
      }
      .aw-badge:hover { border-color: var(--border-hover); color: var(--text-secondary); }

      /* Overlay backdrop */
      .aw-overlay {
        position: fixed; inset: 0;
        z-index: var(--z-modal);
        display: flex; align-items: center; justify-content: center;
        background: rgba(11,12,13,0.85);
        pointer-events: all;
        animation: fadeIn var(--dur-trans) var(--ease);
      }

      /* Instrument panel */
      .aw-card {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        width: 320px;
        padding: 0;
        position: relative;
        animation: fadeUp var(--dur-trans) var(--ease);
      }
      /* Corner brackets */
      .aw-card::before,
      .aw-card::after {
        content: '';
        position: absolute;
        width: 10px; height: 10px;
        border-color: var(--border-hover);
        border-style: solid;
        pointer-events: none;
      }
      .aw-card::before { top: -1px; left: -1px; border-width: 1px 0 0 1px; }
      .aw-card::after  { bottom: -1px; right: -1px; border-width: 0 1px 1px 0; }

      /* Header strip */
      .aw-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 16px;
        border-bottom: var(--border-width) solid var(--border);
        background: var(--surface-3);
      }
      .aw-header h3 {
        font-family: var(--ff-condensed);
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-primary);
        margin: 0;
      }
      .aw-minimize {
        background: none;
        border: var(--border-width) solid transparent;
        color: var(--text-label);
        font-size: 16px;
        cursor: pointer;
        padding: 0;
        width: 22px; height: 22px;
        display: flex; align-items: center; justify-content: center;
        transition: color var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease);
      }
      .aw-minimize:hover { color: var(--danger); border-color: var(--danger); }

      /* Body */
      .aw-error {
        background: var(--danger-dim);
        border: var(--border-width) solid var(--danger);
        color: var(--danger);
        padding: 8px 12px;
        margin: 12px 16px;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
      }

      /* Action buttons */
      .aw-card button {
        width: 100%;
        padding: 10px 16px;
        border: var(--border-width) solid var(--border);
        cursor: pointer;
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        background: var(--surface-1);
        color: var(--text-secondary);
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition:
          background  var(--dur-interact) var(--ease),
          border-color var(--dur-interact) var(--ease),
          color       var(--dur-interact) var(--ease);
      }
      .aw-card button:hover {
        background: var(--accent-dim);
        border-color: var(--accent-border);
        color: var(--accent);
      }
      .aw-btn-wallet:disabled { opacity: 0.35; cursor: not-allowed; }
      .aw-btn-wallet:disabled:hover {
        background: var(--surface-1);
        border-color: var(--border);
        color: var(--text-secondary);
      }

      .aw-hint {
        margin-top: 8px;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        letter-spacing: var(--ls-wide);
      }
      .aw-hint a { color: var(--text-label); text-decoration: underline; }
      .aw-hint a:hover { color: var(--text-secondary); }

      /* Wallet picker */
      .aw-picker-list { display: flex; flex-direction: column; gap: 0; }
      .aw-wallet-opt {
        display: flex; align-items: center; gap: 12px;
        width: 100%; padding: 10px 14px;
        border: var(--border-width) solid var(--border);
        border-top: none;
        background: var(--surface-1);
        color: var(--text-secondary);
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        cursor: pointer; text-align: left;
        transition:
          background  var(--dur-interact) var(--ease),
          border-color var(--dur-interact) var(--ease),
          color       var(--dur-interact) var(--ease);
      }
      .aw-wallet-opt:first-child { border-top: var(--border-width) solid var(--border); }
      .aw-wallet-opt:hover { border-color: var(--accent-border); background: var(--accent-dim); color: var(--accent); }
      .aw-wallet-opt img { width: 24px; height: 24px; flex-shrink: 0; }
      .aw-wallet-opt span { flex: 1; }

      /* Inner body padding wrapper */
      .aw-body { padding: 16px; }
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
