import { describe, it, expect } from 'vitest';
import { computeGlows } from './PeripheryGlows.js';
import { createPosition } from '../spatial/SphericalGrid.js';

describe('PeripheryGlows', () => {
  const nodes = [
    { id: 'a', position: createPosition(0, 0) },
    { id: 'b', position: createPosition(200, 0) },
    { id: 'c', position: createPosition(0, 200) },
    { id: 'd', position: createPosition(-150, 0) },
    { id: 'e', position: createPosition(0, -150) },
  ];
  const connections = [
    { fromWindowId: 'a', toWindowId: 'b', fromOutput: 'out', toInput: 'in' },
  ];

  it('returns glows for neighbors of focused node', () => {
    const glows = computeGlows('a', nodes, connections);
    expect(glows.length).toBeGreaterThan(0);
    expect(glows.find(g => g.nodeId === 'a')).toBeUndefined();
  });

  it('each glow has edge, position percent, brightness, and size', () => {
    const glows = computeGlows('a', nodes, connections);
    const glow = glows[0];
    expect(glow).toHaveProperty('nodeId');
    expect(glow).toHaveProperty('edge');
    expect(glow).toHaveProperty('percent');
    expect(glow).toHaveProperty('brightness');
    expect(glow).toHaveProperty('size');
    expect(glow).toHaveProperty('connected');
  });

  it('connected nodes have higher brightness', () => {
    const glows = computeGlows('a', nodes, connections);
    const bGlow = glows.find(g => g.nodeId === 'b');
    const cGlow = glows.find(g => g.nodeId === 'c');
    expect(bGlow.connected).toBe(true);
    expect(bGlow.brightness).toBeGreaterThan(cGlow.brightness);
  });

  it('maps neighbors to correct screen edges', () => {
    const glows = computeGlows('a', nodes, connections);
    const bGlow = glows.find(g => g.nodeId === 'b');
    const dGlow = glows.find(g => g.nodeId === 'd');
    const eGlow = glows.find(g => g.nodeId === 'e');
    expect(bGlow.edge).toBe('right');
    expect(dGlow.edge).toBe('left');
    expect(eGlow.edge).toBe('top');
  });

  it('limits to maxGlows', () => {
    const glows = computeGlows('a', nodes, connections, 2);
    expect(glows.length).toBe(2);
  });

  it('returns empty for unknown node', () => {
    const glows = computeGlows('unknown', nodes, connections);
    expect(glows).toEqual([]);
  });
});
