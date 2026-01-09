import BaseWindow from './BaseWindow.js';
import { renderResultContent } from '../node/resultContent.js';
import { getToolWindows } from '../state.js';
import { generationIdToWindowMap, generationCompletionManager } from '../node/websocketHandlers.js';
import { showTextOverlay } from '../node/overlays/textOverlay.js';

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
const REVIVE_BATCH_SIZE = 16;

/**
 * CollectionWindow – unified window for collection test & review.
 * mode: 'test' | 'review'
 */
export default class CollectionWindow extends BaseWindow {
  /**
   * Render trait selection and final parameters info panel
   * @param {HTMLElement} container - Container to append the info panel to
   */
  _renderTraitAndParamInfo(container) {
    if (!this._lastTraitSelection && !this._lastFinalParams) return;
    
    const infoPanel = document.createElement('div');
    infoPanel.className = 'collection-generation-info';
    infoPanel.style.cssText = `
      margin-top: 16px;
      padding: 12px;
      background: rgba(100, 100, 100, 0.1);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 12px;
    `;
    
    const title = document.createElement('div');
    title.style.cssText = 'font-weight: bold; margin-bottom: 8px; color: #fff;';
    title.textContent = 'Generation Details';
    infoPanel.appendChild(title);
    
    if (this._lastTraitSelection && Object.keys(this._lastTraitSelection).length > 0) {
      const traitSection = document.createElement('div');
      traitSection.style.marginBottom = '8px';
      const traitLabel = document.createElement('div');
      traitLabel.style.cssText = 'font-weight: 600; color: #a0a0a0; margin-bottom: 4px;';
      traitLabel.textContent = 'Selected Traits:';
      traitSection.appendChild(traitLabel);
      
      const traitList = document.createElement('div');
      traitList.style.cssText = 'padding-left: 12px; color: #d0d0d0;';
      Object.entries(this._lastTraitSelection).forEach(([cat, val]) => {
        const traitItem = document.createElement('div');
        traitItem.textContent = `${cat}: ${val}`;
        traitList.appendChild(traitItem);
      });
      traitSection.appendChild(traitList);
      infoPanel.appendChild(traitSection);
    }
    
    if (this._lastFinalParams && Object.keys(this._lastFinalParams).length > 0) {
      const paramSection = document.createElement('div');
      const paramLabel = document.createElement('div');
      paramLabel.style.cssText = 'font-weight: 600; color: #a0a0a0; margin-bottom: 4px;';
      paramLabel.textContent = 'Final Parameters:';
      paramSection.appendChild(paramLabel);
      
      const paramList = document.createElement('div');
      paramList.style.cssText = 'padding-left: 12px; color: #d0d0d0; max-height: 200px; overflow-y: auto;';
      Object.entries(this._lastFinalParams).forEach(([key, val]) => {
        const paramItem = document.createElement('div');
        paramItem.style.cssText = 'margin-bottom: 8px; word-break: break-word;';
        const paramKey = document.createElement('span');
        paramKey.style.cssText = 'font-weight: 500; color: #b0b0b0;';
        paramKey.textContent = `${key}: `;
        paramItem.appendChild(paramKey);
        
        // Special handling for prompt/text parameters - show full text or make expandable
        const isPromptParam = /(prompt|text|instruction|input_prompt)/i.test(key);
        const valStr = String(val);
        const isLong = valStr.length > 100;
        
        if (isPromptParam && isLong) {
          // For long prompt parameters, show truncated preview with "View Full" button
          const previewSpan = document.createElement('span');
          previewSpan.textContent = valStr.substring(0, 100) + '...';
          previewSpan.style.cssText = 'color: #d0d0d0;';
          paramItem.appendChild(previewSpan);
          
          const viewFullBtn = document.createElement('button');
          viewFullBtn.textContent = 'View Full';
          viewFullBtn.style.cssText = `
            margin-left: 8px;
            padding: 2px 8px;
            background: rgba(100, 150, 255, 0.2);
            border: 1px solid rgba(100, 150, 255, 0.4);
            border-radius: 4px;
            color: #88aaff;
            cursor: pointer;
            font-size: 11px;
          `;
          viewFullBtn.onmouseover = () => {
            viewFullBtn.style.background = 'rgba(100, 150, 255, 0.3)';
          };
          viewFullBtn.onmouseout = () => {
            viewFullBtn.style.background = 'rgba(100, 150, 255, 0.2)';
          };
          viewFullBtn.onclick = () => {
            showTextOverlay({
              title: `Final ${key} (after trait substitution)`,
              text: valStr,
              readOnly: true
            });
          };
          paramItem.appendChild(viewFullBtn);
        } else if (isPromptParam) {
          // For short prompt parameters, show full text
          const paramVal = document.createElement('span');
          paramVal.textContent = valStr;
          paramVal.style.cssText = 'color: #d0d0d0; white-space: pre-wrap;';
          paramItem.appendChild(paramVal);
        } else {
          // For non-prompt parameters, truncate if long
          const paramVal = document.createElement('span');
          paramVal.textContent = isLong ? valStr.substring(0, 100) + '...' : valStr;
          paramVal.style.cssText = 'color: #d0d0d0;';
          paramItem.appendChild(paramVal);
        }
        
        paramList.appendChild(paramItem);
      });
      paramSection.appendChild(paramList);
      infoPanel.appendChild(paramSection);
    }
    
    container.appendChild(infoPanel);
  }
  /**
   * @param {object} opts
   * @param {'test'|'review'} opts.mode
   * @param {object} opts.collection – collection object from API
   * @param {object} opts.position – { x, y }
   */
  constructor({ mode = 'test', collection, position = { x: 200, y: 120 } }) {
    const idPrefix = mode === 'test'
      ? 'col-test'
      : (mode === 'cull'
        ? 'col-cull'
        : (mode === 'revive' ? 'col-revive' : 'col-review'));
    const id = `${idPrefix}-${Math.random().toString(36).slice(2, 10)}`;
    const title = `${collection.name || 'Collection'} · ${
      mode === 'test'
        ? 'Test'
        : (mode === 'cull'
          ? 'Cull'
          : (mode === 'revive' ? 'Revive' : 'Review'))
    }`;
    super({ id, title, position, classes: ['collection-window'] });

    this.mode = mode;
    this.collection = collection;
    this.isCullMode = mode === 'cull';
    this._reviewQueue = [];
    this._activeReview = null;
    this._reviewFetchPromise = null;
    this._pendingReviewDecisions = [];
    this._reviewFlushPromise = null;
    this._reviewFlushTimer = null;
    this._reviewBatchSize = Math.min(
      Math.max(collection?.config?.reviewBatchSize || DEFAULT_REVIEW_BATCH_SIZE, 1),
      MAX_REVIEW_BATCH_SIZE
    );
    const prefetchCfg = collection?.config?.reviewPrefetchThreshold ?? DEFAULT_REVIEW_PREFETCH_THRESHOLD;
    const maxPrefetch = Math.max(1, this._reviewBatchSize - 1);
    this._reviewPrefetchThreshold = Math.max(1, Math.min(prefetchCfg, maxPrefetch));
    this._reviewFlushThreshold = Math.min(
      Math.max(collection?.config?.reviewFlushThreshold || DEFAULT_REVIEW_FLUSH_THRESHOLD, 1),
      MAX_REVIEW_SUBMISSION_BATCH_SIZE
    );
    const flushInterval = Number(collection?.config?.reviewFlushIntervalMs) || DEFAULT_REVIEW_FLUSH_INTERVAL_MS;
    this._reviewFlushIntervalMs = Math.max(flushInterval, 1000);
    this._baseReviewFlushThreshold = this._reviewFlushThreshold;
    this._baseReviewFlushInterval = this._reviewFlushIntervalMs;
    this._reviewSyncBannerState = { text: 'All decisions synced ✅', variant: 'ok' };
    const idleBase = 1500;
    this._reviewIdleFlushDelayMs = Math.max(this._reviewFlushIntervalMs, idleBase);
    this._baseReviewIdleDelay = this._reviewIdleFlushDelayMs;
    this._applyFlushSettingsForMode(this.mode);
    this._reviewFlushBackoffMs = 2500;
    this._reviewFlushRetryAttempts = 0;
    this._reviewFlushRetryTimer = null;
    this._lastReviewActionAt = 0;
    this._claimedQueueIds = new Set();
    this._pendingCullIds = new Set();
    this._usingLegacyReviewApi = false;
    this._cullStats = null;
    this._cullStatsLoading = false;
    this._cullSummaryEl = null;
    this._cullDeltaEl = null;
    this._lastCullStatsFetchAt = 0;
    this._pendingCullStatsTimeout = null;
    this._cullStatsPromise = null;
    this._boundCullUpdate = null;
    this._reviveItems = [];
    this._reviveCursor = null;
    this._reviveFetchPromise = null;
    this._reviveCompleted = false;
    this._reviveCounterEl = null;
    this._reviveResultEl = null;
    this._reviveEmptyEl = null;
    this._reviveKeepBtn = null;
    this._reviveSkipBtn = null;
    this._reviveLoading = false;

    // Store reference to this instance on the DOM element for WebSocket handler access
    this.el._collectionWindowInstance = this;
    // Tag as spell window to enable shared websocket progress handling when testing a spell
    if (mode === 'test' && collection.generatorType === 'spell') {
      this.el.classList.add('spell-window');
      if (collection.spellId) {
        this.el.dataset.spellId = collection.spellId;
      }
    }
    // Tag as collection-test-window for WebSocket handler identification
    if (mode === 'test') {
      this.el.classList.add('collection-test-window');
    }

    if (this.mode === 'review' || this.mode === 'cull' || this.mode === 'revive') {
      this._beforeUnloadHandler = () => {
        if (this._pendingReviewDecisions?.length) {
          this._flushPendingReviews({ force: true, keepAlive: true }).catch(() => {});
        }
        if (this._claimedQueueIds?.size) {
          this._releaseOutstandingQueueItems().catch(() => {});
        }
      };
      window.addEventListener('beforeunload', this._beforeUnloadHandler);
      const prevOnClose = this.onClose;
      this.onClose = () => {
        prevOnClose?.();
        if (this._beforeUnloadHandler) {
          window.removeEventListener('beforeunload', this._beforeUnloadHandler);
        }
        if (this._pendingReviewDecisions?.length) {
          this._flushPendingReviews({ force: true, keepAlive: true }).catch(() => {});
        }
        if (this._claimedQueueIds?.size) {
          this._releaseOutstandingQueueItems().catch(() => {});
        }
        if (this._boundCullUpdate && typeof window !== 'undefined') {
          window.removeEventListener('collection:cull-updated', this._boundCullUpdate);
          this._boundCullUpdate = null;
        }
        if (this._pendingCullStatsTimeout) {
          clearTimeout(this._pendingCullStatsTimeout);
          this._pendingCullStatsTimeout = null;
        }
      };
      if ((this.mode === 'cull' || this.mode === 'revive')) {
        this._ensureCullUpdateListener();
      }
    }

    this.renderBody();
  }

