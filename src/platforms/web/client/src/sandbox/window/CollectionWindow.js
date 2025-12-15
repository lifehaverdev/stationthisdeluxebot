import BaseWindow from './BaseWindow.js';
import { renderResultContent } from '../node/resultContent.js';
import { getToolWindows } from '../state.js';
import { generationIdToWindowMap, generationCompletionManager } from '../node/websocketHandlers.js';
import { showTextOverlay } from '../node/overlays/textOverlay.js';

const MAX_REVIEW_BATCH_SIZE = 50;
const DEFAULT_REVIEW_BATCH_SIZE = 12;
const DEFAULT_REVIEW_PREFETCH_THRESHOLD = 3;
const DEFAULT_REVIEW_FLUSH_THRESHOLD = 6;
const DEFAULT_REVIEW_FLUSH_INTERVAL_MS = 5000;
const MAX_REVIEW_SUBMISSION_BATCH_SIZE = 50;

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
    const idPrefix = mode === 'test' ? 'col-test' : 'col-review';
    const id = `${idPrefix}-${Math.random().toString(36).slice(2, 10)}`;
    const title = `${collection.name || 'Collection'} · ${mode === 'test' ? 'Test' : 'Review'}`;
    super({ id, title, position, classes: ['collection-window'] });

    this.mode = mode;
    this.collection = collection;
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
    this._reviewSyncBannerState = { text: 'All decisions synced ✅', variant: 'ok' };

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

    if (this.mode === 'review') {
      this._beforeUnloadHandler = () => {
        if (this._pendingReviewDecisions?.length) {
          this._flushPendingReviews({ force: true, keepAlive: true }).catch(() => {});
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
      };
    }

    this.renderBody();
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
    if (this.mode === 'review') {
      this._renderReview();
    } else {
      this._renderTest();
    }
  }

  /* ---------------- Review Mode ---------------- */
  _renderReview() {
    const body = this.body;
    body.innerHTML = '';
    const startWrap = document.createElement('div');
    startWrap.style.textAlign = 'center';
    startWrap.style.padding = '8px';
    const startBtn = document.createElement('button');
    startBtn.className = 'start-review-btn';
    startBtn.textContent = 'Start Reviewing';
    startBtn.onclick = () => {
      startBtn.disabled = true;
      startBtn.textContent = 'Loading pieces…';
      this._reviewQueue = [];
      this._activeReview = null;
      this._loadNextReview({ showLoading: true }).catch(() => {
        startBtn.disabled = false;
        startBtn.textContent = 'Start Reviewing';
      });
    };
    startWrap.appendChild(startBtn);
    body.appendChild(startWrap);
  }

  async _loadNextReview({ showLoading = false } = {}) {
    const body = this.body;
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

  async _fetchReviewBatch({ showLoading = false } = {}) {
    if (this._reviewFetchPromise) {
      return this._reviewFetchPromise;
    }
    const loadPromise = (async () => {
      if (showLoading && !this._activeReview) {
        this.body.textContent = 'Loading…';
      }
      const limit = this._reviewBatchSize;
      const url = `/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/pieces/unreviewed?limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const json = await res.json();
      console.log('[CollectionWindow] batched unreviewed API response', json);
      const gens = Array.isArray(json.generations) ? json.generations : [];
      const existingIds = new Set(this._reviewQueue.map(g => g?._id).filter(Boolean));
      if (this._activeReview?._id) existingIds.add(this._activeReview._id);
      const deduped = gens.filter(g => g && g._id && !existingIds.has(g._id));
      deduped.forEach(g => existingIds.add(g._id));
      if (deduped.length) {
        this._reviewQueue.push(...deduped);
      }
      return deduped.length;
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

  _maybePrefetchReviews() {
    if (!this._reviewQueue) this._reviewQueue = [];
    if (this._reviewQueue.length < this._reviewPrefetchThreshold) {
      this._fetchReviewBatch().catch(err => {
        console.error('[CollectionWindow] Prefetch review batch failed', err);
      });
    }
  }

  _renderReviewPiece(gen) {
    const body = this.body;
    this._activeReview = gen;
    body.innerHTML = '';
    const resultDiv = document.createElement('div');
    resultDiv.className = 'result-container';
    body.appendChild(resultDiv);

    const outputData = this._normaliseReviewOutput(gen);
    console.log('[CollectionWindow] rendering review generation', gen, outputData);
    renderResultContent(resultDiv, outputData);

    const btnRow = document.createElement('div');
    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Accept ✅';
    const rejectBtn = document.createElement('button');
    rejectBtn.textContent = 'Reject ❌';
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
        this._bufferReviewDecision(gen._id, outcome);
        this._activeReview = null;
        await this._loadNextReview({ showLoading: true });
      } catch (err) {
        console.error('[CollectionWindow] Failed to advance after decision', err);
        this._setReviewSyncBanner('Failed to load next piece. Please try again.', 'error');
      }
      markInFlight = false;
    };
    acceptBtn.onclick = () => mark('accepted');
    rejectBtn.onclick = () => mark('rejected');
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

  _bufferReviewDecision(generationId, outcome) {
    if (!generationId || !outcome) return;
    if (!Array.isArray(this._pendingReviewDecisions)) this._pendingReviewDecisions = [];
    this._pendingReviewDecisions.push({ generationId, outcome });
    console.log('[CollectionWindow] queued review decision', generationId, outcome, 'pending:', this._pendingReviewDecisions.length);
    this._updateReviewSyncBanner();
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
    if (this._reviewFlushTimer) return;
    this._reviewFlushTimer = setTimeout(() => {
      this._reviewFlushTimer = null;
      if (this._pendingReviewDecisions?.length) {
        this._flushPendingReviews().catch(err => {
          console.error('[CollectionWindow] Review flush failed', err);
        });
      }
    }, this._reviewFlushIntervalMs);
  }

  async _flushPendingReviews({ force = false, keepAlive = false } = {}) {
    if (this.mode !== 'review') return;
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

    const chunks = [];
    for (let i = 0; i < pending.length; i += MAX_REVIEW_SUBMISSION_BATCH_SIZE) {
      chunks.push(pending.slice(i, i + MAX_REVIEW_SUBMISSION_BATCH_SIZE));
    }

    const flushPromise = (async () => {
      const failed = [];
      for (const chunk of chunks) {
        try {
          const resp = await this._postBulkReviewDecisions(chunk, { csrfToken, keepAlive });
          const results = Array.isArray(resp?.results) ? resp.results : [];
          if (results.length) {
            const erroredIds = results.filter(r => r?.status === 'error').map(r => r.generationId);
            if (erroredIds.length) {
              failed.push(...chunk.filter(dec => erroredIds.includes(dec.generationId)));
            }
          }
        } catch (err) {
          console.error('[CollectionWindow] Bulk review request failed', err);
          failed.push(...chunk);
        }
      }
      if (failed.length) {
        // Requeue failed ones at the front for retry
        this._pendingReviewDecisions.unshift(...failed);
        throw new Error('bulk_review_failed');
      }
    })();

    this._reviewFlushPromise = flushPromise;
    try {
      await flushPromise;
      this._updateReviewSyncBanner();
    } catch (err) {
      this._setReviewSyncBanner('Failed to sync some reviews. Retrying automatically…', 'error');
      this._scheduleReviewFlush();
      throw err;
    } finally {
      this._reviewFlushPromise = null;
    }
  }

  async _postBulkReviewDecisions(decisions, { csrfToken = '', keepAlive = false } = {}) {
    if (!Array.isArray(decisions) || decisions.length === 0) return null;
    const res = await fetch(`/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/pieces/review/bulk`, {
      method: 'POST',
      credentials: 'include',
      keepalive: keepAlive,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ decisions })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Bulk review failed');
    }
    return res.json().catch(() => ({}));
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

  async _getCsrfToken() {
    if (CollectionWindow._csrfToken) return CollectionWindow._csrfToken;
    try {
      const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      const data = await res.json();
      CollectionWindow._csrfToken = data.csrfToken;
      return CollectionWindow._csrfToken;
    } catch {
      return '';
    }
  }

  _renderNoPiecesMessage() {
    const body = this.body;
    body.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.textAlign = 'center';
    wrap.style.padding = '12px';
    wrap.innerHTML = '<div>No unreviewed pieces 🎉</div>';
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

export function createCollectionTestWindow(collection, position) {
  const win = new CollectionWindow({ mode: 'test', collection, position });
  win.mount();
  return win.el;
}
