// src/platforms/web/client/src/sandbox/components/ModsMenuModal.js
// A modal overlay that lets users browse available model assets (checkpoints, LoRAs, upscalers, etc.)
// and select one to add to the current workspace / canvas.
// Relies on external API endpoints:
//   GET /api/v1/models?category=<cat>
//   GET /api/v1/models/stats
// Styling follows spellsMenuModal.css with minor tweaks defined in modsMenuModal.css.

export default class ModsMenuModal {
  constructor(options = {}) {
    this.onSelect = options.onSelect || (() => {}); // callback when user picks a model
    this.state = {
      rootTab: 'browse', // NEW: 'browse' | 'train'
      view: 'intro', // 'intro' | 'loraRoot' | 'category' | 'trainDash'
      categories: ['checkpoint', 'lora', 'upscale', 'embedding', 'vae', 'controlnet', 'clipseg'],
      loraCategories: [],
      counts: {},
      currentCategory: null,
      currentLoraCategory: null,
      selectedTags: [],
      extraTags: [],
      detailModel: null,
      importUrl: '',
      models: [],
      loading: false,
      error: null,
      favoriteIds: new Set(), // store ids liked by user
      trainings: [], // NEW
      datasets: [],  // NEW
      loadingTrain:false,
      trainError:null,
      formMode:null, // 'new-dataset'|'edit-dataset'|'new-training'|'edit-training'
      formValues:{},
      formError:null,
      submitting:false,
      newImageUrls:[],
    };
    this.modalElement = null;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  setState(newState) {
    Object.assign(this.state, newState);
    if (this.modalElement) {
      this.render();
    }
  }

  async fetchStats() {
    try {
      const res = await fetch('/api/v1/models/stats', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch model stats');
      const data = await res.json();
      this.setState({ counts: data.counts || {} });
    } catch (err) {
      console.warn('[ModsMenuModal] stats fetch error', err);
    }
  }

  async fetchFavorites(category) {
    if (!category) return;
    try {
      const res = await fetch(`/api/v1/user/me/preferences/model-favorites/${encodeURIComponent(category)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('favorites fetch failed');
      const data = await res.json();
      const favs = new Set(data.favorites || []);
      this.setState({ favoriteIds: favs });
    } catch (err) {
      console.warn('[ModsMenuModal] favorites fetch error', err);
      this.setState({ favoriteIds: new Set() });
    }
  }

  async toggleFavorite(model, category) {
    if (!model) return;
    const id = this.getModelIdentifier(model);
    const isFav = this.state.favoriteIds.has(id);
    const method = isFav ? 'DELETE' : 'POST';
    const url = isFav
      ? `/api/v1/user/me/preferences/model-favorites/${encodeURIComponent(category)}/${encodeURIComponent(id)}`
      : `/api/v1/user/me/preferences/model-favorites/${encodeURIComponent(category)}`;
    const body = isFav ? undefined : JSON.stringify({ modelId: id });

    try {
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();

      await fetch(url, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          'x-csrf-token': csrfToken,
        },
        body,
        credentials: 'include',
      });
    } catch (err) {
      console.warn('[ModsMenuModal] toggleFavorite error', err);
    }

    // optimistic update
    const newFavs = new Set(this.state.favoriteIds);
    if (isFav) newFavs.delete(id); else newFavs.add(id);
    this.setState({ favoriteIds: newFavs });
  }

  async fetchLoraCategories() {
    try {
      const res = await fetch(`/api/v1/models/lora/categories?_=${Date.now()}`, { credentials: 'include', cache: 'no-store' });
      if (res.status === 304) {
        // Nothing changed; if we already have categories keep them
        if (this.state.loraCategories.length) return;
        throw new Error('No category data (304)');
      }
      if (!res.ok) throw new Error('Failed to fetch LoRA categories');
      const data = await res.json();
      console.log('[ModsMenuModal] LoRA categories response', data);
      this.setState({ loraCategories: data.categories || [] });
    } catch (err) {
      console.warn('[ModsMenuModal] lora categories fetch error', err);
      this.setState({ loraCategories: [], error: 'Could not load LoRA categories.' });
    }
  }

  async fetchDatasets() { // NEW helper
    try {
      const res = await fetch('/api/v1/datasets', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      this.setState({ datasets: data.datasets || [] });
    } catch(err){ console.warn('[ModsMenuModal] fetchDatasets error', err); }
  }

  async fetchTrainings(){
    this.setState({loadingTrain:true,trainError:null});
    try{
      const res= await fetch('/api/v1/trainings',{credentials:'include'});
      if(!res.ok) throw new Error('Failed');
      const data= await res.json();
      this.setState({trainings:data.trainings||[],loadingTrain:false});
    }catch(err){
      console.warn('[ModsMenuModal] fetchTrainings error',err);
      this.setState({loadingTrain:false,trainError:'Could not load trainings.'});
    }
  }

  getModelIdentifier(model) {
    return model._id || model.path || model.name || model.save_path || model.sha || JSON.stringify(model);
  }

  async fetchModels(category, subCategory = null) {
    this.setState({ loading: true, error: null, models: [] });
    try {
      const limitParam = 'limit=100';
      let url;
      if (category === 'lora' && subCategory) {
        url = `/api/v1/models/lora?category=${encodeURIComponent(subCategory)}&${limitParam}`;
      } else if (category) {
        url = `/api/v1/models?category=${encodeURIComponent(category)}&${limitParam}`;
      } else {
        url = `/api/v1/models?${limitParam}`;
      }
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      const modelsData = data.loras || data.models || [];

      let selectedTags = this.state.selectedTags.map(t => t.toLowerCase());
      if (category === 'lora') {
        selectedTags = subCategory ? [subCategory.toLowerCase()] : [];
      }

      const filtered = this.applyTagFilter(modelsData, selectedTags);
      const extraTags = this.computeExtraTags(filtered, selectedTags);
      console.log('[ModsMenuModal] extraTags', extraTags);
      this.setState({ models: filtered, loading: false, selectedTags, extraTags });
      // After models load, fetch favourites so we can sort
      this.fetchFavorites(category);
    } catch (err) {
      this.setState({ loading: false, error: 'Failed to load models.' });
    }
  }

  applyTagFilter(models, selected) {
    if (!selected || !selected.length) return models;
    return models.filter(m => {
      if (!m.tags || !m.tags.length) return false;
      const tags = m.tags.map(t => (typeof t === 'string' ? t : t.tag).toLowerCase());
      return selected.every(tag => tags.includes(tag));
    });
  }

  computeExtraTags(models, selected) {
    const tagSet = new Set();
    models.forEach(m => {
      (m.tags || []).forEach(t => {
        const val = (typeof t === 'string' ? t : t.tag).toLowerCase();
        if (!selected.includes(val)) tagSet.add(val);
      });
    });
    return Array.from(tagSet).sort();
  }

  show() {
    if (this.modalElement) return;
    this.modalElement = document.createElement('div');
    this.modalElement.className = 'mods-modal-overlay';
    document.body.appendChild(this.modalElement);
    this.render();
    this.attachCloseEvents();
    this.fetchStats();
    if(this.state.rootTab==='train') { this.fetchDatasets(); this.fetchTrainings(); }
  }

  hide() {
    if (!this.modalElement) return;
    document.removeEventListener('keydown', this.handleKeyDown);
    document.body.removeChild(this.modalElement);
    this.modalElement = null;
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') this.hide();
  }

  render() {
    if (!this.modalElement) return;

    const { rootTab, view, categories, currentCategory, currentLoraCategory, loraCategories, counts, models, loading, error, favoriteIds, selectedTags, extraTags } = this.state;

    // Top tab bar
    const tabBar = `
      <div class="mods-root-tabs">
        <button class="root-tab-btn${rootTab==='browse'?' active':''}" data-tab="browse">Browse</button>
        <button class="root-tab-btn${rootTab==='train'?' active':''}" data-tab="train">Train</button>
      </div>`;

    // Build browse view content (reuse original logic)
    let browseContent = '';
    if (rootTab === 'browse') {
      const catButtons = categories.map(cat => {
        const active = cat === currentCategory;
        const count = counts[cat] != null ? ` (${counts[cat]})` : '';
        return `<button class="cat-btn${active ? ' active' : ''}" data-cat="${cat}">${cat}${count}</button>`;
      }).join('');

      // LoRA sub-category bar
      let loraCatBar = '';
      if (currentCategory === 'lora' && (view === 'loraRoot' || view === 'category')) {
        loraCatBar = '<div class="lora-cat-bar">' + (
          loraCategories.length ? loraCategories.map(cat => {
            const active = cat === currentLoraCategory;
            return `<button class="lora-sub-btn${active ? ' active' : ''}" data-loracat="${cat}">${cat}</button>`;
          }).join('') : (loading ? '<em>Loading…</em>' : '<em>No categories found</em>')
        ) + '</div>';
      }

      // Model list (condensed, reuse previous blocks)
      let listHtml = '';
      if (view === 'category') {
        if (loading) {
          listHtml = '<div class="loading-spinner">Loading…</div>';
        } else if (error) {
          listHtml = `<div class="error-message">${error}</div>`;
        } else if (!models.length) {
          listHtml = '<div class="empty-message">No models found.</div>';
        } else {
          const header = selectedTags.length ? `<h3 class="filter-header">${selectedTags.join(' + ')} (${models.length})</h3>` : '';
          const showImport = ['lora','checkpoint'].includes(currentCategory);
          const importButton = showImport ? '<button class="import-btn">＋ Import</button>' : '';
          const uid = window.currentUserId || null;
          const isPrivate = (m)=>{
            const raw=(m.path||m.save_path||'').toLowerCase(); if(!raw) return false; const normalized=raw.replace(/\\/g,'/'); const inPriv=normalized.includes('checkpoints/users/'); if(!inPriv) return false; if(!uid) return true; return normalized.includes(`checkpoints/users/${uid.toLowerCase()}/`); };
          const visibleModels = models.filter(m=>{ const p=(m.path||m.save_path||'').toLowerCase(); if(!p.includes('checkpoints/users/')) return true; if(!uid) return true; return p.includes(`checkpoints/users/${uid.toLowerCase()}/`); });
          const sortModels=[...visibleModels].sort((a,b)=>{ const privA=isPrivate(a); const privB=isPrivate(b); if(privA!==privB) return privA?-1:1; const idA=this.getModelIdentifier(a); const idB=this.getModelIdentifier(b); const favA=favoriteIds.has(idA); const favB=favoriteIds.has(idB); if(favA===favB) return 0; return favA?-1:1; });
          listHtml='<ul class="mods-list">'+sortModels.map((m,idx)=>{ const id=this.getModelIdentifier(m); const isFav=favoriteIds.has(id); const heart=isFav?'❤️':'♡'; const displayPath=m.path||m.name||m.save_path||'unknown'; const display=displayPath.split('/').pop(); const size=m.size?`${(m.size/(1024**2)).toFixed(1)} MB`:''; const priv=isPrivate(m); const lockSpan=priv?'<span class="priv-icon">🔒</span>':''; return `<li class="mods-item${priv?' private':''}" data-idx="${idx}"><span class="mods-title">${display}</span> <span class="mods-size">${size}</span> ${lockSpan} <button class="fav-btn" data-idx="${idx}">${heart}</button></li>`; }).join('')+'</ul>';
          const extraBar = extraTags.length ? `<div class="extra-tag-bar">`+extraTags.map(t=>`<button class="extra-tag-btn" data-tag="${t}">${t}</button>`).join('')+`</div>`:'';
          listHtml = header + importButton + extraBar + listHtml;
        }
      }
      browseContent = `
        <h2>Model Browser</h2>
        <p class="intro-text">Browse the models currently available on StationThis. Select a category to see assets and click + to add.</p>
        <div class="mods-category-bar">${catButtons}</div>
        <div class="mods-content-inner">
          ${view === 'intro' ? '<div class="intro-placeholder">Select a category above.</div>' : ''}
          ${currentCategory === 'lora' ? loraCatBar : ''}
          ${view === 'category' ? listHtml : ''}
        </div>`;
    }

    // Decide mainContent
    let mainContent = '';
    if (rootTab === 'train') {
      const { formMode, formValues, formError, submitting } = this.state;
      if(formMode){
        const isDataset=formMode.includes('dataset');
        const legend=isDataset? (formMode==='new-dataset'?'New Dataset':'Edit Dataset') : (formMode==='new-training'?'New Training':'Edit Training');
        const dsOptions=this.state.datasets.map(d=>`<option value="${d._id}" ${formValues.datasetId===d._id?'selected':''}>${d.name}</option>`).join('');
        const imageGallery=isDataset && formMode==='edit-dataset' ? `<div class="image-gallery">${(formValues.previewImages||[]).map(url=>`<img src="${url}" class="thumb" />`).join('')}</div>` : '';
        const addImagesSection=isDataset && formMode==='edit-dataset' ? `
          <label>Add Images (URLs comma or space separated):<br><textarea name="_imgInput"></textarea></label>
          <button type="button" class="add-img-btn">Add Images</button>
          <div class="new-img-preview">${this.state.newImageUrls.map(u=>`<img src="${u}" class="thumb" />`).join('')}</div>` : '';
        mainContent=`<h2>${legend}</h2>
          ${formError?`<div class="error-message">${formError}</div>`:''}
          <form class="train-form">
            <label>Name:<br><input type="text" name="name" value="${formValues.name||''}" /></label><br>
            ${isDataset?'<label>Description:<br><textarea name="description">'+(formValues.description||'')+'</textarea></label><br>':
              `<label>Dataset:<br><select name="datasetId">${dsOptions}</select></label><br>
               <label>Base Model:<br><input name="baseModel" value="${formValues.baseModel||''}" /></label><br>
               <label>Offering ID:<br><input name="offeringId" value="${formValues.offeringId||''}" /></label><br>`}
            ${imageGallery}
            ${addImagesSection}
            <button type="submit" ${submitting?'disabled':''}>${submitting?'Saving…':'Save'}</button>
            <button type="button" class="cancel-btn">Cancel</button>
          </form>`;
      } else {
        const { datasets, trainings, loadingTrain, trainError } = this.state;
        const dsList = loadingTrain ? '<div class="loading-spinner">Loading…</div>' : trainError ? `<div class="error-message">${trainError}</div>` : (
          datasets.length ? '<ul class="ds-list">'+datasets.map(ds=>`<li class="ds-item">${ds.name||'Unnamed Dataset'} (${ds.numImages||0} imgs)</li>`).join('')+'</ul>' : '<div class="empty-message">No datasets yet.</div>'
        );
        const trList = loadingTrain ? '' : trainError ? '' : (
          trainings.length ? '<ul class="train-list">'+trainings.map(tr=>`<li class="train-item">${tr.name||'Training'} - <em>${tr.status||'draft'}</em></li>`).join('')+'</ul>' : '<div class="empty-message">No trainings yet.</div>'
        );
        mainContent = `
          <h2>Train Dashboard</h2>
          <div class="train-section">
            <div class="train-section-header"><h3>Datasets</h3><button class="add-dataset-btn">＋</button></div>
            ${dsList}
          </div>
          <div class="train-section">
            <div class="train-section-header"><h3>Trainings</h3><button class="add-training-btn">＋</button></div>
            ${trList}
          </div>`;
      }
    }

    // base modal html
    this.modalElement.innerHTML = `
      <div class="mods-modal-container">
        <button class="close-btn" aria-label="Close">×</button>
        ${tabBar}
        <div class="mods-content"></div>
      </div>`;

    const contentEl = this.modalElement.querySelector('.mods-content');
    if(rootTab==='browse') {
      contentEl.innerHTML = browseContent;
    } else {
      contentEl.innerHTML = mainContent;
    }

    // Attach category btn events if browse
    if(rootTab==='browse') {
      this.modalElement.querySelectorAll('.cat-btn').forEach(btn => {
        btn.onclick = () => {
          const cat = btn.getAttribute('data-cat');
          if (cat === 'lora') {
            this.setState({ view: 'category', currentCategory: 'lora', currentLoraCategory: null, selectedTags: [], extraTags: [], models: [] });
            this.fetchLoraCategories();
            this.fetchModels('lora');
            return;
          }
          this.setState({ view: 'category', currentCategory: cat, currentLoraCategory: null });
          this.fetchModels(cat);
        };
      });
      this.modalElement.querySelectorAll('.lora-sub-btn').forEach(btn => {
        btn.onclick = () => {
          const sub = btn.getAttribute('data-loracat');
          this.setState({ view: 'category', currentLoraCategory: sub });
          this.fetchModels('lora', sub);
        };
      });
      // Extra tag click
      this.modalElement.querySelectorAll('.extra-tag-btn').forEach(btn=>{
        btn.onclick = () => {
          const tag = btn.getAttribute('data-tag').toLowerCase();
          const newSelected = [...this.state.selectedTags.map(t=>t.toLowerCase()), tag];
          const filtered = this.applyTagFilter(this.state.models, newSelected);
          const remaining = this.computeExtraTags(filtered, newSelected);
          this.setState({ selectedTags: newSelected, models: filtered, extraTags: remaining });
        };
      });
    }

    // Tab button events
    this.modalElement.querySelectorAll('.root-tab-btn').forEach(btn=>{
      btn.onclick = ()=>{
        const tab = btn.getAttribute('data-tab');
        if(tab!==this.state.rootTab){
          this.setState({ rootTab: tab, view: tab==='browse'? 'intro':'trainDash' });
          if(tab==='train') { this.fetchDatasets(); this.fetchTrainings(); }
        }
      };
    });

    // Add Dataset button
    const addDsBtn = this.modalElement.querySelector('.add-dataset-btn');
    if(addDsBtn){
      addDsBtn.onclick = ()=> this.openDatasetForm();
    }
    const addTrBtn = this.modalElement.querySelector('.add-training-btn');
    if(addTrBtn){
      addTrBtn.onclick = ()=> this.openTrainingForm();
    }

    // Form input bindings
    const formEl=this.modalElement.querySelector('.train-form');
    if(formEl){
      formEl.oninput=(e)=>{
        const {name,value}=e.target;
        // Mutate formValues directly to avoid full re-render and caret loss
        this.state.formValues[name]=value;
      };
      formEl.onsubmit=(e)=>{e.preventDefault(); this.submitForm();};
      this.modalElement.querySelector('.cancel-btn').onclick=()=>this.resetForm();
    }

    // Click row to edit
    this.modalElement.querySelectorAll('.ds-item').forEach((li,idx)=>{
      li.onclick=()=>{ const ds=this.state.datasets[idx]; this.openDatasetForm(ds); };
    });
    this.modalElement.querySelectorAll('.train-item').forEach((li,idx)=>{
      li.onclick=()=>{ const tr=this.state.trainings[idx]; this.openTrainingForm(tr); };
    });
  }

  attachCloseEvents() {
    this.modalElement.querySelector('.close-btn').addEventListener('click', () => this.hide());
    this.modalElement.addEventListener('click', (e) => {
      if (e.target === this.modalElement) this.hide();
    });
    document.addEventListener('keydown', this.handleKeyDown);
  }

  resetForm(){ this.setState({formMode:null,formValues:{},formError:null,submitting:false}); }

  openDatasetForm(ds=null){
    if(ds){ this.setState({formMode:'edit-dataset',formValues:{...ds}}); }
    else { this.setState({formMode:'new-dataset',formValues:{name:'',description:''}});} }

  openTrainingForm(tr=null){
    if(tr){ this.setState({formMode:'edit-training',formValues:{...tr}}); }
    else { const firstDs=this.state.datasets[0]; this.setState({formMode:'new-training',formValues:{name:'',datasetId:firstDs?firstDs._id:'',baseModel:'SD1.5',offeringId:''}});} }

  addImageUrls(urls){
    const clean=urls.split(/\s|,/).map(u=>u.trim()).filter(Boolean);
    this.setState({newImageUrls:[...this.state.newImageUrls,...clean]});
  }

  async submitForm(){
    const { formMode, formValues } = this.state;
    this.setState({submitting:true,formError:null});
    try{
      let url='',method='POST',payload=formValues;
      if(formMode==='new-dataset') url='/api/v1/datasets';
      else if(formMode==='edit-dataset'){ url=`/api/v1/datasets/${encodeURIComponent(formValues._id)}`; method='PUT'; }
      else if(formMode==='new-training') url='/api/v1/trainings';
      else if(formMode==='edit-training'){ url=`/api/v1/trainings/${encodeURIComponent(formValues._id)}`; method='PUT'; }

      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();

      const res= await fetch(url,{method,credentials:'include',headers:{'Content-Type':'application/json','x-csrf-token':csrfToken},body:JSON.stringify(payload)});
      if(!res.ok) throw new Error(`save-failed-${res.status}`);

      // If dataset edit and we have new images, send them
      if(formMode==='edit-dataset' && this.state.newImageUrls.length){
        await fetch(`/api/v1/datasets/${encodeURIComponent(formValues._id)}/images`,{
          method:'POST',credentials:'include',headers:{'Content-Type':'application/json','x-csrf-token':csrfToken},
          body:JSON.stringify({imageUrls:this.state.newImageUrls})
        });
      }

      this.resetForm();
      this.fetchDatasets();
      this.fetchTrainings();
    }catch(err){ this.setState({formError:'Save failed',submitting:false}); }
  }
} 