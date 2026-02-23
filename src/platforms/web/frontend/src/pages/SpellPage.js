import { Component, h } from '@monygroupcorp/microact';
import { fetchJson, postWithCsrf } from '../lib/api.js';
import { websocketClient } from '../lib/websocket.js';
import { BuyPointsModal } from '../sandbox/components/BuyPointsModal.js';

// ── Output normalizer ─────────────────────────────────────────────────────────
// Collapses the many server output shapes into { type, url|text }.

function normalizeOutput(raw) {
  if (!raw) return { type: 'text', text: 'No output' };

  // Array format: [{ type, data }]
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (!first) return { type: 'text', text: 'No output' };
    const imgUrl = first.data?.images?.[0]?.url ?? (typeof first.data?.images?.[0] === 'string' ? first.data.images[0] : null);
    if (imgUrl) return { type: 'image', url: imgUrl };
    if (first.data?.text) {
      const t = first.data.text;
      return { type: 'text', text: Array.isArray(t) ? t.join('\n\n') : String(t) };
    }
    if (typeof first === 'string') return { type: 'text', text: raw.join('\n\n') };
  }

  // Single-output object — ranked by specificity
  if (raw.artifactUrls?.length) return { type: 'image', url: raw.artifactUrls[0] };
  if (raw.images?.length) {
    const img = raw.images[0];
    return { type: 'image', url: typeof img === 'string' ? img : img.url };
  }
  if (raw.imageUrl) return { type: 'image', url: raw.imageUrl };
  if (raw.image)    return { type: 'image', url: raw.image };
  if (raw.video)    return { type: 'video', url: raw.video };
  if (raw.videoUrl) return { type: 'video', url: raw.videoUrl };

  const txt = raw.text ?? raw.response ?? raw.data?.text ?? raw.data?.response ?? raw.result;
  if (txt != null) {
    const s = Array.isArray(txt) ? txt.join('\n\n') : String(txt);
    return { type: 'text', text: s };
  }

  return { type: 'text', text: JSON.stringify(raw, null, 2) };
}

// ── SpellPage ─────────────────────────────────────────────────────────────────

