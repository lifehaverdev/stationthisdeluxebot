import { flatDistance, sphericalDistance, angleBetween } from './SphericalGrid.js';

const TOPOLOGY_WEIGHT = 3.0;
const MIN_DISTANCE = 1; // prevent division by zero

/**
 * Score a neighbor's proximity. Higher = closer/more relevant.
 * @param {number} distance — spatial distance
 * @param {boolean} connected — topologically connected
 */
export function scoreProximity(distance, connected) {
  const d = Math.max(distance, MIN_DISTANCE);
  return (1 / d) * (connected ? TOPOLOGY_WEIGHT : 1);
}

/**
 * Get sorted neighbors for a node.
 * @param {string} nodeId
 * @param {Array<{id, position}>} nodes
 * @param {Array<{fromWindowId, toWindowId, fromOutput, toInput}>} connections
 * @param {number} [maxResults=20]
 * @returns {Array<{node, direction, distance, connected, connectionType, score}>}
 */
export function getNeighbors(nodeId, nodes, connections, maxResults = 20) {
  const self = nodes.find(n => n.id === nodeId);
  if (!self) return [];

  const results = [];

  for (const node of nodes) {
    if (node.id === nodeId) continue;

    const flat = flatDistance(self.position, node.position);
    const spherical = sphericalDistance(self.position, node.position);
    const angle = angleBetween(self.position, node.position);

    // Check connection
    let connected = false;
    let connectionType = null;
    for (const conn of connections) {
      if (conn.fromWindowId === nodeId && conn.toWindowId === node.id) {
        connected = true;
        connectionType = 'output';
        break;
      }
      if (conn.toWindowId === nodeId && conn.fromWindowId === node.id) {
        connected = true;
        connectionType = 'input';
        break;
      }
    }

    const score = scoreProximity(flat, connected);

    results.push({
      node,
      direction: { angle },
      distance: { flat, spherical, z: Math.abs((node.position.z || 0) - (self.position.z || 0)) },
      connected,
      connectionType,
      score,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}
