import { Component, h } from '@monygroupcorp/microact';

const TABS_KEY = 'sandbox_workspace_tabs';
const EMOJIS = ['\uD83D\uDDBC\uFE0F','\uD83C\uDFB5','\uD83D\uDCDD','\uD83C\uDFAC','\u2728','\uD83C\uDF1F','\uD83D\uDE80','\uD83D\uDD25','\uD83D\uDCA1','\uD83E\uDDEA','\uD83E\uDDE9'];
function pickEmoji(str) {
  let h = 0; for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return EMOJIS[Math.abs(h) % EMOJIS.length];
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
      this.state = { tabs: restored.tabs, current: restored.current, switching: false };
    } else {
      const url = new URL(window.location.href);
      const slug = url.searchParams.get('workspace');
      this.state = {
        tabs: [{ slug, emoji: slug ? pickEmoji(slug) : '\uD83C\uDD97' }],
        current: 0,
        switching: false
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
  }

  async _getWorkspacesModule() {
    if (!this._wsModule) {
      const url = '/sandbox/' + 'workspaces.js';
      this._wsModule = await import(/* @vite-ignore */ url);
    }
    return this._wsModule;
  }

  async _getStateModule() {
    if (!this._stModule) {
      const url = '/sandbox/' + 'state.js';
      this._stModule = await import(/* @vite-ignore */ url);
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
      tabs[this.state.current] = { slug, emoji: pickEmoji(slug) };
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
          tabs[this.state.current] = { slug, emoji: pickEmoji(slug) };
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
    const tabs = [...this.state.tabs, { slug: null, emoji: '\uD83C\uDD95' }];
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
      .ws-suite { display: flex; align-items: center; gap: 4px; padding: 0 8px; }
      .ws-btn { background: none; border: none; font-size: 16px; cursor: pointer; padding: 4px 8px; opacity: 0.7; }
      .ws-btn:hover { opacity: 1; }
      .ws-tabs { display: flex; gap: 2px; }
      .ws-tab { padding: 4px 8px; border: none; cursor: pointer; font-size: 13px; border-radius: 4px 4px 0 0; display: flex; align-items: center; gap: 4px; }
      .ws-tab--active { background: #333; color: #fff; }
      .ws-tab--inactive { background: #1a1a1a; color: #888; }
      .ws-tab--inactive:hover { background: #222; }
      .ws-tab-close { font-size: 11px; opacity: 0.5; cursor: pointer; margin-left: 2px; }
      .ws-tab-close:hover { opacity: 1; }
      .ws-add { padding: 4px 8px; border: none; background: #1a1a1a; color: #666; cursor: pointer; border-radius: 4px 4px 0 0; }
      .ws-add:hover { background: #222; color: #ccc; }
    `;
  }

  render() {
    const { tabs, current } = this.state;

    return h('div', { className: 'ws-suite' },
      h('button', { className: 'ws-btn', title: 'Save', onclick: this.bind(this._save) }, '\uD83D\uDCBE'),
      h('button', { className: 'ws-btn', title: 'Load', onclick: this.bind(this._load) }, '\uD83D\uDCC2'),
      h('div', { className: 'ws-tabs' },
        ...tabs.map((t, i) =>
          h('button', {
            key: i,
            className: `ws-tab ${i === current ? 'ws-tab--active' : 'ws-tab--inactive'}`,
            onclick: () => this._switchTab(i)
          },
            h('span', null, t.slug ? t.emoji : '\u2744\uFE0F'),
            tabs.length > 1
              ? h('span', { className: 'ws-tab-close', onclick: (e) => { e.stopPropagation(); this._closeTab(i); } }, '\u00D7')
              : null
          )
        ),
        h('button', { className: 'ws-add', onclick: this.bind(this._addTab) }, '+')
      )
    );
  }
}
