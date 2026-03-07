import { describe, it, expect } from 'vitest';
import { PhysicsEngine } from './PhysicsEngine.js';
import { createPosition } from '../spatial/SphericalGrid.js';

function seedEngine(nodeCount, connectionRatio = 0.3) {
  const engine = new PhysicsEngine();
  const ids = [];

  for (let i = 0; i < nodeCount; i++) {
    const id = `n${i}`;
    engine.addNode(id, createPosition(
      (Math.random() - 0.5) * 2000,
      (Math.random() - 0.5) * 2000,
    ));
    ids.push(id);
  }

  const connCount = Math.floor(nodeCount * connectionRatio);
  for (let i = 0; i < connCount; i++) {
    const from = ids[Math.floor(Math.random() * ids.length)];
    const to = ids[Math.floor(Math.random() * ids.length)];
    if (from !== to) {
      engine.addConnection(`c${i}`, from, to);
    }
  }

  const groupCount = Math.max(1, Math.floor(nodeCount / 5));
  for (const id of ids) {
    if (Math.random() < 0.6) {
      engine.setGroup(id, `g${Math.floor(Math.random() * groupCount)}`);
    }
  }

  return engine;
}

describe('PhysicsEngine Performance', () => {
  it('20 nodes: step under 1ms', () => {
    const engine = seedEngine(20);
    for (let i = 0; i < 10; i++) engine.step(16);

    const t0 = performance.now();
    const iterations = 100;
    for (let i = 0; i < iterations; i++) engine.step(16);
    const avgMs = (performance.now() - t0) / iterations;

    console.log(`20 nodes avg step: ${avgMs.toFixed(3)}ms`);
    expect(avgMs).toBeLessThan(1);
  });

  it('50 nodes: step under 2ms', () => {
    const engine = seedEngine(50);
    for (let i = 0; i < 10; i++) engine.step(16);

    const t0 = performance.now();
    const iterations = 100;
    for (let i = 0; i < iterations; i++) engine.step(16);
    const avgMs = (performance.now() - t0) / iterations;

    console.log(`50 nodes avg step: ${avgMs.toFixed(3)}ms`);
    expect(avgMs).toBeLessThan(2);
  });

  it('100 nodes: step under 5ms', () => {
    const engine = seedEngine(100);
    for (let i = 0; i < 10; i++) engine.step(16);

    const t0 = performance.now();
    const iterations = 100;
    for (let i = 0; i < iterations; i++) engine.step(16);
    const avgMs = (performance.now() - t0) / iterations;

    console.log(`100 nodes avg step: ${avgMs.toFixed(3)}ms`);
    expect(avgMs).toBeLessThan(5);
  });

  it('200 nodes: step under 16ms (60fps budget)', () => {
    const engine = seedEngine(200);
    for (let i = 0; i < 10; i++) engine.step(16);

    const t0 = performance.now();
    const iterations = 50;
    for (let i = 0; i < iterations; i++) engine.step(16);
    const avgMs = (performance.now() - t0) / iterations;

    console.log(`200 nodes avg step: ${avgMs.toFixed(3)}ms`);
    expect(avgMs).toBeLessThan(16);
  });

  it('energy converges to near-zero (simulation settles)', () => {
    const engine = seedEngine(30);

    for (let i = 0; i < 500; i++) engine.step(16);

    const energy = engine.getEnergy();
    console.log(`Energy after 500 steps (30 nodes): ${energy.toFixed(4)}`);
    expect(energy).toBeLessThan(10);
  });
});
