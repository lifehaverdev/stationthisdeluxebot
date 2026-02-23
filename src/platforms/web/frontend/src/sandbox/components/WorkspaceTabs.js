import { Component, h } from '@monygroupcorp/microact';

const TABS_KEY = 'sandbox_workspace_tabs';
function shortSlug(slug) {
  if (!slug) return 'new';
  return slug.length > 18 ? slug.slice(0, 16) + '…' : slug;
}

/**
 * WorkspaceTabs — save/load/switch workspace tabs.
 *
 * During Phase 0-1, this component still delegates to the old
 * workspaces.js functions which are loaded at runtime from /sandbox/.
 * We use dynamic import to avoid bundling them.
 */
export class WorkspaceTabs extends Component {
  constructor(props) {
    super(props);
    const restored = this._restoreTabs();
    if (restored) {
      this.state = { tabs: restored.tabs, current: restored.current, switching: false, open: false };
    } else {
      const url = new URL(window.location.href);
      const slug = url.searchParams.get('workspace');
      this.state = {
        tabs: [{ slug }],
        current: 0,
        switching: false,
        open: false,
      };
    }
  }

  async didMount() {
    this._persistTabs();
    // Load initial workspace if URL param present
    const { tabs } = this.state;
    if (tabs[0]?.slug) {
      try {
        const { loadWorkspace } = await this._getWorkspacesModule();
        await loadWorkspace(tabs[0].slug, { silent: true });
      } catch (e) {
        console.error('[WorkspaceTabs] initial load failed:', e);
      }
    }
    // Close panel when clicking outside
    this._outsideClick = (e) => {
      if (this.state.open && !e.target.closest('.ws-root')) {
        this.setState({ open: false });
      }
    };
    document.addEventListener('click', this._outsideClick);
  }

  willUnmount() {
    if (this._outsideClick) document.removeEventListener('click', this._outsideClick);
  }

  _toggle(e) {
    e.stopPropagation();
    this.setState({ open: !this.state.open });
  }

  async _getWorkspacesModule() {
    if (!this._wsModule) {
      this._wsModule = await import('../workspaces.js');
    }
    return this._wsModule;
  }

  async _getStateModule() {
    if (!this._stModule) {
      this._stModule = await import('../state.js');
    }
    return this._stModule;
  }

