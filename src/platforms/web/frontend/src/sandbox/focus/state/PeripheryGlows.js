import { getNeighbors } from '../spatial/Proximity.js';
import { getDirection } from '../spatial/SphericalGrid.js';

const MAX_GLOWS = 8;

/**
 * Compute periphery glow positions for a focused node.
 * @param {string} focusedNodeId
 * @param {Array<{id, position}>} nodes
 * @param {Array<{fromWindowId, toWindowId}>} connections
 * @param {number} [maxGlows=8]
 * @returns {Array<{nodeId, edge, percent, brightness, size, connected, label}>}
 */
export function computeGlows(focusedNodeId, nodes, connections, maxGlows = MAX_GLOWS) {
  const neighbors = getNeighbors(focusedNodeId, nodes, connections, maxGlows);
  if (!neighbors.length) return [];

  const maxScore = neighbors[0].score;

  return neighbors.map(n => {
    const angle = n.direction.angle;
    const edge = getDirection(angle);
    const percent = angleToEdgePercent(angle, edge);
    const brightness = maxScore > 0 ? n.score / maxScore : 0;
    const size = brightness;

    return {
      nodeId: n.node.id,
      edge,
      percent,
      brightness,
      size,
      connected: n.connected,
      label: n.node.label || n.node.id,
    };
  });
}

/**
 * Map an angle to a 0-1 percent along its screen edge.
 */
function angleToEdgePercent(angle, edge) {
  const a = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  switch (edge) {
    case 'right': {
      const adjusted = a >= 7 * Math.PI / 4 ? a - 2 * Math.PI : a;
      return (adjusted + Math.PI / 4) / (Math.PI / 2);
    }
    case 'bottom':
      return 1 - (a - Math.PI / 4) / (Math.PI / 2);
    case 'left':
      return 1 - (a - 3 * Math.PI / 4) / (Math.PI / 2);
    case 'top':
      return (a - 5 * Math.PI / 4) / (Math.PI / 2);
    default:
      return 0.5;
  }
}
