import { Component, h } from '@monygroupcorp/microact';
import { Modal, Loader, ModalError } from './Modal.js';
import { fetchJson, postWithCsrf, fetchWithCsrf } from '../../lib/api.js';

export class ApiKeysModal extends Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: null, keys: [], creating: false, newKeyName: '', newKey: null, copied: false };
  }

  didMount() { this._fetchKeys(); }

  async _fetchKeys() {
    this.setState({ loading: true, error: null });
    try {
      const keys = await fetchJson('/api/v1/user/apikeys');
      this.setState({ keys, loading: false });
    } catch (err) {
      this.setState({ error: err.message, loading: false });
    }
  }

  async _createKey() {
    const name = this.state.newKeyName.trim();
    if (!name) return;
    this.setState({ creating: true, error: null });
    try {
      const res = await postWithCsrf('/api/v1/user/apikeys', { name });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || 'Failed to create key');
      }
      const newKey = await res.json();
      this.setState({ creating: false, newKeyName: '', newKey });
      this._fetchKeys();
    } catch (err) {
      this.setState({ error: err.message, creating: false });
    }
  }

  async _deleteKey(prefix) {
    if (!confirm('Delete this API key? This cannot be undone.')) return;
    try {
      const res = await fetchWithCsrf(`/api/v1/user/apikeys/${prefix}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete key');
      this._fetchKeys();
    } catch (err) {
      this.setState({ error: err.message });
    }
  }

  _copy(text) {
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      this.setTimeout(() => this.setState({ copied: false }), 1500);
    });
  }

  static get styles() {
    return `
      .ak-create { display: flex; gap: 8px; margin: 16px 0; }
      .ak-create input { flex: 1; background: var(--surface-1); border: var(--border-width) solid var(--border); color: var(--text-primary); padding: 8px 12px; border-radius: 0; font-size: var(--fs-md); }
      .ak-create input:focus { border-color: var(--accent-border); outline: none; }
      .ak-create button { background: var(--surface-2); border: var(--border-width) solid var(--border); color: var(--text-secondary); padding: 8px 16px; border-radius: 0; cursor: pointer; white-space: nowrap; }
      .ak-create button:disabled { opacity: 0.4; cursor: default; }
      .ak-create button:not(:disabled):hover { border-color: var(--border-hover); color: var(--text-primary); }
      .ak-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: var(--border-width) solid var(--border); }
      .ak-info { display: flex; flex-direction: column; gap: 2px; }
      .ak-name { font-weight: 600; font-size: var(--fs-md); }
      .ak-prefix { font-family: var(--ff-mono); font-size: var(--fs-xs); color: var(--text-secondary); }
      .ak-meta { font-size: var(--fs-sm); color: var(--text-label); }
      .ak-del { background: var(--danger-dim); border: var(--border-width) solid var(--danger); color: var(--danger); padding: 4px 10px; border-radius: 0; cursor: pointer; font-size: var(--fs-xs); }
      .ak-del:hover { opacity: 0.85; }
      .ak-newkey { background: var(--canvas-bg); border: var(--border-width) solid var(--border); border-radius: 0; padding: 12px; margin: 12px 0; display: flex; gap: 8px; align-items: center; }
      .ak-newkey code { flex: 1; word-break: break-all; font-size: var(--fs-base); color: var(--accent); font-family: var(--ff-mono); }
      .ak-newkey button { background: var(--surface-2); border: var(--border-width) solid var(--border); color: var(--text-secondary); padding: 6px 12px; border-radius: 0; cursor: pointer; }
      .ak-warn { color: var(--accent); font-size: var(--fs-base); margin-bottom: 8px; }
      .ak-done { background: var(--surface-2); border: var(--border-width) solid var(--border); color: var(--text-secondary); padding: 8px 20px; border-radius: 0; cursor: pointer; margin-top: 12px; }
    `;
  }

  _renderNewKey() {
    const { newKey, copied } = this.state;
    return h('div', null,
      h('p', { className: 'ak-warn' }, "Copy this key now. You won't be able to see it again!"),
      h('div', { className: 'ak-newkey' },
        h('code', null, newKey.apiKey),
        h('button', { onclick: () => this._copy(newKey.apiKey) }, copied ? 'Copied!' : 'Copy')
      ),
      h('p', null, 'Name: ', h('strong', null, newKey.name)),
      h('button', { className: 'ak-done', onclick: () => this.setState({ newKey: null }) }, 'Done')
    );
  }

  _renderList() {
    const { keys, creating, newKeyName, error } = this.state;
    return h('div', null,
      ModalError({ message: error }),
      h('div', { className: 'ak-create' },
        h('input', {
          placeholder: 'Key name (e.g., My App)',
          value: newKeyName,
          disabled: creating,
          oninput: (e) => this.setState({ newKeyName: e.target.value }),
          onkeydown: (e) => { if (e.key === 'Enter' && newKeyName.trim()) this._createKey(); }
        }),
        h('button', {
          disabled: creating || !newKeyName.trim(),
          onclick: this.bind(this._createKey)
        }, creating ? 'Creating...' : 'Create Key')
      ),
      keys.length === 0
        ? h('p', { style: 'color:var(--text-label);font-size:var(--fs-md);padding:12px 0' }, 'No API keys yet.')
        : keys.map(key =>
          h('div', { className: 'ak-item', key: key.keyPrefix },
            h('div', { className: 'ak-info' },
              h('span', { className: 'ak-name' }, key.name),
              h('span', { className: 'ak-prefix' }, `${key.keyPrefix}...`),
              h('span', { className: 'ak-meta' }, `Created: ${key.createdAt ? new Date(key.createdAt).toLocaleDateString() : 'N/A'}`)
            ),
            h('button', { className: 'ak-del', onclick: () => this._deleteKey(key.keyPrefix) }, 'Delete')
          )
        )
    );
  }

  render() {
    const { loading, newKey } = this.state;
    const title = newKey ? 'API Key Created' : 'API Keys';

    let body;
    if (newKey) body = this._renderNewKey();
    else if (loading) body = h(Loader, { message: 'Loading keys...' });
    else body = this._renderList();

    return h(Modal, { onClose: this.props.onClose, title, content: [body] });
  }
}
