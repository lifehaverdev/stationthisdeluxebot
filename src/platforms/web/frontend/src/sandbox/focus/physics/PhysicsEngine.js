import { createPosition, flatDistance } from '../spatial/SphericalGrid.js';
import {
  connectedAttraction,
  connectionLineRepulsion,
  groupForce,
  leftRightPolarity,
  pinSpring,
} from './Forces.js';

const DAMPING = 0.92;
const MAX_VELOCITY = 50;
const NODE_REPULSION_STRENGTH = 8000;
const NODE_REPULSION_RANGE = 350;

export class PhysicsEngine {
  constructor() {
    /** @type {Map<string, {position, velocity, pinned, group}>} */
    this._nodes = new Map();
    /** @type {Array<{id, from, to}>} */
    this._connections = [];
    /** @type {number} */
    this._energy = 0;
  }

  addNode(id, position) {
    this._nodes.set(id, {
      position: { ...position },
      velocity: { vx: 0, vy: 0 },
      pinned: null,
      group: null,
    });
  }

  removeNode(id) {
    this._nodes.delete(id);
    this._connections = this._connections.filter(c => c.from !== id && c.to !== id);
  }

  getNode(id) {
    const n = this._nodes.get(id);
    return n || null;
  }

  addConnection(id, fromId, toId) {
    this._connections.push({ id, from: fromId, to: toId });
  }

  removeConnection(id) {
    this._connections = this._connections.filter(c => c.id !== id);
  }

  getConnections() {
    return this._connections;
  }

  setGroup(nodeId, groupId) {
    const node = this._nodes.get(nodeId);
    if (node) node.group = groupId;
  }

  getGroup(nodeId) {
    const node = this._nodes.get(nodeId);
    return node ? node.group : null;
  }

  pinNode(nodeId, position) {
    const node = this._nodes.get(nodeId);
    if (node) node.pinned = { ...position };
  }

  unpinNode(nodeId) {
    const node = this._nodes.get(nodeId);
    if (node) node.pinned = null;
  }

  getEnergy() {
    return this._energy;
  }

  /**
   * Run one simulation step.
   * @param {number} dt — delta time in ms
   * @returns {Map<string, {x, y, z}>} — current positions
   */
  step(dt) {
    const dtSec = dt / 1000;
    const forces = new Map();

    // Initialize forces
    for (const [id] of this._nodes) {
      forces.set(id, { fx: 0, fy: 0 });
    }

    const nodeIds = [...this._nodes.keys()];

    // 1. Node-to-node repulsion (all pairs)
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const a = this._nodes.get(nodeIds[i]);
        const b = this._nodes.get(nodeIds[j]);
        const dist = flatDistance(a.position, b.position);
        if (dist > NODE_REPULSION_RANGE || dist < 0.01) continue;

        const strength = NODE_REPULSION_STRENGTH / (dist * dist);
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const nx = dx / dist;
        const ny = dy / dist;

        const fa = forces.get(nodeIds[i]);
        const fb = forces.get(nodeIds[j]);
        fa.fx -= nx * strength;
        fa.fy -= ny * strength;
        fb.fx += nx * strength;
        fb.fy += ny * strength;
      }
    }

    // 2. Connected attraction + left-right polarity
    for (const conn of this._connections) {
      const a = this._nodes.get(conn.from);
      const b = this._nodes.get(conn.to);
      if (!a || !b) continue;

      // Attraction
      const attrA = connectedAttraction(a.position, b.position);
      const attrB = connectedAttraction(b.position, a.position);
      const fa = forces.get(conn.from);
      const fb = forces.get(conn.to);
      fa.fx += attrA.fx;
      fa.fy += attrA.fy;
      fb.fx += attrB.fx;
      fb.fy += attrB.fy;

      // Left-right polarity (source should be left of target)
      const pol = leftRightPolarity(a.position, b.position);
      fa.fx += pol.sourceFx;
      fb.fx += pol.targetFx;
    }

    // 3. Connection-line repulsion
    for (const conn of this._connections) {
      const from = this._nodes.get(conn.from);
      const to = this._nodes.get(conn.to);
      if (!from || !to) continue;

      for (const [id, node] of this._nodes) {
        if (id === conn.from || id === conn.to) continue;
        const rep = connectionLineRepulsion(from.position, to.position, node.position);
        const f = forces.get(id);
        f.fx += rep.fx;
        f.fy += rep.fy;
      }
    }

    // 4. Group forces (between group centroids, applied to members)
    const groups = new Map();
    for (const [id, node] of this._nodes) {
      if (!node.group) continue;
      if (!groups.has(node.group)) groups.set(node.group, []);
      groups.get(node.group).push(id);
    }
    const groupIds = [...groups.keys()];
    for (let i = 0; i < groupIds.length; i++) {
      for (let j = i + 1; j < groupIds.length; j++) {
        const membersA = groups.get(groupIds[i]);
        const membersB = groups.get(groupIds[j]);
        const centA = this._centroid(membersA);
        const centB = this._centroid(membersB);
        const gf = groupForce(centA, centB);
        for (const id of membersA) {
          const f = forces.get(id);
          f.fx += gf.fx / membersA.length;
          f.fy += gf.fy / membersA.length;
        }
        for (const id of membersB) {
          const f = forces.get(id);
          f.fx -= gf.fx / membersB.length;
          f.fy -= gf.fy / membersB.length;
        }
      }
    }

    // 5. Pin springs
    for (const [id, node] of this._nodes) {
      if (!node.pinned) continue;
      const spring = pinSpring(node.position, node.pinned);
      const f = forces.get(id);
      f.fx += spring.fx;
      f.fy += spring.fy;
    }

    // Integrate: apply forces to velocity, apply velocity to position
    this._energy = 0;
    const positions = new Map();

    for (const [id, node] of this._nodes) {
      const f = forces.get(id);

      // Update velocity
      node.velocity.vx = (node.velocity.vx + f.fx * dtSec) * DAMPING;
      node.velocity.vy = (node.velocity.vy + f.fy * dtSec) * DAMPING;

      // Clamp velocity
      const speed = Math.sqrt(node.velocity.vx ** 2 + node.velocity.vy ** 2);
      if (speed > MAX_VELOCITY) {
        node.velocity.vx = (node.velocity.vx / speed) * MAX_VELOCITY;
        node.velocity.vy = (node.velocity.vy / speed) * MAX_VELOCITY;
      }

      // Update position (2D only — z is manual)
      node.position.x += node.velocity.vx;
      node.position.y += node.velocity.vy;

      // Track energy
      this._energy += 0.5 * (node.velocity.vx ** 2 + node.velocity.vy ** 2);

      positions.set(id, { x: node.position.x, y: node.position.y, z: node.position.z });
    }

    return positions;
  }

  _centroid(nodeIds) {
    let cx = 0, cy = 0;
    for (const id of nodeIds) {
      const n = this._nodes.get(id);
      cx += n.position.x;
      cy += n.position.y;
    }
    const len = nodeIds.length || 1;
    return createPosition(cx / len, cy / len);
  }
}
