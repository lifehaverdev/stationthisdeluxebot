import { Component, h } from '@monygroupcorp/microact';
import { PhysicsEngine } from '../sandbox/focus/physics/PhysicsEngine.js';
import { createPosition } from '../sandbox/focus/spatial/SphericalGrid.js';
import { FocusStateMachine, STATES } from '../sandbox/focus/state/FocusStateMachine.js';
import { computeGlows } from '../sandbox/focus/state/PeripheryGlows.js';
import { getNeighbors } from '../sandbox/focus/spatial/Proximity.js';
import '../style/focus-demo.css';

// ── Type helpers (mirrored from WindowRenderer) ───────────────────────────────
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

const NODE_WIDTH = 200;
const NODE_HEIGHT = 90;

const ZOOM_LEVELS = {
  CANVAS_Z2: 0.45,
  CANVAS_Z1: 1.0,
};

const TWEAK_DEFAULTS = {
  // Gestures
  friction:             { value: 0.985, min: 0.80, max: 0.99,  step: 0.005, label: 'Momentum friction',           tweakable: true },
  minVelocity:          { value: 0.1,   min: 0.05, max: 3.0,   step: 0.05, label: 'Min velocity (px/ms)',        tweakable: true },
  zoneBottom:           { value: 0.30,  min: 0.05, max: 0.40,  step: 0.01, label: 'Zoom zone bottom %',          tweakable: true },
  zoneWidth:            { value: 0.60,  min: 0.10, max: 0.80,  step: 0.01, label: 'Zoom zone width %',           tweakable: true },
  // Physics
  repulsionStrength:    { value: 8000,  min: 500,  max: 20000, step: 500,  label: 'Repulsion strength',          tweakable: true },
  repulsionRange:       { value: 350,   min: 100,  max: 800,   step: 10,   label: 'Repulsion range (px)',         tweakable: true },
  attractionRestLength: { value: 250,   min: 50,   max: 600,   step: 10,   label: 'Connection rest length (px)', tweakable: true },
  polarityStrength:     { value: 0.5,   min: 0.0,  max: 2.0,   step: 0.1,  label: 'Polarity strength',           tweakable: true },
  // Zoom
  scaleZ1:              { value: 1.0,   min: 0.5,  max: 2.0,   step: 0.05, label: 'Z1 scale',                    tweakable: true },
  scaleZ2:              { value: 0.45,  min: 0.2,  max: 1.0,   step: 0.05, label: 'Z2 scale',                    tweakable: true },
};

// Helper: extract just the values for runtime use
function defaultTweakValues() {
  const out = {};
  for (const [k, v] of Object.entries(TWEAK_DEFAULTS)) out[k] = v.value;
  return out;
}

export class FocusDemo extends Component {
  constructor(props) {
    super(props);
    this._fsm = new FocusStateMachine();
    this.state = {
      fsmState: this._fsm.state,
      focusedNodeId: null,
      activatedGlowId: null,
      transitionDirection: null,
      viewport: { panX: 0, panY: 0, scale: ZOOM_LEVELS.CANVAS_Z2 },
      positions: new Map(),
      nodes: new Map(),
      connections: [],
      tweakerOpen: false,
      descriptionExpanded: false,
      nodeModeShowOptional: false,
    };
    this._engine = new PhysicsEngine();
    this._rafId = null;
    this._rootEl = null;
    this._perfSamples = [];
    this._boundKeyDown = this._onKeyDown.bind(this);

    // Gesture recognizer state
    this._gestureStart = null; // { x, y, time, target }
    this._lastTap = null;     // { time, target }
    this._tapTimeout = null;
    this._longPressTimeout = null;
    this._clipboard = null;
    this._cloneCounters = new Map();
    this._groupCounter = 0;
    this._tweaks = defaultTweakValues();
    this._momentum = { vx: 0, vy: 0, running: false, lastTs: 0 };
    this._velBuffer = []; // time-window buffer: [{dx, dy, dt, t}] last 100ms
    this._panX = 0; // always-live pan position — render always reads this, never falls back to state
    this._panY = 0;

    this._fsm.onChange((from, to, nodeId) => {
      this._onStateChange(from, to, nodeId);
    });
  }

