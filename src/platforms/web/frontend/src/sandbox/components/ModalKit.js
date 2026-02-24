import { Component, h } from '@monygroupcorp/microact';

/**
 * CopyButton — click-to-copy with "Copied!" feedback.
 *
 * Props:
 *   text   — the string to copy to clipboard
 *   label  — display text (default: "Copy")
 */
export class CopyButton extends Component {
  constructor(props) {
    super(props);
    this.state = { copied: false };
  }

  _copy() {
    navigator.clipboard.writeText(this.props.text).then(() => {
      this.setState({ copied: true });
      this.setTimeout(() => this.setState({ copied: false }), 1500);
    });
  }

  static get styles() {
    return `
      .mk-copy {
        background: none;
        border: var(--border-width) solid transparent;
        color: var(--accent);
        cursor: pointer;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        padding: 2px 6px;
        transition: border-color var(--dur-micro) var(--ease), background var(--dur-micro) var(--ease);
      }
      .mk-copy:hover { background: var(--accent-dim); border-color: var(--accent-border); }
      .mk-copy--done { color: var(--success); }
    `;
  }

  render() {
    const { label } = this.props;
    const { copied } = this.state;
    return h('button', {
      className: `mk-copy${copied ? ' mk-copy--done' : ''}`,
      onclick: this.bind(this._copy),
    }, copied ? 'Copied!' : (label || 'Copy'));
  }
}

/**
 * AsyncButton — button with loading spinner during async operations.
 *
 * Props:
 *   onclick   — async handler
 *   loading   — if true, shows spinner and disables
 *   disabled  — additional disable condition
 *   className — extra classes
 *   label     — button text (microact does not inject h() children into props)
 *   variant   — 'primary' | 'secondary' | 'danger' (default: 'primary')
 */
export class AsyncButton extends Component {
  static get styles() {
    return `
      .mk-btn {
        padding: 8px 20px;
        border: var(--border-width) solid transparent;
        cursor: pointer;
        font-family: var(--ff-condensed);
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        display: inline-flex; align-items: center; gap: 6px;
        transition: background var(--dur-interact) var(--ease), color var(--dur-interact) var(--ease), border-color var(--dur-interact) var(--ease);
      }
      .mk-btn:disabled { opacity: 0.35; cursor: not-allowed; }
      .mk-btn--primary { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); }
      .mk-btn--primary:not(:disabled):hover { background: var(--accent); color: var(--canvas-bg); border-color: var(--accent); }
      .mk-btn--secondary { background: var(--surface-2); color: var(--text-secondary); border-color: var(--border); }
      .mk-btn--secondary:not(:disabled):hover { border-color: var(--border-hover); color: var(--text-primary); }
      .mk-btn--danger { background: var(--danger-dim); color: var(--danger); border-color: var(--danger); }
      .mk-btn--danger:not(:disabled):hover { background: var(--danger); color: var(--canvas-bg); }
      .mk-btn-spinner { width: 13px; height: 13px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: mk-spin 0.6s linear infinite; }
      @keyframes mk-spin { to { transform: rotate(360deg); } }
    `;
  }

  render() {
    const { onclick, loading, disabled, className, label, variant } = this.props;
    const v = variant || 'primary';
    const cls = `mk-btn mk-btn--${v}${className ? ' ' + className : ''}`;

    return h('button', {
      className: cls,
      disabled: loading || disabled,
      onclick,
    },
      loading ? h('span', { className: 'mk-btn-spinner' }) : null,
      label || null
    );
  }
}

/**
 * EmptyState — centered message with optional call-to-action.
 *
 * Props:
 *   icon     — emoji or short text (optional)
 *   message  — main message
 *   action   — CTA button label (optional)
 *   onAction — CTA click handler
 */
export class EmptyState extends Component {
  static get styles() {
    return `
      .mk-empty { text-align: center; padding: 32px 16px; color: var(--text-secondary); }
      .mk-empty-icon { font-size: 32px; margin-bottom: 12px; opacity: 0.5; }
      .mk-empty-msg {
        font-family: var(--ff-sans);
        font-size: var(--fs-base);
        color: var(--text-secondary);
        margin-bottom: 16px;
        line-height: 1.5;
      }
      .mk-empty-cta {
        background: var(--accent-dim);
        color: var(--accent);
        border: var(--border-width) solid var(--accent-border);
        padding: 8px 20px;
        cursor: pointer;
        font-family: var(--ff-condensed);
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        transition: background var(--dur-interact) var(--ease), color var(--dur-interact) var(--ease);
      }
      .mk-empty-cta:hover { background: var(--accent); color: var(--canvas-bg); }
    `;
  }

  render() {
    const { icon, message, action, onAction } = this.props;
    return h('div', { className: 'mk-empty' },
      icon ? h('div', { className: 'mk-empty-icon' }, icon) : null,
      h('div', { className: 'mk-empty-msg' }, message),
      action ? h('button', { className: 'mk-empty-cta', onclick: onAction }, action) : null
    );
  }
}

/**
 * ConfirmInline — inline yes/no confirmation replacing browser confirm().
 *
 * Props:
 *   message   — confirmation prompt
 *   onConfirm — called on yes
 *   onCancel  — called on no
 *   confirmLabel — button text (default: "Confirm")
 *   cancelLabel  — button text (default: "Cancel")
 */
/**
 * TabBar — horizontal tab switcher.
 *
 * Props:
 *   tabs     — [{ key: string, label: string }]
 *   active   — currently active tab key
 *   onChange — (key) => void
 */
