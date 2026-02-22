import { Component, h } from '@monygroupcorp/microact';

/**
 * VersionSelector — dropdown for switching between output versions.
 *
 * Props:
 *   versions        — array of output version objects
 *   currentIndex    — currently active version index (-1 for none)
 *   onVersionChange — (index) => void
 */
export class VersionSelector extends Component {
  constructor(props) {
    super(props);
    this.state = { open: false };
  }

  didMount() {
    this._outsideClick = (e) => {
      if (this.state.open && this._ref && !this._ref.contains(e.target)) {
        this.setState({ open: false });
      }
    };
    document.addEventListener('click', this._outsideClick);
    this.registerCleanup(() => document.removeEventListener('click', this._outsideClick));
  }

  static get styles() {
    return `
      .vs-root { position: relative; }
      .vs-btn { background: none; border: 1px solid #444; color: #888; padding: 2px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; }
      .vs-btn:hover { border-color: #666; color: #ccc; }
      .vs-menu { position: absolute; top: calc(100% + 4px); right: 0; background: #1a1a1a; border: 1px solid #444; border-radius: 6px; min-width: 140px; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.5); max-height: 200px; overflow-y: auto; }
      .vs-item { padding: 6px 12px; font-size: 12px; color: #ccc; cursor: pointer; }
      .vs-item:hover { background: rgba(255,255,255,0.05); }
      .vs-item--active { color: #90caf9; font-weight: 600; }
      .vs-item--pending { color: #f39c12; font-style: italic; }
    `;
  }

  render() {
    const { versions, currentIndex, onVersionChange } = this.props;
    if (!versions || versions.length === 0) return h('div', { style: 'display:none' });

    const { open } = this.state;
    const label = `v${currentIndex + 1}/${versions.length}`;

    return h('div', { className: 'vs-root', ref: (el) => { this._ref = el; } },
      h('button', {
        className: 'vs-btn',
        onclick: (e) => { e.stopPropagation(); this.setState({ open: !open }); },
      }, label),
      open ? h('div', { className: 'vs-menu' },
        ...versions.map((ver, i) => {
          const isPending = ver?._pending;
          const isActive = i === currentIndex;
          const cls = `vs-item${isActive ? ' vs-item--active' : ''}${isPending ? ' vs-item--pending' : ''}`;
          return h('div', {
            className: cls,
            key: i,
            onclick: () => { onVersionChange?.(i); this.setState({ open: false }); },
          }, isPending ? `v${i + 1} (pending)` : `v${i + 1}`);
        })
      ) : null
    );
  }
}
