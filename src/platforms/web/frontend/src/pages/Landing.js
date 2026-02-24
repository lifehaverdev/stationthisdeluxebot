import { Component, h } from '@monygroupcorp/microact';
import { getAppUrl } from '../lib/urls.js';
import { Sigil } from '../sandbox/components/Sigil.js';

const CAPABILITIES = [
  {
    label: '/Collections',
    desc: 'Batch-generate with variable traits. Export images and OpenSea-compatible metadata in one click.',
  },
  {
    label: '/Model Training',
    desc: 'Upload images, train a custom LoRA, and deploy it from the workspace. Publish to earn on others\' generations.',
  },
  {
    label: '/Spells',
    desc: 'Save multi-step pipelines as on-chain Spells — discoverable, executable, tradeable. Earn a share on every run.',
  },
  {
    label: '/Shared Workspaces',
    desc: 'Share entire node graphs, not just outputs. Restore any saved workspace by ID.',
  },
];

const SIGNALS = [
  'Node canvas — composable, not conversational.',
  'Wallet-native. Earn on every Spell and model you publish.',
  'Web, Telegram, and Discord. One balance, everywhere.',
];

export class Landing extends Component {
  _onEnter(e) {
    e.preventDefault();
    window.location.href = getAppUrl();
  }

  static get styles() {
    return `
      /* ── Animations ─────────────────────────────────────── */

      @keyframes lp-fade-up {
        from { opacity: 0; transform: translateY(14px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      @keyframes lp-sigil-drift {
        from { transform: translate(-38%, -50%) rotate(0deg); }
        to   { transform: translate(-38%, -50%) rotate(360deg); }
      }

      @keyframes lp-scanline {
        0%   { top: -2px; opacity: 0; }
        4%   { opacity: 1; }
        96%  { opacity: 1; }
        100% { top: calc(100% + 2px); opacity: 0; }
      }

      /* ── Root ───────────────────────────────────────────── */

      .lp-root {
        background: var(--canvas-bg);
        color: var(--text-primary);
        overflow-x: hidden;
      }

      /* ── System bar ─────────────────────────────────────── */

      .lp-sysbar {
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 24px;
        border-bottom: var(--border-width) solid var(--border);
        background: var(--surface-1);
      }

      .lp-sysbar span {
        font-family: var(--ff-mono);
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: rgba(221,223,224,0.18);
      }

      /* ── Hero ───────────────────────────────────────────── */

      .lp-hero {
        position: relative;
        min-height: 100vh;
        display: flex;
        align-items: center;
        overflow: hidden;
        /* Orthogonal grid — echoes the ether canvas */
        background-image:
          linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
        background-size: 48px 48px;
        border-bottom: var(--border-width) solid var(--border);
      }

      /* Scanline sweep — implies the system is alive */
      .lp-hero::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(0,223,200,0.18) 15%,
          rgba(0,223,200,0.45) 50%,
          rgba(0,223,200,0.18) 85%,
          transparent 100%
        );
        top: -2px;
        animation: lp-scanline 11s linear 1.5s infinite;
        pointer-events: none;
      }

      /* Sigil — dominant, right-offset, slow rotation */
      .lp-sigil {
        position: absolute;
        top: 50%;
        left: 62%;
        transform: translate(-38%, -50%) rotate(0deg);
        animation: lp-sigil-drift 180s linear infinite;
        pointer-events: none;
      }

      /* Radial fade from left — keeps text readable */
      .lp-hero-vignette {
        position: absolute;
        inset: 0;
        background: radial-gradient(
          ellipse 55% 90% at 20% 50%,
          var(--canvas-bg) 0%,
          rgba(11,12,13,0.6) 60%,
          transparent 100%
        );
        pointer-events: none;
      }

      /* Left-anchored content column */
      .lp-hero-body {
        position: relative;
        z-index: 1;
        padding: 0 64px;
        max-width: 680px;
      }

      .lp-hero-eyebrow {
        font-family: var(--ff-mono);
        font-size: 11px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--accent);
        margin: 0 0 22px;
        display: flex;
        align-items: center;
        gap: 14px;
        animation: lp-fade-up var(--dur-entry) var(--ease) 0.05s both;
      }
      .lp-hero-eyebrow::before {
        content: '';
        display: inline-block;
        width: 28px;
        height: 1px;
        background: var(--accent);
        flex-shrink: 0;
      }

      .lp-wordmark {
        font-family: var(--ff-display);
        font-size: clamp(80px, 12vw, 136px);
        font-weight: var(--fw-bold);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-primary);
        margin: 0;
        line-height: 0.88;
        animation: lp-fade-up var(--dur-entry) var(--ease) 0.12s both;
      }

      /* Accent rule below wordmark */
      .lp-hero-rule {
        height: 1px;
        background: linear-gradient(90deg, var(--accent) 0%, rgba(0,223,200,0.2) 50%, transparent 100%);
        margin: 22px 0;
        animation: lp-fade-up var(--dur-entry) var(--ease) 0.2s both;
      }

      .lp-hero-sub {
        font-family: var(--ff-condensed);
        font-size: clamp(15px, 2vw, 19px);
        font-weight: var(--fw-medium);
        letter-spacing: 0.04em;
        color: var(--text-secondary);
        margin: 0 0 40px;
        line-height: 1.5;
        animation: lp-fade-up var(--dur-entry) var(--ease) 0.28s both;
      }

      .lp-hero-actions {
        display: flex;
        gap: 10px;
        animation: lp-fade-up var(--dur-entry) var(--ease) 0.38s both;
      }

      /* Corner readout — bottom-right annotation */
      .lp-hero-readout {
        position: absolute;
        bottom: 24px;
        right: 28px;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 5px;
        animation: lp-fade-up var(--dur-entry) var(--ease) 0.6s both;
      }
      .lp-readout-line {
        font-family: var(--ff-mono);
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(221,223,224,0.18);
      }
      .lp-readout-line.hi { color: rgba(0,223,200,0.38); }

      /* ── Buttons ────────────────────────────────────────── */

      @keyframes lp-btn-scan {
        from { left: -60%; opacity: 1; }
        to   { left: 120%; opacity: 1; }
      }

      /* CTA — solid teal that wipes to dark on hover */
      .lp-btn-cta {
        position: relative;
        overflow: hidden;
        font-family: var(--ff-mono);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        /* Gradient: dark left half, teal right half — 201% wide */
        background: linear-gradient(
          to right,
          var(--canvas-bg) 50%,
          var(--accent) 50%
        );
        background-size: 201% 100%;
        background-position: 100% center; /* shows teal */
        color: var(--canvas-bg);
        border: var(--border-width) solid var(--accent);
        padding: 10px 26px;
        cursor: pointer;
        text-decoration: none;
        transition:
          background-position 0.38s cubic-bezier(0.4, 0, 0.2, 1),
          color               0.2s  var(--ease);
      }

      /* Glint sweep — fires on hover, passes over both bg states */
      .lp-btn-cta::after {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: -60%;
        width: 40%;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255,255,255,0.18) 50%,
          transparent 100%
        );
        opacity: 0;
        pointer-events: none;
      }

      .lp-btn-cta:hover {
        background-position: 0% center; /* reveals dark side */
        color: var(--accent);
      }
      .lp-btn-cta:hover::after {
        animation: lp-btn-scan 0.42s cubic-bezier(0.4, 0, 0.2, 1) forwards;
      }

      /* Ghost — outline button with teal scan on hover */
      .lp-btn-ghost {
        position: relative;
        overflow: hidden;
        font-family: var(--ff-mono);
        font-size: 12px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--text-label);
        background: none;
        border: var(--border-width) solid var(--border);
        padding: 10px 26px;
        cursor: pointer;
        text-decoration: none;
        transition:
          color        0.2s var(--ease),
          border-color 0.2s var(--ease);
      }

      /* Teal scanline on ghost */
      .lp-btn-ghost::after {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: -60%;
        width: 40%;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(0,223,200,0.2) 50%,
          transparent 100%
        );
        opacity: 0;
        pointer-events: none;
      }

      .lp-btn-ghost:hover {
        color: var(--text-secondary);
        border-color: var(--accent-border);
      }
      .lp-btn-ghost:hover::after {
        animation: lp-btn-scan 0.42s cubic-bezier(0.4, 0, 0.2, 1) forwards;
      }

      /* ── Section divider ────────────────────────────────── */

      .lp-section-bar {
        display: flex;
        align-items: center;
        gap: 14px;
        height: 36px;
        padding: 0 64px;
        border-bottom: var(--border-width) solid var(--border);
        background: var(--surface-1);
      }
      .lp-section-num {
        font-family: var(--ff-mono);
        font-size: 11px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--accent);
      }
      .lp-section-label {
        font-family: var(--ff-mono);
        font-size: 11px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--text-label);
      }

      /* ── Capabilities ───────────────────────────────────── */

      .lp-cap-item {
        display: grid;
        grid-template-columns: 200px 1fr;
        gap: 48px;
        align-items: center;
        padding: 0 64px;
        min-height: 52px;
        border-bottom: var(--border-width) solid var(--border);
        transition: background var(--dur-interact) var(--ease);
        cursor: default;
      }
      .lp-cap-item:last-child { border-bottom: none; }
      .lp-cap-item:hover { background: var(--surface-1); }

      @media (max-width: 640px) {
        .lp-cap-item {
          grid-template-columns: 1fr;
          gap: 6px;
          padding: 14px 24px;
          min-height: unset;
        }
        .lp-cap-desc { opacity: 1; }
      }

      .lp-cap-label {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--text-secondary);
        display: flex;
        align-items: center;
        gap: 10px;
        transition: color var(--dur-interact) var(--ease);
      }
      /* Small square indicator */
      .lp-cap-label::before {
        content: '';
        display: inline-block;
        width: 5px;
        height: 5px;
        border: var(--border-width) solid var(--border);
        flex-shrink: 0;
        transition:
          border-color var(--dur-interact) var(--ease),
          background   var(--dur-interact) var(--ease);
      }
      .lp-cap-item:hover .lp-cap-label { color: var(--accent); }
      .lp-cap-item:hover .lp-cap-label::before {
        border-color: var(--accent);
        background: var(--accent-dim);
      }

      .lp-cap-desc {
        font-family: var(--ff-condensed);
        font-size: 14px;
        letter-spacing: 0.04em;
        color: var(--text-label);
        line-height: 1.45;
        transition: color var(--dur-interact) var(--ease);
      }
      .lp-cap-item:hover .lp-cap-desc { color: var(--text-secondary); }

      /* ── Philosophy ─────────────────────────────────────── */

      .lp-philosophy {
        padding: 88px 64px;
        border-bottom: var(--border-width) solid var(--border);
        background: var(--surface-1);
      }
      .lp-philosophy p {
        font-family: var(--ff-condensed);
        font-size: clamp(17px, 2.4vw, 26px);
        font-weight: var(--fw-medium);
        letter-spacing: 0.03em;
        color: var(--text-secondary);
        line-height: 1.6;
        margin: 0;
        max-width: 680px;
      }
      /* Key phrases in primary */
      .lp-philosophy em {
        font-style: normal;
        color: var(--text-primary);
      }

      /* ── Signals ────────────────────────────────────────── */

      .lp-signal-item {
        display: flex;
        align-items: center;
        gap: 24px;
        padding: 16px 64px;
        border-bottom: var(--border-width) solid var(--border);
        transition: background var(--dur-interact) var(--ease);
      }
      .lp-signal-item:last-child { border-bottom: none; }
      .lp-signal-item:hover { background: var(--surface-1); }

      .lp-signal-num {
        font-family: var(--ff-mono);
        font-size: 11px;
        letter-spacing: 0.2em;
        color: var(--accent);
        flex-shrink: 0;
        width: 22px;
      }
      .lp-signal-text {
        font-family: var(--ff-mono);
        font-size: 13px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--text-secondary);
      }

      @media (max-width: 640px) {
        .lp-hero-body  { padding: 0 24px; }
        .lp-wordmark   { font-size: clamp(56px, 18vw, 96px); }
        .lp-section-bar,
        .lp-signal-item,
        .lp-philosophy { padding-left: 24px; padding-right: 24px; }
        .lp-cta        { padding: 64px 24px 56px; }
        .lp-hero-readout { display: none; }
      }

      /* ── Final CTA ──────────────────────────────────────── */

      .lp-cta {
        position: relative;
        padding: 112px 64px 100px;
        overflow: hidden;
        /* Accent-tinted version of the canvas grid */
        background-image:
          linear-gradient(rgba(0,223,200,0.018) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,223,200,0.018) 1px, transparent 1px);
        background-size: 48px 48px;
      }

      .lp-cta-headline {
        font-family: var(--ff-display);
        font-size: clamp(36px, 6vw, 76px);
        font-weight: var(--fw-bold);
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--text-primary);
        margin: 0 0 6px;
        line-height: 0.92;
      }

      .lp-cta-sub {
        font-family: var(--ff-mono);
        font-size: 12px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--text-label);
        margin: 0 0 36px;
      }
    `;
  }

