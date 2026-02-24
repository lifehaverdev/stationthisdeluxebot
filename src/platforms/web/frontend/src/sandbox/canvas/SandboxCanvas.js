import { Component, h, eventBus } from '@monygroupcorp/microact';
import { ConnectionLayer } from './ConnectionLayer.js';
import { WindowRenderer } from './WindowRenderer.js';
import { ToolWindowBody, SpellWindowBody, UploadWindowBody, PrimitiveWindowBody } from './ToolWindowBody.js';
import { ConnectionDropPicker } from './ConnectionDropPicker.js';
import { Sigil } from '../components/Sigil.js';
import * as executionClient from '../executionClient.js';
import { emitCosts } from '../store.js';

/**
 * SandboxCanvas — top-level canvas component for the node sandbox.
 *
 * Owns all window/connection state. Handles zoom/pan/drag as a single
 * unified controller. Children render declaratively from state.
 *
 * Public API (accessible via window.sandboxCanvas):
 *   addToolWindow(tool, position)     — create a tool node
 *   addSpellWindow(spell, position)   — create a spell node
 *   addUploadWindow(url, position)    — create an uploaded-image node
 *   screenToWorkspace(clientX, clientY) — convert screen coords to canvas coords
 *
 * Props:
 *   initialWindows     — array of persisted window state
 *   initialConnections — array of persisted connections
 */

const MIN_SCALE = 0.15;
const MAX_SCALE = 4.0;
const ZOOM_FACTOR = 1.05;
const GRID_SIZE = 32;

export class SandboxCanvas extends Component {
  constructor(props) {
    super(props);

    const windows = new Map();
    const connections = new Map();
    if (props.initialWindows) {
      (Array.isArray(props.initialWindows) ? props.initialWindows : [...props.initialWindows.values()])
        .forEach(w => windows.set(w.id, { ...w, outputLoaded: !!w.output }));
    }
    if (props.initialConnections) {
      (Array.isArray(props.initialConnections) ? props.initialConnections : [...props.initialConnections.values()])
        .forEach(c => connections.set(c.id, c));
    }

    this.state = {
      windows,
      connections,
      selection: new Set(),
      viewport: { panX: 0, panY: 0, scale: 1 },
      activeConnection: null,
      activeDrag: null,
      activePan: null,
      activeLasso: null, // { originX, originY, startX, startY, currentX, currentY }
      // Set when an output anchor is dropped on empty canvas (Spec 3)
      pendingAnchorDrop: null, // { fromWindowId, outputType, workspacePos, screenX, screenY }
      // Mobile two-tap connection: set on first tap (output anchor), cleared on second (input) or cancel
      mobileConnecting: null, // { fromWindowId, outputType }
    };

    // Set to true when a lasso drag just finished so Sandbox.js can suppress the
    // click event that fires after mouseup.
    this._lassoDidDrag = false;

    this._wsHandlers = null;
    this._rootEl = null;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
  }

