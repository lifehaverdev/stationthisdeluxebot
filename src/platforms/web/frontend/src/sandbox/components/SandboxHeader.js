import { Component, h } from '@monygroupcorp/microact';
import { AccountDropdown } from './AccountDropdown.js';
import { openSpellsMenu, openCookMenu, openModsMenu } from './modals.js';

/**
 * SandboxHeader — top navigation bar for the sandbox.
 *
 * Contains logo, nav links (cast/cook/mod) that open the respective
 * modal menus, and the account dropdown. Includes mobile hamburger toggle.
 */
export class SandboxHeader extends Component {
  constructor(props) {
    super(props);
    this.state = { mobileOpen: false };
  }

  _toggleMobile() {
    this.setState({ mobileOpen: !this.state.mobileOpen });
  }

  _navClick(action, e) {
    e.preventDefault();
    this.setState({ mobileOpen: false });
    switch (action) {
      case 'spells': openSpellsMenu(); break;
      case 'cook': openCookMenu(); break;
      case 'mods': openModsMenu(); break;
    }
  }

  static get styles() {
    return `
      .sb-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0 16px; height: 48px; min-height: 48px;
        background: rgba(0,0,0,0.6); border-bottom: 1px solid #222;
        z-index: 100; position: relative;
      }
      .sb-logo a { color: #fff; text-decoration: none; font-weight: 700; font-size: 16px; letter-spacing: 1px; }
      .sb-nav { display: flex; gap: 16px; }
      .sb-nav a {
        color: #888; text-decoration: none; font-size: 13px; font-weight: 500;
        text-transform: lowercase; letter-spacing: 0.5px; cursor: pointer;
        transition: color 0.15s;
      }
      .sb-nav a:hover { color: #fff; }
      .sb-burger {
        display: none; background: none; border: none; color: #888;
        font-size: 20px; cursor: pointer; padding: 4px;
      }
      @media (max-width: 640px) {
        .sb-nav { display: none; }
        .sb-burger { display: block; }
        .sb-header.is-open .sb-nav {
          display: flex; flex-direction: column; position: absolute;
          top: 100%; left: 0; right: 0; background: #111; padding: 12px 16px;
          border-bottom: 1px solid #222; z-index: 200;
        }
      }
    `;
  }

  render() {
    const { mobileOpen } = this.state;
    const headerClass = `sb-header sandbox-header${mobileOpen ? ' is-open' : ''}`;

    return h('header', { className: headerClass },
      h('button', { className: 'sb-burger', onclick: this.bind(this._toggleMobile) }, '\u2630'),
      h('div', { className: 'sb-logo' },
        h('a', { href: '/landing' }, 'NOEMA')
      ),
      h('nav', { className: 'sb-nav main-nav' },
        h('a', { href: '#spells', onclick: (e) => this._navClick('spells', e) }, 'cast'),
        h('a', { href: '#cook', onclick: (e) => this._navClick('cook', e) }, 'cook'),
        h('a', { href: '#mods', onclick: (e) => this._navClick('mods', e) }, 'mod')
      ),
      h('div', { className: 'user-menu' },
        h(AccountDropdown, null)
      )
    );
  }
}
