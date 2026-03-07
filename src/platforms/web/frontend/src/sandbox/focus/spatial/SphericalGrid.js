/** Sphere radius — large enough that surface feels like layered planes */
const SPHERE_RADIUS = 10000;

/**
 * Create a position on the spherical grid.
 * @param {number} x
 * @param {number} y
 * @param {number} [z=0] — depth level (0 = surface)
 */
export function createPosition(x, y, z = 0) {
  return { x, y, z };
}

/**
 * 2D flat distance (ignores z). Used for physics forces.
 */
export function flatDistance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Spherical distance accounting for depth.
 * On the sphere surface (same z), equals flat distance.
 * Different z levels add arc distance from curvature.
 */
export function sphericalDistance(a, b) {
  const flat = flatDistance(a, b);
  const dz = Math.abs((b.z || 0) - (a.z || 0));
  if (dz === 0) return flat;
  // Arc length contribution from depth difference on the sphere
  const arcContribution = SPHERE_RADIUS * Math.asin(Math.min(dz / SPHERE_RADIUS, 1));
  return Math.sqrt(flat * flat + arcContribution * arcContribution);
}

/**
 * Angle from position a to position b in radians.
 * 0 = right, PI/2 = down, PI = left, -PI/2 = up.
 */
export function angleBetween(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * Map an angle to a screen edge direction.
 */
export function getDirection(angle) {
  // Normalize to [0, 2PI)
  const a = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (a < Math.PI / 4 || a >= 7 * Math.PI / 4) return 'right';
  if (a < 3 * Math.PI / 4) return 'bottom';
  if (a < 5 * Math.PI / 4) return 'left';
  return 'top';
}
