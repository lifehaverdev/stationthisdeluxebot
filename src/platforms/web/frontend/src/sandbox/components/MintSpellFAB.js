import { Component, h, eventBus } from '@monygroupcorp/microact';
import { subscribe, getSelectedNodeIds } from '../store.js';

/**
 * MintSpellFAB — floating action button shown when 2+ nodes are selected.
 * Clicking serializes the selected subgraph and emits an event for
 * SandboxHeader to open SpellsModal in create mode.
 */
export class MintSpellFAB extends Component {
  constructor(props) {
    super(props);
    this.state = { visible: false };
  }

  didMount() {
    this.registerCleanup(subscribe('selection', () => {
      const count = getSelectedNodeIds().size;
      this.setState({ visible: count >= 2 });
    }));
  }

  async _handleClick() {
    const ids = getSelectedNodeIds();
    if (ids.size < 2) return;

    // Dynamic import — subgraph serializer is served from /sandbox/
    
    const { serializeSubgraph } = await import('../subgraph.js');
    const subgraph = serializeSubgraph(ids);

    // Emit event for SandboxHeader to open SpellsModal with subgraph
    eventBus.emit('openSpellsModal', { subgraph });
  }

  static get styles() {
    return `
      .mint-fab {
        position: fixed;
        bottom: 16px;
        right: 16px;
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
        font-size: 14px;
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
    const cls = `mint-fab${this.state.visible ? '' : ' mint-fab--hidden'}`;
    return h('button', { className: cls, onclick: this.bind(this._handleClick) }, 'Compose Spell');
  }
}
