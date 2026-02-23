import { Component, h } from '@monygroupcorp/microact';
import { getAppUrl } from '../lib/urls.js';
import { Sigil } from '../sandbox/components/Sigil.js';

const CAPABILITIES = [
  {
    label: '/Generation',
    desc: 'Compose chains of image, audio, video, and text tools into production workflows.',
  },
  {
    label: '/Model Training',
    desc: 'Fine-tune and deploy custom models directly from the workspace.',
  },
  {
    label: '/NFT Systems',
    desc: 'Publish workflows as on-chain spells — discoverable, executable, tradeable.',
  },
  {
    label: '/Shared Workspaces',
    desc: 'Share entire systems, not just outputs. Collaborate on live production environments.',
  },
];

const SIGNALS = [
  'Open workflows. No closed pipelines.',
  'Wallet-native collaboration.',
  'Designed for production, not prompts.',
];

export class Landing extends Component {
  _onEnter(e) {
    e.preventDefault();
    window.location.href = getAppUrl();
  }

  static get styles() {
    return `
      /* ── Root ───────────────────────────────────────────── */
      .lp-root {
        background: var(--canvas-bg);
        color: var(--text-primary);
        font-family: var(--ff-condensed);
      }

      /* ── Hero ───────────────────────────────────────────── */
      .lp-hero {
        position: relative;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border-bottom: var(--border-width) solid var(--border);
      }

      .lp-sigil {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
      }

      .lp-hero-body {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 32px;
        text-align: center;
        padding: 0 24px;
      }

      .lp-hero-headline {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }

      .lp-wordmark {
        font-family: var(--ff-display);
        font-size: clamp(56px, 8vw, 96px);
        font-weight: var(--fw-bold);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-primary);
        margin: 0;
        line-height: 1;
        animation: fadeIn var(--dur-entry) var(--ease) 0.1s both;
      }

      .lp-studio-tag {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-label);
        margin: 0;
        animation: fadeIn var(--dur-entry) var(--ease) 0.2s both;
      }

      .lp-hero-sub {
        font-family: var(--ff-condensed);
        font-size: clamp(14px, 2vw, 18px);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-wide);
        color: var(--text-secondary);
        margin: 0;
        animation: fadeIn var(--dur-entry) var(--ease) 0.3s both;
      }

      .lp-hero-actions {
        display: flex;
        gap: 12px;
        animation: fadeIn var(--dur-entry) var(--ease) 0.45s both;
      }

      .lp-btn-cta {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--accent);
        background: var(--accent-dim);
        border: var(--border-width) solid var(--accent-border);
        padding: 8px 24px;
        cursor: pointer;
        text-decoration: none;
        transition:
          background   var(--dur-interact) var(--ease),
          border-color var(--dur-interact) var(--ease);
      }
      .lp-btn-cta:hover {
        background: rgba(0,223,200,0.2);
        border-color: var(--accent);
      }

      .lp-btn-ghost {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-label);
        background: none;
        border: var(--border-width) solid var(--border);
        padding: 8px 24px;
        cursor: pointer;
        text-decoration: none;
        transition:
          color        var(--dur-interact) var(--ease),
          border-color var(--dur-interact) var(--ease);
      }
      .lp-btn-ghost:hover {
        color: var(--text-secondary);
        border-color: var(--border-hover);
      }

      /* ── Capability Strip ───────────────────────────────── */
      .lp-capabilities {
        border-bottom: var(--border-width) solid var(--border);
      }

      .lp-cap-item {
        border-bottom: var(--border-width) solid var(--border);
        padding: 20px 48px;
        cursor: default;
        transition: background var(--dur-interact) var(--ease);
      }
      .lp-cap-item:last-child { border-bottom: none; }
      .lp-cap-item:hover { background: var(--surface-1); }

      .lp-cap-label {
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-secondary);
        transition: color var(--dur-interact) var(--ease);
      }
      .lp-cap-item:hover .lp-cap-label { color: var(--accent); }

      .lp-cap-desc {
        font-family: var(--ff-condensed);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-wide);
        color: var(--text-label);
        max-height: 0;
        overflow: hidden;
        opacity: 0;
        transition:
          max-height 0.28s var(--ease),
          opacity    0.22s var(--ease),
          margin-top 0.22s var(--ease);
        margin-top: 0;
      }
      .lp-cap-item:hover .lp-cap-desc {
        max-height: 3em;
        opacity: 1;
        margin-top: 8px;
      }

      /* ── Philosophy ─────────────────────────────────────── */
      .lp-philosophy {
        padding: 80px 48px;
        border-bottom: var(--border-width) solid var(--border);
        max-width: 640px;
      }

      .lp-philosophy p {
        font-family: var(--ff-condensed);
        font-size: clamp(16px, 2.2vw, 22px);
        font-weight: var(--fw-medium);
        letter-spacing: var(--ls-wide);
        color: var(--text-secondary);
        line-height: 1.65;
        margin: 0;
      }

      /* ── Signals ────────────────────────────────────────── */
      .lp-signals {
        border-bottom: var(--border-width) solid var(--border);
      }

      .lp-signal-item {
        padding: 16px 48px;
        border-bottom: var(--border-width) solid var(--border);
        font-family: var(--ff-mono);
        font-size: var(--fs-xs);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-label);
      }
      .lp-signal-item:last-child { border-bottom: none; }

      /* ── Final CTA ──────────────────────────────────────── */
      .lp-cta {
        padding: 100px 48px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 32px;
      }

      .lp-cta-headline {
        font-family: var(--ff-display);
        font-size: clamp(28px, 4vw, 48px);
        font-weight: var(--fw-bold);
        letter-spacing: var(--ls-widest);
        text-transform: uppercase;
        color: var(--text-primary);
        margin: 0;
      }
    `;
  }

