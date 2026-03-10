import { Component, h } from '@monygroupcorp/microact';
import { PhysicsEngine } from '../sandbox/focus/physics/PhysicsEngine.js';
import { createPosition } from '../sandbox/focus/spatial/SphericalGrid.js';
import { FocusStateMachine, STATES } from '../sandbox/focus/state/FocusStateMachine.js';
import { computeGlows } from '../sandbox/focus/state/PeripheryGlows.js';
import { getNeighbors } from '../sandbox/focus/spatial/Proximity.js';
import '../style/focus-demo.css';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 90;

const ZOOM_LEVELS = {
  CANVAS_Z2: 0.45,
  CANVAS_Z1: 1.0,
};

const TWEAK_DEFAULTS = {
  // Gestures
  friction:             { value: 0.97,  min: 0.80, max: 0.99,  step: 0.01, label: 'Momentum friction',           tweakable: true },
  minVelocity:          { value: 0.5,   min: 0.1,  max: 3.0,   step: 0.1,  label: 'Min velocity (px/ms)',        tweakable: true },
  zoneBottom:           { value: 0.15,  min: 0.05, max: 0.40,  step: 0.01, label: 'Zoom zone bottom %',          tweakable: true },
  zoneWidth:            { value: 0.30,  min: 0.10, max: 0.80,  step: 0.01, label: 'Zoom zone width %',           tweakable: true },
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
      connectionPickerNodeId: null,
      tweakerOpen: false,
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
    this._momentum = { vx: 0, vy: 0, rafId: null, gen: 0 };
    this._velBuffer = []; // ring buffer: [{dx, dy, dt}] last 3 frames
    this._momentumPanX = null; // mutable live pan during momentum (null = not active)
    this._momentumPanY = null;

    this._fsm.onChange((from, to, nodeId) => {
      this._onStateChange(from, to, nodeId);
    });
  }

  didMount() {
    this._seedDemo();
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
    if (this._momentum.rafId) cancelAnimationFrame(this._momentum.rafId);
    document.removeEventListener('keydown', this._boundKeyDown);
    window.focusDemo = null;
  }

  _setTweak(key, val) {
    this._tweaks[key] = val;
    this.setState({});
  }

  _startMomentum() {
    if (this._momentum.rafId) cancelAnimationFrame(this._momentum.rafId);
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

    const vxMs = totalDt > 0 ? sumDx / totalDt : 0;
    const vyMs = totalDt > 0 ? sumDy / totalDt : 0;
    if (Math.hypot(vxMs, vyMs) < this._tweaks.minVelocity) return;

    this._momentum.vx = vxMs;
    this._momentum.vy = vyMs;
    const gen = ++this._momentum.gen;

    // Seed live pan from current state — these mutable vars are read by render()
    // instead of state.viewport so no setState is needed during the tick loop.
    this._momentumPanX = this.state.viewport.panX;
    this._momentumPanY = this.state.viewport.panY;

    let lastTs = performance.now();
    const tick = (ts) => {
      if (this._momentum.gen !== gen) return; // killed externally
      const elapsed = Math.min(ts - lastTs, 64);
      lastTs = ts;
      const decay = Math.pow(this._tweaks.friction, elapsed / 16.67);
      this._momentum.vx *= decay;
      this._momentum.vy *= decay;
      if (Math.hypot(this._momentum.vx, this._momentum.vy) < 0.01) {
        // Natural stop: sync mutable vars back into state
        this.setState({
          viewport: { ...this.state.viewport, panX: this._momentumPanX, panY: this._momentumPanY },
        });
        this._momentumPanX = null;
        this._momentumPanY = null;
        this._momentum.rafId = null;
        return;
      }
      // Update mutable vars — the physics loop's setState re-renders every frame,
      // so render() will pick these up without us needing to call setState here.
      this._momentumPanX += this._momentum.vx * elapsed;
      this._momentumPanY += this._momentum.vy * elapsed;
      this._momentum.rafId = requestAnimationFrame(tick);
    };
    this._momentum.rafId = requestAnimationFrame(tick);
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
      if (this.state.fsmState === STATES.CONNECTION_MODE) {
        this._fsm.cancelConnection();
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

    if (to === STATES.CONNECTION_MODE) {
      const pos = this.state.positions.get(nodeId);
      if (pos) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        update.viewport = {
          scale: this._tweaks.scaleZ1,
          panX: cx - pos.x * this._tweaks.scaleZ1,
          panY: cy - pos.y * this._tweaks.scaleZ1,
        };
      }
      update.connectionPickerNodeId = null;
    }

    this.setState(update);
  }

  _onNodeClick(nodeId, e) {
    e.stopPropagation();
    if (this.state.fsmState === STATES.CONNECTION_MODE) {
      if (nodeId === this._fsm.sourceNodeId) return;
      this.setState({ connectionPickerNodeId: nodeId });
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
      if (this.state.fsmState === STATES.CONNECTION_MODE) {
        if (this.state.connectionPickerNodeId) {
          this.setState({ connectionPickerNodeId: null });
        } else {
          this._fsm.cancelConnection();
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
    this._panStart = { x: e.clientX - this.state.viewport.panX, y: e.clientY - this.state.viewport.panY };
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
      this.setState({
        viewport: {
          ...this.state.viewport,
          panX: ev.clientX - this._panStart.x,
          panY: ev.clientY - this._panStart.y,
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
    if (this._momentum.rafId) {
      this._momentum.gen++; // invalidate tick closure
      cancelAnimationFrame(this._momentum.rafId);
      this._momentum.rafId = null;
      this._momentum.vx = 0;
      this._momentum.vy = 0;
      this._velBuffer = [];
      this._momentumKilled = true;
      // Sync the live pan position into state so future renders use the stopped position.
      // No pending setState from the tick can race here — tick never calls setState.
      if (this._momentumPanX !== null) {
        this.setState({
          viewport: { ...this.state.viewport, panX: this._momentumPanX, panY: this._momentumPanY },
        });
        this._momentumPanX = null;
        this._momentumPanY = null;
      }
      e.preventDefault();
      return; // consume the touch — do nothing else
    }
    this._momentumKilled = false;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this._gestureStart = { x: t.clientX, y: t.clientY, time: performance.now(), target: e.target };

      if (this.state.fsmState === STATES.NODE_MODE) {
        // Don't preventDefault — allow native clicks and card scrolling
        return;
      }

      // Don't preventDefault on tweaker UI — allow button clicks and sliders
      if (e.target.closest && e.target.closest('.fd-tweaker')) {
        return;
      }

      e.preventDefault();
      // Set up pan tracking for canvas modes
      this._panStart = { x: t.clientX - this.state.viewport.panX, y: t.clientY - this.state.viewport.panY };
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
        panX: this.state.viewport.panX,
        panY: this.state.viewport.panY,
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
      const prevVp = this.state.viewport;
      const dx = newPanX - prevVp.panX;
      const dy = newPanY - prevVp.panY;
      const dt = now - (this._lastMoveTime || now);
      this._lastMoveTime = now;

      if (dt > 0) {
        this._velBuffer.push({ dx, dy, dt });
        if (this._velBuffer.length > 3) this._velBuffer.shift();
      }

      this.setState({
        viewport: { ...this.state.viewport, panX: newPanX, panY: newPanY },
      });
    } else if (e.touches.length === 2 && this._pinchStart) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const ratio = dist / this._pinchStart.dist;
      const newScale = Math.max(0.15, Math.min(4.0, this._pinchStart.scale * ratio));
      const scaleRatio = newScale / this._pinchStart.scale;
      this.setState({
        viewport: {
          panX: this._pinchStart.midX - (this._pinchStart.midX - this._pinchStart.panX) * scaleRatio,
          panY: this._pinchStart.midY - (this._pinchStart.midY - this._pinchStart.panY) * scaleRatio,
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
      if (this._isInZoomZone(startX, startY)) {
        if (dy > 0) {
          // Swipe down from zone → zoom out / cancel
          if (this.state.fsmState === STATES.CONNECTION_MODE) {
            this._fsm.cancelConnection();
          } else if (this.state.fsmState === STATES.MULTI_SELECT) {
            this._fsm.exitMultiSelect();
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
        if (anchorType === 'output' && anchorNodeId) {
          this._startConnection(anchorNodeId);
        }
        this._gestureStart = null;
        return;
      }

      // Connection mode: tap node to show picker, tap empty to cancel
      if (this.state.fsmState === STATES.CONNECTION_MODE) {
        if (nodeId && nodeId !== this._fsm.sourceNodeId) {
          this.setState({ connectionPickerNodeId: nodeId });
        } else if (!nodeId) {
          if (this.state.connectionPickerNodeId) {
            this.setState({ connectionPickerNodeId: null });
          } else {
            this._fsm.cancelConnection();
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
          if (this.state.fsmState === STATES.CANVAS_Z1) {
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

  _seedDemo() {
    const seed = [
      // Spell 1: Portrait Generator
      { id: 'chatgpt',    label: 'ChatGPT',      type: 'text-to-text',  group: 'portrait-gen', x: 0,    y: 0,
        params: { prompt: 'A cinematic portrait of a cyberpunk woman...', instructions: 'You refine image prompts for maximum detail', temperature: 0.7 } },
      { id: 'flux-gen',   label: 'Flux Gen',      type: 'text-to-image', group: 'portrait-gen', x: 300,  y: 0,
        params: { width: 1024, height: 1024, steps: 4, baseModel: 'flux-schnell' } },
      { id: 'joycaption', label: 'JoyCaption',    type: 'image-to-text', group: 'portrait-gen', x: 600,  y: 0 },
      { id: 'upscaler',   label: 'Upscaler 4\u00D7', type: 'img2img',   group: 'portrait-gen', x: 600,  y: 200 },

      // Spell 2: Video from Still
      { id: 'static-img', label: 'Static Image',  type: 'upload',        group: 'vid-from-still', x: 100,  y: -300 },
      { id: 'ltx-video',  label: 'LTX Video',     type: 'video',         group: 'vid-from-still', x: 400,  y: -300,
        params: { frames: 97, fps: 24, width: 768, height: 512 } },

      // Loose experimentation nodes
      { id: 'dalle3',     label: 'DALL\u00B7E 3',  type: 'text-to-image', x: -200, y: 300 },
      { id: 'qwen',       label: 'Qwen Layered',   type: 'text-to-text',  x: -100, y: 450 },
    ];

    const connections = [
      // Portrait Generator pipeline
      { id: 'c1', from: 'chatgpt',    to: 'flux-gen',   fromOutput: 'response',  toInput: 'prompt',   dataType: 'text' },
      { id: 'c2', from: 'flux-gen',   to: 'joycaption', fromOutput: 'image',     toInput: 'imageUrl', dataType: 'image' },
      { id: 'c3', from: 'flux-gen',   to: 'upscaler',   fromOutput: 'image',     toInput: 'imageUrl', dataType: 'image' },
      // Video from Still pipeline
      { id: 'c4', from: 'static-img', to: 'ltx-video',  fromOutput: 'imageUrl',  toInput: 'imageUrl', dataType: 'image' },
    ];

    const nodeMap = new Map();
    for (const n of seed) {
      this._engine.addNode(n.id, createPosition(n.x, n.y));
      if (n.group) this._engine.setGroup(n.id, n.group);
      nodeMap.set(n.id, { id: n.id, label: n.label, type: n.type || null, group: n.group || null, params: n.params || null });
    }

    for (const c of connections) {
      this._engine.addConnection(c.id, c.from, c.to);
    }

    this.setState({
      nodes: nodeMap,
      connections,
    });
  }

  _startSimulation() {
    let lastTime = performance.now();

    const tick = (now) => {
      const dt = Math.min(now - lastTime, 32);
      lastTime = now;

      const t0 = performance.now();
      const positions = this._engine.step(dt, this._tweaks);
      const stepMs = performance.now() - t0;

      this._perfSamples.push(stepMs);
      if (this._perfSamples.length > 120) this._perfSamples.shift();

      this.setState({ positions });
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

  _completeConnection(targetNodeId, anchorName) {
    const sourceId = this._fsm.sourceNodeId;
    if (!sourceId || sourceId === targetNodeId) return;
    const connId = 'c' + Date.now();
    this._engine.addConnection(connId, sourceId, targetNodeId);
    const connections = [...this.state.connections, { id: connId, from: sourceId, to: targetNodeId }];
    this.setState({ connections, connectionPickerNodeId: null });
    this._fsm.completeConnection();
  }

  _startConnection(sourceNodeId) {
    if (this.state.fsmState !== STATES.NODE_MODE) {
      this._fsm.doubleTapNode(sourceNodeId);
    }
    this._fsm.enterConnectionMode(sourceNodeId);
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
        // Card 1: Header with anchors
        h('div', { className: 'fd-card fd-card-header' },
          h('div', {
            className: 'fd-anchor fd-anchor-input fd-anchor-nodemode',
            onclick: (e) => e.stopPropagation(),
          }, h('span', { className: 'fd-anchor-icon' })),
          h('div', {
            className: 'fd-anchor fd-anchor-output fd-anchor-nodemode',
            onclick: (e) => {
              e.stopPropagation();
              this._startConnection(focusedNodeId);
            },
          }, h('span', { className: 'fd-anchor-icon' })),
          h('div', { className: 'fd-card-title' }, node.label),
          h('div', { className: 'fd-card-meta' },
            h('span', null, node.id),
            node.group ? h('span', { className: 'fd-group-tag', style: { background: this._getGroupColor(node.group) } }, node.group) : null,
            isPinned ? h('span', { className: 'fd-pin-tag' }, 'pinned') : null,
          ),
          node.type ? h('div', { className: 'fd-card-type-badge' }, node.type) : null,
        ),

        // Card 2: Connections
        (inputConns.length || outputConns.length) ? h('div', { className: 'fd-card' },
          h('div', { className: 'fd-card-section' }, 'Connections'),
          inputConns.length ? h('div', { className: 'fd-card-row' },
            h('span', { className: 'fd-card-label' }, 'Inputs'),
            ...inputConns.map(c => {
              const fromNode = nodes.get(c.from);
              const label = fromNode ? fromNode.label : c.from;
              const detail = c.toInput ? `\u2192 ${c.toInput}` : '';
              const typeTag = c.dataType || '';
              return h('div', { className: 'fd-card-conn' },
                h('button', {
                  className: 'fd-card-link',
                  onclick: (e) => { e.stopPropagation(); this._fsm.navigateToNode(c.from); },
                }, label),
                detail ? h('span', { className: 'fd-card-conn-param' }, detail) : null,
                typeTag ? h('span', { className: 'fd-card-conn-type' }, typeTag) : null,
              );
            }),
          ) : null,
          outputConns.length ? h('div', { className: 'fd-card-row' },
            h('span', { className: 'fd-card-label' }, 'Outputs'),
            ...outputConns.map(c => {
              const toNode = nodes.get(c.to);
              const label = toNode ? toNode.label : c.to;
              const detail = c.fromOutput ? `${c.fromOutput} \u2192` : '';
              const typeTag = c.dataType || '';
              return h('div', { className: 'fd-card-conn' },
                h('button', {
                  className: 'fd-card-link',
                  onclick: (e) => { e.stopPropagation(); this._fsm.navigateToNode(c.to); },
                }, label),
                detail ? h('span', { className: 'fd-card-conn-param' }, detail) : null,
                typeTag ? h('span', { className: 'fd-card-conn-type' }, typeTag) : null,
              );
            }),
          ) : null,
        ) : null,

        // Card 3: Parameters (only if node has params)
        node.params ? h('div', { className: 'fd-card' },
          h('div', { className: 'fd-card-section' }, 'Parameters'),
          ...Object.entries(node.params).map(([key, val]) =>
            h('div', { className: 'fd-card-param' },
              h('span', { className: 'fd-card-param-key' }, key),
              h('span', { className: 'fd-card-param-val' }, String(val)),
            ),
          ),
        ) : null,

        // Card 4: Position
        h('div', { className: 'fd-card' },
          h('div', { className: 'fd-card-section' }, 'Position'),
          engineNode ? h('div', { className: 'fd-card-mono' },
            `x: ${engineNode.position.x.toFixed(1)}  y: ${engineNode.position.y.toFixed(1)}  z: ${engineNode.position.z}`,
          ) : null,
        ),

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
              onclick: (e) => { e.stopPropagation(); this._startConnection(focusedNodeId); },
            }, 'Connect'),
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

    return h('div', { className: 'fd-periphery' },
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
          isActivated ? h('span', { className: 'fd-glow-info' },
            glow.connected ? 'connected' : 'nearby',
          ) : null,
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

  render() {
    const { viewport, positions, nodes, connections, fsmState, focusedNodeId } = this.state;
    // During momentum, read from mutable live vars (no setState in tick loop = no async race)
    const panX = this._momentumPanX !== null ? this._momentumPanX : viewport.panX;
    const panY = this._momentumPanY !== null ? this._momentumPanY : viewport.panY;
    const transform = `translate(${panX}px, ${panY}px) scale(${viewport.scale})`;

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
        fsmState === STATES.CONNECTION_MODE ? h('span', null, `Source: ${this._fsm.sourceNodeId}`) : null,
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
              return h('path', { key: c.id, d, className: `fd-conn-path${isRelevant ? '' : ' fd-conn-dimmed'}`, 'data-type': c.dataType || '' });
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
            const isConnSource = fsmState === STATES.CONNECTION_MODE && node.id === this._fsm.sourceNodeId;
            const isConnTarget = fsmState === STATES.CONNECTION_MODE && node.id !== this._fsm.sourceNodeId;
            const isSelected = fsmState === STATES.MULTI_SELECT && this._fsm.selectedNodeIds.has(node.id);
            return h('div', {
              key: node.id,
              className: `fd-node${node.group ? ' fd-grouped' : ''}${isPinned ? ' fd-pinned' : ''}${node.id === focusedNodeId ? ' fd-focused' : ''}${isDimmed ? ' fd-dimmed' : ''}${isConnSource ? ' fd-conn-source' : ''}${isConnTarget ? ' fd-conn-target' : ''}${isSelected ? ' fd-selected' : ''}`,
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
              h('div', {
                className: 'fd-anchor fd-anchor-input',
                'data-anchor': 'input',
                'data-node-id': node.id,
                onclick: (e) => e.stopPropagation(),
              }, h('span', { className: 'fd-anchor-icon' })),
              h('div', {
                className: 'fd-anchor fd-anchor-output',
                'data-anchor': 'output',
                'data-node-id': node.id,
                onclick: (e) => {
                  e.stopPropagation();
                  if (this.state.fsmState === STATES.NODE_MODE || this.state.fsmState === STATES.CANVAS_Z1 || this.state.fsmState === STATES.CANVAS_Z2) {
                    this._startConnection(node.id);
                  }
                },
              }, h('span', { className: 'fd-anchor-icon' })),
              // Anchor picker (shown when this node is picked as target in connection mode)
              (this.state.connectionPickerNodeId === node.id) ? h('div', { className: 'fd-anchor-picker' },
                h('button', {
                  className: 'fd-anchor-pill',
                  onclick: (e) => { e.stopPropagation(); this._completeConnection(node.id, 'input'); },
                }, '\u2190 Input'),
              ) : null,
            );
          })),
        ),
      ),
      // Connection hint banner
      fsmState === STATES.CONNECTION_MODE ? h('div', { className: 'fd-conn-hint' },
        `Connecting from ${this._fsm.sourceNodeId} \u2014 tap a target node`,
      ) : null,
      // Multi-select action bar
      fsmState === STATES.MULTI_SELECT ? this._renderActionBar() : null,
      // Node Mode overlay
      fsmState === STATES.NODE_MODE ? this._renderNodeMode() : null,
    );
  }
}