export class SpellPage extends Component {
  constructor(props) {
    super(props);

    // Extract slug from the URL — works for /spells/<slug>
    const parts = window.location.pathname.split('/').filter(Boolean);
    this._slug = parts[parts.length - 1] || '';

    // Execution tracking (not in state to avoid spurious re-renders)
    this._castId      = null;
    this._runTs       = 0;
    this._pollTimer   = null;

    this.state = {
      loading:      true,
      spell:        null,
      metaError:    null,
      user:         null,       // dashboard payload
      inputs:       {},
      quote:        null,
      quoteLoading: false,
      quoteError:   null,
      running:      false,
      execStatus:   null,       // null|'started'|'progress'|'done'|'error'
      progress:     null,
      progressStep: null,
      error:        null,
      generations:  null,       // array of generation objects from server
      showBuyPoints: false,
    };

    this._onGenerationUpdate   = this._onGenerationUpdate.bind(this);
    this._onGenerationProgress = this._onGenerationProgress.bind(this);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async didMount() {
    websocketClient.connect();
    websocketClient.on('generationUpdate',   this._onGenerationUpdate);
    websocketClient.on('generationProgress', this._onGenerationProgress);

    // Fetch metadata and user dashboard concurrently
    await Promise.all([this._fetchMeta(), this._fetchUser()]);
  }

  willUnmount() {
    websocketClient.off('generationUpdate',   this._onGenerationUpdate);
    websocketClient.off('generationProgress', this._onGenerationProgress);
    this._stopPolling();
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  async _fetchMeta() {
    try {
      const spell = await fetchJson(`/api/v1/spells/${this._slug}`);
      this.setState({ spell, loading: false });
      this._fetchQuote(spell._id || spell.id);
    } catch (err) {
      this.setState({ metaError: err.message, loading: false });
    }
  }

  async _fetchUser() {
    try {
      const user = await fetchJson('/api/v1/user/dashboard');
      this.setState({ user });
    } catch {
      // Guest / unauthenticated — treated gracefully in run logic
    }
  }

  async _fetchQuote(spellId) {
    if (!spellId) return;
    this.setState({ quoteLoading: true, quoteError: null });
    try {
      const res = await postWithCsrf(`/api/v1/spells/${spellId}/quote`, { sampleSize: 10 });
      if (!res.ok) throw new Error(`Quote request failed (${res.status})`);
      const quote = await res.json();
      this.setState({ quote, quoteLoading: false });
    } catch (err) {
      this.setState({ quoteError: err.message, quoteLoading: false });
    }
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  async _run() {
    const { spell, inputs, quote, user } = this.state;
    if (!spell) return;

    this._stopPolling();
    this._castId = null;
    this._runTs  = Date.now();

    this.setState({ running: true, error: null, execStatus: 'started', generations: null, progress: null });

    const hasCost = (quote?.totalCostPts ?? 0) > 0;
    const balance = user ? parseFloat(user.points ?? 0) : null;

    // Insufficient points → open BuyPointsModal instead of attempting cast
    if (hasCost && (balance === null || balance < quote.totalCostPts)) {
      this.setState({ running: false, showBuyPoints: true, execStatus: null });
      return;
    }

    try {
      const res = await postWithCsrf('/api/v1/spells/cast', {
        slug: this._slug,
        context: {
          parameterOverrides: inputs,
          ...(hasCost ? { quote, chargeUpfront: true } : { chargeUpfront: false }),
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg  = data.error?.message ?? 'Spell execution failed';
        if (/insufficient points/i.test(msg)) {
          this.setState({ running: false, showBuyPoints: true, execStatus: null });
          return;
        }
        throw new Error(msg);
      }

      const { castId } = await res.json();
      this._castId = castId || null;

      if (castId) this._startPolling(castId);
      // WebSocket generationUpdate will cancel polling if it arrives first
    } catch (err) {
      this.setState({ running: false, error: err.message, execStatus: 'error' });
    }
  }

  // ── WebSocket handlers ────────────────────────────────────────────────────

  _onGenerationUpdate(payload) {
    const { castId, outputs, status } = payload;
    if (castId && this._castId && castId !== this._castId) return;
    if (Date.now() - this._runTs > 90_000) return;

    if (status === 'completed' || status === 'success') {
      this._stopPolling();
      const normalized = normalizeOutput(outputs);
      this.setState({ running: false, execStatus: 'done', generations: [{ _normalized: normalized }] });
    } else if (status === 'failed' || status === 'error') {
      this._stopPolling();
      this.setState({ running: false, execStatus: 'error', error: payload.error ?? 'Execution failed' });
    }
  }

  _onGenerationProgress(payload) {
    const { castId, progress, toolId } = payload;
    if (castId && this._castId && castId !== this._castId) return;
    if (Date.now() - this._runTs > 90_000) return;
    this.setState({ execStatus: 'progress', progress, progressStep: toolId ?? null });
  }

  // ── Polling fallback ──────────────────────────────────────────────────────

  _startPolling(castId) {
    let delay = 2000;
    let count = 0;
    const MAX = 150;

    const tick = async () => {
      if (!this._castId || count++ >= MAX) { this._stopPolling(); return; }
      try {
        const cast = await fetchJson(`/api/v1/spells/casts/${castId}`);
        if (cast.status === 'completed' || cast.status === 'success') {
          this._stopPolling();
          await this._resolveGenerations(cast);
        } else if (cast.status === 'failed' || cast.status === 'error') {
          this._stopPolling();
          this.setState({ running: false, execStatus: 'error', error: cast.error ?? 'Execution failed' });
        } else {
          delay = Math.min(delay * 1.2, 10_000);
          this._pollTimer = setTimeout(tick, delay);
        }
      } catch {
        delay = Math.min(delay * 1.2, 10_000);
        this._pollTimer = setTimeout(tick, delay);
      }
    };

    tick();
  }

  async _resolveGenerations(cast) {
    const ids = cast.stepGenerationIds ?? cast.generationIds ?? [];
    if (!ids.length) {
      this.setState({ running: false, execStatus: 'done', generations: [] });
      return;
    }
    try {
      const res = await postWithCsrf('/api/v1/generations/status', { generationIds: ids });
      if (!res.ok) throw new Error('generation fetch failed');
      const data = await res.json();
      this.setState({ running: false, execStatus: 'done', generations: data.generations ?? [] });
    } catch {
      this.setState({ running: false, execStatus: 'done', generations: [] });
    }
  }

  _stopPolling() {
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  static get styles() {
    return `
      .sp-page { max-width: 760px; margin: 0 auto; padding: 2rem 1rem 4rem; }

      .sp-header { margin-bottom: 1.5rem; }
      .sp-header h1 { font-size: 1.75rem; color: #e0e0e0; margin: 0 0 0.5rem; font-weight: 700; }
      .sp-header .sp-desc { color: #aaa; line-height: 1.55; margin: 0 0 0.4rem; }
      .sp-header .sp-author { font-size: 0.82rem; color: #555; }

      .sp-card { background: #111; border: 1px solid #1e1e1e; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; }
      .sp-section-label { font-size: 0.78rem; color: #555; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 0.9rem; font-weight: 600; }

      .sp-form-group { margin-bottom: 0.9rem; }
      .sp-form-group label { display: block; font-size: 0.83rem; color: #888; margin-bottom: 0.35rem; }
      .sp-input {
        width: 100%; padding: 0.5rem 0.75rem; background: #1a1a1a; border: 1px solid #2a2a2a;
        border-radius: 5px; color: #e0e0e0; font-size: 0.9rem; box-sizing: border-box;
      }
      .sp-input:focus { border-color: #444; outline: none; }

      .sp-cost-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; margin-bottom: 0.35rem; }
      .sp-cost-label { color: #666; }
      .sp-cost-val { color: #e0e0e0; font-weight: 600; }
      .sp-balance { font-size: 0.82rem; margin-top: 0.6rem; padding-top: 0.6rem; border-top: 1px solid #1a1a1a; display: flex; justify-content: space-between; }
      .sp-ok  { color: #4caf50; }
      .sp-low { color: #ff9800; }

      .sp-run {
        width: 100%; padding: 0.7rem 1rem; background: #fff; color: #0a0a0a;
        border: none; border-radius: 6px; font-size: 0.95rem; font-weight: 700;
        cursor: pointer; margin-top: 1rem;
      }
      .sp-run:hover:not(:disabled) { background: #e0e0e0; }
      .sp-run:disabled { background: #282828; color: #555; cursor: not-allowed; }

      .sp-status { font-size: 0.88rem; color: #888; padding: 0.75rem 1rem; background: #111; border: 1px solid #1e1e1e; border-radius: 6px; margin-bottom: 0.75rem; }
      .sp-status-err { color: #f77; border-color: #3a1a1a; background: #1e1010; }

      .sp-out { margin-top: 1.5rem; }
      .sp-out-title { font-size: 1rem; color: #ccc; font-weight: 600; margin: 0 0 1rem; }

      .sp-step { margin-bottom: 0.9rem; padding: 1rem; background: #131313; border-radius: 6px; border-left: 3px solid #2a2a2a; }
      .sp-step-label { font-size: 0.78rem; color: #90caf9; margin-bottom: 0.5rem; font-weight: 600; }
      .sp-step img, .sp-step video { max-width: 100%; border-radius: 5px; margin-top: 0.5rem; display: block; }
      .sp-step pre { background: #0d0d0d; padding: 0.75rem; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; color: #bbb; font-size: 0.82rem; margin: 0.5rem 0 0; }

      .sp-final { margin-top: 1.25rem; padding: 1.25rem; background: #0b1a12; border-radius: 8px; border: 2px solid #2a6644; }
      .sp-final-label { font-size: 0.78rem; color: #4caf50; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.85rem; }
      .sp-final img, .sp-final video { max-width: 100%; border-radius: 6px; display: block; }
      .sp-final pre { background: #0d0d0d; padding: 1rem; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; color: #e0e0e0; font-size: 0.9rem; line-height: 1.55; margin: 0; }
    `;
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  _renderMedia(normalized, cls) {
    if (normalized.type === 'image' && normalized.url) {
      return h('img', { src: normalized.url, alt: 'Output' });
    }
    if (normalized.type === 'video' && normalized.url) {
      return h('video', { controls: true },
        h('source', { src: normalized.url, type: 'video/mp4' })
      );
    }
    const text = normalized.text != null
      ? (typeof normalized.text === 'string' ? normalized.text : JSON.stringify(normalized.text, null, 2))
      : JSON.stringify(normalized, null, 2);
    return h('pre', null, text);
  }

  _renderGenerations(generations) {
    if (!generations.length) {
      return h('div', { className: 'sp-status' }, 'Execution complete — no outputs returned.');
    }

    const steps = generations.length > 1
      ? generations.slice(0, -1).map((gen, i) => {
          const raw        = gen._normalized ?? gen.responsePayload ?? gen.outputs;
          const normalized = gen._normalized ?? normalizeOutput(raw);
          const label      = gen.toolId ?? gen.toolDisplayName ?? `Step ${i + 1}`;
          return h('div', { className: 'sp-step', key: i },
            h('div', { className: 'sp-step-label' }, label),
            this._renderMedia(normalized)
          );
        })
      : [];

    const last    = generations[generations.length - 1];
    const lastRaw = last._normalized ?? last.responsePayload ?? last.outputs;
    const final   = last._normalized ?? normalizeOutput(lastRaw);

    return h('div', { className: 'sp-out' },
      h('div', { className: 'sp-out-title' }, 'Spell Complete'),
      ...steps,
      h('div', { className: 'sp-final' },
        h('div', { className: 'sp-final-label' }, 'Result'),
        this._renderMedia(final)
      )
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render() {
    const {
      loading, spell, metaError, user, inputs, quote, quoteLoading, quoteError,
      running, execStatus, progress, progressStep, error, generations, showBuyPoints,
    } = this.state;

    // BuyPointsModal overlays the page
    const buyPointsModal = showBuyPoints
      ? h(BuyPointsModal, {
          onClose: () => {
            this.setState({ showBuyPoints: false });
            this._fetchUser(); // refresh balance after potential purchase
          },
        })
      : null;

    if (loading) {
      return h('div', { className: 'sp-page' },
        buyPointsModal,
        h('div', { className: 'sp-status' }, 'Loading spell...')
      );
    }

    if (metaError) {
      return h('div', { className: 'sp-page' },
        buyPointsModal,
        h('div', { className: 'sp-status sp-status-err' }, `Failed to load spell: ${metaError}`)
      );
    }

    const { exposedInputs = [] } = spell;
    const balance   = user ? parseFloat(user.points ?? 0) : null;
    const cost      = quote?.totalCostPts ?? 0;
    const hasEnough = balance !== null && balance >= cost;
    const quoteReady = quote !== null || quoteError !== null;
    const canRun    = !running && quoteReady;

    return h('div', { className: 'sp-page' },
      buyPointsModal,

      // Header
      h('div', { className: 'sp-header' },
        h('h1', null, spell.name),
        spell.description ? h('p', { className: 'sp-desc' }, spell.description) : null,
        spell.author ? h('p', { className: 'sp-author' }, `By ${spell.author}`) : null
      ),

      // Input form (only if spell exposes inputs)
      exposedInputs.length > 0
        ? h('div', { className: 'sp-card' },
            h('div', { className: 'sp-section-label' }, 'Inputs'),
            ...exposedInputs.map(inp =>
              h('div', { className: 'sp-form-group', key: inp.paramKey },
                h('label', null, inp.paramKey),
                h('input', {
                  className: 'sp-input',
                  type: 'text',
                  value: inputs[inp.paramKey] ?? '',
                  placeholder: inp.defaultValue ?? '',
                  oninput: (e) => this.setState({ inputs: { ...inputs, [inp.paramKey]: e.target.value } }),
                })
              )
            )
          )
        : null,

      // Cost estimate + run button
      h('div', { className: 'sp-card' },
        quoteLoading
          ? h('div', { className: 'sp-status', style: { marginBottom: 0 } }, 'Estimating cost...')
          : quoteError
            ? h('div', { style: { color: '#666', fontSize: '0.85rem', marginBottom: '0.5rem' } }, 'Cost estimate unavailable — you can still run this spell.')
            : quote
              ? h('div', null,
                  cost > 0
                    ? h('div', null,
                        h('div', { className: 'sp-cost-row' },
                          h('span', { className: 'sp-cost-label' }, 'Estimated cost'),
                          h('span', { className: 'sp-cost-val' }, `${cost.toFixed(0)} pts`)
                        ),
                        balance !== null
                          ? h('div', { className: 'sp-balance' },
                              h('span', { style: { color: '#666' } }, 'Your balance'),
                              h('span', { className: hasEnough ? 'sp-ok' : 'sp-low' },
                                `${balance.toFixed(2)} pts${hasEnough ? '' : ' — need more'}`
                              )
                            )
                          : null
                      )
                    : h('div', { style: { color: '#666', fontSize: '0.85rem' } }, 'Free — no points required.')
                )
              : null,

        h('button', {
          className: 'sp-run',
          disabled: !canRun,
          onclick: () => this._run(),
        }, running ? 'Running...' : 'Run Spell')
      ),

      // Execution status messages
      execStatus === 'started'
        ? h('div', { className: 'sp-status' }, 'Spell started. Waiting for results...')
        : execStatus === 'progress' && progress != null
          ? h('div', { className: 'sp-status' },
              `Running... ${Math.round(progress)}%`,
              progressStep ? ` — ${progressStep}` : ''
            )
          : null,

      error
        ? h('div', { className: 'sp-status sp-status-err' }, `Error: ${error}`)
        : null,

      // Outputs
      generations !== null ? this._renderGenerations(generations) : null
    );
  }
}