  didMount() {
    this._loadTools();
    this._startSimulation();
    window.focusDemo = this;

    this._rootEl.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    this._rootEl.addEventListener('mousedown', this._onMouseDown.bind(this));
    this._rootEl.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
    this._rootEl.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: false });
    this._rootEl.addEventListener('touchend', this._onTouchEnd.bind(this));
    document.addEventListener('keydown', this._boundKeyDown);
  }

  willUnmount() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    document.removeEventListener('keydown', this._boundKeyDown);
    window.focusDemo = null;
  }

  _setTweak(key, val) {
    this._tweaks[key] = val;
    this.setState({});
  }

  _updateNode(nodeId, patch) {
    const nodes = new Map(this.state.nodes);
    const n = nodes.get(nodeId);
    if (!n) return;
    nodes.set(nodeId, { ...n, ...patch });
    this.setState({ nodes });
  }

  _startMomentum() {
    if (this._velBuffer.length === 0) return;

    // Total displacement / total time = stable average velocity (px/ms)
    // avoids clustering artifacts from rapid events near lift-off
    let totalDt = 0, sumDx = 0, sumDy = 0;
    for (const { dx, dy, dt } of this._velBuffer) {
      totalDt += dt;
      sumDx += dx;
      sumDy += dy;
    }
    this._velBuffer = [];

    const vx = totalDt > 0 ? sumDx / totalDt : 0;
    const vy = totalDt > 0 ? sumDy / totalDt : 0;
    if (Math.hypot(vx, vy) < this._tweaks.minVelocity) return;

    this._momentum.vx = vx;
    this._momentum.vy = vy;
    this._momentum.lastTs = performance.now();
    this._momentum.running = true;
  }

  _isInZoomZone(x, y) {
    const { zoneBottom, zoneWidth } = this._tweaks;
    const h = window.innerHeight;
    const w = window.innerWidth;
    return y > h * (1 - zoneBottom)
      && x > w * (0.5 - zoneWidth / 2)
      && x < w * (0.5 + zoneWidth / 2);
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      if (this._fsm.isConnecting) {
        this._cancelConnection();
      } else if (this.state.fsmState === STATES.MULTI_SELECT) {
        this._fsm.exitMultiSelect();
      } else if (this.state.activatedGlowId) {
        this.setState({ activatedGlowId: null });
      } else {
        this._fsm.zoomOut();
      }
    }
  }

  _onStateChange(from, to, nodeId) {
    const update = { fsmState: to, focusedNodeId: nodeId, activatedGlowId: null };

    // Compute transition direction
    if (from === STATES.NODE_MODE && to === STATES.NODE_MODE && this.state.focusedNodeId && nodeId) {
      const fromPos = this.state.positions.get(this.state.focusedNodeId);
      const toPos = this.state.positions.get(nodeId);
      if (fromPos && toPos) {
        const dx = toPos.x - fromPos.x;
        const dy = toPos.y - fromPos.y;
        if (Math.abs(dx) > Math.abs(dy)) {
          update.transitionDirection = dx > 0 ? 'left' : 'right';
        } else {
          update.transitionDirection = dy > 0 ? 'up' : 'down';
        }
      }
    } else if (to === STATES.NODE_MODE) {
      update.transitionDirection = 'up';
    } else if (from === STATES.NODE_MODE) {
      update.transitionDirection = 'down';
    } else {
      update.transitionDirection = null;
    }

    if (to === STATES.CANVAS_Z2) {
      update.viewport = { ...this.state.viewport, scale: this._tweaks.scaleZ2 };
    } else if (to === STATES.CANVAS_Z1 && nodeId) {
      const pos = this.state.positions.get(nodeId);
      if (pos) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        update.viewport = {
          scale: this._tweaks.scaleZ1,
          panX: cx - pos.x * this._tweaks.scaleZ1,
          panY: cy - pos.y * this._tweaks.scaleZ1,
        };
      } else {
        update.viewport = { ...this.state.viewport, scale: this._tweaks.scaleZ1 };
      }
    }

    if (to === STATES.NODE_MODE && nodeId) {
      this._loadToolDetail(nodeId);
      update.descriptionExpanded = false;
      update.nodeModeShowOptional = false;
    }

    if (to === STATES.CANVAS_Z1 && nodeId) {
      this._loadToolDetail(nodeId);
    }

    // Kill any running momentum and sync _panX/Y to new viewport (always-live)
    if (this._momentum.running) {
      this._momentum.running = false;
      this._momentum.vx = 0;
      this._momentum.vy = 0;
    }
    if (update.viewport) {
      this._panX = update.viewport.panX;
      this._panY = update.viewport.panY;
      // Apply transition class only for FSM-driven viewport changes (zoom/pan-to-node),
      // not during finger pan or momentum where every frame must be instant.
      if (this._rootEl) {
        const viewport = this._rootEl.querySelector('.fd-viewport');
        if (viewport) {
          viewport.classList.add('fd-viewport--animating');
          clearTimeout(this._viewportTransitionTimeout);
          this._viewportTransitionTimeout = setTimeout(() => {
            viewport.classList.remove('fd-viewport--animating');
          }, 320);
        }
      }
    }

    this.setState(update);
  }

  _onNodeClick(nodeId, e) {
    e.stopPropagation();

    // In connection mode: tap node → go to Z1 of target (for anchor selection)
    if (this._fsm.isConnecting) {
      if (nodeId === this._fsm.connection.sourceNodeId) return; // can't connect to self
      if (this.state.fsmState === STATES.CANVAS_Z2) {
        // Navigate to Z1 of tapped node so user can see/tap its input anchors
        this._fsm.tapNode(nodeId); // Z2 → Z1 transition
      }
      return;
    }

    if (this.state.fsmState === STATES.MULTI_SELECT) {
      this._fsm.toggleSelection(nodeId);
      this.setState({});
      return;
    }
    this._fsm.tapNode(nodeId);
  }

  _onNodeDoubleClick(nodeId, e) {
    e.stopPropagation();
    this._fsm.doubleTapNode(nodeId);
  }

  _onCanvasClick(e) {
    if (e.target === e.currentTarget || e.target.classList.contains('fd-viewport')) {
      if (this._fsm.isConnecting) {
        if (this.state.fsmState === STATES.CANVAS_Z1) {
          this._fsm.zoomOut(); // back to Z2 to navigate elsewhere
        } else if (this.state.fsmState === STATES.CANVAS_Z2) {
          this._cancelConnection();
        }
        return;
      }
      if (this.state.fsmState === STATES.CANVAS_Z1) {
        this._fsm.zoomOut();
      }
    }
  }

  _onWheel(e) {
    e.preventDefault();
    if (e.deltaY > 0) {
      this._fsm.zoomOut();
    }
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    if (this.state.fsmState === STATES.NODE_MODE) return;
    this._panStart = { x: e.clientX - this._panX, y: e.clientY - this._panY };
    const startX = e.clientX;
    const startY = e.clientY;
    // Long-press detection (desktop)
    if (this.state.fsmState === STATES.CANVAS_Z1 || this.state.fsmState === STATES.CANVAS_Z2) {
      const target = e.target;
      this._longPressTimeout = setTimeout(() => {
        this._longPressTimeout = null;
        const nodeEl = target.closest && target.closest('.fd-node');
        const nodeId = nodeEl && nodeEl.dataset.nodeId;
        if (nodeId) {
          this._fsm.enterMultiSelect(nodeId);
          this.setState({});
        }
      }, 500);
    }
    const onMove = (ev) => {
      if (this._longPressTimeout) {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (dist > 10) {
          clearTimeout(this._longPressTimeout);
          this._longPressTimeout = null;
        }
      }
      const mousePanX = ev.clientX - this._panStart.x;
      const mousePanY = ev.clientY - this._panStart.y;
      this._panX = mousePanX;
      this._panY = mousePanY;
      this.setState({
        viewport: {
          ...this.state.viewport,
          panX: mousePanX,
          panY: mousePanY,
        },
      });
    };
    const onUp = () => {
      if (this._longPressTimeout) {
        clearTimeout(this._longPressTimeout);
        this._longPressTimeout = null;
      }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _onTouchStart(e) {
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

      if (this.state.fsmState === STATES.NODE_MODE) {
        // Don't preventDefault — allow native clicks and card scrolling
        return;
      }

      // Don't preventDefault on tweaker UI — allow button clicks and sliders
      if (e.target.closest && e.target.closest('.fd-tweaker')) {
        return;
      }

      e.preventDefault();
      // _panX/Y are always current — no fallback needed.
      this._panStart = { x: t.clientX - this._panX, y: t.clientY - this._panY };
      // Long-press detection for multi-select
      if (this.state.fsmState === STATES.CANVAS_Z1 || this.state.fsmState === STATES.CANVAS_Z2) {
        const target = e.target;
        this._longPressTimeout = setTimeout(() => {
          this._longPressTimeout = null;
          const nodeEl = target.closest && target.closest('.fd-node');
          const nodeId = nodeEl && nodeEl.dataset.nodeId;
          if (nodeId) {
            this._fsm.enterMultiSelect(nodeId);
            this.setState({});
            this._gestureStart = null;
          }
        }, 500);
      }
    } else if (e.touches.length === 2) {
      e.preventDefault();
      // Block pinch in NODE_MODE
      if (this.state.fsmState === STATES.NODE_MODE) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      this._pinchStart = {
        dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
        scale: this.state.viewport.scale,
        midX: (a.clientX + b.clientX) / 2,
        midY: (a.clientY + b.clientY) / 2,
        panX: this._panX,
        panY: this._panY,
      };
    }
  }

  _onTouchMove(e) {
    // Cancel long-press if finger moved
    if (this._longPressTimeout && this._gestureStart) {
      const t = e.touches[0];
      const dist = Math.hypot(t.clientX - this._gestureStart.x, t.clientY - this._gestureStart.y);
      if (dist > 10) {
        clearTimeout(this._longPressTimeout);
        this._longPressTimeout = null;
      }
    }
    // In NODE_MODE: don't preventDefault — allow native card scrolling
    // We still detect swipe-down-to-exit in touchend via _gestureStart
    if (this.state.fsmState === STATES.NODE_MODE) {
      return;
    }
    if (e.touches.length === 1 && this._panStart) {
      e.preventDefault();
      const t = e.touches[0];
      const now = performance.now();

      // Track velocity for momentum
      const newPanX = t.clientX - this._panStart.x;
      const newPanY = t.clientY - this._panStart.y;
      const dx = newPanX - this._panX; // delta from always-live position (not stale state)
      const dy = newPanY - this._panY;
      const dt = now - (this._lastMoveTime || now);
      this._lastMoveTime = now;

      this._panX = newPanX;
      this._panY = newPanY;

      if (dt > 0) {
        this._velBuffer.push({ dx, dy, dt, t: now });
        // Prune samples older than 100ms so we capture the fast-phase, not finger deceleration
        const cutoff = now - 100;
        while (this._velBuffer.length > 1 && this._velBuffer[0].t < cutoff) {
          this._velBuffer.shift();
        }
      }

      // Trigger a render so the display tracks the finger without waiting for the next rAF tick.
      // Render reads _panX directly, so no conflict with the physics loop's setState.
      this.setState({});
    } else if (e.touches.length === 2 && this._pinchStart) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const ratio = dist / this._pinchStart.dist;
      const newScale = Math.max(0.15, Math.min(4.0, this._pinchStart.scale * ratio));
      const scaleRatio = newScale / this._pinchStart.scale;
      const pinchPanX = this._pinchStart.midX - (this._pinchStart.midX - this._pinchStart.panX) * scaleRatio;
      const pinchPanY = this._pinchStart.midY - (this._pinchStart.midY - this._pinchStart.panY) * scaleRatio;
      this._panX = pinchPanX;
      this._panY = pinchPanY;
      this.setState({
        viewport: {
          panX: pinchPanX,
          panY: pinchPanY,
          scale: newScale,
        },
      });
    }
  }

  _onTouchEnd(e) {
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
    const velocity = dist / Math.max(elapsed, 1);
    const absDy = Math.abs(dy);
    const absDx = Math.abs(dx);

    // 1. Swipe detection: vertical > 50px, velocity > 0.3px/ms, more vertical than horizontal
    if (absDy > 50 && velocity > 0.3 && absDy > absDx) {
      const startX = this._gestureStart.x;
      const startY = this._gestureStart.y;
      this._gestureStart = null;
      this._clearTapTimeout();
      // Only zoom from the bottom-center zone
      if (this._isInZoomZone(startX, startY) && this._panAtGestureStart) {
        // Undo any pan that accumulated during the swipe gesture
        this._panX = this._panAtGestureStart.x;
        this._panY = this._panAtGestureStart.y;
        this._momentum.running = false;
        this._velBuffer = [];
        if (dy > 0) {
          // Swipe down from zone → zoom out / cancel
          if (this._fsm.isConnecting && this.state.fsmState === STATES.CANVAS_Z2) {
            this._cancelConnection();
          } else if (this.state.fsmState === STATES.MULTI_SELECT) {
            this._fsm.exitMultiSelect();
          } else if (this.state.fsmState === STATES.CANVAS_Z2) {
            this._recenterCanvas();
          } else {
            this._fsm.zoomOut();
          }
        } else {
          // Swipe up from zone → zoom in to Z1
          if (this.state.fsmState === STATES.CANVAS_Z2) {
            this._fsm.zoomIn();
          }
        }
      }
      return;
    }

    // In NODE_MODE, let native clicks handle button taps
    if (this.state.fsmState === STATES.NODE_MODE) {
      this._gestureStart = null;
      return;
    }

    // 2. Tap detection: moved < 10px, duration < 300ms
    if (dist < 10 && elapsed < 300) {
      const target = this._gestureStart.target;
      const nodeEl = target.closest && target.closest('.fd-node');
      const nodeId = nodeEl && nodeEl.dataset.nodeId;
      const now = performance.now();

      // Check for anchor tap
      const anchorEl = target.closest && target.closest('.fd-anchor');
      if (anchorEl) {
        const anchorType = anchorEl.dataset.anchor;
        const anchorNodeId = anchorEl.dataset.nodeId;
        const anchorPort = anchorEl.dataset.port;
        const anchorDataType = anchorEl.dataset.type || null;
        if (anchorType === 'output' && anchorNodeId) {
          this._startConnection(anchorNodeId, anchorPort, anchorDataType);
        } else if (anchorType === 'input' && anchorNodeId && this._fsm.isConnecting) {
          const conn = this._fsm.connection;
          if (conn.sourceNodeId !== anchorNodeId) {
            this._completeConnection(anchorNodeId, anchorPort, anchorDataType);
          }
        }
        this._gestureStart = null;
        return;
      }

      // Multi-select: tap to toggle
      if (this.state.fsmState === STATES.MULTI_SELECT) {
        if (nodeId) {
          this._fsm.toggleSelection(nodeId);
          this.setState({});
        }
        this._gestureStart = null;
        return;
      }

      // Double-tap check
      if (this._lastTap && nodeId && this._lastTap.nodeId === nodeId && (now - this._lastTap.time) < 300) {
        this._clearTapTimeout();
        this._lastTap = null;
        this._fsm.doubleTapNode(nodeId);
      } else {
        // Store as potential first tap, delay single-tap action
        this._lastTap = { time: now, nodeId };
        this._clearTapTimeout();

        if (nodeId) {
          this._tapTimeout = setTimeout(() => {
            this._fsm.tapNode(nodeId);
            this._tapTimeout = null;
          }, 300);
        } else {
          // Tap on empty canvas
          if (this._fsm.isConnecting) {
            if (this.state.fsmState === STATES.CANVAS_Z2) {
              this._cancelConnection();
            } else if (this.state.fsmState === STATES.CANVAS_Z1) {
              this._fsm.zoomOut(); // back to Z2, keep connection active
            }
          } else if (this.state.fsmState === STATES.CANVAS_Z1) {
            this._fsm.zoomOut();
          }
        }
      }
    }

    this._gestureStart = null;
  }

  _clearTapTimeout() {
    if (this._tapTimeout) {
      clearTimeout(this._tapTimeout);
      this._tapTimeout = null;
    }
  }

  _recenterCanvas() {
    const positions = [...this.state.nodes.keys()]
      .map(id => this._engine.getNode(id)?.position)
      .filter(Boolean);
    if (!positions.length) return;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const scale = this._tweaks.scaleZ2;
    const centroidX = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const centroidY = positions.reduce((s, p) => s + p.y, 0) / positions.length;
    const panX = cx - centroidX * scale;
    const panY = cy - centroidY * scale;
    this._panX = panX;
    this._panY = panY;
    if (this._rootEl) {
      const vp = this._rootEl.querySelector('.fd-viewport');
      if (vp) {
        vp.classList.add('fd-viewport--animating');
        clearTimeout(this._viewportTransitionTimeout);
        this._viewportTransitionTimeout = setTimeout(() => vp.classList.remove('fd-viewport--animating'), 320);
      }
    }
    this.setState({ viewport: { panX, panY, scale } });
  }

  async _loadTools() {
    try {
      const res = await fetch('/api/v1/tools/registry');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tools = await res.json();

      // Group tools by service for clustered initial layout
      const byService = {};
      for (const tool of tools) {
        const svc = tool.service || 'other';
        if (!byService[svc]) byService[svc] = [];
        byService[svc].push(tool);
      }

      const nodeMap = new Map();
      const COL_GAP = 400;
      const ROW_GAP = 220;
      let col = 0;

      for (const [service, serviceTools] of Object.entries(byService)) {
        const colHeight = serviceTools.length * ROW_GAP;
        serviceTools.forEach((tool, row) => {
          const x = col * COL_GAP;
          const y = row * ROW_GAP - colHeight / 2;
          this._engine.addNode(tool.toolId, createPosition(x, y));
          this._engine.setGroup(tool.toolId, service);
          nodeMap.set(tool.toolId, {
            id: tool.toolId,
            label: tool.displayName,
            type: tool.service || null,
            group: service,
            toolData: tool,
          });
        });
        col++;
      }

      // Pre-built demo spell: chatgpt → dalleiii → joycaption, dalleiii → ltx-video
      const demoConnections = [];
      const has = (id) => nodeMap.has(id);
      if (has('chatgpt-free') && has('dall-e-3-image')) {
        this._engine.addConnection('dc1', 'chatgpt-free', 'dall-e-3-image');
        demoConnections.push({ id: 'dc1', from: 'chatgpt-free', to: 'dall-e-3-image', fromOutput: 'response', toInput: 'prompt', dataType: 'text' });
      }
      if (has('dall-e-3-image') && has('joycaption')) {
        this._engine.addConnection('dc2', 'dall-e-3-image', 'joycaption');
        demoConnections.push({ id: 'dc2', from: 'dall-e-3-image', to: 'joycaption', fromOutput: 'image', toInput: 'imageUrl', dataType: 'image' });
      }
      if (has('dall-e-3-image') && has('ltx-video')) {
        this._engine.addConnection('dc3', 'dall-e-3-image', 'ltx-video');
        demoConnections.push({ id: 'dc3', from: 'dall-e-3-image', to: 'ltx-video', fromOutput: 'image', toInput: 'imageUrl', dataType: 'image' });
      }

      this.setState({ nodes: nodeMap, connections: demoConnections });
    } catch (err) {
      console.error('[FocusDemo] Failed to load tools, falling back to seed:', err);
      this._seedDemo();
    }
  }

  async _loadToolDetail(toolId) {
    const node = this.state.nodes.get(toolId);
    if (!node || node.toolData?.inputSchema) return; // already have full detail
    try {
      const res = await fetch(`/api/v1/tools/registry/${toolId}`);
      if (!res.ok) return;
      const full = await res.json();
      // Pre-populate paramValues from schema defaults
      const paramValues = {};
      for (const [key, field] of Object.entries(full.inputSchema || {})) {
        paramValues[key] = field.default ?? '';
      }
      const nodes = new Map(this.state.nodes);
      nodes.set(toolId, { ...nodes.get(toolId), toolData: full, paramValues });
      this.setState({ nodes });
    } catch (err) {
      console.error('[FocusDemo] Failed to load tool detail:', err);
    }
  }

  _seedDemo() {
    const seed = [
      // 1. Idle — no output, ready to run
      {
        id: 'node-idle',
        label: 'ChatGPT',
        type: 'text-to-text',
        group: 'openai',
        x: 0, y: 0,
      },
      // 2. Running — executing, progress bar animating
      {
        id: 'node-running',
        label: 'Flux Gen',
        type: 'text-to-image',
        group: 'comfyui',
        x: 350, y: 0,
        executing: true,
        progress: 'Executing...',
      },
      // 3. Complete — image output (thumbnail extends below node)
      {
        id: 'node-done-img',
        label: 'DALL\u00B7E 3',
        type: 'text-to-image',
        group: 'openai',
        x: 700, y: 0,
        output: { type: 'image', url: 'https://picsum.photos/seed/dalle3/400/400' },
        outputVersions: [{ type: 'image', url: 'https://picsum.photos/seed/dalle3/400/400' }],
        currentVersionIndex: 0,
      },
      // 4. Complete — text output (text preview extends below node)
      {
        id: 'node-done-txt',
        label: 'JoyCaption',
        type: 'image-to-text',
        group: 'comfyui',
        x: 175, y: 300,
        output: { type: 'text', text: 'A cinematic portrait with dramatic side-lighting, shallow depth of field, shot on 85mm lens, dark background with subtle gradient.' },
        outputVersions: [{ type: 'text', text: 'A cinematic portrait with dramatic side-lighting, shallow depth of field, shot on 85mm lens, dark background with subtle gradient.' }],
        currentVersionIndex: 0,
      },
      // 5. Error — generic failure
      {
        id: 'node-error',
        label: 'LTX Video',
        type: 'video',
        group: 'comfyui',
        x: 525, y: 300,
        error: 'CUDA out of memory on worker-3. Try again or reduce resolution.',
      },
      // 6. Censored — 401 content policy rejection
      {
        id: 'node-censored',
        label: 'DALL\u00B7E 3',
        type: 'text-to-image',
        group: 'openai',
        x: 875, y: 300,
        error: '401 Forbidden \u2014 content policy violation',
        censored: true,
      },
      // 7. Spell steps — multi-step completed output
      {
        id: 'node-spell',
        label: 'Portrait Gen',
        type: 'spell',
        group: 'spells',
        x: 350, y: 600,
        output: {
          type: 'spell-steps',
          steps: [
            { type: 'text', text: 'A cinematic portrait, dramatic lighting, 85mm lens.' },
            { type: 'image', url: 'https://picsum.photos/seed/spell-step2/400/400' },
            { type: 'text', text: 'Two subjects, sharp focus, dark studio background, professional headshot style.' },
          ],
        },
        outputVersions: [{
          type: 'spell-steps',
          steps: [
            { type: 'text', text: 'A cinematic portrait, dramatic lighting, 85mm lens.' },
            { type: 'image', url: 'https://picsum.photos/seed/spell-step2/400/400' },
            { type: 'text', text: 'Two subjects, sharp focus, dark studio background, professional headshot style.' },
          ],
        }],
        currentVersionIndex: 0,
      },
    ];

    const nodeMap = new Map();
    for (const n of seed) {
      const { id, label, type, group, x, y, ...execState } = n;
      this._engine.addNode(id, createPosition(x, y));
      if (group) this._engine.setGroup(id, group);
      nodeMap.set(id, {
        id, label, type: type || null, group: group || null, toolData: null,
        executing: false, progress: null, error: null, censored: false,
        output: null, outputVersions: [], currentVersionIndex: 0,
        ...execState,
      });
    }

    this.setState({ nodes: nodeMap, connections: [] });
  }

  _startSimulation() {
    let lastTime = performance.now();

    const tick = (now) => {
      const dt = Math.min(now - lastTime, 32);
      lastTime = now;

      // 1. Physics step — paused in NODE_MODE (canvas hidden, glows must stay stable)
      const inNodeMode = this.state.fsmState === STATES.NODE_MODE;
      const t0 = performance.now();
      const positions = inNodeMode ? this.state.positions : this._engine.step(dt, this._tweaks);
      const stepMs = performance.now() - t0;
      if (!inNodeMode) {
        this._perfSamples.push(stepMs);
        if (this._perfSamples.length > 120) this._perfSamples.shift();
      }

      // 2. Momentum step
      if (this._momentum.running) {
        const elapsed = Math.min(now - this._momentum.lastTs, 64);
        this._momentum.lastTs = now;
        const decay = Math.pow(this._tweaks.friction, elapsed / 16.67);
        this._momentum.vx *= decay;
        this._momentum.vy *= decay;
        if (Math.hypot(this._momentum.vx, this._momentum.vy) < 0.01) {
          this._momentum.running = false;
          this._momentum.vx = 0;
          this._momentum.vy = 0;
        } else {
          this._panX += this._momentum.vx * elapsed;
          this._panY += this._momentum.vy * elapsed;
        }
      }

      // 3. ONE setState per frame — no races
      this.setState({
        positions,
        viewport: { ...this.state.viewport, panX: this._panX, panY: this._panY },
      });
      this._rafId = requestAnimationFrame(tick);
    };

    this._rafId = requestAnimationFrame(tick);
  }

  getAvgStepMs() {
    if (!this._perfSamples.length) return 0;
    return this._perfSamples.reduce((a, b) => a + b, 0) / this._perfSamples.length;
  }

  _addRandomNode() {
    const id = 'n' + Date.now();
    const x = (Math.random() - 0.5) * 600;
    const y = (Math.random() - 0.5) * 600;
    this._engine.addNode(id, createPosition(x, y));
    const nodes = new Map(this.state.nodes);
    nodes.set(id, { id, label: 'New Node', type: null, group: null, params: null });
    this.setState({ nodes });
  }

  _addConnectedNode() {
    const existingIds = [...this.state.nodes.keys()];
    if (!existingIds.length) return;
    const targetId = existingIds[existingIds.length - 1];
    const target = this._engine.getNode(targetId);
    if (!target) return;

    const id = 'n' + Date.now();
    const x = target.position.x + 300;
    const y = target.position.y + (Math.random() - 0.5) * 100;
    this._engine.addNode(id, createPosition(x, y));
    const connId = 'c' + Date.now();
    this._engine.addConnection(connId, targetId, id);

    const nodes = new Map(this.state.nodes);
    nodes.set(id, { id, label: 'Connected', type: null, group: null, params: null });
    const connections = [...this.state.connections, { id: connId, from: targetId, to: id }];
    this.setState({ nodes, connections });
  }

  _addGroupCluster() {
    const groupId = 'g' + Date.now();
    const baseX = (Math.random() - 0.5) * 800;
    const baseY = (Math.random() - 0.5) * 800;
    const nodes = new Map(this.state.nodes);
    const newConnections = [];

    let prevId = null;
    for (let i = 0; i < 4; i++) {
      const id = `${groupId}-${i}`;
      const x = baseX + i * 250 + (Math.random() - 0.5) * 50;
      const y = baseY + (Math.random() - 0.5) * 100;
      this._engine.addNode(id, createPosition(x, y));
      this._engine.setGroup(id, groupId);
      nodes.set(id, { id, label: `Group ${i}`, type: null, group: groupId, params: null });

      if (prevId) {
        const connId = `c-${groupId}-${i}`;
        this._engine.addConnection(connId, prevId, id);
        newConnections.push({ id: connId, from: prevId, to: id });
      }
      prevId = id;
    }

    this.setState({
      nodes,
      connections: [...this.state.connections, ...newConnections],
    });
  }

  _removeLastNode() {
    const ids = [...this.state.nodes.keys()];
    if (!ids.length) return;
    const lastId = ids[ids.length - 1];
    this._engine.removeNode(lastId);
    const nodes = new Map(this.state.nodes);
    nodes.delete(lastId);
    const connections = this.state.connections.filter(c => c.from !== lastId && c.to !== lastId);
    this.setState({ nodes, connections });
  }

  _togglePin() {
    const ids = [...this.state.nodes.keys()];
    if (!ids.length) return;
    const lastId = ids[ids.length - 1];
    const node = this._engine.getNode(lastId);
    if (!node) return;
    if (node.pinned) {
      this._engine.unpinNode(lastId);
    } else {
      this._engine.pinNode(lastId, { ...node.position });
    }
    this.setState({});
  }

  _resetSeed() {
    for (const id of this.state.nodes.keys()) {
      this._engine.removeNode(id);
    }
    this.setState({ nodes: new Map(), connections: [], positions: new Map() });
    this._seedDemo();
  }

  _stressTest() {
    const existingIds = [...this.state.nodes.keys()];
    const nodes = new Map(this.state.nodes);
    const newConns = [];

    for (let i = 0; i < 20; i++) {
      const id = 'stress-' + Date.now() + '-' + i;
      const x = (Math.random() - 0.5) * 1500;
      const y = (Math.random() - 0.5) * 1500;
      this._engine.addNode(id, createPosition(x, y));
      nodes.set(id, { id, label: `S${existingIds.length + i}`, type: null, group: null, params: null });

      if (existingIds.length > 0 && Math.random() < 0.4) {
        const target = existingIds[Math.floor(Math.random() * existingIds.length)];
        const connId = 'sc-' + Date.now() + '-' + i;
        this._engine.addConnection(connId, id, target);
        newConns.push({ id: connId, from: id, to: target });
      }
      existingIds.push(id);
    }

    this.setState({
      nodes,
      connections: [...this.state.connections, ...newConns],
    });
  }

  _removeNode(nodeId) {
    this._engine.removeNode(nodeId);
    const nodes = new Map(this.state.nodes);
    nodes.delete(nodeId);
    const connections = this.state.connections.filter(c => c.from !== nodeId && c.to !== nodeId);
    this.setState({ nodes, connections });
  }

  _renderActionBar() {
    const count = this._fsm.selectedNodeIds.size;
    return h('div', { className: 'fd-action-bar' },
      h('span', { className: 'fd-action-bar-count' }, `${count} selected`),
      h('button', { className: 'fd-action-btn', onclick: () => this._batchGroup() }, 'Group'),
      h('button', { className: 'fd-action-btn', onclick: () => this._batchClone() }, 'Clone'),
      h('button', { className: 'fd-action-btn', onclick: () => this._batchCut() }, 'Cut'),
      this._clipboard ? h('button', { className: 'fd-action-btn', onclick: () => this._batchPaste() }, 'Paste') : null,
      h('button', { className: 'fd-action-btn fd-action-btn-danger', onclick: () => this._batchDelete() }, 'Delete'),
      h('button', { className: 'fd-action-btn fd-action-btn-cancel', onclick: () => this._fsm.exitMultiSelect() }, '\u2715'),
    );
  }

  _getBaseId(nodeId) {
    const match = nodeId.match(/^(.+)-v\d+$/);
    return match ? match[1] : nodeId;
  }

  _getNextCloneId(nodeId) {
    const base = this._getBaseId(nodeId);
    const current = this._cloneCounters.get(base) || 0;
    const next = current + 1;
    this._cloneCounters.set(base, next);
    return `${base}-v${next}`;
  }

  _cloneNodes(nodeIds) {
    const idMap = new Map();
    for (const id of nodeIds) {
      idMap.set(id, this._getNextCloneId(id));
    }

    const nodes = new Map(this.state.nodes);
    const newConnections = [];

    for (const oldId of nodeIds) {
      const newId = idMap.get(oldId);
      const sourceNode = this.state.nodes.get(oldId);
      const engineNode = this._engine.getNode(oldId);
      if (!sourceNode || !engineNode) continue;

      const pos = createPosition(
        engineNode.position.x + 150,
        engineNode.position.y + 50,
      );
      this._engine.addNode(newId, pos);
      nodes.set(newId, { id: newId, label: sourceNode.label, type: sourceNode.type, group: sourceNode.group, params: sourceNode.params });
      if (sourceNode.group) {
        this._engine.setGroup(newId, sourceNode.group);
      }
    }

    for (const conn of this.state.connections) {
      if (idMap.has(conn.from) && idMap.has(conn.to)) {
        const connId = 'c' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        const newFrom = idMap.get(conn.from);
        const newTo = idMap.get(conn.to);
        this._engine.addConnection(connId, newFrom, newTo);
        newConnections.push({ id: connId, from: newFrom, to: newTo });
      }
    }

    return { nodes, newConnections, idMap };
  }

  _batchDelete() {
    const ids = [...this._fsm.selectedNodeIds];
    for (const id of ids) {
      this._engine.removeNode(id);
    }
    const nodes = new Map(this.state.nodes);
    for (const id of ids) nodes.delete(id);
    const connections = this.state.connections.filter(
      c => !this._fsm.selectedNodeIds.has(c.from) && !this._fsm.selectedNodeIds.has(c.to)
    );
    this._fsm.exitMultiSelect();
    this.setState({ nodes, connections });
  }

  _batchGroup() {
    this._groupCounter++;
    const groupId = `group-${this._groupCounter}`;
    const ids = [...this._fsm.selectedNodeIds];
    const nodes = new Map(this.state.nodes);
    for (const id of ids) {
      this._engine.setGroup(id, groupId);
      const node = nodes.get(id);
      if (node) nodes.set(id, { ...node, group: groupId });
    }
    this._fsm.exitMultiSelect();
    this.setState({ nodes });
  }

  _batchClone() {
    const ids = [...this._fsm.selectedNodeIds];
    this._fsm.exitMultiSelect();
    const { nodes, newConnections } = this._cloneNodes(ids);
    this.setState({
      nodes,
      connections: [...this.state.connections, ...newConnections],
    });
  }

  _batchCut() {
    const ids = [...this._fsm.selectedNodeIds];
    const clipNodes = ids.map(id => {
      const node = this.state.nodes.get(id);
      const engineNode = this._engine.getNode(id);
      return { ...node, position: engineNode ? { ...engineNode.position } : null };
    }).filter(Boolean);
    const clipConns = this.state.connections.filter(
      c => this._fsm.selectedNodeIds.has(c.from) && this._fsm.selectedNodeIds.has(c.to)
    );
    this._clipboard = { nodes: clipNodes, connections: clipConns };
    this._batchDelete();
  }

  _batchPaste() {
    if (!this._clipboard) return;
    const idMap = new Map();
    const nodes = new Map(this.state.nodes);
    const newConnections = [];

    const cx = (window.innerWidth / 2 - this.state.viewport.panX) / this.state.viewport.scale;
    const cy = (window.innerHeight / 2 - this.state.viewport.panY) / this.state.viewport.scale;

    let sumX = 0, sumY = 0;
    for (const cn of this._clipboard.nodes) {
      if (cn.position) { sumX += cn.position.x; sumY += cn.position.y; }
    }
    const avgX = sumX / this._clipboard.nodes.length;
    const avgY = sumY / this._clipboard.nodes.length;

    for (const cn of this._clipboard.nodes) {
      const newId = this._getNextCloneId(cn.id);
      idMap.set(cn.id, newId);
      const pos = cn.position
        ? createPosition(cx + (cn.position.x - avgX), cy + (cn.position.y - avgY))
        : createPosition(cx, cy);
      this._engine.addNode(newId, pos);
      nodes.set(newId, { id: newId, label: cn.label, type: cn.type, group: cn.group, params: cn.params });
      if (cn.group) this._engine.setGroup(newId, cn.group);
    }

    for (const conn of this._clipboard.connections) {
      if (idMap.has(conn.from) && idMap.has(conn.to)) {
        const connId = 'c' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        this._engine.addConnection(connId, idMap.get(conn.from), idMap.get(conn.to));
        newConnections.push({ id: connId, from: idMap.get(conn.from), to: idMap.get(conn.to) });
      }
    }

    this._fsm.exitMultiSelect();
    this.setState({ nodes, connections: [...this.state.connections, ...newConnections] });
  }

  _completeConnection(targetNodeId, targetPort, targetType) {
    const conn = this._fsm.connection;
    if (!conn || conn.sourceNodeId === targetNodeId) return;

    const connId = 'c' + Date.now();
    this._engine.addConnection(connId, conn.sourceNodeId, targetNodeId);
    const typeMismatch = !!(conn.sourceType && targetType && conn.sourceType !== targetType);
    const newConn = {
      id: connId,
      from: conn.sourceNodeId,
      fromOutput: conn.sourcePort,
      to: targetNodeId,
      toInput: targetPort,
      dataType: conn.sourceType,
      ...(typeMismatch ? { typeMismatch: true } : {}),
    };
    const connections = [...this.state.connections, newConn];

    this._fsm.clearConnection();

    // Return to Z1 centered on the target (connected-to) node
    const pos = this.state.positions.get(targetNodeId);
    if (pos) {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      this._panX = cx - pos.x * this._tweaks.scaleZ1;
      this._panY = cy - pos.y * this._tweaks.scaleZ1;
      const viewport = this._rootEl && this._rootEl.querySelector('.fd-viewport');
      if (viewport) {
        viewport.classList.add('fd-viewport--animating');
        clearTimeout(this._viewportTransitionTimeout);
        this._viewportTransitionTimeout = setTimeout(() => viewport.classList.remove('fd-viewport--animating'), 320);
      }
    }

    // Force zoom state to Z1 focused on target node
    this._fsm.focusedNodeId = targetNodeId;
    this._fsm.state = STATES.CANVAS_Z1;

    this.setState({
      connections,
      fsmState: STATES.CANVAS_Z1,
      focusedNodeId: targetNodeId,
      viewport: pos ? {
        scale: this._tweaks.scaleZ1,
        panX: this._panX,
        panY: this._panY,
      } : this.state.viewport,
    });
  }

  _startConnection(sourceNodeId, sourcePort, sourceType) {
    // If in NODE_MODE, zoom back to Z2 first so user can navigate to target
    if (this.state.fsmState === STATES.NODE_MODE) {
      this._fsm.zoomOut(); // NODE_MODE → CANVAS_Z1
      this._fsm.zoomOut(); // CANVAS_Z1 → CANVAS_Z2
    } else if (this.state.fsmState === STATES.CANVAS_Z1) {
      this._fsm.zoomOut(); // CANVAS_Z1 → CANVAS_Z2
    }
    // Set connection overlay after zoom transitions fire
    this._fsm.startConnection(sourceNodeId, sourcePort || 'output', sourceType || null);
    // Center Z2 viewport on source node
    const pos = this.state.positions.get(sourceNodeId);
    if (pos) {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const scale = this._tweaks.scaleZ2;
      this._panX = cx - pos.x * scale;
      this._panY = cy - pos.y * scale;
      const viewport = this._rootEl && this._rootEl.querySelector('.fd-viewport');
      if (viewport) {
        viewport.classList.add('fd-viewport--animating');
        clearTimeout(this._viewportTransitionTimeout);
        this._viewportTransitionTimeout = setTimeout(() => viewport.classList.remove('fd-viewport--animating'), 320);
      }
    }
    this.setState({ fsmState: this._fsm.state });
  }

  _cancelConnection() {
    this._fsm.clearConnection();
    this.setState({});
  }

  _disconnectConnection(connId) {
    this._engine.removeConnection(connId);
    this.setState({ connections: this.state.connections.filter(c => c.id !== connId) });
  }

  _renderParamInput(nodeId, key, field) {
    const val = this.state.nodes.get(nodeId)?.paramValues?.[key] ?? '';
    const onchange = (e) => {
      const nodes = new Map(this.state.nodes);
      const n = nodes.get(nodeId);
      nodes.set(nodeId, { ...n, paramValues: { ...(n.paramValues || {}), [key]: e.target.value } });
      this.setState({ nodes });
    };
    if (field.type === 'image' || field.type === 'video' || field.type === 'audio') {
      return h('span', { className: 'fd-param-type' }, field.type);
    }
    if (field.enum) {
      return h('select', { className: 'fd-param-select', value: val, onchange },
        ...field.enum.map(opt => h('option', { value: opt, selected: opt === val }, opt)),
      );
    }
    if (field.type === 'boolean') {
      return h('input', { className: 'fd-param-checkbox', type: 'checkbox', checked: !!val,
        onchange: (e) => {
          const nodes = new Map(this.state.nodes);
          const n = nodes.get(nodeId);
          nodes.set(nodeId, { ...n, paramValues: { ...(n.paramValues || {}), [key]: e.target.checked } });
          this.setState({ nodes });
        },
      });
    }
    return h('input', {
      className: 'fd-param-input',
      type: field.type === 'number' ? 'number' : 'text',
      value: val,
      placeholder: field.description || key,
      onchange,
    });
  }

  _renderNodeMode() {
    const { focusedNodeId, nodes } = this.state;
    const node = nodes.get(focusedNodeId);
    if (!node) return null;

    const engineNode = this._engine.getNode(focusedNodeId);
    const isPinned = engineNode && engineNode.pinned;

    const inputConns = this.state.connections.filter(c => c.to === focusedNodeId);
    const outputConns = this.state.connections.filter(c => c.from === focusedNodeId);

    return h('div', {
      className: `fd-nodemode${this.state.transitionDirection ? ` fd-slide-${this.state.transitionDirection}` : ''}`,
      onclick: () => {
        if (this.state.activatedGlowId) this.setState({ activatedGlowId: null });
      },
    },
      h('button', {
        className: 'fd-nodemode-back',
        onclick: (e) => { e.stopPropagation(); this._fsm.zoomOut(); },
      }, 'Back to Canvas'),

      h('div', { className: 'fd-nodemode-cards' },
        // Card 1: Tool identity + pricing
        h('div', { className: 'fd-card fd-card-header' },
          h('div', { className: 'fd-card-title' }, node.label),
          h('div', { className: 'fd-card-meta' },
            node.toolData?.deliveryMode ? h('span', { className: `fd-delivery-badge fd-delivery-${node.toolData.deliveryMode}` }, node.toolData.deliveryMode) : null,
            node.toolData?.metadata?.provider
              ? h('span', { className: 'fd-provider-tag' }, node.toolData.metadata.provider)
              : node.type ? h('span', { className: 'fd-provider-tag' }, node.type) : null,
            isPinned ? h('span', { className: 'fd-pin-tag' }, 'pinned') : null,
          ),
          (() => {
            const desc = node.toolData?.description;
            if (!desc) return null;
            const LIMIT = 100;
            const isLong = desc.length > LIMIT;
            const expanded = this.state.descriptionExpanded;
            return h('div', { className: 'fd-card-description' },
              isLong && !expanded ? desc.slice(0, LIMIT) + '\u2026' : desc,
              isLong ? h('button', {
                className: 'fd-desc-toggle',
                onclick: (e) => { e.stopPropagation(); this.setState({ descriptionExpanded: !expanded }); },
              }, expanded ? ' less' : ' more') : null,
            );
          })(),
          h('div', { className: 'fd-card-pricing' },
            h('div', { className: 'fd-pricing-row' },
              h('span', { className: 'fd-pricing-label' }, 'per call'),
              h('span', { className: 'fd-pricing-val' },
                node.toolData?.costingModel?.staticCost?.amount > 0
                  ? `$${node.toolData.costingModel.staticCost.amount.toFixed(4)}`
                  : node.toolData?.metadata?.avgHistoricalDurationMs
                    ? `~${(node.toolData.metadata.avgHistoricalDurationMs / 1000).toFixed(1)}s`
                    : '—'
              ),
            ),
            h('div', { className: 'fd-pricing-row' },
              h('span', { className: 'fd-pricing-label' }, 'spent'),
              h('span', { className: 'fd-pricing-val' }, '—'),
            ),
          ),
        ),

        // Card 2: Parameters — inputs left, outputs right
        node.toolData ? h('div', { className: 'fd-card fd-card-params' },
          node.toolData.inputSchema ? (() => {
            const conn = this._fsm.connection;
            const isConnecting = this._fsm.isConnecting;
            const isIncomingTarget = isConnecting && conn.sourceNodeId !== focusedNodeId;
            const showOptional = this.state.nodeModeShowOptional;

            const renderParamRow = (key, field) => {
              const connectedFrom = this.state.connections.find(c => c.to === focusedNodeId && c.toInput === key);
              const typeMatch = isIncomingTarget && (!conn.sourceType || !field.type || conn.sourceType === field.type);
              return h('div', { key, className: 'fd-param-row fd-param-row-input' },
                h('button', {
                  className: [
                    'fd-param-anchor',
                    connectedFrom ? 'fd-param-anchor-connected' : '',
                    typeMatch ? 'fd-param-anchor--matching' : '',
                  ].filter(Boolean).join(' '),
                  title: connectedFrom
                    ? `Wired from ${nodes.get(connectedFrom.from)?.label || connectedFrom.from}`
                    : isConnecting ? (typeMatch ? 'Connect here' : 'Connect (type mismatch — may fail)') : 'Wire input',
                  onclick: (e) => {
                    e.stopPropagation();
                    if (isIncomingTarget) this._completeConnection(focusedNodeId, key, field.type);
                  },
                }, anchorIcon(normalizeType(field.type))),
                h('div', { className: 'fd-param-body' },
                  h('label', { className: 'fd-param-label' }, field.name || key),
                  connectedFrom
                    ? h('div', { className: 'fd-param-wired' },
                        h('button', {
                          className: 'fd-card-link',
                          onclick: (e) => { e.stopPropagation(); this._fsm.navigateToNode(connectedFrom.from); },
                        }, `\u2190 ${nodes.get(connectedFrom.from)?.label || connectedFrom.from}`),
                        connectedFrom.typeMismatch ? h('span', { className: 'fd-param-mismatch', title: 'Type mismatch — connection may fail' }, '\u26a0') : null,
                        h('button', {
                          className: 'fd-param-disconnect',
                          title: 'Disconnect',
                          onclick: (e) => { e.stopPropagation(); this._disconnectConnection(connectedFrom.id); },
                        }, '\u00d7'),
                      )
                    : this._renderParamInput(focusedNodeId, key, field),
                ),
              );
            };

            const entries = Object.entries(node.toolData.inputSchema);
            const required = entries.filter(([, f]) => f.required);
            const optional = entries.filter(([, f]) => !f.required);

            return h('div', { className: 'fd-params-col fd-params-inputs' },
              h('div', { className: 'fd-params-col-label' }, 'Inputs'),
              ...required.map(([k, f]) => renderParamRow(k, f)),
              optional.length > 0 ? h('button', {
                className: `fd-params-toggle${showOptional ? ' fd-params-toggle--active' : ''}`,
                onclick: (e) => { e.stopPropagation(); this.setState({ nodeModeShowOptional: !showOptional }); },
              }, showOptional ? '− fewer options' : `+ ${optional.length} more`) : null,
              ...(showOptional ? optional.map(([k, f]) => renderParamRow(k, f)) : []),
            );
          })() : h('div', { className: 'fd-params-loading' }, 'Loading\u2026'),
          node.toolData.outputSchema ? h('div', { className: 'fd-params-col fd-params-outputs' },
            h('div', { className: 'fd-params-col-label' }, 'Outputs'),
            ...Object.entries(node.toolData.outputSchema).map(([key, field]) => {
              const connectedTo = this.state.connections.filter(c => c.from === focusedNodeId && c.fromOutput === key);
              return h('div', { className: 'fd-param-row fd-param-row-output' },
                h('div', { className: 'fd-param-body' },
                  h('label', { className: 'fd-param-label' }, field.name || key),
                  h('span', { className: 'fd-param-type' }, field.type),
                  connectedTo.length ? h('div', { className: 'fd-param-wired-list' },
                    ...connectedTo.map(c => h('div', { key: c.id, className: 'fd-param-wired' },
                      h('button', {
                        className: 'fd-card-link',
                        onclick: (e) => { e.stopPropagation(); this._fsm.navigateToNode(c.to); },
                      }, `\u2192 ${nodes.get(c.to)?.label || c.to}`),
                      c.typeMismatch ? h('span', { className: 'fd-param-mismatch', title: 'Type mismatch — connection may fail' }, '\u26a0') : null,
                      h('button', {
                        className: 'fd-param-disconnect',
                        title: 'Disconnect',
                        onclick: (e) => { e.stopPropagation(); this._disconnectConnection(c.id); },
                      }, '\u00d7'),
                    ))
                  ) : null,
                ),
                h('button', {
                  className: `fd-param-anchor${connectedTo.length ? ' fd-param-anchor-connected' : ''}`,
                  title: 'Wire output',
                  onclick: (e) => {
                    e.stopPropagation();
                    this._startConnection(focusedNodeId, key, field.type || null);
                  },
                }, anchorIcon(normalizeType(field.type))),
              );
            }),
          ) : null,
        ) : null,

        // Card 4: Actions
        h('div', { className: 'fd-card' },
          h('div', { className: 'fd-card-section' }, 'Actions'),
          h('div', { className: 'fd-card-actions' },
            h('button', {
              className: 'fd-card-btn',
              onclick: (e) => {
                e.stopPropagation();
                const node = this._engine.getNode(focusedNodeId);
                if (!node) return;
                if (node.pinned) {
                  this._engine.unpinNode(focusedNodeId);
                } else {
                  this._engine.pinNode(focusedNodeId, { ...node.position });
                }
                this.setState({});
              },
            }, isPinned ? 'Unpin' : 'Pin'),
            h('button', {
              className: 'fd-card-btn',
              onclick: (e) => {
                e.stopPropagation();
                this._fsm.zoomOut();
                const { nodes, newConnections } = this._cloneNodes([focusedNodeId]);
                this.setState({
                  nodes,
                  connections: [...this.state.connections, ...newConnections],
                });
              },
            }, 'Clone'),
            h('button', {
              className: 'fd-card-btn fd-card-btn-danger',
              onclick: (e) => {
                e.stopPropagation();
                this._fsm.zoomOut();
                setTimeout(() => this._removeNode(focusedNodeId), 100);
              },
            }, 'Delete'),
          ),
        ),
      ),

      // Periphery glows
      this._renderPeripheryGlows(),
    );
  }

  _renderPeripheryGlows() {
    const { focusedNodeId, nodes, connections } = this.state;
    if (!focusedNodeId) return null;

    const nodesWithPositions = [...nodes.values()].map(n => {
      const engineNode = this._engine.getNode(n.id);
      return {
        id: n.id,
        label: n.label,
        position: engineNode ? engineNode.position : createPosition(0, 0),
      };
    });

    const proxConns = connections.map(c => ({
      fromWindowId: c.from,
      toWindowId: c.to,
      fromOutput: 'out',
      toInput: 'in',
    }));

    const glows = computeGlows(focusedNodeId, nodesWithPositions, proxConns);

    return h('div', { className: 'fd-periphery', key: `periphery-${focusedNodeId}` },
      ...glows.map(glow => {
        const style = this._glowStyle(glow);
        const isActivated = this.state.activatedGlowId === glow.nodeId;
        return h('button', {
          key: glow.nodeId,
          className: `fd-glow fd-glow-${glow.edge}${glow.connected ? ' fd-glow-connected' : ''}${isActivated ? ' fd-glow-active' : ''}`,
          style,
          onclick: (e) => {
            e.stopPropagation();
            if (isActivated) {
              this.setState({ activatedGlowId: null });
              this._fsm.navigateToNode(glow.nodeId);
            } else {
              this.setState({ activatedGlowId: glow.nodeId });
            }
          },
          title: glow.label,
        },
          h('span', { className: 'fd-glow-label' }, glow.label),
        );
      }),
      // Up-arrow (zoom out) when periphery is activated
      this.state.activatedGlowId ? h('button', {
        className: 'fd-periphery-up',
        onclick: (e) => {
          e.stopPropagation();
          this.setState({ activatedGlowId: null });
          this._fsm.zoomOut();
        },
      }, 'Canvas') : null,
    );
  }

  _glowStyle(glow) {
    const brightness = Math.max(0.2, glow.brightness);
    const size = 40 + glow.size * 40;
    const percent = Math.max(0.05, Math.min(0.95, glow.percent)) * 100;

    const base = {
      opacity: brightness,
      '--glow-size': `${size}px`,
    };

    switch (glow.edge) {
      case 'top':
        return { ...base, left: `${percent}%`, top: '0' };
      case 'bottom':
        return { ...base, left: `${percent}%`, bottom: '0' };
      case 'left':
        return { ...base, top: `${percent}%`, left: '0' };
      case 'right':
        return { ...base, top: `${percent}%`, right: '0' };
      default:
        return base;
    }
  }

  _computeZ1Visible() {
    if (!this.state.focusedNodeId) return null;

    const nodesWithPositions = [...this.state.nodes.values()].map(n => {
      const engineNode = this._engine.getNode(n.id);
      return {
        id: n.id,
        label: n.label,
        position: engineNode ? engineNode.position : createPosition(0, 0),
      };
    });

    const proxConns = this.state.connections.map(c => ({
      fromWindowId: c.from,
      toWindowId: c.to,
      fromOutput: 'out',
      toInput: 'in',
    }));

    const neighbors = getNeighbors(this.state.focusedNodeId, nodesWithPositions, proxConns, 12);
    return new Set([this.state.focusedNodeId, ...neighbors.map(n => n.node.id)]);
  }

  _getGroupColor(groupId) {
    if (!groupId) return null;
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < groupId.length; i++) {
      hash ^= groupId.charCodeAt(i);
      hash = Math.imul(hash, 16777619); // FNV prime
    }
    const hue = ((hash >>> 0) % 360);
    return `hsla(${hue}, 70%, 50%, 0.28)`;
  }

  _renderTweaker() {
    const sections = [
      { label: 'Gestures', keys: ['friction', 'minVelocity', 'zoneBottom', 'zoneWidth'] },
      { label: 'Physics',  keys: ['repulsionStrength', 'repulsionRange', 'attractionRestLength', 'polarityStrength'] },
      { label: 'Zoom',     keys: ['scaleZ1', 'scaleZ2'] },
    ];

    return h('div', { className: `fd-tweaker ${this.state.tweakerOpen ? 'fd-tweaker--open' : ''}` },
      h('button', {
        className: 'fd-tweaker-tab',
        onclick: () => this.setState({ tweakerOpen: !this.state.tweakerOpen }),
      }, '\u2699'),
      h('div', { className: 'fd-tweaker-panel' },
        h('div', { className: 'fd-tweaker-header' }, 'Tweaker'),
        ...sections.map(({ label, keys }) =>
          h('div', { className: 'fd-tweaker-section' },
            h('div', { className: 'fd-tweaker-section-label' }, label),
            ...keys
              .filter(k => TWEAK_DEFAULTS[k].tweakable)
              .map(k => {
                const def = TWEAK_DEFAULTS[k];
                const val = this._tweaks[k];
                return h('div', { className: 'fd-tweaker-row' },
                  h('label', { className: 'fd-tweaker-label' }, def.label),
                  h('input', {
                    type: 'range',
                    className: 'fd-tweaker-slider',
                    min: def.min,
                    max: def.max,
                    step: def.step,
                    value: val,
                    oninput: (e) => this._setTweak(k, parseFloat(e.target.value)),
                  }),
                  h('span', { className: 'fd-tweaker-val' }, val.toFixed(2)),
                );
              }),
            h('button', {
              className: 'fd-tweaker-reset',
              onclick: () => {
                keys.forEach(k => this._setTweak(k, TWEAK_DEFAULTS[k].value));
              },
            }, 'Reset'),
          )
        ),
      ),
    );
  }

  _renderNodeAnchors(node) {
    const conn = this._fsm.connection;
    const isConnecting = this._fsm.isConnecting;
    const toolData = node.toolData;
    const anchors = [];

    // Input anchors (left side) — only required inputs shown in Z1/Z2
    // Optional inputs are only accessible via NODE_MODE
    const inputs = toolData?.inputSchema
      ? Object.entries(toolData.inputSchema).filter(([, f]) => f.required)
      : []; // no schema = no input anchors

    inputs.forEach(([key, field], i) => {
      const total = inputs.length;
      const topPct = total === 1 ? 50 : 20 + (i / (total - 1)) * 60;
      const isTarget = isConnecting && conn.sourceNodeId !== node.id;
      const typeMatch = isConnecting && (!conn.sourceType || !field.type || conn.sourceType === field.type);
      const cls = [
        'fd-anchor fd-anchor-input',
        isTarget && typeMatch ? 'fd-anchor--matching' : '',
        isTarget && !typeMatch ? 'fd-anchor--nonmatching' : '',
      ].filter(Boolean).join(' ');

      anchors.push(h('div', {
        key: `in-${key}`,
        className: cls,
        'data-anchor': 'input',
        'data-port': key,
        'data-type': field.type || '',
        'data-node-id': node.id,
        style: { top: `${topPct}%`, transform: 'translate(0, -50%)', left: '-11px' },
        onclick: (e) => {
          e.stopPropagation();
          if (isConnecting && isTarget) {
            this._completeConnection(node.id, key, field.type);
          }
        },
      }, anchorIcon(normalizeType(field.type))));
    });

    // Output anchors (right side)
    const outputs = toolData?.outputSchema
      ? Object.entries(toolData.outputSchema)
      : [['output', { type: null }]]; // generic fallback

    // Expand batch outputs
    const expandedOutputs = [];
    for (const [key, field] of outputs) {
      const batch = field.batch && field.batch > 1 ? field.batch : 1;
      for (let b = 0; b < batch; b++) {
        expandedOutputs.push([batch > 1 ? `${key}_${b}` : key, field, key]);
      }
    }

    expandedOutputs.forEach(([expandedKey, field, originalKey], i) => {
      const total = expandedOutputs.length;
      const topPct = total === 1 ? 50 : 20 + (i / (total - 1)) * 60;
      const isSource = isConnecting && conn.sourceNodeId === node.id && conn.sourcePort === originalKey;
      const cls = [
        'fd-anchor fd-anchor-output',
        isSource ? 'fd-anchor--active-source' : '',
      ].filter(Boolean).join(' ');

      anchors.push(h('div', {
        key: `out-${expandedKey}`,
        className: cls,
        'data-anchor': 'output',
        'data-port': originalKey,
        'data-type': field.type || '',
        'data-node-id': node.id,
        style: { top: `${topPct}%`, transform: 'translate(0, -50%)', right: '-11px', left: 'auto' },
        onclick: (e) => {
          e.stopPropagation();
          if (!isConnecting) {
            this._startConnection(node.id, originalKey, field.type || null);
          }
        },
      }, anchorIcon(normalizeType(field.type))));
    });

    return anchors;
  }

  render() {
    const { viewport, positions, nodes, connections, fsmState, focusedNodeId } = this.state;
    const transform = `translate(${this._panX}px, ${this._panY}px) scale(${viewport.scale})`;

    const energy = this._engine.getEnergy();
    const avgMs = this.getAvgStepMs();

    // Pre-compute Z1 visible set
    const z1Visible = (fsmState === STATES.CANVAS_Z1 && focusedNodeId) ? this._computeZ1Visible() : null;

    return h('div', { className: 'focus-demo', ref: el => (this._rootEl = el) },
      this._renderTweaker(),
      // HUD
      h('div', { className: 'fd-hud' },
        h('span', null, `State: ${fsmState}`),
        h('span', null, `Focus: ${focusedNodeId || '\u2014'}`),
        h('span', null, `Energy: ${energy.toFixed(2)}`),
        h('span', null, `Step: ${avgMs.toFixed(2)}ms`),
        h('span', null, `Nodes: ${nodes.size}`),
        fsmState === STATES.MULTI_SELECT ? h('span', null, `Selected: ${this._fsm.selectedNodeIds.size}`) : null,
        this._fsm.isConnecting ? h('span', null, `Connecting: ${this._fsm.connection.sourceNodeId}`) : null,
        this._clipboard ? h('span', null, `Clipboard: ${this._clipboard.nodes.length}`) : null,
      ),
      // Control panel (only on canvas states)
      (fsmState === STATES.CANVAS_Z1 || fsmState === STATES.CANVAS_Z2) ? h('div', { className: 'fd-controls' },
        h('button', { onclick: () => this._addRandomNode() }, '+ Node'),
        h('button', { onclick: () => this._addConnectedNode() }, '+ Connected'),
        h('button', { onclick: () => this._addGroupCluster() }, '+ Group'),
        h('button', { onclick: () => this._removeLastNode() }, '- Remove'),
        h('button', { onclick: () => this._togglePin() }, 'Pin Last'),
        h('button', { onclick: () => this._resetSeed() }, 'Reset'),
        h('button', { onclick: () => this._stressTest() }, 'Stress +20'),
      ) : null,
      // Canvas
      h('div', { className: 'fd-canvas', onclick: (e) => this._onCanvasClick(e) },
        h('div', { className: 'fd-viewport', style: { transform } },
          // Connections (SVG)
          h('svg', { className: 'fd-connections' },
            connections.map(c => {
              const from = positions.get(c.from);
              const to = positions.get(c.to);
              if (!from || !to) return null;
              const isRelevant = !z1Visible || (z1Visible.has(c.from) && z1Visible.has(c.to));
              const offset = Math.max(50, Math.abs(to.x - from.x) * 0.4);
              const d = `M ${from.x + NODE_WIDTH} ${from.y + NODE_HEIGHT / 2} C ${from.x + NODE_WIDTH + offset} ${from.y + NODE_HEIGHT / 2} ${to.x - offset} ${to.y + NODE_HEIGHT / 2} ${to.x} ${to.y + NODE_HEIGHT / 2}`;
              return h('path', { key: c.id, d, className: `fd-conn-path${isRelevant ? '' : ' fd-conn-dimmed'}`, 'data-type': c.dataType || '', 'data-mismatch': c.typeMismatch ? 'true' : undefined });
            }),
          ),
          // Nodes
          ...([...nodes.values()].map(node => {
            const pos = positions.get(node.id);
            if (!pos) return null;
            const engineNode = this._engine.getNode(node.id);
            const isPinned = engineNode && engineNode.pinned;
            const groupColor = this._getGroupColor(node.group);
            const isDimmed = z1Visible && !z1Visible.has(node.id);
            const isConnSource = this._fsm.isConnecting && node.id === this._fsm.connection.sourceNodeId;
            const isConnTarget = this._fsm.isConnecting && node.id !== this._fsm.connection.sourceNodeId;
            const isSelected = fsmState === STATES.MULTI_SELECT && this._fsm.selectedNodeIds.has(node.id);
            return h('div', {
              key: node.id,
              className: [
                'fd-node',
                node.group      ? 'fd-grouped'      : '',
                isPinned        ? 'fd-pinned'        : '',
                node.id === focusedNodeId ? 'fd-focused' : '',
                isDimmed        ? 'fd-dimmed'        : '',
                isConnSource    ? 'fd-conn-source'   : '',
                isConnTarget    ? 'fd-conn-target'   : '',
                isSelected      ? 'fd-selected'      : '',
                node.executing  ? 'fd-node--running' : '',
                node.error && !node.censored ? 'fd-node--error' : '',
                node.censored   ? 'fd-node--censored': '',
                node.output && !node.executing ? 'fd-node--has-result' : '',
              ].filter(Boolean).join(' '),
              'data-node-id': node.id,
              style: {
                transform: `translate(${pos.x}px, ${pos.y}px)`,
                borderColor: groupColor || undefined,
              },
              onclick: (e) => this._onNodeClick(node.id, e),
              ondblclick: (e) => this._onNodeDoubleClick(node.id, e),
            },
              h('div', { className: 'fd-node-label' }, node.label),
              h('div', { className: 'fd-node-meta' },
                node.group ? h('span', { className: 'fd-group-tag', style: { background: groupColor } }, node.group.slice(0, 12)) : null,
                isPinned ? h('span', { className: 'fd-pin-tag' }, 'pinned') : null,
              ),
              node.type ? h('div', { className: 'fd-node-type' }, node.type) : null,
              ...this._renderNodeAnchors(node),
              // Running: progress bar
              node.executing
                ? h('div', { className: 'fd-node-progress' },
                    h('div', { className: 'fd-node-progress-bar' })
                  )
                : null,
              // Error / censored indicator
              node.error
                ? h('div', { className: `fd-node-status${node.censored ? ' fd-node-status--censored' : ' fd-node-status--error'}` },
                    node.censored ? '\u2298 censored' : '\u26a0 error'
                  )
                : null,
            );
          })),
        ),
      ),
      // Connection seeking badge
      this._fsm.isConnecting ? (() => {
        const conn = this._fsm.connection;
        const sourceNode = this.state.nodes.get(conn.sourceNodeId);
        const sourceLabel = sourceNode?.label || conn.sourceNodeId;
        return h('div', { className: 'fd-conn-badge' },
          h('span', { className: 'fd-conn-badge-dot', style: { background: conn.sourceType === 'image' ? '#9382ff' : conn.sourceType === 'video' ? '#ffa064' : '#64c8b4' } }),
          h('span', { className: 'fd-conn-badge-label' }, `${sourceLabel}`),
          conn.sourcePort !== 'output' ? h('span', { className: 'fd-conn-badge-port' }, `\u2192 ${conn.sourcePort}`) : null,
          h('button', {
            className: 'fd-conn-badge-cancel',
            onclick: (e) => { e.stopPropagation(); this._cancelConnection(); },
          }, '\u2715'),
        );
      })() : null,
      // Multi-select action bar
      fsmState === STATES.MULTI_SELECT ? this._renderActionBar() : null,
      // Node Mode overlay
      fsmState === STATES.NODE_MODE ? this._renderNodeMode() : null,
    );
  }
}
