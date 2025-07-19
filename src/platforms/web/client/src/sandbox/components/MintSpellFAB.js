
import { getSelectedNodeIds } from '../state.js';
import { serializeSubgraph } from '../subgraph.js';
import SpellsMenuModal from './SpellsMenuModal.js';

export class MintSpellFAB {
    constructor(container) {
        this.container = container;
        this.fab = null;
        this.init();
    }

    init() {
        this.fab = document.createElement('button');
        this.fab.className = 'mint-spell-fab';
        this.fab.textContent = 'Mint as Spell';
        this.fab.style.display = 'none';
        this.container.appendChild(this.fab);

        this.fab.addEventListener('click', this.handleMintClick.bind(this));
    }

    show() {
        if (this.fab) {
            this.fab.style.display = 'block';
        }
    }

    hide() {
        if (this.fab) {
            this.fab.style.display = 'none';
        }
    }

    update(selectedNodeCount) {
        if (selectedNodeCount >= 2) {
            this.show();
        } else {
            this.hide();
        }
    }

    handleMintClick() {
        const selectedNodeIds = getSelectedNodeIds();
        if (selectedNodeIds.size < 2) {
            console.warn('Cannot mint a spell with less than 2 nodes.');
            return;
        }

        const subgraph = serializeSubgraph(selectedNodeIds);
        console.log('Serialized subgraph:', subgraph);

        const spellsModal = new SpellsMenuModal({
            initialData: {
                subgraph: subgraph
            }
        });
        spellsModal.show();
    }
}
