import { Component, h } from '@monygroupcorp/microact';
import { ConnectionLayer } from './ConnectionLayer.js';
import { WindowRenderer } from './WindowRenderer.js';
import { ToolWindowBody, SpellWindowBody, UploadWindowBody } from './ToolWindowBody.js';
import { ConnectionDropPicker } from './ConnectionDropPicker.js';
import * as executionClient from '../executionClient.js';

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
        .forEach(w => windows.set(w.id, { ...w, outputLoaded: false }));
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
      // Set when an output anchor is dropped on empty canvas (Spec 3)
      pendingAnchorDrop: null, // { fromWindowId, outputType, workspacePos, screenX, screenY }
    };

    this._wsHandlers = null;
    this._rootEl = null;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
  }

  didMount() {
    // Expose public API globally so Sidebar, ActionModal, Sandbox.js can reach it
    window.sandboxCanvas = this;

    this._onKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        this._deleteSelected();
      }
    };
    document.addEventListener('keydown', this._onKeyDown);
    this.registerCleanup(() => document.removeEventListener('keydown', this._onKeyDown));

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
    e.preventDefault();
    const { viewport } = this.state;
    const direction = e.deltaY > 0 ? -1 : 1;
    const factor = Math.pow(ZOOM_FACTOR, direction * 3);
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, viewport.scale * factor));

    const rect = this._rootEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const scaleRatio = newScale / viewport.scale;
    const newPanX = mouseX - (mouseX - viewport.panX) * scaleRatio;
    const newPanY = mouseY - (mouseY - viewport.panY) * scaleRatio;

    this.setState({ viewport: { panX: newPanX, panY: newPanY, scale: newScale } });

    // Grid fades as you zoom out (feels infinite rather than bounded)
    const gridOpacity = Math.min(1, Math.max(0.15, (newScale - 0.2) / 0.8));
    this._rootEl && this._rootEl.style.setProperty('--grid-opacity', gridOpacity);
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

    if (e.button === 0) {
      this.setState({
        activePan: { startX: e.clientX, startY: e.clientY, startPanX: this.state.viewport.panX, startPanY: this.state.viewport.panY }
      });
      document.addEventListener('mousemove', this._onMouseMove);
      document.addEventListener('mouseup', this._onMouseUp);
      if (this.state.selection.size > 0) this.setState({ selection: new Set() });
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

  _onMouseMove(e) {
    const { activeDrag, activeConnection, activePan, viewport } = this.state;

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
    }
  }

  _onMouseUp(e) {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);

    const { activeDrag, activeConnection, activePan } = this.state;

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
      this.setState({ activePan: null });
    }
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
            if (sourceWin.output.type === 'image') inputs[key] = sourceWin.output.url;
            else if (sourceWin.output.type === 'text') inputs[key] = sourceWin.output.text;
            else inputs[key] = sourceWin.output.value || sourceWin.output;
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

  async _awaitCompletion(windowId, generationId) {
    try {
      // Ensure WS handlers are loaded
      if (!this._wsHandlers) await this._initWs();

      if (!this._wsHandlers?.generationCompletionManager) {
        throw new Error('WS handlers not available');
      }

      // Wait for WebSocket completion event
      const result = await this._wsHandlers.generationCompletionManager.createCompletionPromise(generationId);

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
    } catch (err) {
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
    return { type: 'unknown', generationId: gid, ...outputs };
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
      tool: { displayName: spell.name, toolId: `spell-${spell.slug || spell._id}`, metadata: { outputType: 'image' } },
      x: position?.x ?? 200, y: position?.y ?? 200,
      parameterMappings: {},
      output: null, outputVersions: [], currentVersionIndex: -1,
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

  _renderWindowBody(win) {
    const connections = [...this.state.connections.values()].filter(c => c.toWindowId === win.id);
    const commonProps = {
      win,
      connections,
      onParamChange: (wid, key, val) => this._onParamChange(wid, key, val),
      onExecute: (wid) => this._executeWindow(wid),
      onLoadOutput: (wid) => this._onLoadOutput(wid),
    };

    switch (win.type) {
      case 'spell': return [h(SpellWindowBody, { key: 'body', ...commonProps })];
      case 'upload': return [h(UploadWindowBody, { key: 'body', win })];
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
      }

      /* ── Ether grid ─────────────────────────────── */
      .sc-viewport {
        position: absolute;
        inset: 0;
        transform-origin: 0 0;
        will-change: transform;

        /* Orthogonal grid — 32px, very low contrast */
        --grid-color-ortho: rgba(255,255,255,calc(0.028 * var(--grid-opacity, 1)));
        /* Isometric diagonals — even fainter */
        --grid-color-iso:   rgba(255,255,255,calc(0.016 * var(--grid-opacity, 1)));

        background-image:
          /* Orthogonal vertical lines */
          repeating-linear-gradient(
            90deg,
            var(--grid-color-ortho) 0px,
            var(--grid-color-ortho) 1px,
            transparent 1px,
            transparent var(--grid-unit, 32px)
          ),
          /* Orthogonal horizontal lines */
          repeating-linear-gradient(
            0deg,
            var(--grid-color-ortho) 0px,
            var(--grid-color-ortho) 1px,
            transparent 1px,
            transparent var(--grid-unit, 32px)
          ),
          /* Isometric diagonal A — 30° */
          repeating-linear-gradient(
            30deg,
            var(--grid-color-iso) 0px,
            var(--grid-color-iso) 1px,
            transparent 1px,
            transparent calc(var(--grid-unit, 32px) * 1.155)
          ),
          /* Isometric diagonal B — 150° */
          repeating-linear-gradient(
            150deg,
            var(--grid-color-iso) 0px,
            var(--grid-color-iso) 1px,
            transparent 1px,
            transparent calc(var(--grid-unit, 32px) * 1.155)
          );

        background-size:
          var(--grid-unit, 32px) var(--grid-unit, 32px),
          var(--grid-unit, 32px) var(--grid-unit, 32px),
          auto, auto;
      }

      /* ── Node layer ─────────────────────────────── */
      .sc-nodes {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

      .sc-root--panning { cursor: grabbing; }
    `;
  }

  render() {
    const { windows, connections, selection, viewport, activeConnection, activePan, pendingAnchorDrop } = this.state;
    const transform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.scale})`;
    const rootCls = `sc-root sandbox-canvas${activePan ? ' sc-root--panning' : ''}`;

    // data-connecting-type drives CSS-only highlight on compatible input anchors
    const connectingAttr = activeConnection
      ? { 'data-connecting-type': activeConnection.outputType }
      : {};

    return h('div', {
      className: rootCls,
      ref: (el) => { this._rootEl = el; },
      onmousedown: this.bind(this._onCanvasMouseDown),
      onwheel: this.bind(this._onWheel),
      ...connectingAttr,
    },
      h('div', { className: 'sc-viewport', style: `transform: ${transform}` },
        ...[...windows.values()].map(win =>
          h(WindowRenderer, {
            key: win.id,
            win,
            selected: selection.has(win.id),
            bodyContent: this._renderWindowBody(win),
            onDragStart: (wid, ox, oy) => this._startWindowDrag(wid, ox, oy),
            onClose: (wid) => this._removeWindow(wid),
            onAnchorDragStart: (wid, type, e) => this._startConnectionDrag(wid, type, e),
            onVersionChange: (wid, idx) => this._onVersionChange(wid, idx),
          })
        ),
        h(ConnectionLayer, {
          connections: [...connections.values()],
          windows,
          activeConnection,
          onRemoveConnection: (cid) => this._removeConnection(cid),
        })
      ),

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