  render() {
    return h('div', { className: 'lp-root' },

      /* Hero */
      h('section', { className: 'lp-hero' },
        h(Sigil, { size: 520, opacity: 0.04, className: 'lp-sigil' }),
        h('div', { className: 'lp-hero-body' },
          h('div', { className: 'lp-hero-headline' },
            h('h1', { className: 'lp-wordmark' }, 'NOEMA'),
            h('p',  { className: 'lp-studio-tag'  }, 'Composable Generative Studio.'),
          ),
          h('p', { className: 'lp-hero-sub' }, 'Build, train, and publish AI workflows.'),
          h('div', { className: 'lp-hero-actions' },
            h('button', { className: 'lp-btn-cta', onclick: this.bind(this._onEnter) }, 'Enter Console'),
            h('a', { href: '/docs', className: 'lp-btn-ghost' }, 'Documentation'),
          ),
        ),
      ),

      /* Capability Strip */
      h('section', { className: 'lp-capabilities' },
        ...CAPABILITIES.map(c =>
          h('div', { className: 'lp-cap-item', key: c.label },
            h('div', { className: 'lp-cap-label' }, c.label),
            h('div', { className: 'lp-cap-desc' }, c.desc),
          )
        ),
      ),

      /* Philosophy */
      h('section', { className: 'lp-philosophy' },
        h('p', null,
          'Noema is an open composable environment for building production-ready AI workflows. ',
          'Use any model. Connect any tool. Share entire systems, not just outputs.'
        ),
      ),

      /* Signals */
      h('section', { className: 'lp-signals' },
        ...SIGNALS.map(s =>
          h('div', { className: 'lp-signal-item', key: s }, s)
        ),
      ),

      /* Final CTA */
      h('section', { className: 'lp-cta' },
        h('p', { className: 'lp-cta-headline' }, 'Enter the console.'),
        h('button', { className: 'lp-btn-cta', onclick: this.bind(this._onEnter) }, 'Enter Console'),
      ),
    );
  }
}
