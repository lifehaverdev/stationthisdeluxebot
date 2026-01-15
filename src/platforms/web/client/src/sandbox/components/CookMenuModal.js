// src/platforms/web/client/src/sandbox/components/CookMenuModal.js
// Lightweight modal for managing Collection Cooks.
// Styling follows modsMenuModal.css convention (see cookMenuModal.css override).

import TraitTreeEditor from './TraitTreeEditor.js';
import { showTextOverlay } from '../node/overlays/textOverlay.js';

export default class CookMenuModal {
    constructor(options = {}) {
        this.state = {
            view: 'home', // 'home' | 'detail'
            // views: 'home' | 'create' | 'detail'
            loading: false,
            initialLoadComplete: false, // Track if initial data has been loaded
            error: null,
            activeCooks: [],
            collections: [],
            selectedCollection: null,
            detailTab: 'overview', // 'overview' | 'traitTree' | 'analytics'
            generatorType: null, // 'tool' | 'spell'
            toolOptions: [],
            selectedToolId: null,
            spellOptions: [], // NEW
            selectedSpellId: null, // NEW
            paramOptions: [],
            paramOverrides: {},
            generatorDisplay:'',
            showGenPicker:false,
            overviewDirty: false, // Track unsaved changes in overview
            pendingDescription: null, // Store pending changes before save
            pendingSupply: null,
            pendingParamOverrides: {}, // Store pending param changes before save
            analyticsData: null,
            analyticsLoading: false,
            analyticsError: null,
            analyticsCollectionId: null,
            paramPanelOpen: false,
            exportJobs: {},
            cullStats: {}
        };
        this.modalElement = null;
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.pollInterval = null; // store polling timer id
        // Robust fetch guard flags to avoid infinite loops
        this._loadingTools = false;
        this._toolsFetched = false;
        this._loadingSpells = false;
        this._spellsFetched = false;
        this._loadingParams = false; // Guard for loadParamOptions
        this._loadedParamKeys = null; // Cache for loaded param keys
        this._analyticsCache = new Map();
        this._traitCategoryState = new Map();
        this._paramDetailsEl = null;
        this._paramDetailsHandler = null;
        this._exportPollTimer = null;
        this._exportPollContext = null;
        this._exportStatusMeta = new Map();
        this.state.exportForm = { nameTemplate: '', description: '', shuffleOrder: false, collectionId: null };
        this._exportStatusInFlight = new Set();
        this._fetchCollectionsPromise = null;
        this._fetchActivePromise = null;
        this._lastCollectionsFetch = 0;
        this._lastActiveFetch = 0;
        // ✅ WebSocket integration
        this.ws = typeof window !== 'undefined' ? (window.websocketClient || null) : null;
        this._wsCookHandler = null;
        this._wsProgressHandler = null;
        this._wsUpdateHandler = null;
        this._cullStatsLoading = new Map();
        this._handleCullUpdate = this._handleCullUpdate.bind(this);
        if (typeof window !== 'undefined') {
            window.addEventListener('collection:cull-updated', this._handleCullUpdate);
        }
    }

    setState(newState, options = {}) {
        Object.assign(this.state, newState);
        if (options.skipRender) return;
        if (this.modalElement) this.render();
    }

    // --- API helpers ----------------------------------------------------
    _startPolling(interval = 10000) {
        if (this.pollInterval) return; // Already polling
        // Poll at specified interval (default 10s, fallback 30s)
        this.pollInterval = setInterval(() => {
            if (this.state.view === 'home') {
                this.fetchActiveCooks();
            }
        }, interval);
    }

    _stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    async fetchActiveCooks(force = false) {
        const now = Date.now();
        if (!force) {
            if (this._fetchActivePromise) return this._fetchActivePromise;
            if (this._lastActiveFetch && (now - this._lastActiveFetch) < 4000) {
                return;
            }
        }
        const runFetch = async () => {
        try {
            const res = await fetch('/api/v1/cooks/active', { credentials: 'include', cache: 'no-store' });
            if (res.status === 304) return;
            if (!res.ok) throw new Error('failed');
            const data = await res.json();
            const activeCooks = data.cooks || [];
            
            // ✅ Polling logic: Only use as fallback when WebSocket is unavailable
            // WebSocket is considered available if the client exists and has been initialized
            const wsAvailable = this.ws && typeof this.ws.on === 'function';
            const hasRunningCooks = activeCooks.some(c => (c.running || 0) > 0);
            
            if (!wsAvailable && hasRunningCooks) {
                // WebSocket not available, use polling as fallback (slower interval)
                this._startPolling(30000); // 30 seconds when used as fallback
            } else if (wsAvailable) {
                // WebSocket is active, stop polling (WebSocket will handle updates)
                this._stopPolling();
            } else {
                // No running cooks, stop polling regardless
                this._stopPolling();
            }
            
            // Only trigger re-render when we are on home view to avoid wiping inputs in other views
            if (this.state.view === 'home') {
            this.setState({ activeCooks });
            } else {
                Object.assign(this.state, { activeCooks });
            }
        } catch (err) {
            console.warn('[CookMenuModal] active cooks fetch error', err);
            this._stopPolling(); // Stop polling on error
            if (this.state.view === 'home') {
            this.setState({ activeCooks: [] });
            } else {
                Object.assign(this.state, { activeCooks: [] });
            }
        } finally {
                this._lastActiveFetch = Date.now();
            }
        };
        const promise = runFetch();
        this._fetchActivePromise = promise;
        try {
            await promise;
        } finally {
            if (this._fetchActivePromise === promise) {
                this._fetchActivePromise = null;
            }
        }
    }

    async fetchCollections(force = false) {
        const now = Date.now();
        if (!force) {
            if (this._fetchCollectionsPromise) return this._fetchCollectionsPromise;
            if (this._lastCollectionsFetch && (now - this._lastCollectionsFetch) < 4000) {
                return;
            }
        }
        const runFetch = async () => {
        try {
            const res = await fetch('/api/v1/collections', { credentials: 'include', cache: 'no-store' });
            if (res.status === 304) return;
            if (!res.ok) throw new Error('failed');
            const data = await res.json();
            const collections = data.collections || [];
            const selectedId = this.state.selectedCollection?.collectionId;
            const updatedSelection = selectedId ? collections.find(c => c.collectionId === selectedId) : null;
            if (this.state.view === 'home') {
            const nextState = { collections };
            if (updatedSelection) nextState.selectedCollection = updatedSelection;
            this.setState(nextState);
            } else {
                Object.assign(this.state, { collections });
                if (updatedSelection) {
                    this.state.selectedCollection = updatedSelection;
                    if (this.modalElement && this.state.view === 'detail') {
                        this.render();
                    }
                }
            }
        } catch (err) {
            console.warn('[CookMenuModal] collections fetch error', err);
            if (this.state.view === 'home') {
            this.setState({ collections: [] });
            } else {
                Object.assign(this.state, { collections: [] });
            }
        } finally {
                this._lastCollectionsFetch = Date.now();
            }
        };
        const promise = runFetch();
        this._fetchCollectionsPromise = promise;
        try {
            await promise;
        } finally {
            if (this._fetchCollectionsPromise === promise) {
                this._fetchCollectionsPromise = null;
            }
        }
    }

    // --- Show / Hide ----------------------------------------------------
    show() {
        if (this.modalElement) return;
        this.modalElement = document.createElement('div');
        this.modalElement.className = 'cook-modal-overlay';
        document.body.appendChild(this.modalElement);
        this.render();
        this.attachGlobalEvents();
        this.loadInitial();
        // Polling will be started/stopped based on active cooks and WebSocket status
        this.pollInterval = null;
        // ✅ Subscribe to WebSocket events for real-time cook status updates
        this._subscribeToWebSocket();
    }

    hide() {
        if (!this.modalElement) return;
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this._clearExportPoll();
        // ✅ Unsubscribe from WebSocket events
        this._unsubscribeFromWebSocket();
        document.removeEventListener('keydown', this.handleKeyDown);
        document.body.removeChild(this.modalElement);
        this.modalElement = null;
        if (typeof window !== 'undefined') {
            window.removeEventListener('collection:cull-updated', this._handleCullUpdate);
        }
    }

    // ✅ WebSocket subscription management
    _subscribeToWebSocket() {
        if (!this.ws) {
            // Try to get websocketClient from window if not already set
            if (typeof window !== 'undefined' && window.websocketClient) {
                this.ws = window.websocketClient;
            } else {
                console.warn('[CookMenuModal] WebSocket client not available, will use polling fallback');
                return;
            }
        }
        
        // Subscribe to cookStatusUpdate events
        this._wsCookHandler = (payload) => {
            if (!payload || !payload.collectionId) {
                return;
            }
            this._applyCookStatusUpdate(payload);
        };

        this._wsProgressHandler = (payload) => {
            if (!payload || !payload.collectionId) return;
            this._applyGenerationProgress(payload);
        };

        this._wsUpdateHandler = (payload) => {
            if (!payload || !payload.collectionId) return;
            this._applyGenerationUpdate(payload);
        };
        
        if (this.ws && typeof this.ws.on === 'function') {
            this.ws.on('cookStatusUpdate', this._wsCookHandler);
            this.ws.on('generationProgress', this._wsProgressHandler);
            this.ws.on('generationUpdate', this._wsUpdateHandler);
            console.log('[CookMenuModal] Subscribed to cookStatusUpdate and generation progress/update events');
        }
    }

    _unsubscribeFromWebSocket() {
        if (this.ws && typeof this.ws.off === 'function') {
            if (this._wsCookHandler) {
                this.ws.off('cookStatusUpdate', this._wsCookHandler);
                this._wsCookHandler = null;
            }
            if (this._wsProgressHandler) {
                this.ws.off('generationProgress', this._wsProgressHandler);
                this._wsProgressHandler = null;
            }
            if (this._wsUpdateHandler) {
                this.ws.off('generationUpdate', this._wsUpdateHandler);
                this._wsUpdateHandler = null;
            }
            console.log('[CookMenuModal] Unsubscribed from WebSocket cook/generation events');
        }
    }

    _applyCookStatusUpdate(payload) {
        const { collectionId } = payload || {};
        if (!collectionId) return;

        const activeCooks = Array.isArray(this.state.activeCooks) ? [...this.state.activeCooks] : [];
        const idx = activeCooks.findIndex(c => c.collectionId === collectionId);
        const collectionMeta = (this.state.collections || []).find(c => c.collectionId === collectionId);

        const current = idx >= 0 ? { ...activeCooks[idx] } : {
            collectionId,
            collectionName: collectionMeta?.name || payload.collectionName || 'Untitled',
            targetSupply: collectionMeta?.totalSupply || 0,
            generationCount: 0,
            running: 0,
            queued: 0
        };

        const normalizeNumber = (value, fallback) => (typeof value === 'number' && !Number.isNaN(value) ? value : fallback);

        current.generationCount = normalizeNumber(payload.generationCount, current.generationCount || 0);
        current.targetSupply = normalizeNumber(payload.targetSupply, current.targetSupply || 0);
        current.running = normalizeNumber(payload.running, current.running || 0);
        current.queued = normalizeNumber(payload.queued, current.queued || 0);
        current.status = payload.status || current.status || 'running';
        if (payload.pauseReason !== undefined) {
            current.pauseReason = payload.pauseReason;
        }
        if (current.status === 'stopped') {
            current.running = 0;
            current.queued = 0;
        }
        current.updatedAt = new Date().toISOString();
        if (!current.collectionName && (collectionMeta?.name || payload.collectionName)) {
            current.collectionName = collectionMeta?.name || payload.collectionName;
        }

        if (idx >= 0) {
            activeCooks[idx] = current;
        } else {
            activeCooks.push(current);
        }

        const canPatchDom = this.state.view === 'home' && idx >= 0 && this.modalElement;
        this.state.activeCooks = activeCooks;

        if (canPatchDom) {
            this._refreshCookDom(collectionId);
        } else if (this.state.view === 'home') {
            this.setState({ activeCooks, initialLoadComplete: this.state.initialLoadComplete || activeCooks.length > 0 });
        } else {
            Object.assign(this.state, { activeCooks });
        }
    }

    _applyGenerationProgress(payload) {
        const { collectionId, progress, liveStatus } = payload || {};
        if (!collectionId) return;

        const activeCooks = Array.isArray(this.state.activeCooks) ? [...this.state.activeCooks] : [];
        const idx = activeCooks.findIndex(c => c.collectionId === collectionId);
        if (idx === -1) {
            // Create placeholder entry so UI shows it
            this._applyCookStatusUpdate({
                collectionId,
                generationCount: 0,
                targetSupply: 0,
                status: 'running',
                running: 1,
                queued: 0,
                eventType: 'generationProgress'
            });
            return;
        }

        const current = { ...activeCooks[idx] };
        current.status = 'running';
        current.running = Math.max(1, current.running || 0);
        current.lastProgress = typeof progress === 'number' ? progress : current.lastProgress;
        current.liveStatus = liveStatus || current.liveStatus || 'Running';
        current.updatedAt = new Date().toISOString();
        activeCooks[idx] = current;

        const canPatchDom = this.state.view === 'home' && this.modalElement;
        this.state.activeCooks = activeCooks;
        if (canPatchDom) {
            this._refreshCookDom(collectionId);
        } else if (this.state.view === 'home') {
            this.setState({ activeCooks });
        } else {
            Object.assign(this.state, { activeCooks });
        }
    }

    _applyGenerationUpdate(payload) {
        const { collectionId, status } = payload || {};
        if (!collectionId) return;
        const activeCooks = Array.isArray(this.state.activeCooks) ? [...this.state.activeCooks] : [];
        const idx = activeCooks.findIndex(c => c.collectionId === collectionId);
        if (idx === -1) return;
        const current = { ...activeCooks[idx] };
        if (status === 'completed' || status === 'failed') {
            if (status === 'completed' && typeof current.generationCount === 'number') {
                const cap = Number.isFinite(current.targetSupply) && current.targetSupply > 0 ? current.targetSupply : Infinity;
                current.generationCount = Math.min(cap, (current.generationCount || 0) + 1);
            }
            current.running = Math.max(0, (current.running || 1) - 1);
            if (current.running === 0 && current.generationCount >= (current.targetSupply || 0)) {
                current.status = 'paused';
            }
        }
        current.updatedAt = new Date().toISOString();
        activeCooks[idx] = current;

        const canPatchDom = this.state.view === 'home' && this.modalElement;
        this.state.activeCooks = activeCooks;
        if (canPatchDom) {
            this._refreshCookDom(collectionId);
        } else if (this.state.view === 'home') {
            this.setState({ activeCooks });
        } else {
            Object.assign(this.state, { activeCooks });
        }
    }