  render() {
    return h('div', { className: 'lp-root' },

      /* System bar */
      h('div', { className: 'lp-sysbar' },
        h('span', null, 'SYS.NOEMA.01'),
        h('span', null, 'Composable Generative Studio'),
      ),

      /* Hero */
      h('section', { className: 'lp-hero' },
        h(Sigil, { size: 920, opacity: 0.055, className: 'lp-sigil' }),
        h('div', { className: 'lp-hero-vignette' }),

        h('div', { className: 'lp-hero-body' },
          h('p', { className: 'lp-hero-eyebrow' }, 'Composable Generative Studio'),
          h('h1', { className: 'lp-wordmark' }, 'NOEMA'),
          h('div', { className: 'lp-hero-rule' }),
          h('p', { className: 'lp-hero-sub' },
            'Wire image, video, and text tools into production pipelines on a node canvas.'
          ),
          h('div', { className: 'lp-hero-actions' },
            h('button', { className: 'lp-btn-cta', onclick: this.bind(this._onEnter) }, 'Enter Console'),
            h('a', { href: '/docs', className: 'lp-btn-ghost' }, 'Documentation'),
          ),
        ),

        /* Corner readout annotation */
        h('div', { className: 'lp-hero-readout' },
          h('span', { className: 'lp-readout-line hi' }, 'Status: Online'),
          h('span', { className: 'lp-readout-line' }, 'Any model'),
          h('span', { className: 'lp-readout-line' }, 'Any tool'),
        ),
      ),

      /* Capabilities */
      h('div', { className: 'lp-section-bar' },
        h('span', { className: 'lp-section-num' }, '01'),
        h('span', { className: 'lp-section-label' }, 'Capabilities'),
      ),
      h('section', null,
        ...CAPABILITIES.map(c =>
          h('div', { className: 'lp-cap-item', key: c.label },
            h('div', { className: 'lp-cap-label' }, c.label),
            h('div', { className: 'lp-cap-desc' }, c.desc),
          )
        ),
      ),

      /* Philosophy */
      h('div', { className: 'lp-section-bar' },
        h('span', { className: 'lp-section-num' }, '02'),
        h('span', { className: 'lp-section-label' }, 'About'),
      ),
      h('section', { className: 'lp-philosophy' },
        h('p', null,
          'Noema is an open ',
          h('em', null, 'node-based canvas'),
          ' for generating and remixing media. Wire image, video, and text tools together, train custom models, batch-produce collections. ',
          h('em', null, 'Publish your pipelines to earn on every run.')
        ),
      ),

      /* Signals */
      h('div', { className: 'lp-section-bar' },
        h('span', { className: 'lp-section-num' }, '03'),
        h('span', { className: 'lp-section-label' }, 'Principles'),
      ),
      h('section', null,
        ...SIGNALS.map((s, i) =>
          h('div', { className: 'lp-signal-item', key: s },
            h('span', { className: 'lp-signal-num' }, `0${i + 1}`),
            h('span', { className: 'lp-signal-text' }, s),
          )
        ),
      ),

      /* Final CTA */
      h('section', { className: 'lp-cta' },
        h('p', { className: 'lp-cta-headline' }, 'Enter the console.'),
        h('p', { className: 'lp-cta-sub' }, 'No account required'),
        h('button', { className: 'lp-btn-cta', onclick: this.bind(this._onEnter) }, 'Enter Console'),
      ),
    );
  }
}
