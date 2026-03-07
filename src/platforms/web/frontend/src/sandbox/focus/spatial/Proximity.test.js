import { describe, it, expect } from 'vitest';
import { scoreProximity, getNeighbors } from './Proximity.js';
import { createPosition } from './SphericalGrid.js';

describe('Proximity', () => {
  describe('scoreProximity', () => {
    it('gives higher score to closer nodes', () => {
      const close = scoreProximity(50, false);
      const far = scoreProximity(200, false);
      expect(close).toBeGreaterThan(far);
    });

    it('gives connected nodes a multiplier', () => {
      const connected = scoreProximity(100, true);
      const unconnected = scoreProximity(100, false);
      expect(connected).toBeGreaterThan(unconnected);
    });

    it('nearby unconnected can outrank distant connected', () => {
      const nearUnconnected = scoreProximity(20, false);
      const farConnected = scoreProximity(500, true);
      expect(nearUnconnected).toBeGreaterThan(farConnected);
    });
  });

  describe('getNeighbors', () => {
    const nodes = [
      { id: 'a', position: createPosition(0, 0) },
      { id: 'b', position: createPosition(100, 0) },
      { id: 'c', position: createPosition(300, 200) },
      { id: 'd', position: createPosition(50, 50) },
    ];
    const connections = [
      { fromWindowId: 'a', toWindowId: 'b', fromOutput: 'out', toInput: 'in' },
    ];

    it('returns neighbors sorted by blended score descending', () => {
      const result = getNeighbors('a', nodes, connections);
      expect(result.length).toBe(3); // excludes self
      // 'd' is closest unconnected, 'b' is connected
      // Both should be near the top
      const ids = result.map(r => r.node.id);
      expect(ids[0]).toBe('b'); // connected + close
    });

    it('includes direction and distance for each neighbor', () => {
      const result = getNeighbors('a', nodes, connections);
      const bNeighbor = result.find(r => r.node.id === 'b');
      expect(bNeighbor.direction).toHaveProperty('angle');
      expect(bNeighbor.distance).toHaveProperty('flat');
      expect(bNeighbor.connected).toBe(true);
      expect(bNeighbor.connectionType).toBe('output');
    });

    it('respects maxResults limit', () => {
      const result = getNeighbors('a', nodes, connections, 2);
      expect(result.length).toBe(2);
    });
  });
});
