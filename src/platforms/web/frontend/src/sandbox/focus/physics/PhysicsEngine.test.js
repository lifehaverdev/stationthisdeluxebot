import { describe, it, expect, beforeEach } from 'vitest';
import { PhysicsEngine } from './PhysicsEngine.js';
import { createPosition } from '../spatial/SphericalGrid.js';

describe('PhysicsEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new PhysicsEngine();
  });

  describe('node management', () => {
    it('adds a node with position and velocity', () => {
      engine.addNode('a', createPosition(100, 200));
      const node = engine.getNode('a');
      expect(node.position).toEqual({ x: 100, y: 200, z: 0 });
      expect(node.velocity).toEqual({ vx: 0, vy: 0 });
    });

    it('removes a node', () => {
      engine.addNode('a', createPosition(0, 0));
      engine.removeNode('a');
      expect(engine.getNode('a')).toBe(null);
    });
  });

  describe('connections', () => {
    it('adds a connection between nodes', () => {
      engine.addNode('a', createPosition(0, 0));
      engine.addNode('b', createPosition(200, 0));
      engine.addConnection('c1', 'a', 'b');
      expect(engine.getConnections()).toHaveLength(1);
    });
  });

  describe('groups', () => {
    it('assigns nodes to groups', () => {
      engine.addNode('a', createPosition(0, 0));
      engine.addNode('b', createPosition(100, 0));
      engine.setGroup('a', 'group1');
      engine.setGroup('b', 'group1');
      expect(engine.getGroup('a')).toBe('group1');
    });
  });

  describe('pinning', () => {
    it('pins a node with spring anchor', () => {
      engine.addNode('a', createPosition(100, 100));
      engine.pinNode('a', createPosition(50, 50));
      const node = engine.getNode('a');
      expect(node.pinned).toEqual({ x: 50, y: 50, z: 0 });
    });

    it('unpins a node', () => {
      engine.addNode('a', createPosition(100, 100));
      engine.pinNode('a', createPosition(50, 50));
      engine.unpinNode('a');
      expect(engine.getNode('a').pinned).toBe(null);
    });
  });

  describe('simulation step', () => {
    it('moves connected nodes closer together', () => {
      engine.addNode('a', createPosition(0, 0));
      engine.addNode('b', createPosition(500, 0));
      engine.addConnection('c1', 'a', 'b');

      const initialDist = 500;
      engine.step(16); // one frame at ~60fps

      const a = engine.getNode('a');
      const b = engine.getNode('b');
      const newDist = Math.abs(b.position.x - a.position.x);
      expect(newDist).toBeLessThan(initialDist);
    });

    it('pinned nodes spring back toward pin position', () => {
      engine.addNode('a', createPosition(200, 200));
      engine.pinNode('a', createPosition(0, 0));

      engine.step(16);

      const a = engine.getNode('a');
      // Should have moved toward (0,0)
      expect(a.position.x).toBeLessThan(200);
      expect(a.position.y).toBeLessThan(200);
    });

    it('enforces left-right polarity on connections', () => {
      // Target LEFT of source (wrong order), far enough apart for polarity to dominate
      engine.addNode('src', createPosition(300, 0));
      engine.addNode('tgt', createPosition(0, 0));
      engine.addConnection('c1', 'src', 'tgt');

      // Run enough steps for polarity to reorder nodes
      for (let i = 0; i < 2000; i++) engine.step(16);

      const src = engine.getNode('src');
      const tgt = engine.getNode('tgt');
      // Target should now be to the right of source
      expect(tgt.position.x).toBeGreaterThan(src.position.x);
    });

    it('returns positions map for rendering', () => {
      engine.addNode('a', createPosition(0, 0));
      engine.addNode('b', createPosition(100, 0));
      const positions = engine.step(16);
      expect(positions.has('a')).toBe(true);
      expect(positions.has('b')).toBe(true);
      expect(positions.get('a')).toHaveProperty('x');
      expect(positions.get('a')).toHaveProperty('y');
    });
  });

  describe('energy', () => {
    it('reports total kinetic energy', () => {
      engine.addNode('a', createPosition(0, 0));
      engine.addNode('b', createPosition(500, 0));
      engine.addConnection('c1', 'a', 'b');
      engine.step(16);
      expect(engine.getEnergy()).toBeGreaterThan(0);
    });

    it('energy decreases over time (damping)', () => {
      engine.addNode('a', createPosition(0, 0));
      engine.addNode('b', createPosition(500, 0));
      engine.addConnection('c1', 'a', 'b');

      // Let it run for a bit
      for (let i = 0; i < 50; i++) engine.step(16);
      const midEnergy = engine.getEnergy();

      for (let i = 0; i < 200; i++) engine.step(16);
      const lateEnergy = engine.getEnergy();

      expect(lateEnergy).toBeLessThan(midEnergy);
    });
  });
});
