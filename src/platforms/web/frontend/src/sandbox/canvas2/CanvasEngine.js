import { PhysicsEngine } from '../focus/physics/PhysicsEngine.js';
import { FocusStateMachine } from '../focus/state/FocusStateMachine.js';

export class CanvasEngine {
  constructor() {
    this.windows = new Map();
    this.connections = new Map();
    this.physics = new PhysicsEngine();
    this.fsm = new FocusStateMachine();
    this._nextId = 0;
    this._listeners = [];
  }

  // --- Window CRUD ---

  addToolWindow(tool, position) {
    const id = this._genId('w');
    const win = {
      id, type: 'tool', x: position.x, y: position.y,
      tool,
      parameterMappings: {},
      output: null, outputVersions: [], currentVersionIndex: -1, outputLoaded: false,
      executing: false, progress: null, error: null,
    };
    this.windows.set(id, win);
    this.physics.addNode(id, position);
    this._notify();
    return id;
  }

  addSpellWindow(spell, position) {
    const id = this._genId('w');
    const s = spell._id ? spell : { ...spell, _id: spell.id || this._genId('spell') };
    const win = {
      id, type: 'spell', x: position.x, y: position.y,
      spell: s,
      parameterMappings: {},
      output: null, outputVersions: [], currentVersionIndex: -1, outputLoaded: false,
      executing: false, progress: null, error: null,
    };
    this.windows.set(id, win);
    this.physics.addNode(id, position);
    this._notify();
    return id;
  }

  addUploadWindow(url, position) {
    const id = this._genId('w');
    const win = {
      id, type: 'upload', x: position.x, y: position.y,
      url: url || null,
      output: url ? { type: 'image', url } : null,
      outputs: [],
      executing: false, error: null,
    };
    this.windows.set(id, win);
    this.physics.addNode(id, position);
    this._notify();
    return id;
  }

  addPrimitiveWindow(outputType, position) {
    const id = this._genId('w');
    const win = {
      id, type: 'primitive', x: position.x, y: position.y,
      outputType,
      value: outputType === 'text' ? '' : undefined,
      output: null, executing: false, error: null,
    };
    this.windows.set(id, win);
    this.physics.addNode(id, position);
    this._notify();
    return id;
  }

  addExpressionWindow(position) {
    const id = this._genId('w');
    const win = {
      id, type: 'expression', x: position.x, y: position.y,
      expression: '',
      output: null, executing: false, error: null,
    };
    this.windows.set(id, win);
    this.physics.addNode(id, position);
    this._notify();
    return id;
  }

  addEffectWindow(tool, position) {
    const uploadPos = { x: position.x - 320, y: position.y };
    const uploadId = this.addUploadWindow(null, uploadPos);
    const toolId = this.addToolWindow(tool, position);
    // Auto-connect first image input
    const schema = tool?.metadata?.inputSchema || {};
    const imageParam = Object.keys(schema).find(k => schema[k].type === 'image');
    if (imageParam) {
      const connId = this._genId('c');
      this.addCanvasConnection(connId, uploadId, toolId, 'imageUrl', imageParam, 'image');
    }
    return { uploadId, toolId };
  }

  addCollectionTestWindow(collection, position) {
    const id = this._genId('w');
    const win = {
      id, type: 'collectionTest', x: position.x, y: position.y,
      collection,
      executing: false, error: null, output: null,
    };
    this.windows.set(id, win);
    this.physics.addNode(id, position);
    this._notify();
    return id;
  }

  removeWindow(id) {
    if (!this.windows.has(id)) return;
    const win = this.windows.get(id);

    // If deleting a spliced expression node, reconnect upstream → downstream
    if (win.type === 'expression') {
      const inConns = [];
      const outConns = [];
      for (const conn of this.connections.values()) {
        if (conn.to === id) inConns.push(conn);
        if (conn.from === id) outConns.push(conn);
      }
      // If exactly 1 in and 1+ out, reconnect each downstream to the upstream
      if (inConns.length === 1 && outConns.length >= 1) {
        const upstream = inConns[0];
        for (const downstream of outConns) {
          const newId = this._genId('c');
          this.addCanvasConnection(
            newId, upstream.from, downstream.to,
            upstream.fromOutput, downstream.toInput,
            upstream.dataType || downstream.dataType,
          );
        }
      }
    }

    // Remove all connections referencing this window
    for (const [connId, conn] of this.connections) {
      if (conn.from === id || conn.to === id) {
        this.connections.delete(connId);
        this.physics.removeConnection(connId);
      }
    }
    this.windows.delete(id);
    this.physics.removeNode(id);
    this._notify();
  }

  updateWindow(id, patch) {
    const win = this.windows.get(id);
    if (!win) return;
    Object.assign(win, patch);
    this._notify();
  }

  // Called by SandboxCanvas API consumers (UploadWindowBody etc.)
  updateWindowOutput(id, output) { this.updateWindow(id, { output, outputLoaded: true }); }
  updateWindowOutputs(id, outputs) { this.updateWindow(id, { outputs }); }
  clearWindowOutput(id) { this.updateWindow(id, { output: null, outputLoaded: false }); }

  updateWindowBatchOutput(id, outputs) {
    const win = this.windows.get(id);
    if (!win) return;
    Object.assign(win, {
      output: outputs[0] || null,
      batchOutputs: outputs,
      batchSize: outputs.length,
      outputLoaded: true,
    });
    this._notify();
  }

  // --- Connections ---

  addCanvasConnection(id, from, to, fromOutput, toInput, dataType) {
    this.connections.set(id, { id, from, to, fromWindowId: from, toWindowId: to, fromOutput, toInput, dataType });
    this.physics.addConnection(id, from, to);
    this._notify();
    return id;
  }

  removeCanvasConnection(id) {
    this.connections.delete(id);
    this.physics.removeConnection(id);
    this._notify();
  }

  // --- Physics ---

  step(dt, tweaks) {
    return this.physics.step(dt, tweaks);
  }

  pinWindow(id, position) {
    const win = this.windows.get(id);
    if (!win) return;
    const pos = position || { x: win.x, y: win.y };
    this.physics.pinNode(id, pos);
    this.updateWindow(id, { pinned: true });
  }

  unpinWindow(id) {
    this.physics.unpinNode(id);
    this.updateWindow(id, { pinned: false });
  }

  // --- FSM delegation ---

  tapNode(nodeId) { this.fsm.tapNode(nodeId); }
  doubleTapNode(nodeId) { this.fsm.doubleTapNode(nodeId); }
  zoomIn() { this.fsm.zoomIn(); }
  zoomOut() { this.fsm.zoomOut(); }
  get fsmState() { return this.fsm.state; }
  get focusedWindowId() { return this.fsm.focusedNodeId; }

  // --- Viewport ---

  screenToWorkspace(clientX, clientY, panX, panY, scale) {
    return { x: (clientX - panX) / scale, y: (clientY - panY) / scale };
  }

  // --- Listeners ---

  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  }

  _notify() {
    for (const fn of this._listeners) fn();
  }

  _genId(prefix) {
    return `${prefix}-${++this._nextId}`;
  }
}
