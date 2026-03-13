import { Component, h, eventBus } from '@monygroupcorp/microact';
import { CanvasEngine } from './CanvasEngine.js';
import { ToolWindowBody, UploadWindowBody } from '../canvas/ToolWindowBody.js';
import * as executionClient from '../executionClient.js';
import { emitCosts } from '../store.js';
import { INSTRUCTION_PRESETS } from '../instructionPresets.js';
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
      nodeModeOutputExpanded: false,
      descriptionExpanded: false,
      originPos: null, // workspace coords { x, y } for Z2 home swipe
      imageOverlay: null, // { url, label } for lightbox
      textOverlay: null, // { text, label } for text overlay
      textOverlayCopied: false,
      textInputOverlay: null, // { windowId, key, field, currentVal, label } for editing text params
      textInputOverlayCopied: false,
      instructionPickerOverlay: null, // { windowId, key, label, selectedId, editedText }
      modelPickerOverlay: null, // { windowId, key, currentVal, label, models, loading, error, search }
      pendingInputTarget: null,  // { windowId, key, type, label } — seeking source for an input
      pendingOutputSource: null, // { sourceNodeId, sourcePort, sourceType } — committed when FAB tapped mid-connection
    };
  }

  // ─── Public API (preserves window.sandboxCanvas interface) ───────────────

  addToolWindow(tool, position) {
    const id = this._engine.addToolWindow(tool, position || this._defaultPos());
    this._autoConnectNew(id);
    this._enterNodeMode(id);
    return id;
  }

  addSpellWindow(spell, position) {
    const id = this._engine.addSpellWindow(spell, position || this._defaultPos());
    this._autoConnectNew(id);
    this._enterNodeMode(id);
    return id;
  }

  addUploadWindow(url, position) {
    const id = this._engine.addUploadWindow(url, position || this._defaultPos());
    this._autoConnectNew(id);
    this._enterNodeMode(id);
    return id;
  }

  addPrimitiveWindow(outputType, position) {
    const id = this._engine.addPrimitiveWindow(outputType, position || this._defaultPos());
    this._autoConnectNew(id);
    this._enterNodeMode(id);
    return id;
  }

  addExpressionWindow(position) {
    const id = this._engine.addExpressionWindow(position || this._defaultPos());
    this._autoConnectNew(id);
    this._enterNodeMode(id);
    return id;
  }

  addEffectWindow(tool, position) {
    // In connection mode the image is already coming from an existing node —
    // skip the upload window and treat this as a plain tool window.
    if (this._engine.fsm.isConnecting || this.state.pendingInputTarget || this.state.pendingOutputSource) {
      return { toolId: this.addToolWindow(tool, position) };
    }
    const { uploadId, toolId } = this._engine.addEffectWindow(tool, position || this._defaultPos());
    this._enterNodeMode(toolId);
    return { uploadId, toolId };
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

  // ─── Workspace snapshot API (used by workspaces.js + WorkspaceTabs) ──────

  _sanitiseOutput(o) {
    if (!o) return null;
    let url = (o.url && !o.url.startsWith('data:')) ? o.url : undefined;
    if (!url && o.data?.images?.[0]?.url && !o.data.images[0].url.startsWith('data:')) url = o.data.images[0].url;
    if (!url) return null;
    return { type: o.type || 'image', url, generationId: o.generationId };
  }

  getSnapshot() {
    const toolWindows = [...this._engine.windows.values()].map(w => {
      const base = {
        id: w.id,
        workspaceX: w.x,
        workspaceY: w.y,
        output: this._sanitiseOutput(w.output),
        ...(w.outputs?.length > 0 ? { outputs: w.outputs.filter(o => o?.url && !o.url.startsWith('data:')) } : {}),
        outputVersions: (w.outputVersions || []).slice(-5).map(v => this._sanitiseOutput(v)),
        currentVersionIndex: w.currentVersionIndex ?? -1,
        parameterMappings: w.parameterMappings || {},
        tool: w.tool || null,
        ...(w.totalCostUsd ? { totalCostUsd: w.totalCostUsd } : {}),
        ...(w.costVersions?.length ? { costVersions: w.costVersions } : {}),
      };
      if (w.type === 'spell') {
        return { ...base, isSpell: true, spell: {
          _id: w.spell?._id, name: w.spell?.name, slug: w.spell?.slug,
          exposedInputs: w.spell?.exposedInputs || [],
          steps: (w.spell?.steps || []).map(s => ({ displayName: s.displayName || s.service || s.toolId, service: s.service })),
        }};
      }
      if (w.type === 'collection') return { ...base, type: 'collection', mode: w.mode, collection: { collectionId: w.collection?.collectionId, name: w.collection?.name } };
      if (w.type === 'upload') return { ...base, type: 'upload', displayName: 'Upload', toolId: 'upload' };
      if (w.type === 'primitive') return { ...base, type: 'primitive', outputType: w.outputType, value: w.value || '', displayName: w.outputType || 'Primitive', toolId: `primitive:${w.outputType || 'unknown'}` };
      return { ...base, type: w.type || 'tool', displayName: w.tool?.displayName || '', toolId: w.tool?.toolId || '' };
    });
    return { toolWindows, connections: [...this._engine.connections.values()] };
  }

  loadFromSnapshot(snapshot) {
    // Cost fallback from localStorage for windows missing cost in server snapshot
    const localCostMap = {};
    try {
      const raw = localStorage.getItem('sandbox_canvas_state');
      if (raw) {
        const localData = JSON.parse(raw);
        (localData.windows || []).forEach(lw => {
          if (lw.id && lw.totalCostUsd > 0) localCostMap[lw.id] = { totalCostUsd: lw.totalCostUsd, costVersions: lw.costVersions || [] };
        });
      }
    } catch {}

    // Clear engine — remove each window through engine so physics nodes are cleaned up too
    for (const id of [...this._engine.windows.keys()]) this._engine.removeWindow(id);
    this._engine.connections.clear();

    (snapshot.toolWindows || []).forEach(w => {
      const localCost = localCostMap[w.id];
      const win = {
        id: w.id, x: w.workspaceX, y: w.workspaceY,
        output: w.output || null,
        ...(w.outputs?.length > 0 ? { outputs: w.outputs } : {}),
        outputVersions: w.outputVersions || [],
        currentVersionIndex: w.currentVersionIndex ?? -1,
        parameterMappings: w.parameterMappings || {},
        outputLoaded: !!(w.output || w.outputs?.length),
        executing: false, progress: null, error: null,
        totalCostUsd: w.totalCostUsd || localCost?.totalCostUsd || 0,
        costVersions: w.costVersions?.length ? w.costVersions : (localCost?.costVersions || []),
        tool: w.tool || { displayName: w.displayName || '', toolId: w.toolId || '' },
      };
      if (w.isSpell) {
        win.type = 'spell'; win.spell = w.spell;
        win.tool = win.tool || { displayName: w.spell?.name || 'Spell', toolId: `spell:${w.spell?._id}` };
        if (win.tool?.toolId?.startsWith('spell-')) win.tool = { ...win.tool, toolId: `spell:${win.tool.toolId.substring(6)}` };
      } else if (w.type === 'collection') {
        win.type = 'collection'; win.collection = w.collection; win.mode = w.mode;
      } else if (w.type === 'upload') {
        win.type = 'upload';
      } else if (w.type === 'primitive') {
        win.type = 'primitive'; win.outputType = w.outputType; win.value = w.value || '';
      } else {
        win.type = w.type || 'tool';
      }
      this._engine.windows.set(win.id, win);
      this._engine.physics.addNode(win.id, { x: win.x, y: win.y });
    });

    (snapshot.connections || []).forEach(c => this._engine.connections.set(c.id, c));

    // Reset FSM and viewport
    this._engine.fsm.state = 'CANVAS_Z2';
    this._engine.fsm.focusedNodeId = null;
    this._scale = SCALE_Z2;
    this._panX = window.innerWidth / 2;
    this._panY = window.innerHeight / 2;
    this.setState({ fsmState: 'CANVAS_Z2', focusedWindowId: null, windows: this._engine.windows, connections: this._engine.connections });
  }

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

    if ((to === 'CANVAS_Z1' || to === 'NODE_MODE') && nodeId) {
      this._loadToolDetail(nodeId);
    }

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
    const { fsmState, focusedWindowId, multiSelectIds, canvasMenu, pendingInputTarget, pendingOutputSource } = this.state;
    const transform = `translate(${this._panX}px, ${this._panY}px) scale(${this._scale})`;
    const isConnecting = this._engine.fsm.isConnecting;
    const connection = this._engine.fsm.connection;

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
      (isConnecting || pendingOutputSource || pendingInputTarget) ? (() => {
        let badgeText;
        const src = isConnecting ? connection : pendingOutputSource;
        if (src) {
          const srcWin = this._engine.windows.get(src.sourceNodeId);
          const srcName = srcWin?.tool?.displayName || srcWin?.spell?.name || srcWin?.outputType || 'node';
          const typeTag = src.sourceType ? ` · ${src.sourceType}` : '';
          badgeText = `${srcName}${typeTag} → tap an input`;
        } else {
          const tgtWin = this._engine.windows.get(pendingInputTarget.windowId);
          const tgtName = tgtWin?.tool?.displayName || tgtWin?.spell?.name || tgtWin?.type || 'node';
          const typeTag = pendingInputTarget.type ? ` · ${pendingInputTarget.type}` : '';
          badgeText = `← ${tgtName} / ${pendingInputTarget.label}${typeTag}`;
        }
        return h('div', { className: 'sc2-seeking-badge' },
          badgeText,
          h('button', {
            className: 'sc2-seeking-cancel',
            onclick: (e) => {
              e.stopPropagation();
              if (isConnecting) this._engine.fsm.clearConnection();
              this.setState({ pendingInputTarget: null, pendingOutputSource: null });
            },
          }, '×'),
        );
      })() : null,
      canvasMenu ? this._renderCanvasMenu(canvasMenu) : null,
      this.state.textOverlay ? h('div', {
        className: 'fd-text-overlay',
        onclick: () => this.setState({ textOverlay: null, textOverlayCopied: false }),
      },
        h('div', { className: 'fd-text-overlay-card', onclick: (e) => e.stopPropagation() },
          h('div', { className: 'fd-text-overlay-header' },
            h('span', { className: 'fd-card-section' }, this.state.textOverlay.label),
            h('button', {
              className: `fd-text-overlay-copy${this.state.textOverlayCopied ? ' fd-text-overlay-copy--done' : ''}`,
              onclick: (e) => {
                e.stopPropagation();
                navigator.clipboard?.writeText(this.state.textOverlay.text).catch(() => {});
                this.setState({ textOverlayCopied: true });
                setTimeout(() => this.setState({ textOverlayCopied: false }), 2000);
              },
            }, this.state.textOverlayCopied ? 'Copied ✓' : 'Copy'),
            h('button', {
              className: 'fd-text-overlay-close',
              onclick: () => this.setState({ textOverlay: null, textOverlayCopied: false }),
            }, '×'),
          ),
          h('pre', { className: 'fd-text-overlay-body' }, this.state.textOverlay.text),
        ),
      ) : null,
      this.state.textInputOverlay ? (() => {
        const closeInputOverlay = () => {
          const { windowId, key, currentVal, onSave } = this.state.textInputOverlay;
          if (onSave) onSave(currentVal);
          else this._onParamChange(windowId, key, currentVal);
          this._unlockViewportZoom();
          this.setState({ textInputOverlay: null, textInputOverlayCopied: false });
        };
        return h('div', {
          className: 'fd-text-overlay',
          onclick: closeInputOverlay,
        },
          h('div', { className: 'fd-text-overlay-card', onclick: (e) => e.stopPropagation() },
            h('div', { className: 'fd-text-overlay-header' },
              h('span', { className: 'fd-card-section' }, this.state.textInputOverlay.label),
              h('button', {
                className: `fd-text-overlay-copy${this.state.textInputOverlayCopied ? ' fd-text-overlay-copy--done' : ''}`,
                onclick: (e) => {
                  e.stopPropagation();
                  navigator.clipboard?.writeText(this.state.textInputOverlay.currentVal).catch(() => {});
                  this.setState({ textInputOverlayCopied: true });
                  setTimeout(() => this.setState({ textInputOverlayCopied: false }), 2000);
                },
              }, this.state.textInputOverlayCopied ? 'Copied ✓' : 'Copy'),
              h('button', {
                className: 'fd-text-overlay-close',
                onclick: (e) => { e.stopPropagation(); closeInputOverlay(); },
              }, '×'),
            ),
            h('textarea', {
              className: 'fd-text-input-overlay-body',
              value: this.state.textInputOverlay.currentVal,
              placeholder: this.state.textInputOverlay.field?.description || this.state.textInputOverlay.key,
              rows: 8,
              oninput: (e) => this.setState({ textInputOverlay: { ...this.state.textInputOverlay, currentVal: e.target.value } }),
              ref: (el) => { if (el) requestAnimationFrame(() => el.focus()); },
            }),
          ),
        );
      })() : null,
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
      this.state.instructionPickerOverlay ? (() => {
        const overlay = this.state.instructionPickerOverlay;
        const close = () => this.setState({ instructionPickerOverlay: null });
        const apply = () => {
          this._onParamChange(overlay.windowId, overlay.key, overlay.editedText.trim());
          close();
        };
        const copy = (e) => {
          e.stopPropagation();
          navigator.clipboard?.writeText(overlay.editedText).catch(() => {});
          this.setState({ instructionPickerOverlay: { ...overlay, copied: true } });
          setTimeout(() => {
            if (this.state.instructionPickerOverlay) this.setState({ instructionPickerOverlay: { ...this.state.instructionPickerOverlay, copied: false } });
          }, 2000);
        };
        const presets = INSTRUCTION_PRESETS.filter(p => p.id !== 'custom');
        const customPreset = { id: 'custom', title: 'Custom', text: '' };
        return h('div', {
          className: 'sc2-modal-backdrop',
          onmousedown: close,
          ontouchend: (e) => { e.stopPropagation(); close(); },
        },
          h('div', {
            className: 'sc2-modal-panel sc2-ipm-panel',
            onmousedown: (e) => e.stopPropagation(),
            ontouchstart: (e) => e.stopPropagation(),
            ontouchend: (e) => e.stopPropagation(),
          },
            h('div', { className: 'sc2-modal-header' },
              h('span', { className: 'sc2-modal-title' }, overlay.label || 'Instructions'),
              h('button', { className: 'sc2-modal-close', onclick: close }, '×'),
            ),
            h('div', { className: 'sc2-ipm-body' },
              h('div', { className: 'sc2-ipm-list' },
                ...presets.map(preset =>
                  h('div', {
                    key: preset.id,
                    className: `sc2-ipm-preset${overlay.selectedId === preset.id ? ' sc2-ipm-preset--active' : ''}`,
                    onclick: (e) => { e.stopPropagation(); this.setState({ instructionPickerOverlay: { ...overlay, selectedId: preset.id, editedText: preset.text } }); },
                  },
                    h('span', { className: 'sc2-ipm-dot' }),
                    preset.title,
                  ),
                ),
                h('div', {
                  className: `sc2-ipm-preset sc2-ipm-preset--custom${overlay.selectedId === 'custom' ? ' sc2-ipm-preset--active' : ''}`,
                  onclick: (e) => { e.stopPropagation(); this.setState({ instructionPickerOverlay: { ...overlay, selectedId: 'custom', editedText: '' } }); },
                },
                  h('span', { className: 'sc2-ipm-dot' }),
                  'Custom',
                ),
              ),
              h('div', { className: 'sc2-ipm-editor' },
                h('textarea', {
                  className: 'sc2-ipm-textarea',
                  value: overlay.editedText,
                  placeholder: overlay.selectedId === 'custom' ? 'Write your own instructions…' : 'Select a preset or edit freely.',
                  oninput: (e) => this.setState({ instructionPickerOverlay: { ...overlay, editedText: e.target.value } }),
                }),
                h('div', { className: 'sc2-modal-footer' },
                  h('button', { className: 'sc2-modal-btn', onclick: close }, 'Cancel'),
                  h('button', {
                    className: `sc2-modal-btn${overlay.copied ? ' sc2-modal-btn--copied' : ''}`,
                    disabled: !overlay.editedText.trim(),
                    onclick: copy,
                  }, overlay.copied ? 'Copied ✓' : 'Copy'),
                  h('button', { className: 'sc2-modal-btn sc2-modal-btn--apply', disabled: !overlay.editedText.trim(), onclick: apply }, 'Apply'),
                ),
              ),
            ),
          ),
        );
      })() : null,
      this.state.modelPickerOverlay ? (() => {
        const overlay = this.state.modelPickerOverlay;
        const close = () => this.setState({ modelPickerOverlay: null });
        const { models, loading, error, search, currentVal, label } = overlay;
        const q = (search || '').trim().toLowerCase();
        const filtered = q ? models.filter(m => this._modelDisplayName(m).toLowerCase().includes(q)) : models;
        return h('div', {
          className: 'sc2-modal-backdrop',
          onmousedown: close,
          ontouchend: (e) => { e.stopPropagation(); close(); },
        },
          h('div', {
            className: 'sc2-modal-panel',
            onmousedown: (e) => e.stopPropagation(),
            ontouchstart: (e) => e.stopPropagation(),
            ontouchend: (e) => e.stopPropagation(),
          },
            h('div', { className: 'sc2-modal-header' },
              h('span', { className: 'sc2-modal-title' }, label || 'Model'),
              h('button', { className: 'sc2-modal-close', onclick: close }, '×'),
            ),
            h('div', { className: 'sc2-modal-search-wrap' },
              h('input', {
                className: 'sc2-modal-search',
                type: 'text',
                placeholder: 'search models…',
                value: search,
                oninput: (e) => this.setState({ modelPickerOverlay: { ...overlay, search: e.target.value } }),
              }),
            ),
            h('div', { className: 'sc2-modal-list' },
              loading ? h('div', { className: 'sc2-modal-empty' }, 'Loading…')
              : error ? h('div', { className: 'sc2-modal-empty' }, error)
              : filtered.length === 0 ? h('div', { className: 'sc2-modal-empty' }, search ? 'No matches.' : 'No models found.')
              : filtered.map(m => {
                  const name = this._modelDisplayName(m);
                  return h('div', {
                    key: name,
                    className: `sc2-modal-item${name === currentVal ? ' sc2-modal-item--active' : ''}`,
                    onclick: (e) => { e.stopPropagation(); this._onParamChange(overlay.windowId, overlay.key, name); close(); },
                  },
                    h('span', { className: 'sc2-modal-item-dot' }),
                    h('span', { className: 'sc2-modal-item-name' }, name),
                  );
                }),
            ),
            !loading && !error ? h('div', { className: 'sc2-modal-count' }, `${filtered.length} model${filtered.length !== 1 ? 's' : ''}${search ? ' matched' : ''}`) : null,
          ),
        );
      })() : null,
      showFab ? h('button', {
        className: `sc2-fab${(isConnecting || pendingOutputSource || pendingInputTarget) ? ' sc2-fab--connecting' : ''}`,
        title: (isConnecting || pendingOutputSource || pendingInputTarget) ? 'Add + connect node' : 'Add node',
        ontouchstart: (e) => e.stopPropagation(),
        ontouchend: (e) => e.stopPropagation(),
        onclick: (e) => {
          e.stopPropagation();
          if (this._engine.fsmState === 'NODE_MODE') {
            this._engine.zoomOut();
          }
          // Eagerly commit connection state into component state so it survives
          // the async modal interaction intact, regardless of FSM changes.
          if (isConnecting && connection) {
            this.setState({ pendingOutputSource: { ...connection } });
            this._engine.fsm.clearConnection();
          }
          const pos = this._findClearPosition();
          const cx = window.innerWidth / 2;
          const cy = window.innerHeight / 2;
          this._scale = SCALE_Z1;
          this._panX = cx - pos.x * SCALE_Z1;
          this._panY = cy - pos.y * SCALE_Z1;
          this._animateViewport();
          const connectingCtx = (isConnecting || pendingInputTarget || this.state.pendingOutputSource)
            ? { connecting: true }
            : null;
          setTimeout(() => {
            eventBus.emit('sandbox:canvasTap', { x: cx, y: cy, ...connectingCtx });
          }, 300);
        },
      }, (isConnecting || pendingOutputSource || pendingInputTarget) ? '⚡' : '+') : null,
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

  async _loadToolDetail(windowId) {
    const win = this._engine.windows.get(windowId);
    if (!win || win.type !== 'tool') return;
    if (win.tool?.inputSchema || win.tool?.metadata?.inputSchema) return; // already loaded
    const toolId = win.tool?.toolId || win.tool?.id;
    if (!toolId) return;
    try {
      const res = await fetch(`/api/v1/tools/registry/${toolId}`);
      if (!res.ok) return;
      const full = await res.json();
      this._engine.updateWindow(windowId, { tool: { ...win.tool, ...full } });
      this.setState({});
    } catch (e) {
      console.warn('[SandboxCanvas2] Failed to load tool detail:', e);
    }
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
      const textSnippet = win.type === 'primitive' && win.outputType === 'text' && win.value
        ? h('div', { className: 'sc2-node-text-snippet' }, win.value)
        : null;
      const exprSnippet = win.type === 'expression' && win.expression
        ? h('div', { className: 'sc2-node-text-snippet' }, win.expression)
        : null;
      const thumb = thumbUrl ? h('img', {
        className: 'sc2-node-thumb sc2-node-thumb--clickable',
        src: thumbUrl,
        alt: '',
        onclick: (e) => {
          e.stopPropagation();
          // Suppress if touchend already handled this tap (prevents double-fire on mobile)
          if (this._suppressThumbClick && Date.now() - this._suppressThumbClick < 500) return;
          if (fsmState === 'CANVAS_Z2') {
            this._engine.tapNode(win.id);
          } else {
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
        const keys = allKeys.filter(k => schema[k]?.required !== false);
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
        textSnippet,
        exprSnippet,
        outputAnchor,
        ...inputAnchors,
      ));
    }
    return chips;
  }

  _onTapNode(id) {
    if (this._engine.fsm.isConnecting || this.state.pendingInputTarget) {
      const sourceId = this._engine.fsm.connection?.sourceNodeId;
      if (id !== sourceId) {
        // Enter NODE_MODE for the target so the user can pick the specific port
        this._enterNodeMode(id);
        this.setState({ nodeModeShowOptional: false, nodeModeOutputExpanded: false });
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
      this.setState({ nodeModeShowOptional: false, nodeModeOutputExpanded: false });
      return;
    }

    this._engine.tapNode(id);
  }

  _onDoubleTapNode(id) {
    this._engine.doubleTapNode(id);
    this.setState({ nodeModeShowOptional: false, nodeModeOutputExpanded: false });
  }

  _isPortWired(windowId, inputKey) {
    for (const conn of this._engine.connections.values()) {
      if ((conn.to ?? conn.toWindowId) === windowId && conn.toInput === inputKey) return true;
    }
    return false;
  }

  _enterNodeMode(id) {
    if (this._engine.fsm.state === 'NODE_MODE') {
      this._engine.fsm.navigateToNode(id);
    } else {
      this._engine.doubleTapNode(id);
    }
  }

  // Always land at Z1 when entering connection mode
  _ensureZ1() {
    const state = this._engine.fsm.state;
    if (state === 'NODE_MODE') this._engine.zoomOut();        // NODE_MODE → Z1
    else if (state === 'CANVAS_Z2') this._engine.fsm.zoomIn(); // Z2 → Z1
  }

  // After creating a node, auto-wire it if we're mid-connection
  _autoConnectNew(id) {
    const pending = this.state.pendingInputTarget;
    if (pending) {
      // New node's output → pending input target
      const win = this._engine.windows.get(id);
      const outType = normalizeType(win?.tool?.metadata?.outputType || win?.tool?.outputType || win?.outputType);
      const connId = this._engine._genId('c');
      this._engine.addCanvasConnection(connId, id, pending.windowId, 'output', pending.key, outType);
      this.setState({ pendingInputTarget: null });
      return;
    }
    // Live FSM connection takes priority; fall back to committed FAB snapshot
    const src = this._engine.fsm.isConnecting
      ? this._engine.fsm.connection
      : this.state.pendingOutputSource;
    if (src) {
      const { sourceNodeId, sourcePort, sourceType } = src;
      const win = this._engine.windows.get(id);
      const schema = this._inputSchema(win) || {};
      const inputKey = Object.keys(schema).find(k => {
        const portType = normalizeType(schema[k]?.type);
        return !this._isPortWired(id, k) && (!sourceType || !portType || sourceType === portType);
      }) || Object.keys(schema).find(k => !this._isPortWired(id, k));
      if (inputKey) {
        const connId = this._engine._genId('c');
        this._engine.addCanvasConnection(connId, sourceNodeId, id, sourcePort, inputKey, sourceType);
      }
      this._engine.fsm.clearConnection();
      this.setState({ pendingOutputSource: null });
    }
  }

  _matchInstructionPreset(value) {
    if (!value) return 'custom';
    const match = INSTRUCTION_PRESETS.find(p => p.id !== 'custom' && p.text === value);
    return match ? match.id : 'custom';
  }

  _modelDisplayName(m) {
    return (m.path || m.save_path || m.name || '').split('/').pop().split('\\').pop() || m.name || m.id || '';
  }

  async _openModelPicker(windowId, key, currentVal, label, category) {
    this.setState({ modelPickerOverlay: { windowId, key, currentVal, label, models: [], loading: true, error: null, search: '' } });
    try {
      const qs = category ? `category=${encodeURIComponent(category)}&limit=200` : 'limit=200';
      const res = await fetch(`/api/v1/models?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models = data.models || data.data?.models || (Array.isArray(data) ? data : []);
      const overlay = this.state.modelPickerOverlay;
      if (overlay?.windowId === windowId && overlay?.key === key) {
        this.setState({ modelPickerOverlay: { ...overlay, models, loading: false } });
      }
    } catch (err) {
      const overlay = this.state.modelPickerOverlay;
      if (overlay) this.setState({ modelPickerOverlay: { ...overlay, loading: false, error: `Failed to load models: ${err.message}` } });
    }
  }

  _startOutputConnection(win) {
    // If seeking a source for a pending input, complete the reverse connection directly
    const pending = this.state.pendingInputTarget;
    if (pending) {
      const outType = normalizeType(win.tool?.metadata?.outputType || win.tool?.outputType || win.outputType);
      const connId = this._engine._genId('c');
      this._engine.addCanvasConnection(connId, win.id, pending.windowId, 'output', pending.key, outType);
      this.setState({ pendingInputTarget: null });
      // Return to Z1 after connecting
      if (this._engine.fsm.state === 'NODE_MODE') this._engine.zoomOut();
      return;
    }
    const outType = normalizeType(win.tool?.metadata?.outputType || win.tool?.outputType || win.outputType);
    this._ensureZ1();
    this._engine.fsm.startConnection(win.id, 'output', outType);
    this.setState({ fsmState: this._engine.fsmState });
  }

  _startBatchConnection(win) {
    const slots = win.outputs || [];
    const batchType = normalizeType(slots[0]?.type || 'image');
    this._ensureZ1();
    this._engine.fsm.startConnection(win.id, 'batch', batchType);
    this.setState({ fsmState: this._engine.fsmState });
  }

  _completeInputConnection(targetWinId, inputKey, inputType) {
    const conn = this._engine.fsm.connection;
    if (!conn) return;
    const { sourceNodeId, sourcePort, sourceType } = conn;
    const connId = this._engine._genId('c');
    this._engine.addCanvasConnection(connId, sourceNodeId, targetWinId, sourcePort, inputKey, sourceType || inputType);
    this._engine.fsm.clearConnection();
    // Return to Z1 after connecting
    this._engine.zoomOut(); // NODE_MODE → Z1
    this.setState({ fsmState: this._engine.fsmState, focusedWindowId: this._engine.focusedWindowId });
  }

  // Prevent mobile browser zoom-on-focus by locking maximum-scale while
  // a text input overlay is open.  Restored when the overlay closes.
  _lockViewportZoom() {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    this._savedViewport = meta.getAttribute('content');
    meta.setAttribute('content', (this._savedViewport || '') + ', maximum-scale=1');
  }
  _unlockViewportZoom() {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    if (this._savedViewport !== undefined) {
      meta.setAttribute('content', this._savedViewport);
      this._savedViewport = undefined;
    }
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
    if (field.type === 'number' || field.type === 'integer') {
      return h('input', {
        className: 'fd-param-input',
        type: 'number',
        value: currentVal,
        placeholder: field.description || key,
        onchange,
      });
    }
    // Instructions — opens preset picker
    if (key === 'instructions') {
      const label = field.name || key;
      return h('div', {
        className: 'fd-param-input-tap',
        onclick: (e) => {
          e.stopPropagation();
          this.setState({ instructionPickerOverlay: {
            windowId, key, label,
            selectedId: this._matchInstructionPreset(currentVal ? String(currentVal) : ''),
            editedText: currentVal ? String(currentVal) : '',
          }});
        },
      }, currentVal
        ? h('span', { className: 'fd-param-tap-value' }, String(currentVal))
        : h('span', { className: 'fd-param-tap-placeholder' }, field.description || 'Choose instructions…'));
    }
    // Model / checkpoint — opens model picker
    if (field.type === 'model' || key === 'input_model' || key === 'input_checkpoint') {
      const label = field.name || key;
      const category = key === 'input_checkpoint' ? 'checkpoint' : null;
      return h('div', {
        className: 'fd-param-input-tap',
        onclick: (e) => {
          e.stopPropagation();
          this._openModelPicker(windowId, key, currentVal ? String(currentVal) : '', label, category);
        },
      }, currentVal
        ? h('span', { className: 'fd-param-tap-value' }, String(currentVal))
        : h('span', { className: 'fd-param-tap-placeholder' }, key === 'input_checkpoint' ? 'Select checkpoint…' : 'Select model…'));
    }
    // Text fields — tappable display that opens full-screen editor
    const label = field.name || key;
    return h('div', {
      className: 'fd-param-input-tap',
      onclick: (e) => {
        e.stopPropagation();
        this._lockViewportZoom();
        this.setState({ textInputOverlay: { windowId, key, field, currentVal: currentVal || '', label } });
      },
    }, currentVal
      ? h('span', { className: 'fd-param-tap-value' }, String(currentVal))
      : h('span', { className: 'fd-param-tap-placeholder' }, field.description || key));
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
    const versions = win.outputVersions || [];
    const vIdx = win.currentVersionIndex >= 0 ? win.currentVersionIndex : versions.length - 1;
    const headerVersionNav = versions.length > 0 ? h('div', { className: 'fd-header-version-nav' },
      h('button', {
        className: 'fd-output-version-btn',
        disabled: vIdx <= 0,
        onclick: (e) => { e.stopPropagation(); this._engine.updateWindow(windowId, { currentVersionIndex: vIdx - 1, output: versions[vIdx - 1] }); this.setState({}); },
      }, '‹'),
      h('span', { className: 'fd-output-version-label' }, `v${vIdx + 1} / ${versions.length}`),
      h('button', {
        className: 'fd-output-version-btn',
        disabled: vIdx >= versions.length - 1,
        onclick: (e) => { e.stopPropagation(); this._engine.updateWindow(windowId, { currentVersionIndex: vIdx + 1, output: versions[vIdx + 1] }); this.setState({}); },
      }, '›'),
    ) : null;
    const identityCard = h('div', { className: 'fd-card fd-card-header' },
      h('div', { className: 'fd-card-header-row' },
        h('div', { className: 'fd-card-title' }, tool?.displayName || win.spell?.name || win.type),
        headerVersionNav,
      ),
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
    const isPendingTarget = !!this.state.pendingInputTarget;
    const inConnectionMode = isIncomingTarget || isPendingTarget;
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
            title: connectedFrom ? 'Wired' : isIncomingTarget ? (typeMatch ? 'Connect here' : 'Connect (type mismatch)') : 'Tap to seek source',
            onclick: (e) => {
              e.stopPropagation();
              if (isIncomingTarget) {
                this._completeInputConnection(windowId, key, field.type);
              } else if (!connectedFrom) {
                // Enter "seeking source" mode — go to Z1 so user can tap an output anchor
                this.setState({ pendingInputTarget: { windowId, key, type: portType, label: field.name || key } });
                this._ensureZ1();
              }
            },
          }, anchorIcon(portType)),
          h('div', { className: 'fd-param-body' },
            h('label', { className: 'fd-param-label' }, field.name || key),
            connectedFrom
              ? h('div', { className: 'fd-param-wired' },
                  h('button', {
                    className: 'fd-card-link',
                    onclick: (e) => { e.stopPropagation(); this._engine.fsm.navigateToNode(connectedFrom.from ?? connectedFrom.fromWindowId); },
                  }, `← ${this._engine.windows.get(connectedFrom.from ?? connectedFrom.fromWindowId)?.tool?.displayName || 'connected'}`),
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
                h('button', {
                  className: 'fd-card-link',
                  onclick: (e) => { e.stopPropagation(); this._engine.fsm.navigateToNode(c.to ?? c.toWindowId); },
                }, `→ ${this._engine.windows.get(c.to ?? c.toWindowId)?.tool?.displayName || 'connected'}`),
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

      const connectionBanner = inConnectionMode ? h('div', { className: 'sc2-conn-banner' },
        isIncomingTarget
          ? `tap an input to connect${sourceType ? ` (${sourceType})` : ''}`
          : `tap an output to connect (${this.state.pendingInputTarget?.type || 'any'})`,
      ) : null;

      bodyCard = h('div', { className: `fd-card fd-card-params${inConnectionMode ? ' fd-card-params--connecting' : ''}` },
        connectionBanner,
        h('div', { className: 'fd-params-col fd-params-inputs' },
          h('div', { className: 'fd-params-col-label' }, 'Inputs'),
          ...required.map(([k, f]) => renderParamRow(k, f)),
          !inConnectionMode && optional.length ? h('button', {
            className: `fd-params-toggle${showOptional ? ' fd-params-toggle--active' : ''}`,
            onclick: (e) => { e.stopPropagation(); this.setState({ nodeModeShowOptional: !showOptional }); },
          }, showOptional ? '− fewer' : `+ ${optional.length} more`) : null,
          ...(!inConnectionMode && showOptional ? optional.map(([k, f]) => renderParamRow(k, f)) : []),
        ),
        outRows.length ? h('div', { className: 'fd-params-col fd-params-outputs' },
          h('div', { className: 'fd-params-col-label' }, 'Outputs'),
          ...outRows,
        ) : null,
      );
    } else if (win.type === 'upload') {
      bodyCard = h('div', { className: 'fd-card' }, h(UploadWindowBody, { win, connections: windowConns }));
    } else if (win.type === 'primitive' && win.outputType === 'text') {
      const currentText = win.value || '';
      const connectedTo = [...this._engine.connections.values()]
        .filter(c => (c.from ?? c.fromWindowId) === windowId);
      bodyCard = h('div', { className: 'fd-card fd-card-params' },
        h('div', { className: 'fd-params-col fd-params-inputs' },
          h('div', { className: 'fd-params-col-label' }, 'Text'),
          h('div', { className: 'fd-param-row' },
            h('div', { className: 'fd-param-body' },
              h('div', {
                className: 'fd-param-input-tap',
                onclick: (e) => {
                  e.stopPropagation();
                  this._lockViewportZoom();
                  this.setState({ textInputOverlay: {
                    label: 'Text',
                    currentVal: currentText,
                    field: { description: 'Enter text…' },
                    key: 'value',
                    onSave: (val) => {
                      this._engine.updateWindow(windowId, { value: val, output: { type: 'text', text: val } });
                    },
                  }});
                },
              }, currentText
                ? h('span', { className: 'fd-param-tap-value' }, currentText)
                : h('span', { className: 'fd-param-tap-placeholder' }, 'Tap to enter text…'),
              ),
            ),
          ),
        ),
        h('div', { className: 'fd-params-col fd-params-outputs' },
          h('div', { className: 'fd-params-col-label' }, 'Outputs'),
          h('div', { className: 'fd-param-row fd-param-row-output' },
            h('div', { className: 'fd-param-body' },
              h('label', { className: 'fd-param-label' }, 'text'),
              h('span', { className: 'fd-param-type' }, 'text'),
              connectedTo.length ? h('div', { className: 'fd-param-wired-list' },
                ...connectedTo.map(c => h('div', { key: c.id, className: 'fd-param-wired' },
                  h('button', {
                    className: 'fd-card-link',
                    onclick: (e) => { e.stopPropagation(); this._engine.fsm.navigateToNode(c.to ?? c.toWindowId); },
                  }, `→ ${this._engine.windows.get(c.to ?? c.toWindowId)?.tool?.displayName || 'connected'}`),
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
            }, anchorIcon('text')),
          ),
        ),
      );
    } else if (win.type === 'expression') {
      const currentExpr = win.expression || '';
      const connectedTo = [...this._engine.connections.values()]
        .filter(c => (c.from ?? c.fromWindowId) === windowId);
      const connectedFrom = [...this._engine.connections.values()]
        .filter(c => (c.to ?? c.toWindowId) === windowId);

      bodyCard = h('div', { className: 'fd-card fd-card-params' },
        h('div', { className: 'fd-params-col fd-params-inputs' },
          h('div', { className: 'fd-params-col-label' }, 'Expression'),
          // Expression editor
          h('div', { className: 'fd-param-row' },
            h('div', { className: 'fd-param-body' },
              h('div', {
                className: 'fd-param-input-tap',
                onclick: (e) => {
                  e.stopPropagation();
                  this._lockViewportZoom();
                  this.setState({ textInputOverlay: {
                    label: 'Expression',
                    currentVal: currentExpr,
                    field: { description: 'e.g. replace(input, "X", n + 1)' },
                    key: 'expression',
                    onSave: (val) => {
                      this._engine.updateWindow(windowId, { expression: val });
                    },
                  }});
                },
              }, currentExpr
                ? h('span', { className: 'fd-param-tap-value' }, currentExpr)
                : h('span', { className: 'fd-param-tap-placeholder' }, 'Tap to enter expression…'),
              ),
            ),
          ),
          // Show wired inputs
          connectedFrom.length ? h('div', { className: 'fd-params-col-label', style: 'margin-top:8px' }, 'Inputs') : null,
          ...connectedFrom.map(c => {
            const sourceWin = this._engine.windows.get(c.from ?? c.fromWindowId);
            return h('div', { className: 'fd-param-row' },
              h('div', { className: 'fd-param-body' },
                h('div', { className: 'fd-param-wired' },
                  h('button', {
                    className: 'fd-card-link',
                    onclick: (e) => { e.stopPropagation(); this._engine.fsm.navigateToNode(c.from ?? c.fromWindowId); },
                  }, `← ${sourceWin?.tool?.displayName || sourceWin?.type || 'connected'}`),
                  h('button', {
                    className: 'fd-param-disconnect',
                    title: 'Disconnect',
                    onclick: (e) => { e.stopPropagation(); this._engine.connections.delete(c.id); this.setState({}); },
                  }, '×'),
                ),
              ),
            );
          }),
        ),
        h('div', { className: 'fd-params-col fd-params-outputs' },
          h('div', { className: 'fd-params-col-label' }, 'Output'),
          h('div', { className: 'fd-param-row fd-param-row-output' },
            h('div', { className: 'fd-param-body' },
              h('label', { className: 'fd-param-label' }, 'result'),
              h('span', { className: 'fd-param-type' }, 'text'),
              connectedTo.length ? h('div', { className: 'fd-param-wired-list' },
                ...connectedTo.map(c => h('div', { key: c.id, className: 'fd-param-wired' },
                  h('button', {
                    className: 'fd-card-link',
                    onclick: (e) => { e.stopPropagation(); this._engine.fsm.navigateToNode(c.to ?? c.toWindowId); },
                  }, `→ ${this._engine.windows.get(c.to ?? c.toWindowId)?.tool?.displayName || 'connected'}`),
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
            }, anchorIcon('text')),
          ),
        ),
      );
    } else {
      bodyCard = h('div', { className: 'fd-card' },
        h('div', { className: 'fd-card-label' }, win.spell?.name || win.outputType || win.type),
      );
    }

    // ── Card 3: Output result ─────────────────────────────────────────────────
    let outputCard = null;
    if (win.executing) {
      // Always show progress in-place (not collapsible while running)
      outputCard = h('div', { className: 'fd-card fd-card-output fd-card-output--running' },
        h('div', { className: 'fd-output-progress-bar' }),
        h('div', { className: 'fd-output-status' }, win.progress || 'Running…'),
      );
    } else if (win.error) {
      outputCard = h('div', { className: 'fd-card fd-card-output fd-card-output--error' },
        h('div', { className: 'fd-card-section' }, 'Error'),
        h('div', { className: 'fd-output-error' }, win.error),
      );
    } else {
      const versions = win.outputVersions || [];
      const vIdx = win.currentVersionIndex >= 0 ? win.currentVersionIndex : versions.length - 1;
      const out = versions.length > 0 ? versions[vIdx] : win.output;
      const label = win.tool?.displayName || win.type;
      const hasOutput = !!out;
      const outputExpanded = this.state.nodeModeOutputExpanded;
      const isPastVersion = versions.length > 0 && vIdx < versions.length - 1;

      const renderSingleItem = (o) => {
        if (o.type === 'image' && o.url) {
          return h('img', {
            className: 'fd-output-image fd-result-img--clickable',
            src: o.url, alt: 'Output', title: 'Tap to expand',
            onclick: (e) => { e.stopPropagation(); this.setState({ imageOverlay: { url: o.url, label } }); },
          });
        }
        if (o.type === 'video' && o.url) return h('video', { className: 'fd-output-video', src: o.url, controls: true, playsinline: true });
        if (o.type === 'text' && o.text) return h('div', {
          className: 'fd-output-text fd-result-img--clickable',
          title: 'Tap to expand',
          onclick: (e) => { e.stopPropagation(); this.setState({ textOverlay: { text: o.text, label }, textOverlayCopied: false }); },
        }, o.text);
        if (o.type === 'file' && o.files?.length) {
          return h('div', { className: 'fd-output-files' },
            ...o.files.map(f => h('a', { className: 'fd-output-file-link', href: f.url, target: '_blank', rel: 'noopener' }, f.filename || f.url)),
          );
        }
        return h('div', { className: 'fd-output-status' }, o.type || 'unknown');
      };

      const renderOutBody = (o) => {
        if (!o) return h('div', { className: 'fd-output-status' }, 'No output yet');
        const allItems = o.items || [o];
        if (allItems.length > 1) {
          return h('div', { className: 'fd-output-batch-grid' },
            ...allItems.map((item, i) => h('div', { key: i, className: 'fd-output-batch-item' }, renderSingleItem(item))),
          );
        }
        return renderSingleItem(o);
      };

      outputCard = h('div', { className: 'fd-card fd-card-output' },
        h('div', {
          className: `fd-output-header${hasOutput ? ' fd-output-header--toggle' : ''}`,
          onclick: hasOutput ? (e) => { e.stopPropagation(); this.setState({ nodeModeOutputExpanded: !outputExpanded }); } : null,
        },
          h('div', { className: 'fd-card-section' }, 'Output'),
          isPastVersion ? h('span', { className: 'fd-output-past-badge' }, 'past — execute → saves as new') : null,
          hasOutput ? h('span', { className: 'fd-output-toggle-icon' }, outputExpanded ? '▲' : '▼') : null,
        ),
        (!hasOutput || outputExpanded) ? renderOutBody(out) : null,
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
            else if (win.type === 'expression') this._engine.addExpressionWindow(pos);
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
      else if (win.type === 'expression') this._engine.addExpressionWindow(pos);
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
      else if (win.type === 'expression') this._engine.addExpressionWindow(pos);
    }
  }

  // ─── Touch gestures ───────────────────────────────────────────────────────

  _onTouchStart(e) {
    if (this.state.imageOverlay || this.state.textOverlay || this.state.textInputOverlay || this.state.instructionPickerOverlay || this.state.modelPickerOverlay) return;
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

      // Don't preventDefault on interactive elements — let click events fire
      const isTappable = e.target.closest('.sc2-anchor, .sc2-node-thumb--clickable, .sc2-fab, button, a');
      if (!isTappable) e.preventDefault();
      this._panStart = { x: t.clientX - this._panX, y: t.clientY - this._panY };

      // Track node under finger for potential drag
      const nodeEl = e.target.closest && e.target.closest('.sc2-node');
      const nodeId = nodeEl && nodeEl.dataset.windowId;
      if (nodeId && !isTappable) {
        const win = this._engine.windows.get(nodeId);
        if (win) this._nodeTouchStart = { id: nodeId, touchX: t.clientX, touchY: t.clientY, nodeX: win.x, nodeY: win.y };
      }

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
    if (this.state.imageOverlay || this.state.textOverlay || this.state.textInputOverlay || this.state.instructionPickerOverlay || this.state.modelPickerOverlay) return;
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

    // Node drag — activate once movement exceeds 8px from a node touch
    if (e.touches.length === 1 && this._nodeTouchStart && !this._touchDragNodeId) {
      const t = e.touches[0];
      const dist = Math.hypot(t.clientX - this._nodeTouchStart.touchX, t.clientY - this._nodeTouchStart.touchY);
      if (dist > 8) {
        this._touchDragNodeId = this._nodeTouchStart.id;
        this._engine.pinWindow(this._touchDragNodeId);
        this._panStart = null; // stop canvas panning
        this._gestureStart = null; // prevent tap detection
        this._velBuffer = [];
      }
    }

    if (e.touches.length === 1 && this._touchDragNodeId && this._nodeTouchStart) {
      e.preventDefault();
      const t = e.touches[0];
      const dx = (t.clientX - this._nodeTouchStart.touchX) / this._scale;
      const dy = (t.clientY - this._nodeTouchStart.touchY) / this._scale;
      const newX = this._nodeTouchStart.nodeX + dx;
      const newY = this._nodeTouchStart.nodeY + dy;
      this._engine.pinWindow(this._touchDragNodeId, { x: newX, y: newY });
      this._engine.updateWindow(this._touchDragNodeId, { x: newX, y: newY });
      return;
    }

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
    if (this.state.textInputOverlay) {
      const target = e.changedTouches[0] && document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      if (!target?.closest?.('.fd-text-overlay-card') || target?.closest?.('.fd-text-overlay-close')) {
        const { windowId, key, currentVal, onSave } = this.state.textInputOverlay;
        if (onSave) onSave(currentVal);
        else this._onParamChange(windowId, key, currentVal);
        this._unlockViewportZoom();
        this.setState({ textInputOverlay: null, textInputOverlayCopied: false });
      }
      return;
    }
    if (this.state.textOverlay) {
      const target = e.changedTouches[0] && document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      if (!target?.closest?.('.fd-text-overlay-card') || target?.closest?.('.fd-text-overlay-close')) {
        this.setState({ textOverlay: null, textOverlayCopied: false });
      }
      return;
    }
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

    // End node drag
    if (this._touchDragNodeId) {
      this._touchDragNodeId = null;
      this._nodeTouchStart = null;
      this._gestureStart = null;
      return;
    }
    this._nodeTouchStart = null;

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
      if (this.state.pendingInputTarget) {
        this.setState({ pendingInputTarget: null });
      } else if (this._engine.fsm.isConnecting) {
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
        this._suppressThumbClick = Date.now(); // prevent onclick double-fire
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
      if (this.state.pendingInputTarget) {
        this.setState({ pendingInputTarget: null });
      } else if (this._engine.fsm.isConnecting) {
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
      // Dismiss overlays first, then connection mode, then zoom out
      if (this.state.textInputOverlay) {
        const { windowId, key, currentVal, onSave } = this.state.textInputOverlay;
        if (onSave) onSave(currentVal);
        else this._onParamChange(windowId, key, currentVal);
        this._unlockViewportZoom();
        this.setState({ textInputOverlay: null, textInputOverlayCopied: false });
      } else if (this.state.instructionPickerOverlay) {
        this.setState({ instructionPickerOverlay: null });
      } else if (this.state.modelPickerOverlay) {
        this.setState({ modelPickerOverlay: null });
      } else if (this.state.imageOverlay) {
        this.setState({ imageOverlay: null });
      } else if (this.state.textOverlay) {
        this.setState({ textOverlay: null, textOverlayCopied: false });
      } else if (this._engine.fsm.isConnecting) {
        this._engine.fsm.clearConnection();
        this.setState({ pendingOutputSource: null });
      } else {
        this._engine.zoomOut();
      }
      return;
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

    // Expression nodes evaluate client-side via expr-eval
    if (win.type === 'expression') {
      this._engine.updateWindow(windowId, { executing: true, error: null });
      try {
        const { evaluate } = await import('./expressionEval.js');
        // Gather inputs from connections
        const variables = {};
        for (const conn of this._engine.connections.values()) {
          if ((conn.to ?? conn.toWindowId) !== windowId) continue;
          const sourceWin = this._engine.windows.get(conn.from ?? conn.fromWindowId);
          const out = sourceWin?.output;
          if (out?.type === 'image') variables[conn.toInput || 'input'] = out.url;
          else if (out?.type === 'text') variables[conn.toInput || 'input'] = out.text ?? out.data?.text?.[0] ?? '';
          else if (out?.type === 'video') variables[conn.toInput || 'input'] = out.url;
          else if (out?.value !== undefined) variables[conn.toInput || 'input'] = out.value;
        }
        const result = evaluate(win.expression, variables);
        if (Array.isArray(result)) {
          // Expression returned a list — fans out into a batch
          const batchOutputs = result.map(item => ({
            type: 'text',
            text: String(item),
          }));
          this._engine.updateWindowBatchOutput(windowId, batchOutputs);
          this._engine.updateWindow(windowId, { executing: false, progress: null });
        } else {
          const text = String(result);
          const output = { type: 'text', text };
          const versions = [...(win.outputVersions || []), output];
          this._engine.updateWindow(windowId, {
            output, executing: false, outputLoaded: true,
            outputVersions: versions, currentVersionIndex: versions.length - 1,
          });
        }
      } catch (err) {
        this._engine.updateWindow(windowId, { executing: false, error: err.message });
      }
      return;
    }

    this._engine.updateWindow(windowId, { executing: true, error: null, progress: 'Starting...' });

    try {
      const inputs = {};
      const mappings = { ...(win.parameterMappings || {}) };
      const schema = win.tool?.inputSchema || win.tool?.metadata?.inputSchema || {};

      // Synthesize nodeOutput mappings from canvas connections so wired
      // connections are available to the execution resolver.
      for (const conn of this._engine.connections.values()) {
        if ((conn.to ?? conn.toWindowId) === windowId && conn.toInput && !mappings[conn.toInput]) {
          mappings[conn.toInput] = {
            type: 'nodeOutput',
            nodeId: conn.from ?? conn.fromWindowId,
            outputKey: conn.fromOutput || 'output',
          };
        }
      }

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
    const items = [];

    const addImg = (url) => url && items.push({ type: 'image', url, generationId: gid });
    const addTxt = (text) => text && items.push({ type: 'text', text, generationId: gid });

    if (Array.isArray(outputs.images)) {
      outputs.images.forEach(img => addImg(img?.url));
    }
    if (outputs.imageUrl) addImg(outputs.imageUrl);
    if (outputs.response) addTxt(outputs.response);
    if (outputs.text) addTxt(outputs.text);
    if (outputs.description) addTxt(outputs.description);
    if (outputs.type === 'text' && outputs.data?.text) {
      const texts = Array.isArray(outputs.data.text) ? outputs.data.text : [outputs.data.text];
      texts.forEach(t => addTxt(t));
    }
    if (outputs.type === 'image' && Array.isArray(outputs.data?.images)) {
      outputs.data.images.forEach(img => addImg(img?.url));
    }
    if (Array.isArray(outputs)) {
      for (const item of outputs) {
        if (item.type === 'image' && Array.isArray(item.data?.images))
          item.data.images.forEach(img => addImg(img?.url));
        if (item.type === 'text' && item.data?.text) {
          const txt = Array.isArray(item.data.text) ? item.data.text[0] : item.data.text;
          addTxt(txt);
        }
      }
    }
    if (typeof outputs === 'object' && !Array.isArray(outputs)) {
      for (const node of Object.values(outputs)) {
        if (node?.data && Array.isArray(node.data.images))
          node.data.images.forEach(img => addImg(img?.url));
      }
    }
    if (outputs.videoUrl || outputs.video) {
      items.push({ type: 'video', url: outputs.videoUrl || outputs.video, generationId: gid });
    }
    if (Array.isArray(outputs.files) && outputs.files.length) {
      const vid = outputs.files.find(f => /\.(mp4|webm|mov)$/i.test(f.url || f.filename || ''));
      if (vid) items.push({ type: 'video', url: vid.url, generationId: gid });
      else items.push({ type: 'file', files: outputs.files, generationId: gid });
    }

    // Deduplicate by url/text
    const seen = new Set();
    const unique = items.filter(it => {
      const key = it.url || it.text || it.type;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (unique.length === 0) return { type: 'unknown', generationId: gid };
    const primary = unique[0];
    // Store all items on the version entry so the output card can render a batch grid
    return unique.length > 1 ? { ...primary, items: unique } : primary;
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
