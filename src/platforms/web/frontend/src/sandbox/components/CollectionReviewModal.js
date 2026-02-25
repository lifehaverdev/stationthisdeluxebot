import { Component, h } from '@monygroupcorp/microact';
import { ResultDisplay } from './windows/ResultDisplay.js';
import { Loader } from './Modal.js';

// Batch / flush constants — preserved from original CollectionWindow.js
const MAX_REVIEW_BATCH_SIZE = 100;
const DEFAULT_REVIEW_BATCH_SIZE = 80;
const DEFAULT_REVIEW_PREFETCH_THRESHOLD = 3;
const DEFAULT_REVIEW_FLUSH_THRESHOLD = 12;
const DEFAULT_REVIEW_FLUSH_INTERVAL_MS = 5000;
const MAX_REVIEW_SUBMISSION_BATCH_SIZE = 50;
const CULL_STATS_MIN_INTERVAL_MS = 2500;
const CULL_REVIEW_FLUSH_THRESHOLD = 10;
const CULL_REVIEW_FLUSH_INTERVAL_MS = 15000;
const CULL_REVIEW_IDLE_FLUSH_DELAY_MS = 15000;
const REVIVE_PAGE_SIZE = 16;

const MODE = { REVIEW: 'review', CULL: 'cull', REVIVE: 'revive' };

/**
 * CollectionReviewModal — microact port of the original CollectionWindow review system.
 *
 * Modes:
 *   review — first-pass accept/reject of generated pieces
 *   cull   — second-pass keep/exclude of accepted pieces (with cull stats)
 *   revive — browse excluded pieces and revive them back to kept
 *
 * Batch architecture (preserved from original):
 *   - Fetches pieces in configurable batches (default 80) from /api/v1/review-queue/pop
 *   - Prefetches next batch when queue drops to <= prefetchThreshold
 *   - Buffers decisions locally and flushes in batches to avoid 429s
 *   - Flush triggers: threshold count, idle timer, beforeunload / visibilitychange
 *   - Exponential backoff retry on failed flushes
 *   - 429-aware: reads Retry-After header and waits accordingly
 *   - Falls back to legacy /pieces/unreviewed API if queue API returns nothing
 *
 * Props:
 *   collection — full collection document
 *   onClose    — () => void
 */
export class CollectionReviewModal extends Component {
  constructor(props) {
    super(props);

    const col = props.collection;
    const batchSize = Math.min(
      Math.max(col?.config?.reviewBatchSize || DEFAULT_REVIEW_BATCH_SIZE, 1),
      MAX_REVIEW_BATCH_SIZE
    );
    const prefetchCfg = col?.config?.reviewPrefetchThreshold ?? DEFAULT_REVIEW_PREFETCH_THRESHOLD;
    const flushThreshold = Math.min(
      Math.max(col?.config?.reviewFlushThreshold || DEFAULT_REVIEW_FLUSH_THRESHOLD, 1),
      MAX_REVIEW_SUBMISSION_BATCH_SIZE
    );
    const flushInterval = Math.max(Number(col?.config?.reviewFlushIntervalMs) || DEFAULT_REVIEW_FLUSH_INTERVAL_MS, 1000);

    this.state = {
      mode: MODE.REVIEW,
      // Review / cull
      current: null,       // { queueId, generationId, generation }
      loading: false,
      done: false,
      error: null,
      syncText: '',
      syncVariant: 'ok',  // 'ok' | 'pending' | 'error' | 'ratelimit'
      pendingCount: 0,
      // Cull stats
      cullStats: null,
      cullStatsLoading: false,
      // Revive
      reviveCurrent: null,
      reviveLoading: false,
      reviveDone: false,
    };

    // ── Batch engine (non-rendered instance state) ──
    this._reviewQueue = [];
    this._activeReview = null;
    this._pendingReviewDecisions = [];
    this._reviewFetchPromise = null;
    this._reviewFlushPromise = null;
    this._reviewFlushTimer = null;
    this._reviewFlushRetryTimer = null;
    this._reviewFlushRetryAttempts = 0;
    this._reviewFlushBackoffMs = 2500;
    this._lastReviewActionAt = 0;
    this._usingLegacyReviewApi = false;
    this._claimedQueueIds = new Set();
    this._pendingCullIds = new Set();
    // Cull stats
    this._cullStatsLoading = false;
    this._cullStatsPromise = null;
    this._lastCullStatsFetchAt = 0;
    this._pendingCullStatsTimeout = null;
    // Revive
    this._reviveItems = [];
    this._reviveCursor = null;
    this._reviveFetchPromise = null;
    this._reviveCompleted = false;

    // Batch config
    this._reviewBatchSize = batchSize;
    this._reviewPrefetchThreshold = Math.max(1, Math.min(prefetchCfg, Math.max(1, batchSize - 1)));
    this._reviewFlushThreshold = flushThreshold;
    this._reviewFlushIntervalMs = flushInterval;
    this._reviewIdleFlushDelayMs = Math.max(flushInterval, DEFAULT_REVIEW_FLUSH_INTERVAL_MS);
    this._baseFlushThreshold = flushThreshold;
    this._baseFlushInterval = flushInterval;
    this._baseIdleDelay = this._reviewIdleFlushDelayMs;

    // Lifecycle handlers
    this._boundVisibility = () => {
      if (document.visibilityState === 'hidden')
        this._flushPendingReviews({ force: true, keepAlive: true }).catch(() => {});
    };
    this._boundBeforeUnload = () => {
      this._flushPendingReviews({ force: true, keepAlive: true }).catch(() => {});
    };
  }

