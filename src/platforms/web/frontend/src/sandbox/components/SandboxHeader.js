import { Component, h } from '@monygroupcorp/microact';
import { AccountDropdown } from './AccountDropdown.js';
import { SpellsModal } from './SpellsModal.js';
import { CookModal } from './CookModal.js';
import { ModsModal } from './ModsModal.js';
import { getLandingUrl } from '../../lib/urls.js';

/**
 * SandboxHeader — top navigation bar for the sandbox.
 *
 * Contains logo, nav links (cast/cook/mod) that open the respective
 * modal menus, and the account dropdown. Includes mobile hamburger toggle.
 */
export class SandboxHeader extends Component {
  constructor(props) {
    super(props);
    this.state = { mobileOpen: false, showSpells: false, spellSubgraph: null, showCook: false, showMods: false };
  }

  didMount() {
    // Listen for MintSpellFAB opening the spells modal with a subgraph
    this.subscribe('openSpellsModal', (data) => {
      this.setState({ showSpells: true, spellSubgraph: data?.subgraph || null });
    });
  }

  _toggleMobile() {
    this.setState({ mobileOpen: !this.state.mobileOpen });
  }

  _navClick(action, e) {
    e.preventDefault();
    this.setState({ mobileOpen: false });
    switch (action) {
      case 'spells': this.setState({ showSpells: true }); break;
      case 'cook': this.setState({ showCook: true }); break;
      case 'mods': this.setState({ showMods: true }); break;
    }
  }

  static get styles() {
    return `
      .sh-root {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: var(--header-height);
        padding: 0 16px;
        background: var(--surface-1);
        border-bottom: var(--border-width) solid var(--border);
        flex-shrink: 0;
        gap: 16px;
        position: relative;
        z-index: var(--z-hud);
      }

      .sh-wordmark {
        font-family: var(--ff-display);
        font-size: var(--fs-lg);
        font-weight: var(--fw-bold);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-primary);
        text-decoration: none;
        flex-shrink: 0;
        line-height: 1;
      }

      .sh-nav {
        display: flex;
        align-items: center;
        gap: 0;
        flex: 1;
        padding-left: 24px;
      }

      .sh-nav-item {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-label);
        text-decoration: none;
        padding: 4px 12px;
        border: var(--border-width) solid transparent;
        cursor: pointer;
        background: none;
        transition:
          color var(--dur-micro) var(--ease),
          border-color var(--dur-micro) var(--ease);
        white-space: nowrap;
      }

      .sh-nav-item:hover { color: var(--text-secondary); }
      .sh-nav-item.active {
        color: var(--text-primary);
        border-color: var(--border);
      }

      .sh-right {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      .sh-system-label {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        color: var(--text-label);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        padding: 0 8px;
        border-left: var(--border-width) solid var(--border);
      }
    `;
  }

  render() {
    const { showSpells, showCook, showMods } = this.state;

    return h('header', { className: 'sh-root sandbox-header' },
      h('a', { href: getLandingUrl(), target: '_blank', rel: 'noopener noreferrer', className: 'sh-wordmark' }, 'NOEMA'),
      h('nav', { className: 'sh-nav' },
        h('button', { className: 'sh-nav-item', onclick: (e) => this._navClick('spells', e) }, 'cast'),
        h('button', { className: 'sh-nav-item', onclick: (e) => this._navClick('cook', e) }, 'cook'),
        h('button', { className: 'sh-nav-item', onclick: (e) => this._navClick('mods', e) }, 'mod')
      ),
      h('div', { className: 'sh-right' },
        h(AccountDropdown, null)
      ),
      showSpells ? h(SpellsModal, {
        onClose: () => this.setState({ showSpells: false, spellSubgraph: null }),
        initialSubgraph: this.state.spellSubgraph,
      }) : null,
      showCook ? h(CookModal, {
        onClose: () => this.setState({ showCook: false }),
      }) : null,
      showMods ? h(ModsModal, {
        onClose: () => this.setState({ showMods: false }),
      }) : null
    );
  }
}
