import { Component, h, eventBus } from '@monygroupcorp/microact';
import { SandboxHeader } from '../sandbox/components/SandboxHeader.js';
import { WorkspaceTabs } from '../sandbox/components/WorkspaceTabs.js';
import { Sidebar } from '../sandbox/components/Sidebar.js';
import { CostHUD } from '../sandbox/components/CostHUD.js';
import { MintSpellFAB } from '../sandbox/components/MintSpellFAB.js';
import { ActionModal } from '../sandbox/components/ActionModal.js';
import { AuthWidget } from '../sandbox/components/AuthWidget.js';
import { initStore } from '../sandbox/store.js';
import { SandboxCanvas, loadCanvasState } from '../sandbox/canvas/SandboxCanvas.js';
import { initializeTools } from '../sandbox/io.js';

/**
 * Sandbox — top-level sandbox page.
 *
 * Boot sequence:
 *   1. Load auth
 *   2. Init store
 *   3. Fetch tool registry → notify Sidebar via eventBus
 *   4. Mount SandboxCanvas (handles viewport, windows, connections, execution)
 *
 * SandboxCanvas exposes itself at window.sandboxCanvas for Sidebar + ActionModal.
 */
export class Sandbox extends Component {
  constructor(props) {
    super(props);
    this._canvasState = loadCanvasState();
    this.state = {
      loading: true,
      error: null,
      isAuthenticated: false,
      walletDetected: false,
      accountExists: false,
      actionModal: { visible: false, x: 0, y: 0, workspacePos: null },
    };
    this._cssLink = null;
  }

  didMount() {
    window.__SANDBOX_SPA_MANAGED__ = true;

    // Load sandbox CSS (served from /index.css via Express static)
    this._cssLink = document.createElement('link');
    this._cssLink.rel = 'stylesheet';
    this._cssLink.href = '/index.css';
    document.head.appendChild(this._cssLink);

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    // Canvas background click → show ActionModal
    this._clickHandler = (e) => this._onCanvasClick(e);
    document.addEventListener('click', this._clickHandler);

    this._loadAuth()
      .then(() => initStore())
      .then(() => this._boot())
      .catch(err => {
        console.error('[Sandbox] Init failed:', err);
        this.setState({ loading: false, error: err.message });
      });
  }

  willUnmount() {
    if (this._clickHandler) document.removeEventListener('click', this._clickHandler);
    if (this._cssLink?.parentNode) this._cssLink.parentNode.removeChild(this._cssLink);
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    delete window.__SANDBOX_SPA_MANAGED__;
  }

  _onCanvasClick(e) {
    // Only handle clicks on the canvas background — not on windows or other UI
    if (!e.target.closest('.sc-root')) return;
    if (e.target.closest('.nw-root, .act-modal, #sidebar, .sidebar-toggle, .cost-hud, .sb-header, .ws-suite, .cdp-root')) return;

    // Spec 3: an anchor was just dropped on empty canvas — the drop picker is
    // handling this click, don't also open the ActionModal.
    if (window.sandboxCanvas?._anchorDropPending) return;

    // Dismiss modal on second click
    if (this.state.actionModal.visible) {
      this.setState({ actionModal: { visible: false, x: 0, y: 0, workspacePos: null } });
      return;
    }

    // Get workspace position from canvas
    const canvas = window.sandboxCanvas;
    const workspacePos = canvas ? canvas.screenToWorkspace(e.clientX, e.clientY) : { x: 200, y: 200 };

    // Position the modal near the click, clamped to viewport
    const canvasEl = document.querySelector('.sc-root');
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const pad = 20;
    let mx = e.clientX;
    let my = e.clientY - 80;
    if (my < rect.top + pad) my = e.clientY + pad;
    mx = Math.max(rect.left + pad, Math.min(rect.right - pad - 120, mx));
    my = Math.max(rect.top + pad, Math.min(rect.bottom - pad, my));

    this.setState({ actionModal: { visible: true, x: mx, y: my, workspacePos } });
  }

  async _loadAuth() {
    // Check for existing session cookie by probing a lightweight endpoint
    try {
      const res = await fetch('/api/v1/user/dashboard', { credentials: 'include' });
      if (res.ok) {
        this.setState({ isAuthenticated: true });
        return;
      }
    } catch {}

    // Not authenticated — run passive wallet detection
    try {
      const { WalletService } = await import('@monygroupcorp/micro-web3');
      const ws = new WalletService(eventBus);
      await ws.initialize();
      const wallets = ws.getAvailableWallets();
      if (wallets && wallets.length > 0) {
        // Wallet detected — check if account exists
        const address = ws.getAddress?.();
        if (address) {
          const probe = await fetch(`/api/v1/auth/account-exists?address=${address}`, { credentials: 'include' });
          if (probe.ok) {
            const { exists } = await probe.json();
            this.setState({ walletDetected: true, accountExists: exists });
            return;
          }
        }
        this.setState({ walletDetected: true, accountExists: false });
      }
    } catch (e) {
      console.warn('[Sandbox] Wallet detection failed:', e.message);
    }
  }

  async _boot() {
    // Fetch tools → Sidebar listens for this event
    try {
      const tools = await initializeTools();
      eventBus.emit('sandbox:availableTools', tools);
    } catch (e) {
      console.warn('[Sandbox] Tool load failed:', e);
      eventBus.emit('sandbox:availableTools', []);
    }

    this.setState({ loading: false });
  }

  static get styles() {
    return `
      .sandbox-shell { height: 100vh; width: 100vw; position: relative; display: flex; flex-direction: column; background: #121212; overflow: hidden; }
      .sandbox-main { flex: 1; display: flex; overflow: hidden; min-height: 0; }
      .sandbox-content { flex: 1; position: relative; overflow: hidden; }
      .sandbox-shell-error { display: flex; align-items: center; justify-content: center; height: 100vh; color: #f44; font-size: 14px; }
      .sandbox-loading { display: flex; align-items: center; justify-content: center; height: 100vh; color: #888; font-size: 14px; }
    `;
  }

  render() {
    if (this.state.error) {
      return h('div', { className: 'sandbox-shell-error' }, `Sandbox failed to load: ${this.state.error}`);
    }

    if (this.state.loading) {
      return h('div', { className: 'sandbox-loading' }, 'Loading...');
    }

    const am = this.state.actionModal;
    const { windows, connections } = this._canvasState || {};
    const { isAuthenticated } = this.state;

    return h('div', { className: 'sandbox-shell' },
      h(SandboxHeader, null),
      h(WorkspaceTabs, null),
      h('main', { className: 'sandbox-main' },
        h('section', { className: 'sandbox-content' },
          h(SandboxCanvas, {
            initialWindows: windows || [],
            initialConnections: connections || [],
          })
        ),
        h(Sidebar, null)
      ),
      h(CostHUD, null),
      h(MintSpellFAB, null),
      h(AuthWidget, {
        initialMode: isAuthenticated ? 'hidden' : 'card',
        onSuccess: () => this.setState({ isAuthenticated: true }),
      }),
      h(ActionModal, {
        visible: am.visible,
        x: am.x,
        y: am.y,
        workspacePosition: am.workspacePos,
        onClose: () => this.setState({ actionModal: { visible: false, x: 0, y: 0, workspacePos: null } }),
      })
    );
  }
}