  didMount() {
    document.addEventListener('visibilitychange', this._boundVisibility);
    window.addEventListener('beforeunload', this._boundBeforeUnload);
    this._loadNextReview({ showLoading: true });
  }

  willUnmount() {
    document.removeEventListener('visibilitychange', this._boundVisibility);
    window.removeEventListener('beforeunload', this._boundBeforeUnload);
    if (this._reviewFlushTimer) clearTimeout(this._reviewFlushTimer);
    if (this._reviewFlushRetryTimer) clearTimeout(this._reviewFlushRetryTimer);
    if (this._pendingCullStatsTimeout) clearTimeout(this._pendingCullStatsTimeout);
    this._flushPendingReviews({ force: true, keepAlive: true }).catch(() => {});
  }

  get collection() { return this.props.collection; }
  get isCullMode() { return this.state.mode === MODE.CULL; }

  // ── Mode switching ──────────────────────────────────────────────────────────

  _switchMode(mode) {
    if (this.state.mode === mode) return;
    this._flushPendingReviews({ force: true }).catch(() => {});
    // Reset queue for new mode
    this._reviewQueue = [];
    this._activeReview = null;
    this._pendingCullIds = new Set();
    this._claimedQueueIds = new Set();
    this._usingLegacyReviewApi = false;
    this._applyFlushSettings(mode);

    const next = { mode, current: null, loading: false, done: false, error: null };
    if (mode === MODE.REVIVE) {
      this._reviveItems = [];
      this._reviveCursor = null;
      this._reviveCompleted = false;
      Object.assign(next, { reviveCurrent: null, reviveLoading: false, reviveDone: false });
    }
    this.setState(next);

    if (mode === MODE.REVIEW || mode === MODE.CULL) {
      if (mode === MODE.CULL) this._fetchCullStats({ force: true });
      this._loadNextReview({ showLoading: true });
    } else {
      this._fetchCullStats({ force: true });
      this._loadNextRevive();
    }
  }

  _applyFlushSettings(mode) {
    if (mode === MODE.CULL) {
      this._reviewFlushThreshold = Math.min(Math.max(1, CULL_REVIEW_FLUSH_THRESHOLD), MAX_REVIEW_SUBMISSION_BATCH_SIZE);
      this._reviewFlushIntervalMs = Math.max(CULL_REVIEW_FLUSH_INTERVAL_MS, 1000);
      this._reviewIdleFlushDelayMs = Math.max(this._reviewFlushIntervalMs, CULL_REVIEW_IDLE_FLUSH_DELAY_MS);
    } else {
      this._reviewFlushThreshold = this._baseFlushThreshold;
      this._reviewFlushIntervalMs = this._baseFlushInterval;
      this._reviewIdleFlushDelayMs = this._baseIdleDelay;
    }
  }

  // ── Review / cull: load & fetch ─────────────────────────────────────────────

  async _loadNextReview({ showLoading = false } = {}) {
    if (showLoading) this.setState({ loading: true, current: null, error: null });
    this._maybePrefetch();

    if (!this._reviewQueue.length) {
      const fetched = await this._fetchReviewBatch({ showLoading });
      if (!fetched) {
        this.setState({ loading: false, done: true, current: null });
        return;
      }
    }

    const entry = this._reviewQueue.shift();
    if (!entry) {
      this.setState({ loading: false, done: true, current: null });
      return;
    }

    this._activeReview = entry;
    this.setState({ loading: false, done: false, current: entry, error: null });
    this._maybePrefetch();
  }

