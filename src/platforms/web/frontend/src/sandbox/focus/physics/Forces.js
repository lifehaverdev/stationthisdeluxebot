import { flatDistance } from '../spatial/SphericalGrid.js';

// Tunable constants
const ATTRACTION_STRENGTH = 0.01;
const CONNECTION_LINE_REPULSION_STRENGTH = 5000;
const CONNECTION_LINE_REPULSION_RANGE = 100;
const GROUP_REPULSION_RANGE = 150;
const GROUP_REPULSION_STRENGTH = 2000;
const GROUP_ATTRACTION_STRENGTH = 0.002;
const POLARITY_STRENGTH = 0.2;
const POLARITY_MIN_GAP = 80;
const PIN_SPRING_K = 0.1;

/**
 * Attraction force between connected nodes.
 * Returns force to apply to node at posA toward posB.
 */
export function connectedAttraction(posA, posB) {
  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  return {
    fx: dx * ATTRACTION_STRENGTH,
    fy: dy * ATTRACTION_STRENGTH,
  };
}

/**
 * Repulsion force pushing a node away from a connection line.
 * Uses point-to-line-segment distance.
 */
export function connectionLineRepulsion(lineStart, lineEnd, nodePos) {
  // Project node onto line segment
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { fx: 0, fy: 0 };

  let t = ((nodePos.x - lineStart.x) * dx + (nodePos.y - lineStart.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = lineStart.x + t * dx;
  const closestY = lineStart.y + t * dy;

  const distX = nodePos.x - closestX;
  const distY = nodePos.y - closestY;
  const dist = Math.sqrt(distX * distX + distY * distY);

  if (dist > CONNECTION_LINE_REPULSION_RANGE || dist < 0.01) return { fx: 0, fy: 0 };

  const strength = CONNECTION_LINE_REPULSION_STRENGTH / (dist * dist);
  const nx = distX / dist;
  const ny = distY / dist;

  return { fx: nx * strength, fy: ny * strength };
}

/**
 * Group-to-group force: repel at close range, attract at far range.
 * Molecular force model.
 * Returns force on posA.
 */
export function groupForce(posA, posB) {
  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.01) return { fx: 0, fy: 0 };

  const nx = dx / dist;
  const ny = dy / dist;

  if (dist < GROUP_REPULSION_RANGE) {
    // Repel
    const strength = GROUP_REPULSION_STRENGTH / (dist * dist);
    return { fx: -nx * strength, fy: -ny * strength };
  }

  // Attract
  const strength = (dist - GROUP_REPULSION_RANGE) * GROUP_ATTRACTION_STRENGTH;
  return { fx: nx * strength, fy: ny * strength };
}

/**
 * Left-right polarity force for connection flow.
 * Source (output) should be LEFT of target (input).
 * Returns forces for both source and target.
 */
export function leftRightPolarity(sourcePos, targetPos) {
  const gap = targetPos.x - sourcePos.x;

  if (gap >= POLARITY_MIN_GAP) {
    return { sourceFx: 0, targetFx: 0 };
  }

  const correction = (POLARITY_MIN_GAP - gap) * POLARITY_STRENGTH;
  return {
    sourceFx: -correction, // push source left
    targetFx: correction,  // push target right
  };
}

/**
 * Spring force pulling node toward a pinned position.
 */
export function pinSpring(currentPos, pinnedPos) {
  const dx = pinnedPos.x - currentPos.x;
  const dy = pinnedPos.y - currentPos.y;
  return {
    fx: dx * PIN_SPRING_K,
    fy: dy * PIN_SPRING_K,
  };
}
