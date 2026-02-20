import { Component, h } from '@monygroupcorp/microact';
import { fetchJson } from '../../lib/api.js';
import { HistoryModal } from './HistoryModal.js';
import { ApiKeysModal } from './ApiKeysModal.js';

function shortenWallet(addr) {
  if (!addr) return '';
  if (addr.startsWith('0x1152')) return addr.slice(0, 10) + '...' + addr.slice(-4);
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

export class AccountDropdown extends Component {
  constructor(props) {
    super(props);
    this.state = { open: false, loading: true, error: null, data: null, showHistory: false, showApiKeys: false };
  }

  didMount() {
    this._fetch();
    this._outsideClick = (e) => {
      if (this.state.open && this._ref && !this._ref.contains(e.target)) {
        this.setState({ open: false });
      }
    };
    document.addEventListener('click', this._outsideClick);
    this.registerCleanup(() => document.removeEventListener('click', this._outsideClick));
  }

  async _fetch() {
    try {
      const data = await fetchJson('/api/v1/user/dashboard');
      this.setState({ data, loading: false });
    } catch (err) {
      this.setState({ error: err.message, loading: false });
    }
  }

  fetchDashboard() { this._fetch(); }

  _toggle(e) {
    e.stopPropagation();
    this.setState({ open: !this.state.open });
  }

  _action(name, e) {
    e.preventDefault();
    this.setState({ open: false });
    switch (name) {
      case 'history': this.setState({ showHistory: true }); break;
      case 'apikeys': this.setState({ showApiKeys: true }); break;
      case 'get-more-points':
        if (window.openBuyPointsModal) window.openBuyPointsModal();
        break;
      case 'setup-referral':
        if (window.openReferralVaultModal) window.openReferralVaultModal();
        break;
      case 'logout': window.location.href = '/logout'; break;
    }
  }

  static get styles() {
    return `
      .acct-root { position: relative; }
      .acct-btn { background: none; border: 1px solid #333; color: #ccc; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }
      .acct-btn:hover { border-color: #555; color: #fff; }
      .acct-menu { position: absolute; top: calc(100% + 4px); right: 0; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; min-width: 240px; z-index: 200; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
      .acct-header { padding: 12px 16px; font-weight: 600; border-bottom: 1px solid #222; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
      .acct-item { padding: 8px 16px; font-size: 14px; color: #ccc; }
      .acct-item b { color: #fff; }
      .acct-actions { border-top: 1px solid #222; padding: 8px 0; }
      .acct-action { display: block; padding: 8px 16px; color: #90caf9; font-size: 13px; text-decoration: none; cursor: pointer; }
      .acct-action:hover { background: rgba(255,255,255,0.05); }
      .exp-bar { background: #333; border-radius: 4px; height: 6px; width: 100%; margin: 4px 0; }
      .exp-fill { background: #90caf9; height: 6px; border-radius: 4px; transition: width 0.3s; }
    `;
  }

  _renderMenu() {
    const { loading, data, error } = this.state;
    const items = [];

    if (loading) items.push(h('div', { className: 'acct-item' }, 'Loading...'));
    if (error && !data) items.push(h('div', { className: 'acct-item', style: 'color:#f44' }, error));

    if (data) {
      items.push(h('div', { className: 'acct-item' }, h('b', null, data.username)));
      items.push(h('div', { className: 'acct-item' }, `Level ${data.level}`));
      items.push(h('div', { className: 'acct-item' },
        h('div', { className: 'exp-bar' },
          h('div', { className: 'exp-fill', style: `width:${Math.round((data.levelProgressRatio || 0) * 100)}%` })
        )
      ));
      items.push(h('div', { className: 'acct-item' }, `Points: ${data.points}`));
      items.push(h('a', { className: 'acct-action', href: '#', onclick: (e) => this._action('get-more-points', e) }, 'Get More Points'));
    }

    return h('div', { className: 'acct-menu' },
      h('div', { className: 'acct-header' }, 'Account'),
      ...items,
      h('div', { className: 'acct-actions' },
        h('a', { className: 'acct-action', href: '#', onclick: (e) => this._action('history', e) }, 'History'),
        h('a', { className: 'acct-action', href: '#', onclick: (e) => this._action('apikeys', e) }, 'API Keys'),
        h('a', { className: 'acct-action', href: '#', onclick: (e) => this._action('logout', e) }, 'Logout')
      )
    );
  }

  render() {
    const { open, data, showHistory, showApiKeys } = this.state;
    const label = data?.wallet ? shortenWallet(data.wallet) : 'Account';

    return h('div', { className: 'acct-root', ref: (el) => { this._ref = el; } },
      h('button', { className: 'acct-btn', onclick: this.bind(this._toggle) }, label),
      open ? this._renderMenu() : null,
      showHistory ? h(HistoryModal, { onClose: () => this.setState({ showHistory: false }) }) : null,
      showApiKeys ? h(ApiKeysModal, { onClose: () => this.setState({ showApiKeys: false }) }) : null
    );
  }
}
