import { Component, h } from '@monygroupcorp/microact';
import { Modal, Loader, ModalError } from './Modal.js';
import { AsyncButton, EmptyState, ConfirmInline, TabBar, Badge } from './ModalKit.js';
import { fetchJson, postWithCsrf, fetchWithCsrf } from '../../lib/api.js';
import { TraitTreeEditor } from './TraitTreeEditor.js';
import { websocketClient } from '../ws.js';

const VIEW = { HOME: 'home', CREATE: 'create', DETAIL: 'detail' };
const DETAIL_TAB = { OVERVIEW: 'overview', TRAIT_TREE: 'traitTree', ANALYTICS: 'analytics' };

/**
 * CookModal — main cook/collection management modal (microact).
 *
 * Props:
 *   onClose — close handler
 */
export class CookModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      view: VIEW.HOME,
      loading: false,
      initialLoadComplete: false,
      error: null,

      // Home
      activeCooks: [],
      collections: [],

      // Create
      createName: '',
      createDesc: '',
      creating: false,
      createError: null,

      // Detail
      selectedCollection: null,
      detailTab: DETAIL_TAB.OVERVIEW,

      // Generator picker
      generatorType: null,
      toolOptions: [],
      selectedToolId: null,
      spellOptions: [],
      selectedSpellId: null,
      paramOptions: [],
      paramOverrides: {},
      generatorDisplay: '',
      showGenPicker: false,

      // Overview dirty tracking
      overviewDirty: false,
      pendingDescription: null,
      pendingSupply: null,
      pendingParamOverrides: {},

      // Analytics
      analyticsData: null,
      analyticsLoading: false,
      analyticsError: null,

      // Batch cook prompt
      showBatchPrompt: false,
      batchCollectionId: null,
      batchSize: 10,

      // Test scan
      showTestScan: false,
      testScanItems: [],
      testScanRevealedCount: 0,
      testScanDone: false,
      testScanFailed: false,
      traitTreeFailedCategories: [],
    };

    // WebSocket
    this._ws = null;
    this._wsCookHandler = null;
    this._wsProgressHandler = null;
    this._wsUpdateHandler = null;
    this._pollInterval = null;

    // Cross-module bridge
    this._createCollectionReviewWindow = null;

    // Fetch dedup
    this._fetchActivePromise = null;
    this._fetchCollectionsPromise = null;
    this._loadingTools = false;
    this._loadingSpells = false;
    this._loadingParams = false;
  }

  didMount() {
    this._esc = (e) => { if (e.key === 'Escape') this.props.onClose?.(); };
    document.addEventListener('keydown', this._esc);
    this.registerCleanup(() => document.removeEventListener('keydown', this._esc));
    this._loadSandboxModules();
    this._loadInitial();
    this._subscribeWs();
  }

  willUnmount() {
    this._unsubscribeWs();
    this._stopPolling();
  }

  // ── Cross-module bridge ─────────────────────────────────

  async _loadSandboxModules() {
    // Collection windows are now microact components — opened via windowManager
    // Keep this method for backwards compat but it's a no-op now
  }

  // ── WebSocket ───────────────────────────────────────────

  _subscribeWs() {
    this._ws = websocketClient;
    if (!this._ws || typeof this._ws.on !== 'function') {
      console.warn('[CookModal] WebSocket not available, polling fallback');
      return;
    }
    this._wsCookHandler = (payload) => {
      if (!payload?.collectionId) return;
      this._applyCookStatusUpdate(payload);
    };
    this._wsProgressHandler = (payload) => {
      if (!payload?.collectionId) return;
      this._applyGenerationProgress(payload);
    };
    this._wsUpdateHandler = (payload) => {
      if (!payload?.collectionId) return;
      this._applyGenerationUpdate(payload);
    };
    this._ws.on('cookStatusUpdate', this._wsCookHandler);
    this._ws.on('generationProgress', this._wsProgressHandler);
    this._ws.on('generationUpdate', this._wsUpdateHandler);
    this.registerCleanup(() => this._unsubscribeWs());
  }

  _unsubscribeWs() {
    if (!this._ws || typeof this._ws.off !== 'function') return;
    if (this._wsCookHandler) { this._ws.off('cookStatusUpdate', this._wsCookHandler); this._wsCookHandler = null; }
    if (this._wsProgressHandler) { this._ws.off('generationProgress', this._wsProgressHandler); this._wsProgressHandler = null; }
    if (this._wsUpdateHandler) { this._ws.off('generationUpdate', this._wsUpdateHandler); this._wsUpdateHandler = null; }
  }

  _applyCookStatusUpdate(payload) {
    const { collectionId } = payload;
    const activeCooks = [...this.state.activeCooks];
    const idx = activeCooks.findIndex(c => c.collectionId === collectionId);
    const collMeta = (this.state.collections || []).find(c => c.collectionId === collectionId);
    const norm = (v, fb) => (typeof v === 'number' && !isNaN(v) ? v : fb);
    const current = idx >= 0 ? { ...activeCooks[idx] } : {
      collectionId,
      collectionName: collMeta?.name || payload.collectionName || 'Untitled',
      targetSupply: collMeta?.totalSupply || 0,
      generationCount: 0, running: 0, queued: 0,
    };
    current.generationCount = norm(payload.generationCount, current.generationCount || 0);
    current.targetSupply = norm(payload.targetSupply, current.targetSupply || 0);
    current.running = norm(payload.running, current.running || 0);
    current.queued = norm(payload.queued, current.queued || 0);
    current.status = payload.status || current.status || 'running';
    if (payload.pauseReason !== undefined) current.pauseReason = payload.pauseReason;
    if (current.status === 'stopped') { current.running = 0; current.queued = 0; }
    current.updatedAt = new Date().toISOString();
    if (idx >= 0) activeCooks[idx] = current; else activeCooks.push(current);
    if (this.state.view === VIEW.HOME) {
      this.setState({ activeCooks });
    } else {
      Object.assign(this.state, { activeCooks });
    }
  }

  _applyGenerationProgress(payload) {
    const { collectionId, progress, liveStatus } = payload;
    const activeCooks = [...this.state.activeCooks];
    const idx = activeCooks.findIndex(c => c.collectionId === collectionId);
    if (idx === -1) {
      this._applyCookStatusUpdate({ collectionId, generationCount: 0, targetSupply: 0, status: 'running', running: 1, queued: 0 });
      return;
    }
    const current = { ...activeCooks[idx] };
    current.status = 'running';
    current.running = Math.max(1, current.running || 0);
    current.lastProgress = typeof progress === 'number' ? progress : current.lastProgress;
    current.liveStatus = liveStatus || current.liveStatus || 'Running';
    current.updatedAt = new Date().toISOString();
    activeCooks[idx] = current;
    if (this.state.view === VIEW.HOME) this.setState({ activeCooks }); else Object.assign(this.state, { activeCooks });
  }

  _applyGenerationUpdate(payload) {
    const { collectionId, status } = payload;
    const activeCooks = [...this.state.activeCooks];
    const idx = activeCooks.findIndex(c => c.collectionId === collectionId);
    if (idx === -1) return;
    const current = { ...activeCooks[idx] };
    if (status === 'completed' || status === 'failed') {
      if (status === 'completed' && typeof current.generationCount === 'number') {
        const cap = Number.isFinite(current.targetSupply) && current.targetSupply > 0 ? current.targetSupply : Infinity;
        current.generationCount = Math.min(cap, (current.generationCount || 0) + 1);
      }
      current.running = Math.max(0, (current.running || 1) - 1);
      if (current.running === 0 && current.generationCount >= (current.targetSupply || 0)) current.status = 'paused';
    }
    current.updatedAt = new Date().toISOString();
    activeCooks[idx] = current;
    if (this.state.view === VIEW.HOME) this.setState({ activeCooks }); else Object.assign(this.state, { activeCooks });
  }

  // ── Polling fallback ────────────────────────────────────

  _startPolling(interval = 30000) {
    if (this._pollInterval) return;
    this._pollInterval = setInterval(() => {
      if (this.state.view === VIEW.HOME) this._fetchActiveCooks();
    }, interval);
    this.registerCleanup(() => this._stopPolling());
  }

  _stopPolling() {
    if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
  }

  // ── Data fetching ───────────────────────────────────────

  async _loadInitial() {
    this.setState({ loading: true });
    await Promise.all([this._fetchActiveCooks(), this._fetchCollections()]);
    this.setState({ loading: false, initialLoadComplete: true });
  }

  async _fetchActiveCooks() {
    if (this._fetchActivePromise) return this._fetchActivePromise;
    const promise = (async () => {
      try {
        const data = await fetchJson('/api/v1/cooks/active');
        const activeCooks = data.cooks || [];
        const wsAvailable = this._ws && typeof this._ws.on === 'function';
        const hasRunning = activeCooks.some(c => (c.running || 0) > 0);
        if (!wsAvailable && hasRunning) this._startPolling(30000);
        else if (wsAvailable) this._stopPolling();
        else this._stopPolling();
        if (this.state.view === VIEW.HOME) this.setState({ activeCooks }); else Object.assign(this.state, { activeCooks });
      } catch (err) {
        console.warn('[CookModal] active cooks fetch error', err);
        this._stopPolling();
        if (this.state.view === VIEW.HOME) this.setState({ activeCooks: [] }); else Object.assign(this.state, { activeCooks: [] });
      }
    })();
    this._fetchActivePromise = promise;
    try { await promise; } finally { if (this._fetchActivePromise === promise) this._fetchActivePromise = null; }
  }

  async _fetchCollections() {
    if (this._fetchCollectionsPromise) return this._fetchCollectionsPromise;
    const promise = (async () => {
      try {
        const data = await fetchJson('/api/v1/collections');
        const collections = data.collections || [];
        const selId = this.state.selectedCollection?.collectionId;
        const updated = selId ? collections.find(c => c.collectionId === selId) : null;
        const next = { collections };
        if (updated) next.selectedCollection = updated;
        if (this.state.view === VIEW.HOME) this.setState(next); else Object.assign(this.state, next);
      } catch (err) {
        console.warn('[CookModal] collections fetch error', err);
        if (this.state.view === VIEW.HOME) this.setState({ collections: [] }); else Object.assign(this.state, { collections: [] });
      }
    })();
    this._fetchCollectionsPromise = promise;
    try { await promise; } finally { if (this._fetchCollectionsPromise === promise) this._fetchCollectionsPromise = null; }
  }

  async _fetchTools() {
    if (this._loadingTools) return;
    this._loadingTools = true;
    try {
      const data = await fetchJson('/api/v1/tools');
      const tools = Array.isArray(data) ? data : (data.tools || []);
      this.setState({ toolOptions: tools });
    } catch (err) { console.warn('[CookModal] tools fetch error', err); }
    finally { this._loadingTools = false; }
  }

  async _fetchSpells() {
    if (this._loadingSpells) return;
    this._loadingSpells = true;
    try {
      const data = await fetchJson('/api/v1/spells');
      const spells = Array.isArray(data) ? data : (data.spells || []);
      this.setState({ spellOptions: spells });
    } catch (err) { console.warn('[CookModal] spells fetch error', err); }
    finally { this._loadingSpells = false; }
  }

  async _loadParamOptions() {
    if (this._loadingParams) return;
    this._loadingParams = true;
    try {
      const coll = this.state.selectedCollection;
      if (!coll) return;
      const { toolId, spellId } = this._resolveGenerator(coll);
      let display = '(none)';
      let paramOptions = [];
      let paramOverrides = coll.config?.paramOverrides || {};
      if (toolId) {
        const data = await fetchJson(`/api/v1/tools/${encodeURIComponent(toolId)}/params`);
        paramOptions = data.params || data.paramKeys || [];
        const tool = (this.state.toolOptions || []).find(t => t.toolId === toolId);
        display = tool ? tool.displayName : toolId;
      } else if (spellId) {
        const spell = (this.state.spellOptions || []).find(s => (s.spellId || s._id) === spellId);
        display = spell ? spell.name : spellId;
      }
      this.setState({ paramOptions, paramOverrides, generatorDisplay: display, generatorType: toolId ? 'tool' : (spellId ? 'spell' : null) });
    } catch (err) { console.warn('[CookModal] loadParamOptions error', err); }
    finally { this._loadingParams = false; }
  }

  async _fetchAnalytics(collectionId) {
    this.setState({ analyticsLoading: true, analyticsError: null });
    try {
      const data = await fetchJson(`/api/v1/collections/${encodeURIComponent(collectionId)}/analytics`);
      this.setState({ analyticsData: data, analyticsLoading: false });
    } catch (err) {
      this.setState({ analyticsError: err.message, analyticsLoading: false });
    }
  }

  _resolveGenerator(collection) {
    if (!collection) return { toolId: null, spellId: null };
    const config = collection.config || {};
    const t = (collection.generatorType || '').toLowerCase();
    if (t === 'tool') return { toolId: collection.toolId || config.toolId || null, spellId: null };
    if (t === 'spell') return { toolId: null, spellId: collection.spellId || config.spellId || null };
    if (collection.toolId || config.toolId) return { toolId: collection.toolId || config.toolId, spellId: null };
    if (collection.spellId || config.spellId) return { toolId: null, spellId: collection.spellId || config.spellId };
    return { toolId: null, spellId: null };
  }

  // ── Cook actions ────────────────────────────────────────

  async _startCook(collectionId, batchSize) {
    try {
      let coll = this.state.collections.find(c => c.collectionId === collectionId);
      if (!coll) {
        coll = await fetchJson(`/api/v1/collections/${encodeURIComponent(collectionId)}`);
      }
      const { toolId, spellId } = this._resolveGenerator(coll);
      if (!toolId && !spellId) throw new Error('Please select a generator (tool or spell) before starting.');
      const payload = {
        traitTree: coll.config?.traitTree || [],
        paramOverrides: coll.config?.paramOverrides || {},
        batchSize: Number(batchSize),
      };
      if (toolId) payload.toolId = toolId; else payload.spellId = spellId;
      const res = await postWithCsrf(`/api/v1/collections/${encodeURIComponent(collectionId)}/cook/start`, payload);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'start failed');
      }
      this.setState({ showBatchPrompt: false });
      await this._fetchActiveCooks();
    } catch (err) {
      this.setState({ error: err.message });
    }
  }

  async _pauseCook(id) {
    try {
      const res = await postWithCsrf(`/api/v1/collections/${encodeURIComponent(id)}/cook/pause`, {});
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'pause failed'); }
      await this._fetchActiveCooks();
    } catch (err) { this.setState({ error: err.message }); }
  }

  async _stopCook(id) {
    try {
      const res = await postWithCsrf(`/api/v1/collections/${encodeURIComponent(id)}/cook/stop`, {});
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'stop failed'); }
      await this._fetchActiveCooks();
    } catch (err) { this.setState({ error: err.message }); }
  }

  // ── Collection CRUD ─────────────────────────────────────

  async _createCollection() {
    const { createName, createDesc } = this.state;
    if (!createName.trim()) return;
    this.setState({ creating: true, createError: null });
    try {
      const res = await postWithCsrf('/api/v1/collections', { name: createName.trim(), description: createDesc.trim() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Create failed (${res.status})`); }
      const newColl = await res.json();
      this.setState({ creating: false, view: VIEW.HOME });
      await this._fetchCollections();
    } catch (err) {
      this.setState({ creating: false, createError: err.message });
    }
  }

  async _saveOverview() {
    const coll = this.state.selectedCollection;
    if (!coll) return;
    try {
      this.setState({ loading: true });
      const body = {};
      if (this.state.pendingDescription !== null) body.description = this.state.pendingDescription;
      if (this.state.pendingSupply !== null) body.totalSupply = Number(this.state.pendingSupply);
      if (Object.keys(this.state.pendingParamOverrides).length) body['config.paramOverrides'] = this.state.pendingParamOverrides;
      const res = await fetchWithCsrf(`/api/v1/collections/${encodeURIComponent(coll.collectionId)}`, { method: 'PUT', body });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'save failed'); }
      const updated = await res.json();
      this.setState({
        loading: false, selectedCollection: updated,
        overviewDirty: false, pendingDescription: null, pendingSupply: null, pendingParamOverrides: {},
      });
      await this._fetchCollections();
    } catch (err) {
      this.setState({ loading: false, error: err.message });
    }
  }

  async _saveGenerator() {
    const coll = this.state.selectedCollection;
    if (!coll) return;
    const { generatorType, selectedToolId, selectedSpellId } = this.state;
    const body = { generatorType };
    if (generatorType === 'tool') body.toolId = selectedToolId;
    else body.spellId = selectedSpellId;
    try {
      this.setState({ loading: true });
      const res = await fetchWithCsrf(`/api/v1/collections/${encodeURIComponent(coll.collectionId)}`, { method: 'PUT', body });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'save failed'); }
      const updated = await res.json();
      this.setState({ loading: false, selectedCollection: updated, showGenPicker: false });
      await this._loadParamOptions();
    } catch (err) {
      this.setState({ loading: false, error: err.message });
    }
  }

  async _saveTraitTree(categories) {
    const coll = this.state.selectedCollection;
    if (!coll) return;
    this.setState({ loading: true, error: null });
    try {
      const res = await fetchWithCsrf(`/api/v1/collections/${encodeURIComponent(coll.collectionId)}`, { method: 'PUT', body: { 'config.traitTree': categories } });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'save failed'); }
      const updated = await res.json();
      this.setState({ loading: false, selectedCollection: updated });
      await this._fetchCollections();
    } catch (err) {
      this.setState({ loading: false, error: err.message });
    }
  }

  async _deleteCollection() {
    const coll = this.state.selectedCollection;
    if (!coll) return;
    try {
      const res = await fetchWithCsrf(`/api/v1/collections/${encodeURIComponent(coll.collectionId)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'delete failed'); }
      this.setState({ view: VIEW.HOME, selectedCollection: null });
      await this._fetchCollections();
    } catch (err) { this.setState({ error: err.message }); }
  }

  // ── Trait tree download / upload ────────────────────────

  _downloadTraitTree() {
    const coll = this.state.selectedCollection;
    if (!coll) return;
    const traitTree = coll.config?.traitTree || [];
    const json = JSON.stringify({ categories: traitTree }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trait-tree-${coll.collectionId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  _uploadTraitTree() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        if (!json || !Array.isArray(json.categories)) throw new Error('JSON must have a "categories" array');
        await this._saveTraitTree(json.categories);
      } catch (err) {
        this.setState({ error: 'Upload failed: ' + err.message });
      }
    };
    input.click();
  }

  // ── Analytics export ────────────────────────────────────

  _exportAnalytics() {
    const data = this.state.analyticsData;
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${this.state.selectedCollection?.collectionId || 'export'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Navigation ──────────────────────────────────────────

  _goHome() {
    this.setState({
      view: VIEW.HOME, selectedCollection: null, detailTab: DETAIL_TAB.OVERVIEW,
      overviewDirty: false, pendingDescription: null, pendingSupply: null, pendingParamOverrides: {},
      analyticsData: null, analyticsError: null, showGenPicker: false, error: null,
    });
    this._fetchActiveCooks();
    this._fetchCollections();
  }

  _goCreate() {
    this.setState({ view: VIEW.CREATE, createName: '', createDesc: '', createError: null });
  }

  _openDetail(coll) {
    this.setState({
      view: VIEW.DETAIL, selectedCollection: coll, detailTab: DETAIL_TAB.OVERVIEW,
      overviewDirty: false, pendingDescription: null, pendingSupply: null, pendingParamOverrides: {},
      analyticsData: null, analyticsError: null, showGenPicker: false, error: null,
    });
    this._loadParamOptions();
  }

  _switchDetailTab(tab) {
    this.setState({ detailTab: tab, showGenPicker: false });
    if (tab === DETAIL_TAB.ANALYTICS) {
      const id = this.state.selectedCollection?.collectionId;
      if (id && !this.state.analyticsData) this._fetchAnalytics(id);
    }
  }

  _openReview(collectionId) {
    const collection = this.state.collections.find(c => c.collectionId === collectionId);
    if (collection && this._createCollectionReviewWindow) {
      this.props.onClose?.();
      this._createCollectionReviewWindow(collection);
    }
  }

  _showBatch(collectionId) {
    this.setState({ showBatchPrompt: true, batchCollectionId: collectionId, batchSize: 10 });
  }

  // ── Review stats helper ─────────────────────────────────

  _getReviewStats(cook) {
    const gen = Number.isFinite(cook.generationCount) ? cook.generationCount : 0;
    const rej = Number.isFinite(cook.rejectedCount) ? cook.rejectedCount : 0;
    const approved = Number.isFinite(cook.approvedCount) ? cook.approvedCount : Math.max(0, gen - rej);
    const pending = Number.isFinite(cook.pendingReviewCount) ? cook.pendingReviewCount : Math.max(0, gen - approved - rej);
    return { generationCount: gen, approvedCount: Math.max(0, approved), rejectedCount: rej, pendingReviewCount: Math.max(0, pending) };
  }

  // ── Test scan ───────────────────────────────────────────

  _startTestScan() {
    const coll = this.state.selectedCollection;
    if (!coll) return;
    const paramOverrides = coll.config?.paramOverrides || {};
    const categories = coll.config?.traitTree || [];
    const categoryMap = new Map(categories.map(c => [c.name, c]));

    // Collect all [[X]] placeholders from string param values
    const placeholders = new Set();
    for (const val of Object.values(paramOverrides)) {
      if (typeof val === 'string') {
        for (const m of val.matchAll(/\[\[([^\]]+)\]\]/g)) placeholders.add(m[1]);
      }
    }

    const items = [...placeholders].map(name => {
      const cat = categoryMap.get(name);
      const count = cat?.traits?.length || 0;
      return { name, ok: !!cat && count > 0, count };
    });

    this.setState({
      showTestScan: true,
      testScanItems: items,
      testScanRevealedCount: 0,
      testScanDone: false,
      testScanFailed: false,
    });
    this._animateScan(items);
  }

  _animateScan(items) {
    let i = 0;
    const tick = () => {
      if (i >= items.length) {
        const failed = items.some(it => !it.ok);
        this.setState({ testScanDone: true, testScanFailed: failed });
        if (!failed) setTimeout(() => this._onScanPassed(), 800);
        return;
      }
      this.setState({ testScanRevealedCount: i + 1 });
      i++;
      setTimeout(tick, 40);
    };
    setTimeout(tick, 50);
  }

  _onScanPassed() {
    const coll = this.state.selectedCollection;
    const canvas = window.sandboxCanvas;
    if (canvas && coll) {
      const pos = canvas.screenToWorkspace
        ? canvas.screenToWorkspace(window.innerWidth / 2, window.innerHeight / 2)
        : { x: 300, y: 200 };
      canvas.addCollectionTestWindow(coll, pos);
    }
    this.setState({ showTestScan: false });
    this.props.onClose?.();
  }

  _onScanFailed() {
    const failed = this.state.testScanItems.filter(it => !it.ok).map(it => it.name);
    this.setState({
      showTestScan: false,
      detailTab: DETAIL_TAB.TRAIT_TREE,
      traitTreeFailedCategories: failed,
    });
  }

  _renderTestScan() {
    const { testScanItems, testScanRevealedCount, testScanDone, testScanFailed } = this.state;
    const revealed = testScanItems.slice(0, testScanRevealedCount);

    return h('div', {
      style: 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:1200',
    },
      h('div', { style: 'background:var(--surface-1,#111);border:1px solid var(--border,#333);padding:24px;width:340px;max-height:70vh;overflow-y:auto' },
        h('div', { style: 'font-size:11px;color:var(--text-label,#888);letter-spacing:0.1em;text-transform:uppercase;font-family:var(--ff-mono);margin-bottom:16px' },
          testScanDone ? (testScanFailed ? 'Validation failed' : 'Validation passed') : 'Scanning trait tree...'
        ),
        h('div', { style: 'display:flex;flex-direction:column;gap:6px;font-family:var(--ff-mono);font-size:13px' },
          ...revealed.map(item =>
            h('div', { key: item.name, style: `color:${item.ok ? '#4caf50' : '#f44336'}` },
              item.ok
                ? `✓  [[${item.name}]]  —  ${item.count} trait${item.count !== 1 ? 's' : ''}`
                : `✗  [[${item.name}]]  —  no matching category`
            )
          ),
          !testScanDone ? h('div', { style: 'color:var(--text-label,#555);animation:none' }, '…') : null,
        ),
        testScanDone && testScanFailed
          ? h('div', { style: 'margin-top:20px;display:flex;gap:8px' },
              h('button', {
                style: 'flex:1;background:var(--surface-2,#222);border:1px solid var(--border-hover,#555);color:var(--text-primary,#e0e0e0);padding:8px 0;cursor:pointer;font-size:14px;font-family:var(--ff-mono)',
                onclick: this.bind(this._onScanFailed),
              }, 'Go Fix Issues'),
              h('button', {
                style: 'background:none;border:1px solid var(--border,#333);color:var(--text-label,#888);padding:8px 16px;cursor:pointer;font-size:14px;font-family:var(--ff-mono)',
                onclick: () => this.setState({ showTestScan: false }),
              }, 'Cancel'),
            )
          : null,
      )
    );
  }

  // ── Render: Home ────────────────────────────────────────

  _renderHome() {
    const { activeCooks, collections, initialLoadComplete } = this.state;

    if (!initialLoadComplete) return h(Loader, { message: 'Loading collections...' });

    // Workspace: non-finalized, non-archived, merged with cook status
    const workspace = collections
      .filter(c => !c.finalized && !c.archived)
      .map(c => ({ ...c, cook: activeCooks.find(ac => ac.collectionId === c.collectionId) }))
      .sort((a, b) => {
        const ar = a.cook?.running > 0 ? 1 : 0;
        const br = b.cook?.running > 0 ? 1 : 0;
        if (ar !== br) return br - ar;
        return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
      });

    return h('div', null,
      // Workspace section
      h('h3', { style: 'color:#fff;margin:0 0 12px;font-size:19px' }, 'Workspace'),
      workspace.length === 0
        ? h(EmptyState, { message: 'No collections in workspace. Create one below!' })
        : h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
          ...workspace.map(c => this._renderWorkspaceCard(c))
        ),

      h('hr', { style: 'margin:20px 0;border:none;border-top:1px solid #333' }),

      // All collections grid
      h('h3', { style: 'color:#fff;margin:0 0 12px;font-size:19px' }, 'My Collections'),
      h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px' },
        ...collections.map(c =>
          h('div', {
            key: c.collectionId,
            style: 'background:#222;border:1px solid #333;border-radius:8px;padding:12px;cursor:pointer;font-size:16px;color:#ccc;transition:border-color 0.15s',
            onclick: () => this._openDetail(c),
          },
            c.name || 'Untitled',
            c.finalized ? h(Badge, { label: 'Finalized', variant: 'success' }) : null,
            c.archived ? h(Badge, { label: 'Archived', variant: 'default' }) : null,
          )
        ),
        h('div', {
          style: 'background:#1a1a2e;border:1px dashed #444;border-radius:8px;padding:12px;cursor:pointer;font-size:24px;color:#666;display:flex;align-items:center;justify-content:center;transition:border-color 0.15s',
          onclick: this.bind(this._goCreate),
        }, '+')
      ),

      // Batch prompt overlay
      this.state.showBatchPrompt ? this._renderBatchPrompt() : null
    );
  }

  _renderWorkspaceCard(c) {
    const cook = c.cook;
    const isRunning = cook && cook.running > 0;
    const stats = cook ? this._getReviewStats(cook) : { generationCount: 0, approvedCount: 0, pendingReviewCount: 0 };
    const target = c.totalSupply || c.config?.totalSupply || 0;

    let statusText;
    if (isRunning) {
      const parts = [`${cook.running} running`];
      if (cook.liveStatus) {
        const pct = typeof cook.lastProgress === 'number' ? ` ${Math.round(cook.lastProgress * 100)}%` : '';
        parts.push(`${cook.liveStatus}${pct}`);
      }
      statusText = parts.join(' \u2014 ');
    } else {
      const parts = [];
      if (stats.generationCount > 0) parts.push(`${stats.generationCount} generated`);
      if (stats.approvedCount > 0) parts.push(`${stats.approvedCount} approved`);
      if (stats.pendingReviewCount > 0) parts.push(`${stats.pendingReviewCount} unreviewed`);
      statusText = parts.length ? parts.join(' \u2022 ') : 'No pieces yet';
    }

    const advisory = target > 0 && stats.approvedCount > 0
      ? h('div', { style: 'font-size:13px;color:#888;margin-top:4px' }, `${stats.approvedCount}/${target} toward target`)
      : null;

    return h('div', {
      key: c.collectionId,
      style: 'background:#222;border:1px solid #333;border-radius:8px;padding:14px 16px',
    },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' },
        h('div', { style: 'font-weight:600;font-size:18px;color:#fff' }, c.name || 'Untitled'),
        isRunning ? h('span', { title: 'Cooking in progress', style: 'font-size:19px' }, '\uD83D\uDD25') : null
      ),
      h('div', { style: 'font-size:16px;color:#aaa' }, statusText),
      advisory,
      h('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' },
        isRunning
          ? [
            h(AsyncButton, { key: 'pause', variant: 'secondary', onclick: () => this._pauseCook(c.collectionId), label: 'Pause' }),
            h(AsyncButton, { key: 'stop', variant: 'secondary', onclick: () => this._stopCook(c.collectionId), label: 'Stop' }),
            h(AsyncButton, { key: 'review', onclick: () => this._openReview(c.collectionId), label: 'Review' }),
          ]
          : [
            h(AsyncButton, { key: 'start', variant: 'secondary', onclick: () => this._showBatch(c.collectionId), label: 'Start Cook' }),
            h(AsyncButton, { key: 'review', onclick: () => this._openReview(c.collectionId), label: 'Review' }),
          ]
      )
    );
  }

  _renderBatchPrompt() {
    return h('div', {
      style: 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1100',
      onclick: (e) => { if (e.target === e.currentTarget) this.setState({ showBatchPrompt: false }); },
    },
      h('div', { style: 'background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:24px;width:300px' },
        h('h3', { style: 'color:#fff;margin:0 0 12px' }, 'Start Cook'),
        h('p', { style: 'color:#aaa;font-size:16px;margin:0 0 12px' }, 'How many pieces to generate?'),
        h('input', {
          type: 'number', min: 1, max: 1000, value: this.state.batchSize,
          style: 'width:100%;background:#222;border:1px solid #444;color:#e0e0e0;padding:8px 12px;border-radius:6px;font-size:17px;box-sizing:border-box',
          oninput: (e) => this.setState({ batchSize: Number(e.target.value) }),
          onkeydown: (e) => {
            if (e.key === 'Enter') this._startCook(this.state.batchCollectionId, this.state.batchSize);
            if (e.key === 'Escape') this.setState({ showBatchPrompt: false });
          },
        }),
        h('div', { style: 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end' },
          h(AsyncButton, { variant: 'secondary', onclick: () => this.setState({ showBatchPrompt: false }), label: 'Cancel' }),
          h(AsyncButton, { onclick: () => this._startCook(this.state.batchCollectionId, this.state.batchSize), label: 'Cook' })
        )
      )
    );
  }

  // ── Render: Create ──────────────────────────────────────

  _renderCreate() {
    const { createName, createDesc, creating, createError } = this.state;

    return h('div', null,
      h('button', { className: 'sm-back', onclick: this.bind(this._goHome) }, '\u2190 Back'),
      h('h3', { style: 'color:#fff;margin:0 0 16px' }, 'Create New Collection'),
      createError ? ModalError({ message: createError }) : null,
      h('div', { className: 'sm-form-group' },
        h('label', null, 'Name *'),
        h('input', {
          className: 'sm-input', value: createName, placeholder: 'My Awesome Collection',
          oninput: (e) => this.setState({ createName: e.target.value }),
        })
      ),
      h('div', { className: 'sm-form-group' },
        h('label', null, 'Description'),
        h('textarea', {
          className: 'sm-textarea', value: createDesc, placeholder: 'Short description',
          oninput: (e) => this.setState({ createDesc: e.target.value }),
        })
      ),
      h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px' },
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._goHome), label: 'Cancel' }),
        h(AsyncButton, { loading: creating, disabled: !createName.trim(), onclick: this.bind(this._createCollection), label: 'Create' })
      )
    );
  }

  // ── Render: Detail ──────────────────────────────────────

  _renderDetail() {
    const { selectedCollection, detailTab } = this.state;
    if (!selectedCollection) return h('div', null, ModalError({ message: 'Collection not found' }));

    const tabs = [
      { key: DETAIL_TAB.OVERVIEW, label: 'Overview' },
      { key: DETAIL_TAB.TRAIT_TREE, label: 'Trait Tree' },
      { key: DETAIL_TAB.ANALYTICS, label: 'Analytics' },
    ];

    let tabContent;
    if (detailTab === DETAIL_TAB.OVERVIEW) tabContent = this._renderOverview();
    else if (detailTab === DETAIL_TAB.TRAIT_TREE) tabContent = this._renderTraitTree();
    else tabContent = this._renderAnalytics();

    return h('div', null,
      h('button', { className: 'sm-back', onclick: this.bind(this._goHome) }, '\u2190 Back'),
      h('h3', { style: 'color:#fff;margin:0 0 4px;font-size:22px' }, selectedCollection.name || 'Untitled'),
      h(TabBar, { tabs, active: detailTab, onChange: this.bind(this._switchDetailTab) }),
      tabContent
    );
  }

  // ── Render: Overview tab ────────────────────────────────

  _renderOverview() {
    const { selectedCollection, showGenPicker, overviewDirty, paramOptions, paramOverrides, pendingDescription, pendingSupply, pendingParamOverrides } = this.state;
    const coll = selectedCollection;
    const displayDesc = pendingDescription !== null ? pendingDescription : (coll.description || '');
    const displaySupply = pendingSupply !== null ? pendingSupply : (coll.totalSupply || '');
    const displayOverrides = Object.keys(pendingParamOverrides).length ? pendingParamOverrides : paramOverrides;

    if (showGenPicker) return this._renderGenPicker();

    const rowStyle = 'display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #222;font-size:16px';
    const labelStyle = 'color:#888;min-width:120px';

    return h('div', null,
      // Description
      h('div', { style: rowStyle },
        h('span', { style: labelStyle }, 'Description'),
        h('input', {
          className: 'sm-input', value: displayDesc,
          oninput: (e) => this.setState({ pendingDescription: e.target.value, overviewDirty: true }),
        })
      ),
      // Supply
      h('div', { style: rowStyle },
        h('span', { style: labelStyle }, 'Total Supply'),
        h('input', {
          className: 'sm-input', type: 'number', value: displaySupply,
          oninput: (e) => this.setState({ pendingSupply: e.target.value, overviewDirty: true }),
        })
      ),
      // Generator
      h('div', { style: rowStyle },
        h('span', { style: labelStyle }, 'Generator'),
        h('span', { style: 'color:#ccc' }, this.state.generatorDisplay || '(none)'),
        h(AsyncButton, { variant: 'secondary', onclick: () => this.setState({ showGenPicker: true, generatorType: this.state.generatorType || 'tool' }), label: this.state.generatorDisplay ? 'Change' : 'Set' })
      ),
      // Param overrides (collapsible)
      paramOptions.length > 0 ? h('details', { style: 'margin-top:8px' },
        h('summary', { style: 'color:#888;font-size:16px;cursor:pointer' }, `Generator Parameters (${paramOptions.length})`),
        h('div', { style: 'padding:8px 0' },
          ...paramOptions.map(p => {
            const val = displayOverrides[p] || '';
            return h('div', { key: p, style: rowStyle },
              h('span', { style: labelStyle }, p),
              h('input', {
                className: 'sm-input', value: val,
                oninput: (e) => this.setState({
                  pendingParamOverrides: { ...this.state.pendingParamOverrides, [p]: e.target.value },
                  overviewDirty: true,
                }),
              })
            );
          })
        )
      ) : null,

      // Unsaved changes warning + save
      overviewDirty ? h('div', { style: 'color:#f39c12;font-size:14px;margin-top:8px' }, 'You have unsaved changes') : null,

      // Action buttons
      h('div', { style: 'display:flex;gap:8px;margin-top:16px;flex-wrap:wrap' },
        overviewDirty ? h(AsyncButton, { onclick: this.bind(this._saveOverview), label: 'Save Changes' }) : null,
        h(AsyncButton, { variant: 'secondary', onclick: () => this._showBatch(coll.collectionId), label: 'Start Cook' }),
        h(AsyncButton, { variant: 'secondary', onclick: () => this._openReview(coll.collectionId), label: 'Review' }),
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._startTestScan), label: 'Test' }),
      ),

      // Batch prompt
      this.state.showBatchPrompt ? this._renderBatchPrompt() : null,

      // Test scan overlay
      this.state.showTestScan ? this._renderTestScan() : null
    );
  }

  _renderGenPicker() {
    const { generatorType, toolOptions, spellOptions, selectedToolId, selectedSpellId } = this.state;
    const type = generatorType || 'tool';

    // Lazy load options
    if (type === 'tool' && !toolOptions.length && !this._loadingTools) this._fetchTools();
    if (type === 'spell' && !spellOptions.length && !this._loadingSpells) this._fetchSpells();

    const opts = type === 'tool' ? toolOptions : spellOptions;
    const selId = type === 'tool' ? selectedToolId : selectedSpellId;

    return h('div', null,
      h('h4', { style: 'color:#fff;margin:0 0 12px' }, 'Select Generator'),
      h('div', { style: 'display:flex;gap:12px;margin-bottom:12px' },
        h('label', { style: 'color:#ccc;font-size:16px;display:flex;align-items:center;gap:4px;cursor:pointer' },
          h('input', { type: 'radio', name: 'gen-type', checked: type === 'tool', onchange: () => this.setState({ generatorType: 'tool' }) }),
          'Tool'
        ),
        h('label', { style: 'color:#ccc;font-size:16px;display:flex;align-items:center;gap:4px;cursor:pointer' },
          h('input', { type: 'radio', name: 'gen-type', checked: type === 'spell', onchange: () => this.setState({ generatorType: 'spell' }) }),
          'Spell'
        )
      ),
      h('select', {
        className: 'sm-select',
        value: selId || '',
        onchange: (e) => {
          if (type === 'tool') this.setState({ selectedToolId: e.target.value });
          else this.setState({ selectedSpellId: e.target.value });
        },
      },
        h('option', { value: '' }, opts.length ? 'Choose...' : '(loading...)'),
        ...opts.map(o => h('option', { value: o.toolId || o.spellId || o._id, key: o.toolId || o.spellId || o._id }, o.displayName || o.name))
      ),
      h('div', { style: 'display:flex;gap:8px;margin-top:12px' },
        h(AsyncButton, { onclick: this.bind(this._saveGenerator), label: 'Save' }),
        h(AsyncButton, { variant: 'secondary', onclick: () => this.setState({ showGenPicker: false }), label: 'Cancel' })
      )
    );
  }

  // ── Render: Trait Tree tab ──────────────────────────────

  _renderTraitTree() {
    const coll = this.state.selectedCollection;
    const categories = coll?.config?.traitTree || [];
    const { traitTreeFailedCategories } = this.state;

    return h('div', null,
      traitTreeFailedCategories.length > 0
        ? h('div', { style: 'background:rgba(244,67,54,0.08);border:1px solid rgba(244,67,54,0.3);padding:10px 14px;margin-bottom:12px;font-size:13px;font-family:var(--ff-mono)' },
            h('div', { style: 'color:#f44336;margin-bottom:6px' }, 'Missing categories referenced in master prompt:'),
            ...traitTreeFailedCategories.map(name =>
              h('div', { key: name, style: 'color:#f44336;padding:2px 0' }, `  [[${name}]]`)
            ),
            h('div', { style: 'color:#888;margin-top:6px;font-size:12px' }, 'Add these categories to the trait tree to fix validation.'),
          )
        : null,
      h(TraitTreeEditor, {
        categories,
        onChange: () => {},
        onSave: (cats) => {
          this.setState({ traitTreeFailedCategories: [] });
          return this._saveTraitTree(cats);
        },
      }),
      h('div', { style: 'display:flex;gap:8px;margin-top:12px' },
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._downloadTraitTree), label: 'Download JSON' }),
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._uploadTraitTree), label: 'Upload JSON' })
      )
    );
  }

  // ── Render: Analytics tab ───────────────────────────────

  _renderAnalytics() {
    const { analyticsLoading, analyticsData, analyticsError } = this.state;

    if (analyticsLoading) return h(Loader, { message: 'Loading analytics...' });
    if (analyticsError) return h('div', null,
      ModalError({ message: analyticsError }),
      h(AsyncButton, { variant: 'secondary', onclick: () => this._fetchAnalytics(this.state.selectedCollection?.collectionId), label: 'Retry' })
    );
    if (!analyticsData) return h(EmptyState, { message: 'No analytics available yet. Generate or review some pieces to unlock insights.' });

    const summary = analyticsData.summary || {};
    const fmt = (v) => Number.isFinite(v) ? new Intl.NumberFormat().format(v) : '-';
    const fmtPct = (v) => Number.isFinite(v) ? `${v.toFixed(1)}%` : '-';
    const avgSec = summary.avgDurationMs ? (summary.avgDurationMs / 1000).toFixed(1) + 's' : '-';

    const statCard = (label, value, sub) =>
      h('div', { style: 'background:#1e1e2e;border:1px solid #333;border-radius:8px;padding:14px;text-align:center' },
        h('div', { style: 'font-size:13px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px' }, label),
        h('div', { style: 'font-size:24px;color:#fff;font-weight:600' }, value),
        sub ? h('div', { style: 'font-size:13px;color:#666;margin-top:2px' }, sub) : null
      );

    // Trait rarity
    const rarity = analyticsData.traitRarity || [];
    const grouped = new Map();
    rarity.forEach(e => {
      const k = e.category || 'Uncategorized';
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k).push(e);
    });

    return h('div', null,
      // Stats grid
      h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:16px' },
        statCard('Points Spent', fmt(summary.totalPointsSpent)),
        statCard('Approved', fmt(summary.approvedCount), fmtPct(summary.approvalRate) + ' approval'),
        statCard('Rejected', fmt(summary.rejectedCount), fmtPct(summary.rejectionRate) + ' rejection'),
        statCard('Avg Gen Time', avgSec),
        statCard('Pending', fmt(summary.pendingCount)),
      ),

      // Trait rarity
      h('h4', { style: 'color:#fff;margin:16px 0 8px' }, 'Trait Rarity Breakdown'),
      rarity.length === 0
        ? h('div', { style: 'color:#666;font-size:16px' }, 'No trait usage tracked yet.')
        : h('div', null,
          ...Array.from(grouped.entries()).map(([category, entries]) =>
            h('details', { key: category, style: 'margin-bottom:8px' },
              h('summary', { style: 'color:#ccc;font-size:16px;cursor:pointer;font-weight:600' }, category),
              h('div', { style: 'padding:4px 0 4px 16px' },
                ...entries.map(e =>
                  h('div', { key: e.name, style: 'display:flex;justify-content:space-between;font-size:14px;color:#aaa;padding:2px 0' },
                    h('span', null, e.name),
                    h('span', null, `${e.approved || 0}/${e.total || 0} (${e.total ? ((e.approved / e.total) * 100).toFixed(1) : '0'}%)`)
                  )
                )
              )
            )
          )
        ),

      // Export button
      h('div', { style: 'margin-top:16px' },
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._exportAnalytics), label: 'Export Analytics JSON' })
      )
    );
  }

  // ── Styles ──────────────────────────────────────────────

  static get styles() {
    return `
      .sm-back { background: none; border: none; color: #90caf9; cursor: pointer; font-size: 16px; padding: 0; margin-bottom: 16px; }
      .sm-back:hover { text-decoration: underline; }
      .sm-form-group { margin-bottom: 14px; }
      .sm-form-group label { display: block; margin-bottom: 6px; color: #aaa; font-weight: 600; font-size: 16px; }
      .sm-input { width: 100%; padding: 8px 12px; background: #222; border: 1px solid #444; border-radius: 6px; color: #e0e0e0; font-size: 17px; box-sizing: border-box; }
      .sm-input:focus { border-color: #90caf9; outline: none; }
      .sm-textarea { width: 100%; padding: 8px 12px; background: #222; border: 1px solid #444; border-radius: 6px; color: #e0e0e0; font-size: 17px; min-height: 60px; resize: vertical; box-sizing: border-box; font-family: inherit; }
      .sm-textarea:focus { border-color: #90caf9; outline: none; }
      .sm-select { width: 100%; padding: 8px 12px; background: #222; border: 1px solid #444; border-radius: 6px; color: #e0e0e0; font-size: 17px; }
    `;
  }

  // ── Main render ─────────────────────────────────────────

  _renderBody() {
    const { view } = this.state;
    if (view === VIEW.CREATE) return this._renderCreate();
    if (view === VIEW.DETAIL) return this._renderDetail();
    return this._renderHome();
  }

  render() {
    const { view, error } = this.state;
    const titleMap = { [VIEW.HOME]: 'Cook', [VIEW.CREATE]: 'New Collection', [VIEW.DETAIL]: 'Collection' };

    return h(Modal, {
      onClose: this.props.onClose,
      title: titleMap[view] || 'Cook',
      wide: true,
      content: [
        error ? ModalError({ message: error }) : null,
        this._renderBody(),
      ],
    });
  }
}