    _getReviewStats(cook = {}) {
        const generationCount = Number.isFinite(cook.generationCount) ? cook.generationCount : Math.max(0, Number(cook.generationCount) || 0);
        const rejectedCount = Number.isFinite(cook.rejectedCount) ? cook.rejectedCount : Math.max(0, Number(cook.rejectedCount) || 0);
        const providedApproved = Number.isFinite(cook.approvedCount) ? cook.approvedCount : null;
        const providedPending = Number.isFinite(cook.pendingReviewCount) ? cook.pendingReviewCount : null;

        let approvedCount = providedApproved;
        let pendingReviewCount = providedPending;

        if (approvedCount === null && pendingReviewCount === null) {
            approvedCount = Math.max(0, generationCount - rejectedCount);
            pendingReviewCount = 0;
        } else if (approvedCount === null && pendingReviewCount !== null) {
            approvedCount = Math.max(0, generationCount - rejectedCount - pendingReviewCount);
        } else if (approvedCount !== null && pendingReviewCount === null) {
            pendingReviewCount = Math.max(0, generationCount - approvedCount - rejectedCount);
        }

        const culledCount = Number.isFinite(cook.culledCount) ? cook.culledCount : 0;
        const cullPendingCount = Number.isFinite(cook.cullPendingCount) ? cook.cullPendingCount : 0;

        return {
            generationCount,
            approvedCount: Math.max(0, approvedCount || 0),
            rejectedCount,
            pendingReviewCount: Math.max(0, pendingReviewCount || 0),
            culledCount: Math.max(0, culledCount),
            cullPendingCount: Math.max(0, cullPendingCount)
        };
    }

    _buildCookTitle(cook = {}) {
        const name = cook.collectionName || 'Untitled';
        const targetSupply = Number.isFinite(cook.targetSupply) && cook.targetSupply > 0 ? cook.targetSupply : null;
        const { generationCount, approvedCount } = this._getReviewStats(cook);
        const safeApproved = targetSupply ? Math.min(approvedCount, targetSupply) : approvedCount;
        const showGenerated = generationCount !== approvedCount ? ` (Generated ${generationCount})` : '';
        if (targetSupply) {
            return `${name} – Approved ${safeApproved}/${targetSupply}${showGenerated}`;
        }
        return `${name} – Approved ${safeApproved}${showGenerated}`;
    }

    _formatCookStatus(cook = {}) {
        const {
            status,
            running = 0,
            queued = 0,
            targetSupply = 0,
            lastProgress,
            liveStatus,
            pauseReason,
        } = cook;

        const { approvedCount, rejectedCount, pendingReviewCount, culledCount, cullPendingCount } = this._getReviewStats(cook);
        const normalizedStatus = (status || (running > 0 ? 'running' : 'paused')).toLowerCase();
        const piecesRemaining = Number.isFinite(targetSupply) && targetSupply > 0
            ? Math.max(0, targetSupply - approvedCount)
            : null;
        const pct = typeof lastProgress === 'number'
            ? Math.max(0, Math.min(100, Math.round(lastProgress * 100)))
            : null;

        const parts = [];
        if (normalizedStatus === 'running') {
            parts.push('Running');
            if (running > 0) parts.push(`${running} active`);
            if (queued > 0) parts.push(`${queued} queued`);
        } else if (normalizedStatus === 'paused') {
            parts.push('Paused');
            if (queued > 0) parts.push(`${queued} queued`);
            if (pauseReason && pauseReason !== 'manual') parts.push(pauseReason);
        } else if (normalizedStatus === 'stopped') {
            parts.push('Stopped');
            if (pauseReason && pauseReason !== 'manual') parts.push(pauseReason);
        } else if (normalizedStatus === 'failed') {
            parts.push('Failed');
        } else {
            parts.push(normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1));
        }

        if (pct !== null) {
            parts.push(`${pct}%`);
        }
        if (liveStatus) {
            parts.push(liveStatus);
        }
        if (piecesRemaining !== null) {
            if (piecesRemaining > 0) {
                parts.push(`${piecesRemaining} approvals needed`);
            } else if (targetSupply > 0) {
                parts.push('Target met');
            }
        }
        if (pendingReviewCount > 0) {
            parts.push(`${pendingReviewCount} pending review`);
        }
        if (rejectedCount > 0) {
            parts.push(`${rejectedCount} rejected`);
        }
        if (cullPendingCount > 0) {
            parts.push(`${cullPendingCount} pending cull`);
        }
        if (culledCount > 0) {
            parts.push(`${culledCount} excluded`);
        }

