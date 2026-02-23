import { Component, h, eventBus } from '@monygroupcorp/microact';

/**
 * MintSpellFAB — floating action button shown when 2+ connected nodes are selected.
 * Clicking serializes the selected subgraph and emits an event for
 * SandboxHeader to open SpellsModal in create mode.
 *
 * Visibility driven by sandbox:selectionChanged events emitted by SandboxCanvas.
 * Requires: selection has 2+ nodes AND at least one connection between them.
 */
export class MintSpellFAB extends Component {
  constructor(props) {
    super(props);
    this.state = { visible: false, x: 0, y: 0 };
    this._selectedIds = new Set();
  }

  didMount() {
    this._onSelectionChanged = ({ ids, count, hasConnections, pos }) => {
      this._selectedIds = ids;
      const visible = count >= 2 && hasConnections;
      if (visible && pos) {
        // Clamp to viewport so button stays fully on screen
        const btnW = 148, btnH = 30;
        const x = Math.min(pos.x + 12, window.innerWidth  - btnW - 8);
        const y = Math.min(Math.max(8, pos.y - btnH / 2), window.innerHeight - btnH - 8);
        this.setState({ visible, x, y });
      } else {
        this.setState({ visible: false });
      }
    };
    eventBus.on('sandbox:selectionChanged', this._onSelectionChanged);
  }

  willUnmount() {
    eventBus.off('sandbox:selectionChanged', this._onSelectionChanged);
  }

  async _handleClick() {
    const ids = this._selectedIds;
    if (ids.size < 2) return;
    this.setState({ visible: false });

    const { serializeSubgraph } = await import('../subgraph.js');
    const subgraph = serializeSubgraph(ids);

    // Emit event for SandboxHeader to open SpellsModal with subgraph
    eventBus.emit('openSpellsModal', { subgraph });
  }

  static get styles() {
    return `
      .mint-fab {
        position: fixed;
        z-index: var(--z-hud);
        background: var(--surface-2);
        border: var(--border-width) solid var(--border-hover);
        color: var(--text-secondary);
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        cursor: pointer;
        padding: 0 14px;
        height: 30px;
        display: flex;
        align-items: center;
        gap: 8px;
        transition:
          background  var(--dur-interact) var(--ease),
          color       var(--dur-interact) var(--ease),
          border-color var(--dur-interact) var(--ease),
          opacity     var(--dur-trans) var(--ease);
      }
      .mint-fab::before {
        content: '+';
        font-family: var(--ff-mono);
        font-size: 17px;
        color: var(--accent);
        font-weight: var(--fw-light);
        flex-shrink: 0;
      }
      .mint-fab:hover {
        background: var(--accent-dim);
        color: var(--accent);
        border-color: var(--accent-border);
      }
      .mint-fab--hidden {
        opacity: 0;
        pointer-events: none;
      }
    `;
  }

  render() {
    const { visible, x, y } = this.state;
    const cls = `mint-fab${visible ? '' : ' mint-fab--hidden'}`;
    const style = `left:${x}px;top:${y}px`;
    return h('button', { className: cls, style, onclick: this.bind(this._handleClick) }, 'Compose Spell');
  }
}