  async _fetchReviewBatch({ showLoading = false } = {}) {
    if (this._reviewFetchPromise) return this._reviewFetchPromise;

    const run = async () => {
      const limit = this.isCullMode
        ? Math.min(this._reviewBatchSize * 2, MAX_REVIEW_BATCH_SIZE)
        : this._reviewBatchSize;
      const csrfToken = await this._getCsrfToken();

      try {
        const res = await fetch('/api/v1/review-queue/pop', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken || '', 'Cache-Control': 'no-cache' },
          body: JSON.stringify({ collectionId: this.collection.collectionId, limit, mode: this.isCullMode ? 'cull' : 'review' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const deduped = this._dedupeItems((json.items || []).map(item => {
          const queueId = item.queueId || item._id;
          const generation = item.generation || item;
          const generationId = generation?._id || generation?.id || item.generationId;
          if (!queueId || !generationId || !generation) return null;
          return { queueId, generationId, generation };
        }).filter(Boolean));
        if (deduped.length) {
          deduped.forEach(e => this._claimedQueueIds.add(e.queueId));
          this._reviewQueue.push(...deduped);
          return deduped.length;
        }
      } catch (err) {
        console.warn('[CollectionReviewModal] queue pop failed, trying legacy', err);
      }

      // Legacy fallback
      if (!this._usingLegacyReviewApi) {
        const n = await this._fetchLegacyBatch();
        if (n > 0) { this._usingLegacyReviewApi = true; return n; }
      } else {
        return await this._fetchLegacyBatch();
      }
      return 0;
    };

    this._reviewFetchPromise = run();
    try {
      return await this._reviewFetchPromise;
    } catch (err) {
      console.warn('[CollectionReviewModal] fetchReviewBatch error', err);
      if (showLoading) this.setState({ error: 'Failed to load pieces. Please try again.' });
      return 0;
    } finally {
      this._reviewFetchPromise = null;
    }
  }

  async _fetchLegacyBatch() {
    const res = await fetch(
      `/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/pieces/unreviewed?limit=${this._reviewBatchSize}`,
      { credentials: 'include', headers: { 'Cache-Control': 'no-cache' } }
    );
    if (!res.ok) throw new Error(`Legacy fetch HTTP ${res.status}`);
    const json = await res.json().catch(() => ({}));
    const gens = Array.isArray(json.generations) ? json.generations : [];
    const deduped = this._dedupeItems(gens.map(gen => {
      const generationId = gen?._id || gen?.id;
      return generationId ? { queueId: null, generationId, generation: gen } : null;
    }).filter(Boolean));
    if (deduped.length) this._reviewQueue.push(...deduped);
    return deduped.length;
  }

  _dedupeItems(items) {
    const existing = new Set(this._reviewQueue.map(e => e?.generationId).filter(Boolean));
    if (this._activeReview?.generationId) existing.add(this._activeReview.generationId);
    // Exclude any piece whose decision is buffered but not yet flushed to the server
    this._pendingReviewDecisions.forEach(d => { if (d.generationId) existing.add(d.generationId); });
    return items.filter(e => {
      if (this._pendingCullIds.has(String(e.generationId))) return false;
      if (existing.has(e.generationId)) return false;
      existing.add(e.generationId);
      return true;
    });
  }

  _maybePrefetch() {
    if (this._reviewQueue.length < this._reviewPrefetchThreshold) {
      this._fetchReviewBatch().catch(() => {});
    }
  }

  // ── Decision buffering & flushing ───────────────────────────────────────────

  async _decide(entry, outcome) {
    this._bufferDecision(entry.queueId, entry.generationId, outcome);
    this._activeReview = null;
    await this._loadNextReview({ showLoading: true });
  }

  _bufferDecision(queueId, generationId, outcome) {
    if (!generationId || !outcome) return;
    const mode = this.isCullMode ? 'cull' : 'review';
    this._pendingReviewDecisions.push({ queueId: queueId || null, generationId, outcome, mode });
    if (this.isCullMode) this._pendingCullIds.add(String(generationId));
    this._lastReviewActionAt = Date.now();
    this._reviewFlushRetryAttempts = 0;
    this.setState({ pendingCount: this._pendingReviewDecisions.length });
    this._scheduleFlush();
  }

  _scheduleFlush() {
    const pending = this._pendingReviewDecisions.length;
    if (!pending) return;

    if (pending >= this._reviewFlushThreshold) {
      if (this._reviewFlushTimer) { clearTimeout(this._reviewFlushTimer); this._reviewFlushTimer = null; }
      this._flushPendingReviews().catch(() => {});
      return;
    }

    const idle = Date.now() - (this._lastReviewActionAt || Date.now());
    if (idle >= this._reviewIdleFlushDelayMs && !this._reviewFlushPromise && !this._reviewFlushRetryTimer) {
      if (this._reviewFlushTimer) { clearTimeout(this._reviewFlushTimer); this._reviewFlushTimer = null; }
      this._flushPendingReviews().catch(() => {});
      return;
    }

    if (this._reviewFlushTimer || this._reviewFlushPromise || this._reviewFlushRetryTimer) return;
    this._reviewFlushTimer = setTimeout(() => {
      this._reviewFlushTimer = null;
      if (this._pendingReviewDecisions.length)
        this._flushPendingReviews({ force: true }).catch(() => {});
    }, this._reviewIdleFlushDelayMs);
  }

  async _flushPendingReviews({ force = false, keepAlive = false } = {}) {
    const { mode } = this.state;
    if (mode !== MODE.REVIEW && mode !== MODE.CULL) return;

    if (this._reviewFlushPromise) {
      if (force) { try { await this._reviewFlushPromise; } catch { /* retry below */ } }
      else return this._reviewFlushPromise;
    }

    if (this._reviewFlushTimer) { clearTimeout(this._reviewFlushTimer); this._reviewFlushTimer = null; }

    const pending = this._pendingReviewDecisions.splice(0);
    if (!pending.length) return;

    this.setState({ syncText: `Syncing ${pending.length} decision${pending.length === 1 ? '' : 's'}…`, syncVariant: 'pending' });
    const csrfToken = await this._getCsrfToken();
    let processedCull = false;

    const flush = (async () => {
      const failed = [];
      const queueItems = pending.filter(d => d.queueId);
      const legacyItems = pending.filter(d => !d.queueId);

      for (let i = 0; i < queueItems.length; i += MAX_REVIEW_SUBMISSION_BATCH_SIZE) {
        const chunk = queueItems.slice(i, i + MAX_REVIEW_SUBMISSION_BATCH_SIZE);
        try {
          await this._commitQueue(chunk, { csrfToken, keepAlive });
          chunk.forEach(d => {
            this._claimedQueueIds.delete(d.queueId);
            if (d.mode === 'cull') { this._pendingCullIds.delete(String(d.generationId)); processedCull = true; }
          });
        } catch (err) {
          console.warn('[CollectionReviewModal] queue commit chunk failed', err);
          failed.push(...chunk);
        }
      }

      for (let i = 0; i < legacyItems.length; i += MAX_REVIEW_SUBMISSION_BATCH_SIZE) {
        const chunk = legacyItems.slice(i, i + MAX_REVIEW_SUBMISSION_BATCH_SIZE);
        try {
          await this._commitLegacy(chunk);
        } catch (err) {
          console.warn('[CollectionReviewModal] legacy commit chunk failed', err);
          failed.push(...chunk);
        }
      }

      if (failed.length) {
        this._pendingReviewDecisions.unshift(...failed);
        throw new Error('partial_commit_failed');
      }
    })();

    this._reviewFlushPromise = flush;
    try {
      await flush;
      this._reviewFlushRetryAttempts = 0;
      this.setState({ syncText: 'All decisions synced ✓', syncVariant: 'ok', pendingCount: this._pendingReviewDecisions.length });
      if (processedCull) this._fetchCullStats({ force: true });
    } catch {
      this.setState({ syncText: 'Sync failed — retrying automatically…', syncVariant: 'error', pendingCount: this._pendingReviewDecisions.length });
      this._startRetryBackoff();
    } finally {
      this._reviewFlushPromise = null;
    }
  }

  async _commitQueue(decisions, { csrfToken = '', keepAlive = false } = {}) {
    const submit = async (token, attempt = 1) => {
      const res = await fetch('/api/v1/review-queue/commit', {
        method: 'POST', credentials: 'include', keepalive: keepAlive,
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': token || '' },
        body: JSON.stringify({ decisions }),
      });
      if (res.status === 429 && attempt <= 4) {
        const retryAfter = parseFloat(res.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(2000 * attempt, 5000);
        this.setState({ syncText: `Rate limited — retrying in ${Math.round(delay / 100) / 10}s…`, syncVariant: 'ratelimit' });
        await CollectionReviewModal._sleep(delay);
        return submit(token, attempt + 1);
      }
      if (res.status === 403 && attempt === 1) {
        CollectionReviewModal._csrfToken = null;
        const fresh = await this._getCsrfToken({ forceRefresh: true });
        if (fresh) return submit(fresh, attempt + 1);
      }
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      return res.json().catch(() => ({}));
    };
    return submit(csrfToken || await this._getCsrfToken(), 1);
  }

  async _commitLegacy(decisions) {
    if (!decisions.length) return;
    const token = await this._getCsrfToken();
    const body = JSON.stringify({ decisions: decisions.map(d => ({ generationId: d.generationId, outcome: d.outcome })) });
    const url = `/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/pieces/review/bulk`;
    const doPost = async (t) => {
      const res = await fetch(url, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': t || '' },
        body,
      });
      if (res.status === 403) {
        CollectionReviewModal._csrfToken = null;
        const fresh = await this._getCsrfToken({ forceRefresh: true });
        if (fresh) { const r2 = await doPost(fresh); return r2; }
      }
      if (!res.ok) throw new Error(`Legacy bulk failed: HTTP ${res.status}`);
    };
    await doPost(token);
  }

  _startRetryBackoff() {
    if (this._reviewFlushRetryTimer || !this._pendingReviewDecisions.length) return;
    const delay = this._reviewFlushBackoffMs * Math.pow(2, Math.min(this._reviewFlushRetryAttempts, 4));
    this._reviewFlushRetryAttempts++;
    this._reviewFlushRetryTimer = setTimeout(() => {
      this._reviewFlushRetryTimer = null;
      if (this._pendingReviewDecisions.length)
        this._flushPendingReviews({ keepAlive: true }).catch(() => {});
    }, delay);
  }

  // ── Cull stats ──────────────────────────────────────────────────────────────

  async _fetchCullStats({ force = false } = {}) {
    if (!this.collection?.collectionId) return;
    const elapsed = Date.now() - (this._lastCullStatsFetchAt || 0);

    if (!force) {
      if (this._cullStatsPromise) return this._cullStatsPromise;
      if (this._cullStatsLoading) return;
      if (this._lastCullStatsFetchAt && elapsed < CULL_STATS_MIN_INTERVAL_MS) {
        if (!this._pendingCullStatsTimeout) {
          this._pendingCullStatsTimeout = setTimeout(() => {
            this._pendingCullStatsTimeout = null;
            this._fetchCullStats({ force: true }).catch(() => {});
          }, Math.max(250, CULL_STATS_MIN_INTERVAL_MS - elapsed));
        }
        return;
      }
    } else if (this._pendingCullStatsTimeout) {
      clearTimeout(this._pendingCullStatsTimeout);
      this._pendingCullStatsTimeout = null;
    }

    this._cullStatsLoading = true;
    this.setState({ cullStatsLoading: true });

    const p = (async () => {
      try {
        const res = await fetch(
          `/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/cull/stats`,
          { credentials: 'include', cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json().catch(() => ({}));
        this._lastCullStatsFetchAt = Date.now();
        this.setState({ cullStats: data?.stats || null, cullStatsLoading: false });
      } catch (err) {
        console.warn('[CollectionReviewModal] cull stats failed', err);
        this.setState({ cullStatsLoading: false });
      } finally {
        this._cullStatsLoading = false;
        this._cullStatsPromise = null;
      }
    })();
    this._cullStatsPromise = p;
    return p;
  }

  _formatCullSummary(stats) {
    if (!stats) return 'Loading supply stats…';
    const kept = Number(stats.keptCount || 0);
    const culled = Number(stats.culledCount || 0);
    const pending = Number(stats.pendingCullCount || 0);
    const total = Number(stats.totalAccepted || kept + culled + pending || 0);
    const target = Number(stats.targetSupply || this.collection?.totalSupply || this.collection?.config?.totalSupply || 0);
    const parts = [total > 0 ? `Kept ${kept}/${total}` : 'No approved pieces yet'];
    if (target > 0) {
      const delta = kept - target;
      if (delta > 0) parts.push(`${delta} over target`);
      else if (delta === 0 && total > 0) parts.push('Target met');
      else if (delta < 0) parts.push(`${Math.abs(delta)} short of target`);
    }
    if (pending > 0) parts.push(`${pending} pending`);
    if (culled > 0) parts.push(`${culled} excluded`);
    return parts.join(' · ');
  }

  _cullDelta(stats) {
    if (!stats) return null;
    const kept = Number(stats.keptCount || 0);
    const target = Number(stats.targetSupply || this.collection?.totalSupply || this.collection?.config?.totalSupply || 0);
    if (!target) return { text: `Kept ${kept} so far`, color: '#fff' };
    const over = Math.max(0, kept - target);
    const short = Math.max(0, target - kept);
    if (over > 0) return { text: `${over} piece${over === 1 ? '' : 's'} still need to be excluded to hit target of ${target}.`, color: '#ffb347' };
    if (short > 0) return { text: `${short} slot${short === 1 ? '' : 's'} open — revive excluded pieces to fill them.`, color: '#7dd97d' };
    return { text: 'Target met — any additional excludes will create extra room.', color: '#7dd97d' };
  }

  // ── Revive mode ─────────────────────────────────────────────────────────────

  async _loadNextRevive() {
    if (this.state.reviveLoading) return;
    if (!this._reviveItems.length && this._reviveCompleted) {
      this.setState({ reviveDone: true, reviveCurrent: null });
      return;
    }
    if (!this._reviveItems.length) {
      this.setState({ reviveLoading: true });
      await this._fetchReviveBatch();
    }
    if (!this._reviveItems.length) {
      this.setState({ reviveLoading: false, reviveDone: true, reviveCurrent: null });
      return;
    }
    const entry = this._reviveItems[0];
    this.setState({ reviveLoading: false, reviveCurrent: entry, reviveDone: false });
  }

  async _fetchReviveBatch() {
    if (this._reviveFetchPromise) return this._reviveFetchPromise;
    const p = (async () => {
      try {
        const params = new URLSearchParams({ limit: REVIVE_PAGE_SIZE });
        if (this._reviveCursor) params.set('cursor', this._reviveCursor);
        const res = await fetch(
          `/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/cull/excluded?${params}`,
          { credentials: 'include', cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json().catch(() => ({}));
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length) { this._reviveItems.push(...items); this._reviveCursor = data.nextCursor || null; }
        else { this._reviveCompleted = true; }
      } catch (err) {
        console.warn('[CollectionReviewModal] revive fetch failed', err);
        this._reviveCompleted = true;
      } finally { this._reviveFetchPromise = null; }
    })();
    this._reviveFetchPromise = p;
    return p;
  }

  async _markReviveKeep() {
    if (!this._reviveItems.length) return;
    const entry = this._reviveItems.shift();
    this.setState({ reviveLoading: true });
    try {
      const token = await this._getCsrfToken();
      const res = await fetch(
        `/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/cull/commit`,
        {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
          body: JSON.stringify({ decisions: [{ generationId: entry.generationId || entry.generation?._id, action: 'keep' }] }),
        }
      );
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      this._fetchCullStats({ force: true });
    } catch (err) {
      console.warn('[CollectionReviewModal] revive keep failed', err);
      this.setState({ error: `Failed to keep piece: ${err.message || 'unknown error'}`, reviveLoading: false });
      return;
    }
    await this._loadNextRevive();
  }

  _skipRevive() {
    if (!this._reviveItems.length) { this._loadNextRevive(); return; }
    this._reviveItems.push(this._reviveItems.shift());
    this._loadNextRevive();
  }

  // ── Output normalisation ────────────────────────────────────────────────────

  _normaliseOutput(gen) {
    if (!gen) return { type: 'unknown' };
    const o = gen.outputs || gen.responsePayload || gen.artifactUrls || {};
    if (Array.isArray(o) && o[0]?.data?.images?.[0]?.url) return { type: 'image', url: o[0].data.images[0].url };
    if (Array.isArray(o.images) && o.images.length) { const img = o.images[0]; return { type: 'image', url: typeof img === 'string' ? img : img.url }; }
    if (o.image)    return { type: 'image', url: o.image };
    if (o.imageUrl) return { type: 'image', url: o.imageUrl };
    if (o.text)     return { type: 'text', text: o.text };
    if (o.response) return { type: 'text', text: o.response };
    return { type: 'unknown', ...o };
  }

  // ── CSRF ────────────────────────────────────────────────────────────────────

  static _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async _getCsrfToken({ forceRefresh = false } = {}) {
    if (!forceRefresh && CollectionReviewModal._csrfToken) return CollectionReviewModal._csrfToken;
    try {
      const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      const data = await res.json();
      CollectionReviewModal._csrfToken = data?.csrfToken || data?.token || '';
    } catch { CollectionReviewModal._csrfToken = ''; }
    return CollectionReviewModal._csrfToken;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  render() {
    const { mode, current, loading, done, error, syncText, syncVariant, pendingCount,
            cullStats, cullStatsLoading, reviveCurrent, reviveLoading, reviveDone } = this.state;
    const { collection, onClose } = this.props;

    return h('div', { className: 'crm-overlay', onclick: e => { if (e.target === e.currentTarget) onClose?.(); } },
      h('div', { className: 'crm-win' },

        h('div', { className: 'crm-header' },
          h('span', { className: 'crm-title' }, `${collection?.name || 'Collection'} · Review`),
          h('button', { className: 'crm-close', onclick: () => onClose?.() }, '×'),
        ),

        h('div', { className: 'crm-tabs' },
          ['review', 'cull', 'revive'].map(m =>
            h('button', {
              key: m,
              className: `crm-tab${mode === m ? ' crm-tab--active' : ''}`,
              onclick: () => this._switchMode(m),
            }, m.charAt(0).toUpperCase() + m.slice(1))
          ),
        ),

        h('div', { className: 'crm-body' },
          error ? h('div', { className: 'crm-error' }, error) : null,
          mode === MODE.REVIVE
            ? this._renderRevive(reviveCurrent, reviveLoading, reviveDone)
            : this._renderReviewOrCull(current, loading, done, mode, syncText, syncVariant, pendingCount, cullStats, cullStatsLoading),
        ),
      ),
    );
  }

  _renderReviewOrCull(current, loading, done, mode, syncText, syncVariant, pendingCount, cullStats, cullStatsLoading) {
    const isCull = mode === MODE.CULL;
    const delta = isCull ? this._cullDelta(cullStats) : null;

    return h('div', null,

      isCull ? h('div', { className: 'crm-cull-stats' },
        h('div', { className: 'crm-cull-summary' }, cullStatsLoading ? 'Loading stats…' : this._formatCullSummary(cullStats)),
        delta ? h('div', { className: 'crm-cull-delta', style: `color:${delta.color}` }, delta.text) : null,
      ) : null,

      loading ? h('div', { className: 'crm-loading' }, h(Loader, { message: 'Loading…' })) : null,

      !loading && done ? h('div', { className: 'crm-done' },
        isCull ? '✓ All pieces culled' : '✓ All pieces reviewed — nothing left to action'
      ) : null,

      !loading && !done && current ? h('div', { className: 'crm-piece' },
        h(ResultDisplay, { output: this._normaliseOutput(current.generation) }),
        h('div', { className: 'crm-actions' },
          h('button', { className: 'crm-btn crm-btn--accept', onclick: () => this._decide(current, isCull ? 'keep' : 'accepted') },
            isCull ? 'Keep ✅' : 'Accept ✅'),
          h('button', { className: 'crm-btn crm-btn--reject', onclick: () => this._decide(current, isCull ? 'exclude' : 'rejected') },
            isCull ? 'Exclude 🚫' : 'Reject ❌'),
        ),
      ) : null,

      syncText ? h('div', { className: `crm-sync crm-sync--${syncVariant}` }, syncText) : null,
      pendingCount > 0 ? h('div', { className: 'crm-pending' },
        `${pendingCount} decision${pendingCount === 1 ? '' : 's'} pending sync`
      ) : null,
    );
  }

  _renderRevive(current, loading, done) {
    return h('div', null,
      h('div', { className: 'crm-revive-intro' },
        'Review previously excluded pieces and mark the ones you want to bring back.'),
      loading ? h('div', { className: 'crm-loading' }, h(Loader, { message: 'Loading…' })) : null,
      done ? h('div', { className: 'crm-done' }, '✓ No excluded pieces left to review') : null,
      !loading && !done && current ? h('div', { className: 'crm-piece' },
        h(ResultDisplay, { output: this._normaliseOutput(current.generation || current) }),
        h('div', { className: 'crm-actions' },
          h('button', { className: 'crm-btn crm-btn--accept', onclick: () => this._markReviveKeep() }, 'Keep ✅'),
          h('button', { className: 'crm-btn crm-btn--reject', onclick: () => this._skipRevive() }, 'Skip ↷'),
        ),
      ) : null,
    );
  }

  static get styles() {
    return `
      .crm-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.6);
        display: flex; align-items: center; justify-content: center;
        z-index: var(--z-modal, 1000);
      }
      .crm-win {
        background: var(--surface-1, #1a1a1a);
        border: var(--border-width, 1px) solid var(--border, #333);
        border-radius: 10px;
        width: 400px;
        max-width: 95vw;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .crm-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 16px;
        border-bottom: var(--border-width, 1px) solid var(--border, #333);
        flex-shrink: 0;
      }
      .crm-title {
        font-family: var(--ff-mono, monospace);
        font-size: var(--fs-xs, 11px);
        letter-spacing: var(--ls-wide, 0.08em);
        text-transform: uppercase;
        color: var(--text-primary, #fff);
      }
      .crm-close {
        background: none; border: none; color: var(--text-label, #666);
        font-size: 18px; cursor: pointer; padding: 0 4px; line-height: 1;
      }
      .crm-close:hover { color: var(--text-primary, #fff); }
      .crm-tabs {
        display: flex; border-bottom: var(--border-width, 1px) solid var(--border, #333);
        flex-shrink: 0;
      }
      .crm-tab {
        flex: 1; background: none; border: none; border-bottom: 2px solid transparent;
        color: var(--text-label, #666); font-family: var(--ff-mono, monospace);
        font-size: var(--fs-xs, 11px); letter-spacing: var(--ls-wide, 0.08em);
        text-transform: uppercase; padding: 8px 0; cursor: pointer;
        transition: color var(--dur-micro, 80ms), border-color var(--dur-micro, 80ms);
        margin-bottom: -1px;
      }
      .crm-tab:hover { color: var(--text-secondary, #ccc); }
      .crm-tab--active { color: var(--accent, #90caf9); border-bottom-color: var(--accent, #90caf9); }
      .crm-body {
        flex: 1; overflow-y: auto; padding: 12px 16px;
        display: flex; flex-direction: column; gap: 8px;
      }
      .crm-error {
        color: #f66; font-size: 14px;
        background: rgba(255,68,68,0.08); padding: 8px; border-radius: 4px;
      }
      .crm-loading { padding: 24px 0; display: flex; justify-content: center; }
      .crm-done {
        text-align: center; padding: 32px 0;
        color: var(--accent, #90caf9); font-size: 16px;
      }
      .crm-piece { display: flex; flex-direction: column; gap: 10px; }
      .crm-actions { display: flex; gap: 8px; }
      .crm-btn {
        flex: 1; padding: 8px 12px;
        border: var(--border-width, 1px) solid var(--border, #444);
        background: var(--surface-3, #222);
        color: var(--text-secondary, #ccc);
        font-family: var(--ff-mono, monospace);
        font-size: var(--fs-xs, 11px);
        letter-spacing: var(--ls-wide, 0.08em);
        text-transform: uppercase; cursor: pointer; border-radius: 4px;
        transition: background var(--dur-micro, 80ms), border-color var(--dur-micro, 80ms);
      }
      .crm-btn:hover { border-color: var(--border-hover, #666); }
      .crm-btn--accept:hover { border-color: #4caf50; color: #4caf50; }
      .crm-btn--reject:hover { border-color: #f44336; color: #f44336; }
      .crm-sync {
        font-size: 12px; padding: 4px 8px; border-radius: 3px;
        font-family: var(--ff-mono, monospace);
      }
      .crm-sync--ok { color: #4caf50; }
      .crm-sync--pending { color: var(--accent, #90caf9); }
      .crm-sync--error { color: #f44336; }
      .crm-sync--ratelimit { color: #ff9800; }
      .crm-pending {
        font-size: 11px; color: var(--text-label, #666);
        font-family: var(--ff-mono, monospace);
      }
      .crm-cull-stats {
        background: var(--surface-2, #111);
        border: var(--border-width, 1px) solid var(--border, #333);
        border-radius: 6px; padding: 8px 12px;
        display: flex; flex-direction: column; gap: 4px;
        margin-bottom: 4px;
      }
      .crm-cull-summary {
        font-size: 13px; color: var(--text-secondary, #ccc);
        font-family: var(--ff-mono, monospace);
      }
      .crm-cull-delta { font-size: 12px; font-family: var(--ff-mono, monospace); }
      .crm-revive-intro {
        font-size: 13px; color: var(--text-label, #888); line-height: 1.5;
        padding: 8px 0;
      }
    `;
  }
}

// Static CSRF cache shared across instances
CollectionReviewModal._csrfToken = null;