  _applyFlushSettingsForMode(mode) {
    if (mode === 'cull') {
      this._reviewFlushThreshold = Math.min(Math.max(1, CULL_REVIEW_FLUSH_THRESHOLD), MAX_REVIEW_SUBMISSION_BATCH_SIZE);
      this._reviewFlushIntervalMs = Math.max(CULL_REVIEW_FLUSH_INTERVAL_MS, 1000);
      this._reviewIdleFlushDelayMs = Math.max(this._reviewFlushIntervalMs, CULL_REVIEW_IDLE_FLUSH_DELAY_MS);
    } else {
      this._reviewFlushThreshold = this._baseReviewFlushThreshold;
      this._reviewFlushIntervalMs = this._baseReviewFlushInterval;
      this._reviewIdleFlushDelayMs = this._baseReviewIdleDelay;
    }
  }

  _ensureCullUpdateListener() {
    if (typeof window === 'undefined' || this._boundCullUpdate) return;
    this._boundCullUpdate = (evt) => {
      if (!evt?.detail || evt.detail.collectionId !== this.collection?.collectionId) return;
      if (evt.detail.sourceWindowId === this.id) return;
      this._fetchCullStatsForWindow({ force: true }).catch(() => {});
      if (this.mode === 'revive') {
        this._refreshRevivePreview();
      }
    };
    window.addEventListener('collection:cull-updated', this._boundCullUpdate);
  }

  _setActiveMode(nextMode) {
    if (!nextMode || this.mode === nextMode) return;
    this.mode = nextMode;
    this.isCullMode = nextMode === 'cull';
    this._applyFlushSettingsForMode(nextMode);
    if (nextMode === 'cull' || nextMode === 'revive') {
      this._ensureCullUpdateListener();
      this._fetchCullStatsForWindow({ force: true }).catch(() => {});
    }
    this.renderBody();
  }

  _resetReviewContentRoot() {
    if (this._reviewContentRoot) {
      this._reviewContentRoot.remove();
    }
    const root = document.createElement('div');
    root.className = 'collection-review-content';
    this.body.appendChild(root);
    this._reviewContentRoot = root;
    return root;
  }

  _getReviewContentTarget() {
    if (this._reviewContentRoot) return this._reviewContentRoot;
    return this.body;
  }

