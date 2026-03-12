import { Component, h, eventBus } from '@monygroupcorp/microact';
import { CanvasEngine } from './CanvasEngine.js';
import { ToolWindowBody, UploadWindowBody } from '../canvas/ToolWindowBody.js';
import * as executionClient from '../executionClient.js';
import { emitCosts } from '../store.js';
import '../../style/focus-demo.css';

// ── Type helpers ──────────────────────────────────────────────────────────────
function normalizeType(t) {
  if (!t) return null;
  if (Array.isArray(t)) return normalizeType(t[0]);
  if (t === 'string' || t === 'textany') return 'text';
  if (t === 'integer') return 'int';
  if (t === 'number' || t === 'decimal') return 'float';
  return t;
}

// Minimal SVG glyphs — 10×10 viewBox, currentColor
function anchorIcon(type) {
  const s = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const p = { viewBox: '0 0 10 10', style: 'width:8px;height:8px;flex-shrink:0;display:block' };
  switch (type) {
    case 'text':  return h('svg', p, h('path', { ...s, d: 'M2 3h6M5 3v4' }));
    case 'image': return h('svg', p, h('rect', { x:'1', y:'1', width:'8', height:'8', rx:'1', ...s }), h('path', { ...s, d: 'M1.5 7.5L3.5 5L5.5 7L7 5.5L8.5 7.5' }));
    case 'video': return h('svg', p, h('path', { fill: 'currentColor', stroke: 'none', d: 'M2.5 2L8 5L2.5 8Z' }));
    case 'audio': return h('svg', p, h('path', { ...s, d: 'M2 8V5M4.5 8V2.5M7.5 8V4M9.5 8V6' }));
    case 'int':   return h('svg', p, h('path', { ...s, d: 'M3.5 2v6M6.5 2v6M1.5 4.5h7M1.5 6.5h7' }));
    case 'float': return h('svg', p, h('path', { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', d: 'M1 5C2 2.5 4 7.5 5 5S8 2.5 9 5' }));
    default:      return h('svg', p, h('circle', { cx: '5', cy: '5', r: '2.5', fill: 'currentColor', stroke: 'none' }));
  }
}

// Half-width of node chip (matches .sc2-node { width: 140px })
const CHIP_HW = 70;
// Vertical spacing between stacked input anchors
const PORT_STRIDE = 18;

const SCALE_Z2 = 0.45;
const SCALE_Z1 = 1.0;
const MIN_SCALE = 0.15;
const MAX_SCALE = 4.0;
const MIN_VELOCITY = 0.1;
const FRICTION = 0.985;

export class SandboxCanvas2 extends Component {
  constructor(props) {
    super(props);
    this._engine = new CanvasEngine();

    // Load initial state from props (cut-over compatibility)
    if (props.initialWindows?.length) {
      for (const win of props.initialWindows) {
        this._engine.windows.set(win.id, { ...win, x: win.x ?? win.workspaceX ?? 0, y: win.y ?? win.workspaceY ?? 0 });
        this._engine.physics.addNode(win.id, { x: win.x ?? win.workspaceX ?? 0, y: win.y ?? win.workspaceY ?? 0 });
      }
    }
    if (props.initialConnections?.length) {
      for (const conn of props.initialConnections) {
        this._engine.connections.set(conn.id, conn);
        this._engine.physics.addConnection(conn.id, conn.fromWindowId ?? conn.from, conn.toWindowId ?? conn.to);
      }
    }

    this._panX = 0;
    this._panY = 0;
    this._scale = SCALE_Z2;
    this._nodePositions = new Map();
    this._rafId = null;
    this._lastTime = null;
    this._pointerCanvasPos = null;

    // Gesture state
    this._gestureStart = null;
    this._panAtGestureStart = null;
    this._panStart = null;
    this._pinchStart = null;
    this._lastTap = null;
    this._longPressTimeout = null;
    this._momentum = { vx: 0, vy: 0, running: false, lastTs: 0 };
    this._velBuffer = [];
    this._lastMoveTime = null;

    // Mouse drag
    this._isDraggingNode = null;
    this._mouseDragStart = null;

    // Execution
    this._wsInitPromise = null;
    this._wsHandlers = null;
    this._wsClient = null;

    this._clipboard = null;
    this._boundKeyDown = this._onKeyDown.bind(this);

    this.state = {
      fsmState: 'CANVAS_Z2',
      focusedWindowId: null,
      tick: 0,
      multiSelectIds: new Set(),
      canvasMenu: null, // { x, y } screen coords for paste menu
      windows: this._engine.windows,         // live Map ref for window.sandboxCanvas compat
      connections: this._engine.connections,  // live Map ref for window.sandboxCanvas compat
      nodeModeShowOptional: false,
      descriptionExpanded: false,
      originPos: null, // workspace coords { x, y } for Z2 home swipe
      imageOverlay: null, // { url, label } for lightbox
    };
  }

  // ─── Public API (preserves window.sandboxCanvas interface) ───────────────

  addToolWindow(tool, position) {
    return this._engine.addToolWindow(tool, position || this._defaultPos());
  }

  addSpellWindow(spell, position) {
    return this._engine.addSpellWindow(spell, position || this._defaultPos());
  }

  addUploadWindow(url, position) {
    return this._engine.addUploadWindow(url, position || this._defaultPos());
  }

  addPrimitiveWindow(outputType, position) {
    return this._engine.addPrimitiveWindow(outputType, position || this._defaultPos());
  }

  addEffectWindow(tool, position) {
    return this._engine.addEffectWindow(tool, position || this._defaultPos());
  }

  addCollectionTestWindow(collection, position) {
    return this._engine.addCollectionTestWindow(collection, position || this._defaultPos());
  }

  screenToWorkspace(clientX, clientY) {
    return this._engine.screenToWorkspace(clientX, clientY, this._panX, this._panY, this._scale);
  }

  updateWindowOutput(id, output) { this._engine.updateWindowOutput(id, output); }
  updateWindowOutputs(id, outputs) { this._engine.updateWindowOutputs(id, outputs); }
  clearWindowOutput(id) { this._engine.clearWindowOutput(id); }

  _onParamChange(windowId, paramKey, value) {
    const win = this._engine.windows.get(windowId);
    if (!win) return;
    const mappings = { ...(win.parameterMappings || {}), [paramKey]: { type: 'static', value } };
    this._engine.updateWindow(windowId, { parameterMappings: mappings });
  }

  _onPrimitiveChange(windowId, output) {
    this._engine.updateWindowOutput(windowId, output);
  }

  _defaultPos() {
    return this._engine.screenToWorkspace(
      window.innerWidth / 2 + (Math.random() - 0.5) * 80,
      window.innerHeight / 2 + (Math.random() - 0.5) * 80,
      this._panX, this._panY, this._scale
    );
  }

  // Find a workspace position that is clear of existing nodes.
  // Starts down+right of the focused node (or rightmost node), shifts right until open.
  _findClearPosition() {
    const STEP = 220;
    const CLEAR_R = 160;

    let baseX = 0, baseY = 0;
    const focusedId = this._engine.focusedWindowId;
    if (focusedId) {
      const win = this._engine.windows.get(focusedId);
      if (win) { baseX = win.x + STEP; baseY = win.y + 160; }
    } else if (this._engine.windows.size > 0) {
      let maxX = -Infinity;
      for (const w of this._engine.windows.values()) {
        if (w.x > maxX) { maxX = w.x; baseX = w.x + STEP; baseY = w.y + 160; }
      }
    }

    let x = baseX, y = baseY;
    for (let attempt = 0; attempt < 10; attempt++) {
      let clear = true;
      for (const w of this._engine.windows.values()) {
        if (Math.hypot(w.x - x, w.y - y) < CLEAR_R) { clear = false; break; }
      }
      if (clear) break;
      x += STEP;
    }
    return { x, y };
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  didMount() {
    window.sandboxCanvas = this;

    this._engine.fsm.onChange((from, to, nodeId) => {
      this._onFsmChange(from, to, nodeId);
    });

    this._startPhysicsLoop();

    // Touch
    this._rootEl.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
    this._rootEl.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: false });
    this._rootEl.addEventListener('touchend', this._onTouchEnd.bind(this));

    // Mouse
    this._rootEl.addEventListener('mousedown', this._onMouseDown.bind(this));
    this._rootEl.addEventListener('wheel', this._onWheel.bind(this), { passive: false });

    // Keyboard
    document.addEventListener('keydown', this._boundKeyDown);

    this._initWs();
  }

  willUnmount() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._momentum.running) {
      this._momentum.running = false;
    }
    document.removeEventListener('keydown', this._boundKeyDown);
    if (window.sandboxCanvas === this) delete window.sandboxCanvas;
  }

  // ─── FSM state change ────────────────────────────────────────────────────

  _onFsmChange(from, to, nodeId) {
    const update = { fsmState: to, focusedWindowId: nodeId ?? null };

    if (to === 'CANVAS_Z2') {
      // Zoom out: reset scale, keep pan
      this._scale = SCALE_Z2;
      this._animateViewport();
    } else if ((to === 'CANVAS_Z1' || to === 'NODE_MODE') && nodeId) {
      // Zoom in: center on focused node
      const win = this._engine.windows.get(nodeId);
      if (win) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        this._scale = SCALE_Z1;
        this._panX = cx - win.x * SCALE_Z1;
        this._panY = cy - win.y * SCALE_Z1;
      } else {
        this._scale = SCALE_Z1;
      }
      this._animateViewport();
    }

    this.setState(update);
  }

  _animateViewport() {
    if (!this._rootEl) return;
    const vp = this._rootEl.querySelector('.sc2-viewport');
    if (!vp) return;
    vp.classList.add('sc2-viewport--animating');
    clearTimeout(this._vpAnimTimeout);
    this._vpAnimTimeout = setTimeout(() => {
      vp?.classList.remove('sc2-viewport--animating');
    }, 320);
  }

  // ─── Physics loop ────────────────────────────────────────────────────────

  _startPhysicsLoop() {
    const loop = (time) => {
      if (this._lastTime !== null) {
        const dt = Math.min(time - this._lastTime, 50);
        const positions = this._engine.step(dt);
        for (const [id, pos] of positions) {
          this._nodePositions.set(id, pos);
          const win = this._engine.windows.get(id);
          if (win) { win.x = pos.x; win.y = pos.y; }
        }
        this._renderTick = (this._renderTick || 0) + 1;
        this.setState({ tick: this._renderTick });
      }
      this._lastTime = time;

      // Momentum pan
      if (this._momentum.running) {
        const now = performance.now();
        const dt2 = now - this._momentum.lastTs;
        this._momentum.lastTs = now;
        this._panX += this._momentum.vx * dt2;
        this._panY += this._momentum.vy * dt2;
        this._momentum.vx *= FRICTION;
        this._momentum.vy *= FRICTION;
        if (Math.hypot(this._momentum.vx, this._momentum.vy) < MIN_VELOCITY) {
          this._momentum.running = false;
        }
      }

      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  // ─── Rendering ───────────────────────────────────────────────────────────

  render() {
    const { fsmState, focusedWindowId, multiSelectIds, canvasMenu } = this.state;
    const transform = `translate(${this._panX}px, ${this._panY}px) scale(${this._scale})`;

    const nodeModePanel = fsmState === 'NODE_MODE' && focusedWindowId
      ? this._renderNodeModePanel(focusedWindowId)
      : null;

    const actionBar = fsmState === 'MULTI_SELECT'
      ? this._renderActionBar(multiSelectIds)
      : null;

    const showFab = fsmState !== 'MULTI_SELECT';

    const { originPos } = this.state;
    return h('div', { className: 'sc2-root', ref: el => { this._rootEl = el; } },
      h('div', { className: 'sc2-viewport', style: { transform } },
        this._renderConnections(),
        ...this._renderNodes(fsmState, focusedWindowId, multiSelectIds),
        originPos ? h('div', {
          className: 'sc2-origin-marker',
          style: { left: `${originPos.x}px`, top: `${originPos.y}px` },
          title: 'Home origin',
        }) : null,
      ),
      nodeModePanel,
      actionBar,
      canvasMenu ? this._renderCanvasMenu(canvasMenu) : null,
      this.state.imageOverlay ? h('div', {
        className: 'fd-image-overlay',
        onclick: () => this.setState({ imageOverlay: null }),
      },
        h('div', { className: 'fd-image-overlay-wrap', onclick: (e) => e.stopPropagation() },
          h('button', {
            className: 'fd-image-overlay-close',
            onclick: () => this.setState({ imageOverlay: null }),
          }, '×'),
          h('div', { className: 'fd-image-overlay-skeleton' }),
          h('img', {
            src: this.state.imageOverlay.url,
            className: 'fd-image-overlay-img',
            alt: this.state.imageOverlay.label || '',
            draggable: false,
          }),
        ),
      ) : null,
      showFab ? h('button', {
        className: 'sc2-fab',
        title: 'Add node',
        ontouchstart: (e) => e.stopPropagation(),
        onclick: (e) => {
          e.stopPropagation();
          if (this._engine.fsmState === 'NODE_MODE') {
            this._engine.zoomOut(); // dismiss node mode panel → Z1
          }
          const pos = this._findClearPosition();
          const cx = window.innerWidth / 2;
          const cy = window.innerHeight / 2;
          this._scale = SCALE_Z1;
          this._panX = cx - pos.x * SCALE_Z1;
          this._panY = cy - pos.y * SCALE_Z1;
          this._animateViewport();
          setTimeout(() => {
            eventBus.emit('sandbox:canvasTap', { x: cx, y: cy });
          }, 300);
        },
      }, '+') : null,
    );
  }

  // Compute the workspace-coords y position of a port on a chip.
  // portIdx = index in the schema keys array, numPorts = total ports.
  _portY(winY, portIdx, numPorts) {
    return winY + (portIdx - (numPorts - 1) / 2) * PORT_STRIDE;
  }

  _inputSchema(win) {
    return win.tool?.inputSchema || win.tool?.metadata?.inputSchema || {};
  }

  _renderConnections() {
    const nodes = this._engine.windows;
    const conns = this._engine.connections;
    const paths = [];

    for (const [, conn] of conns) {
      const from = nodes.get(conn.from ?? conn.fromWindowId);
      const to = nodes.get(conn.to ?? conn.toWindowId);
      if (!from || !to) continue;

      // Output anchor is on right edge of source chip
      const x1 = from.x + CHIP_HW;
      const y1 = from.y;

      // Input anchor y depends on port index in target schema
      const toSchema = this._inputSchema(to);
      const toKeys = Object.keys(toSchema);
      const toIdx = toKeys.indexOf(conn.toInput);
      const x2 = to.x - CHIP_HW;
      const y2 = this._portY(to.y, toIdx >= 0 ? toIdx : 0, Math.max(toKeys.length, 1));

      const cx = (x1 + x2) / 2;
      const d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
      paths.push(h('path', { key: conn.id, className: 'sc2-conn-path', d, 'data-type': conn.dataType || conn.type || '' }));
    }

    // Pending connection line — from source output anchor to pointer
    if (this._engine.fsm.isConnecting) {
      const { sourceNodeId } = this._engine.fsm.connection;
      const sourceWin = this._engine.windows.get(sourceNodeId);
      if (sourceWin && this._pointerCanvasPos) {
        const d = `M ${sourceWin.x + CHIP_HW} ${sourceWin.y} L ${this._pointerCanvasPos.x} ${this._pointerCanvasPos.y}`;
        paths.push(h('path', { key: '__pending', className: 'sc2-conn-path sc2-conn-path--pending', d }));
      }
    }

    return h('svg', { className: 'sc2-conn-layer' }, ...paths);
  }

  _renderNodes(fsmState, focusedWindowId, multiSelectIds) {
    const chips = [];
    const isConnecting = this._engine.fsm.isConnecting;
    const connection = this._engine.fsm.connection;
    const showAnchors = fsmState !== 'CANVAS_Z2'; // only show anchors at Z1 and beyond

    for (const [, win] of this._engine.windows) {
      const label = win.tool?.displayName || win.spell?.name || win.type;
      const typeLabel = win.type === 'tool' ? (win.tool?.metadata?.outputType || 'tool') : win.type;
      const isFocused = win.id === focusedWindowId;
      const isSelected = multiSelectIds?.has(win.id);
      const isSource = isConnecting && connection?.sourceNodeId === win.id;
      const thumbUrl = win.output?.type === 'image' ? win.output.url : null;
      const thumb = thumbUrl ? h('img', {
        className: 'sc2-node-thumb sc2-node-thumb--clickable',
        src: thumbUrl,
        alt: '',
        onclick: (e) => {
          e.stopPropagation();
          if (fsmState === 'CANVAS_Z2') {
            // Z2: zoom to Z1 on this node
            this._engine.tapNode(win.id);
          } else {
            // Z1: open lightbox
            this.setState({ imageOverlay: { url: thumbUrl, label: win.tool?.displayName || win.type } });
          }
        },
      }) : null;

      let cls = 'sc2-node';
      if (isFocused) cls += ' sc2-node--focused';
      if (win.pinned) cls += ' sc2-node--pinned';
      if (isSelected) cls += ' sc2-node--selected';
      if (win.executing) cls += ' sc2-node--executing';

      // ── Output anchor (Z1+ only) ───────────────────────────────────────────
      // Upload nodes: batch anchor when 2+ same-type outputs; single output anchor for 1 image; none for 0
      // All other nodes: single typed output anchor
      let outputAnchor = null;
      if (!showAnchors) { /* skip at Z2 */ } else
      if (win.type === 'upload') {
        const slots = win.outputs || [];
        const hasBatch = slots.length > 1 && slots.every(o => o.type === slots[0]?.type);
        if (hasBatch) {
          const batchType = normalizeType(slots[0].type);
          outputAnchor = h('button', {
            className: `sc2-anchor sc2-anchor--output sc2-anchor--batch${isSource ? ' sc2-anchor--active' : ''}`,
            title: `Batch connect (${slots.length} × ${batchType})`,
            onclick: (e) => { e.stopPropagation(); this._startBatchConnection(win); },
          }, anchorIcon(batchType));
        } else if (slots.length === 1) {
          const slotType = normalizeType(slots[0].type);
          outputAnchor = h('button', {
            className: `sc2-anchor sc2-anchor--output${isSource ? ' sc2-anchor--active' : ''}`,
            title: `Connect output (${slotType || 'image'})`,
            onclick: (e) => { e.stopPropagation(); this._startOutputConnection(win); },
          }, anchorIcon(slotType));
        }
      } else if (win.type === 'tool' || win.type === 'spell' || win.type === 'primitive') {
        const outputType = normalizeType(win.tool?.metadata?.outputType || win.tool?.outputType || win.outputType);
        outputAnchor = h('button', {
          className: `sc2-anchor sc2-anchor--output${isSource ? ' sc2-anchor--active' : ''}`,
          title: `Connect output (${outputType || 'any'})`,
          onclick: (e) => { e.stopPropagation(); this._startOutputConnection(win); },
        }, anchorIcon(outputType));
      }

      // ── Input anchors (Z1+ only) ──────────────────────────────────────────
      // Required inputs always shown at Z1; active + type-matched when connecting
      const inputAnchors = [];
      if (showAnchors && (win.type === 'tool' || win.type === 'spell')) {
        const schema = this._inputSchema(win);
        // Only required inputs shown as anchors on chip; optional only accessible via NODE_MODE
        const allKeys = Object.keys(schema);
        const keys = isConnecting ? allKeys : allKeys.filter(k => schema[k]?.required !== false);
        const sourceType = connection?.sourceType;
        const showActive = isConnecting && !isSource;
        keys.forEach((key, i) => {
          const portType = normalizeType(schema[key]?.type);
          const isWired = this._isPortWired(win.id, key);
          let anchorCls = 'sc2-anchor sc2-anchor--input';
          if (showActive) {
            const isMatch = !sourceType || !portType || sourceType === portType;
            anchorCls += isMatch ? ' sc2-anchor--matching' : ' sc2-anchor--nonmatching';
          } else {
            anchorCls += isWired ? ' sc2-anchor--wired' : ' sc2-anchor--idle';
          }
          inputAnchors.push(h('button', {
            key,
            className: anchorCls,
            style: { top: `calc(50% + ${(i - (keys.length - 1) / 2) * PORT_STRIDE}px)` },
            title: `${key} (${portType || 'any'})`,
            onclick: (e) => {
              e.stopPropagation();
              if (isConnecting && !isSource) this._completeInputConnection(win.id, key, portType);
            },
          }, anchorIcon(portType)));
        });
      }

      chips.push(h('div', {
        key: win.id,
        className: cls,
        style: { left: `${win.x}px`, top: `${win.y}px` },
        'data-window-id': win.id,
        onclick: (e) => { e.stopPropagation(); this._onTapNode(win.id); },
        ondblclick: (e) => { e.stopPropagation(); this._onDoubleTapNode(win.id); },
      },
        win.executing ? h('div', { className: 'sc2-node-progress-bar' }) : null,
        h('div', { className: 'sc2-node-label' }, label),
        h('div', { className: 'sc2-node-type' }, win.executing ? (win.progress || 'Running…') : typeLabel),
        thumb,
        outputAnchor,
        ...inputAnchors,
      ));
    }
    return chips;
  }

  _onTapNode(id) {
    if (this._engine.fsm.isConnecting) {
      const { sourceNodeId, sourcePort, sourceType } = this._engine.fsm.connection;
      if (id !== sourceNodeId) {
        const targetWin = this._engine.windows.get(id);
        const targetTool = targetWin?.tool;
        const schema = targetTool?.metadata?.inputSchema || targetTool?.inputSchema || {};
        const inputKey = Object.keys(schema).find(k => !this._isPortWired(id, k)) || Object.keys(schema)[0];
        if (inputKey) {
          const connId = this._engine._genId('c');
          this._engine.addCanvasConnection(connId, sourceNodeId, id, sourcePort, inputKey, sourceType);
        }
        this._engine.fsm.clearConnection();
      }
      return;
    }

    if (this.state.fsmState === 'MULTI_SELECT') {
      this._engine.fsm.toggleSelection(id);
      this.setState({ multiSelectIds: new Set(this._engine.fsm.selectedNodeIds) });
      return;
    }

    // Z1: any tap on a node enters NODE_MODE for that node directly
    if (this.state.fsmState === 'CANVAS_Z1') {
      this._engine.doubleTapNode(id);
      this.setState({ nodeModeShowOptional: false });
      return;
    }

    this._engine.tapNode(id);
  }

  _onDoubleTapNode(id) {
    this._engine.doubleTapNode(id);
    this.setState({ nodeModeShowOptional: false });
  }

  _isPortWired(windowId, inputKey) {
    for (const conn of this._engine.connections.values()) {
      if ((conn.to ?? conn.toWindowId) === windowId && conn.toInput === inputKey) return true;
    }
    return false;
  }

  _startOutputConnection(win) {
    const outType = normalizeType(win.tool?.metadata?.outputType || win.tool?.outputType || win.outputType);
    this._engine.fsm.startConnection(win.id, 'output', outType);
    // If in NODE_MODE, zoom out so the user can pick a target node
    if (this._engine.fsm.state === 'NODE_MODE') {
      this._engine.zoomOut();
    }
    this.setState({ fsmState: this._engine.fsmState });
  }

  _startBatchConnection(win) {
    const slots = win.outputs || [];
    const batchType = normalizeType(slots[0]?.type || 'image');
    this._engine.fsm.startConnection(win.id, 'batch', batchType);
    if (this._engine.fsm.state === 'NODE_MODE') {
      this._engine.zoomOut();
    }
    this.setState({ fsmState: this._engine.fsmState });
  }

  _completeInputConnection(targetWinId, inputKey, inputType) {
    const conn = this._engine.fsm.connection;
    if (!conn) return;
    const { sourceNodeId, sourcePort, sourceType } = conn;
    const connId = this._engine._genId('c');
    this._engine.addCanvasConnection(connId, sourceNodeId, targetWinId, sourcePort, inputKey, sourceType || inputType);
    this._engine.fsm.clearConnection();
    // Zoom into the target node to show it connected
    this._engine.tapNode(targetWinId);
    this.setState({ fsmState: this._engine.fsmState, focusedWindowId: this._engine.focusedWindowId });
  }

  // ─── NODE_MODE — full-screen overlay ─────────────────────────────────────

  _renderParamInput(windowId, key, field, currentVal) {
    const onchange = (e) => this._onParamChange(windowId, key, e.target.value);
    if (field.type === 'image' || field.type === 'video' || field.type === 'audio') {
      return h('span', { className: 'fd-param-type' }, field.type);
    }
    if (field.enum) {
      return h('select', { className: 'fd-param-select', value: currentVal, onchange },
        ...field.enum.map(opt => h('option', { value: opt, selected: opt === currentVal }, opt)),
      );
    }
    if (field.type === 'boolean') {
      return h('input', { className: 'fd-param-checkbox', type: 'checkbox', checked: !!currentVal,
        onchange: (e) => this._onParamChange(windowId, key, e.target.checked),
      });
    }
    return h('input', {
      className: 'fd-param-input',
      type: (field.type === 'number' || field.type === 'integer') ? 'number' : 'text',
      value: currentVal,
      placeholder: field.description || key,
      onchange,
    });
  }

  _renderNodeModePanel(windowId) {
    const win = this._engine.windows.get(windowId);
    if (!win) return null;

    const allConns = [...this._engine.connections.values()];
    const windowConns = allConns
      .filter(c => (c.from ?? c.fromWindowId) === windowId || (c.to ?? c.toWindowId) === windowId)
      .map(c => ({ ...c, fromWindowId: c.from ?? c.fromWindowId, toWindowId: c.to ?? c.toWindowId }));

    const isPinned = this._engine.physics.getNode?.(windowId)?.pinned ?? win.pinned;
    const tool = win.tool;

    // ── Card 1: Identity ─────────────────────────────────────────────────────
    const desc = tool?.description;
    const LIMIT = 120;
    const isLong = desc && desc.length > LIMIT;
    const identityCard = h('div', { className: 'fd-card fd-card-header' },
      h('div', { className: 'fd-card-title' }, tool?.displayName || win.spell?.name || win.type),
      h('div', { className: 'fd-card-meta' },
        tool?.deliveryMode ? h('span', { className: `fd-delivery-badge fd-delivery-${tool.deliveryMode}` }, tool.deliveryMode) : null,
        tool?.metadata?.provider ? h('span', { className: 'fd-provider-tag' }, tool.metadata.provider) : null,
        isPinned ? h('span', { className: 'fd-pin-tag' }, 'pinned') : null,
        win.type !== 'tool' ? h('span', { className: 'fd-provider-tag' }, win.type) : null,
      ),
      desc ? h('div', { className: 'fd-card-description' },
        isLong && !this.state.descriptionExpanded ? desc.slice(0, LIMIT) + '…' : desc,
        isLong ? h('button', {
          className: 'fd-desc-toggle',
          onclick: (e) => { e.stopPropagation(); this.setState({ descriptionExpanded: !this.state.descriptionExpanded }); },
        }, this.state.descriptionExpanded ? ' less' : ' more') : null,
      ) : null,
    );

    // ── Card 2: Params with inline anchors (demo pattern) ─────────────────────
    const isConnecting = this._engine.fsm.isConnecting;
    const connection = this._engine.fsm.connection;
    const sourceType = connection?.sourceType;
    const isIncomingTarget = isConnecting && connection?.sourceNodeId !== windowId;
    const showOptional = this.state.nodeModeShowOptional;

    let bodyCard;
    if (win.type === 'tool' || win.type === 'spell') {
      const schema = this._inputSchema(win);
      const outSchema = win.tool?.outputSchema || win.tool?.metadata?.outputSchema || null;

      const renderParamRow = (key, field) => {
        const connectedFrom = [...this._engine.connections.values()]
          .find(c => (c.to ?? c.toWindowId) === windowId && c.toInput === key);
        const portType = normalizeType(field.type);
        const typeMatch = isIncomingTarget && (!sourceType || !portType || sourceType === portType);
        const currentVal = win.parameterMappings?.[key]?.value ?? field.default ?? '';
        return h('div', { key, className: 'fd-param-row fd-param-row-input' },
          h('button', {
            className: [
              'fd-param-anchor',
              connectedFrom ? 'fd-param-anchor-connected' : '',
              isIncomingTarget && typeMatch ? 'fd-param-anchor--matching' : '',
            ].filter(Boolean).join(' '),
            title: connectedFrom ? 'Wired' : isIncomingTarget ? (typeMatch ? 'Connect here' : 'Connect (type mismatch)') : 'Wire input',
            onclick: (e) => {
              e.stopPropagation();
              if (isIncomingTarget) this._completeInputConnection(windowId, key, field.type);
            },
          }, anchorIcon(portType)),
          h('div', { className: 'fd-param-body' },
            h('label', { className: 'fd-param-label' }, field.name || key),
            connectedFrom
              ? h('div', { className: 'fd-param-wired' },
                  h('span', { className: 'fd-param-type' },
                    this._engine.windows.get(connectedFrom.from ?? connectedFrom.fromWindowId)?.tool?.displayName || 'connected',
                  ),
                  connectedFrom.typeMismatch ? h('span', { className: 'fd-param-mismatch' }, '⚠') : null,
                  h('button', {
                    className: 'fd-param-disconnect',
                    title: 'Disconnect',
                    onclick: (e) => { e.stopPropagation(); this._engine.connections.delete(connectedFrom.id); this.setState({}); },
                  }, '×'),
                )
              : this._renderParamInput(windowId, key, field, currentVal),
          ),
        );
      };

      const entries = Object.entries(schema);
      const required = entries.filter(([, f]) => f.required !== false);
      const optional = entries.filter(([, f]) => f.required === false);

      const outRows = outSchema ? Object.entries(outSchema).map(([key, field]) => {
        const connectedTo = [...this._engine.connections.values()]
          .filter(c => (c.from ?? c.fromWindowId) === windowId);
        return h('div', { key, className: 'fd-param-row fd-param-row-output' },
          h('div', { className: 'fd-param-body' },
            h('label', { className: 'fd-param-label' }, field.name || key),
            h('span', { className: 'fd-param-type' }, field.type),
            connectedTo.length ? h('div', { className: 'fd-param-wired-list' },
              ...connectedTo.map(c => h('div', { key: c.id, className: 'fd-param-wired' },
                h('span', { className: 'fd-param-type' },
                  this._engine.windows.get(c.to ?? c.toWindowId)?.tool?.displayName || 'connected',
                ),
                h('button', {
                  className: 'fd-param-disconnect',
                  onclick: (e) => { e.stopPropagation(); this._engine.connections.delete(c.id); this.setState({}); },
                }, '×'),
              )),
            ) : null,
          ),
          h('button', {
            className: `fd-param-anchor${connectedTo.length ? ' fd-param-anchor-connected' : ''}`,
            title: 'Wire output',
            onclick: (e) => { e.stopPropagation(); this._startOutputConnection(win); },
          }, anchorIcon(normalizeType(field.type))),
        );
      }) : [];

      bodyCard = h('div', { className: 'fd-card fd-card-params' },
        h('div', { className: 'fd-params-col fd-params-inputs' },
          h('div', { className: 'fd-params-col-label' }, 'Inputs'),
          ...required.map(([k, f]) => renderParamRow(k, f)),
          optional.length ? h('button', {
            className: `fd-params-toggle${showOptional ? ' fd-params-toggle--active' : ''}`,
            onclick: (e) => { e.stopPropagation(); this.setState({ nodeModeShowOptional: !showOptional }); },
          }, showOptional ? '− fewer' : `+ ${optional.length} more`) : null,
          ...(showOptional ? optional.map(([k, f]) => renderParamRow(k, f)) : []),
        ),
        outRows.length ? h('div', { className: 'fd-params-col fd-params-outputs' },
          h('div', { className: 'fd-params-col-label' }, 'Outputs'),
          ...outRows,
        ) : null,
      );
    } else if (win.type === 'upload') {
      bodyCard = h('div', { className: 'fd-card' }, h(UploadWindowBody, { win, connections: windowConns }));
    } else {
      bodyCard = h('div', { className: 'fd-card' },
        h('div', { className: 'fd-card-label' }, win.spell?.name || win.outputType || win.type),
      );
    }

    // ── Card 3: Output result ─────────────────────────────────────────────────
    let outputCard = null;
    if (win.executing) {
      outputCard = h('div', { className: 'fd-card fd-card-output fd-card-output--running' },
        h('div', { className: 'fd-output-progress-bar' }),
        h('div', { className: 'fd-output-status' }, win.progress || 'Running…'),
      );
    } else if (win.error) {
      outputCard = h('div', { className: 'fd-card fd-card-output fd-card-output--error' },
        h('div', { className: 'fd-card-section' }, 'Error'),
        h('div', { className: 'fd-output-error' }, win.error),
      );
    } else if (win.output) {
      const out = win.output;
      let outBody;
      if (out.type === 'image' && out.url) {
        outBody = h('img', {
          className: 'fd-output-image fd-result-img--clickable',
          src: out.url,
          alt: 'Output',
          title: 'Tap to expand',
          onclick: (e) => { e.stopPropagation(); this.setState({ imageOverlay: { url: out.url, label: win.tool?.displayName || win.type } }); },
        });
      } else if (out.type === 'video' && out.url) {
        outBody = h('video', { className: 'fd-output-video', src: out.url, controls: true, playsinline: true });
      } else if (out.type === 'text' && out.text) {
        outBody = h('div', { className: 'fd-output-text' }, out.text);
      } else if (out.type === 'file' && out.files?.length) {
        outBody = h('div', { className: 'fd-output-files' },
          ...out.files.map(f => h('a', { className: 'fd-output-file-link', href: f.url, target: '_blank', rel: 'noopener' }, f.filename || f.url)),
        );
      } else {
        outBody = h('div', { className: 'fd-output-status' }, out.type);
      }
      outputCard = h('div', { className: 'fd-card fd-card-output' },
        h('div', { className: 'fd-card-section' }, 'Output'),
        outBody,
      );
    }

    // ── Card 4: Actions ───────────────────────────────────────────────────────
    const canExecute = win.type === 'tool' || win.type === 'spell';
    const actionsCard = h('div', { className: 'fd-card' },
      h('div', { className: 'fd-card-section' }, 'Actions'),
      h('div', { className: 'fd-card-actions' },
        canExecute ? h('button', {
          className: `fd-card-btn fd-card-btn-execute${win.executing ? ' fd-card-btn--loading' : ''}`,
          disabled: !!win.executing,
          onclick: (e) => { e.stopPropagation(); this._executeWindow(windowId); },
        }, win.executing ? (win.progress || 'Running…') : 'Execute') : null,
        h('button', {
          className: 'fd-card-btn',
          onclick: (e) => {
            e.stopPropagation();
            if (isPinned) this._engine.unpinWindow(windowId);
            else this._engine.pinWindow(windowId);
            this.setState({});
          },
        }, isPinned ? 'Unpin' : 'Pin'),
        h('button', {
          className: 'fd-card-btn',
          onclick: (e) => {
            e.stopPropagation();
            this._engine.zoomOut();
            const pos = { x: (win.x || 0) + 60, y: (win.y || 0) + 60 };
            if (win.type === 'tool') this._engine.addToolWindow(win.tool, pos);
            else if (win.type === 'spell') this._engine.addSpellWindow(win.spell, pos);
            else if (win.type === 'upload') this._engine.addUploadWindow(null, pos);
          },
        }, 'Clone'),
        h('button', {
          className: 'fd-card-btn fd-card-btn-danger',
          onclick: (e) => {
            e.stopPropagation();
            this._engine.zoomOut();
            setTimeout(() => this._engine.removeWindow(windowId), 80);
          },
        }, 'Delete'),
      ),
    );

    return h('div', {
      className: 'fd-nodemode fd-slide-up',
      onmousedown: (e) => e.stopPropagation(),
      ontouchstart: (e) => {
        e.stopPropagation();
        this._nmSwipe = { y: e.touches[0].clientY, x: e.touches[0].clientX, t: performance.now() };
      },
      ontouchmove: (e) => {
        // allow native scroll inside panel; just track position
      },
      ontouchend: (e) => {
        if (!this._nmSwipe) return;
        const dy = e.changedTouches[0].clientY - this._nmSwipe.y;
        const dx = e.changedTouches[0].clientX - this._nmSwipe.x;
        this._nmSwipe = null;
        if (dy > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
          this._engine.zoomOut(); // NODE_MODE → Z1
        }
      },
    },
      h('button', {
        className: 'fd-nodemode-back',
        onclick: (e) => { e.stopPropagation(); this._engine.zoomOut(); },
      }, '← Back to Canvas'),
      h('div', { className: 'fd-nodemode-cards' },
        identityCard,
        bodyCard,
        outputCard,
        actionsCard,
      ),
    );
  }

  // ─── Canvas paste menu ───────────────────────────────────────────────────

  _renderCanvasMenu({ x, y }) {
    const count = this._clipboard?.length || 0;
    const hasOrigin = !!this.state.originPos;
    return h('div', {
      className: 'sc2-canvas-menu',
      style: { position: 'fixed', left: `${x}px`, top: `${y}px`, zIndex: 700 },
      ontouchstart: (e) => e.stopPropagation(),
    },
      count ? h('button', {
        className: 'sc2-action-btn',
        onclick: () => { this._batchPaste({ x, y }); this.setState({ canvasMenu: null }); },
      }, `Paste (${count})`) : null,
      h('button', {
        className: 'sc2-action-btn',
        title: 'Swipe down from Z2 returns here',
        onclick: () => {
          // Save current viewport center as origin (not the touch point — center of what you see)
          const cx = window.innerWidth / 2;
          const cy = window.innerHeight / 2;
          const pos = this._engine.screenToWorkspace(cx, cy, this._panX, this._panY, this._scale);
          this.setState({ canvasMenu: null, originPos: pos });
        },
      }, hasOrigin ? 'Move Origin' : 'Set Origin'),
      h('button', {
        className: 'sc2-action-btn',
        onclick: () => this.setState({ canvasMenu: null }),
      }, 'Cancel'),
    );
  }

  // ─── Multi-select action bar ─────────────────────────────────────────────

  _renderActionBar(selectedIds) {
    const count = selectedIds?.size || 0;
    return h('div', { className: 'sc2-action-bar', ontouchstart: (e) => e.stopPropagation() },
      h('button', { className: 'sc2-action-btn', onclick: () => this._batchClone() }, `Clone (${count})`),
      h('button', { className: 'sc2-action-btn', onclick: () => this._batchCopy() }, 'Copy'),
      h('button', { className: 'sc2-action-btn', onclick: () => this._batchCut() }, 'Cut'),
      h('button', { className: 'sc2-action-btn sc2-action-btn--danger', onclick: () => this._batchDelete() }, `Delete (${count})`),
      h('button', { className: 'sc2-action-btn', onclick: () => { this._engine.fsm.exitMultiSelect(); this.setState({ multiSelectIds: new Set() }); } }, 'Cancel'),
    );
  }

  _batchDelete() {
    for (const id of (this._engine.fsm.selectedNodeIds || [])) {
      this._engine.removeWindow(id);
    }
    this._engine.fsm.exitMultiSelect();
    this.setState({ multiSelectIds: new Set() });
  }

  _batchCopy() {
    this._clipboard = [...(this._engine.fsm.selectedNodeIds || [])].map(id => ({ ...this._engine.windows.get(id) })).filter(Boolean);
    this._engine.fsm.exitMultiSelect();
    this.setState({ multiSelectIds: new Set() });
  }

  _batchCut() {
    this._batchCopy();
    for (const w of this._clipboard) this._engine.removeWindow(w.id);
  }

  _batchClone() {
    const offset = { x: 60, y: 60 };
    for (const id of (this._engine.fsm.selectedNodeIds || [])) {
      const win = this._engine.windows.get(id);
      if (!win) continue;
      const pos = { x: win.x + offset.x, y: win.y + offset.y };
      if (win.type === 'tool') this._engine.addToolWindow(win.tool, pos);
      else if (win.type === 'spell') this._engine.addSpellWindow(win.spell, pos);
      else if (win.type === 'upload') this._engine.addUploadWindow(win.url, pos);
      else if (win.type === 'primitive') this._engine.addPrimitiveWindow(win.outputType, pos);
    }
    this._engine.fsm.exitMultiSelect();
    this.setState({ multiSelectIds: new Set() });
  }

  _batchPaste(screenPos) {
    if (!this._clipboard?.length) return;
    const canvasPos = screenPos
      ? this._engine.screenToWorkspace(screenPos.x, screenPos.y, this._panX, this._panY, this._scale)
      : this._defaultPos();
    // Find centroid of clipboard
    const cx = this._clipboard.reduce((s, w) => s + (w.x || 0), 0) / this._clipboard.length;
    const cy = this._clipboard.reduce((s, w) => s + (w.y || 0), 0) / this._clipboard.length;
    for (const win of this._clipboard) {
      const pos = { x: canvasPos.x + (win.x || 0) - cx, y: canvasPos.y + (win.y || 0) - cy };
      if (win.type === 'tool') this._engine.addToolWindow(win.tool, pos);
      else if (win.type === 'spell') this._engine.addSpellWindow(win.spell, pos);
      else if (win.type === 'upload') this._engine.addUploadWindow(win.url, pos);
      else if (win.type === 'primitive') this._engine.addPrimitiveWindow(win.outputType, pos);
    }
  }

  // ─── Touch gestures ───────────────────────────────────────────────────────

  _onTouchStart(e) {
    if (this.state.imageOverlay) return;
    if (this._momentum.running) {
      this._momentum.running = false;
      this._momentum.vx = 0;
      this._momentum.vy = 0;
      this._velBuffer = [];
      e.preventDefault();
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      this._gestureStart = { x: t.clientX, y: t.clientY, time: performance.now(), target: e.target };
      this._panAtGestureStart = { x: this._panX, y: this._panY };

      if (this.state.fsmState === 'NODE_MODE') return;

      e.preventDefault();
      this._panStart = { x: t.clientX - this._panX, y: t.clientY - this._panY };

      // Long-press for multi-select
      if (this.state.fsmState === 'CANVAS_Z1' || this.state.fsmState === 'CANVAS_Z2') {
        const target = e.target;
        this._longPressTimeout = setTimeout(() => {
          this._longPressTimeout = null;
          const nodeEl = target.closest && target.closest('.sc2-node');
          const nodeId = nodeEl && nodeEl.dataset.windowId;
          if (nodeId) {
            this._engine.fsm.enterMultiSelect(nodeId);
            this.setState({ fsmState: 'MULTI_SELECT', multiSelectIds: new Set(this._engine.fsm.selectedNodeIds) });
            this._gestureStart = null;
          } else {
            this.setState({ canvasMenu: { x: t.clientX, y: t.clientY } });
            this._gestureStart = null;
          }
        }, 500);
      }
    } else if (e.touches.length === 2) {
      e.preventDefault();
      if (this.state.fsmState === 'NODE_MODE') return;
      const [a, b] = [e.touches[0], e.touches[1]];
      this._pinchStart = {
        dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
        scale: this._scale,
        midX: (a.clientX + b.clientX) / 2,
        midY: (a.clientY + b.clientY) / 2,
        panX: this._panX,
        panY: this._panY,
      };
      this._panStart = null;
    }
  }

  _onTouchMove(e) {
    if (this.state.imageOverlay) return;
    // Cancel long-press if finger moved
    if (this._longPressTimeout && this._gestureStart) {
      const t = e.touches[0];
      const dist = Math.hypot(t.clientX - this._gestureStart.x, t.clientY - this._gestureStart.y);
      if (dist > 10) {
        clearTimeout(this._longPressTimeout);
        this._longPressTimeout = null;
      }
    }

    if (this.state.fsmState === 'NODE_MODE') return;

    if (e.touches.length === 1 && this._panStart) {
      e.preventDefault();
      const t = e.touches[0];
      const now = performance.now();
      const newPanX = t.clientX - this._panStart.x;
      const newPanY = t.clientY - this._panStart.y;
      const dx = newPanX - this._panX;
      const dy = newPanY - this._panY;
      const dt = now - (this._lastMoveTime || now);
      this._lastMoveTime = now;
      this._panX = newPanX;
      this._panY = newPanY;

      if (dt > 0) {
        this._velBuffer.push({ dx, dy, dt, t: now });
        const cutoff = now - 100;
        while (this._velBuffer.length > 1 && this._velBuffer[0].t < cutoff) {
          this._velBuffer.shift();
        }
      }

      // Track canvas pointer position for pending connection
      if (this._gestureStart) {
        this._pointerCanvasPos = this._engine.screenToWorkspace(t.clientX, t.clientY, this._panX, this._panY, this._scale);
      }

      this.setState({});
    } else if (e.touches.length === 2 && this._pinchStart) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const ratio = dist / this._pinchStart.dist;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this._pinchStart.scale * ratio));
      const scaleRatio = newScale / this._pinchStart.scale;
      const pinchPanX = this._pinchStart.midX - (this._pinchStart.midX - this._pinchStart.panX) * scaleRatio;
      const pinchPanY = this._pinchStart.midY - (this._pinchStart.midY - this._pinchStart.panY) * scaleRatio;
      this._panX = pinchPanX;
      this._panY = pinchPanY;
      this._scale = newScale;
      this.setState({});
    }
  }

  _onTouchEnd(e) {
    if (this.state.imageOverlay) {
      // Close on tap outside the image wrap, or on the close button
      const target = e.changedTouches[0] && document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      if (!target?.closest?.('.fd-image-overlay-wrap') || target?.closest?.('.fd-image-overlay-close')) {
        this.setState({ imageOverlay: null });
      }
      return;
    }
    if (this._longPressTimeout) {
      clearTimeout(this._longPressTimeout);
      this._longPressTimeout = null;
    }
    this._panStart = null;
    this._pinchStart = null;
    this._lastMoveTime = null;
    this._startMomentum();

    if (!this._gestureStart) return;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - this._gestureStart.x;
    const dy = touch.clientY - this._gestureStart.y;
    const dist = Math.hypot(dx, dy);
    const elapsed = performance.now() - this._gestureStart.time;
    const absDy = Math.abs(dy);
    const absDx = Math.abs(dx);

    // Swipe down to zoom out / return to origin
    if (absDy > 60 && absDy > absDx * 1.5 && dy > 0) {
      this._gestureStart = null;
      // Cancel momentum and restore pan — swipe is a nav gesture, not a pan
      this._momentum.running = false;
      this._momentum.vx = 0;
      this._momentum.vy = 0;
      if (this._panAtGestureStart) {
        this._panX = this._panAtGestureStart.x;
        this._panY = this._panAtGestureStart.y;
      }
      if (this._engine.fsm.isConnecting) {
        this._engine.fsm.clearConnection();
      } else if (this.state.fsmState === 'CANVAS_Z2') {
        // Pan to saved origin, or workspace (0,0) if none set
        const origin = this.state.originPos;
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        this._scale = SCALE_Z2;
        this._panX = origin ? cx - origin.x * SCALE_Z2 : cx;
        this._panY = origin ? cy - origin.y * SCALE_Z2 : cy;
        this._animateViewport();
        this.setState({});
      } else {
        this._engine.zoomOut();
      }
      return;
    }

    if (this.state.fsmState === 'NODE_MODE') {
      this._gestureStart = null;
      return;
    }

    // Tap detection: < 8px, < 300ms
    if (dist < 8 && elapsed < 300) {
      const target = this._gestureStart.target;
      // Don't treat anchor taps as node taps — anchor onclick handles them
      if (target.closest && target.closest('.sc2-anchor')) {
        this._gestureStart = null;
        return;
      }

      // Thumbnail tap: Z1 → lightbox, Z2 → zoom to Z1
      if (target.closest && target.closest('.sc2-node-thumb--clickable')) {
        const thumbEl = target.closest('.sc2-node');
        const thumbNodeId = thumbEl?.dataset?.windowId;
        this._gestureStart = null;
        if (thumbNodeId) {
          if (this.state.fsmState === 'CANVAS_Z1') {
            const w = this._engine.windows.get(thumbNodeId);
            const url = w?.output?.type === 'image' ? w.output.url : null;
            if (url) this.setState({ imageOverlay: { url, label: w.tool?.displayName || w.type } });
          } else {
            this._onTapNode(thumbNodeId);
          }
        }
        return;
      }
      const nodeEl = target.closest && target.closest('.sc2-node');
      const nodeId = nodeEl && nodeEl.dataset.windowId;
      const now = performance.now();

      // Double-tap detection
      if (nodeId && this._lastTap && (now - this._lastTap.time < 300) && this._lastTap.nodeId === nodeId) {
        this._lastTap = null;
        this._gestureStart = null;
        this._onDoubleTapNode(nodeId);
        return;
      }

      if (nodeId) {
        this._lastTap = { time: now, nodeId };
        this._gestureStart = null;
        this._onTapNode(nodeId);
        return;
      }

      // Tap on empty canvas
      if (this._engine.fsm.isConnecting) {
        this._engine.fsm.clearConnection();
      } else if (this.state.fsmState === 'CANVAS_Z1') {
        this._engine.zoomOut();
      }
      // Z2 empty tap does nothing — ActionModal only opens via + FAB
    }

    this._gestureStart = null;
  }

  _startMomentum() {
    if (this._velBuffer.length === 0) return;
    let totalDt = 0, sumDx = 0, sumDy = 0;
    for (const { dx, dy, dt } of this._velBuffer) {
      totalDt += dt;
      sumDx += dx;
      sumDy += dy;
    }
    this._velBuffer = [];
    const vx = totalDt > 0 ? sumDx / totalDt : 0;
    const vy = totalDt > 0 ? sumDy / totalDt : 0;
    if (Math.hypot(vx, vy) < MIN_VELOCITY) return;
    this._momentum.vx = vx;
    this._momentum.vy = vy;
    this._momentum.lastTs = performance.now();
    this._momentum.running = true;
  }

  // ─── Mouse handlers ───────────────────────────────────────────────────────

  _onMouseDown(e) {
    if (e.button !== 0) return;
    if (this.state.fsmState === 'NODE_MODE') return;

    const startX = e.clientX;
    const startY = e.clientY;

    const target = e.target.closest('.sc2-node');
    if (target) {
      const id = target.dataset.windowId;
      if (!id) return;

      // Long-press for multi-select
      this._longPressTimeout = setTimeout(() => {
        this._longPressTimeout = null;
        this._engine.fsm.enterMultiSelect(id);
        this.setState({ fsmState: 'MULTI_SELECT', multiSelectIds: new Set(this._engine.fsm.selectedNodeIds) });
      }, 500);

      // Node drag
      this._isDraggingNode = id;
      this._engine.pinWindow(id);
      const win = this._engine.windows.get(id);
      this._mouseDragStart = { x: e.clientX, y: e.clientY, nodeX: win.x, nodeY: win.y };

      const onMove = (ev) => {
        if (this._longPressTimeout) {
          const d = Math.hypot(ev.clientX - startX, ev.clientY - startY);
          if (d > 10) {
            clearTimeout(this._longPressTimeout);
            this._longPressTimeout = null;
          }
        }
        if (this._isDraggingNode && this._mouseDragStart) {
          const dx = (ev.clientX - this._mouseDragStart.x) / this._scale;
          const dy = (ev.clientY - this._mouseDragStart.y) / this._scale;
          const newX = this._mouseDragStart.nodeX + dx;
          const newY = this._mouseDragStart.nodeY + dy;
          this._engine.pinWindow(this._isDraggingNode, { x: newX, y: newY });
          this._engine.updateWindow(this._isDraggingNode, { x: newX, y: newY });
        }
      };
      const onUp = () => {
        if (this._longPressTimeout) {
          clearTimeout(this._longPressTimeout);
          this._longPressTimeout = null;
        }
        this._isDraggingNode = null;
        this._mouseDragStart = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    } else {
      // Close canvas menu if clicking outside it
      if (this.state.canvasMenu) {
        this.setState({ canvasMenu: null });
      }

      // Canvas long-press for paste menu
      const longPressX = e.clientX, longPressY = e.clientY;
      this._longPressTimeout = setTimeout(() => {
        this._longPressTimeout = null;
        this.setState({ canvasMenu: { x: longPressX, y: longPressY } });
      }, 500);

      // Canvas pan
      this._panStart = { x: e.clientX - this._panX, y: e.clientY - this._panY };

      const onMove = (ev) => {
        if (this._longPressTimeout) {
          const d = Math.hypot(ev.clientX - longPressX, ev.clientY - longPressY);
          if (d > 10) {
            clearTimeout(this._longPressTimeout);
            this._longPressTimeout = null;
          }
        }
        if (this._panStart) {
          this._panX = ev.clientX - this._panStart.x;
          this._panY = ev.clientY - this._panStart.y;
          if (this._engine.fsm.isConnecting) {
            this._pointerCanvasPos = this._engine.screenToWorkspace(ev.clientX, ev.clientY, this._panX, this._panY, this._scale);
          }
          this.setState({});
        }
      };
      const onUp = () => {
        if (this._longPressTimeout) {
          clearTimeout(this._longPressTimeout);
          this._longPressTimeout = null;
        }
        this._panStart = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.95 : 1.05;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this._scale * delta));
    const rect = this._rootEl.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    this._panX = cx - (cx - this._panX) * (newScale / this._scale);
    this._panY = cy - (cy - this._panY) * (newScale / this._scale);
    this._scale = newScale;
    this.setState({});
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      if (this._engine.fsm.isConnecting) {
        this._engine.fsm.clearConnection();
      } else {
        this._engine.zoomOut();
      }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === document.body) {
      const focused = this._engine.focusedWindowId;
      if (focused && this._engine.fsmState === 'NODE_MODE') {
        this._engine.removeWindow(focused);
        this._engine.zoomOut();
      }
    }
  }

  // ─── Execution ────────────────────────────────────────────────────────────

  _initWs() {
    if (this._wsInitPromise) return this._wsInitPromise;
    this._wsInitPromise = Promise.all([
      import('../ws.js'),
      import('../node/websocketHandlers.js'),
    ]).then(([wsModule, wsHandlers]) => {
      wsModule.websocketClient?.connect?.();
      wsHandlers.registerWebSocketHandlers?.();
      this._wsHandlers = wsHandlers;
      this._wsClient = wsModule.websocketClient;
    }).catch(e => {
      this._wsInitPromise = null;
      console.warn('[SandboxCanvas2] WS init failed:', e);
    });
    return this._wsInitPromise;
  }

  async _executeWindow(windowId) {
    const win = this._engine.windows.get(windowId);
    if (!win || win.executing) return;

    this._engine.updateWindow(windowId, { executing: true, error: null, progress: 'Starting...' });

    try {
      const inputs = {};
      const mappings = win.parameterMappings || {};
      const schema = win.tool?.inputSchema || win.tool?.metadata?.inputSchema || {};

      for (const [key, param] of Object.entries(schema)) {
        const mapping = mappings[key];
        if (mapping?.type === 'nodeOutput') {
          const sourceWin = this._engine.windows.get(mapping.nodeId);
          if (mapping.outputKey === 'batch') {
            throw new Error(`This input is wired to a batch feed. Use "Run as Batch" on the upload node.`);
          }
          const slotOutput = sourceWin?.outputs?.find?.(o => o.key === mapping.outputKey);
          const effectiveOutput = slotOutput || sourceWin?.output;
          if (effectiveOutput) {
            let resolved;
            if (effectiveOutput.type === 'image') resolved = effectiveOutput.url;
            else if (effectiveOutput.type === 'text') {
              resolved = effectiveOutput.text
                ?? (Array.isArray(effectiveOutput.data?.text)
                  ? effectiveOutput.data.text[0]
                  : effectiveOutput.data?.text);
            } else {
              resolved = effectiveOutput.value !== undefined ? effectiveOutput.value : effectiveOutput;
            }
            if ((resolved === '' || resolved === null || resolved === undefined) && param.required) {
              throw new Error(`'${param.name || key}' is connected but the source node has no value — enter text first`);
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

      // Randomize seeds
      for (const [key, mapping] of Object.entries(mappings)) {
        if (mapping?.type === 'static' && /seed/i.test(key)) {
          const seed = Math.floor(Math.random() * 1e9);
          mapping.value = seed;
          inputs[key] = seed;
        }
      }

      this._engine.updateWindow(windowId, { progress: 'Executing...' });

      const result = await executionClient.execute({
        toolId: win.tool.toolId,
        inputs,
        metadata: { platform: 'web-sandbox' },
      });

      if (result.final && result.status !== 'failed') {
        const output = this._normalizeOutput(result);
        const versions = [...(win.outputVersions || []), output];
        this._engine.updateWindow(windowId, {
          output, executing: false, progress: null, outputLoaded: true,
          outputVersions: versions, currentVersionIndex: versions.length - 1,
        });
        if (result.costUsd) this._recordCost(windowId, result.costUsd);
      } else if (result.status === 'failed') {
        this._engine.updateWindow(windowId, {
          executing: false, error: result.outputs?.error || 'Execution failed.',
        });
      } else if (result.generationId || result.castId) {
        if (win.type === 'spell') {
          const spellTrackingId = result.castId || result.generationId;
          const stepCount = win.spell?.steps?.length || 1;
          this._engine.updateWindow(windowId, { progress: 'Casting...', generationId: spellTrackingId });
          this._awaitSpellCompletion(windowId, spellTrackingId, stepCount);
        } else {
          this._engine.updateWindow(windowId, { progress: 'Waiting for result...', generationId: result.generationId });
          this._awaitCompletion(windowId, result.generationId);
        }
      }
    } catch (err) {
      this._engine.updateWindow(windowId, { executing: false, error: err.message, progress: null });
    }
  }

  async _awaitCompletion(windowId, generationId) {
    let _stopProgressListener = null;
    try {
      if (!this._wsHandlers) await this._initWs();

      if (!this._wsHandlers?.generationCompletionManager) {
        const result = await this._pollGenerationStatus(generationId);
        if (result?.status === 'failed') throw new Error(result.outputs?.error || 'Generation failed.');
        const output = this._normalizeOutput({ ...result, generationId });
        const win = this._engine.windows.get(windowId);
        if (!win) return;
        const versions = [...(win.outputVersions || []), output];
        this._engine.updateWindow(windowId, { output, executing: false, progress: null, outputLoaded: true, outputVersions: versions, currentVersionIndex: versions.length - 1 });
        return;
      }

      if (this._wsClient) {
        const handleProgress = (payload) => {
          if (payload?.generationId !== generationId) return;
          const parts = [];
          if (payload.liveStatus) parts.push(payload.liveStatus);
          else parts.push(payload.status === 'queued' ? 'Queued…' : 'Running…');
          if (typeof payload.progress === 'number') parts.push(`${Math.round(payload.progress * 100)}%`);
          this._engine.updateWindow(windowId, { progress: parts.join(' ') });
        };
        this._wsClient.on('generationProgress', handleProgress);
        _stopProgressListener = () => this._wsClient.off('generationProgress', handleProgress);
      }

      const wsConnected = this._wsClient?.isConnected?.() ?? false;
      const wsPromise = this._wsHandlers.generationCompletionManager.createCompletionPromise(generationId);
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
      } else if (Array.isArray(outputs.files) && outputs.files.length) {
        const vidFile = outputs.files.find(f => /\.(mp4|webm|mov)$/i.test(f.url || f.filename || ''));
        if (vidFile) {
          output = { type: 'video', url: vidFile.url, generationId };
        } else {
          output = { type: 'file', files: outputs.files, generationId };
        }
      } else if (outputs.videoUrl || outputs.video) {
        output = { type: 'video', url: outputs.videoUrl || outputs.video, generationId };
      } else {
        output = { type: 'unknown', generationId, ...outputs };
      }

      const win = this._engine.windows.get(windowId);
      if (!win) return;
      const versions = [...(win.outputVersions || []), output];
      this._engine.updateWindow(windowId, {
        output, executing: false, progress: null, outputLoaded: true,
        outputVersions: versions, currentVersionIndex: versions.length - 1,
      });
      if (result.costUsd) this._recordCost(windowId, result.costUsd);
    } catch (err) {
      _stopProgressListener?.();
      this._engine.updateWindow(windowId, { executing: false, error: err.message, progress: null });
    }
  }

  async _awaitSpellCompletion(windowId, castId, stepCount) {
    let _stopProgressListener = null;
    try {
      if (!this._wsHandlers) await this._initWs();
      if (!this._wsHandlers?.castCompletionTracker) throw new Error('WebSocket connection unavailable. Please refresh the page and try again.');

      if (this._wsClient) {
        const handleStepProgress = (payload) => {
          if (payload?.castId !== castId) return;
          const parts = [];
          if (payload.liveStatus) parts.push(payload.liveStatus);
          else parts.push(payload.status === 'queued' ? 'Queued…' : 'Running…');
          if (typeof payload.progress === 'number') parts.push(`${Math.round(payload.progress * 100)}%`);
          this._engine.updateWindow(windowId, { progress: parts.join(' ') });
        };
        this._wsClient.on('generationProgress', handleStepProgress);
        _stopProgressListener = () => this._wsClient.off('generationProgress', handleStepProgress);
      }

      const result = await this._wsHandlers.castCompletionTracker.register(
        castId, stepCount,
        ({ completed, total }) => {
          const pct = Math.round((completed / total) * 100);
          this._engine.updateWindow(windowId, { progress: `${pct}%` });
        }
      );

      if (result?.status === 'failed') throw new Error(result.outputs?.error || 'Spell execution failed.');

      _stopProgressListener?.();
      _stopProgressListener = null;

      const output = this._normalizeOutput({ ...(result || {}), generationId: castId });
      const win = this._engine.windows.get(windowId);
      if (!win) return;
      const versions = [...(win.outputVersions || []), output];
      this._engine.updateWindow(windowId, {
        output, executing: false, progress: null, outputLoaded: true,
        outputVersions: versions, currentVersionIndex: versions.length - 1,
      });
      if (result?.costUsd) this._recordCost(windowId, result.costUsd);
    } catch (err) {
      _stopProgressListener?.();
      this._engine.updateWindow(windowId, { executing: false, error: err.message, progress: null });
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
    if (outputs.type === 'text' && outputs.data?.text) {
      const txt = Array.isArray(outputs.data.text) ? outputs.data.text[0] : outputs.data.text;
      if (txt) return { type: 'text', text: txt, generationId: gid };
    }
    if (outputs.type === 'image' && Array.isArray(outputs.data?.images) && outputs.data.images[0]?.url)
      return { type: 'image', url: outputs.data.images[0].url, generationId: gid };
    if (Array.isArray(outputs)) {
      for (const item of outputs) {
        if (item.type === 'image' && Array.isArray(item.data?.images) && item.data.images[0]?.url)
          return { type: 'image', url: item.data.images[0].url, generationId: gid };
        if (item.type === 'text' && item.data?.text) {
          const txt = Array.isArray(item.data.text) ? item.data.text[0] : item.data.text;
          if (txt) return { type: 'text', text: txt, generationId: gid };
        }
      }
    }
    if (typeof outputs === 'object' && !Array.isArray(outputs)) {
      for (const node of Object.values(outputs)) {
        if (node && typeof node === 'object' && node.data) {
          if (Array.isArray(node.data.images) && node.data.images[0]?.url)
            return { type: 'image', url: node.data.images[0].url, generationId: gid };
        }
      }
    }
    return { type: 'unknown', generationId: gid, ...outputs };
  }

  async _pollGenerationStatus(generationId) {
    const POLL_INTERVAL = 5000;
    const MAX_WAIT = 360000;
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
          const outputs = {};
          if (data.result?.images?.length) outputs.images = data.result.images.map(url => ({ url }));
          else if (data.result?.image) outputs.images = [{ url: data.result.image }];
          if (data.result?.video) outputs.videoUrl = data.result.video;
          if (data.result?.videos?.length) outputs.videoUrl = data.result.videos[0];
          if (data.error) outputs.error = data.error;
          return { status: data.status, outputs };
        }
      } catch { /* transient — keep polling */ }
    }
    throw new Error('Generation timed out');
  }

  _recordCost(windowId, usd) {
    if (!usd || usd <= 0) return;
    const win = this._engine.windows.get(windowId);
    if (!win) return;
    const newTotal = (win.totalCostUsd || 0) + usd;
    const costVersions = [...(win.costVersions || []), { usd, timestamp: Date.now() }];
    this._engine.updateWindow(windowId, { totalCostUsd: newTotal, costVersions });

    window.dispatchEvent(new CustomEvent('costUpdate', {
      detail: {
        windowId,
        costData: { usd, points: 0, ms2: 0, cult: 0 },
        totalCost: { usd: newTotal, points: 0, ms2: 0, cult: 0 },
      },
    }));

    let workspaceUsd = newTotal;
    for (const [id, w] of this._engine.windows) {
      if (id !== windowId) workspaceUsd += w.totalCostUsd || 0;
    }
    emitCosts({ usd: workspaceUsd, points: 0, ms2: 0, cult: 0 });
  }
}