export class TabBar extends Component {
  static get styles() {
    return `
      .mk-tabs { display: flex; border-bottom: var(--border-width) solid var(--border); margin-bottom: 16px; }
      .mk-tab {
        background: none; border: none; border-bottom: 2px solid transparent;
        color: var(--text-label);
        padding: 10px 20px;
        font-family: var(--ff-condensed);
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        cursor: pointer;
        transition: color var(--dur-interact) var(--ease), border-color var(--dur-interact) var(--ease);
      }
      .mk-tab:hover { color: var(--text-secondary); }
      .mk-tab--active { color: var(--text-primary); border-bottom-color: var(--accent); }
    `;
  }

  render() {
    const { tabs, active, onChange } = this.props;
    return h('div', { className: 'mk-tabs' },
      ...(tabs || []).map(t =>
        h('button', {
          className: `mk-tab${t.key === active ? ' mk-tab--active' : ''}`,
          onclick: () => onChange?.(t.key),
        }, t.label)
      )
    );
  }
}

/**
 * SearchBar — input + search button combo.
 *
 * Props:
 *   value       — current search string
 *   placeholder — input placeholder
 *   onInput     — (value) => void
 *   onSearch    — () => void (called on Enter or button click)
 */
export class SearchBar extends Component {
  static get styles() {
    return `
      .mk-search { display: flex; gap: 8px; margin-bottom: 12px; }
      .mk-search-input {
        flex: 1;
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        color: var(--text-primary);
        padding: 8px 12px;
        font-family: var(--ff-sans);
        font-size: var(--fs-base);
        outline: none;
        transition: border-color var(--dur-micro) var(--ease);
      }
      .mk-search-input:focus { border-color: var(--accent-border); }
      .mk-search-input::placeholder { color: var(--text-label); }
      .mk-search-btn {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        color: var(--text-secondary);
        padding: 8px 14px;
        cursor: pointer;
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        transition: border-color var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease);
      }
      .mk-search-btn:hover { border-color: var(--border-hover); color: var(--text-primary); }
    `;
  }

  render() {
    const { value, placeholder, onInput, onSearch } = this.props;
    return h('div', { className: 'mk-search' },
      h('input', {
        className: 'mk-search-input',
        type: 'text',
        value: value || '',
        placeholder: placeholder || 'Search...',
        oninput: (e) => onInput?.(e.target.value),
        onkeydown: (e) => { if (e.key === 'Enter') onSearch?.(); },
      }),
      h('button', { className: 'mk-search-btn', onclick: () => onSearch?.() }, 'Search')
    );
  }
}

/**
 * TagPills — horizontal scrollable tag filter pills.
 *
 * Props:
 *   tags     — [string]
 *   active   — currently selected tag (null for "all")
 *   onSelect — (tag | null) => void
 */
export class TagPills extends Component {
  static get styles() {
    return `
      .mk-pills { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
      .mk-pill {
        background: var(--surface-1);
        border: var(--border-width) solid var(--border);
        color: var(--text-label);
        padding: 3px 10px;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        cursor: pointer;
        transition: border-color var(--dur-micro) var(--ease), color var(--dur-micro) var(--ease), background var(--dur-micro) var(--ease);
      }
      .mk-pill:hover { border-color: var(--border-hover); color: var(--text-secondary); }
      .mk-pill--active { background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent); }
    `;
  }

  render() {
    const { tags, active, onSelect } = this.props;
    return h('div', { className: 'mk-pills' },
      h('button', {
        className: `mk-pill${active == null ? ' mk-pill--active' : ''}`,
        onclick: () => onSelect?.(null),
      }, 'All'),
      ...(tags || []).map(tag =>
        h('button', {
          className: `mk-pill${tag === active ? ' mk-pill--active' : ''}`,
          onclick: () => onSelect?.(tag),
        }, tag)
      )
    );
  }
}

/**
 * Badge — small status label.
 *
 * Props:
 *   label   — text to display
 *   variant — 'default' | 'success' | 'warning' | 'info' (default: 'default')
 */
export class Badge extends Component {
  static get styles() {
    return `
      .mk-badge {
        display: inline-block;
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        padding: 2px 7px;
        text-transform: uppercase;
        letter-spacing: var(--ls-wide);
        font-weight: var(--fw-medium);
      }
      .mk-badge--default { background: var(--surface-3); color: var(--text-label); border: var(--border-width) solid var(--border); }
      .mk-badge--success { background: var(--accent-dim); color: var(--accent); border: var(--border-width) solid var(--accent-border); }
      .mk-badge--warning { background: rgba(255,180,0,0.10); color: rgba(255,180,0,0.85); border: var(--border-width) solid rgba(255,180,0,0.25); }
      .mk-badge--info { background: var(--accent-dim); color: var(--accent); border: var(--border-width) solid var(--accent-border); }
    `;
  }

  render() {
    const { label, variant } = this.props;
    return h('span', { className: `mk-badge mk-badge--${variant || 'default'}` }, label);
  }
}

export class ConfirmInline extends Component {
  static get styles() {
    return `
      .mk-confirm {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        padding: 16px;
        margin: 12px 0;
      }
      .mk-confirm-msg {
        font-family: var(--ff-sans);
        font-size: var(--fs-base);
        color: var(--text-secondary);
        margin-bottom: 12px;
      }
      .mk-confirm-btns { display: flex; gap: 8px; justify-content: flex-end; }
    `;
  }

  render() {
    const { message, onConfirm, onCancel, confirmLabel, cancelLabel } = this.props;
    return h('div', { className: 'mk-confirm' },
      h('div', { className: 'mk-confirm-msg' }, message),
      h('div', { className: 'mk-confirm-btns' },
        h(AsyncButton, { variant: 'secondary', onclick: onCancel, label: cancelLabel || 'Cancel' }),
        h(AsyncButton, { variant: 'danger', onclick: onConfirm, label: confirmLabel || 'Confirm' })
      )
    );
  }
}