  static _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
  }

  serialize() {
    return {
      ...super.serialize(),
      type: 'collection',
      mode: this.mode,
      collection: this.collection
    };
  }

  renderBody() {
    if (this.mode === 'test') {
      this._renderTest();
      return;
    }
    if (this.mode === 'review' || this.mode === 'cull' || this.mode === 'revive') {
      this._renderInteractiveReview();
      return;
    }
    this._renderTest();
  }

  _renderInteractiveReview() {
    this.body.innerHTML = '';
    this._renderModeSwitcher();
    if (this.mode === 'cull' || this.mode === 'revive') {
      this._renderCullSummaryBlocks();
      this._fetchCullStatsForWindow().catch(() => {});
    } else {
      this._clearCullSummaryRefs();
    }
    const contentRoot = this._resetReviewContentRoot();
    if (this.mode === 'revive') {
      this._renderReviveView(contentRoot);
    } else {
      this._renderReview(contentRoot);
    }
  }

  _renderModeSwitcher() {
    const wrap = document.createElement('div');
    wrap.className = 'review-mode-switcher';
    wrap.style.cssText = 'display:flex; gap:8px; margin-bottom:10px;';
    const modes = [
      { key: 'review', label: 'Review' },
      { key: 'cull', label: 'Cull' },
      { key: 'revive', label: 'Revive' }
    ];
    modes.forEach(mode => {
      const btn = document.createElement('button');
      btn.textContent = mode.label;
      btn.className = this.mode === mode.key ? 'mode-btn active' : 'mode-btn';
      btn.disabled = this.mode === mode.key;
      btn.onclick = () => this._setActiveMode(mode.key);
      wrap.appendChild(btn);
    });
    this.body.appendChild(wrap);
  }

  _renderCullSummaryBlocks() {
    const summary = document.createElement('div');
    summary.className = 'cull-summary';
    summary.style.cssText = 'padding: 8px 12px; margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; font-size: 13px; color: #d0d0d0;';
    summary.textContent = 'Loading supply stats…';
    this.body.appendChild(summary);
    const deltaBanner = document.createElement('div');
    deltaBanner.className = 'cull-target-delta';
    deltaBanner.style.cssText = 'padding: 6px 10px; margin-bottom: 12px; background: rgba(255,255,255,0.05); border-radius: 6px; font-size: 13px; color: #fff;';
    deltaBanner.textContent = 'Calculating target gap…';
    this.body.appendChild(deltaBanner);
    this._cullSummaryEl = summary;
    this._cullDeltaEl = deltaBanner;
    this._updateCullSummary();
  }

  _clearCullSummaryRefs() {
    this._cullSummaryEl = null;
    this._cullDeltaEl = null;
  }

  /* ---------------- Review Mode ---------------- */
  _renderReview(container) {
    const body = container || this._resetReviewContentRoot();
    const intro = document.createElement('div');
    intro.className = 'review-intro';
    intro.style.cssText = 'padding: 8px 12px; background: rgba(255,255,255,0.05); border-radius: 6px; margin-bottom: 8px; font-size: 13px; line-height: 1.4;';
    if (this.isCullMode) {
      intro.innerHTML = `<strong>Second Pass:</strong> Keep or drop each approved piece so the final manifest matches your desired supply. Drop extras until you are comfortable with the kept count.`;
    } else {
      intro.textContent = 'Approve or reject each generated piece. Decisions sync automatically as you work.';
    }
    body.appendChild(intro);

    const startWrap = document.createElement('div');
    startWrap.style.textAlign = 'center';
    startWrap.style.padding = '8px';
    const startBtn = document.createElement('button');
    const isCull = this.isCullMode;
    startBtn.className = isCull ? 'start-cull-btn' : 'start-review-btn';
    const idleLabel = isCull ? 'Start Culling' : 'Start Reviewing';
    startBtn.textContent = idleLabel;
    startBtn.onclick = () => {
      startBtn.disabled = true;
      startBtn.textContent = 'Loading pieces…';
      this._reviewQueue = [];
      this._activeReview = null;
      this._loadNextReview({ showLoading: true }).catch(() => {
        startBtn.disabled = false;
        startBtn.textContent = idleLabel;
      });
    };
    startWrap.appendChild(startBtn);
    body.appendChild(startWrap);
  }

  async _loadNextReview({ showLoading = false } = {}) {
    const body = this._getReviewContentTarget();
    if (showLoading) {
      body.textContent = 'Loading…';
    }

    try {
      const gen = await this._getNextReviewPiece({ showLoading: true });
      if (!gen) {
        this._renderNoPiecesMessage();
        return;
      }
      this._renderReviewPiece(gen);
      this._maybePrefetchReviews();
    } catch (e) {
      console.error('[CollectionWindow] Failed to load review piece', e);
      body.textContent = 'Error loading piece';
    }
  }

  async _getNextReviewPiece({ showLoading } = {}) {
    if (!Array.isArray(this._reviewQueue)) this._reviewQueue = [];
    if (this._reviewQueue.length === 0) {
      const fetched = await this._fetchReviewBatch({ showLoading });
      if (!fetched) return null;
    }
    return this._reviewQueue.shift() || null;
  }

  async _fetchReviewBatch({ showLoading = false, skipPendingFlush = false } = {}) {
    if (this._reviewFetchPromise) {
      return this._reviewFetchPromise;
    }
    const loadPromise = (async () => {
      if (showLoading && !this._activeReview) {
        this._getReviewContentTarget().textContent = 'Loading…';
      }
      const limit = this.isCullMode ? Math.min(this._reviewBatchSize * 2, MAX_REVIEW_BATCH_SIZE) : this._reviewBatchSize;
      const csrfToken = await this._getCsrfToken();
      const res = await fetch('/api/v1/review-queue/pop', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken || '',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({
          collectionId: this.collection.collectionId,
          limit,
          mode: this.isCullMode ? 'cull' : 'review'
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const json = await res.json();
      const items = Array.isArray(json.items) ? json.items : [];
      const existingIds = new Set(
        this._reviewQueue
          .map(entry => entry?.generationId)
          .filter(Boolean)
          .map(id => String(id))
      );
      if (this._activeReview?.generationId) {
        existingIds.add(String(this._activeReview.generationId));
      }
      if (Array.isArray(this._pendingReviewDecisions)) {
        this._pendingReviewDecisions.forEach(decision => {
          if (decision?.generationId) {
            existingIds.add(String(decision.generationId));
          }
        });
      }
      const normalized = items.map(item => {
        const queueId = item.queueId || item._id;
        const generation = item.generation || item;
        const generationId = generation?._id || generation?.id || item.generationId;
        if (!queueId || !generationId || !generation) return null;
        return { queueId, generationId, generation };
      }).filter(Boolean);
      const deduped = normalized.filter(entry => {
        const idStr = String(entry.generationId);
        const pendingLocal = this._pendingCullIds.has(idStr);
        const alreadyInQueue = existingIds.has(idStr);
        if (pendingLocal || alreadyInQueue) {
          return false;
        }
        return true;
      });
      deduped.forEach(entry => {
        existingIds.add(entry.generationId);
        this._claimedQueueIds.add(entry.queueId);
      });
      if (deduped.length) {
        this._reviewQueue.push(...deduped);
      }
      if (deduped.length) {
        return deduped.length;
      }
      if (!this.isCullMode && !skipPendingFlush && this._pendingReviewDecisions?.length) {
        try {
          await this._flushPendingReviews({ force: true, keepAlive: true });
        } catch (flushErr) {
          console.error('[CollectionWindow] Failed to flush pending reviews before fetching more pieces', flushErr);
        }
        return this._fetchReviewBatch({ showLoading, skipPendingFlush: true });
      }
      if (this.isCullMode) {
        return 0;
      }
      if (!this._usingLegacyReviewApi) {
        try {
          const legacyCount = await this._fetchLegacyReviewBatch({ showLoading: false, skipPendingFlush: skipPendingFlush });
          if (legacyCount > 0) {
            this._usingLegacyReviewApi = true;
            return legacyCount;
          }
        } catch (legacyErr) {
          console.warn('[CollectionWindow] Legacy review fallback failed', legacyErr);
        }
      } else {
        const legacyCount = await this._fetchLegacyReviewBatch({ showLoading: false });
        return legacyCount;
      }
      return 0;
    })();
    this._reviewFetchPromise = loadPromise;
    try {
      const count = await loadPromise;
      return count;
    } catch (err) {
      if (showLoading) {
        this.body.textContent = 'Error loading pieces';
      }
      console.error('[CollectionWindow] Failed to fetch review batch', err);
      return 0;
    } finally {
      this._reviewFetchPromise = null;
    }
  }

  async _fetchLegacyReviewBatch({ showLoading = false, skipPendingFlush = false } = {}) {
    if (showLoading && !this._activeReview) {
      this.body.textContent = 'Loading…';
    }
    const limit = this._reviewBatchSize;
    const res = await fetch(`/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/pieces/unreviewed?limit=${limit}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Legacy review fetch failed: HTTP ${res.status}: ${text}`);
    }
    const json = await res.json().catch(() => ({}));
    const generations = Array.isArray(json.generations) ? json.generations : [];
    const existingIds = new Set(
      this._reviewQueue
        .map(entry => entry?.generationId)
        .filter(Boolean)
        .map(id => String(id))
    );
    if (this._activeReview?.generationId) {
      existingIds.add(String(this._activeReview.generationId));
    }
    if (Array.isArray(this._pendingReviewDecisions)) {
      this._pendingReviewDecisions.forEach(decision => {
        if (decision?.generationId) {
          existingIds.add(String(decision.generationId));
        }
      });
    }
    const normalized = generations.map(gen => {
      const generationId = gen?._id || gen?.id;
      if (!generationId) return null;
      return { queueId: null, generationId, generation: gen };
    }).filter(Boolean);
    const deduped = normalized.filter(entry => {
      const idStr = String(entry.generationId);
      return !existingIds.has(idStr);
    });
    deduped.forEach(entry => existingIds.add(String(entry.generationId)));
    if (deduped.length) {
      this._reviewQueue.push(...deduped);
      return deduped.length;
    }
    if (!this.isCullMode && !skipPendingFlush && this._pendingReviewDecisions?.length) {
      try {
        await this._flushPendingReviews({ force: true, keepAlive: true });
      } catch (flushErr) {
        console.error('[CollectionWindow] Failed to flush pending reviews before fetching legacy pieces', flushErr);
      }
      return this._fetchLegacyReviewBatch({ showLoading, skipPendingFlush: true });
    }
    return 0;
  }

  _maybePrefetchReviews() {
    if (!this._reviewQueue) this._reviewQueue = [];
    if (this._reviewQueue.length < this._reviewPrefetchThreshold) {
      this._fetchReviewBatch().catch(err => {
        console.error('[CollectionWindow] Prefetch review batch failed', err);
      });
    }
  }

  async _fetchCullStatsForWindow({ force = false } = {}) {
    if (!this.collection?.collectionId) return;
    if (this.mode !== 'cull' && this.mode !== 'revive') return;
    const now = Date.now();
    const elapsed = now - (this._lastCullStatsFetchAt || 0);
    if (!force) {
      if (this._cullStatsPromise) {
        return this._cullStatsPromise;
      }
      if (this._cullStatsLoading) {
        return;
      }
      if (this._lastCullStatsFetchAt && elapsed < CULL_STATS_MIN_INTERVAL_MS) {
        if (!this._pendingCullStatsTimeout) {
          const delay = Math.max(250, CULL_STATS_MIN_INTERVAL_MS - elapsed);
          this._pendingCullStatsTimeout = setTimeout(() => {
            this._pendingCullStatsTimeout = null;
            this._fetchCullStatsForWindow({ force: true }).catch(() => {});
          }, delay);
        }
        return;
      }
    } else if (this._pendingCullStatsTimeout) {
      clearTimeout(this._pendingCullStatsTimeout);
      this._pendingCullStatsTimeout = null;
    }
    this._cullStatsLoading = true;
    this._updateCullSummary();
    const fetchPromise = (async () => {
      try {
        const res = await fetch(`/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/cull/stats`, {
          credentials: 'include',
          cache: 'no-store'
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => ({}));
        this._cullStats = data?.stats || null;
        this._lastCullStatsFetchAt = Date.now();
      } catch (err) {
        console.warn('[CollectionWindow] Failed to load cull stats', err);
      } finally {
        this._cullStatsLoading = false;
        this._cullStatsPromise = null;
        this._updateCullSummary();
      }
    })();
    this._cullStatsPromise = fetchPromise;
    return fetchPromise;
  }

  _updateCullSummary() {
    if (this.mode !== 'cull' && this.mode !== 'revive') return;
    if (this._cullSummaryEl) {
      if (this._cullStats) {
        this._cullSummaryEl.textContent = this._formatCullSummaryText(this._cullStats);
      } else if (this._cullStatsLoading) {
        this._cullSummaryEl.textContent = 'Loading supply stats…';
      } else {
        this._cullSummaryEl.textContent = 'No approved pieces available for culling yet.';
      }
    }
    if (this._cullDeltaEl) {
      if (!this._cullStats) {
        this._cullDeltaEl.textContent = this._cullStatsLoading ? 'Calculating target gap…' : 'Target gap unavailable';
        this._cullDeltaEl.style.color = '#fff';
        return;
      }
      const kept = Number(this._cullStats.keptCount || 0);
      const target = Number(this._cullStats.targetSupply || this.collection?.totalSupply || this.collection?.config?.totalSupply || 0);
      if (!target) {
        this._cullDeltaEl.textContent = `Kept ${kept} so far`;
        this._cullDeltaEl.style.color = '#fff';
        return;
      }
      const over = Math.max(0, kept - target);
      const shortfall = Math.max(0, target - kept);
      if (over > 0) {
        this._cullDeltaEl.textContent = `${over} piece${over === 1 ? '' : 's'} still need to be dropped to hit ${target}.`;
        this._cullDeltaEl.style.color = '#ffb347';
      } else if (shortfall > 0) {
        this._cullDeltaEl.textContent = `${shortfall} slot${shortfall === 1 ? '' : 's'} open – revive excluded pieces to fill them.`;
        this._cullDeltaEl.style.color = '#7dd97d';
      } else {
        this._cullDeltaEl.textContent = 'Target met – any additional excludes will create extra room.';
        this._cullDeltaEl.style.color = '#7dd97d';
      }
    }
  }

  _formatCullSummaryText(stats) {
    if (!stats) return 'Loading supply stats…';
    const kept = Number(stats.keptCount || 0);
    const culled = Number(stats.culledCount || 0);
    const pending = Number(stats.pendingCullCount || 0);
    const total = Number(stats.totalAccepted || kept + culled + pending || 0);
    const target = Number(stats.targetSupply || this.collection?.totalSupply || this.collection?.config?.totalSupply || 0);
    const parts = [];
    if (total > 0) {
      parts.push(`Kept ${kept}/${total}`);
    } else {
      parts.push('No approved pieces yet');
    }
    if (target > 0) {
      const delta = kept - target;
      if (delta > 0) {
        parts.push(`${delta} over target`);
      } else if (delta === 0 && total > 0) {
        parts.push('Target met');
      } else if (delta < 0) {
        parts.push(`${Math.abs(delta)} short of target`);
      }
    }
    if (pending > 0) {
      parts.push(`${pending} pending`);
    }
    if (culled > 0) {
      parts.push(`${culled} excluded`);
    }
    return parts.join(' • ');
  }

  _renderReviewPiece(entry) {
    if (!entry) return;
    const gen = entry.generation || entry;
    if (!gen) {
      this._getReviewContentTarget().textContent = 'Unable to load piece';
      return;
    }
    const body = this._getReviewContentTarget();
    this._activeReview = entry;
    body.innerHTML = '';
    const resultDiv = document.createElement('div');
    resultDiv.className = 'result-container';
    body.appendChild(resultDiv);

    const outputData = this._normaliseReviewOutput(gen);
    console.log('[CollectionWindow] rendering review generation', gen, outputData);
    renderResultContent(resultDiv, outputData, { disableFeedback: true });

    const btnRow = document.createElement('div');
    const acceptBtn = document.createElement('button');
    const rejectBtn = document.createElement('button');
    if (this.isCullMode) {
      acceptBtn.textContent = 'Keep ✅';
      rejectBtn.textContent = 'Exclude 🚫';
    } else {
      acceptBtn.textContent = 'Accept ✅';
      rejectBtn.textContent = 'Reject ❌';
    }
    btnRow.append(acceptBtn, rejectBtn);
    body.appendChild(btnRow);

    this._attachReviewSyncBanner();
    this._updateReviewSyncBanner();
    let markInFlight = false;
    const mark = async (outcome) => {
      if (markInFlight) return;
      markInFlight = true;
      acceptBtn.disabled = true;
      rejectBtn.disabled = true;
      try {
        this._bufferReviewDecision(entry.queueId, gen._id, outcome);
        this._activeReview = null;
        await this._loadNextReview({ showLoading: true });
      } catch (err) {
        console.error('[CollectionWindow] Failed to advance after decision', err);
        this._setReviewSyncBanner('Failed to load next piece. Please try again.', 'error');
      }
      markInFlight = false;
    };
    const acceptOutcome = this.isCullMode ? 'keep' : 'accepted';
    const rejectOutcome = this.isCullMode ? 'exclude' : 'rejected';
    acceptBtn.onclick = () => mark(acceptOutcome);
    rejectBtn.onclick = () => mark(rejectOutcome);
  }

  _renderReviveView(container) {
    const body = container || this._resetReviewContentRoot();
    if (!Array.isArray(this._reviveItems)) this._reviveItems = [];
    const intro = document.createElement('div');
    intro.className = 'revive-intro';
    intro.style.cssText = 'padding: 8px 12px; background: rgba(255,255,255,0.05); border-radius: 6px; margin-bottom: 8px; font-size: 13px; line-height: 1.4;';
    intro.innerHTML = '<strong>Revive excluded pieces.</strong> Browse dropped items and mark specific ones as keep to bring them back.';
    body.appendChild(intro);
    const counter = document.createElement('div');
    counter.style.cssText = 'margin-bottom: 8px; font-size: 13px; color: #d0d0d0;';
    counter.textContent = this._reviveCompleted ? 'All excluded pieces reviewed.' : 'Loading excluded pieces…';
    body.appendChild(counter);
    this._reviveCounterEl = counter;
    const resultContainer = document.createElement('div');
    resultContainer.className = 'result-container';
    resultContainer.style.minHeight = '320px';
    body.appendChild(resultContainer);
    this._reviveResultEl = resultContainer;
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'margin-top: 12px; display:flex; gap:8px;';
    const keepBtn = document.createElement('button');
    keepBtn.textContent = 'Keep ✅';
    keepBtn.onclick = () => this._markReviveKeep();
    const skipBtn = document.createElement('button');
    skipBtn.textContent = 'Skip ↷';
    skipBtn.onclick = () => this._skipRevive();
    btnRow.append(keepBtn, skipBtn);
    body.appendChild(btnRow);
    this._reviveKeepBtn = keepBtn;
    this._reviveSkipBtn = skipBtn;
    const emptyMessage = document.createElement('div');
    emptyMessage.style.cssText = 'margin-top: 10px; font-size: 14px; color: #9ac899;';
    body.appendChild(emptyMessage);
    this._reviveEmptyEl = emptyMessage;
    this._loadNextRevive();
  }

  async _loadNextRevive() {
    if (this.mode !== 'revive') return;
    if (!this._reviveItems.length && !this._reviveCompleted) {
      await this._fetchReviveBatch();
    }
    if (!this._reviveItems.length) {
      this._renderReviveEmpty();
      return;
    }
    const entry = this._reviveItems[0];
    this._renderReviveEntry(entry);
    this._updateReviveCounter();
  }

  async _fetchReviveBatch() {
    if (this._reviveFetchPromise) return this._reviveFetchPromise;
    this._reviveLoading = true;
    const promise = (async () => {
      try {
        const params = new URLSearchParams({ limit: REVIVE_BATCH_SIZE });
        if (this._reviveCursor) params.set('cursor', this._reviveCursor);
        const res = await fetch(`/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/cull/excluded?${params.toString()}`, {
          credentials: 'include',
          cache: 'no-store'
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => ({}));
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length) {
          this._reviveItems.push(...items);
          this._reviveCursor = data.nextCursor || null;
        } else {
          this._reviveCompleted = true;
        }
      } catch (err) {
        console.error('[CollectionWindow] failed to load excluded pieces', err);
        if (this._reviveEmptyEl) {
          this._reviveEmptyEl.textContent = 'Failed to load excluded pieces. Close and reopen to retry.';
        }
      } finally {
        this._reviveLoading = false;
        this._reviveFetchPromise = null;
      }
    })();
    this._reviveFetchPromise = promise;
    await promise;
  }

  _renderReviveEntry(entry) {
    if (!entry || !this._reviveResultEl) return;
    const gen = entry.generation || entry;
    if (!gen) {
      this._reviveResultEl.textContent = 'Unable to load piece.';
      return;
    }
    this._reviveResultEl.innerHTML = '';
    const normalized = this._normaliseReviewOutput(gen);
    renderResultContent(this._reviveResultEl, normalized, { disableFeedback: true });
    if (this._reviveEmptyEl) this._reviveEmptyEl.textContent = '';
  }

  async _markReviveKeep() {
    if (!this._reviveItems.length) {
      await this._loadNextRevive();
      return;
    }
    const entry = this._reviveItems.shift();
    this._updateReviveCounter();
    if (this._reviveKeepBtn) this._reviveKeepBtn.disabled = true;
    if (this._reviveSkipBtn) this._reviveSkipBtn.disabled = true;
    try {
      const csrf = await this._getCsrfToken();
      await fetch(`/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/cull/revive`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrf || ''
        },
        body: JSON.stringify({
          generationIds: [entry.generationId || entry.generation?._id],
          action: 'keep'
        })
      }).then(async res => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || 'keep_failed');
        }
      });
      this._fetchCullStatsForWindow({ force: true }).catch(() => {});
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('collection:cull-updated', {
            detail: { collectionId: this.collection?.collectionId }
          }));
        } catch (_) {
          // ignore
        }
      }
    } catch (err) {
      console.error('[CollectionWindow] failed to revive piece', err);
      alert('Failed to keep piece: ' + (err.message || 'unknown error'));
    } finally {
      if (this._reviveKeepBtn) this._reviveKeepBtn.disabled = false;
      if (this._reviveSkipBtn) this._reviveSkipBtn.disabled = false;
      this._loadNextRevive();
    }
  }

  _skipRevive() {
    if (!this._reviveItems.length) {
      this._loadNextRevive();
      return;
    }
    const entry = this._reviveItems.shift();
    this._reviveItems.push(entry);
    this._loadNextRevive();
  }

  _renderReviveEmpty() {
    if (this._reviveResultEl) {
      this._reviveResultEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #9ac899;">No excluded pieces left to review.</div>';
    }
    if (this._reviveEmptyEl) {
      this._reviveEmptyEl.textContent = '';
    }
    this._reviveCompleted = true;
  }

  _updateReviveCounter() {
    if (!this._reviveCounterEl) return;
    if (this._reviveCompleted && !this._reviveItems.length) {
      this._reviveCounterEl.textContent = 'All excluded pieces reviewed.';
      return;
    }
    const remaining = this._reviveItems.length + (this._reviveLoading ? 1 : 0);
    this._reviveCounterEl.textContent = `${remaining} piece${remaining === 1 ? '' : 's'} in queue`;
  }

  _refreshRevivePreview() {
    if (this.mode !== 'revive') return;
    this._reviveItems = [];
    this._reviveCursor = null;
    this._reviveCompleted = false;
    this._loadNextRevive();
  }

  _normaliseReviewOutput(gen) {
    const outputs = gen.outputs || gen.responsePayload || gen.artifactUrls || {};
    console.log('[CollectionWindow] raw outputs', outputs);
    if (Array.isArray(outputs) && outputs[0]?.data?.images?.[0]?.url) {
      return { type: 'image', url: outputs[0].data.images[0].url, generationId: gen._id };
    }
    if (Array.isArray(outputs.images) && outputs.images.length) {
      const firstImg = outputs.images[0];
      return { type: 'image', url: (typeof firstImg === 'string' ? firstImg : firstImg.url), generationId: gen._id };
    }
    if (outputs.image) {
      return { type: 'image', url: outputs.image, generationId: gen._id };
    }
    if (outputs.imageUrl) {
      return { type: 'image', url: outputs.imageUrl, generationId: gen._id };
    }
    if (outputs.text) {
      return { type: 'text', text: outputs.text, generationId: gen._id };
    }
    if (outputs.response) {
      return { type: 'text', text: outputs.response, generationId: gen._id };
    }
    if (outputs.steps && Array.isArray(outputs.steps)) {
      return { type: 'spell', steps: outputs.steps, generationId: gen._id };
    }
    return { type: 'unknown', generationId: gen._id, ...outputs };
  }

  _bufferReviewDecision(queueId, generationId, outcome) {
    if (!generationId || !outcome) return;
    if (!Array.isArray(this._pendingReviewDecisions)) this._pendingReviewDecisions = [];
    const mode = this.isCullMode ? 'cull' : 'review';
    this._pendingReviewDecisions.push({ queueId: queueId || null, generationId, outcome, mode });
    if (this.isCullMode) {
      this._pendingCullIds.add(String(generationId));
    }
    console.log('[CollectionWindow] queued review decision', generationId, outcome, 'pending:', this._pendingReviewDecisions.length);
    this._updateReviewSyncBanner();
    this._lastReviewActionAt = Date.now();
    this._reviewFlushRetryAttempts = 0;
    this._scheduleReviewFlush();
  }

  _scheduleReviewFlush() {
    const pending = this._pendingReviewDecisions?.length || 0;
    if (!pending) return;
    if (pending >= this._reviewFlushThreshold) {
      if (this._reviewFlushTimer) {
        clearTimeout(this._reviewFlushTimer);
        this._reviewFlushTimer = null;
      }
      this._flushPendingReviews().catch(err => {
        console.error('[CollectionWindow] Review flush failed', err);
      });
      return;
    }
    const now = Date.now();
    const idleTime = now - (this._lastReviewActionAt || now);
    const shouldFlushNow = idleTime >= this._reviewIdleFlushDelayMs;
    if (shouldFlushNow && !this._reviewFlushPromise && !this._reviewFlushRetryTimer) {
      if (this._reviewFlushTimer) {
        clearTimeout(this._reviewFlushTimer);
        this._reviewFlushTimer = null;
      }
      this._flushPendingReviews().catch(err => {
        console.error('[CollectionWindow] Review flush failed (idle trigger)', err);
      });
      return;
    }
    if (this._reviewFlushTimer || this._reviewFlushPromise || this._reviewFlushRetryTimer) return;
    this._reviewFlushTimer = setTimeout(() => {
      this._reviewFlushTimer = null;
      if (this._pendingReviewDecisions?.length) {
        this._flushPendingReviews({ force: true }).catch(err => {
          console.error('[CollectionWindow] Review flush failed (timer)', err);
        });
      }
    }, this._reviewIdleFlushDelayMs);
  }

  _startFlushRetryBackoff() {
    if (this._reviewFlushRetryTimer) return;
    if (!this._pendingReviewDecisions?.length) return;
    const attempts = Math.min(this._reviewFlushRetryAttempts, 4);
    const delay = this._reviewFlushBackoffMs * Math.pow(2, attempts);
    this._reviewFlushRetryAttempts++;
    this._reviewFlushRetryTimer = setTimeout(() => {
      this._reviewFlushRetryTimer = null;
      if (!this._pendingReviewDecisions?.length) return;
      this._flushPendingReviews({ keepAlive: true }).catch(err => {
        console.error('[CollectionWindow] Review flush retry failed', err);
      });
    }, delay);
  }

  async _flushPendingReviews({ force = false, keepAlive = false } = {}) {
    if (this.mode !== 'review' && this.mode !== 'cull') return;
    if (this._reviewFlushPromise) {
      if (force) {
        try {
          await this._reviewFlushPromise;
        } catch {
          // ignore – we'll retry below
        }
      } else {
        return this._reviewFlushPromise;
      }
    }
    if (this._reviewFlushTimer) {
      clearTimeout(this._reviewFlushTimer);
      this._reviewFlushTimer = null;
    }
    const pending = this._pendingReviewDecisions?.splice?.(0, this._pendingReviewDecisions.length) || [];
    if (!pending.length) return;

    this._setReviewSyncBanner(`Syncing ${pending.length} decision${pending.length === 1 ? '' : 's'}…`, 'pending');
    const csrfToken = await this._getCsrfToken();

    let processedCull = false;
    const flushPromise = (async () => {
      const failed = [];
      const queueDecisions = pending.filter(decision => decision.queueId);
      const legacyDecisions = pending.filter(decision => !decision.queueId);
      if (queueDecisions.length) {
        for (let i = 0; i < queueDecisions.length; i += MAX_REVIEW_SUBMISSION_BATCH_SIZE) {
          const chunk = queueDecisions.slice(i, i + MAX_REVIEW_SUBMISSION_BATCH_SIZE);
          try {
            await this._commitQueueDecisions(chunk, { csrfToken, keepAlive });
            chunk.forEach(decision => {
              if (decision.queueId) this._claimedQueueIds.delete(decision.queueId);
              if (decision.mode === 'cull') {
                this._pendingCullIds.delete(String(decision.generationId));
                processedCull = true;
              }
            });
          } catch (err) {
            console.error('[CollectionWindow] Review commit request failed', err);
            failed.push(...chunk);
          }
        }
      }
      if (legacyDecisions.length) {
        for (let i = 0; i < legacyDecisions.length; i += MAX_REVIEW_SUBMISSION_BATCH_SIZE) {
          const chunk = legacyDecisions.slice(i, i + MAX_REVIEW_SUBMISSION_BATCH_SIZE);
          try {
            await this._commitLegacyDecisions(chunk);
          } catch (err) {
            console.error('[CollectionWindow] Legacy review commit failed', err);
            failed.push(...chunk);
          }
        }
      }
      if (failed.length) {
        this._pendingReviewDecisions.unshift(...failed);
        throw new Error('review_commit_failed');
      }
    })();

    this._reviewFlushPromise = flushPromise;
    try {
      await flushPromise;
      this._reviewFlushRetryAttempts = 0;
      if (processedCull) {
        if (typeof window !== 'undefined') {
          try {
            window.dispatchEvent(new CustomEvent('collection:cull-updated', {
              detail: {
                collectionId: this.collection?.collectionId,
                sourceWindowId: this.id
              }
            }));
          } catch (_) {
            // ignore
          }
        }
        this._fetchCullStatsForWindow({ force: true }).catch(() => {});
      }
      this._updateReviewSyncBanner();
    } catch (err) {
      this._setReviewSyncBanner('Failed to sync some reviews. Retrying automatically…', 'error');
      this._startFlushRetryBackoff();
      throw err;
    } finally {
      this._reviewFlushPromise = null;
    }
  }

  async _commitQueueDecisions(decisions, { csrfToken = '', keepAlive = false } = {}) {
    if (!Array.isArray(decisions) || decisions.length === 0) return null;
    const submit = async (token, attempt = 1) => {
      const res = await fetch('/api/v1/review-queue/commit', {
        method: 'POST',
        credentials: 'include',
        keepalive: keepAlive,
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': token || '' },
        body: JSON.stringify({ decisions })
      });
      if (res.status === 429 && attempt <= 4) {
        const retryAfter = parseFloat(res.headers.get('retry-after'));
        const delayMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(2000 * attempt, 5000);
        console.warn('[CollectionWindow] Queue commit hit 429, retrying in', delayMs, 'ms');
        this._setReviewSyncBanner(`Sync paused (${Math.round(delayMs / 100) / 10}s)…`, 'ratelimit');
        await CollectionWindow._sleep(delayMs);
        return submit(token, attempt + 1);
      }
      if (res.status === 403 && attempt === 1) {
        // Token likely expired – refresh and retry once.
        CollectionWindow._csrfToken = null;
        const refreshed = await this._getCsrfToken({ forceRefresh: true });
        if (refreshed) {
          return submit(refreshed, attempt + 1);
        }
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Bulk review failed');
      }
      return res.json().catch(() => ({}));
    };
    const tokenToUse = csrfToken || await this._getCsrfToken();
    return submit(tokenToUse, 1);
  }

  async _commitLegacyDecisions(decisions = []) {
    if (!Array.isArray(decisions) || !decisions.length) return null;
    const payload = {
      decisions: decisions.map(decision => ({
        generationId: decision.generationId,
        outcome: decision.outcome
      }))
    };
    const submit = async (token, attempt = 1) => {
      const res = await fetch(`/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/pieces/review/bulk`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': token || ''
        },
        body: JSON.stringify(payload)
      });
      if (res.status === 403 && attempt === 1) {
        CollectionWindow._csrfToken = null;
        const refreshed = await this._getCsrfToken({ forceRefresh: true });
        if (refreshed) {
          return submit(refreshed, attempt + 1);
        }
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Legacy review commit failed');
      }
      return res.json().catch(() => ({}));
    };
    const tokenToUse = await this._getCsrfToken();
    return submit(tokenToUse, 1);
  }

  async _releaseOutstandingQueueItems() {
    if (this.mode !== 'review') return;
    if (!this._claimedQueueIds || !this._claimedQueueIds.size) return;
    const queueIds = new Set(this._claimedQueueIds);
    if (this._activeReview?.queueId) queueIds.add(this._activeReview.queueId);
    if (this._reviewQueue?.length) {
      this._reviewQueue.forEach(entry => {
        if (entry?.queueId) queueIds.add(entry.queueId);
      });
    }
    if (this._pendingReviewDecisions?.length) {
      this._pendingReviewDecisions.forEach(dec => {
        if (dec?.queueId) queueIds.add(dec.queueId);
      });
    }
    await this._releaseClaimedQueueAssignments(Array.from(queueIds));
  }

  async _releaseClaimedQueueAssignments(queueIds = []) {
    if (!Array.isArray(queueIds) || !queueIds.length) return;
    try {
      const csrfToken = await this._getCsrfToken();
      await fetch('/api/v1/review-queue/release', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken || '' },
        body: JSON.stringify({ queueIds })
      });
      queueIds.forEach(id => this._claimedQueueIds.delete(id));
    } catch (err) {
      console.warn('[CollectionWindow] Failed to release queue assignments', err);
    }
  }

  _attachReviewSyncBanner() {
    if (!this._reviewSyncBanner) {
      this._reviewSyncBanner = document.createElement('div');
      this._reviewSyncBanner.className = 'review-sync-banner';
      this._reviewSyncBanner.style.marginTop = '8px';
      this._reviewSyncBanner.style.fontSize = '12px';
      this._reviewSyncBanner.style.color = '#bfc3d9';
    }
    if (!this._reviewSyncBanner.parentElement) {
      this.body.appendChild(this._reviewSyncBanner);
    }
    if (this._reviewSyncBannerState) {
      this._setReviewSyncBanner(this._reviewSyncBannerState.text, this._reviewSyncBannerState.variant);
    }
  }

  _setReviewSyncBanner(text, variant = 'info') {
    this._reviewSyncBannerState = { text, variant };
    if (!this._reviewSyncBanner) return;
    const colorMap = {
      error: '#ff8f8f',
      pending: '#f0d37a',
      ok: '#aee8a1',
      ratelimit: '#f0d37a'
    };
    this._reviewSyncBanner.style.color = colorMap[variant] || '#bfc3d9';
    this._reviewSyncBanner.textContent = text;
  }

  _updateReviewSyncBanner() {
    const pending = this._pendingReviewDecisions?.length || 0;
    if (pending > 0) {
      this._setReviewSyncBanner(`Pending decisions: ${pending} (syncing automatically…)`, 'pending');
    } else {
      this._setReviewSyncBanner('All decisions synced ✅', 'ok');
    }
  }

  async _getCsrfToken({ forceRefresh = false } = {}) {
    if (forceRefresh) {
      CollectionWindow._csrfToken = null;
      CollectionWindow._csrfTokenPromise = null;
    } else if (CollectionWindow._csrfToken) {
      return CollectionWindow._csrfToken;
    }
    if (CollectionWindow._csrfTokenPromise) {
      return CollectionWindow._csrfTokenPromise;
    }
    CollectionWindow._csrfTokenPromise = (async () => {
      try {
        const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
        if (!res.ok) {
          throw new Error(`Failed to fetch CSRF token: HTTP ${res.status}`);
        }
        const data = await res.json();
        CollectionWindow._csrfToken = data.csrfToken || '';
        return CollectionWindow._csrfToken;
      } catch (err) {
        console.warn('[CollectionWindow] Failed to fetch CSRF token', err);
        return '';
      } finally {
        CollectionWindow._csrfTokenPromise = null;
      }
    })();
    return CollectionWindow._csrfTokenPromise;
  }

  _renderNoPiecesMessage() {
    const body = this._getReviewContentTarget();
    body.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.textAlign = 'center';
    wrap.style.padding = '12px';
    const emptyMessage = this.isCullMode ? 'No approved pieces left to cull 🎉' : 'No unreviewed pieces 🎉';
    wrap.innerHTML = `<div>${emptyMessage}</div>`;
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Check Again';
    refreshBtn.style.marginTop = '8px';
    refreshBtn.onclick = () => {
      this._reviewQueue = [];
      this._activeReview = null;
      this._loadNextReview({ showLoading: true });
    };
    wrap.appendChild(refreshBtn);
    body.appendChild(wrap);
    this._attachReviewSyncBanner();
    this._updateReviewSyncBanner();
    if (this._claimedQueueIds?.size) {
      this._releaseOutstandingQueueItems().catch(() => {});
    }
    if (this._pendingReviewDecisions?.length) {
      this._flushPendingReviews({ force: true }).catch(err => {
        console.error('[CollectionWindow] Failed to flush pending reviews after completion', err);
      });
    }
  }

  /* ---------------- Test Mode ---------------- */
  async _renderTest() {
    const body = this.body;
    // Clear body but preserve BaseWindow's result-container (outputEl)
    // We'll append our UI elements before it
    const existingResultContainer = body.querySelector('.result-container');
    body.innerHTML = '';
    // Re-add BaseWindow's result container so WebSocket handler can find it
    if (existingResultContainer) {
      body.appendChild(existingResultContainer);
    } else if (this.outputEl) {
      // Fallback: use BaseWindow's outputEl if it exists
      body.appendChild(this.outputEl);
    }

    const categories = this.collection.config?.traitTree || [];
    const selects = {};

    // Trait selectors form ------------------
    categories.forEach(cat => {
      const row = document.createElement('div');
      row.style.marginBottom = '4px';
      const label = document.createElement('label');
      label.textContent = cat.name;
      label.style.marginRight = '6px';
      row.appendChild(label);

      let inp;
      if (cat.mode === 'generated' && cat.generator?.type === 'range') {
        inp = document.createElement('input');
        inp.type = 'number';
        if (Number.isFinite(cat.generator.start)) inp.min = String(cat.generator.start);
        if (Number.isFinite(cat.generator.end)) inp.max = String(cat.generator.end);
        if (Number.isFinite(cat.generator.step)) inp.step = String(cat.generator.step);
      } else {
        inp = document.createElement('select');
        inp.innerHTML = `<option value="">(random)</option>` + (cat.traits || []).map(t => `<option value="${t.value ?? t.name}">${t.name}</option>`).join('');
      }
      selects[cat.name] = inp;
      row.appendChild(inp);
      body.appendChild(row);
    });

    // Parameter inputs (required/optional) --------
    const paramsWrap = document.createElement('div');
    paramsWrap.style.marginTop = '8px';
    const requiredSection = document.createElement('div');
    requiredSection.className = 'required-params';
    const optionalSection = document.createElement('div');
    optionalSection.className = 'optional-params';
    optionalSection.style.display = 'none';
    const showMoreBtn = document.createElement('button');
    showMoreBtn.textContent = 'show more';
    showMoreBtn.className = 'show-more-button';
    let expanded = false;
    showMoreBtn.onclick = () => {
      expanded = !expanded;
      optionalSection.style.display = expanded ? 'flex' : 'none';
      showMoreBtn.textContent = expanded ? 'show less' : 'show more';
      showMoreBtn.classList.toggle('active', expanded);
    };
    paramsWrap.append(requiredSection, showMoreBtn, optionalSection);
    body.appendChild(paramsWrap);

    // Fetch tool definition for parameter schema ----------
    let toolDef;
    try {
      let res;
      if (this.collection.generatorType==='spell' && this.collection.spellId) {
        res = await fetch(`/api/v1/spells/registry/${encodeURIComponent(this.collection.spellId)}`);
      } else {
        res = await fetch(`/api/v1/tools/registry/${encodeURIComponent(this.collection.toolId)}`);
      }
      if (res.ok) toolDef = await res.json();
    } catch {}
    const overrides = this.collection.config?.paramOverrides || {};
    let schema = toolDef?.inputSchema || {};
    if(Object.keys(schema).length===0 && Array.isArray(toolDef?.exposedInputs)){
      // create minimal schema objects marking them required
      schema = {};
      toolDef.exposedInputs.forEach(({ paramKey })=>{ schema[paramKey]={ required:true }; });
    }
    const paramEntries = Object.entries(schema).reduce((acc, [k, d]) => {
      (d?.required ? acc.req : acc.opt).push([k, d]);
      return acc;
    }, { req: [], opt: [] });

    const createInput = (k, d) => {
      const wrap = document.createElement('div');
      wrap.className = 'parameter-input';
      wrap.dataset.paramName = k;
      const lab = document.createElement('label');
      lab.textContent = d?.name || k;
      const inp = document.createElement('input');
      inp.type = (d?.type === 'number' || d?.type === 'integer') ? 'number' : 'text';
      inp.value = overrides[k] ?? (d?.default ?? '');
      inp.name = k;
      inp.placeholder = d?.description || lab.textContent;
      wrap.append(lab, inp);
      return wrap;
    };
    paramEntries.req.forEach(e => requiredSection.appendChild(createInput(...e)));
    paramEntries.opt.forEach(e => optionalSection.appendChild(createInput(...e)));

    // Buttons row ------------------
    const btnRow = document.createElement('div');
    btnRow.style.marginTop = '8px';
    const randBtn = document.createElement('button');
    randBtn.textContent = '🎲';
    const execBtn = document.createElement('button');
    execBtn.textContent = 'Execute';
    execBtn.style.marginLeft = '8px';
    btnRow.append(randBtn, execBtn);
    body.appendChild(btnRow);

    // Use BaseWindow's result-container instead of creating a new one
    // This ensures WebSocket handler can find it
    let outputDiv = body.querySelector('.result-container');
    if (!outputDiv) {
      outputDiv = document.createElement('div');
      outputDiv.className = 'result-container';
    outputDiv.style.marginTop = '10px';
    body.appendChild(outputDiv);
    } else {
      // Clear any existing content
      outputDiv.innerHTML = '';
      outputDiv.style.marginTop = '10px';
    }

    let stepUl; // will be created on execute for spells
    let progressIndicator;
    let progBar;

    // Randomise traits handler
    randBtn.onclick = () => {
      categories.forEach(cat => {
        const el = selects[cat.name];
        if (!el) return;
        if (el.tagName === 'SELECT') {
          const opts = Array.from(el.options).slice(1);
          if (opts.length) el.value = opts[Math.floor(Math.random() * opts.length)].value;
        } else if (el.type === 'number') {
          const g = cat.generator || {};
          const start = Number(g.start) || 0;
          const end = Number(g.end) || start;
          const step = Number(g.step) || 1;
          const count = Math.floor((end - start) / step) + 1;
          const idx = Math.floor(Math.random() * count);
          el.value = String(start + idx * step);
        }
      });
    };

    // Execute handler ------------------------
    execBtn.onclick = async () => {
      // Clear previous output/error before executing again
      // Use the result-container that WebSocket handler will use
      const resultContainer = body.querySelector('.result-container') || outputDiv;
      if (resultContainer) {
        resultContainer.innerHTML = '';
        resultContainer.style.display = 'block';
      }
      
      // Note: Unlike SpellWindow we don't pre-create castId; mapping will rely on generationId until first update sets castId.
      // --- Progress UI bootstrap ---
      // Check if progressIndicator exists and is still in DOM, recreate if needed
      if (!progressIndicator || !progressIndicator.parentElement) {
        progressIndicator = document.createElement('div');
        progressIndicator.className = 'progress-indicator';
        body.appendChild(progressIndicator);
      }
      progressIndicator.textContent = 'Executing…';
      progressIndicator.style.display = 'block'; // Ensure it's visible

      // Only create progress bar for spells, not tools
      if (this.collection.generatorType === 'spell') {
        if (!progBar || !progBar.parentElement) {
        progBar = document.createElement('progress');
        progBar.className = 'spell-progress-bar';
          progBar.max = 100;
          progBar.value = 0;
        body.appendChild(progBar);
        }
        progBar.value = 0; // Reset progress bar
        progBar.style.display = 'block'; // Ensure it's visible
      } else {
        // Remove progress bar if it exists for non-spell executions
        if (progBar && progBar.parentElement) {
          progBar.remove();
          progBar = null;
        }
      }

      // Ensure we have step definitions for spell so we can build the status list
      let stepsArr = [];
      if (this.collection.generatorType === 'spell') {
        if (Array.isArray(toolDef?.steps) && toolDef.steps.length) {
          stepsArr = toolDef.steps;
        } else try {
          const resSteps = await fetch(`/api/v1/spells/registry/${encodeURIComponent(this.collection.spellId)}`);
          if (resSteps.ok) {
            const jd = await resSteps.json();
            stepsArr = Array.isArray(jd.steps) ? jd.steps : [];
            toolDef = jd; // cache for future reuse
          }
        } catch {}
      }

      // For spell generator type, build or reset step status list
      if (this.collection.generatorType === 'spell' && stepsArr.length) {
        if (!stepUl) {
          stepUl = document.createElement('ul');
          stepUl.className = 'spell-step-status';

          stepsArr.forEach((step, idx) => {
            const li = document.createElement('li');
            li.dataset.stepId = step.id || idx;
            li.dataset.toolId = step.toolIdentifier || step.toolId;
            li.textContent = `${idx + 1}. ${step.displayName || step.toolIdentifier || 'step'}`;
            li.className = 'pending';
            stepUl.appendChild(li);
          });

          body.appendChild(stepUl);
          // Mark first step as running
          const firstLi = stepUl.querySelector('li');
          if(firstLi) firstLi.className = 'running';
        } else {
          // reset to pending if re-executed
          stepUl.querySelectorAll('li').forEach(li => li.className = 'pending');
        }
      }

      outputDiv.textContent = '';

      const traitSel = {};
      categories.forEach(cat => {
        const el = selects[cat.name];
        if (!el) return;
        let val = el.value;
        
        // If no value selected (random), generate a random trait
        if (val === '') {
          if (cat.mode === 'generated' && cat.generator?.type === 'range') {
            // Generate random number in range
            const start = Number.isFinite(cat.generator.start) ? cat.generator.start : 0;
            const end = Number.isFinite(cat.generator.end) ? cat.generator.end : start;
            const step = Number.isFinite(cat.generator.step) && cat.generator.step > 0 ? cat.generator.step : 1;
            const zeroPad = Number(cat.generator.zeroPad) || 0;
            const count = end >= start ? Math.floor((end - start) / step) + 1 : 1;
            const idx = Math.floor(Math.random() * count);
            const num = start + idx * step;
            val = zeroPad > 0 ? String(num).padStart(zeroPad, '0') : String(num);
          } else if (Array.isArray(cat.traits) && cat.traits.length > 0) {
            // Generate random trait with rarity weighting
            const totalWeight = cat.traits.reduce((acc, t) => acc + (t.rarity || 0.5), 0);
            let random = Math.random() * totalWeight;
            for (const trait of cat.traits) {
              random -= (trait.rarity || 0.5);
              if (random <= 0) {
                val = trait.value ?? trait.name;
                break;
              }
            }
            // Fallback to first trait if none selected
            if (val === '') val = cat.traits[0].value ?? cat.traits[0].name;
          }
        }
        
        if (val !== '') {
          traitSel[cat.name] = el.type === 'number' ? Number(val) : val;
        }
      });

      // Build paramOverrides from inputs
      const paramOverrides = {};
      paramsWrap.querySelectorAll('.parameter-input input').forEach(inp => {
        paramOverrides[inp.name] = inp.type === 'number' ? Number(inp.value) : inp.value;
      });

      console.log('[CollectionWindow] Initial paramOverrides (before trait substitution):', JSON.stringify(paramOverrides, null, 2));
      console.log('[CollectionWindow] Selected traits (including randomly generated):', traitSel);

      // Substitute traits into param strings
      const substitutionsMade = {};
      Object.entries(paramOverrides).forEach(([k, v]) => {
        if (typeof v === 'string') {
          const originalValue = v;
          Object.entries(traitSel).forEach(([cat, catVal]) => {
            const beforeReplace = v;
            v = v.replaceAll(`[[${cat}]]`, String(catVal)).replaceAll(`[[${cat.toLowerCase()}]]`, String(catVal));
            if (beforeReplace !== v) {
              if (!substitutionsMade[k]) substitutionsMade[k] = [];
              substitutionsMade[k].push({ category: cat, value: catVal, before: beforeReplace, after: v });
            }
          });
          paramOverrides[k] = v;
          if (originalValue !== v) {
            console.log(`[CollectionWindow] Trait substitution in ${k}: "${originalValue}" → "${v}"`);
          }
        }
      });

      console.log('[CollectionWindow] Final paramOverrides (after trait substitution):', JSON.stringify(paramOverrides, null, 2));
      if (Object.keys(substitutionsMade).length > 0) {
        console.log('[CollectionWindow] Substitutions made:', substitutionsMade);
      } else {
        console.log('[CollectionWindow] No trait substitutions were made (no [[Category]] placeholders found)');
      }

      // Store trait selection and final params for display later
      this._lastTraitSelection = traitSel;
      this._lastFinalParams = JSON.parse(JSON.stringify(paramOverrides));

      try {
        if (this.collection.generatorType==='spell' && this.collection.spellId) {
          // --- Register as spell window in global state (if not already) ---
          const { addToolWindow, getToolWindow } = await import('../state.js');
          const spellObj = {
            _id: this.collection.spellId,
            slug: this.collection.spellId,
            name: this.collection.name || 'Spell',
            steps: stepsArr,
            exposedInputs: Array.isArray(toolDef?.exposedInputs) ? toolDef.exposedInputs : []
          };
          const model = addToolWindow({ id: this.id, type:'spell', spell: spellObj });
          // Build parameterMappings keyed by nodeId_paramKey, matching executeSpell expectations
          const mappings = (model.parameterMappings = {});
          // 1. create lookup of form values
          const formValues = {};
          paramsWrap.querySelectorAll('.parameter-input input').forEach(inp=>{
            formValues[inp.name] = inp.type==='number'? Number(inp.value) : inp.value;
          });
          // 2. map over exposedInputs to create proper keys
          (spellObj.exposedInputs || []).forEach(inpDef=>{
            const val=formValues[inpDef.paramKey];
            if(val!==undefined){
              mappings[`${inpDef.nodeId}_${inpDef.paramKey}`]={ type:'static', value: val };
            }
          });
          // Fallback: also include plain keys so ToolWindow UI shows defaults if needed
          Object.entries(formValues).forEach(([k,v])=>{ if(!mappings[k]) mappings[k]={type:'static', value:v}; });
          (await import('../state.js')).persistState();

          // --- Reuse central spell execution flow ---
          const { executeSpell } = await import('../logic/spellExecution.js');
          executeSpell(this.id);
        } else {
          // --- Tool path with proper async handling ---
          const { default: execClient } = await import('../executionClient.js');
          const execResult = await execClient.execute({ 
            toolId: this.collection.toolId, 
            inputs: paramOverrides, 
            metadata:{ platform:'cook-test', traitSel } 
          });

          // Check if this is an async job that needs WebSocket updates
          if (execResult.generationId && !execResult.final) {
            // Long-running job – register with WebSocket handlers and wait for updates
            generationIdToWindowMap[execResult.generationId] = this.el;
            console.log('[CollectionWindow] Registered generationId:', execResult.generationId, 'for window:', this.el.id);
            
            // Update progress indicator
            if (progressIndicator) {
              progressIndicator.textContent = `Status: ${execResult.status || 'pending'}...`;
            }
            
            // Wait for WebSocket completion (handles both success and failure)
            try {
              await generationCompletionManager.createCompletionPromise(execResult.generationId);
              // WebSocket handler will update the UI, but ensure we have a result container
              if (!this.el.querySelector('.result-container')) {
                const resultContainer = document.createElement('div');
                resultContainer.className = 'result-container';
                this.body.appendChild(resultContainer);
              }
            } catch (err) {
              console.error('[CollectionWindow] Error waiting for generation completion:', err);
              if (progressIndicator) progressIndicator.textContent = 'Error waiting for result';
            }
          } else {
            // Immediate result - handle synchronously
            if (progressIndicator) progressIndicator.remove();
            
            if (execResult.final && execResult.status !== 'failed') {
              // Normalize output data similar to ToolWindow
              let outputData;
              if (Array.isArray(execResult.outputs?.images) && execResult.outputs.images[0]?.url) {
                outputData = { type: 'image', url: execResult.outputs.images[0].url, generationId: execResult.generationId };
              } else if (execResult.outputs?.imageUrl) {
                outputData = { type: 'image', url: execResult.outputs.imageUrl, generationId: execResult.generationId };
              } else if (execResult.outputs?.image) {
                outputData = { type: 'image', url: execResult.outputs.image, generationId: execResult.generationId };
              } else if (execResult.outputs?.response) {
                outputData = { type: 'text', text: execResult.outputs.response, generationId: execResult.generationId };
              } else if (execResult.outputs?.text) {
                outputData = { type: 'text', text: execResult.outputs.text, generationId: execResult.generationId };
              } else if (Array.isArray(execResult.outputs) && execResult.outputs[0]?.data) {
                // Handle array format from executionClient
                const data = execResult.outputs[0].data;
                if (data.images?.[0]?.url) {
                  outputData = { type: 'image', url: data.images[0].url, generationId: execResult.generationId };
                } else if (data.text) {
                  outputData = { type: 'text', text: data.text, generationId: execResult.generationId };
                } else {
                  outputData = { type: 'unknown', generationId: execResult.generationId, ...data };
                }
              } else {
                outputData = { type: 'unknown', generationId: execResult.generationId, ...execResult.outputs };
              }
              
              outputDiv.innerHTML = '';
              renderResultContent(outputDiv, outputData);
              // Display trait selection and final parameters
              this._renderTraitAndParamInfo(outputDiv);
            } else if (execResult.status === 'failed') {
              // Show failure message
              outputDiv.innerHTML = `<div style="color: #ff6b6b; padding: 12px; background: rgba(255, 107, 107, 0.1); border-radius: 8px; border: 1px solid rgba(255, 107, 107, 0.3);">
                <strong>Generation Failed</strong><br>
                ${execResult.outputs?.error || execResult.outputs?.message || 'Execution failed. Please check your inputs and try again.'}
              </div>`;
            }
          }
        }
      } catch(e){
        console.error('[CollectionWindow] Execution error:', e);
        if (progressIndicator) progressIndicator.remove();
        outputDiv.innerHTML = `<div style="color: #ff6b6b; padding: 12px; background: rgba(255, 107, 107, 0.1); border-radius: 8px; border: 1px solid rgba(255, 107, 107, 0.3);">
          <strong>Error</strong><br>
          ${e.message || 'Unknown error occurred'}
        </div>`;
      }
    };
  }
}

// Factory helpers for legacy calls
export function createCollectionReviewWindow(collection, position) {
  const win = new CollectionWindow({ mode: 'review', collection, position });
  win.mount();
  return win.el;
}

export function createCollectionCullWindow(collection, position) {
  const win = new CollectionWindow({ mode: 'cull', collection, position });
  win.mount();
  return win.el;
}

export function createCollectionReviveWindow(collection, position) {
  const win = new CollectionWindow({ mode: 'revive', collection, position });
  win.mount();
  return win.el;
}

export function createCollectionTestWindow(collection, position) {
  const win = new CollectionWindow({ mode: 'test', collection, position });
  win.mount();
  return win.el;
}
