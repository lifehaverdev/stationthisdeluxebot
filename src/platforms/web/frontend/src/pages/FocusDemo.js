import { Component, h } from '@monygroupcorp/microact';
import { PhysicsEngine } from '../sandbox/focus/physics/PhysicsEngine.js';
import { createPosition } from '../sandbox/focus/spatial/SphericalGrid.js';
import { FocusStateMachine, STATES } from '../sandbox/focus/state/FocusStateMachine.js';
import { computeGlows } from '../sandbox/focus/state/PeripheryGlows.js';
import { getNeighbors } from '../sandbox/focus/spatial/Proximity.js';
import '../style/focus-demo.css';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

const ZOOM_LEVELS = {
  CANVAS_Z2: 0.45,
  CANVAS_Z1: 1.0,
};

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
    document.removeEventListener('keydown', this._boundKeyDown);
    window.focusDemo = null;
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
      update.viewport = { ...this.state.viewport, scale: ZOOM_LEVELS.CANVAS_Z2 };
    } else if (to === STATES.CANVAS_Z1 && nodeId) {
      const pos = this.state.positions.get(nodeId);
      if (pos) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        update.viewport = {
          scale: ZOOM_LEVELS.CANVAS_Z1,
          panX: cx - pos.x * ZOOM_LEVELS.CANVAS_Z1,
          panY: cy - pos.y * ZOOM_LEVELS.CANVAS_Z1,
        };
      } else {
        update.viewport = { ...this.state.viewport, scale: ZOOM_LEVELS.CANVAS_Z1 };
      }
    }

    if (to === STATES.CONNECTION_MODE) {
      const pos = this.state.positions.get(nodeId);
      if (pos) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        update.viewport = {
          scale: ZOOM_LEVELS.CANVAS_Z1,
          panX: cx - pos.x * ZOOM_LEVELS.CANVAS_Z1,
          panY: cy - pos.y * ZOOM_LEVELS.CANVAS_Z1,
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
    if (e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0];
      this._gestureStart = { x: t.clientX, y: t.clientY, time: performance.now(), target: e.target };
      // Set up pan tracking for canvas modes (not NODE_MODE)
      if (this.state.fsmState !== STATES.NODE_MODE) {
        this._panStart = { x: t.clientX - this.state.viewport.panX, y: t.clientY - this.state.viewport.panY };
      }
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
    // In NODE_MODE: track movement for swipe detection but don't pan
    if (this.state.fsmState === STATES.NODE_MODE) {
      if (e.touches.length === 1) e.preventDefault();
      return;
    }
    if (e.touches.length === 1 && this._panStart) {
      e.preventDefault();
      const t = e.touches[0];
      this.setState({
        viewport: {
          ...this.state.viewport,
          panX: t.clientX - this._panStart.x,
          panY: t.clientY - this._panStart.y,
        },
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
      this._gestureStart = null;
      this._clearTapTimeout();
      if (dy > 0) {
        // Swipe down → zoom out / cancel
        if (this.state.fsmState === STATES.CONNECTION_MODE) {
          this._fsm.cancelConnection();
        } else if (this.state.fsmState === STATES.MULTI_SELECT) {
          this._fsm.exitMultiSelect();
        } else {
          this._fsm.zoomOut();
        }
      } else {
        // Swipe up → zoom in (enter node mode if Z1 + focused node)
        if (this.state.fsmState === STATES.CANVAS_Z1 && this.state.focusedNodeId) {
          this._fsm.tapNode(this.state.focusedNodeId);
        }
      }
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
      { id: 'n1', label: 'Text Prompt', x: 0, y: 0, group: 'spell1' },
      { id: 'n2', label: 'Image Gen', x: 300, y: 0, group: 'spell1' },
      { id: 'n3', label: 'Upscaler', x: 600, y: 0, group: 'spell1' },
      { id: 'n4', label: 'Style Transfer', x: 300, y: 200, group: 'spell1' },
      { id: 'n5', label: 'Loose Node A', x: -200, y: 300 },
      { id: 'n6', label: 'Loose Node B', x: -100, y: 400 },
      { id: 'n7', label: 'LLM Chat', x: 100, y: -300, group: 'spell2' },
      { id: 'n8', label: 'Summarizer', x: 400, y: -300, group: 'spell2' },
    ];

    const connections = [
      { id: 'c1', from: 'n1', to: 'n2' },
      { id: 'c2', from: 'n2', to: 'n3' },
      { id: 'c3', from: 'n2', to: 'n4' },
      { id: 'c4', from: 'n7', to: 'n8' },
    ];

    const nodeMap = new Map();
    for (const n of seed) {
      this._engine.addNode(n.id, createPosition(n.x, n.y));
      if (n.group) this._engine.setGroup(n.id, n.group);
      nodeMap.set(n.id, { id: n.id, label: n.label, group: n.group || null });
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
      const positions = this._engine.step(dt);
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
    nodes.set(id, { id, label: 'New Node', group: null });
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
    nodes.set(id, { id, label: 'Connected', group: null });
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
      nodes.set(id, { id, label: `Group ${i}`, group: groupId });

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
      nodes.set(id, { id, label: `S${existingIds.length + i}`, group: null });

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
      nodes.set(newId, { id: newId, label: sourceNode.label, group: sourceNode.group });
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
    const { nodes, newConnections } = this._cloneNodes(ids);
    const connections = [...this.state.connections, ...newConnections];
    this._fsm.exitMultiSelect();
    this.setState({ nodes, connections });
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
      nodes.set(newId, { id: newId, label: cn.label, group: cn.group });
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
        // Card 1: Header
        h('div', { className: 'fd-card' },
          h('div', { className: 'fd-card-title' }, node.label),
          h('div', { className: 'fd-card-meta' },
            h('span', null, node.id),
            node.group ? h('span', { className: 'fd-group-tag', style: { background: this._getGroupColor(node.group) } }, node.group) : null,
            isPinned ? h('span', { className: 'fd-pin-tag' }, 'pinned') : null,
          ),
        ),

        // Card 2: Connections
        (inputConns.length || outputConns.length) ? h('div', { className: 'fd-card' },
          h('div', { className: 'fd-card-section' }, 'Connections'),
          inputConns.length ? h('div', { className: 'fd-card-row' },
            h('span', { className: 'fd-card-label' }, 'Inputs'),
            ...inputConns.map(c => {
              const fromNode = nodes.get(c.from);
              return h('button', {
                className: 'fd-card-link',
                onclick: (e) => { e.stopPropagation(); this._fsm.navigateToNode(c.from); },
              }, fromNode ? fromNode.label : c.from);
            }),
          ) : null,
          outputConns.length ? h('div', { className: 'fd-card-row' },
            h('span', { className: 'fd-card-label' }, 'Outputs'),
            ...outputConns.map(c => {
              const toNode = nodes.get(c.to);
              return h('button', {
                className: 'fd-card-link',
                onclick: (e) => { e.stopPropagation(); this._fsm.navigateToNode(c.to); },
              }, toNode ? toNode.label : c.to);
            }),
          ) : null,
        ) : null,

        // Card 3: Position
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
              onclick: (e) => { e.stopPropagation(); this._togglePin(); },
            }, isPinned ? 'Unpin' : 'Pin'),
            h('button', {
              className: 'fd-card-btn',
              onclick: (e) => { e.stopPropagation(); this._startConnection(focusedNodeId); },
            }, 'Connect'),
            h('button', {
              className: 'fd-card-btn',
              onclick: (e) => {
                e.stopPropagation();
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
    let hash = 0;
    for (let i = 0; i < groupId.length; i++) hash = groupId.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `hsla(${hue}, 70%, 50%, 0.28)`;
  }

  render() {
    const { viewport, positions, nodes, connections, fsmState, focusedNodeId } = this.state;
    const transform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.scale})`;

    const energy = this._engine.getEnergy();
    const avgMs = this.getAvgStepMs();

    // Pre-compute Z1 visible set
    const z1Visible = (fsmState === STATES.CANVAS_Z1 && focusedNodeId) ? this._computeZ1Visible() : null;

    return h('div', { className: 'focus-demo', ref: el => (this._rootEl = el) },
      // HUD
      h('div', { className: 'fd-hud' },
        h('span', null, `State: ${fsmState}`),
        h('span', null, `Focus: ${focusedNodeId || '\u2014'}`),
        h('span', null, `Energy: ${energy.toFixed(2)}`),
        h('span', null, `Step: ${avgMs.toFixed(2)}ms`),
        h('span', null, `Nodes: ${nodes.size}`),
      ),
      // Control panel (hidden in Node Mode)
      fsmState !== STATES.NODE_MODE ? h('div', { className: 'fd-controls' },
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
              return h('path', { key: c.id, d, className: `fd-conn-path${isRelevant ? '' : ' fd-conn-dimmed'}` });
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
                node.group ? h('span', { className: 'fd-group-tag', style: { background: groupColor } }, node.group.slice(0, 8)) : null,
                isPinned ? h('span', { className: 'fd-pin-tag' }, 'pinned') : null,
              ),
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
