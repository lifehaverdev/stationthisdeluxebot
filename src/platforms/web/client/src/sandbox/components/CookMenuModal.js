// src/platforms/web/client/src/sandbox/components/CookMenuModal.js
// Lightweight modal for managing Collection Cooks.
// Styling follows modsMenuModal.css convention (see cookMenuModal.css override).

import TraitTreeEditor from './TraitTreeEditor.js';

export default class CookMenuModal {
    constructor(options = {}) {
        this.state = {
            view: 'home', // 'home' | 'detail'
            // views: 'home' | 'create' | 'detail'
            loading: false,
            error: null,
            activeCooks: [],
            collections: [],
            selectedCollection: null,
            detailTab: 'overview', // 'overview' | 'traitTree' | 'edit'
            generatorType: null, // 'tool' | 'spell'
            toolOptions: [],
            selectedToolId: null,
        };
        this.modalElement = null;
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.pollInterval = null; // store polling timer id
    }

    setState(newState) {
        Object.assign(this.state, newState);
        if (this.modalElement) this.render();
    }

    // --- API helpers ----------------------------------------------------
    async fetchActiveCooks() {
        try {
            const res = await fetch('/api/v1/cooks/active', { credentials: 'include' });
            if (!res.ok) throw new Error('failed');
            const data = await res.json();
            // Only trigger re-render when we are on home view to avoid wiping inputs in other views
            if (this.state.view === 'home') {
            this.setState({ activeCooks: data.cooks || [] });
            } else {
                Object.assign(this.state, { activeCooks: data.cooks || [] });
            }
        } catch (err) {
            console.warn('[CookMenuModal] active cooks fetch error', err);
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
        // Start live polling of active cooks every 5 seconds (only when on home view)
        this.pollInterval = setInterval(() => {
            if (this.state.view === 'home') {
                this.fetchActiveCooks();
            }
        }, 5000);
    }

    hide() {
        if (!this.modalElement) return;
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        document.removeEventListener('keydown', this.handleKeyDown);
        document.body.removeChild(this.modalElement);
        this.modalElement = null;
    }

    // --- Initial data ---------------------------------------------------
    async loadInitial() {
        this.setState({ loading: true });
        await Promise.all([this.fetchActiveCooks(), this.fetchCollections()]);
        this.setState({ loading: false });
    }

    // --- Rendering ------------------------------------------------------
    render() {
        const { view, loading, error } = this.state;
        this.modalElement.innerHTML = `
            <div class="cook-modal-container">
                <button class="close-btn" aria-label="Close">×</button>
                ${loading ? '<div class="loading-spinner">Loading…</div>' : ''}
                ${error ? `<div class="error-message">${error}</div>` : ''}
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
        const { activeCooks, collections } = this.state;
        const cooksHtml = activeCooks.length ? activeCooks.map(c => `
            <div class="cook-status-item">
                <div class="cook-title">${c.collectionName || 'Untitled'} – ${c.generationCount}/${c.targetSupply}</div>
                <div class="cook-actions">
                    <button data-action="pause" data-id="${c.collectionId}">⏸</button>
                    <button data-action="resume" data-id="${c.collectionId}">▶️</button>
                    <button data-action="delete" data-id="${c.collectionId}">🗑</button>
                </div>
            </div>
        `).join('') : '<div class="empty-message">No active cooks.</div>';

        const collHtml = collections.length ? collections.map(c => `
            <div class="collection-card" data-id="${c.collectionId}">${c.name || 'Untitled'}</div>
        `).join('') : '<div class="empty-message">No collections yet.</div>';

        return `
            <h2>Active Cooks</h2>
            <div class="cook-status-list">${cooksHtml}</div>
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
        const tabs = ['overview','traitTree','edit'];
        const tabsHtml = tabs.map(t=>`<button class="tab-btn${t===detailTab?' active':''}" data-tab="${t}">${t}</button>`).join('');
        let body='';
        if(detailTab==='overview'){
           body=`<p>${selectedCollection.description||'<em>No description</em>'}</p>`;
        }else if(detailTab==='traitTree'){
           body=`<div id="trait-tree-container"></div>`;
        }else if(detailTab==='edit'){
          body=this.renderEditView();
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
        if (back) back.onclick = () => this.setState({ view: 'home', selectedCollection: null });
        this.modalElement.querySelectorAll('.tab-btn').forEach(btn=>{
            btn.onclick=()=>{
                this.state.detailTab=btn.getAttribute('data-tab');
                this.render();
            };
        });
        if(this.state.detailTab==='traitTree'){
            const container=this.modalElement.querySelector('#trait-tree-container');
            const paramOptions=['prompt','input_image','init_image','strength'];
            const editor=new TraitTreeEditor({collection:this.state.selectedCollection,paramOptions,onSave:async (traits)=>{
                await this.saveTraitTree(traits);
            }});
            editor.attach(container);
        }
        // edit view events
        if(this.state.detailTab==='edit'){
            const radios=this.modalElement.querySelectorAll('input[name="gen-type"]');
            radios.forEach(r=>r.onchange=()=>{this.state.generatorType=r.value;this.render();});
            const toolSel=this.modalElement.querySelector('#tool-select');
            if(toolSel) toolSel.onchange=()=>{this.state.selectedToolId=toolSel.value;};
            const saveBtn=this.modalElement.querySelector('.save-generator-btn');
            if(saveBtn) saveBtn.onclick=()=>this.saveGenerator();
        }
    }

    async saveTraitTree(traits){
        try{
           const csrf=await this.getCsrfToken();
           const id=this.state.selectedCollection.collectionId;
           const res=await fetch(`/api/v1/collections/${encodeURIComponent(id)}`,{method:'PUT',headers:{'Content-Type':'application/json','x-csrf-token':csrf},credentials:'include',body:JSON.stringify({config:{traitTree:traits}})});
           if(res.ok){
              const updated=await res.json();
              this.setState({selectedCollection:updated});
           }
        }catch(err){alert('Failed to save traits');}
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
        // Delegated click handler for cook action buttons
        const statusList = this.modalElement.querySelector('.cook-status-list');
        if (statusList) {
            statusList.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-action]');
                if (!btn) return;
                const action = btn.getAttribute('data-action');
                const id = btn.getAttribute('data-id');
                if (action === 'pause') this.pauseCook(id);
                if (action === 'resume') this.resumeCook(id);
                if (action === 'delete') this.deleteCook(id);
            });
        }

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
                    this.setState({ view: 'detail', selectedCollection: coll });
                }
                }
        });
        }

        const help = this.modalElement.querySelector('.help-btn');
        if (help) help.onclick = () => window.open('/docs/collection-cook-help', '_blank');
    }

    handleKeyDown(e) {
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
            const csrf = await this.getCsrfToken();
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(id)}/cook/pause`, {
                method: 'POST',
                headers: { 'x-csrf-token': csrf },
                credentials: 'include',
            });
            if (!res.ok) throw new Error('pause failed');
            await this.fetchActiveCooks();
        } catch (err) {
            alert('Failed to pause cook');
        }
    }

    async resumeCook(id) {
        if (!id) return;
        try {
            const csrf = await this.getCsrfToken();
            const res = await fetch(`/api/v1/collections/${encodeURIComponent(id)}/cook/resume`, {
                method: 'POST',
                headers: { 'x-csrf-token': csrf },
                credentials: 'include',
            });
            if (!res.ok) throw new Error('resume failed');
            await this.fetchActiveCooks();
        } catch (err) {
            alert('Failed to resume cook');
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
        try{
            const res=await fetch('/api/v1/tools/registry');
            const data=await res.json();
            this.setState({toolOptions:data});
        }catch(e){console.warn('tool fetch fail',e);}
    }

    async saveGenerator(){
        const { generatorType, selectedToolId }=this.state;
        if(generatorType!=='tool'||!selectedToolId) return;
        try{
            const csrf=await this.getCsrfToken();
            const id=this.state.selectedCollection.collectionId;
            const res=await fetch(`/api/v1/collections/${encodeURIComponent(id)}`,{method:'PUT',headers:{'Content-Type':'application/json','x-csrf-token':csrf},credentials:'include',body:JSON.stringify({ generatorType:'tool', toolId:selectedToolId })});
            if(res.ok){
                const updated=await res.json();
                // refresh state and paramOptions
                this.setState({selectedCollection:updated});
            }
        }catch(err){alert('Failed to save generator');}
    }
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