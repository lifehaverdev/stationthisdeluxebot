import { Component, h } from '@monygroupcorp/microact';
import { SandboxHeader } from '../sandbox/components/SandboxHeader.js';
import { WorkspaceTabs } from '../sandbox/components/WorkspaceTabs.js';
import { Sidebar } from '../sandbox/components/Sidebar.js';
import { CostHUD } from '../sandbox/components/CostHUD.js';
import { MintSpellFAB } from '../sandbox/components/MintSpellFAB.js';
import { ActionModal } from '../sandbox/components/ActionModal.js';
import { initStore, dispatch } from '../sandbox/store.js';
import { createViewport } from '../sandbox/viewport.js';
import { ToolWindowManager } from '../sandbox/windowManager.js';
import { ExecutionService } from '../sandbox/execution.js';

/**
 * SandboxShell — the top-level sandbox page.
 *
 * Boot sequence:
 *   1. Render DOM (header, canvas, sidebar, HUD, FAB, action modal)
 *   2. Load auth.js + initialize store
 *   3. Create viewport (zoom/pan/lasso)
 *   4. Initialize window manager (tool restore)
 *   5. Initialize execution service (WebSocket + handlers)
 *   6. Run sandbox init() (fetch interceptor, session keepalive, paste handler)
 *   7. Recover pending generations
 */
export class Sandbox extends Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true, error: null,
      actionModal: { visible: false, x: 0, y: 0, workspacePos: null }
    };
    this._cssLink = null;
    this._viewport = null;
    this._windowManager = null;
    this._execution = null;
  }

  didMount() {
    window.__SANDBOX_SPA_MANAGED__ = true;

    this._cssLink = document.createElement('link');
    this._cssLink.rel = 'stylesheet';
    this._cssLink.href = '/index.css';
    document.head.appendChild(this._cssLink);

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    // Canvas click handler for action modal + selection clearing
    this._clickHandler = (e) => this._onCanvasClick(e);
    document.addEventListener('click', this._clickHandler);

    this._loadAuth()
      .then(() => initStore())
      .then(() => this._boot())
      .catch(err => {
        console.error('[SandboxShell] Init failed:', err);
        this.setState({ loading: false, error: err.message });
      });
  }

  willUnmount() {
    if (this._viewport) this._viewport.destroy();
    if (this._execution) this._execution.destroy();
    if (this._clickHandler) document.removeEventListener('click', this._clickHandler);
    if (this._cssLink?.parentNode) this._cssLink.parentNode.removeChild(this._cssLink);
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    delete window.__SANDBOX_SPA_MANAGED__;
    delete window.__reloadSandboxState;
  }

  _onCanvasClick(e) {
    // Ignore clicks on UI elements
    if (e.target.closest('.tool-window, .act-modal, #sidebar, .sidebar-toggle, .cost-hud, .sb-header, .ws-suite')) {
      return;
    }

    // Clear selection on background click
    const stateModule = window.__sandboxState__;
    if (stateModule?.selectedNodeIds?.size > 0) {
      import(/* @vite-ignore */ '/sandbox/' + 'state.js').then(s => s.clearSelection());
    }

    // Dismiss action modal if open
    if (this.state.actionModal.visible) {
      this.setState({ actionModal: { visible: false, x: 0, y: 0, workspacePos: null } });
      return;
    }

    // Show action modal on canvas click
    const content = document.querySelector('.sandbox-content');
    if (content?.contains(e.target) && window.sandbox) {
      const wp = window.sandbox.screenToWorkspace(e.clientX, e.clientY);
      dispatch('SET_LAST_CLICK', wp);

      const rect = content.getBoundingClientRect();
      const pad = 20;
      let mx = e.clientX, my = e.clientY - 80;
      if (my < rect.top + pad) my = e.clientY + pad;
      mx = Math.max(rect.left + pad, Math.min(rect.right - pad, mx));
      my = Math.max(rect.top + pad, Math.min(rect.bottom - pad, my));

      this.setState({ actionModal: { visible: true, x: mx, y: my, workspacePos: wp } });
    }
  }

  async _loadAuth() {
    if (!window.auth?.ensureCsrfToken) {
      await this._loadScript('/js/auth.js');
    }
    if (window.auth?.ensureUserCore) {
      await window.auth.ensureUserCore();
    }
  }

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  async _boot() {
    const [stateModule, connectionsModule] = await Promise.all([
      import(/* @vite-ignore */ '/sandbox/' + 'state.js'),
      import(/* @vite-ignore */ '/sandbox/' + 'connections/index.js')
    ]);

    // 1. Viewport
    const canvasEl = document.querySelector('.sandbox-canvas');
    const contentEl = document.querySelector('.sandbox-content');
    if (canvasEl && contentEl) {
      this._viewport = createViewport({ canvasEl, contentEl, state: stateModule, connections: connectionsModule });
    }

    // 2. Window manager
    this._windowManager = new ToolWindowManager();
    await this._windowManager.init();

    // 3. Sandbox init (fetch interceptor, session keepalive, paste handler)
    const { init } = await import(/* @vite-ignore */ '/sandbox/' + 'index.js');
    await init();

    // 4. Execution service
    this._execution = new ExecutionService();
    await this._execution.init();

    // 5. Reload helper
    window.__reloadSandboxState = () => this._windowManager.reloadState();
    window.addEventListener('sandboxSnapshotUpdated', async () => {
      try { await this._windowManager.reloadState(); } catch (e) {
        console.error('[Sandbox] Reload failed:', e);
      }
    });

    // 6. Recover pending generations
    this._execution.recoverPendingGenerations();

    this.setState({ loading: false });
  }

  static get styles() {
    return `
      .sandbox-shell { height: 100vh; width: 100vw; position: relative; display: flex; flex-direction: column; background-color: #121212; overflow: hidden; }
      .sandbox-shell-error { display: flex; align-items: center; justify-content: center; height: 100vh; color: #f44; font-size: 14px; }
    `;
  }

  render() {
    if (this.state.error) {
      return h('div', { className: 'sandbox-shell-error' }, `Sandbox failed to load: ${this.state.error}`);
    }

    const am = this.state.actionModal;

    return h('div', { className: 'sandbox-shell' },
      h(SandboxHeader, null),
      h(WorkspaceTabs, null),
      h('main', { className: 'sandbox-main' },
        h('section', { className: 'sandbox-content' },
          h('div', { className: 'sandbox-bg' }),
          h('div', { className: 'sandbox-canvas' })
        ),
        h(Sidebar, null)
      ),
      h(CostHUD, null),
      h(MintSpellFAB, null),
      h(ActionModal, {
        visible: am.visible,
        x: am.x,
        y: am.y,
        workspacePosition: am.workspacePos,
        onClose: () => this.setState({ actionModal: { visible: false, x: 0, y: 0, workspacePos: null } })
      })
    );
  }
}
