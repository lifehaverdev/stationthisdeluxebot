import { describe, it, expect } from 'vitest';
import {
  connectedAttraction,
  connectionLineRepulsion,
  groupForce,
  leftRightPolarity,
  pinSpring,
} from './Forces.js';
import { createPosition } from '../spatial/SphericalGrid.js';

describe('Forces', () => {
  describe('connectedAttraction', () => {
    it('pulls connected nodes toward each other', () => {
      const a = createPosition(0, 0);
      const b = createPosition(200, 0);
      const force = connectedAttraction(a, b);
      // Force on a should point toward b (positive x)
      expect(force.fx).toBeGreaterThan(0);
      expect(force.fy).toBeCloseTo(0);
    });

    it('force increases with distance', () => {
      const a = createPosition(0, 0);
      const near = connectedAttraction(a, createPosition(50, 0));
      const far = connectedAttraction(a, createPosition(300, 0));
      expect(Math.abs(far.fx)).toBeGreaterThan(Math.abs(near.fx));
    });
  });

  describe('connectionLineRepulsion', () => {
    it('pushes node away from connection line', () => {
      // Connection from (0,0) to (200,0), node at (100, 30) — close to line
      const lineStart = createPosition(0, 0);
      const lineEnd = createPosition(200, 0);
      const node = createPosition(100, 30);
      const force = connectionLineRepulsion(lineStart, lineEnd, node);
      // Should push node downward (away from line)
      expect(force.fy).toBeGreaterThan(0);
    });

    it('no force when node is far from line', () => {
      const lineStart = createPosition(0, 0);
      const lineEnd = createPosition(200, 0);
      const node = createPosition(100, 500);
      const force = connectionLineRepulsion(lineStart, lineEnd, node);
      expect(Math.abs(force.fx)).toBeLessThan(0.01);
      expect(Math.abs(force.fy)).toBeLessThan(0.01);
    });
  });

  describe('groupForce', () => {
    it('repels at close range', () => {
      const a = createPosition(0, 0);
      const b = createPosition(30, 0);
      const force = groupForce(a, b);
      // Should push a to the left (away from b)
      expect(force.fx).toBeLessThan(0);
    });

    it('attracts at far range', () => {
      const a = createPosition(0, 0);
      const b = createPosition(800, 0);
      const force = groupForce(a, b);
      // Should pull a toward b (positive x)
      expect(force.fx).toBeGreaterThan(0);
    });
  });

  describe('leftRightPolarity', () => {
    it('pushes output node to the right of input node', () => {
      // source at (100, 0), target at (50, 0) — target is LEFT of source (wrong)
      const source = createPosition(100, 0);
      const target = createPosition(50, 0);
      const force = leftRightPolarity(source, target);
      // Target should be pushed rightward (positive fx)
      expect(force.targetFx).toBeGreaterThan(0);
      // Source should be pushed leftward (negative fx)
      expect(force.sourceFx).toBeLessThan(0);
    });

    it('no force when already in correct order', () => {
      const source = createPosition(0, 0);
      const target = createPosition(200, 0);
      const force = leftRightPolarity(source, target);
      expect(force.sourceFx).toBeCloseTo(0);
      expect(force.targetFx).toBeCloseTo(0);
    });
  });

  describe('pinSpring', () => {
    it('pulls node toward pinned position', () => {
      const current = createPosition(100, 50);
      const pinned = createPosition(0, 0);
      const force = pinSpring(current, pinned);
      expect(force.fx).toBeLessThan(0); // pull left
      expect(force.fy).toBeLessThan(0); // pull up
    });

    it('no force when at pinned position', () => {
      const pos = createPosition(50, 50);
      const force = pinSpring(pos, pos);
      expect(force.fx).toBeCloseTo(0);
      expect(force.fy).toBeCloseTo(0);
    });
  });
});
