import { Component, h } from '@monygroupcorp/microact';

/**
 * Sigil — hollow circle, central dot, three vectors biased to upper-right.
 * Monochrome by default; accent applied to vectors during meaningful events.
 *
 * Props:
 *   size     {number}  — diameter in px (default: 120)
 *   opacity  {number}  — overall opacity (default: 0.04)
 *   pulse    {boolean} — if true, animate vectors in accent color
 *   className {string}
 */
export class Sigil extends Component {
  static get styles() {
    return `
      .sigil-root { display: block; flex-shrink: 0; }
      .sigil-root.pulse .sigil-vector {
        stroke: var(--accent);
        animation: accentPulse 1.2s var(--ease) forwards;
      }
    `;
  }

  render() {
    const { size = 120, opacity = 0.04, pulse = false, className = '' } = this.props;
    const r = size / 2;
    const cx = r;
    const cy = r;
    const outerR = r - 2;
    const dotR   = outerR * 0.065;

    // Three vectors biased toward upper-right quadrant (0°, 52°, 104°)
    // Measured from center, lengths vary slightly for visual tension
    const vectors = [
      { angle: -62,  len: outerR * 0.72 },
      { angle: -18,  len: outerR * 0.58 },
      { angle:  26,  len: outerR * 0.64 },
    ];

    const toXY = (angleDeg, len) => {
      const rad = (angleDeg * Math.PI) / 180;
      return { x: cx + Math.cos(rad) * len, y: cy + Math.sin(rad) * len };
    };

    return h('svg', {
      className: `sigil-root ${pulse ? 'pulse' : ''} ${className}`,
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      style: { opacity, display: 'block' },
      'aria-hidden': 'true',
    },
      // Outer ring
      h('circle', {
        cx, cy, r: outerR,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '0.75',
      }),
      // Center dot
      h('circle', {
        cx, cy, r: dotR,
        fill: 'currentColor',
      }),
      // Directional vectors
      ...vectors.map(({ angle, len }) => {
        const end = toXY(angle, len);
        return h('line', {
          className: 'sigil-vector',
          x1: cx, y1: cy,
          x2: end.x, y2: end.y,
          stroke: 'currentColor',
          'stroke-width': '0.75',
          'stroke-linecap': 'square',
        });
      }),
    );
  }
}
