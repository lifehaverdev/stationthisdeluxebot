// CanvasEngine.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { CanvasEngine } from './CanvasEngine.js';

describe('CanvasEngine', () => {
  let engine;
  beforeEach(() => { engine = new CanvasEngine(); });

  describe('addToolWindow', () => {
    it('adds window to windows map', () => {
      const id = engine.addToolWindow({ toolId: 'gpt', displayName: 'GPT' }, { x: 0, y: 0 });
      expect(engine.windows.has(id)).toBe(true);
    });

    it('window has type=tool', () => {
      const id = engine.addToolWindow({ toolId: 'gpt', displayName: 'GPT' }, { x: 0, y: 0 });
      expect(engine.windows.get(id).type).toBe('tool');
    });

    it('window stores the tool object', () => {
      const tool = { toolId: 'gpt', displayName: 'GPT' };
      const id = engine.addToolWindow(tool, { x: 0, y: 0 });
      expect(engine.windows.get(id).tool).toBe(tool);
    });

    it('window has execution state defaults', () => {
      const id = engine.addToolWindow({ toolId: 'gpt' }, { x: 0, y: 0 });
      const win = engine.windows.get(id);
      expect(win.executing).toBe(false);
      expect(win.output).toBe(null);
      expect(win.error).toBe(null);
      expect(win.parameterMappings).toEqual({});
    });

    it('returns unique ids for multiple windows', () => {
      const id1 = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      const id2 = engine.addToolWindow({ toolId: 'b' }, { x: 0, y: 0 });
      expect(id1).not.toBe(id2);
    });

    it('notifies onChange listeners', () => {
      let called = 0;
      engine.onChange(() => called++);
      engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      expect(called).toBe(1);
    });
  });

  describe('addUploadWindow', () => {
    it('adds window with type=upload', () => {
      const id = engine.addUploadWindow(null, { x: 0, y: 0 });
      expect(engine.windows.get(id).type).toBe('upload');
    });

    it('stores url', () => {
      const id = engine.addUploadWindow('https://example.com/img.jpg', { x: 0, y: 0 });
      expect(engine.windows.get(id).url).toBe('https://example.com/img.jpg');
    });
  });

  describe('addPrimitiveWindow', () => {
    it('adds window with type=primitive', () => {
      const id = engine.addPrimitiveWindow('text', { x: 0, y: 0 });
      expect(engine.windows.get(id).type).toBe('primitive');
    });

    it('stores outputType', () => {
      const id = engine.addPrimitiveWindow('image', { x: 0, y: 0 });
      expect(engine.windows.get(id).outputType).toBe('image');
    });
  });

  describe('addSpellWindow', () => {
    it('adds window with type=spell', () => {
      const spell = { _id: 'spell-1', name: 'My Spell' };
      const id = engine.addSpellWindow(spell, { x: 0, y: 0 });
      expect(engine.windows.get(id).type).toBe('spell');
      expect(engine.windows.get(id).spell).toBe(spell);
    });
  });

  describe('addEffectWindow', () => {
    it('creates two windows: upload + tool', () => {
      const tool = { toolId: 'upscaler', displayName: 'Upscaler', metadata: { inputSchema: { imageUrl: { type: 'image' } } } };
      const result = engine.addEffectWindow(tool, { x: 100, y: 100 });
      expect(engine.windows.has(result.uploadId)).toBe(true);
      expect(engine.windows.has(result.toolId)).toBe(true);
    });

    it('auto-creates a connection between upload and tool', () => {
      const tool = { toolId: 'upscaler', metadata: { inputSchema: { imageUrl: { type: 'image' } } } };
      engine.addEffectWindow(tool, { x: 100, y: 100 });
      expect(engine.connections.size).toBe(1);
    });
  });

  describe('removeWindow', () => {
    it('removes window from map', () => {
      const id = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      engine.removeWindow(id);
      expect(engine.windows.has(id)).toBe(false);
    });

    it('removes all connections involving that window', () => {
      const a = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      const b = engine.addToolWindow({ toolId: 'b' }, { x: 100, y: 0 });
      engine.addCanvasConnection('c1', a, b, 'output', 'input', 'text');
      engine.removeWindow(a);
      expect(engine.connections.has('c1')).toBe(false);
    });
  });

  describe('updateWindow', () => {
    it('merges patch into window state', () => {
      const id = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      engine.updateWindow(id, { executing: true, progress: 'Running…' });
      const win = engine.windows.get(id);
      expect(win.executing).toBe(true);
      expect(win.progress).toBe('Running…');
    });

    it('does not throw on unknown id', () => {
      expect(() => engine.updateWindow('unknown', { executing: true })).not.toThrow();
    });

    it('notifies listeners', () => {
      const id = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      let called = 0;
      engine.onChange(() => called++);
      engine.updateWindow(id, { executing: true });
      expect(called).toBe(1);
    });
  });

  describe('addCanvasConnection / removeCanvasConnection', () => {
    it('addCanvasConnection stores connection', () => {
      const a = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      const b = engine.addToolWindow({ toolId: 'b' }, { x: 100, y: 0 });
      engine.addCanvasConnection('c1', a, b, 'output', 'input', 'text');
      expect(engine.connections.has('c1')).toBe(true);
    });

    it('connection has correct shape', () => {
      const a = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      const b = engine.addToolWindow({ toolId: 'b' }, { x: 100, y: 0 });
      engine.addCanvasConnection('c1', a, b, 'response', 'prompt', 'text');
      const conn = engine.connections.get('c1');
      expect(conn.from).toBe(a);
      expect(conn.to).toBe(b);
      expect(conn.fromOutput).toBe('response');
      expect(conn.toInput).toBe('prompt');
      expect(conn.dataType).toBe('text');
    });

    it('removeCanvasConnection removes from map', () => {
      const a = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      const b = engine.addToolWindow({ toolId: 'b' }, { x: 100, y: 0 });
      engine.addCanvasConnection('c1', a, b, 'output', 'input', 'text');
      engine.removeCanvasConnection('c1');
      expect(engine.connections.has('c1')).toBe(false);
    });
  });

  describe('onChange unsubscribe', () => {
    it('unsubscribe stops notifications', () => {
      let called = 0;
      const unsub = engine.onChange(() => called++);
      unsub();
      engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      expect(called).toBe(0);
    });
  });

  // Task 2: PhysicsEngine integration
  describe('PhysicsEngine integration', () => {
    it('addToolWindow creates physics node', () => {
      const id = engine.addToolWindow({ toolId: 'a' }, { x: 50, y: 100 });
      expect(engine.physics.getNode(id)).not.toBe(null);
    });

    it('physics node starts at given position', () => {
      const id = engine.addToolWindow({ toolId: 'a' }, { x: 50, y: 100 });
      const node = engine.physics.getNode(id);
      expect(node.position.x).toBe(50);
      expect(node.position.y).toBe(100);
    });

    it('removeWindow removes physics node', () => {
      const id = engine.addToolWindow({ toolId: 'a' }, { x: 50, y: 100 });
      engine.removeWindow(id);
      expect(engine.physics.getNode(id)).toBe(null);
    });

    it('addCanvasConnection creates physics spring', () => {
      const a = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      const b = engine.addToolWindow({ toolId: 'b' }, { x: 200, y: 0 });
      engine.addCanvasConnection('c1', a, b, 'output', 'input', 'text');
      const conns = engine.physics.getConnections();
      expect(conns.some(c => c.from === a && c.to === b)).toBe(true);
    });

    it('removeCanvasConnection removes physics spring', () => {
      const a = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      const b = engine.addToolWindow({ toolId: 'b' }, { x: 200, y: 0 });
      engine.addCanvasConnection('c1', a, b, 'output', 'input', 'text');
      engine.removeCanvasConnection('c1');
      const conns = engine.physics.getConnections();
      expect(conns.some(c => c.id === 'c1')).toBe(false);
    });

    it('step returns positions map for all nodes', () => {
      engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      engine.addToolWindow({ toolId: 'b' }, { x: 200, y: 0 });
      const positions = engine.step(16);
      expect(positions.size).toBe(2);
    });

    it('repulsion pushes overlapping nodes apart after 30 steps', () => {
      const a = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      const b = engine.addToolWindow({ toolId: 'b' }, { x: 10, y: 0 });
      let positions;
      for (let i = 0; i < 30; i++) positions = engine.step(16);
      const posA = positions.get(a);
      const posB = positions.get(b);
      const dist = Math.hypot(posB.x - posA.x, posB.y - posA.y);
      expect(dist).toBeGreaterThan(50);
    });

    it('attraction pulls connected nodes toward each other from far apart', () => {
      const a = engine.addToolWindow({ toolId: 'a' }, { x: -500, y: 0 });
      const b = engine.addToolWindow({ toolId: 'b' }, { x: 500, y: 0 });
      engine.addCanvasConnection('c1', a, b, 'out', 'in', 'text');
      let positions;
      for (let i = 0; i < 60; i++) positions = engine.step(16);
      const posA = positions.get(a);
      const posB = positions.get(b);
      const dist = Math.hypot(posB.x - posA.x, posB.y - posA.y);
      expect(dist).toBeLessThan(900); // pulled closer from 1000 apart
    });

    it('pinWindow pins physics node', () => {
      const id = engine.addToolWindow({ toolId: 'a' }, { x: 50, y: 100 });
      engine.pinWindow(id);
      expect(engine.physics.getNode(id).pinned).not.toBe(null);
    });

    it('unpinWindow unpins physics node', () => {
      const id = engine.addToolWindow({ toolId: 'a' }, { x: 50, y: 100 });
      engine.pinWindow(id);
      engine.unpinWindow(id);
      expect(engine.physics.getNode(id).pinned).toBe(null);
    });
  });

  // Task 3: FSM integration
  describe('FSM integration', () => {
    it('starts in CANVAS_Z2', () => {
      expect(engine.fsmState).toBe('CANVAS_Z2');
    });

    it('tapNode transitions to CANVAS_Z1', () => {
      const id = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      engine.tapNode(id);
      expect(engine.fsmState).toBe('CANVAS_Z1');
      expect(engine.focusedWindowId).toBe(id);
    });

    it('double tapNode goes straight to NODE_MODE', () => {
      const id = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      engine.doubleTapNode(id);
      expect(engine.fsmState).toBe('NODE_MODE');
      expect(engine.focusedWindowId).toBe(id);
    });

    it('zoomOut from Z1 returns to Z2', () => {
      const id = engine.addToolWindow({ toolId: 'a' }, { x: 0, y: 0 });
      engine.tapNode(id);
      engine.zoomOut();
      expect(engine.fsmState).toBe('CANVAS_Z2');
    });
  });

  describe('screenToWorkspace', () => {
    it('at default pan/scale', () => {
      expect(engine.screenToWorkspace(100, 200, 0, 0, 1)).toEqual({ x: 100, y: 200 });
    });

    it('with pan offset', () => {
      expect(engine.screenToWorkspace(100, 200, 50, 50, 1)).toEqual({ x: 50, y: 150 });
    });

    it('with zoom scale', () => {
      expect(engine.screenToWorkspace(100, 200, 0, 0, 2)).toEqual({ x: 50, y: 100 });
    });

    it('with pan and scale', () => {
      expect(engine.screenToWorkspace(200, 300, 100, 100, 2)).toEqual({ x: 50, y: 100 });
    });
  });
});
