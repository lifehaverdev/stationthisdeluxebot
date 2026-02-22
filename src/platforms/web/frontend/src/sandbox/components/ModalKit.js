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
      .mk-copy { background: none; border: none; color: #90caf9; cursor: pointer; font-size: 12px; padding: 2px 6px; border-radius: 3px; }
      .mk-copy:hover { background: rgba(144,202,249,0.1); }
      .mk-copy--done { color: #2ecc71; }
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
      .mk-btn { padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; gap: 6px; }
      .mk-btn:disabled { opacity: 0.4; cursor: default; }
      .mk-btn--primary { background: #3f51b5; color: #fff; }
      .mk-btn--primary:not(:disabled):hover { background: #4a5bc7; }
      .mk-btn--secondary { background: #333; color: #ccc; border: 1px solid #555; }
      .mk-btn--secondary:not(:disabled):hover { background: #444; }
      .mk-btn--danger { background: #633; color: #faa; border: 1px solid #844; }
      .mk-btn--danger:not(:disabled):hover { background: #744; }
      .mk-btn-spinner { width: 14px; height: 14px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: mk-spin 0.6s linear infinite; }
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
      .mk-empty { text-align: center; padding: 32px 16px; color: #888; }
      .mk-empty-icon { font-size: 32px; margin-bottom: 12px; }
      .mk-empty-msg { font-size: 14px; margin-bottom: 16px; line-height: 1.5; }
      .mk-empty-cta { background: #3f51b5; color: #fff; border: none; padding: 10px 24px; border-radius: 6px; cursor: pointer; font-size: 14px; }
      .mk-empty-cta:hover { background: #4a5bc7; }
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
      .mk-tabs { display: flex; gap: 0; border-bottom: 1px solid #333; margin-bottom: 16px; }
      .mk-tab { background: none; border: none; border-bottom: 2px solid transparent; color: #888; padding: 10px 20px; font-size: 14px; cursor: pointer; transition: color 0.15s, border-color 0.15s; }
      .mk-tab:hover { color: #ccc; }
      .mk-tab--active { color: #fff; border-bottom-color: #90caf9; }
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
      .mk-search-input { flex: 1; background: #222; border: 1px solid #444; color: #e0e0e0; padding: 8px 12px; border-radius: 6px; font-size: 14px; }
      .mk-search-input:focus { border-color: #90caf9; outline: none; }
      .mk-search-btn { background: #333; border: 1px solid #555; color: #ccc; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
      .mk-search-btn:hover { background: #444; }
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
      .mk-pill { background: #222; border: 1px solid #444; color: #aaa; padding: 4px 12px; border-radius: 16px; font-size: 12px; cursor: pointer; transition: all 0.15s; }
      .mk-pill:hover { border-color: #666; color: #ccc; }
      .mk-pill--active { background: #3f51b5; border-color: #3f51b5; color: #fff; }
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
      .mk-badge { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
      .mk-badge--default { background: rgba(255,255,255,0.08); color: #999; }
      .mk-badge--success { background: rgba(46,204,113,0.12); color: #2ecc71; }
      .mk-badge--warning { background: rgba(243,156,18,0.12); color: #f39c12; }
      .mk-badge--info { background: rgba(144,202,249,0.12); color: #90caf9; }
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
      .mk-confirm { background: rgba(255,255,255,0.04); border: 1px solid #444; border-radius: 8px; padding: 16px; margin: 12px 0; }
      .mk-confirm-msg { font-size: 14px; color: #ccc; margin-bottom: 12px; }
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
