import { Component, h } from '@monygroupcorp/microact';
import { PhysicsEngine } from '../sandbox/focus/physics/PhysicsEngine.js';
import { createPosition } from '../sandbox/focus/spatial/SphericalGrid.js';
import '../style/focus-demo.css';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

export class FocusDemo extends Component {
  constructor(props) {
    super(props);
    this.state = {
      viewport: { panX: 0, panY: 0, scale: 1 },
      positions: new Map(),
      nodes: new Map(),
      connections: [],
    };
    this._engine = new PhysicsEngine();
    this._rafId = null;
    this._rootEl = null;
    this._perfSamples = [];
  }

  didMount() {
    this._seedDemo();
    this._startSimulation();
    window.focusDemo = this;

    // Bind interaction handlers
    this._rootEl.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    this._rootEl.addEventListener('mousedown', this._onMouseDown.bind(this));
    this._rootEl.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
    this._rootEl.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: false });
    this._rootEl.addEventListener('touchend', this._onTouchEnd.bind(this));
  }

  willUnmount() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    window.focusDemo = null;
  }

  _onWheel(e) {
    e.preventDefault();
    const { panX, panY, scale } = this.state.viewport;
    const zoomFactor = 1.05;
    const delta = e.deltaY > 0 ? 1 / zoomFactor : zoomFactor;
    const newScale = Math.max(0.15, Math.min(4.0, scale * delta));
    const ratio = newScale / scale;
    this.setState({
      viewport: {
        panX: e.clientX - (e.clientX - panX) * ratio,
        panY: e.clientY - (e.clientY - panY) * ratio,
        scale: newScale,
      },
    });
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    this._panStart = { x: e.clientX - this.state.viewport.panX, y: e.clientY - this.state.viewport.panY };
    const onMove = (ev) => {
      this.setState({
        viewport: {
          ...this.state.viewport,
          panX: ev.clientX - this._panStart.x,
          panY: ev.clientY - this._panStart.y,
        },
      });
    };
    const onUp = () => {
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
      this._panStart = { x: t.clientX - this.state.viewport.panX, y: t.clientY - this.state.viewport.panY };
    } else if (e.touches.length === 2) {
      e.preventDefault();
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

  _onTouchEnd() {
    this._panStart = null;
    this._pinchStart = null;
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

  _getGroupColor(groupId) {
    if (!groupId) return null;
    let hash = 0;
    for (let i = 0; i < groupId.length; i++) hash = groupId.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `hsla(${hue}, 70%, 50%, 0.28)`;
  }

  render() {
    const { viewport, positions, nodes, connections } = this.state;
    const transform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.scale})`;

    const energy = this._engine.getEnergy();
    const avgMs = this.getAvgStepMs();

    return h('div', { className: 'focus-demo', ref: el => (this._rootEl = el) },
      // Perf HUD
      h('div', { className: 'fd-hud' },
        h('span', null, `Energy: ${energy.toFixed(2)}`),
        h('span', null, `Step: ${avgMs.toFixed(2)}ms`),
        h('span', null, `Nodes: ${nodes.size}`),
      ),
      // Control panel
      h('div', { className: 'fd-controls' },
        h('button', { onclick: () => this._addRandomNode() }, '+ Node'),
        h('button', { onclick: () => this._addConnectedNode() }, '+ Connected'),
        h('button', { onclick: () => this._addGroupCluster() }, '+ Group'),
        h('button', { onclick: () => this._removeLastNode() }, '- Remove'),
        h('button', { onclick: () => this._togglePin() }, 'Pin Last'),
        h('button', { onclick: () => this._resetSeed() }, 'Reset'),
        h('button', { onclick: () => this._stressTest() }, 'Stress +20'),
      ),
      // Canvas
      h('div', { className: 'fd-canvas' },
        h('div', { className: 'fd-viewport', style: { transform } },
          // Connections (SVG)
          h('svg', { className: 'fd-connections' },
            connections.map(c => {
              const from = positions.get(c.from);
              const to = positions.get(c.to);
              if (!from || !to) return null;
              const offset = Math.max(50, Math.abs(to.x - from.x) * 0.4);
              const d = `M ${from.x + NODE_WIDTH} ${from.y + NODE_HEIGHT / 2} C ${from.x + NODE_WIDTH + offset} ${from.y + NODE_HEIGHT / 2} ${to.x - offset} ${to.y + NODE_HEIGHT / 2} ${to.x} ${to.y + NODE_HEIGHT / 2}`;
              return h('path', { key: c.id, d, className: 'fd-conn-path' });
            }),
          ),
          // Nodes
          ...([...nodes.values()].map(node => {
            const pos = positions.get(node.id);
            if (!pos) return null;
            const engineNode = this._engine.getNode(node.id);
            const isPinned = engineNode && engineNode.pinned;
            const groupColor = this._getGroupColor(node.group);
            return h('div', {
              key: node.id,
              className: `fd-node${node.group ? ' fd-grouped' : ''}${isPinned ? ' fd-pinned' : ''}`,
              style: {
                transform: `translate(${pos.x}px, ${pos.y}px)`,
                borderColor: groupColor || undefined,
              },
            },
              h('div', { className: 'fd-node-label' }, node.label),
              h('div', { className: 'fd-node-meta' },
                node.group ? h('span', { className: 'fd-group-tag', style: { background: groupColor } }, node.group.slice(0, 8)) : null,
                isPinned ? h('span', { className: 'fd-pin-tag' }, 'pinned') : null,
              ),
            );
          })),
        ),
      ),
    );
  }
}
