import { Component, h } from '@monygroupcorp/microact';
import { subscribe, getSelectedNodeIds } from '../store.js';

/**
 * MintSpellFAB — floating action button shown when 2+ nodes are selected.
 * Clicking serializes the selected subgraph and opens the spell creation flow.
 *
 * The heavy SpellsMenuModal and subgraph serializer are loaded at runtime
 * to keep this component's bundle footprint near zero.
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

    // Dynamic imports — these are big modules served as ESM from /sandbox/
    const subgraphUrl = '/sandbox/' + 'subgraph.js';
    const spellsUrl = '/sandbox/' + 'components/SpellsMenuModal.js';

    const [{ serializeSubgraph }, { default: SpellsMenuModal }] = await Promise.all([
      import(/* @vite-ignore */ subgraphUrl),
      import(/* @vite-ignore */ spellsUrl)
    ]);

    const subgraph = serializeSubgraph(ids);
    const modal = new SpellsMenuModal({ initialData: { subgraph } });
    modal.show();
  }

  static get styles() {
    return `
      .mint-fab {
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff;
        border: none; padding: 12px 24px; border-radius: 28px; font-size: 14px;
        font-weight: 600; cursor: pointer; z-index: 80;
        box-shadow: 0 4px 16px rgba(99,102,241,0.4);
        transition: transform 0.2s, opacity 0.2s;
      }
      .mint-fab:hover { transform: translateX(-50%) scale(1.05); }
      .mint-fab--hidden { opacity: 0; pointer-events: none; transform: translateX(-50%) translateY(8px); }
    `;
  }

  render() {
    const cls = `mint-fab${this.state.visible ? '' : ' mint-fab--hidden'}`;
    return h('button', { className: cls, onclick: this.bind(this._handleClick) }, 'Mint as Spell');
  }
}
