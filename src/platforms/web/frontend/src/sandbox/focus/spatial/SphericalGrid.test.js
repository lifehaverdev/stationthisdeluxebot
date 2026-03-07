import { describe, it, expect } from 'vitest';
import {
  createPosition,
  flatDistance,
  sphericalDistance,
  angleBetween,
  getDirection,
} from './SphericalGrid.js';

describe('SphericalGrid', () => {
  describe('createPosition', () => {
    it('creates position with x, y, defaults z to 0', () => {
      const pos = createPosition(100, 200);
      expect(pos).toEqual({ x: 100, y: 200, z: 0 });
    });

    it('creates position with explicit z', () => {
      const pos = createPosition(100, 200, 3);
      expect(pos).toEqual({ x: 100, y: 200, z: 3 });
    });
  });

  describe('flatDistance', () => {
    it('calculates 2D distance ignoring z', () => {
      const a = createPosition(0, 0);
      const b = createPosition(3, 4);
      expect(flatDistance(a, b)).toBeCloseTo(5);
    });

    it('returns 0 for same position', () => {
      const a = createPosition(10, 20);
      expect(flatDistance(a, a)).toBe(0);
    });
  });

  describe('sphericalDistance', () => {
    it('equals flat distance when z is the same', () => {
      const a = createPosition(0, 0, 0);
      const b = createPosition(3, 4, 0);
      expect(sphericalDistance(a, b)).toBeCloseTo(flatDistance(a, b));
    });

    it('is greater than flat distance when z differs', () => {
      const a = createPosition(0, 0, 0);
      const b = createPosition(3, 4, 2);
      expect(sphericalDistance(a, b)).toBeGreaterThan(flatDistance(a, b));
    });
  });

  describe('angleBetween', () => {
    it('returns 0 for point directly to the right', () => {
      const a = createPosition(0, 0);
      const b = createPosition(100, 0);
      expect(angleBetween(a, b)).toBeCloseTo(0);
    });

    it('returns PI/2 for point directly below', () => {
      const a = createPosition(0, 0);
      const b = createPosition(0, 100);
      expect(angleBetween(a, b)).toBeCloseTo(Math.PI / 2);
    });

    it('returns PI for point directly to the left', () => {
      const a = createPosition(0, 0);
      const b = createPosition(-100, 0);
      expect(Math.abs(angleBetween(a, b))).toBeCloseTo(Math.PI);
    });
  });

  describe('getDirection', () => {
    it('maps angle to screen edge: right, bottom, left, top', () => {
      const right = getDirection(0);
      expect(right).toBe('right');

      const bottom = getDirection(Math.PI / 2);
      expect(bottom).toBe('bottom');

      const left = getDirection(Math.PI);
      expect(left).toBe('left');

      const top = getDirection(-Math.PI / 2);
      expect(top).toBe('top');
    });
  });
});
