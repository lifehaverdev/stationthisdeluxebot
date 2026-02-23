import { Component, h } from '@monygroupcorp/microact';
import { showNotification } from '../utils/notifications.js';

const TABS_KEY = 'sandbox_workspace_tabs';
function shortSlug(slug) {
  if (!slug) return 'new';
  return slug.length > 18 ? slug.slice(0, 16) + '…' : slug;
}

function tabLabel(t) {
  if (t.name) return t.name;
  return shortSlug(t.slug);
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
      this.state = { tabs: restored.tabs, current: restored.current, switching: false, open: false, editingTab: null, editingName: '', shareCopied: false };
    } else {
      const url = new URL(window.location.href);
      const slug = url.searchParams.get('workspace');
      this.state = {
        tabs: [{ slug }],
        current: 0,
        switching: false,
        open: false,
        editingTab: null,
        editingName: '',
        shareCopied: false,
      };
    }
  }

  async didMount() {
    this._persistTabs();

    // On initial mount, the URL ?workspace= param is a navigation intent and takes
    // precedence over whatever the active tab was. Existing tabs are preserved — the
    // shared workspace opens as a new tab (or switches to it if already open).
    const urlSlug = new URL(window.location.href).searchParams.get('workspace') || null;
    let { tabs, current } = this.state;

    if (urlSlug && urlSlug !== (tabs[current]?.slug || null)) {
      const existingIdx = tabs.findIndex(t => t.slug === urlSlug);
      if (existingIdx !== -1) {
        // Already have this workspace in a tab — just switch to it
        current = existingIdx;
        this.setState({ current });
      } else {
        // Open the shared workspace in a new tab, keeping existing tabs intact
        const newTabs = [...tabs, { slug: urlSlug }];
        current = newTabs.length - 1;
        this.setState({ tabs: newTabs, current });
        tabs = newTabs;
      }
      this._persistTabs();
    }

    const slugToLoad = tabs[current]?.slug || null;
    if (slugToLoad) {
      try {
        const { loadWorkspace } = await this._getWorkspacesModule();
        const result = await loadWorkspace(slugToLoad, { silent: true });
        // Populate name from server if not already set locally
        if (result?.name && !tabs[current]?.name) {
          const newTabs = [...this.state.tabs];
          newTabs[current] = { ...newTabs[current], name: result.name };
          this.setState({ tabs: newTabs });
          this._persistTabs();
        }
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

    this._startAutosave();
  }

  willUnmount() {
    if (this._outsideClick) document.removeEventListener('click', this._outsideClick);
    clearInterval(this._autosaveInterval);
    if (this._onVisibilityChange) document.removeEventListener('visibilitychange', this._onVisibilityChange);
    if (this._onBeforeUnload) window.removeEventListener('beforeunload', this._onBeforeUnload);
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

  // Shared save logic used by manual save, autosave, and tab-switch autosave.
  async _doSave(silent = false) {
    const { saveWorkspace } = await this._getWorkspacesModule();
    const currentTab = this.state.tabs[this.state.current];
    const newSlug = await saveWorkspace(currentTab.slug || null, {
      silent,
      walletAddress: this.props.walletAddress || null,
      name: currentTab.name || undefined,
    });
    if (newSlug && newSlug !== currentTab.slug) {
      const tabs = [...this.state.tabs];
      tabs[this.state.current] = { ...currentTab, slug: newSlug };
      this.setState({ tabs });
      this._persistTabs();
    }
    return newSlug;
  }

  async _save() {
    await this._doSave(false);
  }

  _startAutosave() {
    // Prefetch CSRF token now so _autosaveSync (beforeunload) can use it immediately.
    // _autosaveSync can't await, so the token must already be in window.__csrfToken.
    this._getWorkspacesModule().then(m => m.getCsrfToken?.()).catch(() => {});

    // Periodic autosave every 2 minutes
    this._autosaveInterval = setInterval(() => this._autosave(), 2 * 60 * 1000);

    // Save whenever the user switches away from the tab/app —
    // best proxy for "about to stop interacting" without waiting for the full interval
    this._onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') this._autosave();
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    // Best-effort save on page close — keepalive ensures the request outlives the page
    this._onBeforeUnload = () => this._autosaveSync();
    window.addEventListener('beforeunload', this._onBeforeUnload);
  }

  async _autosave() {
    try {
      await this._doSave(true);
    } catch (e) {
      // If the save fails because the session expired, the user needs to know —
      // their work is still in sandbox_canvas_state locally, but they should log back in
      const msg = e?.message || '';
      const isAuthFailure = msg.includes('401')
        || msg.toLowerCase().includes('unauthorized')
        || msg.toLowerCase().includes('no token')
        || msg.toLowerCase().includes('json'); // redirect to login page returned HTML, not JSON
      if (isAuthFailure) {
        showNotification('Session expired. Work saved locally — log in to sync.', 'warning', 8000);
      }
      // All other failures: silently skip, canvas state still lives in localStorage
    }
  }

  _autosaveSync() {
    // Synchronously starts a keepalive fetch that the browser will complete even after
    // the page begins unloading. Can't be async — beforeunload must return synchronously.
    const canvas = window.sandboxCanvas;
    if (!canvas || typeof canvas.getSnapshot !== 'function') return;

    let snapshot;
    try {
      snapshot = canvas.getSnapshot();
      if (!snapshot.toolWindows.length && !snapshot.connections.length) return;
    } catch { return; }

    const csrf = window.__csrfToken; // populated by getCsrfToken() on first save
    if (!csrf) return;

    const currentTab = this.state.tabs[this.state.current];
    const body = { snapshot };
    if (currentTab.slug) body.slug = currentTab.slug;
    if (currentTab.name) body.name = currentTab.name;
    if (this.props.walletAddress) body.walletAddress = this.props.walletAddress.toLowerCase();

    try {
      fetch('/api/v1/workspaces', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify(body),
        keepalive: true  // request survives page unload
      });
    } catch { /* best effort */ }
  }

  async _load() {
    const input = prompt('Enter workspace ID / URL', '');
    if (!input) return;
    const id = input.includes('/') ? input.split(/workspace=|\//).pop() : input;
    const { loadWorkspace } = await this._getWorkspacesModule();
    const result = await loadWorkspace(id.trim());
    if (result?.slug) {
      const tabs = [...this.state.tabs];
      tabs[this.state.current] = { slug: result.slug, name: result.name || undefined };
      this.setState({ tabs });
      this._persistTabs();
    }
  }

  async _switchTab(idx) {
    if (idx === this.state.current || this.state.switching) return;
    // Cancel any pending rename when switching tabs
    if (this.state.editingTab !== null) this.setState({ editingTab: null, editingName: '' });
    this.setState({ switching: true });

    try {
      const { saveWorkspace, loadWorkspace } = await this._getWorkspacesModule();
      const tabs = [...this.state.tabs];

      // Autosave current
      try {
        const slug = await saveWorkspace(tabs[this.state.current].slug || null, {
          silent: true,
          walletAddress: this.props.walletAddress || null,
          name: tabs[this.state.current].name || undefined,
        });
        if (!tabs[this.state.current].slug && slug) {
          tabs[this.state.current] = { ...tabs[this.state.current], slug };
        }
      } catch {}

      this.setState({ tabs, current: idx });
      this._persistTabs();

      const t = tabs[idx];
      if (t.slug) {
        const result = await loadWorkspace(t.slug, { silent: true });
        // Populate name from server if not already set locally
        if (result?.name && !t.name) {
          const updatedTabs = [...this.state.tabs];
          updatedTabs[idx] = { ...updatedTabs[idx], name: result.name };
          this.setState({ tabs: updatedTabs });
          this._persistTabs();
        }
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
    if (!confirm('Close this workspace? Unsaved changes will be lost.')) return;

    if (idx === current) {
      try {
        const { saveWorkspace } = await this._getWorkspacesModule();
        await saveWorkspace(tabs[current].slug || null, {
          silent: true,
          walletAddress: this.props.walletAddress || null,
          name: tabs[current].name || undefined,
        });
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
    // New microact canvas path
    const canvas = window.sandboxCanvas;
    if (canvas && typeof canvas.loadFromSnapshot === 'function') {
      canvas.loadFromSnapshot({ toolWindows: [], connections: [] });
    } else {
      // Legacy fallback
      localStorage.removeItem('sandbox_connections');
      localStorage.removeItem('sandbox_tool_windows');
      try {
        const st = await this._getStateModule();
        st.activeToolWindows.length = 0;
        st.connections.length = 0;
        st.selectedNodeIds.clear();
        try { st.persistState(); } catch {}
      } catch {}
      document.querySelectorAll('.tool-window, .connection-line').forEach(el => el.remove());
    }
    // Clear canvas localStorage and remove ?workspace= from URL
    localStorage.removeItem('sandbox_canvas_state');
    const url = new URL(window.location.href);
    url.searchParams.delete('workspace');
    window.history.replaceState({}, '', url);
  }

  // --- Rename ---

  _startRename(idx) {
    const tab = this.state.tabs[idx];
    this.setState({ editingTab: idx, editingName: tab.name || '' });
  }

  async _commitRename(idx) {
    if (this.state.editingTab !== idx) return;
    const name = this.state.editingName.trim();
    const tabs = [...this.state.tabs];
    tabs[idx] = { ...tabs[idx], name: name || undefined };
    this.setState({ tabs, editingTab: null, editingName: '' });
    this._persistTabs();
    // Persist name to server if tab is saved
    if (tabs[idx].slug) {
      try {
        const { saveWorkspace } = await this._getWorkspacesModule();
        await saveWorkspace(tabs[idx].slug, {
          silent: true,
          walletAddress: this.props.walletAddress || null,
          name: name || '',
        });
      } catch { /* best effort */ }
    }
  }

  _cancelRename() {
    this.setState({ editingTab: null, editingName: '' });
  }

  _onTabTouchEnd(i, e) {
    const now = Date.now();
    if (this._lastTapIdx === i && now - (this._lastTapTime || 0) < 300) {
      e.preventDefault();
      this._startRename(i);
      this._lastTapTime = 0;
    } else {
      this._lastTapIdx = i;
      this._lastTapTime = now;
    }
  }

  // --- Share ---

  async _share() {
    const currentTab = this.state.tabs[this.state.current];
    let slug = currentTab.slug;

    if (!slug) {
      // No saved workspace yet — save first, then share
      try {
        slug = await this._doSave(false);
      } catch (e) {
        showNotification('Save failed. Cannot share.', 'error');
        return;
      }
      if (!slug) {
        showNotification('Nothing to share yet! Add some tools first.', 'info');
        return;
      }
    }

    const url = new URL(window.location.href);
    url.searchParams.set('workspace', slug);

    try {
      await navigator.clipboard.writeText(url.toString());
      this.setState({ shareCopied: true });
      setTimeout(() => this.setState({ shareCopied: false }), 2000);
    } catch (e) {
      showNotification(`Share link: ${url}`, 'success', 10000);
    }
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
        min-width: 220px;
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
      .ws-action-btn.copied { color: var(--success, #4ade80); border-color: var(--success, #4ade80); }

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

      /* Inline rename input */
      .ws-tab-rename-input {
        flex: 1;
        background: var(--surface-1, #000);
        border: none;
        border-right: var(--border-width) solid var(--border);
        color: var(--text-primary);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        padding: 7px 10px;
        outline: none;
        min-width: 0;
      }
      .ws-tab-rename-input::placeholder { color: var(--text-label); }

      /* Edit icon — shown on active tab */
      .ws-tab-edit {
        background: none;
        border: none;
        color: var(--text-label);
        font-size: 12px;
        cursor: pointer;
        padding: 7px 6px;
        flex-shrink: 0;
        opacity: 0;
        transition: color var(--dur-micro) var(--ease), opacity var(--dur-micro) var(--ease);
      }
      .ws-tab-item.active:hover .ws-tab-edit { opacity: 1; }
      .ws-tab-edit:hover { color: var(--text-secondary); }
      @media (pointer: coarse) {
        .ws-tab-item.active .ws-tab-edit { opacity: 1; }
      }

      /* Confirm rename button (✓) */
      .ws-tab-confirm {
        background: none;
        border: none;
        color: var(--success, #4ade80);
        font-size: 13px;
        cursor: pointer;
        padding: 7px 8px;
        flex-shrink: 0;
        transition: color var(--dur-micro) var(--ease);
      }
      .ws-tab-confirm:hover { color: var(--text-primary); }

      .ws-tab-close {
        background: none;
        border: none;
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: 12px;
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
    const { tabs, current, open, editingTab, editingName, shareCopied } = this.state;

    return h('div', { className: 'ws-root ws-suite', onclick: (e) => e.stopPropagation() },
      h('button', {
        className: `ws-trigger${open ? ' open' : ''}`,
        onclick: this.bind(this._toggle),
      },
        '⧉',
        h('span', null, open ? '▴' : '▾'),
      ),
      h('div', { className: `ws-panel${open ? ' open' : ''}` },
        h('div', { className: 'ws-panel-header' },
          h('span', { className: 'ws-panel-label' }, 'Workspaces'),
          h('div', { className: 'ws-panel-actions' },
            h('button', {
              className: `ws-action-btn${shareCopied ? ' copied' : ''}`,
              onclick: this.bind(this._share),
            }, shareCopied ? 'copied!' : 'share'),
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
              editingTab === i
                ? h('input', {
                    className: 'ws-tab-rename-input',
                    type: 'text',
                    value: editingName,
                    placeholder: shortSlug(t.slug),
                    oninput: (e) => this.setState({ editingName: e.target.value }),
                    onkeydown: (e) => {
                      if (e.key === 'Enter') this._commitRename(i);
                      if (e.key === 'Escape') this._cancelRename();
                    },
                    onblur: () => this._commitRename(i),
                    autofocus: true,
                  })
                : h('button', {
                    className: 'ws-tab-name',
                    onclick: () => this._switchTab(i),
                    ondblclick: (e) => { e.stopPropagation(); this._startRename(i); },
                    ontouchend: (e) => this._onTabTouchEnd(i, e),
                    title: t.slug || '',
                  }, tabLabel(t)),
              editingTab === i
                ? h('button', {
                    className: 'ws-tab-confirm',
                    onmousedown: (e) => e.preventDefault(), // prevent blur before click
                    onclick: () => this._commitRename(i),
                  }, '✓')
                : (i === current
                    ? h('button', {
                        className: 'ws-tab-edit',
                        onclick: (e) => { e.stopPropagation(); this._startRename(i); },
                        title: 'Rename',
                      }, '✎')
                    : null),
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
