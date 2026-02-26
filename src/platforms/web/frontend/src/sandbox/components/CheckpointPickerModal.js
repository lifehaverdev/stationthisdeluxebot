import { Component, h } from '@monygroupcorp/microact';
import { fetchJson } from '../../lib/api.js';

/**
 * CheckpointPickerModal — overlay for selecting a checkpoint model.
 *
 * Props:
 *   visible       — boolean
 *   displayName   — param label (shown in header)
 *   currentValue  — current checkpoint value (highlighted in list)
 *   onSelect      — (checkpointName: string) => void
 *   onClose       — () => void
 */
export class CheckpointPickerModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      models: [],
      loading: false,
      error: null,
      search: '',
    };
    this._escHandler = null;
  }

  didMount() {
    this._escHandler = (e) => { if (e.key === 'Escape') this.props.onClose?.(); };
    document.addEventListener('keydown', this._escHandler);
    this._fetch();
    requestAnimationFrame(() => document.querySelector('.cpm-search')?.focus());
  }

  willUnmount() {
    document.removeEventListener('keydown', this._escHandler);
  }

  async _fetch() {
    this.setState({ loading: true, error: null });
    try {
      const data = await fetchJson('/api/v1/models?category=checkpoint&limit=200');
      this.setState({ models: data.models || [], loading: false });
    } catch {
      this.setState({ loading: false, error: 'Failed to load checkpoints.' });
    }
  }

  _modelName(m) {
    return (m.path || m.save_path || m.name || '').split('/').pop() || m.name || '';
  }

  _filtered() {
    const q = this.state.search.trim().toLowerCase();
    return this.state.models.filter(m => {
      const name = this._modelName(m).toLowerCase();
      return !q || name.includes(q);
    });
  }

  _select(m) {
    this.props.onSelect?.(this._modelName(m));
  }

  static get styles() {
    return `
      .cpm-backdrop {
        position: fixed;
        inset: 0;
        z-index: var(--z-modal, 900);
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .cpm-panel {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        width: min(560px, 92vw);
        max-height: 72vh;
        display: flex;
        flex-direction: column;
        animation: fadeUp var(--dur-trans) var(--ease);
      }
      .cpm-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: var(--border-width) solid var(--border);
        background: var(--surface-3);
        flex-shrink: 0;
      }
      .cpm-title {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-secondary);
      }
      .cpm-close {
        background: none;
        border: none;
        color: var(--text-label);
        cursor: pointer;
        font-size: 19px;
        line-height: 1;
        padding: 0;
        transition: color var(--dur-micro) var(--ease);
      }
      .cpm-close:hover { color: var(--text-secondary); }
      .cpm-search-wrap {
        padding: 8px 10px;
        border-bottom: var(--border-width) solid var(--border);
        flex-shrink: 0;
        background: var(--surface-2);
      }
      .cpm-search {
        width: 100%;
        background: var(--surface-3);
        border: var(--border-width) solid var(--border);
        color: var(--text-primary);
        font-family: var(--ff-mono);
        font-size: var(--fs-sm);
        padding: 5px 8px;
        outline: none;
        transition: border-color var(--dur-micro) var(--ease);
        box-sizing: border-box;
      }
      .cpm-search:focus { border-color: var(--accent-border); }
      .cpm-search::placeholder { color: var(--text-label); }
      .cpm-list {
        flex: 1;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .cpm-item {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        border-bottom: var(--border-width) solid var(--border);
        cursor: pointer;
        gap: 10px;
        transition: background var(--dur-micro) var(--ease);
      }
      .cpm-item:last-child { border-bottom: none; }
      .cpm-item:hover { background: var(--surface-3); }
      .cpm-item--active {
        background: var(--accent-dim);
        border-color: var(--accent-border);
      }
      .cpm-item--active:hover { background: var(--accent-dim); }
      .cpm-item-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--accent);
        flex-shrink: 0;
        opacity: 0;
      }
      .cpm-item--active .cpm-item-dot { opacity: 1; }
      .cpm-item-name {
        font-family: var(--ff-mono);
        font-size: var(--fs-sm);
        color: var(--text-primary);
        word-break: break-word;
      }
      .cpm-item--active .cpm-item-name { color: var(--accent); }
      .cpm-empty {
        padding: 24px 12px;
        font-family: var(--ff-mono);
        font-size: var(--fs-sm);
        color: var(--text-label);
        text-align: center;
      }
      .cpm-count {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        padding: 4px 10px 4px;
        flex-shrink: 0;
        border-top: var(--border-width) solid var(--border);
        background: var(--surface-3);
      }
    `;
  }

  render() {
    if (!this.props.visible) return null;

    const { loading, error, search } = this.state;
    const { displayName, currentValue, onClose } = this.props;
    const filtered = this._filtered();

    return h('div', {
      className: 'cpm-backdrop',
      onmousedown: () => onClose?.(),
    },
      h('div', {
        className: 'cpm-panel',
        onmousedown: (e) => e.stopPropagation(),
      },
        h('div', { className: 'cpm-header' },
          h('span', { className: 'cpm-title' }, displayName || 'Choose Checkpoint'),
          h('button', { className: 'cpm-close', onclick: () => onClose?.() }, '\u00D7'),
        ),
        h('div', { className: 'cpm-search-wrap' },
          h('input', {
            className: 'cpm-search',
            type: 'text',
            placeholder: 'search checkpoints...',
            value: search,
            oninput: (e) => this.setState({ search: e.target.value }),
          })
        ),
        h('div', { className: 'cpm-list' },
          loading
            ? h('div', { className: 'cpm-empty' }, 'Loading...')
            : error
              ? h('div', { className: 'cpm-empty' }, error)
              : filtered.length === 0
                ? h('div', { className: 'cpm-empty' }, search ? 'No matches.' : 'No checkpoints found.')
                : filtered.map(m => {
                    const name = this._modelName(m);
                    const active = name === currentValue;
                    return h('div', {
                      key: name,
                      className: `cpm-item${active ? ' cpm-item--active' : ''}`,
                      onclick: () => this._select(m),
                    },
                      h('span', { className: 'cpm-item-dot' }),
                      h('span', { className: 'cpm-item-name' }, name),
                    );
                  })
        ),
        !loading && !error
          ? h('div', { className: 'cpm-count' },
              `${filtered.length} checkpoint${filtered.length !== 1 ? 's' : ''}${search ? ' matched' : ''}`)
          : null,
      )
    );
  }
}