  didMount() {
    // Expose public API globally so Sidebar, ActionModal, Sandbox.js can reach it
    window.sandboxCanvas = this;

    this._spaceDown = false;
    this._onKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        this._deleteSelected();
      }
      if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        if (!this._spaceDown) {
          this._spaceDown = true;
          this._rootEl?.classList.add('canvas--pan-mode');
        }
        e.preventDefault(); // prevent page scroll
      }
    };
    this._onKeyUp = (e) => {
      if (e.key === ' ') {
        this._spaceDown = false;
        this._rootEl?.classList.remove('canvas--pan-mode');
      }
    };
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    this.registerCleanup(() => {
      document.removeEventListener('keydown', this._onKeyDown);
      document.removeEventListener('keyup', this._onKeyUp);
    });

    // Wheel and touch: registered as non-passive so preventDefault() works.
    // The vdom onwheel prop is passive in modern browsers — must use addEventListener.
    if (this._rootEl) {
      this._wheel      = (e) => this._onWheel(e);
      this._touchStart = (e) => this._onTouchStart(e);
      this._touchMove  = (e) => this._onTouchMove(e);
      this._touchEnd   = (e) => this._onTouchEnd(e);
      this._rootEl.addEventListener('wheel',      this._wheel,      { passive: false });
      this._rootEl.addEventListener('touchstart', this._touchStart, { passive: false });
      this._rootEl.addEventListener('touchmove',  this._touchMove,  { passive: false });
      this._rootEl.addEventListener('touchend',   this._touchEnd);
      this.registerCleanup(() => {
        this._rootEl?.removeEventListener('wheel',      this._wheel);
        this._rootEl?.removeEventListener('touchstart', this._touchStart);
        this._rootEl?.removeEventListener('touchmove',  this._touchMove);
        this._rootEl?.removeEventListener('touchend',   this._touchEnd);
      });
    }

    this._initWs();
  }

  willUnmount() {
    if (window.sandboxCanvas === this) delete window.sandboxCanvas;
  }

  async _initWs() {
    try {
      const [wsModule, wsHandlers] = await Promise.all([
        import('../ws.js'),
        import('../node/websocketHandlers.js'),
      ]);
      wsModule.websocketClient?.connect?.();
      wsHandlers.registerWebSocketHandlers?.();
      this._wsHandlers = wsHandlers;
      this._wsClient = wsModule.websocketClient;
    } catch (e) {
      console.warn('[SandboxCanvas] WS init failed:', e);
    }
  }

  // ── State helpers ──────────────────────────────────────────

  _updateWindow(id, updates) {
    const windows = new Map(this.state.windows);
    const existing = windows.get(id);
    if (!existing) return;
    windows.set(id, { ...existing, ...updates });
    this.setState({ windows });
  }

  _addWindow(winData) {
    const windows = new Map(this.state.windows);
    const id = winData.id || `win-${Math.random().toString(36).substr(2, 9)}`;
    windows.set(id, { ...winData, id, outputLoaded: false });
    this.setState({ windows });
    this._persist();
    return id;
  }

  _removeWindow(id) {
    const windows = new Map(this.state.windows);
    const connections = new Map(this.state.connections);
    for (const [cid, conn] of connections) {
      if (conn.fromWindowId === id || conn.toWindowId === id) connections.delete(cid);
    }
    windows.delete(id);
    const selection = new Set(this.state.selection);
    selection.delete(id);
    this.setState({ windows, connections, selection });
    this._persist();
  }

  _addConnection(fromWindowId, toWindowId, type, toParam) {
    const connections = new Map(this.state.connections);
    const id = `conn-${Math.random().toString(36).substr(2, 9)}`;
    connections.set(id, { id, fromWindowId, toWindowId, fromOutput: type, toInput: toParam, type });

    const windows = new Map(this.state.windows);
    const toWin = windows.get(toWindowId);
    if (toWin) {
      const mappings = { ...(toWin.parameterMappings || {}) };
      mappings[toParam] = { type: 'nodeOutput', nodeId: fromWindowId, outputKey: type };
      windows.set(toWindowId, { ...toWin, parameterMappings: mappings });
    }

    this.setState({ windows, connections });
    this._persist();
  }

  _removeConnection(connId) {
    const connections = new Map(this.state.connections);
    const conn = connections.get(connId);
    if (!conn) return;

    const windows = new Map(this.state.windows);
    const toWin = windows.get(conn.toWindowId);
    if (toWin?.parameterMappings?.[conn.toInput]) {
      const mappings = { ...toWin.parameterMappings };
      delete mappings[conn.toInput];
      windows.set(conn.toWindowId, { ...toWin, parameterMappings: mappings });
    }

    connections.delete(connId);
    this.setState({ windows, connections });
    this._persist();
  }

  _deleteSelected() {
    for (const id of this.state.selection) this._removeWindow(id);
  }

  // ── Viewport ──────────────────────────────────────────────

  _onWheel(e) {
    // If the wheel event originates inside a window node, let any scrollable
    // ancestor within that window handle it instead of zooming/panning the canvas.
    if (e.target.closest('.nw-root')) {
      let el = e.target;
      const nwRoot = el.closest('.nw-root');
      while (el && el !== nwRoot) {
        const style = window.getComputedStyle(el);
        const oy = style.overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
          return; // scrollable element — let it scroll
        }
        el = el.parentElement;
      }
    }

    e.preventDefault();
    const { viewport } = this.state;

    // Plain scroll / pinch-to-zoom (ctrlKey) → zoom centered on cursor
    // Two-finger trackpad pan (large deltaX or shift+scroll) → pan
    if (e.shiftKey) {
      // Shift+scroll → pan
      this.setState({
        viewport: { ...viewport, panX: viewport.panX - e.deltaX - e.deltaY, panY: viewport.panY }
      });
    } else if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
      // Predominantly horizontal trackpad swipe → pan horizontally
      this.setState({
        viewport: { ...viewport, panX: viewport.panX - e.deltaX, panY: viewport.panY - e.deltaY }
      });
    } else {
      // Scroll wheel or pinch (ctrlKey) → zoom centered on cursor
      const direction = e.deltaY > 0 ? -1 : 1;
      const factor = Math.pow(ZOOM_FACTOR, direction);
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, viewport.scale * factor));
      const rect = this._rootEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const scaleRatio = newScale / viewport.scale;
      const newPanX = mouseX - (mouseX - viewport.panX) * scaleRatio;
      const newPanY = mouseY - (mouseY - viewport.panY) * scaleRatio;
      this.setState({ viewport: { panX: newPanX, panY: newPanY, scale: newScale } });
    }
  }

  // ── Touch pan (mobile) ────────────────────────────────────

  _onTouchStart(e) {
    if (e.touches.length !== 1) return;
    // Touch on a window — let window interactions handle it
    if (e.target.closest('.nw-root')) return;
    e.preventDefault(); // suppress synthetic mouse events + scroll
    const t = e.touches[0];
    this.setState({
      activePan: { startX: t.clientX, startY: t.clientY, startPanX: this.state.viewport.panX, startPanY: this.state.viewport.panY }
    });
  }

  _onTouchMove(e) {
    if (!this.state.activePan || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    const { activePan, viewport } = this.state;
    this.setState({
      viewport: { ...viewport, panX: activePan.startPanX + (t.clientX - activePan.startX), panY: activePan.startPanY + (t.clientY - activePan.startY) }
    });
  }

  _onTouchEnd(e) {
    const pan = this.state.activePan;
    if (!pan) return;
    const t = e.changedTouches?.[0];
    if (t) {
      const dx = t.clientX - pan.startX;
      const dy = t.clientY - pan.startY;
      // Tap: finger didn't move
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
        if (this.state.mobileConnecting) {
          // Background tap cancels in-flight mobile connection
          this.setState({ mobileConnecting: null });
        } else {
          eventBus.emit('sandbox:canvasTap', { x: t.clientX, y: t.clientY });
        }
      }
    }
    this.setState({ activePan: null });
  }

  // ── Window click → connected-component selection ──────────

  _getConnectedComponent(windowId) {
    const visited = new Set();
    const queue = [windowId];
    const conns = [...this.state.connections.values()];
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      for (const c of conns) {
        if (c.fromWindowId === id && !visited.has(c.toWindowId)) queue.push(c.toWindowId);
        if (c.toWindowId === id && !visited.has(c.fromWindowId)) queue.push(c.fromWindowId);
      }
    }
    return visited;
  }

  _notifySelectionChanged(selection, pos) {
    const conns = [...this.state.connections.values()];
    const hasConnections = conns.some(
      c => selection.has(c.fromWindowId) && selection.has(c.toWindowId)
    );
    eventBus.emit('sandbox:selectionChanged', { ids: selection, count: selection.size, hasConnections, pos: pos || null });
  }

  _onWindowClick(windowId, pos) {
    const { selection, connections } = this.state;

    // Already selected → deselect (user "leaving out" individual windows)
    if (selection.has(windowId)) {
      const next = new Set(selection);
      next.delete(windowId);
      this.setState({ selection: next });
      this._notifySelectionChanged(next, null);
      return;
    }

    const hasConnections = [...connections.values()].some(
      c => c.fromWindowId === windowId || c.toWindowId === windowId
    );

    const next = hasConnections
      ? this._getConnectedComponent(windowId)
      : new Set([windowId]);
    this.setState({ selection: next });
    this._notifySelectionChanged(next, pos);
  }

  /**
   * Look up the center of a rendered anchor element and return its workspace position.
   * Called by ConnectionLayer during render to get pixel-accurate line endpoints.
   */
  _getAnchorPos(windowId, anchorType, paramKey) {
    const winEl = document.getElementById(windowId);
    if (!winEl || !this._rootEl) return null;

    const anchorEl = anchorType === 'output'
      ? winEl.querySelector('.nw-anchor-output')
      : winEl.querySelector(`.nw-anchor-input[data-param="${paramKey}"]`);

    if (!anchorEl) return null;

    const r = anchorEl.getBoundingClientRect();
    return this.screenToWorkspace(r.left + r.width / 2, r.top + r.height / 2);
  }

  /** Convert screen coordinates to workspace (canvas) coordinates. */
  screenToWorkspace(clientX, clientY) {
    const { viewport } = this.state;
    const rect = this._rootEl?.getBoundingClientRect() || { left: 0, top: 0 };
    return {
      x: (clientX - rect.left - viewport.panX) / viewport.scale,
      y: (clientY - rect.top - viewport.panY) / viewport.scale,
    };
  }

  // ── Unified mouse handler ─────────────────────────────────

  _onCanvasMouseDown(e) {
    if (e.target.closest('.nw-body')) return;
    if (e.target.closest('.nw-anchor-output')) return;
    if (e.target.closest('.nw-header')) return;
    if (e.target.closest('.nw-anchor-input')) return;

    if (e.button === 1 || (e.button === 0 && this._spaceDown)) {
      // Middle mouse button OR space+left-click → pan
      e.preventDefault();
      this.setState({
        activePan: { startX: e.clientX, startY: e.clientY, startPanX: this.state.viewport.panX, startPanY: this.state.viewport.panY }
      });
      document.addEventListener('mousemove', this._onMouseMove);
      document.addEventListener('mouseup', this._onMouseUp);
    } else if (e.button === 0) {
      // Left mouse button → lasso selection (desktop only; touch pan is handled separately)
      if (e.target.closest('.nw-root')) return;
      e.preventDefault(); // prevent browser text-selection drag stealing our mousemove events
      this._lassoDidDrag = false;
      const rect = this._rootEl.getBoundingClientRect();
      const emptySelection = new Set();
      this.setState({
        activeLasso: { originX: rect.left, originY: rect.top, startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY },
        selection: emptySelection,
      });
      this._notifySelectionChanged(emptySelection);
      document.addEventListener('mousemove', this._onMouseMove);
      document.addEventListener('mouseup', this._onMouseUp);
    }
  }

  _startWindowDrag(windowId, offsetX, offsetY) {
    this.setState({ activeDrag: { windowId, offsetX, offsetY } });
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  _startConnectionDrag(windowId, outputType, event) {
    const pos = this.screenToWorkspace(event.clientX, event.clientY);
    this.setState({
      activeConnection: { fromWindowId: windowId, outputType, mouseX: pos.x, mouseY: pos.y }
    });
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  // ── Mobile two-tap connections ────────────────────────────

  _onMobileConnectStart(fromWindowId, outputType) {
    // Tapping same anchor again cancels
    const { mobileConnecting } = this.state;
    if (mobileConnecting?.fromWindowId === fromWindowId) {
      this.setState({ mobileConnecting: null });
    } else {
      this.setState({ mobileConnecting: { fromWindowId, outputType } });
    }
  }

  _onMobileConnectComplete(toWindowId, paramKey) {
    const { mobileConnecting } = this.state;
    if (!mobileConnecting || toWindowId === mobileConnecting.fromWindowId) {
      // Self-connect or stale state — cancel
      this.setState({ mobileConnecting: null });
      return;
    }
    this._addConnection(mobileConnecting.fromWindowId, toWindowId, mobileConnecting.outputType, paramKey);
    this.setState({ mobileConnecting: null });
  }

  _onMobileConnectCancel() {
    this.setState({ mobileConnecting: null });
  }

  _onMouseMove(e) {
    const { activeDrag, activeConnection, activePan, activeLasso, viewport } = this.state;

    if (activeDrag) {
      const pos = this.screenToWorkspace(e.clientX, e.clientY);
      const newX = pos.x - activeDrag.offsetX / viewport.scale;
      const newY = pos.y - activeDrag.offsetY / viewport.scale;
      const windows = new Map(this.state.windows);
      const win = windows.get(activeDrag.windowId);
      if (win) {
        windows.set(win.id, { ...win, x: newX, y: newY });
        this.setState({ windows });
      }
      return;
    }

    if (activeConnection) {
      const pos = this.screenToWorkspace(e.clientX, e.clientY);
      this.setState({ activeConnection: { ...activeConnection, mouseX: pos.x, mouseY: pos.y } });
      return;
    }

    if (activePan) {
      const dx = e.clientX - activePan.startX;
      const dy = e.clientY - activePan.startY;
      this.setState({
        viewport: { ...viewport, panX: activePan.startPanX + dx, panY: activePan.startPanY + dy }
      });
      return;
    }

    if (activeLasso) {
      this.setState({ activeLasso: { ...activeLasso, currentX: e.clientX, currentY: e.clientY } });
    }
  }

  _onMouseUp(e) {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);

    const { activeDrag, activeConnection, activePan, activeLasso } = this.state;

    if (activeDrag) {
      this.setState({ activeDrag: null });
      this._persist();
      return;
    }

    if (activeConnection) {
      const elem = document.elementFromPoint(e.clientX, e.clientY);
      const inputAnchor = elem?.closest('.nw-anchor-input');
      if (inputAnchor) {
        // Spec 2: dropped on a compatible input anchor → create connection
        const toWindowEl = inputAnchor.closest('.nw-root');
        if (toWindowEl && toWindowEl.id !== activeConnection.fromWindowId) {
          const toParam = inputAnchor.dataset.param;
          this._addConnection(activeConnection.fromWindowId, toWindowEl.id, activeConnection.outputType, toParam);
        }
        this.setState({ activeConnection: null });
      } else {
        // Spec 3: dropped on empty canvas → show contextual tool picker.
        // Also suppress the next canvas click so ActionModal doesn't open.
        this._anchorDropPending = true;
        setTimeout(() => { this._anchorDropPending = false; }, 200);

        const workspacePos = this.screenToWorkspace(e.clientX, e.clientY);
        this.setState({
          activeConnection: null,
          pendingAnchorDrop: {
            fromWindowId: activeConnection.fromWindowId,
            outputType: activeConnection.outputType,
            workspacePos,
            screenX: e.clientX,
            screenY: e.clientY,
          },
        });
      }
      return;
    }

    if (activePan) {
      const dx = e.clientX - activePan.startX;
      const dy = e.clientY - activePan.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        this._panDidDrag = true;
        setTimeout(() => { this._panDidDrag = false; }, 0);
      }
      this.setState({ activePan: null });
      return;
    }

    if (activeLasso) {
      const dx = activeLasso.currentX - activeLasso.startX;
      const dy = activeLasso.currentY - activeLasso.startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        // It was a real drag — select windows within the lasso rect
        this._lassoDidDrag = true;
        const selection = this._selectWindowsInLasso(activeLasso);
        this.setState({ activeLasso: null, selection });
        this._notifySelectionChanged(selection, { x: e.clientX, y: e.clientY });
      } else {
        this.setState({ activeLasso: null });
      }
    }
  }

  _selectWindowsInLasso(lasso) {
    const x1 = Math.min(lasso.startX, lasso.currentX);
    const y1 = Math.min(lasso.startY, lasso.currentY);
    const x2 = Math.max(lasso.startX, lasso.currentX);
    const y2 = Math.max(lasso.startY, lasso.currentY);
    const tl = this.screenToWorkspace(x1, y1);
    const br = this.screenToWorkspace(x2, y2);

    const selected = new Set();
    for (const [id, win] of this.state.windows) {
      // Approximate node dimensions for hit-testing
      const winRight = win.x + 280;
      const winBottom = win.y + 220;
      if (win.x < br.x && winRight > tl.x && win.y < br.y && winBottom > tl.y) {
        selected.add(id);
      }
    }
    return selected;
  }

  // ── Connection drop picker (Spec 3) ──────────────────────

  _onDropPickerSelect(tool, paramKey) {
    const { pendingAnchorDrop } = this.state;
    if (!pendingAnchorDrop) return;

    const { fromWindowId, outputType, workspacePos } = pendingAnchorDrop;

    // Offset slightly right of drop point so it doesn't overlap the source
    const pos = { x: workspacePos.x + 80, y: workspacePos.y };
    const newWindowId = this.addToolWindow(tool, pos);

    // Auto-connect: source output → new window's matching input
    this._addConnection(fromWindowId, newWindowId, outputType, paramKey);

    this.setState({ pendingAnchorDrop: null });
  }

  _onDropPickerDismiss() {
    this.setState({ pendingAnchorDrop: null });
    // Suppress the click that dismissed the picker from also opening ActionModal
    this._anchorDropPending = true;
    clearTimeout(this._anchorDropPendingTimer);
    this._anchorDropPendingTimer = setTimeout(() => { this._anchorDropPending = false; }, 200);
  }

  // ── Execution ─────────────────────────────────────────────

  async _executeWindow(windowId) {
    const win = this.state.windows.get(windowId);
    if (!win || win.executing) return;

    this._updateWindow(windowId, { executing: true, error: null, progress: 'Starting...' });

    try {
      // Resolve inputs from connections
      const inputs = {};
      const mappings = win.parameterMappings || {};
      const schema = win.tool?.inputSchema || {};

      for (const [key, param] of Object.entries(schema)) {
        const mapping = mappings[key];
        if (mapping?.type === 'nodeOutput') {
          const sourceWin = this.state.windows.get(mapping.nodeId);
          if (sourceWin?.output) {
            let resolved;
            if (sourceWin.output.type === 'image') resolved = sourceWin.output.url;
            else if (sourceWin.output.type === 'text') {
              // Prefer top-level .text; fall back to nested .data.text (old adapter format)
              resolved = sourceWin.output.text
                ?? (Array.isArray(sourceWin.output.data?.text)
                  ? sourceWin.output.data.text[0]
                  : sourceWin.output.data?.text);
            }
            else resolved = sourceWin.output.value !== undefined ? sourceWin.output.value : sourceWin.output;
            if ((resolved === '' || resolved === null || resolved === undefined) && param.required) {
              const label = param.name || key;
              throw new Error(`'${label}' is connected but the source node has no value — enter text first`);
            }
            inputs[key] = resolved;
          } else {
            throw new Error(`Missing output from upstream node for '${key}'`);
          }
        } else if (mapping?.type === 'static') {
          inputs[key] = mapping.value;
        } else if (param.required) {
          throw new Error(`Required parameter '${key}' is not set`);
        }
      }

      // Randomize seeds on every run
      for (const [key, mapping] of Object.entries(mappings)) {
        if (mapping?.type === 'static' && /seed/i.test(key)) {
          const seed = Math.floor(Math.random() * 1e9);
          mapping.value = seed;
          inputs[key] = seed;
        }
      }

      this._updateWindow(windowId, { progress: 'Executing...' });

      const result = await executionClient.execute({
        toolId: win.tool.toolId,
        inputs,
        metadata: { platform: 'web-sandbox' },
      });

      if (result.final && result.status !== 'failed') {
        const output = this._normalizeOutput(result);
        const versions = [...(win.outputVersions || []), output];
        this._updateWindow(windowId, {
          output, executing: false, progress: null, outputLoaded: true,
          outputVersions: versions, currentVersionIndex: versions.length - 1,
        });
        if (result.costUsd) this._recordCost(windowId, result.costUsd);
      } else if (result.status === 'failed') {
        this._updateWindow(windowId, {
          executing: false, error: result.outputs?.error || 'Execution failed.',
        });
      } else if (result.generationId) {
        this._updateWindow(windowId, { progress: 'Waiting for result...', generationId: result.generationId });
        this._awaitCompletion(windowId, result.generationId);
      }
    } catch (err) {
      this._updateWindow(windowId, { executing: false, error: err.message, progress: null });
    }
  }

  _recordCost(windowId, usd) {
    if (!usd || usd <= 0) return;
    const win = this.state.windows.get(windowId);
    if (!win) return;

    const newTotal = (win.totalCostUsd || 0) + usd;
    const costVersions = [...(win.costVersions || []), { usd, timestamp: Date.now() }];
    this._updateWindow(windowId, { totalCostUsd: newTotal, costVersions });
    this._persist();

    // Notify per-window CostDisplay
    window.dispatchEvent(new CustomEvent('costUpdate', {
      detail: {
        windowId,
        costData: { usd, points: 0, ms2: 0, cult: 0 },
        totalCost: { usd: newTotal, points: 0, ms2: 0, cult: 0 },
      },
    }));

    // Compute workspace total and notify CostHUD
    let workspaceUsd = newTotal;
    for (const [id, w] of this.state.windows) {
      if (id !== windowId) workspaceUsd += w.totalCostUsd || 0;
    }
    emitCosts({ usd: workspaceUsd, points: 0, ms2: 0, cult: 0 });
  }

  // Poll /api/v1/generation/status/:id until completed/failed, normalising into WS-shape.
  async _pollGenerationStatus(generationId) {
    const POLL_INTERVAL = 5000;
    const MAX_WAIT = 360000; // 6 min hard cap
    const deadline = Date.now() + MAX_WAIT;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      try {
        const res = await fetch(`/api/v1/generation/status/${generationId}`, { credentials: 'include' });
        if (res.status === 429) {
          const reset = res.headers.get('RateLimit-Reset');
          const waitMs = reset ? Math.max(parseInt(reset) * 1000 - Date.now(), 5000) : 30000;
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        if (!res.ok) continue;
        const data = await res.json();
        if (data.status === 'completed' || data.status === 'failed') {
          // Normalise poll response into the same { status, outputs } shape the WS handler produces
          const outputs = {};
          if (data.result?.images?.length) {
            outputs.images = data.result.images.map(url => ({ url }));
          } else if (data.result?.image) {
            outputs.images = [{ url: data.result.image }];
          }
          if (data.result?.video)  outputs.videoUrl = data.result.video;
          if (data.result?.videos?.length) outputs.videoUrl = data.result.videos[0];
          if (data.error) outputs.error = data.error;
          return { status: data.status, outputs };
        }
      } catch { /* transient — keep polling */ }
    }
    throw new Error('Generation timed out');
  }

  async _awaitCompletion(windowId, generationId) {
    let _stopProgressListener = null;
    try {
      // Ensure WS handlers are loaded
      if (!this._wsHandlers) await this._initWs();

      if (!this._wsHandlers?.generationCompletionManager) {
        throw new Error('WS handlers not available');
      }

      // Subscribe to per-generation progress ticks and update window status text.
      if (this._wsClient) {
        const handleProgress = (payload) => {
          if (payload?.generationId !== generationId) return;
          const parts = [];
          if (payload.liveStatus) parts.push(payload.liveStatus);
          else parts.push(payload.status === 'queued' ? 'Queued\u2026' : 'Running\u2026');
          if (typeof payload.progress === 'number') parts.push(`${Math.round(payload.progress * 100)}%`);
          this._updateWindow(windowId, { progress: parts.join(' ') });
        };
        this._wsClient.on('generationProgress', handleProgress);
        _stopProgressListener = () => this._wsClient.off('generationProgress', handleProgress);
      }

      // WS is primary. ComfyUI Deploy is webhook-driven — the server receives the webhook
      // and pushes to the client over WS. Only fall back to polling when WS is down.
      const wsConnected = this._wsClient?.isConnected?.() ?? false;
      const wsPromise = this._wsHandlers.generationCompletionManager
        .createCompletionPromise(generationId);

      let resultPromise;
      if (wsConnected) {
        resultPromise = wsPromise;
      } else {
        const pollPromise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            this._pollGenerationStatus(generationId).then(resolve).catch(reject);
          }, 10000);
          wsPromise.then(() => clearTimeout(timer)).catch(() => {});
        });
        resultPromise = Promise.race([wsPromise, pollPromise]);
      }

      const result = await resultPromise;
      _stopProgressListener?.();
      _stopProgressListener = null;

      if (result?.status === 'failed') {
        throw new Error(result.error || result.outputs?.error || 'Generation failed.');
      }

      const outputs = result?.outputs || {};
      let output;
      if (Array.isArray(outputs.images) && outputs.images[0]?.url) {
        output = { type: 'image', url: outputs.images[0].url, generationId };
      } else if (outputs.imageUrl) {
        output = { type: 'image', url: outputs.imageUrl, generationId };
      } else if (outputs.response) {
        output = { type: 'text', text: outputs.response, generationId };
      } else if (outputs.text) {
        output = { type: 'text', text: outputs.text, generationId };
      } else {
        output = { type: 'unknown', generationId, ...outputs };
      }

      const win = this.state.windows.get(windowId);
      if (!win) return;
      const versions = [...(win.outputVersions || []), output];
      this._updateWindow(windowId, {
        output, executing: false, progress: null, outputLoaded: true,
        outputVersions: versions, currentVersionIndex: versions.length - 1,
      });
      if (result.costUsd) this._recordCost(windowId, result.costUsd);
    } catch (err) {
      _stopProgressListener?.();
      this._updateWindow(windowId, { executing: false, error: err.message, progress: null });
    }
  }

  _normalizeOutput(result) {
    const outputs = result.outputs || {};
    const gid = result.generationId;
    if (Array.isArray(outputs.images) && outputs.images[0]?.url)
      return { type: 'image', url: outputs.images[0].url, generationId: gid };
    if (outputs.imageUrl) return { type: 'image', url: outputs.imageUrl, generationId: gid };
    if (outputs.response) return { type: 'text', text: outputs.response, generationId: gid };
    if (outputs.text) return { type: 'text', text: outputs.text, generationId: gid };
    if (outputs.description) return { type: 'text', text: outputs.description, generationId: gid };
    // Handle { type: 'text', data: { text: string|string[] } } — shape produced by immediate adapter path
    if (outputs.type === 'text' && outputs.data?.text) {
      const txt = Array.isArray(outputs.data.text) ? outputs.data.text[0] : outputs.data.text;
      if (txt) return { type: 'text', text: txt, generationId: gid };
    }
    // Handle { type: 'image', data: { images: [{ url }] } } — immediate adapter path with R2 URL
    if (outputs.type === 'image' && Array.isArray(outputs.data?.images) && outputs.data.images[0]?.url)
      return { type: 'image', url: outputs.data.images[0].url, generationId: gid };
    return { type: 'unknown', generationId: gid, ...outputs };
  }

  // ── Snapshot API (for workspaces.js bridge) ────────────────

  /**
   * Strip unsafe content from a canvas output for server storage.
   * Removes b64_json, data: URLs; normalises nested adapter format.
   */
  _sanitiseOutput(o) {
    if (!o) return null;
    // Prefer top-level url, fall back to nested images[0].url
    let url = (o.url && !o.url.startsWith('data:')) ? o.url : undefined;
    if (!url && o.data?.images?.[0]?.url && !o.data.images[0].url.startsWith('data:')) {
      url = o.data.images[0].url;
    }
    // Prefer top-level text, fall back to nested data.text
    let text = o.text;
    if (!text && o.data?.text) {
      text = Array.isArray(o.data.text) ? o.data.text[0] : o.data.text;
    }
    return { type: o.type, url, text, generationId: o.generationId };
  }

  /**
   * Return a serialisable snapshot in the server API format.
   * Maps internal {x, y} → {workspaceX, workspaceY} and strips large blobs.
   */
  getSnapshot() {
    const toolWindows = [...this.state.windows.values()].map(w => {
      const base = {
        id: w.id,
        workspaceX: w.x,
        workspaceY: w.y,
        output: this._sanitiseOutput(w.output),
        // outputVersions: new canvas stores versions as direct output objects (not {output:…} wrappers)
        outputVersions: (w.outputVersions || []).slice(-5).map(v => this._sanitiseOutput(v)),
        currentVersionIndex: w.currentVersionIndex ?? -1,
        parameterMappings: w.parameterMappings || {},
        tool: w.tool || null,
        ...(w.totalCostUsd ? { totalCostUsd: w.totalCostUsd } : {}),
        ...(w.costVersions?.length ? { costVersions: w.costVersions } : {}),
      };
      if (w.type === 'spell') {
        return { ...base, isSpell: true, spell: { _id: w.spell?._id, name: w.spell?.name } };
      }
      if (w.type === 'collection') {
        return { ...base, type: 'collection', mode: w.mode, collection: { collectionId: w.collection?.collectionId, name: w.collection?.name } };
      }
      return { ...base, type: w.type || 'tool', displayName: w.tool?.displayName || '', toolId: w.tool?.toolId || '' };
    });
    return { toolWindows, connections: [...this.state.connections.values()] };
  }

  /**
   * Replace canvas state from a server snapshot.
   * Maps {workspaceX, workspaceY} back to {x, y}.
   */
  loadFromSnapshot(snapshot) {
    const windows = new Map();
    const connections = new Map();

    // Build a cost fallback from localStorage for windows missing cost in the server snapshot.
    // Handles the race where beforeunload autosave fired before __csrfToken was set.
    const localCostMap = {};
    try {
      const raw = localStorage.getItem('sandbox_canvas_state');
      if (raw) {
        const localData = JSON.parse(raw);
        (localData.windows || []).forEach(lw => {
          if (lw.id && lw.totalCostUsd > 0) {
            localCostMap[lw.id] = { totalCostUsd: lw.totalCostUsd, costVersions: lw.costVersions || [] };
          }
        });
      }
    } catch {}

    (snapshot.toolWindows || []).forEach(w => {
      const localCost = localCostMap[w.id];
      const win = {
        id: w.id,
        x: w.workspaceX,
        y: w.workspaceY,
        output: w.output || null,
        outputVersions: w.outputVersions || [],
        currentVersionIndex: w.currentVersionIndex ?? -1,
        parameterMappings: w.parameterMappings || {},
        outputLoaded: !!w.output,
        totalCostUsd: w.totalCostUsd || localCost?.totalCostUsd || 0,
        costVersions: w.costVersions?.length ? w.costVersions : (localCost?.costVersions || []),
        // Restore the tool object if present (includes inputSchema for ParameterForm)
        tool: w.tool || { displayName: w.displayName || '', toolId: w.toolId || '' },
      };
      if (w.isSpell) {
        win.type = 'spell';
        win.spell = w.spell;
        win.tool = win.tool || { displayName: w.spell?.name || 'Spell', toolId: `spell:${w.spell?._id}`, metadata: { outputType: 'image' } };
        // Normalize legacy 'spell-' prefix (hyphen) to 'spell:' (colon) for backward compat
        if (win.tool?.toolId?.startsWith('spell-')) {
          win.tool = { ...win.tool, toolId: `spell:${win.tool.toolId.substring('spell-'.length)}` };
        }
      } else if (w.type === 'collection') {
        win.type = 'collection';
        win.collection = w.collection;
        win.mode = w.mode;
      } else {
        win.type = w.type || 'tool';
      }
      windows.set(win.id, win);
    });

    (snapshot.connections || []).forEach(c => connections.set(c.id, c));

    this.setState({ windows, connections, selection: new Set() });
    this._persist();

    // Re-seed cost displays after render — defer so CostDisplay/CostHUD have mounted
    setTimeout(() => {
      let workspaceUsd = 0;
      for (const w of windows.values()) {
        if (w.totalCostUsd > 0) {
          workspaceUsd += w.totalCostUsd;
          window.dispatchEvent(new CustomEvent('costUpdate', {
            detail: {
              windowId: w.id,
              costData: { usd: w.totalCostUsd, points: 0, ms2: 0, cult: 0 },
              totalCost: { usd: w.totalCostUsd, points: 0, ms2: 0, cult: 0 },
            },
          }));
        }
      }
      if (workspaceUsd > 0) emitCosts({ usd: workspaceUsd, points: 0, ms2: 0, cult: 0 });
    }, 0);
  }

  // ── Param changes ─────────────────────────────────────────

  _onParamChange(windowId, key, value) {
    const windows = new Map(this.state.windows);
    const win = windows.get(windowId);
    if (!win) return;
    const mappings = { ...(win.parameterMappings || {}) };
    mappings[key] = { type: 'static', value };
    windows.set(windowId, { ...win, parameterMappings: mappings });
    this.setState({ windows });
    this._persist();
  }

  _onPrimitiveChange(windowId, output) {
    this._updateWindow(windowId, { output, outputLoaded: true });
    this._persist();
  }

  _onLoadOutput(windowId) {
    this._updateWindow(windowId, { outputLoaded: true });
  }

  _onVersionChange(windowId, index) {
    const win = this.state.windows.get(windowId);
    if (!win?.outputVersions?.[index]) return;
    const ver = win.outputVersions[index];
    this._updateWindow(windowId, {
      currentVersionIndex: index,
      output: ver._pending ? win.output : ver,
      outputLoaded: true,
    });
  }

  // ── Persistence ───────────────────────────────────────────

  _persist() {
    try {
      const data = {
        windows: [...this.state.windows.values()].map(w => {
          const { outputLoaded, executing, progress, error, generationId, ...rest } = w;
          return rest;
        }),
        connections: [...this.state.connections.values()],
      };
      localStorage.setItem('sandbox_canvas_state', JSON.stringify(data));
    } catch (e) {
      console.warn('[SandboxCanvas] Persist failed:', e);
    }
  }

  // ── Public API ────────────────────────────────────────────

  addToolWindow(tool, position) {
    return this._addWindow({
      type: 'tool', tool,
      x: position?.x ?? 200, y: position?.y ?? 200,
      parameterMappings: this._initMappings(tool),
      output: null, outputVersions: [], currentVersionIndex: -1,
    });
  }

  addSpellWindow(spell, position) {
    return this._addWindow({
      type: 'spell', spell,
      tool: { displayName: spell.name, toolId: `spell:${spell.slug || spell._id}`, metadata: { outputType: 'image' } },
      x: position?.x ?? 200, y: position?.y ?? 200,
      parameterMappings: {},
      output: null, outputVersions: [], currentVersionIndex: -1,
    });
  }

  addPrimitiveWindow(outputType, position) {
    const displayNames = { text: 'Text', image: 'Image', int: 'Integer', float: 'Float' };
    return this._addWindow({
      type: 'primitive',
      tool: {
        displayName: displayNames[outputType] || outputType,
        toolId: null,
        metadata: { outputType },
      },
      x: position?.x ?? 200,
      y: position?.y ?? 200,
      parameterMappings: {},
      output: null,
      outputLoaded: true,
      outputVersions: [],
      currentVersionIndex: -1,
    });
  }

  addUploadWindow(url, position) {
    return this._addWindow({
      type: 'upload',
      tool: { displayName: 'Upload', toolId: null, metadata: { outputType: 'image' } },
      x: position?.x ?? 200, y: position?.y ?? 200,
      parameterMappings: {},
      output: { type: 'image', url },
      outputLoaded: true,
      outputVersions: [{ type: 'image', url }],
      currentVersionIndex: 0,
    });
  }

  _initMappings(tool) {
    const mappings = {};
    for (const [key, param] of Object.entries(tool.inputSchema || {})) {
      mappings[key] = { type: 'static', value: param.default ?? '' };
    }
    return mappings;
  }

  // ── Render ────────────────────────────────────────────────

  _renderWindowBody(win, compact = false) {
    const connections = [...this.state.connections.values()].filter(c => c.toWindowId === win.id);
    const commonProps = {
      win,
      connections,
      compact,
      onParamChange: (wid, key, val) => this._onParamChange(wid, key, val),
      onExecute: (wid) => this._executeWindow(wid),
      onLoadOutput: (wid) => this._onLoadOutput(wid),
    };

    switch (win.type) {
      case 'spell':     return [h(SpellWindowBody,     { key: 'body', ...commonProps })];
      case 'upload':    return [h(UploadWindowBody,    { key: 'body', win })];
      case 'primitive': return [h(PrimitiveWindowBody, { key: 'body', win, onOutputChange: (wid, out) => this._onPrimitiveChange(wid, out) })];
      case 'tool':
      default: return [h(ToolWindowBody, { key: 'body', ...commonProps })];
    }
  }

  static get styles() {
    return `
      .sc-root {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background-color: var(--canvas-bg);
        user-select: none;
        /*
         * Grid is applied via inline style in render() so that background-size
         * and background-position update with pan/zoom. The isometric period
         * is also scaled by viewport.scale to stay aligned at any zoom level.
         */
      }

      .sc-viewport {
        position: absolute;
        inset: 0;
        transform-origin: 0 0;
        will-change: transform;
      }

      /* ── Canvas sigil watermark ──────────────────── */
      .sc-sigil {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
        color: var(--text-primary);
        z-index: 0;
      }

      .sc-root--panning  { cursor: grabbing; }
      .sc-root--lasso    { cursor: crosshair; }
      .canvas--pan-mode  { cursor: grab; }
      .canvas--pan-mode.sc-root--panning { cursor: grabbing; }

      /* ── Lasso selection rectangle ───────────────── */
      .sc-lasso {
        position: absolute;
        pointer-events: none;
        border: 1px solid var(--accent);
        background: var(--accent-dim);
        z-index: 200;
      }
    `;
  }

  /** Build the combined ortho + isometric grid inline style for .sc-root */
  _buildGridStyle(viewport) {
    const { panX, panY, scale } = viewport;
    // Grid opacity: fade when zoomed out far
    const opacity = Math.min(1, Math.max(0.15, (scale - 0.2) / 0.8));
    // Cell sizes in screen pixels (scale with viewport)
    const orthoUnit = (32 * scale).toFixed(2);
    // Isometric: perpendicular spacing 16px at scale=1.
    // rhombus side = 16/sin(60°) ≈ 18.5px → horizontal diagonal = 32px.
    // This creates equilateral 60°/120° rhombuses. Scaled with viewport so
    // lines stay physically consistent regardless of zoom level.
    const isoSpacing = (16 * scale).toFixed(2);
    const co = `rgba(255,255,255,${(0.022 * opacity).toFixed(4)})`;
    const ci = `rgba(255,255,255,${(0.014 * opacity).toFixed(4)})`;
    const px = `${panX.toFixed(2)}px`;
    const py = `${panY.toFixed(2)}px`;

    return [
      `background-image:`,
      `  repeating-linear-gradient(90deg,  ${co} 0, ${co} 1px, transparent 1px, transparent ${orthoUnit}px),`,
      `  repeating-linear-gradient(0deg,   ${co} 0, ${co} 1px, transparent 1px, transparent ${orthoUnit}px),`,
      `  repeating-linear-gradient(30deg,  ${ci} 0, ${ci} 1px, transparent 1px, transparent ${isoSpacing}px),`,
      `  repeating-linear-gradient(150deg, ${ci} 0, ${ci} 1px, transparent 1px, transparent ${isoSpacing}px)`,
      `;background-position: ${px} ${py}`,
    ].join(' ');
  }

  render() {
    const { windows, connections, selection, viewport, activeConnection, activePan, activeLasso, pendingAnchorDrop, mobileConnecting } = this.state;
    const transform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.scale})`;
    const rootCls = `sc-root sandbox-canvas${activePan ? ' sc-root--panning' : ''}${activeLasso ? ' sc-root--lasso' : ''}`;

    // Lasso selection rectangle — screen-space overlay, computed outside h() children
    let lassoEl = null;
    if (activeLasso) {
      const lw = Math.abs(activeLasso.currentX - activeLasso.startX);
      const lh = Math.abs(activeLasso.currentY - activeLasso.startY);
      if (lw > 2 || lh > 2) {
        const lx = Math.min(activeLasso.startX, activeLasso.currentX) - activeLasso.originX;
        const ly = Math.min(activeLasso.startY, activeLasso.currentY) - activeLasso.originY;
        lassoEl = h('div', { className: 'sc-lasso', style: `left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px` });
      }
    }

    // data-connecting-type drives CSS-only highlight on compatible input anchors
    const connectingType = activeConnection?.outputType || mobileConnecting?.outputType;
    const connectingAttr = connectingType ? { 'data-connecting-type': connectingType } : {};

    // Grid background: computed per-render so scale/pan are baked into the CSS.
    // This is the only way to keep isometric lines aligned with orthogonal lines
    // across zoom levels — background-size/position track viewport exactly.
    const gridStyle = this._buildGridStyle(viewport);
    const compact = viewport.scale < 0.5;

    return h('div', {
      className: rootCls,
      ref: (el) => { this._rootEl = el; },
      onmousedown: this.bind(this._onCanvasMouseDown),
      style: gridStyle,
      ...connectingAttr,
    },
      // Sigil watermark — fixed to visible area, not part of canvas space
      h(Sigil, { size: 320, opacity: 0.025, className: 'sc-sigil' }),
      h('div', { className: 'sc-viewport', style: `transform: ${transform}` },
        ...[...windows.values()].map(win =>
          h(WindowRenderer, {
            key: win.id,
            win,
            selected: selection.has(win.id),
            bodyContent: this._renderWindowBody(win, compact),
            onDragStart: (wid, ox, oy) => this._startWindowDrag(wid, ox, oy),
            onClose: (wid) => this._removeWindow(wid),
            onAnchorDragStart: (wid, type, e) => this._startConnectionDrag(wid, type, e),
            onVersionChange: (wid, idx) => this._onVersionChange(wid, idx),
            onWindowClick: (wid, pos) => this._onWindowClick(wid, pos),
            mobileConnecting,
            onMobileConnectStart: (wid, type) => this._onMobileConnectStart(wid, type),
            onMobileConnectComplete: (wid, pk) => this._onMobileConnectComplete(wid, pk),
            onMobileConnectCancel: () => this._onMobileConnectCancel(),
          })
        ),
        h(ConnectionLayer, {
          connections: [...connections.values()],
          windows,
          activeConnection,
          onRemoveConnection: (cid) => this._removeConnection(cid),
          getAnchorPos: (wid, type, pk) => this._getAnchorPos(wid, type, pk),
        })
      ),

      lassoEl,

      // Spec 3: contextual picker when output anchor dropped on empty canvas
      pendingAnchorDrop
        ? h(ConnectionDropPicker, {
            key: 'drop-picker',
            outputType: pendingAnchorDrop.outputType,
            screenX: pendingAnchorDrop.screenX,
            screenY: pendingAnchorDrop.screenY,
            onSelect: (tool, paramKey) => this._onDropPickerSelect(tool, paramKey),
            onDismiss: () => this._onDropPickerDismiss(),
          })
        : null
    );
  }
}

/** Load persisted canvas state from localStorage. */
export function loadCanvasState() {
  try {
    const raw = localStorage.getItem('sandbox_canvas_state');
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      windows: data.windows || [],
      connections: data.connections || [],
    };
  } catch { return null; }
}