  _restoreTabs() {
    try {
      const raw = localStorage.getItem(TABS_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (Array.isArray(obj.tabs)) return { tabs: obj.tabs, current: obj.current || 0 };
    } catch {}
    return null;
  }

  _persistTabs() {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: this.state.tabs, current: this.state.current }));
  }

  async _save() {
    const { saveWorkspace } = await this._getWorkspacesModule();
    await saveWorkspace();
  }

  async _load() {
    const input = prompt('Enter workspace ID / URL', '');
    if (!input) return;
    const id = input.includes('/') ? input.split(/workspace=|\//).pop() : input;
    const { loadWorkspace } = await this._getWorkspacesModule();
    const slug = await loadWorkspace(id.trim());
    if (slug) {
      const tabs = [...this.state.tabs];
      tabs[this.state.current] = { slug };
      this.setState({ tabs });
      this._persistTabs();
    }
  }

  async _switchTab(idx) {
    if (idx === this.state.current || this.state.switching) return;
    this.setState({ switching: true });

    try {
      const { saveWorkspace, loadWorkspace } = await this._getWorkspacesModule();
      const tabs = [...this.state.tabs];

      // Autosave current
      try {
        const slug = await saveWorkspace(tabs[this.state.current].slug || null, { silent: true });
        if (!tabs[this.state.current].slug && slug) {
          tabs[this.state.current] = { slug };
        }
      } catch {}

      this.setState({ tabs, current: idx });
      this._persistTabs();

      const t = tabs[idx];
      if (t.slug) {
        await loadWorkspace(t.slug, { silent: true });
      } else {
        await this._resetToBlank();
      }
    } finally {
      this.setState({ switching: false });
    }
  }

  async _addTab() {
    const tabs = [...this.state.tabs, { slug: null }];
    this.setState({ tabs });
    await this._switchTab(tabs.length - 1);
  }

  async _closeTab(idx) {
    const { tabs, current } = this.state;
    if (tabs.length === 1) return;

    if (idx === current) {
      try {
        const { saveWorkspace } = await this._getWorkspacesModule();
        await saveWorkspace(tabs[current].slug || null, { silent: true });
      } catch {}
    }

    const newTabs = tabs.filter((_, i) => i !== idx);
    const newCurrent = current >= idx ? Math.max(0, current - 1) : current;
    this.setState({ tabs: newTabs, current: newCurrent });
    this._persistTabs();

    const cur = newTabs[newCurrent];
    if (cur?.slug) {
      const { loadWorkspace } = await this._getWorkspacesModule();
      await loadWorkspace(cur.slug, { silent: true });
    } else {
      await this._resetToBlank();
    }
  }

  async _resetToBlank() {
    localStorage.removeItem('sandbox_connections');
    localStorage.removeItem('sandbox_tool_windows');
    const st = await this._getStateModule();
    st.activeToolWindows.length = 0;
    st.connections.length = 0;
    st.selectedNodeIds.clear();
    try { st.persistState(); } catch {}
    document.querySelectorAll('.tool-window, .connection-line').forEach(el => el.remove());
  }

  static get styles() {
    return `
      /* Root — anchored to top-left below header */
      .ws-root {
        position: fixed;
        top: var(--header-height, 44px);
        left: 0;
        z-index: var(--z-hud);
      }

      /* Trigger tab */
      .ws-trigger {
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        border-top: none;
        border-left: none;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wider);
        text-transform: uppercase;
        cursor: pointer;
        padding: 4px 10px;
        transition:
          color        var(--dur-micro) var(--ease),
          border-color var(--dur-micro) var(--ease),
          background   var(--dur-micro) var(--ease);
      }
      .ws-trigger:hover { color: var(--text-secondary); border-color: var(--border-hover); }
      .ws-trigger.open  { color: var(--text-primary);   border-color: var(--border-hover); background: var(--surface-3); }

      /* Dropdown panel */
      .ws-panel {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        border-top: none;
        min-width: 200px;
        display: none;
        flex-direction: column;
        animation: fadeUp var(--dur-trans) var(--ease);
      }
      .ws-panel.open { display: flex; }

      /* Panel header row */
      .ws-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        border-bottom: var(--border-width) solid var(--border);
        background: var(--surface-3);
        gap: 8px;
      }
      .ws-panel-label {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-secondary);
      }
      .ws-panel-actions { display: flex; gap: 4px; }
      .ws-action-btn {
        background: none;
        border: var(--border-width) solid var(--border);
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        cursor: pointer;
        padding: 2px 8px;
        transition: color var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease);
      }
      .ws-action-btn:hover { color: var(--accent); border-color: var(--accent-border); }

      /* Tab list */
      .ws-tab-list { display: flex; flex-direction: column; }

      .ws-tab-item {
        display: flex;
        align-items: center;
        border-bottom: var(--border-width) solid var(--border);
      }
      .ws-tab-item:last-of-type { border-bottom: none; }

      .ws-tab-name {
        flex: 1;
        background: none;
        border: none;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        text-align: left;
        padding: 7px 10px;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: color var(--dur-micro) var(--ease);
      }
      .ws-tab-name:hover { color: var(--text-secondary); }
      .ws-tab-item.active .ws-tab-name { color: var(--accent); }

      .ws-tab-close {
        background: none;
        border: none;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: 10px;
        cursor: pointer;
        padding: 7px 8px;
        flex-shrink: 0;
        transition: color var(--dur-micro) var(--ease);
      }
      .ws-tab-close:hover { color: var(--danger); }

      .ws-tab-add {
        background: none;
        border: none;
        border-top: var(--border-width) solid var(--border);
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        text-align: left;
        padding: 6px 10px;
        cursor: pointer;
        width: 100%;
        transition: color var(--dur-micro) var(--ease);
      }
      .ws-tab-add:hover { color: var(--accent); }
    `;
  }

  render() {
    const { tabs, current, open } = this.state;

    return h('div', { className: 'ws-root ws-suite', onclick: (e) => e.stopPropagation() },
      h('button', {
        className: `ws-trigger${open ? ' open' : ''}`,
        onclick: this.bind(this._toggle),
      },
        'WS',
        h('span', null, open ? '▴' : '▾'),
      ),
      h('div', { className: `ws-panel${open ? ' open' : ''}` },
        h('div', { className: 'ws-panel-header' },
          h('span', { className: 'ws-panel-label' }, 'Workspaces'),
          h('div', { className: 'ws-panel-actions' },
            h('button', { className: 'ws-action-btn', onclick: this.bind(this._save) }, 'save'),
            h('button', { className: 'ws-action-btn', onclick: this.bind(this._load) }, 'load'),
          ),
        ),
        h('div', { className: 'ws-tab-list' },
          ...tabs.map((t, i) =>
            h('div', {
              className: `ws-tab-item${i === current ? ' active' : ''}`,
              key: i,
            },
              h('button', {
                className: 'ws-tab-name',
                onclick: () => this._switchTab(i),
              }, shortSlug(t.slug)),
              tabs.length > 1
                ? h('button', {
                    className: 'ws-tab-close',
                    onclick: (e) => { e.stopPropagation(); this._closeTab(i); },
                  }, '\u00D7')
                : null,
            )
          ),
          h('button', { className: 'ws-tab-add', onclick: this.bind(this._addTab) }, '+ new'),
        ),
      ),
    );
  }
}
