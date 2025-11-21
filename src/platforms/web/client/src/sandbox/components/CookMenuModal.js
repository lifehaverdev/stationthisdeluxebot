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
            detailTab: 'overview', // 'overview' | 'traitTree'
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
        // ✅ WebSocket integration
        this.ws = typeof window !== 'undefined' ? (window.websocketClient || null) : null;
        this._wsCookHandler = null;
        this._wsProgressHandler = null;
        this._wsUpdateHandler = null;
    }

    setState(newState) {
        Object.assign(this.state, newState);
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

    async fetchActiveCooks() {
        try {
            const res = await fetch('/api/v1/cooks/active', { credentials: 'include' });
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
        }
    }

    async fetchCollections() {
        try {
            const res = await fetch('/api/v1/collections', { credentials: 'include' });
            if (!res.ok) throw new Error('failed');
            const data = await res.json();
            if (this.state.view === 'home') {
            this.setState({ collections: data.collections || [] });
            } else {
                Object.assign(this.state, { collections: data.collections || [] });
            }
        } catch (err) {
            console.warn('[CookMenuModal] collections fetch error', err);
            if (this.state.view === 'home') {
            this.setState({ collections: [] });
            } else {
                Object.assign(this.state, { collections: [] });
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
        // ✅ Unsubscribe from WebSocket events
        this._unsubscribeFromWebSocket();
        document.removeEventListener('keydown', this.handleKeyDown);
        document.body.removeChild(this.modalElement);
        this.modalElement = null;
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
        current.updatedAt = new Date().toISOString();
        if (!current.collectionName && (collectionMeta?.name || payload.collectionName)) {
            current.collectionName = collectionMeta?.name || payload.collectionName;
        }

        if (idx >= 0) {
            activeCooks[idx] = current;
        } else {
            activeCooks.push(current);
        }

        if (this.state.view === 'home') {
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

        if (this.state.view === 'home') {
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
            current.running = Math.max(0, (current.running || 1) - 1);
            if (current.running === 0 && current.generationCount >= (current.targetSupply || 0)) {
                current.status = 'paused';
            }
        }
        current.updatedAt = new Date().toISOString();
        activeCooks[idx] = current;

        if (this.state.view === 'home') {
            this.setState({ activeCooks });
        } else {
            Object.assign(this.state, { activeCooks });
        }
    }

    // --- Initial data ---------------------------------------------------
    async loadInitial() {
        this.setState({ loading: true, initialLoadComplete: false });
        await Promise.all([this.fetchActiveCooks(), this.fetchCollections()]);
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

    // Home view markup
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
        
        // ✅ Separate cooks into actively running, paused, and awaiting review
        const runningCooks = [];
        const pausedCooks = [];
        const awaitingReview = [];
        
        activeCooks.forEach(c => {
            const running = c.running || 0;
            const queued = c.queued || 0;
            const generationCount = c.generationCount || 0;
            const targetSupply = c.targetSupply || 0;
            const isComplete = targetSupply > 0 && generationCount >= targetSupply;
            const hasActiveJobs = running > 0 || queued > 0;
            
            if (isComplete && !hasActiveJobs) {
                // All pieces generated, awaiting review
                awaitingReview.push(c);
            } else if (running > 0) {
                // Actively running
                runningCooks.push(c);
            } else {
                // Paused/stopped but not complete
                pausedCooks.push(c);
            }
        });
        
        // Render actively running cooks with fire icon (using HTML entity to avoid encoding issues)
        const runningHtml = runningCooks.length ? runningCooks.map(c => `
            <div class="cook-status-item">
                <div class="cook-title">${c.collectionName || 'Untitled'} – ${c.generationCount}/${c.targetSupply}</div>
                <div class="cook-actions">
                    <span style="color: #ff6b6b; font-size: 18px; display: inline-block;" title="Cooking in progress">&#128293;</span>
                    <button data-action="pause" data-id="${c.collectionId}" title="Pause Cook" style="margin-left: 8px;">⏸</button>
                </div>
            </div>
        `).join('') : '';
        
        // Render paused cooks with ▶️ icon
        const pausedHtml = pausedCooks.length ? pausedCooks.map(c => `
            <div class="cook-status-item">
                <div class="cook-title">${c.collectionName || 'Untitled'} – ${c.generationCount}/${c.targetSupply}</div>
                <div class="cook-actions">
                    <button data-action="resume" data-id="${c.collectionId}" title="Resume Cook">▶️</button>
                </div>
            </div>
        `).join('') : '';
        
        // Render awaiting review section
        const reviewHtml = awaitingReview.length ? awaitingReview.map(c => `
            <div class="cook-status-item">
                <div class="cook-title">${c.collectionName || 'Untitled'} – ${c.generationCount}/${c.targetSupply}</div>
                <div class="cook-actions">
                    <button data-action="review" data-id="${c.collectionId}" title="Review Pieces" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">Review</button>
                </div>
            </div>
        `).join('') : '<div class="empty-message">No cooks awaiting review.</div>';

        const collHtml = collections.length ? collections.map(c => `
            <div class="collection-card" data-id="${c.collectionId}">${c.name || 'Untitled'}</div>
        `).join('') : '<div class="empty-message">No collections yet.</div>';

        return `
            ${runningCooks.length > 0 ? `<h2>Active Cooks</h2><div class="cook-status-list">${runningHtml}</div>` : ''}
            ${pausedCooks.length > 0 ? `<h2>Paused Cooks</h2><div class="cook-status-list">${pausedHtml}</div>` : ''}
            ${awaitingReview.length > 0 ? `<h2>Awaiting Review</h2><div class="cook-status-list">${reviewHtml}</div>` : ''}
            ${runningCooks.length === 0 && pausedCooks.length === 0 && awaitingReview.length === 0 ? '<h2>Active Cooks</h2><div class="empty-message">No active cooks.</div>' : ''}
            <hr>
            <h2>My Collections</h2>
            <div class="collection-grid">${collHtml}<div class="collection-card new" data-action="new">＋</div></div>
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
        const tabs = ['overview','traitTree'];
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
        const displayParamOverrides = Object.keys(pendingParamOverrides).length > 0 ? pendingParamOverrides : paramOverrides;
        
        // Escape HTML for safe display
        const escapeHtml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        const safeDescription = escapeHtml(displayDescription);
        const safeSupply = escapeHtml(String(displaySupply));
        
        const metaRows=`
          <tr><td>Description</td><td>${safeDescription}</td><td><button class="edit-desc-btn">Edit</button></td></tr>
          <tr><td>Total Supply*</td><td>${safeSupply}</td><td><button class="edit-supply-btn">Edit</button></td></tr>`;
        const genRow=`<tr><td>Generator</td><td>${this.state.generatorDisplay||'(none)'}</td><td><button class="edit-gen-btn">${this.state.generatorDisplay?'Change':'Set'}</button></td></tr>`;
        const paramRows=paramOptions.map(p=>{
            const value = displayParamOverrides[p]||'';
            // Truncate long values for display
            const displayValue = value.length > 50 ? value.substring(0, 47) + '...' : value;
            const safeValue = escapeHtml(value);
            const safeDisplay = escapeHtml(displayValue);
            return `<tr data-param="${p}"><td>${p}</td><td title="${safeValue}">${safeDisplay}</td><td><button class="edit-param-btn">Edit</button></td></tr>`;
        }).join('');
        
        const unsavedWarning = overviewDirty ? '<div class="unsaved-changes">You have unsaved changes</div>' : '';
        
        return `<table class="meta-table">${metaRows}${genRow}${paramRows}</table>
        ${unsavedWarning}
        <div style="margin-top:12px">
            ${overviewDirty ? '<button class="save-overview-btn" style="margin-right:8px;">Save Changes</button>' : ''}
            <button class="test-btn">Test</button>
            <button class="review-btn">Review</button>
            <button class="start-cook-btn">Start Cook</button>
            <button class="delete-collection-btn" style="float:right;color:#f55">Delete</button>
        </div>`;
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
                pendingParamOverrides: {}
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
                    this.setState({ view: 'detail', selectedCollection: coll });
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
            await this.fetchActiveCooks();
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
                const collRes = await fetch(`/api/v1/collections/${encodeURIComponent(id)}`, { credentials: 'include' });
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
                await this.fetchActiveCooks();
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
            await this.fetchActiveCooks();
        } catch (err) {
            alert('Failed to resume cook: ' + (err.message || 'error'));
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
            await Promise.all([this.fetchActiveCooks(), this.fetchCollections()]);
        } catch (err) {
            alert('Failed to delete collection');
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
            await this.fetchCollections();
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
            const res=await fetch('/api/v1/tools/registry', { credentials:'include' });
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
            const res=await fetch('/api/v1/spells/registry', { credentials:'include' });
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
                const res=await fetch(`/api/v1/tools/registry/${encodeURIComponent(selectedCollection.toolId)}`);
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
                const res=await fetch(`/api/v1/spells/registry/${encodeURIComponent(selectedCollection.spellId)}`);
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
        if(modal.querySelector('.start-cook-btn')) modal.querySelector('.start-cook-btn').onclick=async()=>{
            const coll=this.state.selectedCollection; if(!coll) return;
            if(!(coll.toolId||coll.spellId)){ alert('Please select a generator (tool or spell) before starting.'); return; }
            
            // Warn if there are unsaved changes
            if (this.state.overviewDirty) {
                if (!confirm('You have unsaved changes. These changes will not be included in the cook. Save changes first?')) {
                    // User chose not to save, but still allow starting cook with saved values
                } else {
                    // User wants to save first
                    await this.saveOverviewChanges();
                    // Refresh collection to get updated values
                    await this.fetchCollections();
                    const updated = this.state.collections.find(c => c.collectionId === coll.collectionId);
                    if (updated) {
                        this.setState({ selectedCollection: updated });
                        coll = updated;
                    }
                }
            }
            
            // Use pending supply if available, otherwise use saved
            const supply = this.state.pendingSupply !== null 
                ? this.state.pendingSupply 
                : (Number(coll.totalSupply)||0);
            if(supply<=0){ alert('Please set a valid Total Supply (>0).'); return; }
            
            // Use pending param overrides if available, otherwise use saved
            const paramOverrides = Object.keys(this.state.pendingParamOverrides).length > 0
                ? { ...this.state.paramOverrides, ...this.state.pendingParamOverrides }
                : (coll.config?.paramOverrides||this.state.paramOverrides||{});
            
            const id=coll.collectionId;
            try{
                this.setState({ loading:true });
                const csrf = await this.getCsrfToken();
                const payload={
                    toolId: coll.toolId,
                    spellId: coll.spellId,
                    traitTree: coll.config?.traitTree||[],
                    paramOverrides: paramOverrides,
                    totalSupply: supply
                };
                console.log('[CookMenuModal] startCook payload', payload);
                const res=await fetch(`/api/v1/collections/${encodeURIComponent(id)}/cook/start`,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':csrf},credentials:'include',body:JSON.stringify(payload)});
                const data = await res.json().catch(()=>({}));
                console.log('[CookMenuModal] startCook response', data);
                if(!res.ok){throw new Error(data.error||'start failed');}
                alert(`Cook started${typeof data.queued==='number'?` (queued ${data.queued})`:''}`);
                await this.fetchActiveCooks();
            }catch(e){alert('Failed to start cook: '+(e.message||'error'))}finally{this.setState({ loading:false });}
        };
        if(modal.querySelector('.delete-collection-btn')) modal.querySelector('.delete-collection-btn').onclick=()=>{
            const { selectedCollection } = this.state;
            if(!selectedCollection) return;
            this.deleteCook(selectedCollection.collectionId);
            this.setState({ view:'home', selectedCollection:null });
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