        return parts.filter(Boolean).join(' • ') || 'Status unavailable';
    }

    _getStatusIconAndTitle(cook = {}) {
        const normalizedStatus = (cook.status || (cook.running > 0 ? 'running' : 'paused')).toLowerCase();
        if (normalizedStatus === 'running') {
            return { icon: '🔥', title: 'Cook running' };
        }
        if (normalizedStatus === 'paused') {
            return { icon: '⏸', title: 'Cook paused' };
        }
        if (normalizedStatus === 'stopped') {
            return { icon: '⏹', title: 'Cook stopped' };
        }
        if (normalizedStatus === 'failed') {
            return { icon: '⚠️', title: 'Cook failed' };
        }
        return { icon: 'ℹ️', title: 'Status update' };
    }

    _refreshCookDom(collectionId) {
        if (!this.modalElement || this.state.view !== 'home') return;
        const cook = (this.state.activeCooks || []).find(c => c.collectionId === collectionId);
        if (!cook) return;

        const item = this.modalElement.querySelector(`.cook-status-item[data-id="${collectionId}"]`);
        if (!item) {
            // Cook might have moved between sections; fall back to full render.
            this.render();
            return;
        }

        const titleEl = item.querySelector('.cook-title');
        if (titleEl) {
            titleEl.textContent = this._buildCookTitle(cook);
        }

        const statusEl = item.querySelector('.cook-status-text');
        if (statusEl) {
            statusEl.textContent = this._formatCookStatus(cook);
        }

        const iconEl = item.querySelector('.cook-status-icon');
        if (iconEl) {
            const { icon, title } = this._getStatusIconAndTitle(cook);
            iconEl.textContent = icon;
            if (title) iconEl.setAttribute('title', title);
        }
    }

    // --- Initial data ---------------------------------------------------
    async loadInitial() {
        this.setState({ loading: true, initialLoadComplete: false });
        await Promise.all([this.fetchActiveCooks(true), this.fetchCollections(true)]);
        this.setState({ loading: false, initialLoadComplete: true });
    }

    // --- Rendering ------------------------------------------------------
    render() {
        const { view, loading, error, saveSuccess } = this.state;
        this.modalElement.innerHTML = `
            <div class="cook-modal-container">
                <button class="close-btn" aria-label="Close">×</button>
                ${loading ? '<div class="loading-spinner">Saving changes...</div>' : ''}
                ${error ? `<div class="error-message"><span class="error-icon">⚠️</span> ${error}</div>` : ''}
                ${saveSuccess ? '<div class="success-message"><span class="success-icon">✓</span> Changes saved successfully</div>' : ''}
                ${view === 'home' ? this.renderHomeView() : ''}
                ${view === 'create' ? this.renderCreateView() : ''}
                ${view === 'detail' ? this.renderDetailView() : ''}
            </div>
        `;
        if (view === 'home') this.attachHomeEvents();
        if (view === 'create') this.attachCreateEvents();
        if (view === 'detail') this.attachDetailEvents();
    }

    // Home view markup - NEW: 2-section model (Workspace + My Collections)
    renderHomeView() {
        const { activeCooks, collections, initialLoadComplete } = this.state;

        // Show loading spinner if initial data hasn't loaded yet
        if (!initialLoadComplete) {
            return `
                <div class="loading-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 40px; min-height: 200px;">
                    <div class="loading-spinner"></div>
                    <p style="margin-top: 20px; color: #aaa; font-size: 14px;">Loading collections...</p>
                </div>
            `;
        }

        // ✅ NEW: Build Workspace items - non-finalized, non-archived collections
        // Merge collection data with active cook status
        const workspaceCollections = collections
            .filter(c => !c.finalized && !c.archived)
            .map(c => {
                const cook = activeCooks.find(ac => ac.collectionId === c.collectionId);
                return { ...c, cook };
            })
            // Sort: actively cooking first, then by updatedAt
            .sort((a, b) => {
                const aRunning = a.cook?.running > 0 ? 1 : 0;
                const bRunning = b.cook?.running > 0 ? 1 : 0;
                if (aRunning !== bRunning) return bRunning - aRunning;
                return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
            });

        // Render workspace cards with simplified status
        const workspaceHtml = workspaceCollections.length ? workspaceCollections.map(c => {
            const cook = c.cook;
            const isRunning = cook && cook.running > 0;
            const stats = cook ? this._getReviewStats(cook) : { generationCount: 0, approvedCount: 0, pendingReviewCount: 0 };
            const targetSupply = c.totalSupply || c.config?.totalSupply || 0;

            // Status text per plan: Active shows batch progress, Idle shows counts
            let statusText;
            if (isRunning) {
                // Active: show batch progress "2/10" style
                const batchProgress = cook.running || 0;
                statusText = `${batchProgress} running`;
            } else {
                // Idle: "24 generated • 18 approved • 3 unreviewed"
                const parts = [];
                if (stats.generationCount > 0) parts.push(`${stats.generationCount} generated`);
                if (stats.approvedCount > 0) parts.push(`${stats.approvedCount} approved`);
                if (stats.pendingReviewCount > 0) parts.push(`${stats.pendingReviewCount} unreviewed`);
                statusText = parts.length ? parts.join(' • ') : 'No pieces yet';
            }

            // Optional advisory when approaching target
            let advisory = '';
            if (targetSupply > 0 && stats.approvedCount > 0) {
                advisory = `<span class="cook-advisory">${stats.approvedCount}/${targetSupply} toward target</span>`;
            }

            // Buttons: Start Cook, Review (or Pause, Stop if cooking)
            let buttonsHtml;
            if (isRunning) {
                buttonsHtml = `
                    <button data-action="pause" data-id="${c.collectionId}" title="Pause Cook">⏸ Pause</button>
                    <button data-action="stop" data-id="${c.collectionId}" title="Stop Cook">⏹ Stop</button>
                    <button data-action="review" data-id="${c.collectionId}" class="review-btn-primary">Review</button>
                `;
            } else {
                buttonsHtml = `
                    <button data-action="start" data-id="${c.collectionId}" class="start-cook-btn-card">Start Cook</button>
                    <button data-action="review" data-id="${c.collectionId}" class="review-btn-primary">Review</button>
                `;
            }

            return `
            <div class="cook-status-item workspace-card" data-id="${c.collectionId}">
                <div class="cook-card-header">
                    <div class="cook-title">${c.name || 'Untitled'}</div>
                    ${isRunning ? '<span class="cook-status-icon" title="Cooking in progress">&#128293;</span>' : ''}
                </div>
                <div class="cook-status-text">${statusText}</div>
                ${advisory}
                <div class="cook-actions">${buttonsHtml}</div>
            </div>
        `;
        }).join('') : '<div class="empty-message">No collections in workspace. Create one below!</div>';

        // ✅ NEW: My Collections - ALL collections (simple grid, names only, for navigation)
        const allCollHtml = collections.length ? collections.map(c => {
            const badges = [];
            if (c.finalized) badges.push('<span class="coll-badge finalized">Finalized</span>');
            if (c.archived) badges.push('<span class="coll-badge archived">Archived</span>');
            return `
            <div class="collection-card" data-id="${c.collectionId}">
                ${c.name || 'Untitled'}
                ${badges.join('')}
            </div>`;
        }).join('') : '<div class="empty-message">No collections yet.</div>';

        return `
            <h2>Workspace</h2>
            <div class="cook-status-list workspace-list">${workspaceHtml}</div>
            <hr>
            <h2>My Collections</h2>
            <div class="collection-grid">${allCollHtml}<div class="collection-card new" data-action="new">＋</div></div>
            <div class="footer"><button class="help-btn">?</button></div>
        `;
    }

    // Create form view
    renderCreateView() {
        return `
            <h2>Create New Collection</h2>
            <form class="create-collection-form">
              <label>Name<br><input type="text" name="name" required placeholder="My Awesome Collection"></label><br>
              <label>Description<br><textarea name="description" rows="3" placeholder="Short description"></textarea></label><br>
              <div class="form-actions"><button type="submit">Create</button> <button type="button" class="cancel-btn">Cancel</button></div>
            </form>
        `;
    }

    // Detail view markup
    renderDetailView() {
        const { selectedCollection, detailTab = 'overview' } = this.state;
        if (!selectedCollection) return '<div class="error-message">Collection not found.</div>';
        if (selectedCollection.collectionId) {
            this.ensureCullStats(selectedCollection.collectionId);
        }
        const tabs = ['overview','traitTree','analytics'];
        const tabsHtml = tabs.map(t=>`<button class="tab-btn${t===detailTab?' active':''}" data-tab="${t}">${t}</button>`).join('');
        let body='';
        if(detailTab==='overview'){
           body=this.renderOverviewBody();
        }else if(detailTab==='traitTree'){
           body=`<div id="trait-tree-container"></div>
                 <div class="trait-tree-actions" style="margin-top:12px;display:flex;gap:8px;">
                   <button class="download-trait-tree-btn">📥 Download JSON</button>
                   <button class="upload-trait-tree-btn">📤 Upload JSON</button>
                   <input type="file" accept=".json" id="trait-tree-file-input" style="display:none">
                 </div>`;
        }else if(detailTab==='analytics'){
            body=this.renderAnalyticsBody();
        }
        return `
            <button class="back-btn">← Back</button>
            <h2>${selectedCollection.name||'Untitled'}</h2>
            <div class="tab-bar">${tabsHtml}</div>
            <div class="tab-body">${body}</div>`;
    }

    renderEditView(){
        const { generatorType, toolOptions, selectedToolId }=this.state;
        const toolSelect=`<select id="tool-select"><option value="">Choose tool…</option>${toolOptions.map(t=>`<option value="${t.toolId}" ${t.toolId===selectedToolId?'selected':''}>${t.displayName}</option>`).join('')}</select>`;
        return `
          <h3>Generator</h3>
          <label><input type="radio" name="gen-type" value="tool" ${generatorType==='tool'?'checked':''}/> Tool</label>
          <label style="margin-left:12px"><input type="radio" name="gen-type" value="spell" ${generatorType==='spell'?'checked':''}/> Spell</label>
          <div class="gen-picker" style="margin-top:8px;">
            ${generatorType==='tool'?toolSelect:'<em>spell picker TBD</em>'}
          </div>
          <button class="save-generator-btn" style="margin-top:10px;">Save Generator</button>`;
    }

    renderOverviewBody(){
        const { selectedCollection, paramOverrides, paramOptions, showGenPicker, toolOptions, selectedToolId, overviewDirty, pendingDescription, pendingSupply, pendingParamOverrides }=this.state;
        if(showGenPicker){
            // NEW generator picker supporting tool or spell
            const { generatorType, toolOptions, spellOptions, selectedToolId, selectedSpellId } = this.state;
            const ensureDataLoaded=()=>{
                if(generatorType==='tool'&&!toolOptions.length){this.fetchTools();}
                if(generatorType==='spell'&&!spellOptions.length){this.fetchSpells();}
            };
            ensureDataLoaded();
            const opts=(generatorType==='tool'?toolOptions:spellOptions);
            const selId=generatorType==='tool'?selectedToolId:selectedSpellId;
            const optionsHtml=opts.length?opts.map(o=>`<option value="${o.toolId||o.spellId}" ${ (o.toolId||o.spellId)===selId?'selected':''}>${o.displayName}</option>`).join(''):'<option>(loading...)</option>';
            return `<h3>Select Generator</h3>
                <label><input type="radio" name="gen-type" value="tool" ${generatorType==='tool'?'checked':''}/> Tool</label>
                <label style="margin-left:12px"><input type="radio" name="gen-type" value="spell" ${generatorType==='spell'?'checked':''}/> Spell</label>
                <div style="margin-top:8px;">
                    <select id="gen-select" style="width:100%;max-width:320px;">${optionsHtml}</select>
                </div>
                <div style="margin-top:12px;">
                    <button class="save-generator-btn">Save</button>
                    <button class="cancel-generator-btn" style="margin-left:8px;">Cancel</button>
                </div>`;
        }
        // Use pending values if they exist, otherwise use saved values
        const displayDescription = pendingDescription !== null ? pendingDescription : (selectedCollection.description||'');
        const displaySupply = pendingSupply !== null ? pendingSupply : (selectedCollection.totalSupply||'');
        const numericSupply = Number(selectedCollection.totalSupply || selectedCollection.config?.totalSupply || 0);
        const displayParamOverrides = Object.keys(pendingParamOverrides).length > 0 ? pendingParamOverrides : paramOverrides;
        const collId = selectedCollection.collectionId;
        let cullStats = null;
        if (collId) {
            this.ensureCullStats(collId);
            cullStats = this.state.cullStats?.[collId] || null;
        }
        const totalAccepted = cullStats?.totalAccepted || 0;
        const keptCount = cullStats?.keptCount || 0;
        const pendingCullCount = cullStats?.pendingCullCount || 0;
        const culledCount = cullStats?.culledCount || 0;
        const cullSummaryText = this._formatCullSummary(cullStats, numericSupply);
        const aboveTarget = numericSupply > 0 ? Math.max(0, keptCount - numericSupply) : 0;
        const cullButtonLabel = pendingCullCount > 0
            ? 'Continue Culling'
            : (aboveTarget > 0 ? 'Cull Extras' : 'Start Culling');
        const cullButtonDisabled = cullStats ? totalAccepted <= 0 : false;
        const hasCullDecisions = cullStats
            ? ((culledCount || 0) > 0 || ((keptCount || 0) > (pendingCullCount || 0)))
            : false;
        const shouldOfferCullRetry = !pendingCullCount && aboveTarget > 0 && keptCount > 0;
        const shouldOfferRevive = culledCount > 0;
        
        // Escape HTML for safe display
        const escapeHtml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        const safeDescription = escapeHtml(displayDescription);
        const safeSupply = escapeHtml(String(displaySupply));
        
        const cullButtonAttr = cullButtonDisabled ? ' disabled' : '';
        const repeatCullAttr = keptCount > 0 ? '' : ' disabled';
        const cullButtonsHtml = [
            `<button class="cull-btn"${cullButtonAttr}>${cullButtonLabel}</button>`
        ];
        if (shouldOfferCullRetry) {
            cullButtonsHtml.push(`<button class="repeat-cull-btn"${repeatCullAttr} style="margin-left:6px;">Cull Again</button>`);
        }
        if (shouldOfferRevive) {
            const reviveAttr = culledCount > 0 ? '' : ' disabled';
            cullButtonsHtml.push(`<button class="revive-cull-btn"${reviveAttr} style="margin-left:6px;">Revive Excluded</button>`);
        }
        const metaRows=`
          <tr><td>Description</td><td>${safeDescription}</td><td><button class="edit-desc-btn">Edit</button></td></tr>
          <tr><td>Total Supply*</td><td>${safeSupply}</td><td><button class="edit-supply-btn">Edit</button></td></tr>
          <tr><td>Second Pass Cull</td><td>${this._escapeHtml(cullSummaryText)}</td><td>${cullButtonsHtml.join(' ')}</td></tr>`;
        const genRow=`<tr><td>Generator</td><td>${this.state.generatorDisplay||'(none)'}</td><td><button class="edit-gen-btn">${this.state.generatorDisplay?'Change':'Set'}</button></td></tr>`;
        const paramRows=paramOptions.map(p=>{
            const value = displayParamOverrides[p]||'';
            // Truncate long values for display
            const displayValue = value.length > 50 ? value.substring(0, 47) + '...' : value;
            const safeValue = escapeHtml(value);
            const safeDisplay = escapeHtml(displayValue);
            return `<tr data-param="${p}"><td>${p}</td><td title="${safeValue}">${safeDisplay}</td><td><button class="edit-param-btn">Edit</button></td></tr>`;
        }).join('');
        const paramSection = paramOptions.length ? `
          <tr class="param-section-row">
            <td colspan="3">
              <details class="param-details" ${this.state.paramPanelOpen ? 'open' : ''}>
                <summary>Generator Parameters (${paramOptions.length})</summary>
                <table class="param-inner-table"><tbody>${paramRows}</tbody></table>
              </details>
            </td>
          </tr>` : '';
        
        const unsavedWarning = overviewDirty ? '<div class="unsaved-changes">You have unsaved changes</div>' : '';
        
        // ✅ NEW: Archive/Finalize buttons per plan
        const isArchived = selectedCollection.archived === true;
        const isFinalized = selectedCollection.finalized === true;
        const archiveButtonLabel = isArchived ? 'Unarchive' : 'Archive';
        const archiveButtonClass = isArchived ? 'unarchive-btn' : 'archive-btn';
        const finalizeButtonDisabled = isFinalized ? ' disabled' : '';
        const finalizeButtonLabel = isFinalized ? 'Finalized' : 'Finalize';

        return `<table class="meta-table">${metaRows}${genRow}${paramSection}</table>
        ${unsavedWarning}
        <div style="margin-top:12px">
            ${overviewDirty ? '<button class="save-overview-btn" style="margin-right:8px;">Save Changes</button>' : ''}
            <button class="test-btn">Test</button>
            <button class="review-btn">Review</button>
            <button class="reset-review-btn" title="Mark all pieces as unreviewed" style="margin-left:8px;">Restart Review</button>
            ${hasCullDecisions ? '<button class="reset-cull-btn" title="Clear all keep/exclude decisions" style="margin-left:8px;">Reset Cull</button>' : ''}
            <button class="start-cook-btn">Start Cook</button>
            <button class="delete-collection-btn" style="float:right;color:#f55">Delete</button>
        </div>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid rgba(255,255,255,0.1);">
        <div class="collection-lifecycle-actions">
            <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #888;">Collection Lifecycle</h4>
            <button class="${archiveButtonClass}" title="${isArchived ? 'Remove from archive and show in Workspace' : 'Hide from Workspace but keep in My Collections'}">${archiveButtonLabel}</button>
            <button class="finalize-btn"${finalizeButtonDisabled} title="${isFinalized ? 'This collection has been finalized' : 'Permanently mark as complete (cannot be undone)'}" style="margin-left:8px;">${finalizeButtonLabel}</button>
            ${isFinalized ? '<span class="finalized-badge" style="margin-left:8px; color:#27ae60; font-size:12px;">✓ Collection finalized</span>' : ''}
        </div>`;
    }

    _renderExportSectionContent(summary = {}) {
        const escapeText = (value) => this._escapeHtml(value ?? '');
        const selectedCollection = this.state.selectedCollection;
        if (selectedCollection && (!this.state.exportForm || this.state.exportForm.collectionId !== selectedCollection.collectionId)) {
            this.state.exportForm = this._buildExportFormDefaults(selectedCollection);
        }
        const currentExportForm = this.state.exportForm && selectedCollection && this.state.exportForm.collectionId === selectedCollection.collectionId
            ? this.state.exportForm
            : this._buildExportFormDefaults(selectedCollection);
        const collectionId = selectedCollection?.collectionId;
        const activeJob = collectionId ? (this.state.exportJobs?.[collectionId] || null) : null;
        const exportJob = activeJob && (activeJob.jobType === 'archive' || !activeJob.jobType) ? activeJob : null;
        const publishJob = activeJob && activeJob.jobType === 'gallery' ? activeJob : null;
        const targetSupply = selectedCollection?.totalSupply || selectedCollection?.config?.totalSupply || summary.totalSupply || 0;
        const approvedCount = summary.approvedCount || 0;
        const readyForExport = approvedCount > 0;
        const jobInProgress = activeJob && ['pending', 'running'].includes(activeJob.status);
        const exportInProgress = exportJob && ['pending', 'running'].includes(exportJob.status);
        const publishInProgress = publishJob && ['pending', 'running'].includes(publishJob.status);
        const publishInfo = selectedCollection?.publishedGallery || null;
        const publishLocked = !!publishInfo?.publishedAt || !!publishJob;
        const exportButtonDisabled = !readyForExport || jobInProgress;
        const exportButtonLabel = exportInProgress
            ? 'Preparing Export…'
            : (readyForExport ? 'Export Collection (ZIP)' : 'Approve Pieces to Export');
        const exportButtonClass = exportInProgress ? 'export-collection-btn is-running' : 'export-collection-btn';
        const exportButtonDisabledAttr = exportButtonDisabled ? ' disabled' : '';
        const exportStatusMarkup = this.renderExportStatus(exportJob, readyForExport, targetSupply, approvedCount, activeJob);
        const showCancel = jobInProgress;
        const publishButtonDisabled = publishLocked || !readyForExport || jobInProgress;
        const publishButtonLabel = publishLocked
            ? 'Published'
            : (publishInProgress ? 'Publishing…' : 'Publish to Gallery');
        const publishButtonClass = publishInProgress ? 'publish-btn is-running' : 'publish-btn';
        const publishStatusMarkup = this.renderPublishStatus({ job: publishJob, info: publishInfo, readyForExport });
        const shuffleDisabledAttr = publishLocked ? ' disabled' : '';
        const nameHelpText = '<small>Use <code>{{number}}</code> where the sequential number should appear.</small>';
        const lockNote = publishLocked ? '<small class="export-lock-note">Ordering locked to published manifest.</small>' : '';
        const exportConfigMarkup = (!exportInProgress)
            ? `
                <div class="export-config">
                    <label>
                        Metadata Name Template
                        <input type="text" class="export-name-template" value="${escapeText(currentExportForm.nameTemplate || '')}" placeholder="${escapeText((selectedCollection?.name || 'Piece') + ' #{{number}}')}"${publishLocked ? ' disabled' : ''}>
                        ${nameHelpText}
                    </label>
                    <label>
                        Description
                        <textarea class="export-description" rows="3" placeholder="Describe your collection..."${publishLocked ? ' disabled' : ''}>${escapeText(currentExportForm.description || '')}</textarea>
                    </label>
                    <label class="export-shuffle-row">
                        <input type="checkbox" class="export-shuffle"${currentExportForm.shuffleOrder ? ' checked' : ''}${shuffleDisabledAttr}>
                        Shuffle approved pieces before exporting
                        ${lockNote}
                    </label>
                </div>
            `
            : '';

        return `
            <h3>Export Collection</h3>
            <p>Download a review-ready archive of your approved pieces once your collection supply is met.</p>
            ${exportConfigMarkup}
            <div class="export-buttons-row">
                <button class="${exportButtonClass}"${exportButtonDisabledAttr} data-label="${exportButtonLabel}">${exportButtonLabel}</button>
                ${showCancel ? `<button class="cancel-export-btn">${publishJob ? 'Cancel Publish' : 'Cancel Export'}</button>` : ''}
            </div>
            ${exportStatusMarkup}
            <div class="publish-divider"></div>
            <div class="publish-section">
                <h3>Publish to gallery.miladystation2.net</h3>
                <p>Stream your approved pieces to our gallery host. Publishing locks numbering order for future exports.</p>
                <div class="export-buttons-row">
                    <button class="${publishButtonClass}" data-label="${publishButtonLabel}"${publishButtonDisabled ? ' disabled' : ''}>${publishButtonLabel}</button>
                </div>
                ${publishStatusMarkup}
            </div>
        `;
    }

    renderAnalyticsBody() {
        const { analyticsLoading, analyticsData } = this.state;
        if (analyticsLoading) {
            return `<div class="analytics-loading">Loading collection analytics…</div>`;
        }
        if (this.state.analyticsError) {
            return `<div class="error-message">${this.state.analyticsError}</div>`;
        }
        if (!analyticsData) {
            return `<div class="empty-message">No analytics available yet. Generate or review some pieces to unlock insights.</div>`;
        }

        const summary = analyticsData.summary || {};
        const selectedCollection = this.state.selectedCollection;
        const currentCollectionId = selectedCollection?.collectionId;
        if (currentCollectionId) {
            this.ensureCullStats(currentCollectionId);
        }
        const cullStats = currentCollectionId ? (this.state.cullStats?.[currentCollectionId] || null) : null;
        const cullSummary = this._formatCullSummary(cullStats, summary.totalSupply);
        const formatterCache = this._numberFormatterCache || new Map();
        this._numberFormatterCache = formatterCache;
        const getFormatter = (digits = 0) => {
            const key = digits <= 0 ? `int` : `p${digits}`;
            if (!formatterCache.has(key)) {
                formatterCache.set(
                    key,
                    new Intl.NumberFormat(undefined, digits <= 0
                        ? { maximumFractionDigits: 0 }
                        : { minimumFractionDigits: 0, maximumFractionDigits: digits })
                );
            }
            return formatterCache.get(key);
        };
        const formatNumber = (val, digits = 0) => {
            const num = Number(val);
            if (!Number.isFinite(num)) return '-';
            return getFormatter(digits).format(num);
        };
        const avgSeconds = summary.avgDurationMs ? summary.avgDurationMs / 1000 : 0;
        const traitSections = (() => {
            const rarity = analyticsData.traitRarity || [];
            if (!rarity.length) {
                return '<div class="empty-message">No trait usage has been tracked yet.</div>';
            }
            const grouped = new Map();
            rarity.forEach(entry => {
                const key = entry.category || 'Uncategorized';
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(entry);
            });
            const traitState = this._traitCategoryState || (this._traitCategoryState = new Map());
            return Array.from(grouped.entries()).map(([category, entries]) => {
                const totals = entries.reduce((acc, entry) => {
                    acc.approved += entry.approved || 0;
                    acc.total += entry.total || 0;
                    return acc;
                }, { approved: 0, total: 0 });
                const rows = entries.map(entry => {
                    const approvalRate = entry.total
                        ? `${formatNumber((entry.approved / entry.total) * 100, 1)}%`
                        : 'n/a';
                    return `
                        <div class="trait-row">
                            <span class="trait-name">${this._escapeHtml(entry.name)}</span>
                            <span class="trait-approvals">${formatNumber(entry.approved)}/${formatNumber(entry.total)}</span>
                            <span class="trait-rate">${approvalRate}</span>
                        </div>
                    `;
                }).join('');
                const openState = traitState.has(category)
                    ? (traitState.get(category) ? 'open' : '')
                    : '';
                return `
                    <details class="trait-category" data-category="${category}" ${openState}>
                        <summary>
                            <span class="trait-category-title">${category}</span>
                            <span class="trait-category-count">${formatNumber(totals.approved)}/${formatNumber(totals.total)} approved</span>
                        </summary>
                        <div class="trait-rows">${rows}</div>
                    </details>
                `;
            }).join('');
        })();

        const exportSectionInner = this._renderExportSectionContent(summary);

        return `
            <div class="analytics-section export">
                ${exportSectionInner}
            </div>
            <div class="analytics-grid">
                <div class="stat-card">
                    <div class="stat-label">Points Spent</div>
                    <div class="stat-value">${formatNumber(summary.totalPointsSpent)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Approved</div>
                    <div class="stat-value">${formatNumber(summary.approvedCount)}</div>
                    <div class="stat-sub">${formatNumber(summary.approvalRate, 1)}% approval</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Rejected</div>
                    <div class="stat-value">${formatNumber(summary.rejectedCount)}</div>
                    <div class="stat-sub">${formatNumber(summary.rejectionRate, 1)}% rejection</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Avg Generation Time</div>
                    <div class="stat-value">${avgSeconds ? formatNumber(avgSeconds, 1) : '-'}s</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Pending Reviews</div>
                    <div class="stat-value">${formatNumber(summary.pendingCount)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Cull Progress</div>
                    <div class="stat-value">${this._escapeHtml(cullSummary)}</div>
                    <div class="stat-sub">Keep vs. target supply</div>
                </div>
            </div>
            <div class="analytics-section">
                <h3>Trait Rarity Breakdown</h3>
                ${traitSections || '<div class="empty-message">No trait tree has been configured yet.</div>'}
            </div>
        `;
    }

    renderExportStatus(job, readyForExport, targetSupply, approvedCount, activeJob = null) {
        if (!readyForExport) {
            const supplyMsg = targetSupply > 0
                ? `Approved ${approvedCount}/${targetSupply}. You can still export early, but finished pieces only.`
                : 'Approve at least one piece to enable exports.';
            return `<div class="export-status muted">${supplyMsg}</div>`;
        }
        if (!job) {
            if (activeJob && ['pending', 'running'].includes(activeJob.status) && activeJob.jobType === 'gallery') {
                return '<div class="export-status muted">Publishing in progress. Exporting is locked until it completes.</div>';
            }
            return '<div class="export-status muted">No export requested yet.</div>';
        }
        const status = job.status || 'pending';
        const progress = job.progress || {};
        const parts = [];
        const total = progress.total || progress.current || 0;
        const current = progress.current || 0;
        if (status === 'pending') {
            parts.push('Queued – awaiting worker availability');
        } else if (status === 'running') {
            parts.push(`Running (${current}/${total || '?'})`);
        } else if (status === 'completed') {
            parts.push('Ready for download');
        } else if (status === 'completed_with_skips') {
            parts.push('Ready (some items skipped)');
        } else if (status === 'cancelled') {
            parts.push('Cancelled');
        } else if (status === 'failed') {
            parts.push(`Failed: ${job.error || 'Unexpected error'}`);
        } else {
            parts.push(status);
        }
        if (progress.stage) {
            parts.push(this._formatExportStage(progress.stage));
        }
        let actions = '';
        if (status === 'completed' && job.downloadUrl) {
            const expires = job.expiresAt ? new Date(job.expiresAt).toLocaleString() : null;
            actions = `<div class="export-actions"><a class="export-download" href="${job.downloadUrl}" target="_blank" rel="noopener">Download ZIP</a>${expires ? `<span class="export-expiry">Expires ${expires}</span>` : ''}</div>`;
        }
        return `<div class="export-status export-${status}">
            <div>${parts.join(' • ')}</div>
            ${actions}
        </div>`;
    }

    renderPublishStatus({ job, info, readyForExport }) {
        if (!readyForExport) {
            return '<div class="export-status muted">Approve at least one piece to enable publishing.</div>';
        }
        if (job) {
            const status = job.status || 'pending';
            if ((status === 'completed' || status === 'completed_with_skips') && job.publishResult) {
                const result = job.publishResult;
                const baseLabel = result.baseUrl ? `<div class="publish-base">Base path: <code>${this._escapeHtml(result.baseUrl)}</code></div>` : '';
                const links = [
                    result.baseUrl ? `<a href="${result.baseUrl}" target="_blank" rel="noopener">Open Gallery</a>` : '',
                    result.manifestUrl ? `<a href="${result.manifestUrl}" target="_blank" rel="noopener">Manifest</a>` : '',
                    result.metadataUrl ? `<a href="${result.metadataUrl}" target="_blank" rel="noopener">Metadata</a>` : ''
                ].filter(Boolean).join(' • ');
                return `<div class="export-status export-completed">
                    <div>Publishing complete</div>
                    ${links ? `<div class="export-actions">${links}</div>` : ''}
                    ${baseLabel}
                </div>`;
            }
            const parts = [];
            if (status === 'pending') {
                parts.push('Queued – awaiting worker');
            } else if (status === 'running') {
                const current = job.progress?.current || 0;
                const total = job.progress?.total || 0;
                parts.push(`Publishing (${current}/${total || '?'})`);
            } else if (status === 'completed' || status === 'completed_with_skips') {
                parts.push('Publishing complete');
            } else if (status === 'failed') {
                parts.push(`Failed: ${job.error || 'Unexpected error'}`);
            }
            if (job.progress?.stage) {
                parts.push(this._formatExportStage(job.progress.stage));
            }
            return `<div class="export-status export-${status}">
                <div>${parts.join(' • ')}</div>
            </div>`;
        }
        if (info && (info.baseUrl || info.manifestUrl)) {
            const publishedAt = info.publishedAt ? new Date(info.publishedAt).toLocaleString() : null;
            const baseLink = info.baseUrl ? `<a href="${info.baseUrl}" target="_blank" rel="noopener">Open Gallery</a>` : '';
            const manifestLink = info.manifestUrl ? `<a href="${info.manifestUrl}" target="_blank" rel="noopener">Manifest</a>` : '';
            const metadataLink = info.metadataUrl ? `<a href="${info.metadataUrl}" target="_blank" rel="noopener">Metadata</a>` : '';
            const links = [baseLink, manifestLink, metadataLink].filter(Boolean).join(' • ');
            const baseLabel = info.baseUrl ? `<div class="publish-base">Base path: <code>${this._escapeHtml(info.baseUrl)}</code></div>` : '';
            return `<div class="export-status export-completed">
                <div>Published${publishedAt ? ` ${publishedAt}` : ''}</div>
                ${links ? `<div class="export-actions">${links}</div>` : ''}
                ${baseLabel}
            </div>`;
        }
        return '<div class="export-status muted">Not published yet.</div>';
    }

    _formatExportStage(stage) {
        if (!stage) return '';
        const map = {
            queued: 'Queued',
            preparing: 'Preparing manifest',
            collecting: 'Collecting approved pieces',
            uploading: 'Uploading archive',
            completed: 'Completed',
            completed_with_skips: 'Completed (with skips)',
            failed: 'Failed',
            cancelled: 'Cancelled',
            publishing_images: 'Publishing images',
            publishing_metadata: 'Publishing metadata',
            finalizing_publish: 'Finalizing publish'
        };
        return map[stage] || stage;
    }

    attachCreateEvents() {
        const form = this.modalElement.querySelector('.create-collection-form');
        const cancelBtn = this.modalElement.querySelector('.cancel-btn');
        if (cancelBtn) cancelBtn.onclick = () => this.setState({ view: 'home' });
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                const formData = new FormData(form);
                const name = formData.get('name').trim();
                const description = (formData.get('description') || '').trim();
                if (!name) { alert('Name is required'); return; }
                await this.submitCreateCollection({ name, description });
            };
        }
    }

    attachDetailEvents() {
        const back = this.modalElement.querySelector('.back-btn');
        if (back) back.onclick = () => {
            // Warn if there are unsaved changes
            if (this.state.overviewDirty && this.state.detailTab === 'overview') {
                if (!confirm('You have unsaved changes. Are you sure you want to go back?')) {
                    return;
                }
            }
            this.setState({ 
                view: 'home', 
                selectedCollection: null,
                overviewDirty: false,
                pendingDescription: null,
                pendingSupply: null,
                pendingParamOverrides: {},
                detailTab: 'overview',
                analyticsData: null,
                analyticsError: null,
                analyticsLoading: false,
                analyticsCollectionId: null
            });
        };

        // Always ensure generator / paramOptions loaded when entering detail view
        // Only load if we don't have them AND we haven't already started loading
        if((!this.state.paramOptions.length || !this.state.generatorDisplay) && !this._loadingParams){
            this._loadingParams = true;
            this.loadParamOptions().finally(() => {
                this._loadingParams = false;
            });
        }

        this.modalElement.querySelectorAll('.tab-btn').forEach(btn=>{
            btn.onclick=()=>{
                // Warn if switching away from overview with unsaved changes
                if (this.state.overviewDirty && this.state.detailTab === 'overview') {
                    if (!confirm('You have unsaved changes in Overview. Are you sure you want to switch tabs?')) {
                        return;
                    }
                }
                this.state.detailTab=btn.getAttribute('data-tab');
                this.render();
            };
        });
        if(this.state.detailTab==='traitTree'){
            const container=this.modalElement.querySelector('#trait-tree-container');
            const editor=new TraitTreeEditor({collection:this.state.selectedCollection,paramOptions:this.state.paramOptions,onSave:async (traits)=>{
                await this.saveTraitTree(traits);
            }});
            editor.attach(container);
            
            // Download button
            const downloadBtn = this.modalElement.querySelector('.download-trait-tree-btn');
            if (downloadBtn) {
                downloadBtn.onclick = () => this.downloadTraitTree();
            }
            
            // Upload button and file input
            const uploadBtn = this.modalElement.querySelector('.upload-trait-tree-btn');
            const fileInput = this.modalElement.querySelector('#trait-tree-file-input');
            if (uploadBtn && fileInput) {
                uploadBtn.onclick = () => fileInput.click();
                fileInput.onchange = (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                        // Check file extension
                        if (!file.name.toLowerCase().endsWith('.json')) {
                            alert('Please select a JSON file');
                            e.target.value = '';
                            return;
                        }
                        this.uploadTraitTree(file);
                        // Reset input so same file can be selected again
                        e.target.value = '';
                    }
                };
            }
        }
        // (generator edit UI will be integrated into overview later)
        // ensure paramOptions loaded when entering traitTree
        // Only load if we don't have them AND we haven't already started loading
        if(this.state.detailTab==='traitTree' && !this.state.paramOptions.length && !this._loadingParams){
            this._loadingParams = true;
            this.loadParamOptions().finally(() => {
                this._loadingParams = false;
            });
        }
        if (this.state.detailTab === 'analytics') {
            const collId = this.state.selectedCollection?.collectionId;
            if (collId) {
                if (this._shouldFetchExportStatus(collId)) {
                    this.fetchExportStatus(collId);
                }
                this._ensureAnalyticsData(collId);
            }
            const exportSection = this.modalElement.querySelector('.analytics-section.export');
            this._attachExportSectionEvents(exportSection);
            if (collId) {
                const activeJob = this.state.exportJobs?.[collId] || null;
                if (activeJob && !['completed', 'failed'].includes(activeJob.status)) {
                    this._scheduleExportPoll(collId, activeJob.id);
                }
            }
            this.modalElement.querySelectorAll('.trait-category').forEach(detailsEl => {
                detailsEl.addEventListener('toggle', () => {
                    const key = detailsEl.dataset.category || 'Uncategorized';
                    this._traitCategoryState.set(key, detailsEl.open);
                });
            });
        }
        // Overview edit handlers
        if(this.state.detailTab==='overview'){
            // Reset pending changes when switching to overview (they're already saved or discarded)
            // But preserve them if we're already on overview and just re-rendering
            // NOTE: Don't use setState here as it causes infinite render loop - directly update state
            if (!this.state.overviewDirty) {
                this.state.pendingDescription = null;
                this.state.pendingSupply = null;
                this.state.pendingParamOverrides = {};
            }
            this.attachOverviewEvents();
        }
    }

    async saveTraitTree(traits){
        try {
            this.setState({ loading: true, error: null });
            const csrf = await this.getCsrfToken();
            const id = this.state.selectedCollection.collectionId;
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrf 
                },
                credentials: 'include',
                body: JSON.stringify({'config.traitTree': traits})
            });
            
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to save traits');
            }
            
            this.setState({
                selectedCollection: data,
                loading: false,
                saveSuccess: true
            });
            
            // Clear success message after 2 seconds
            setTimeout(() => {
                this.setState({ saveSuccess: false });
            }, 2000);
        } catch (err) {
            console.error('[CookMenuModal] saveTraitTree error:', err);
            this.setState({
                loading: false,
                error: err.message || 'Failed to save traits. Please try again.'
            });
        }
    }

    async handleExportCollection(buttonEl) {
        const collectionId = this.state.selectedCollection?.collectionId;
        if (!collectionId) return;
        try {
            const csrf = await this.getCsrfToken();
            const defaults = this._buildExportFormDefaults(this.state.selectedCollection);
            const form = this.state.exportForm && this.state.exportForm.collectionId === collectionId
                ? this.state.exportForm
                : defaults;
            const metadataOptions = {
                nameTemplate: (form.nameTemplate || defaults.nameTemplate).trim(),
                description: form.description ?? defaults.description,
                shuffleOrder: !!form.shuffleOrder
            };
            if (buttonEl) {
                buttonEl.disabled = true;
                buttonEl.classList.add('is-running');
                buttonEl.textContent = 'Starting…';
            }
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(collectionId)}/export`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrf
                },
                credentials: 'include',
                body: JSON.stringify({
                    metadataOptions
                })
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to start export');
            }
            this._updateExportJobState(collectionId, data);
            if (data.status !== 'completed' && data.status !== 'failed') {
                this._scheduleExportPoll(collectionId, data.id);
            }
        } catch (err) {
            console.error('[CookMenuModal] export error:', err);
            const friendly = err.message === 'no-approved-pieces'
                ? 'You need at least one approved piece before exporting.'
                : err.message;
            alert(friendly || 'Failed to start export. Please try again.');
        } finally {
            if (buttonEl) {
                buttonEl.disabled = false;
                buttonEl.classList.remove('is-running');
                buttonEl.textContent = buttonEl.dataset.label || 'Export Collection (ZIP)';
            }
        }
    }

    async handlePublishCollection(buttonEl) {
        const collectionId = this.state.selectedCollection?.collectionId;
        if (!collectionId) return;
        if (this.state.selectedCollection?.publishedGallery?.publishedAt) {
            alert('This collection has already been published.');
            return;
        }
        try {
            const csrf = await this.getCsrfToken();
            const defaults = this._buildExportFormDefaults(this.state.selectedCollection);
            const form = this.state.exportForm && this.state.exportForm.collectionId === collectionId
                ? this.state.exportForm
                : defaults;
            const metadataOptions = {
                nameTemplate: (form.nameTemplate || defaults.nameTemplate).trim(),
                description: form.description ?? defaults.description,
                shuffleOrder: !!form.shuffleOrder
            };
            if (buttonEl) {
                buttonEl.disabled = true;
                buttonEl.classList.add('is-running');
                buttonEl.textContent = 'Publishing…';
            }
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(collectionId)}/publish`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrf
                },
                credentials: 'include',
                body: JSON.stringify({ metadataOptions })
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Failed to start publish');
            }
            this._updateExportJobState(collectionId, data);
            if (data.status !== 'completed' && data.status !== 'failed') {
                this._scheduleExportPoll(collectionId, data.id);
            }
        } catch (err) {
            console.error('[CookMenuModal] publish error:', err);
            const friendly = err.message === 'no-approved-pieces'
                ? 'You need at least one approved piece before publishing.'
                : (err.message === 'already-published' ? 'This collection is already published.' : err.message);
            alert(friendly || 'Failed to start publish. Please try again.');
        } finally {
            if (buttonEl) {
                buttonEl.disabled = false;
                buttonEl.classList.remove('is-running');
                buttonEl.textContent = buttonEl.dataset.label || 'Publish to Gallery';
            }
        }
    }

    async handleCancelExport() {
        const collectionId = this.state.selectedCollection?.collectionId;
        if (!collectionId) return;
        const activeJob = this.state.exportJobs?.[collectionId] || null;
        const noun = activeJob?.jobType === 'gallery' ? 'publish' : 'export';
        if (!confirm(`Cancel the current ${noun} job?`)) return;
        try {
            const csrf = await this.getCsrfToken();
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(collectionId)}/export/cancel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrf
                },
                credentials: 'include',
                body: JSON.stringify({})
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'Failed to cancel export');
            }
            this._updateExportJobState(collectionId, data);
            this._clearExportPoll();
            alert('Export cancelled.');
        } catch (err) {
            console.error('[CookMenuModal] cancel export error:', err);
            alert(err.message || 'Failed to cancel export.');
        }
    }

    _updateExportJobState(collectionId, jobData) {
        const exportJobs = { ...(this.state.exportJobs || {}) };
        if (jobData) {
            exportJobs[collectionId] = jobData;
        } else {
            delete exportJobs[collectionId];
        }
        const skipRender = this.state.view === 'detail' && this.state.detailTab === 'analytics';
        this.setState({ exportJobs }, { skipRender });
        if (skipRender) {
            this._refreshExportSection();
        }
        this._markExportStatusFetched(collectionId);
        if (jobData && jobData.jobType === 'gallery' && ['completed', 'completed_with_skips'].includes(jobData.status)) {
            this.fetchCollections(true);
        }
    }

    _refreshExportSection() {
        if (this.state.view !== 'detail' || this.state.detailTab !== 'analytics') return;
        if (!this.modalElement) return;
        const section = this.modalElement.querySelector('.analytics-section.export');
        if (!section) return;
        const summary = this.state.analyticsData?.summary || {};
        section.innerHTML = this._renderExportSectionContent(summary);
        this._attachExportSectionEvents(section);
    }

    _attachExportSectionEvents(root) {
        if (!root) return;
        const exportBtn = root.querySelector('.export-collection-btn');
        if (exportBtn) {
            exportBtn.onclick = () => this.handleExportCollection(exportBtn);
        }
        const publishBtn = root.querySelector('.publish-btn');
        if (publishBtn) {
            publishBtn.onclick = () => this.handlePublishCollection(publishBtn);
        }
        const cancelBtn = root.querySelector('.cancel-export-btn');
        if (cancelBtn) {
            cancelBtn.onclick = () => this.handleCancelExport();
        }
        const nameInput = root.querySelector('.export-name-template');
        if (nameInput) {
            nameInput.addEventListener('input', (e) => {
                if (!this.state.exportForm || !this.state.selectedCollection) return;
                this.state.exportForm.nameTemplate = e.target.value;
            });
        }
        const descInput = root.querySelector('.export-description');
        if (descInput) {
            descInput.addEventListener('input', (e) => {
                if (!this.state.exportForm || !this.state.selectedCollection) return;
                this.state.exportForm.description = e.target.value;
            });
        }
        const shuffleInput = root.querySelector('.export-shuffle');
        if (shuffleInput) {
            shuffleInput.addEventListener('change', (e) => {
                if (!this.state.exportForm || !this.state.selectedCollection) return;
                this.state.exportForm.shuffleOrder = !!e.target.checked;
            });
        }
    }

    _scheduleExportPoll(collectionId, exportId) {
        if (this._exportPollTimer) {
            clearTimeout(this._exportPollTimer);
        }
        this._exportPollContext = { collectionId, exportId };
        this._markExportStatusPending(collectionId);
        this._exportPollTimer = setTimeout(() => this._pollExportStatus(), 4000);
    }

    async _pollExportStatus() {
        if (!this._exportPollContext) return;
        const { collectionId, exportId } = this._exportPollContext;
        if (!collectionId || this._exportStatusInFlight.has(collectionId)) {
            return;
        }
        this._exportStatusInFlight.add(collectionId);
        try {
            let url = `/api/v1/collections/${encodeURIComponent(collectionId)}/export/status`;
            if (exportId) {
                url += `?exportId=${encodeURIComponent(exportId)}`;
            }
            const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
            if (res.status === 304) {
                this._markExportStatusFetched(collectionId);
                this._clearExportPoll();
                return;
            }
            const data = await res.json();
            if (!res.ok) {
                if (res.status === 404 || data.error === 'export-not-found') {
                    this._updateExportJobState(collectionId, null);
                    this._markExportStatusFetched(collectionId);
                    this._clearExportPoll();
                    return;
                }
                throw new Error(data.error || 'Failed to fetch export status');
            }
            this._updateExportJobState(collectionId, data);
            if (data.status === 'completed' || data.status === 'failed') {
                this._clearExportPoll();
                this._markExportStatusFetched(collectionId);
            } else {
                this._scheduleExportPoll(collectionId, data.id);
            }
        } catch (err) {
            console.warn('[CookMenuModal] export status poll failed:', err);
            this._clearExportPoll();
            this._markExportStatusFetched(collectionId);
        } finally {
            this._exportStatusInFlight.delete(collectionId);
        }
    }

    _clearExportPoll() {
        if (this._exportPollTimer) {
            clearTimeout(this._exportPollTimer);
            this._exportPollTimer = null;
        }
        this._exportPollContext = null;
    }

    _markExportStatusFetched(collectionId) {
        if (!collectionId) return;
        this._exportStatusMeta.set(collectionId, { ts: Date.now(), pending: false });
    }

    _markExportStatusPending(collectionId) {
        if (!collectionId) return;
        this._exportStatusMeta.set(collectionId, { ts: Date.now(), pending: true });
    }

    _shouldFetchExportStatus(collectionId) {
        if (!collectionId) return false;
        if (this._exportStatusInFlight.has(collectionId)) return false;
        const meta = this._exportStatusMeta.get(collectionId);
        if (!meta) return true;
        if (typeof meta === 'number') {
            this._exportStatusMeta.set(collectionId, { ts: meta, pending: false });
            return Date.now() - meta > 60 * 1000;
        }
        if (meta.pending) return false;
        const maxAge = 60 * 1000;
        return !meta.ts || (Date.now() - meta.ts) > maxAge;
    }

    async fetchExportStatus(collectionId) {
        if (!collectionId) return;
        if (this._exportStatusInFlight.has(collectionId)) return;
        this._exportStatusInFlight.add(collectionId);
        try {
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(collectionId)}/export/status`, { credentials: 'include', cache: 'no-store' });
            if (res.status === 404) {
                this._updateExportJobState(collectionId, null);
                this._markExportStatusFetched(collectionId);
                return;
            }
            if (res.status === 304) {
                this._markExportStatusFetched(collectionId);
                return;
            }
            const data = await res.json();
            if (!res.ok) {
                if (data.error === 'export-not-found') {
                    this._updateExportJobState(collectionId, null);
                    this._markExportStatusFetched(collectionId);
                    return;
                }
                throw new Error(data.error || 'Failed to fetch export status');
            }
            this._updateExportJobState(collectionId, data);
            this._markExportStatusFetched(collectionId);
        } catch (err) {
            console.warn('[CookMenuModal] fetchExportStatus error:', err);
        } finally {
            this._exportStatusInFlight.delete(collectionId);
        }
    }

    /**
     * Validate trait tree structure matches expected schema
     * Returns { valid: boolean, errors: string[] }
     */
    validateTraitTree(data) {
        const errors = [];
        
        // Root validation
        if (!data || typeof data !== 'object') {
            return { valid: false, errors: ['Root must be an object'] };
        }
        
        if (!Array.isArray(data.categories)) {
            return { valid: false, errors: ['categories must be an array'] };
        }
        
        // Validate each category
        data.categories.forEach((cat, catIdx) => {
            // Category name
            if (!cat.name || typeof cat.name !== 'string' || cat.name.trim().length === 0) {
                errors.push(`Category ${catIdx}: name is required and must be non-empty`);
            }
            
            // Category mode
            if (cat.mode !== 'manual' && cat.mode !== 'generated') {
                errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}): mode must be "manual" or "generated"`);
                return; // Skip further validation for this category
            }
            
            // Manual mode validation
            if (cat.mode === 'manual') {
                if (!Array.isArray(cat.traits)) {
                    errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}): traits must be an array`);
                } else {
                    cat.traits.forEach((trait, traitIdx) => {
                        // Trait name
                        if (!trait.name || typeof trait.name !== 'string' || trait.name.trim().length === 0) {
                            errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}), Trait ${traitIdx}: name is required`);
                        } else if (trait.name.length > 50) {
                            errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}), Trait ${traitIdx}: name must be <= 50 characters`);
                        }
                        
                        // Trait value
                        if (trait.value === undefined || typeof trait.value !== 'string') {
                            errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}), Trait ${traitIdx}: value is required and must be a string`);
                        } else if (trait.value.length > 1000) {
                            errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}), Trait ${traitIdx}: value must be <= 1000 characters`);
                        }
                        
                        // Trait rarity
                        if (trait.rarity !== undefined) {
                            const rarity = Number(trait.rarity);
                            if (isNaN(rarity) || rarity < 0 || rarity > 100) {
                                errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}), Trait ${traitIdx}: rarity must be between 0 and 100`);
                            }
                        }
                    });
                }
            }
            
            // Generated mode validation
            if (cat.mode === 'generated') {
                if (!cat.generator || typeof cat.generator !== 'object') {
                    errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}): generator is required`);
                } else {
                    const gen = cat.generator;
                    
                    // Generator type
                    if (gen.type !== 'range') {
                        errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}): generator.type must be "range"`);
                    }
                    
                    // Start
                    if (!Number.isFinite(gen.start)) {
                        errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}): generator.start must be a number`);
                    }
                    
                    // End
                    if (!Number.isFinite(gen.end)) {
                        errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}): generator.end must be a number`);
                    } else if (Number.isFinite(gen.start) && gen.end < gen.start) {
                        errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}): generator.end must be >= generator.start`);
                    }
                    
                    // Step
                    if (!Number.isFinite(gen.step) || gen.step <= 0) {
                        errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}): generator.step must be a positive number`);
                    }
                    
                    // Zero pad (optional)
                    if (gen.zeroPad !== undefined && (!Number.isFinite(gen.zeroPad) || gen.zeroPad < 0)) {
                        errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}): generator.zeroPad must be a non-negative number`);
                    }
                    
                    // Unique across cook (optional)
                    if (gen.uniqueAcrossCook !== undefined && typeof gen.uniqueAcrossCook !== 'boolean') {
                        errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}): generator.uniqueAcrossCook must be a boolean`);
                    }
                    
                    // Shuffle seed (optional)
                    if (gen.shuffleSeed !== undefined && gen.shuffleSeed !== null && !Number.isFinite(gen.shuffleSeed)) {
                        errors.push(`Category ${catIdx} (${cat.name || 'unnamed'}): generator.shuffleSeed must be a number or null`);
                    }
                }
            }
        });
        
        return { valid: errors.length === 0, errors };
    }

    /**
     * Download trait tree as JSON file
     */
    downloadTraitTree() {
        const { selectedCollection } = this.state;
        if (!selectedCollection) {
            alert('No collection selected');
            return;
        }
        
        const traitTree = selectedCollection.config?.traitTree || [];
        const json = JSON.stringify({ categories: traitTree }, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trait-tree-${selectedCollection.collectionId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Show success feedback
        this.setState({ saveSuccess: true });
        setTimeout(() => this.setState({ saveSuccess: false }), 2000);
    }

    /**
     * Upload trait tree from JSON file
     */
    async uploadTraitTree(file) {
        if (!file) return;
        
        try {
            this.setState({ loading: true, error: null });
            
            // Read file
            const text = await file.text();
            
            // Parse JSON
            let json;
            try {
                json = JSON.parse(text);
            } catch (e) {
                throw new Error(`Invalid JSON: ${e.message}`);
            }
            
            // Validate structure
            const validation = this.validateTraitTree(json);
            if (!validation.valid) {
                throw new Error(`Invalid trait tree structure:\n${validation.errors.join('\n')}`);
            }
            
            // Confirm overwrite if existing trait tree has categories
            const { selectedCollection } = this.state;
            const hasExisting = selectedCollection?.config?.traitTree?.length > 0;
            if (hasExisting) {
                const confirmed = confirm(
                    'This will replace your existing trait tree. Are you sure?'
                );
                if (!confirmed) {
                    this.setState({ loading: false });
                    return;
                }
            }
            
            // Save trait tree
            await this.saveTraitTree(json.categories);
            
            // Show success feedback
            this.setState({ 
                loading: false, 
                saveSuccess: true,
                error: null 
            });
            setTimeout(() => this.setState({ saveSuccess: false }), 2000);
            
        } catch (err) {
            console.error('[CookMenuModal] uploadTraitTree error:', err);
            this.setState({
                loading: false,
                error: err.message || 'Failed to upload trait tree'
            });
        }
    }

    // --- Event handlers -------------------------------------------------
    attachGlobalEvents() {
        // Use event delegation so handlers survive re-render
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) {
                // Click on overlay
                this.hide();
                return;
            }
            if (e.target.closest('.close-btn')) {
                this.hide();
            }
        });
        // Close via Esc key
        document.addEventListener('keydown', this.handleKeyDown);
    }

    attachHomeEvents() {
        // ✅ Delegated click handler for all cook action buttons (handles multiple sections)
        this.modalElement.querySelectorAll('.cook-status-list').forEach(list => {
            list.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-action]');
                if (!btn) return;
                const action = btn.getAttribute('data-action');
                const id = btn.getAttribute('data-id');
                if (action === 'pause') this.pauseCook(id);
                if (action === 'resume') this.resumeCook(id);
                if (action === 'start') this.startCookFromList(id);
                if (action === 'stop') this.stopCook(id);
                if (action === 'review') {
                    // Open review window for this collection
                    const collection = this.state.collections.find(c => c.collectionId === id);
                    if (collection) {
                        this.hide();
                        import('../window/CollectionWindow.js').then(m => {
                            m.createCollectionReviewWindow(collection);
            });
        }
                }
            });
        });

        // Delegated handler for collection cards (including the + card)
        const grid = this.modalElement.querySelector('.collection-grid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                const card = e.target.closest('.collection-card');
                if (!card) return;
                if (card.classList.contains('new')) {
                    this.createCollection();
                    return;
                }
                const id = card.getAttribute('data-id');
                if (id) {
                const coll = this.state.collections.find(c => c.collectionId === id);
                if (coll) {
                    // Clear param cache when switching collections
                    this._loadedParamKeys = null;
                    this._loadingParams = false;
                    const cachedAnalytics = this._analyticsCache.get(coll.collectionId) || null;
                    const exportForm = (this.state.selectedCollection && this.state.selectedCollection.collectionId === coll.collectionId)
                        ? (this.state.exportForm || this._buildExportFormDefaults(coll))
                        : this._buildExportFormDefaults(coll);
                    this.setState({ 
                        view: 'detail', 
                        selectedCollection: coll,
                        detailTab: 'overview',
                        analyticsData: cachedAnalytics,
                        analyticsError: null,
                        analyticsLoading: false,
                        analyticsCollectionId: cachedAnalytics ? coll.collectionId : null,
                        exportForm
                    });
                    this.ensureCullStats(coll.collectionId);
                }
                }
        });
        }

        const help = this.modalElement.querySelector('.help-btn');
        if (help) help.onclick = () => window.open('/docs/collection-cook-help', '_blank');
    }

    handleKeyDown(e) {
        // Don't close modal if text overlay is open
        const textOverlay = document.getElementById('text-overlay');
        if (textOverlay && textOverlay.style.display !== 'none') {
            return; // Let textOverlay handle Escape
        }
        if (e.key === 'Escape') this.hide();
    }

    // --- API stub actions ----------------------------------------------
    // Utility to get CSRF token (simple cache)
    async getCsrfToken() {
        if (this._csrfToken) return this._csrfToken;
        try {
            const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
            const data = await res.json();
            this._csrfToken = data.csrfToken;
            return this._csrfToken;
        } catch (err) {
            console.warn('[CookMenuModal] failed to fetch csrf', err);
            return '';
        }
    }

    _resolveCollectionGenerator(collection) {
        if (!collection) return { toolId: null, spellId: null };
        const config = collection.config || {};
        const normalizedType = (collection.generatorType || '').toLowerCase();
        if (normalizedType === 'tool') {
            return { toolId: collection.toolId || config.toolId || null, spellId: null };
        }
        if (normalizedType === 'spell') {
            return { toolId: null, spellId: collection.spellId || config.spellId || null };
        }
        if (collection.toolId || config.toolId) {
            return { toolId: collection.toolId || config.toolId, spellId: null };
        }
        if (collection.spellId || config.spellId) {
            return { toolId: null, spellId: collection.spellId || config.spellId };
        }
        return { toolId: null, spellId: null };
    }

    // ✅ MODIFIED: Show batch size prompt instead of direct start
    async _startCookFromDetail() {
        let coll = this.state.selectedCollection;
        if (!coll) return;
        try {
            if (this.state.overviewDirty) {
                const shouldSave = confirm('You have unsaved changes. These changes will not be included in the cook. Save changes first?');
                if (shouldSave) {
                    await this.saveOverviewChanges();
                    await this.fetchCollections(true);
                    const updated = this.state.collections.find(c => c.collectionId === coll.collectionId);
                    if (updated) {
                        coll = updated;
                        this.setState({ selectedCollection: updated });
                    }
                }
            }

            const { toolId, spellId } = this._resolveCollectionGenerator(coll);
            if (!toolId && !spellId) {
                alert('Please select a generator (tool or spell) before starting.');
                return;
            }

            // ✅ NEW: Show batch size prompt instead of using totalSupply
            this.showBatchSizePrompt(coll.collectionId);
        } catch (err) {
            alert('Failed to start cook: ' + (err.message || 'error'));
        }
    }

    // ✅ NEW: Show batch size prompt modal before starting cook
    showBatchSizePrompt(collectionId) {
        if (!collectionId) return;

        // Create inline modal for batch size input
        const overlay = document.createElement('div');
        overlay.className = 'batch-size-overlay';
        overlay.innerHTML = `
            <div class="batch-size-modal">
                <h3>Start Cook</h3>
                <p>How many pieces to generate?</p>
                <input type="number" class="batch-size-input" min="1" max="1000" value="10" autofocus>
                <div class="batch-size-actions">
                    <button class="batch-cook-btn">Cook</button>
                    <button class="batch-cancel-btn">Cancel</button>
                </div>
            </div>
        `;

        const input = overlay.querySelector('.batch-size-input');
        const cookBtn = overlay.querySelector('.batch-cook-btn');
        const cancelBtn = overlay.querySelector('.batch-cancel-btn');

        const cleanup = () => {
            overlay.remove();
        };

        const handleCook = async () => {
            const batchSize = parseInt(input.value, 10);
            if (!Number.isFinite(batchSize) || batchSize <= 0) {
                alert('Please enter a valid number greater than 0.');
                return;
            }
            cleanup();
            await this._executeBatchCook(collectionId, batchSize);
        };

        cookBtn.onclick = handleCook;
        cancelBtn.onclick = cleanup;
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };
        input.onkeydown = (e) => {
            if (e.key === 'Enter') handleCook();
            if (e.key === 'Escape') cleanup();
        };

        document.body.appendChild(overlay);
        input.focus();
        input.select();
    }

    // Execute batch cook with explicit batchSize
    async _executeBatchCook(collectionId, batchSize) {
        if (!collectionId || !batchSize) return;
        try {
            this.setState({ loading: true });
            let coll = this.state.collections.find(c => c.collectionId === collectionId);
            if (!coll) {
                const res = await fetch(`/api/v1/collections/${encodeURIComponent(collectionId)}`, { credentials: 'include', cache: 'no-store' });
                if (!res.ok) throw new Error('Collection not found');
                coll = await res.json();
            }

            const { toolId, spellId } = this._resolveCollectionGenerator(coll);
            if (!toolId && !spellId) {
                throw new Error('Please select a generator (tool or spell) before starting.');
            }

            const traitTree = coll.config?.traitTree || [];
            const paramOverrides = coll.config?.paramOverrides || {};
            const data = await this._startCookRequest({
                collectionId,
                toolId,
                spellId,
                traitTree,
                paramOverrides,
                batchSize // ✅ NEW: Pass batchSize instead of totalSupply
            });
            alert(`Cook started: generating ${batchSize} piece${batchSize === 1 ? '' : 's'}`);
            await this.fetchActiveCooks(true);
        } catch (err) {
            alert('Failed to start cook: ' + (err.message || 'error'));
        } finally {
            this.setState({ loading: false });
        }
    }

    // ✅ MODIFIED: Show batch size prompt instead of direct start
    async startCookFromList(id) {
        if (!id) return;
        // Validate collection has generator before showing prompt
        try {
            let coll = this.state.collections.find(c => c.collectionId === id);
            if (!coll) {
                const res = await fetch(`/api/v1/collections/${encodeURIComponent(id)}`, { credentials: 'include', cache: 'no-store' });
                if (!res.ok) throw new Error('Collection not found');
                coll = await res.json();
            }

            const { toolId, spellId } = this._resolveCollectionGenerator(coll);
            if (!toolId && !spellId) {
                alert('Please select a generator (tool or spell) in collection settings before starting.');
                return;
            }

            // Show batch size prompt
            this.showBatchSizePrompt(id);
        } catch (err) {
            alert('Failed to start cook: ' + (err.message || 'error'));
        }
    }

    // ✅ MODIFIED: Accept batchSize instead of totalSupply
    async _startCookRequest({ collectionId, toolId, spellId, traitTree = [], paramOverrides = {}, batchSize }) {
        const normalizedBatchSize = Number(batchSize);
        if (!Number.isFinite(normalizedBatchSize) || normalizedBatchSize <= 0) {
            throw new Error('Please enter a valid batch size (>0).');
        }
        const payload = {
            traitTree: Array.isArray(traitTree) ? traitTree : [],
            paramOverrides: (paramOverrides && typeof paramOverrides === 'object') ? paramOverrides : {},
            batchSize: normalizedBatchSize // ✅ NEW: Send batchSize instead of totalSupply
        };
        if (toolId) {
            payload.toolId = toolId;
        } else if (spellId) {
            payload.spellId = spellId;
        } else {
            throw new Error('Please select a generator (tool or spell) before starting.');
        }
        const csrf = await this.getCsrfToken();
        const res = await fetch(`/api/v1/collections/${encodeURIComponent(collectionId)}/cook/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-csrf-token': csrf
            },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (data?.error === 'generator-not-found') {
                throw new Error('The selected generator could not be found. Please choose another tool or spell.');
            }
            if (data?.error === 'spellId-or-toolId-required') {
                throw new Error('Please select a generator (tool or spell) before starting.');
            }
            throw new Error(data?.error || 'start failed');
        }
        return data;
    }

    async pauseCook(id) {
        if (!id) return;
        try {
            this.setState({ loading: true });
            const csrf = await this.getCsrfToken();
            const cook = this.state.activeCooks.find(c => c.collectionId === id);
            if (!cook) throw new Error('Cook not found');
            
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(id)}/cook/pause`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrf 
                },
                credentials: 'include',
                body: JSON.stringify({
                    toolId: cook.toolId,
                    spellId: cook.spellId,
                    traitTree: cook.config?.traitTree || [],
                    paramOverrides: cook.config?.paramOverrides || {},
                    totalSupply: cook.targetSupply
                })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'pause failed');
            }
            await this.fetchActiveCooks(true);
        } catch (err) {
            alert('Failed to pause cook: ' + (err.message || 'error'));
        } finally {
            this.setState({ loading: false });
        }
    }

    async resumeCook(id) {
        if (!id) return;
        try {
            this.setState({ loading: true });
            const csrf = await this.getCsrfToken();
            const cook = this.state.activeCooks.find(c => c.collectionId === id);
            if (!cook) throw new Error('Cook not found');
            
            // Get collection details to retrieve toolId/spellId/config
            const collection = this.state.collections.find(c => c.collectionId === id);
            if (!collection) {
                // Try to fetch collection if not in state
                const collRes = await fetch(`/api/v1/collections/${encodeURIComponent(id)}`, { credentials: 'include', cache: 'no-store' });
                if (!collRes.ok) throw new Error('Collection not found');
                const collData = await collRes.json();
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(id)}/cook/resume`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrf 
                },
                credentials: 'include',
                body: JSON.stringify({
                        toolId: collData.toolId || collData.config?.toolId,
                        spellId: collData.spellId || collData.config?.spellId,
                        traitTree: collData.config?.traitTree || [],
                        paramOverrides: collData.config?.paramOverrides || {},
                        totalSupply: cook.targetSupply || collData.totalSupply || collData.config?.totalSupply
                    })
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || 'resume failed');
                }
                await this.fetchActiveCooks(true);
                return;
            }
            
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(id)}/cook/resume`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrf 
                },
                credentials: 'include',
                body: JSON.stringify({
                    toolId: collection.toolId || collection.config?.toolId,
                    spellId: collection.spellId || collection.config?.spellId,
                    traitTree: collection.config?.traitTree || [],
                    paramOverrides: collection.config?.paramOverrides || {},
                    totalSupply: cook.targetSupply || collection.totalSupply || collection.config?.totalSupply
                })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'resume failed');
            }
            await this.fetchActiveCooks(true);
        } catch (err) {
            alert('Failed to resume cook: ' + (err.message || 'error'));
        } finally {
            this.setState({ loading: false });
        }
    }

    async stopCook(id) {
        if (!id) return;
        if (!window.confirm('Stop this cook? In-flight pieces will finish, but no new pieces will be queued.')) {
            return;
        }
        try {
            this.setState({ loading: true });
            const csrf = await this.getCsrfToken();
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(id)}/cook/stop`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrf
                },
                credentials: 'include',
                body: JSON.stringify({ reason: 'manual' })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'stop failed');
            }
            await this.fetchActiveCooks(true);
        } catch (err) {
            alert('Failed to stop cook: ' + (err.message || 'error'));
        } finally {
            this.setState({ loading: false });
        }
    }

    async deleteCook(id) {
        if (!id) return;
        if (!confirm('Delete this collection and all generated pieces?')) return;
        try {
            const csrf = await this.getCsrfToken();
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { 'x-csrf-token': csrf },
                credentials: 'include',
            });
            if (!res.ok) throw new Error('delete failed');
            await Promise.all([this.fetchActiveCooks(true), this.fetchCollections(true)]);
        } catch (err) {
            alert('Failed to delete collection');
        }
    }

    async resetCollectionReviews(collectionId) {
        if (!collectionId) return;
        const confirmed = window.confirm('Reset all review decisions for this collection? This will mark every piece as unreviewed.');
        if (!confirmed) return;
        try {
            this.setState({ loading: true, error: null });
            const csrf = await this.getCsrfToken();
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(collectionId)}/review/reset`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrf
                },
                credentials: 'include',
                body: JSON.stringify({})
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'reset failed');
            }
            const resetCount = typeof data.resetCount === 'number' ? data.resetCount : null;
            if (this._analyticsCache) {
                this._analyticsCache.delete(collectionId);
            }
            await Promise.all([
                this.fetchActiveCooks(true),
                this.fetchCollections(true)
            ]);
            if (this.state.detailTab === 'analytics') {
                this.loadCollectionAnalytics(collectionId);
            }
            if (resetCount !== null) {
                alert(`Review reset complete. ${resetCount} piece${resetCount === 1 ? '' : 's'} are pending review again.`);
            } else {
                alert('Review reset complete. Pieces will reappear in the review queue shortly.');
            }
        } catch (err) {
            console.error('[CookMenuModal] reset reviews error:', err);
            alert('Failed to reset review data: ' + (err.message || 'unexpected error'));
        } finally {
            this.setState({ loading: false });
        }
    }

    async resetCullDecisions(collectionId) {
        if (!collectionId) return;
        const confirmed = window.confirm('Clear all keep/exclude decisions from the culling pass? All approved pieces will re-enter the cull queue.');
        if (!confirmed) return;
        try {
            this.setState({ loading: true, error: null });
            const csrf = await this.getCsrfToken();
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(collectionId)}/cull/reset`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrf
                },
                credentials: 'include',
                body: JSON.stringify({})
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'reset failed');
            }
            const resetCount = typeof data.resetCount === 'number' ? data.resetCount : null;
            const nextCullStats = { ...(this.state.cullStats || {}) };
            delete nextCullStats[collectionId];
            this.setState({ cullStats: nextCullStats });
            this.loadCullStats(collectionId, { force: true });
            if (resetCount !== null) {
                alert(`Cull decisions reset. ${resetCount} piece${resetCount === 1 ? '' : 's'} now need a keep/drop decision.`);
            } else {
                alert('Cull decisions reset. Pieces will reappear in the cull queue shortly.');
            }
        } catch (err) {
            console.error('[CookMenuModal] reset cull error:', err);
            alert('Failed to reset cull decisions: ' + (err.message || 'unexpected error'));
        } finally {
            this.setState({ loading: false });
        }
    }

    async requeueCullKeeps(collectionId) {
        if (!collectionId) return;
        const confirmed = window.confirm('Start another cull round? Previously kept pieces will be re-added to the queue so you can drop more until you reach your target supply.');
        if (!confirmed) return;
        try {
            this.setState({ loading: true, error: null });
            const csrf = await this.getCsrfToken();
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(collectionId)}/cull/requeue`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrf
                },
                credentials: 'include',
                body: JSON.stringify({})
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'requeue_failed');
            }
            const requeued = typeof data.requeued === 'number' ? data.requeued : null;
            this.loadCullStats(collectionId, { force: true });
            if (typeof window !== 'undefined') {
                try {
                    window.dispatchEvent(new CustomEvent('collection:cull-updated', {
                        detail: { collectionId }
                    }));
                } catch (_) {
                    // ignore
                }
            }
            if (requeued && requeued > 0) {
                alert(`Added ${requeued} kept piece${requeued === 1 ? '' : 's'} back to the cull queue. Open the cull window to continue trimming.`);
            } else {
                alert('No previously kept pieces were found to requeue. Try resetting the cull decisions if you need to start from scratch.');
            }
        } catch (err) {
            console.error('[CookMenuModal] requeue cull error:', err);
            alert('Failed to requeue kept pieces: ' + (err.message || 'unexpected error'));
        } finally {
            this.setState({ loading: false });
        }
    }

    async createCollection() {
        // Switch to create form view
        this.setState({ view: 'create' });
    }

    async submitCreateCollection({ name, description }) {
        try {
            const csrf = await this.getCsrfToken();
            const res = await fetch('/api/v1/collections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
                body: JSON.stringify({ name, description }),
                credentials: 'include',
            });
            if (!res.ok) throw new Error('create failed');
            const data = await res.json();
            const newId = data.collection?.collectionId || data.collectionId || data._id;
            await this.fetchCollections(true);
            // Optional: directly open detail view (placeholder)
            if (newId) {
                alert('Collection created! Opening detail view…');
                // TODO: implement detail view navigation
            }
            this.setState({ view: 'home' });
        } catch (err) {
            console.warn(err);
            alert('Failed to create collection');
        }
    }

    async fetchTools(){
        if(this._loadingTools || this._toolsFetched) return;
        this._loadingTools=true;
        try{
            const res=await fetch('/api/v1/tools/registry', { credentials:'include', cache:'no-store' });
            if(!res.ok) throw new Error('tools fetch failed');
            const data=await res.json();
            if(Array.isArray(data)) this.setState({toolOptions:data});
            this._toolsFetched=true;
        }catch(e){console.warn('tool fetch fail',e);}
        finally{ this._loadingTools=false; }
    }

    async fetchSpells(){
        if(this._loadingSpells || this._spellsFetched) return;
        this._loadingSpells=true;
        try{
            const res=await fetch('/api/v1/spells/registry', { credentials:'include', cache:'no-store' });
            if(!res.ok) throw new Error('spells fetch failed');
            const data=await res.json();
            if(Array.isArray(data)) this.setState({spellOptions:data});
            this._spellsFetched=true;
        }catch(e){console.warn('spell fetch fail',e);} 
        finally{ this._loadingSpells=false; }
    }

    async saveGenerator(){
        const { generatorType, selectedToolId, selectedSpellId }=this.state;
        let payload={};
        if(generatorType==='tool'&&selectedToolId){payload={ generatorType:'tool', toolId:selectedToolId };}
        if(generatorType==='spell'&&selectedSpellId){payload={ generatorType:'spell', spellId:selectedSpellId };}
        if(!Object.keys(payload).length) return;
        try{
            const csrf=await this.getCsrfToken();
            const id=this.state.selectedCollection.collectionId;
            const res=await fetch(`/api/v1/collections/${encodeURIComponent(id)}`,{method:'PUT',headers:{'Content-Type':'application/json','x-csrf-token':csrf},credentials:'include',body:JSON.stringify(payload)});
            if(res.ok){
                const updated=await res.json();
                this.setState({selectedCollection:updated});
                await this.loadParamOptions();
            }
        }catch(err){alert('Failed to save generator');}
    }

    async loadParamOptions(){
        const { selectedCollection }=this.state;
        if(!selectedCollection) return Promise.resolve();
        
        // Check if we already have params for this collection
        const collectionKey = `${selectedCollection.collectionId}-${selectedCollection.toolId || selectedCollection.spellId || 'none'}`;
        if(this._loadedParamKeys && this._loadedParamKeys.has(collectionKey)){
            // Already loaded for this collection, skip
            return Promise.resolve();
        }
        
        if(selectedCollection.generatorType==='tool' && selectedCollection.toolId){
            try{
                const res=await fetch(`/api/v1/tools/registry/${encodeURIComponent(selectedCollection.toolId)}`, { cache:'no-store' });
                if(res.ok){
                    const def=await res.json();
                    let params;
                    if(def.inputSchema && Object.keys(def.inputSchema).length){
                       params = Object.keys(def.inputSchema);
                    } else if(Array.isArray(def.exposedInputs) && def.exposedInputs.length){
                       params = def.exposedInputs.map(e=>e.paramKey);
                    } else { params=['prompt']; }
                    this.setState({
                        paramOptions:params,
                        generatorDisplay:def.displayName||def.toolId,
                        paramOverrides: selectedCollection.config?.paramOverrides || {}
                    });
                    if(!this._loadedParamKeys) this._loadedParamKeys = new Set();
                    this._loadedParamKeys.add(collectionKey);
                    return;
                }
            }catch(e){
                console.warn('param fetch fail',e);
                // On error, set defaults
                this.setState({
                    paramOptions:['prompt'],
                    paramOverrides: selectedCollection.config?.paramOverrides || {}
                });
                return;
            }
        }
        if(selectedCollection.generatorType==='spell' && selectedCollection.spellId){
            try{
                const res=await fetch(`/api/v1/spells/registry/${encodeURIComponent(selectedCollection.spellId)}`, { cache:'no-store' });
                if(res.ok){
                    const def=await res.json();
                    let params;
                    if(def.inputSchema && Object.keys(def.inputSchema).length){
                       params = Object.keys(def.inputSchema);
                    } else if(Array.isArray(def.exposedInputs) && def.exposedInputs.length){
                       params = def.exposedInputs.map(e=>e.paramKey);
                    } else { params=['prompt']; }
                    this.setState({
                        paramOptions:params,
                        generatorDisplay:def.displayName||def.spellId,
                        paramOverrides: selectedCollection.config?.paramOverrides || {}
                    });
                    if(!this._loadedParamKeys) this._loadedParamKeys = new Set();
                    this._loadedParamKeys.add(collectionKey);
                    return;
                }
            }catch(e){
                console.warn('param fetch fail',e);
                // On error, set defaults
                this.setState({
                    paramOptions:['prompt'],
                    paramOverrides: selectedCollection.config?.paramOverrides || {}
                });
                return;
            }
        }
        this.setState({
            paramOptions:['prompt'],
            paramOverrides: selectedCollection.config?.paramOverrides || {}
        });
        if(!this._loadedParamKeys) this._loadedParamKeys = new Set();
        this._loadedParamKeys.add(collectionKey);
    }

    async loadCollectionAnalytics(collectionId) {
        if (!collectionId) return;
        if (this.state.analyticsLoading && this.state.analyticsCollectionId === collectionId) {
            return;
        }
        this.setState({
            analyticsLoading: true,
            analyticsError: null,
            analyticsCollectionId: collectionId
        });
        try {
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(collectionId)}/analytics`, { credentials: 'include', cache: 'no-store' });
            if (res.status === 304) {
                const cached = this._analyticsCache.get(collectionId) || null;
                this.setState({
                    analyticsLoading: false,
                    analyticsData: cached || this.state.analyticsData,
                    analyticsError: cached ? null : this.state.analyticsError
                });
                return;
            }
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || 'Failed to load analytics');
            }
            const data = await res.json();
            this._analyticsCache.set(collectionId, data);
            this.setState({
                analyticsData: data,
                analyticsError: null,
                analyticsLoading: false
            });
        } catch (err) {
            console.error('[CookMenuModal] analytics load error:', err);
            this.setState({
                analyticsError: err.message || 'Failed to load analytics',
                analyticsLoading: false
            });
        }
    }

    _ensureAnalyticsData(collectionId) {
        if (!collectionId) return;
        const cached = this._analyticsCache.get(collectionId);
        if (cached && this.state.analyticsCollectionId !== collectionId) {
            this.setState({
                analyticsData: cached,
                analyticsError: null,
                analyticsLoading: false,
                analyticsCollectionId: collectionId
            });
            return;
        }
        if (!cached) {
            this.loadCollectionAnalytics(collectionId);
        }
    }

    _buildExportFormDefaults(collection) {
        if (!collection) {
            return {
                nameTemplate: 'Collection Piece #{{number}}',
                description: '',
                shuffleOrder: false
            };
        }
        const lockedMeta = collection.publishedGallery?.metadataOptions || null;
        return {
            nameTemplate: lockedMeta?.nameTemplate || `${collection.name || 'Collection Piece'} #{{number}}`,
            description: lockedMeta?.description !== undefined ? lockedMeta.description : (collection.description || ''),
            shuffleOrder: lockedMeta?.shuffleOrder ?? false,
            collectionId: collection.collectionId
        };
    }

    _escapeHtml(input) {
        if (input === null || input === undefined) return '';
        return String(input)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    _handleCullUpdate(event) {
        const collectionId = event?.detail?.collectionId;
        if (!collectionId) return;
        const selectedId = this.state.selectedCollection?.collectionId;
        const shouldRefreshSelected = selectedId === collectionId;
        this.loadCullStats(collectionId, { force: true });
        if (shouldRefreshSelected) {
            this.fetchCollections(true);
            if (this.state.detailTab === 'analytics') {
                this.loadCollectionAnalytics(collectionId);
            }
        }
    }

    ensureCullStats(collectionId) {
        if (!collectionId) return;
        if (this.state.cullStats?.[collectionId]) return;
        if (this._cullStatsLoading?.has(collectionId)) return;
        this.loadCullStats(collectionId);
    }

    async loadCullStats(collectionId, { force = false } = {}) {
        if (!collectionId) return null;
        if (!force && this.state.cullStats?.[collectionId]) {
            return this.state.cullStats[collectionId];
        }
        if (!this._cullStatsLoading) this._cullStatsLoading = new Map();
        if (this._cullStatsLoading.has(collectionId)) {
            return this._cullStatsLoading.get(collectionId);
        }
        const fetchPromise = (async () => {
            try {
                const res = await fetch(`/api/v1/collections/${encodeURIComponent(collectionId)}/cull/stats`, {
                    credentials: 'include',
                    cache: 'no-store'
                });
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const data = await res.json().catch(() => ({}));
                const stats = data?.stats || data || null;
                if (stats) {
                    const next = { ...(this.state.cullStats || {}), [collectionId]: stats };
                    this.setState({ cullStats: next }, { skipRender: false });
                }
                return stats;
            } catch (err) {
                console.warn('[CookMenuModal] cull stats load error', err);
                return null;
            } finally {
                this._cullStatsLoading.delete(collectionId);
            }
        })();
        this._cullStatsLoading.set(collectionId, fetchPromise);
        return fetchPromise;
    }

    _formatCullSummary(stats, supply) {
        if (!stats) return 'Loading…';
        const totalAccepted = Number(stats.totalAccepted || 0);
        if (!Number.isFinite(totalAccepted) || totalAccepted <= 0) {
            return 'No approved pieces yet';
        }
        const kept = Number(stats.keptCount || 0);
        const culled = Number(stats.culledCount || 0);
        const pending = Number(stats.pendingCullCount || 0);
        const target = Number(supply || 0);
        const aboveTarget = target > 0 ? Math.max(0, kept - target) : 0;
        const parts = [`Kept ${kept}/${totalAccepted}`];
        if (pending > 0) parts.push(`${pending} pending`);
        if (culled > 0) parts.push(`${culled} excluded`);
        if (aboveTarget > 0) parts.push(`${aboveTarget} over target`);
        return parts.join(' • ');
    }

    attachOverviewEvents(){
        const modal=this.modalElement;
        
        // Description edit - use text overlay for better UX
        if(modal.querySelector('.edit-desc-btn')) modal.querySelector('.edit-desc-btn').onclick=()=>{
            const current = this.state.pendingDescription !== null 
                ? this.state.pendingDescription 
                : (this.state.selectedCollection.description||'');
            showTextOverlay(current, (newValue) => {
                this.setState({
                    pendingDescription: newValue,
                    overviewDirty: true
                });
            });
        };
        
        // Supply edit - use prompt (number input)
        if(modal.querySelector('.edit-supply-btn')) modal.querySelector('.edit-supply-btn').onclick=()=>{
            const current = this.state.pendingSupply !== null 
                ? this.state.pendingSupply 
                : (this.state.selectedCollection.totalSupply||'');
            const val=prompt('Total supply',current);
            if(val!==null){
                const numVal = val.trim() === '' ? null : Number(val);
                this.setState({
                    pendingSupply: numVal,
                    overviewDirty: true
                });
            }
        };
        
        if(modal.querySelector('.edit-gen-btn')) modal.querySelector('.edit-gen-btn').onclick=()=>{
            this.setState({showGenPicker:true});
            if(!this.state.toolOptions.length){this.fetchTools();}
        };
        if(modal.querySelector('#gen-select')){
            modal.querySelector('#gen-select').onchange=(e)=>{
                const val=e.target.value;
                if(this.state.generatorType==='tool'){
                    this.setState({ selectedToolId: val });
                } else {
                    this.setState({ selectedSpellId: val });
                }
            };
        }
        // radio change
        modal.querySelectorAll('input[name="gen-type"]').forEach(r=>{r.onchange=(e)=>{this.state.generatorType=e.target.value;this.render();};});
        if(modal.querySelector('.save-generator-btn')) modal.querySelector('.save-generator-btn').onclick=()=>{
            let id=this.state.generatorType==='tool'?this.state.selectedToolId:this.state.selectedSpellId;
            if(!id){ // fallback read from select directly
                const selEl = modal.querySelector('#gen-select');
                if(selEl) id = selEl.value;
            }
            if(!id){alert('Choose an option');return;}
            const disp=(this.state.generatorType==='tool'?this.state.toolOptions.find(t=>t.toolId===id):this.state.spellOptions.find(s=>s.spellId===id))?.displayName||id;
            this.saveGeneratorSelection(id,disp).then(()=>{this.setState({showGenPicker:false});});
        };
        if(modal.querySelector('.cancel-generator-btn')) modal.querySelector('.cancel-generator-btn').onclick=()=>{
            this.setState({showGenPicker:false});
        };
        
        // Parameter edit - use text overlay for prompt/text inputs
        modal.querySelectorAll('.edit-param-btn').forEach(btn=>{
            btn.onclick=()=>{
                const param=btn.closest('tr').getAttribute('data-param');
                // Check if this is a prompt/text input
                const isTextInput = /(prompt|text|instruction|input_prompt)/i.test(param);
                
                // Get current value (check pending first, then saved, then empty)
                const current = this.state.pendingParamOverrides[param] !== undefined
                    ? this.state.pendingParamOverrides[param]
                    : (this.state.paramOverrides[param] || '');
                
                if (isTextInput) {
                    // Use text overlay for prompt/text inputs
                    showTextOverlay(current, (newValue) => {
                        const newOverrides = {
                            ...this.state.pendingParamOverrides,
                            [param]: newValue
                        };
                        this.setState({
                            pendingParamOverrides: newOverrides,
                            overviewDirty: true
                        });
                    });
                } else {
                    // Use prompt for other inputs
                const val=prompt(`Set value for ${param}`,current);
                if(val!==null){
                        const newOverrides = {
                            ...this.state.pendingParamOverrides,
                            [param]: val
                        };
                        this.setState({
                            pendingParamOverrides: newOverrides,
                            overviewDirty: true
                        });
                    }
                }
            };
        });

        if (this._paramDetailsEl && this._paramDetailsHandler) {
            this._paramDetailsEl.removeEventListener('toggle', this._paramDetailsHandler);
        }
        const paramDetails = modal.querySelector('.param-details');
        if (paramDetails) {
            this._paramDetailsEl = paramDetails;
            this._paramDetailsHandler = () => {
                this.state.paramPanelOpen = paramDetails.open;
            };
            paramDetails.addEventListener('toggle', this._paramDetailsHandler);
        }
        
        // Save overview changes button
        if(modal.querySelector('.save-overview-btn')) modal.querySelector('.save-overview-btn').onclick=async()=>{
            await this.saveOverviewChanges();
        };
        if(modal.querySelector('.test-btn')) modal.querySelector('.test-btn').onclick=()=>{
            this.hide();
            import('../window/CollectionWindow.js').then(m=>{m.createCollectionTestWindow(this.state.selectedCollection);} );
        };
        if(modal.querySelector('.review-btn')) modal.querySelector('.review-btn').onclick=()=>{
            this.hide();
            import('../window/CollectionWindow.js').then(m=>{m.createCollectionReviewWindow(this.state.selectedCollection);} );
        };
        if(modal.querySelector('.reset-review-btn')) modal.querySelector('.reset-review-btn').onclick=()=>{
            const { selectedCollection } = this.state;
            if(!selectedCollection) return;
            this.resetCollectionReviews(selectedCollection.collectionId);
        };
        if(modal.querySelector('.cull-btn')) modal.querySelector('.cull-btn').onclick=()=>{
            const { selectedCollection } = this.state;
            if(!selectedCollection) return;
            this.hide();
            import('../window/CollectionWindow.js').then(m=>{m.createCollectionCullWindow(selectedCollection);} );
        };
        if(modal.querySelector('.repeat-cull-btn')) modal.querySelector('.repeat-cull-btn').onclick=()=>{
            const { selectedCollection } = this.state;
            if(!selectedCollection) return;
            this.requeueCullKeeps(selectedCollection.collectionId);
        };
        if(modal.querySelector('.revive-cull-btn')) modal.querySelector('.revive-cull-btn').onclick=()=>{
            const { selectedCollection } = this.state;
            if(!selectedCollection) return;
            this.hide();
            import('../window/CollectionWindow.js').then(m => { m.createCollectionReviveWindow(selectedCollection); });
        };
        if(modal.querySelector('.reset-cull-btn')) modal.querySelector('.reset-cull-btn').onclick=()=>{
            const { selectedCollection } = this.state;
            if(!selectedCollection) return;
            this.resetCullDecisions(selectedCollection.collectionId);
        };
        if(modal.querySelector('.start-cook-btn')) modal.querySelector('.start-cook-btn').onclick=()=>{ this._startCookFromDetail(); };
        if(modal.querySelector('.delete-collection-btn')) modal.querySelector('.delete-collection-btn').onclick=()=>{
            const { selectedCollection } = this.state;
            if(!selectedCollection) return;
            this.deleteCook(selectedCollection.collectionId);
            this.setState({ view:'home', selectedCollection:null });
        };

        // ✅ NEW: Archive button handler
        if(modal.querySelector('.archive-btn')) modal.querySelector('.archive-btn').onclick=()=>{
            this._archiveCollection();
        };
        if(modal.querySelector('.unarchive-btn')) modal.querySelector('.unarchive-btn').onclick=()=>{
            this._unarchiveCollection();
        };

        // ✅ NEW: Finalize button handler
        if(modal.querySelector('.finalize-btn')) modal.querySelector('.finalize-btn').onclick=()=>{
            this._finalizeCollection();
        };
    }

    async updateCollection(fields){
        const csrf=await this.getCsrfToken();
        const id=this.state.selectedCollection.collectionId;
        const res=await fetch(`/api/v1/collections/${encodeURIComponent(id)}`,{method:'PUT',headers:{'Content-Type':'application/json','x-csrf-token':csrf},credentials:'include',body:JSON.stringify(fields)});
        if(res.ok){
            const updated=await res.json();
            this.setState({
                selectedCollection:updated,
                paramOverrides:updated.config?.paramOverrides||{},
                overviewDirty: false,
                pendingDescription: null,
                pendingSupply: null,
                pendingParamOverrides: {}
            });
            // Also refresh collections list to reflect changes in home view
            await this.fetchCollections(true);
        }
    }

    // ✅ NEW: Archive collection - soft hide from Workspace
    async _archiveCollection() {
        const { selectedCollection } = this.state;
        if (!selectedCollection) return;
        try {
            this.setState({ loading: true });
            await this.updateCollection({ archived: true });
            alert('Collection archived. It will no longer appear in Workspace but remains in My Collections.');
        } catch (err) {
            alert('Failed to archive collection: ' + (err.message || 'error'));
        } finally {
            this.setState({ loading: false });
            this.render();
        }
    }

    // ✅ NEW: Unarchive collection - restore to Workspace
    async _unarchiveCollection() {
        const { selectedCollection } = this.state;
        if (!selectedCollection) return;
        try {
            this.setState({ loading: true });
            await this.updateCollection({ archived: false });
            alert('Collection restored to Workspace.');
        } catch (err) {
            alert('Failed to unarchive collection: ' + (err.message || 'error'));
        } finally {
            this.setState({ loading: false });
            this.render();
        }
    }

    // ✅ NEW: Finalize collection - permanent completion
    async _finalizeCollection() {
        const { selectedCollection } = this.state;
        if (!selectedCollection) return;
        if (selectedCollection.finalized) {
            alert('This collection is already finalized.');
            return;
        }

        // Require confirmation since this is permanent
        const confirmed = confirm(
            'Are you sure you want to finalize this collection?\n\n' +
            'This marks the collection as permanently complete and cannot be easily undone.\n\n' +
            'Finalized collections remain visible in My Collections but are removed from Workspace.'
        );
        if (!confirmed) return;

        try {
            this.setState({ loading: true });
            await this.updateCollection({
                finalized: true,
                finalizedAt: new Date().toISOString()
            });
            alert('Collection finalized successfully.');
        } catch (err) {
            alert('Failed to finalize collection: ' + (err.message || 'error'));
        } finally {
            this.setState({ loading: false });
            this.render();
        }
    }
    
    async saveOverviewChanges(){
        try {
            this.setState({ loading: true, error: null });
            const fields = {};
            
            // Add description if changed
            if (this.state.pendingDescription !== null) {
                fields.description = this.state.pendingDescription;
            }
            
            // Add supply if changed
            if (this.state.pendingSupply !== null) {
                fields.totalSupply = this.state.pendingSupply;
            }
            
            // Add param overrides if changed
            if (Object.keys(this.state.pendingParamOverrides).length > 0) {
                // Merge pending with existing overrides
                const mergedOverrides = {
                    ...this.state.paramOverrides,
                    ...this.state.pendingParamOverrides
                };
                // Use dot notation to update nested field without replacing entire config
                fields['config.paramOverrides'] = mergedOverrides;
            }
            
            if (Object.keys(fields).length === 0) {
                this.setState({ loading: false });
                return; // Nothing to save
            }
            
            await this.updateCollection(fields);
            this.setState({ 
                loading: false, 
                saveSuccess: true 
            });
            setTimeout(() => this.setState({ saveSuccess: false }), 2000);
        } catch (err) {
            console.error('[CookMenuModal] saveOverviewChanges error:', err);
            this.setState({
                loading: false,
                error: err.message || 'Failed to save changes. Please try again.'
            });
        }
    }

    openToolPicker(){
        if(!this.state.toolOptions.length){this.fetchTools().then(()=>this.openToolPicker());return;}
        const names=this.state.toolOptions.map(t=>`${t.displayName} (${t.toolId})`).join('\n');
        const chosen=prompt(`Enter toolId:\n${names}`,this.state.selectedToolId||'');
        const tool=this.state.toolOptions.find(t=>t.toolId===chosen);
        if(tool){this.saveGeneratorSelection(tool.toolId,tool.displayName);} }

    async saveGeneratorSelection(id, displayName){
        if(this.state.generatorType==='tool'){
            this.setState({ selectedToolId: id });
        } else {
            this.setState({ selectedSpellId: id });
        }
        this.setState({ generatorDisplay: displayName });
        await this.saveGenerator(); }
}

// Expose globally for quick testing
autoInitCookMenuModal();
function autoInitCookMenuModal(){
    if (typeof window !== 'undefined') {
        window.openCookMenu = () => {
            const modal = new CookMenuModal();
            modal.show();
        };
    }
} 
