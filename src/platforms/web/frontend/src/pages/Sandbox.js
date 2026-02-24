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
      activeWallet: null,
      walletDetected: false,
      accountExists: false,
      actionModal: { visible: false, x: 0, y: 0, workspacePos: null },
      textEdit: { visible: false, windowId: null, value: '', displayName: '', kind: 'primitive', paramKey: null },
      resultOverlay: { visible: false, output: null, displayName: '', copied: false },
    };
  }

  didMount() {
    window.__SANDBOX_SPA_MANAGED__ = true;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    // Desktop: canvas click → open ActionModal.
    // click fires after mouseup and only when the pointer hasn't dragged (browser guarantee),
    // so lasso drags never trigger it.
    this._clickHandler = (e) => this._onCanvasClick(e);
    document.addEventListener('click', this._clickHandler);

    // Desktop dismiss: close modal on any mousedown that lands outside the modal.
    // This handles lasso-start (mousedown → drag → no click) and plain outside-clicks.
    // We record _dismissedAt so the click that follows the same mousedown doesn't reopen it.
    this._dismissedAt = 0;
    this._mouseDownHandler = (e) => {
      if (!this.state.actionModal.visible) return;
      if (e.target.closest('.am-root, .am-tools-panel, .am-upload-panel')) return;
      this._dismissedAt = performance.now();
      this.setState({ actionModal: { visible: false, x: 0, y: 0, workspacePos: null } });
    };
    document.addEventListener('mousedown', this._mouseDownHandler);

    // Mobile: SandboxCanvas emits sandbox:canvasTap when a finger taps without panning.
    this._onCanvasTap = ({ x, y }) => {
      if (this.state.actionModal.visible) {
        this.setState({ actionModal: { visible: false, x: 0, y: 0, workspacePos: null } });
        return;
      }
      this._openActionModal(x, y);
    };
    eventBus.on('sandbox:canvasTap', this._onCanvasTap);

    this._onOpenTextEdit = ({ windowId, value, displayName, kind = 'primitive', paramKey = null }) => {
      this.setState({ textEdit: { visible: true, windowId, value, displayName, kind, paramKey } });
      requestAnimationFrame(() => {
        const el = document.querySelector('.sandbox-text-edit-area');
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    };
    eventBus.on('sandbox:openTextEdit', this._onOpenTextEdit);

    this._onOpenResultOverlay = ({ output, displayName }) => {
      this.setState({ resultOverlay: { visible: true, output, displayName: displayName || '', copied: false } });
    };
    eventBus.on('sandbox:openResultOverlay', this._onOpenResultOverlay);

    this._escHandler = (e) => {
      if (e.key !== 'Escape') return;
      const { actionModal, resultOverlay, textEdit } = this.state;
      if (resultOverlay.visible) { this._closeResultOverlay(); return; }
      if (textEdit.visible) { this._closeTextEdit(); return; }
      if (actionModal.visible) { this.setState({ actionModal: { visible: false, x: 0, y: 0, workspacePos: null } }); }
    };
    document.addEventListener('keydown', this._escHandler);

    this._loadAuth()
      .then(() => initStore())
      .then(() => this._boot())
      .catch(err => {
        console.error('[Sandbox] Init failed:', err);
        this.setState({ loading: false, error: err.message });
      });
  }

  willUnmount() {
    if (this._clickHandler)    document.removeEventListener('click',     this._clickHandler);
    if (this._mouseDownHandler) document.removeEventListener('mousedown', this._mouseDownHandler);
    if (this._escHandler)      document.removeEventListener('keydown',   this._escHandler);
    if (this._onCanvasTap)     eventBus.off('sandbox:canvasTap',         this._onCanvasTap);
    if (this._onOpenTextEdit)       eventBus.off('sandbox:openTextEdit',       this._onOpenTextEdit);
    if (this._onOpenResultOverlay)  eventBus.off('sandbox:openResultOverlay',  this._onOpenResultOverlay);
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    delete window.__SANDBOX_SPA_MANAGED__;
  }

  _closeResultOverlay() {
    this.setState({ resultOverlay: { visible: false, output: null, displayName: '', copied: false } });
  }

  _copyResultText() {
    const { output } = this.state.resultOverlay;
    const text = output?.text || JSON.stringify(output, null, 2);
    navigator.clipboard.writeText(text).catch(() => {});
    this.setState({ resultOverlay: { ...this.state.resultOverlay, copied: true } });
    clearTimeout(this._copyResetTimer);
    this._copyResetTimer = setTimeout(() => {
      this.setState({ resultOverlay: { ...this.state.resultOverlay, copied: false } });
    }, 1500);
  }

  _closeTextEdit() {
    this.setState({ textEdit: { visible: false, windowId: null, value: '', displayName: '', kind: 'primitive', paramKey: null } });
  }

  _onTextEditInput(value) {
    const te = this.state.textEdit;
    this.setState({ textEdit: { ...te, value } });
    const canvas = window.sandboxCanvas;
    if (!canvas) return;
    if (te.kind === 'param') {
      canvas._onParamChange(te.windowId, te.paramKey, value);
    } else {
      canvas._onPrimitiveChange(te.windowId, { type: 'text', text: value });
    }
  }

  _openActionModal(clientX, clientY) {
    const canvas = window.sandboxCanvas;
    const workspacePos = canvas ? canvas.screenToWorkspace(clientX, clientY) : { x: 200, y: 200 };
    const canvasEl = document.querySelector('.sc-root');
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const pad = 80;
    const mx = Math.max(rect.left + pad, Math.min(rect.right  - pad, clientX));
    const my = Math.max(rect.top  + pad, Math.min(rect.bottom - pad, clientY));
    this.setState({ actionModal: { visible: true, x: mx, y: my, workspacePos } });
  }

  _onCanvasClick(e) {
    // Only handle clicks on the canvas background — not on windows or other UI
    if (!e.target.closest('.sc-root')) return;
    if (e.target.closest('.nw-root, .am-root, .am-upload-panel, .am-tools-panel, #sidebar, .sidebar-toggle, .cost-hud, .sb-header, .ws-suite, .cdp-root')) return;

    // Spec 3: an anchor was just dropped on empty canvas — drop picker handles it.
    if (window.sandboxCanvas?._anchorDropPending) return;

    // A lasso drag just finished — the mousedown already closed the modal; skip.
    const canvas = window.sandboxCanvas;
    if (canvas?._lassoDidDrag) { canvas._lassoDidDrag = false; return; }
    if (canvas?._panDidDrag) return;

    // The mousedown for this same interaction already dismissed the modal — don't reopen.
    if (performance.now() - this._dismissedAt < 300) return;

    this._openActionModal(e.clientX, e.clientY);
  }

  async _loadAuth() {
    // Check for existing session cookie by probing a lightweight endpoint
    try {
      const res = await fetch('/api/v1/user/dashboard', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        this.setState({ isAuthenticated: true, activeWallet: data.wallet || null });
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
      .sandbox-shell-error { display: flex; align-items: center; justify-content: center; height: 100vh; color: #f44; font-size: 17px; }
      .sandbox-loading { display: flex; align-items: center; justify-content: center; height: 100vh; color: #888; font-size: 17px; }

      /* ── Result expand overlay ─────────────────────── */
      .sandbox-result-overlay-backdrop {
        position: fixed;
        inset: 0;
        z-index: var(--z-modal, 900);
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .sandbox-result-overlay-panel {
        position: relative;
        max-width: 92vw;
        max-height: 92vh;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn var(--dur-trans) var(--ease);
      }
      .sandbox-result-overlay-close {
        position: fixed;
        top: 16px;
        right: 20px;
        background: none;
        border: var(--border-width) solid var(--border);
        color: var(--text-label);
        cursor: pointer;
        font-size: 24px;
        line-height: 1;
        padding: 4px 8px;
        z-index: 1;
        transition: color var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease);
      }
      .sandbox-result-overlay-close:hover { color: var(--text-secondary); border-color: var(--border-hover); }
      .sandbox-result-overlay-img {
        max-width: 92vw;
        max-height: 92vh;
        object-fit: contain;
        display: block;
        -webkit-touch-callout: default; /* enable long-press save on iOS */
      }
      .sandbox-result-overlay-video {
        max-width: 92vw;
        max-height: 88vh;
        display: block;
      }
      .sandbox-result-overlay-audio-wrap {
        padding: 40px;
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 320px;
      }
      .sandbox-result-overlay-audio { width: 100%; }
      .sandbox-result-overlay-text {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        width: min(600px, 90vw);
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        animation: fadeUp var(--dur-trans) var(--ease);
      }
      /* Header reuses sandbox-text-edit-header — override justify to fit 3 items */
      .sandbox-result-overlay-text .sandbox-text-edit-header {
        justify-content: flex-start;
        gap: 0;
      }
      .sandbox-result-overlay-text .sandbox-text-edit-title {
        flex: 1;
      }
      .sandbox-result-overlay-text-actions {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        margin-right: 8px;
      }
      .sandbox-result-overlay-copy {
        background: none;
        border: var(--border-width) solid var(--border);
        color: var(--text-label);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        text-transform: uppercase;
        cursor: pointer;
        padding: 3px 10px;
        transition: color var(--dur-micro) var(--ease), border-color var(--dur-micro) var(--ease);
        white-space: nowrap;
      }
      .sandbox-result-overlay-copy:hover { color: var(--accent); border-color: var(--accent-border); }
      .sandbox-result-overlay-copy--done { color: var(--accent); border-color: var(--accent-border); }
      .sandbox-result-overlay-pre {
        flex: 1;
        overflow-y: auto;
        padding: 14px;
        margin: 0;
        font-family: var(--ff-mono);
        font-size: 16px;
        line-height: 1.6;
        color: var(--text-secondary);
        background: var(--surface-3);
        white-space: pre-wrap;
        word-break: break-word;
      }

      /* ── Text edit overlay ─────────────────────────── */
      .sandbox-text-edit-backdrop {
        position: fixed;
        inset: 0;
        z-index: var(--z-modal, 900);
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .sandbox-text-edit-panel {
        background: var(--surface-2);
        border: var(--border-width) solid var(--border);
        width: min(600px, 90vw);
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        animation: fadeUp var(--dur-trans) var(--ease);
      }
      .sandbox-text-edit-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: var(--border-width) solid var(--border);
        background: var(--surface-3);
        flex-shrink: 0;
      }
      .sandbox-text-edit-title {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-secondary);
      }
      .sandbox-text-edit-close {
        background: none;
        border: none;
        color: var(--text-label);
        cursor: pointer;
        font-size: 19px;
        line-height: 1;
        padding: 0;
        transition: color var(--dur-micro) var(--ease);
      }
      .sandbox-text-edit-close:hover { color: var(--text-secondary); }
      .sandbox-text-edit-area {
        flex: 1;
        min-height: 240px;
        background: var(--surface-3);
        border: none;
        color: var(--text-secondary);
        font-family: var(--ff-mono);
        font-size: 16px;
        line-height: 1.6;
        padding: 14px;
        resize: none;
        outline: none;
      }
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
    const te = this.state.textEdit;
    const ro = this.state.resultOverlay;
    const { windows, connections } = this._canvasState || {};
    const { isAuthenticated } = this.state;

    return h('div', { className: 'sandbox-shell' },
      h(SandboxHeader, null),
      h(WorkspaceTabs, { walletAddress: this.state.activeWallet }),
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
      }),
      te.visible
        ? h('div', {
            className: 'sandbox-text-edit-backdrop',
            onmousedown: () => this._closeTextEdit(),
          },
            h('div', {
              className: 'sandbox-text-edit-panel',
              onmousedown: (e) => e.stopPropagation(),
            },
              h('div', { className: 'sandbox-text-edit-header' },
                h('span', { className: 'sandbox-text-edit-title' }, te.displayName),
                h('button', { className: 'sandbox-text-edit-close', onclick: () => this._closeTextEdit() }, '\u00D7'),
              ),
              h('textarea', {
                className: 'sandbox-text-edit-area',
                value: te.value,
                placeholder: 'enter text...',
                oninput: (e) => this._onTextEditInput(e.target.value),
              })
            )
          )
        : null,
      ro.visible && ro.output
        ? h('div', {
            className: 'sandbox-result-overlay-backdrop',
            onmousedown: () => this._closeResultOverlay(),
          },
            h('div', {
              className: 'sandbox-result-overlay-panel',
              onmousedown: (e) => e.stopPropagation(),
            },
              ro.output.type !== 'text'
                ? h('button', { className: 'sandbox-result-overlay-close', onclick: () => this._closeResultOverlay() }, '\u00D7')
                : null,
              ro.output.type === 'image'
                ? h('img', { src: ro.output.url, className: 'sandbox-result-overlay-img' })
                : ro.output.type === 'video'
                  ? h('video', { src: ro.output.url, controls: true, autoplay: true, className: 'sandbox-result-overlay-video' })
                  : ro.output.type === 'audio'
                    ? h('div', { className: 'sandbox-result-overlay-audio-wrap' },
                        h('audio', { src: ro.output.url, controls: true, autoplay: true, className: 'sandbox-result-overlay-audio' })
                      )
                    : h('div', { className: 'sandbox-result-overlay-text' },
                        h('div', { className: 'sandbox-text-edit-header' },
                          h('span', { className: 'sandbox-text-edit-title' }, ro.displayName || 'Output'),
                          h('div', { className: 'sandbox-result-overlay-text-actions' },
                            h('button', {
                              className: `sandbox-result-overlay-copy${ro.copied ? ' sandbox-result-overlay-copy--done' : ''}`,
                              onclick: () => this._copyResultText(),
                            }, ro.copied ? 'Copied \u2713' : 'Copy'),
                          ),
                          h('button', { className: 'sandbox-text-edit-close', onclick: () => this._closeResultOverlay() }, '\u00D7'),
                        ),
                        h('pre', { className: 'sandbox-result-overlay-pre' },
                          ro.output.text || JSON.stringify(ro.output, null, 2)
                        )
                      )
            )
          )
        : null
    );
  }
}
