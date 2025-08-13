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
            detailTab: 'overview', // 'overview' | 'traitTree'
            generatorType: null, // 'tool' | 'spell'
            toolOptions: [],
            selectedToolId: null,
            paramOptions: [],
            paramOverrides: {},
            generatorDisplay:'',
            showGenPicker:false,
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
        const tabs = ['overview','traitTree'];
        const tabsHtml = tabs.map(t=>`<button class="tab-btn${t===detailTab?' active':''}" data-tab="${t}">${t}</button>`).join('');
        let body='';
        if(detailTab==='overview'){
           body=this.renderOverviewBody();
        }else if(detailTab==='traitTree'){
           body=`<div id="trait-tree-container"></div>`;
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
        const { selectedCollection, paramOverrides, paramOptions, showGenPicker, toolOptions, selectedToolId }=this.state;
        if(showGenPicker){
            const optsHtml=toolOptions.length?toolOptions.map(t=>`<option value="${t.toolId}" ${t.toolId===selectedToolId?'selected':''}>${t.displayName}</option>`).join(''):'<option>(loading...)</option>';
            return `<h3>Select Generator Tool</h3>
                <select id="tool-select" style="width:100%;max-width:300px;">${optsHtml}</select>
                <div style="margin-top:12px;">
                    <button class="save-generator-btn">Save</button>
                    <button class="cancel-generator-btn" style="margin-left:8px;">Cancel</button>
                </div>`;
        }
        const metaRows=`
          <tr><td>Description</td><td>${selectedCollection.description||''}</td><td><button class="edit-desc-btn">Edit</button></td></tr>
          <tr><td>Total Supply*</td><td>${selectedCollection.totalSupply||''}</td><td><button class="edit-supply-btn">Edit</button></td></tr>`;
        const genRow=`<tr><td>Generator</td><td>${this.state.generatorDisplay||'(none)'}</td><td><button class="edit-gen-btn">${this.state.generatorDisplay?'Change':'Set'}</button></td></tr>`;
        const paramRows=paramOptions.map(p=>`<tr data-param="${p}"><td>${p}</td><td>${paramOverrides[p]||''}</td><td><button class="edit-param-btn">Edit</button></td></tr>`).join('');
        return `<table class="meta-table">${metaRows}${genRow}${paramRows}</table>
        <div style="margin-top:12px"><button class="test-btn">Test</button> <button class="start-cook-btn">Start Cook</button> <button class="delete-collection-btn" style="float:right;color:#f55">Delete</button></div>`;
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

        // Always ensure generator / paramOptions loaded when entering detail view
        if(!this.state.paramOptions.length || !this.state.generatorDisplay){
            this.loadParamOptions();
        }

        this.modalElement.querySelectorAll('.tab-btn').forEach(btn=>{
            btn.onclick=()=>{
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
        }
        // (generator edit UI will be integrated into overview later)
        // ensure paramOptions loaded when entering traitTree
        if(this.state.detailTab==='traitTree' && !this.state.paramOptions.length){
            this.loadParamOptions();
        }
        // Overview edit handlers
        if(this.state.detailTab==='overview'){
            this.attachOverviewEvents();
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
                this.setState({selectedCollection:updated});
                await this.loadParamOptions();
            }
        }catch(err){alert('Failed to save generator');}
    }

    async loadParamOptions(){
        const { selectedCollection }=this.state;
        if(!selectedCollection) return;
        if(selectedCollection.generatorType==='tool' && selectedCollection.toolId){
            try{
                const res=await fetch(`/api/v1/tools/registry/${encodeURIComponent(selectedCollection.toolId)}`);
                if(res.ok){
                    const def=await res.json();
                    const params=def.inputSchema?Object.keys(def.inputSchema):['prompt'];
                    this.setState({paramOptions:params,generatorDisplay:def.displayName||def.toolId});
                    return;
                }
            }catch(e){console.warn('param fetch fail',e);}
        }
        // fallback
        this.setState({paramOptions:['prompt']});
    }

    attachOverviewEvents(){
        const modal=this.modalElement;
        if(modal.querySelector('.edit-desc-btn')) modal.querySelector('.edit-desc-btn').onclick=async()=>{
            const val=prompt('Description',this.state.selectedCollection.description||'');
            if(val!==null){await this.updateCollection({description:val});}
        };
        if(modal.querySelector('.edit-supply-btn')) modal.querySelector('.edit-supply-btn').onclick=async()=>{
            const val=prompt('Total supply',this.state.selectedCollection.totalSupply||'');
            if(val!==null){await this.updateCollection({totalSupply:Number(val)});} };
        if(modal.querySelector('.edit-gen-btn')) modal.querySelector('.edit-gen-btn').onclick=()=>{
            this.setState({showGenPicker:true});
            if(!this.state.toolOptions.length){this.fetchTools();}
        };
        if(modal.querySelector('.save-generator-btn')) modal.querySelector('.save-generator-btn').onclick=()=>{
            const sel=modal.querySelector('#tool-select');
            const id=sel?sel.value:'';
            const opt=this.state.toolOptions.find(t=>t.toolId===id);
            if(id){this.saveGeneratorSelection(id,opt?opt.displayName:id).then(()=>{this.setState({showGenPicker:false});});}
        };
        if(modal.querySelector('.cancel-generator-btn')) modal.querySelector('.cancel-generator-btn').onclick=()=>{
            this.setState({showGenPicker:false});
        };
        modal.querySelectorAll('.edit-param-btn').forEach(btn=>{
            btn.onclick=async()=>{
                const param=btn.closest('tr').getAttribute('data-param');
                const current=this.state.paramOverrides[param]||'';
                const val=prompt(`Set value for ${param}`,current);
                if(val!==null){
                    const overrides={...this.state.paramOverrides,[param]:val};
                    await this.updateCollection({ 'config.paramOverrides': overrides });
                }
            };
        });
        if(modal.querySelector('.test-btn')) modal.querySelector('.test-btn').onclick=()=>{this.hide();import('./CollectionTestWindow.js').then(m=>{m.createCollectionTestWindow(this.state.selectedCollection);});};
        if(modal.querySelector('.start-cook-btn')) modal.querySelector('.start-cook-btn').onclick=async()=>{
            const coll=this.state.selectedCollection; if(!coll) return;
            if(!(coll.toolId||coll.spellId)){ alert('Please select a generator (tool or spell) before starting.'); return; }
            const supply = Number(coll.totalSupply)||0; if(supply<=0){ alert('Please set a valid Total Supply (>0).'); return; }
            const id=coll.collectionId;
            try{
                this.setState({ loading:true });
                const csrf = await this.getCsrfToken();
                const payload={
                    toolId: coll.toolId,
                    spellId: coll.spellId,
                    traitTree: coll.config?.traitTree||[],
                    paramOverrides: coll.config?.paramOverrides||this.state.paramOverrides||{},
                    totalSupply: supply
                };
                const res=await fetch(`/api/v1/collections/${encodeURIComponent(id)}/cook/start`,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':csrf},credentials:'include',body:JSON.stringify(payload)});
                const data = await res.json().catch(()=>({}));
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
        if(res.ok){const updated=await res.json();this.setState({selectedCollection:updated,paramOverrides:updated.config?.paramOverrides||{}});} }

    openToolPicker(){
        if(!this.state.toolOptions.length){this.fetchTools().then(()=>this.openToolPicker());return;}
        const names=this.state.toolOptions.map(t=>`${t.displayName} (${t.toolId})`).join('\n');
        const chosen=prompt(`Enter toolId:\n${names}`,this.state.selectedToolId||'');
        const tool=this.state.toolOptions.find(t=>t.toolId===chosen);
        if(tool){this.saveGeneratorSelection(tool.toolId,tool.displayName);} }

    async saveGeneratorSelection(toolId,displayName){
        this.state.generatorType='tool';this.state.selectedToolId=toolId;this.state.generatorDisplay=displayName;await this.saveGenerator();}
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