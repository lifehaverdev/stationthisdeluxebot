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
      rootTab: 'browse', // Root tabs: 'browse' | 'train'  (captions lives inside Train tab per ADR-2025-10-03)
      view: 'intro', // Views: 'intro' | 'loraRoot' | 'category' | 'trainDash'
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
      uploading:false,
      newImageUrls:[],
      originalFormValues:null, // <--- store pristine copy for diffing
      estimatedCost: 0,
      costBreakdown: {},
      // Caption management
      selectedDatasetId: null,
      captionSets: [],
      loadingCaptions: false,
      captionError: null,
      captionerSpells: [],
      captionTasks: {},
    };
    this.modalElement = null;
    this.handleKeyDown = this.handleKeyDown.bind(this);
    // For import overlay tracking
    this.importDialog = null;
    // Cache expanded tag state per-session (localStorage key: mods_show_tags)
    this._expandedTagModels = null;
    // WebSocket integration
    this.ws = window.websocketClient;
    this.setupWebSocketListeners();
    this._captionTaskCleanupTimers = {};

    // Listen for uploads from UploadWindow so we can attach to dataset being edited
    this._uploadListener = async (e) => {
      const url = e.detail?.url;
      if (!url) return;
      // Only apply if modal is currently open in dataset edit/new mode
      if (!this.modalOverlayEl) return;
      const mode = this.state.formMode;
      if (mode === 'new-dataset' || mode === 'edit-dataset') {
        const alreadyAdded = this.state.newImageUrls.includes(url);
        const currentImages = this.state.formValues.images || [];

        const updatedState = {};

        // Track newly uploaded URLs so we can POST them later (edit-dataset) or include in create payload (new-dataset)
        if (!alreadyAdded) {
          updatedState.newImageUrls = [...this.state.newImageUrls, url];
        }

        // Keep formValues.images in sync so UI previews & validation work
        if (!currentImages.includes(url)) {
          updatedState.formValues = {
            ...this.state.formValues,
            images: [...currentImages, url],
          };
        }

        if (Object.keys(updatedState).length) {
          this.setState(updatedState);
        }
        // For edit-dataset we still defer backend persistence until submitForm()
      }
    };
    window.addEventListener('uploadCompleted', this._uploadListener);

    // Pre-fetch captioner spells list (tagged [captioner])
    this.fetchCaptionerSpells();
  }

  setState(newState) {
    Object.assign(this.state, newState);
    if (this.modalElement) {
      this.render();
    }
  }

  setupWebSocketListeners() {
    if (this.ws) {
      this.ws.on('trainingUpdate', (data) => {
        this.updateTrainingStatus(data.trainingId, data.status, data.progress);
        this.render();
      });
      
      this.ws.on('trainingError', (data) => {
        this.showTrainingError(data.trainingId, data.error);
      });

      // Caption generation progress updates
      this.ws.on('captionProgress', (data) => {
        const { captionSetId, status, datasetId } = data;
        const normalizedDatasetId = this.normalizeId(datasetId);
        this.handleCaptionTaskEvent(data);
        if (normalizedDatasetId !== this.normalizeId(this.state.selectedDatasetId)) return;
        if(captionSetId){
          const normalizedId=this.normalizeId(captionSetId);
          const idx = this.state.captionSets.findIndex(c => this.normalizeId(c._id) === normalizedId);
          if (idx !== -1) {
            const cs = this.state.captionSets[idx];
            if(status) cs.status = status;
            if (status === 'COMPLETED' || status === 'FAILED') {
              cs.completedAt = new Date();
            }
            this.render();
          }
        } else {
          // No captionSetId – refresh whole list to get latest data
          this.fetchCaptionSets(datasetId);
        }
      });
    }
  }

  updateTrainingStatus(trainingId, status, progress) {
    const training = this.state.trainings.find(t => t._id === trainingId);
    if (training) {
      training.status = status;
      training.progress = progress;
      if (status === 'COMPLETED' || status === 'FAILED') {
        training.completedAt = new Date();
      }
    }
  }

  showTrainingError(trainingId, error) {
    const training = this.state.trainings.find(t => t._id === trainingId);
    if (training) {
      training.error = error;
      training.status = 'FAILED';
    }
    this.render();
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
      const masterAccountId = await this.getCurrentMasterAccountId();
      if (!masterAccountId) {
        console.warn('[ModsMenuModal] No masterAccountId available for fetching datasets');
        this.setState({ datasets: [] });
        return;
      }
      
      const res = await fetch(`/api/v1/datasets/owner/${masterAccountId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      const datasets = data.data?.datasets || [];
      const captionTasks = this.hydrateCaptionTasksFromDatasets(datasets);
      this.setState({ datasets, captionTasks });
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

  /* ---------------------------------- TAG HELPERS ---------------------------------- */
  /**
   * Returns true if the given model is accessible to the current viewer (public OR owned private).
   */
  isModelAccessible(model){
    const uid = (window.currentUserId||'').toLowerCase();
    const raw=(model.path||model.save_path||'').toLowerCase();
    if(!raw) return true; // assume accessible if no path info
    const norm=raw.replace(/\\/g,'/');
    const privRoot = norm.includes('checkpoints/users/') || norm.includes('loras/users/');
    if(!privRoot) return true; // public model
    if(!uid) return false; // viewer not logged in – not owner
    return norm.includes(`/users/${uid}/`);
  }

  /** Lazily read & parse expanded-tag state from localStorage */
  getExpandedTagSet(){
    if(this._expandedTagModels) return this._expandedTagModels;
    try{
      const raw=localStorage.getItem('mods_show_tags');
      const arr= raw? JSON.parse(raw):[];
      this._expandedTagModels=new Set(arr);
    }catch{ this._expandedTagModels=new Set(); }
    return this._expandedTagModels;
  }
  /** Persist current expanded-tag set to localStorage */
  persistExpandedTagSet(){
    try{ localStorage.setItem('mods_show_tags', JSON.stringify([...this.getExpandedTagSet()])); }catch{}
  }

  async fetchModels(category, subCategory = null) {
    this.setState({ loading: true, error: null, models: [] });
    try {
      const limitParam = 'limit=100';
      let url;
      if (category === 'lora') {
        const catParam = subCategory ? `category=${encodeURIComponent(subCategory)}&` : '';
        url = `/api/v1/models/lora?${catParam}${limitParam}`;
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
    const accessible=models.filter(m=>this.isModelAccessible(m));
    if (!selected || !selected.length) return accessible;
    return accessible.filter(m => {
      if (!m.tags || !m.tags.length) return false;
      const tags = m.tags.map(t => (typeof t === 'string' ? t : t.tag).toLowerCase());
      return selected.every(tag => tags.includes(tag));
    });
  }

  computeExtraTags(models, selected) {
    const tagSet = new Set();
    models.filter(m=>this.isModelAccessible(m)).forEach(m => {
      (m.tags || []).forEach(t => {
        const val = (typeof t === 'string' ? t : t.tag).toLowerCase();
        if (!selected.includes(val)) tagSet.add(val);
      });
    });
    return Array.from(tagSet).sort().slice(0,15); // cap to 15 as per acceptance criteria
  }

  show() {
    if (this.modalElement) return;
    this.modalElement = document.createElement('div');
    this.modalElement.className = 'mods-modal-overlay';
    this.modalElement._modsModalInstance = this; // Store instance reference
    // NEW: expose for upload listener
    this.modalOverlayEl = this.modalElement;
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

  ensureModalShell() {
    if (!this.modalElement) return;
    if (this.modalElement.querySelector('.mods-modal-container')) return;
    this.modalElement.innerHTML = `
      <div class="mods-modal-container">
        <button class="close-btn" aria-label="Close">×</button>
        <div class="mods-root-tabs"></div>
        <div class="mods-content"></div>
      </div>`;
  }

  render() {
    if (!this.modalElement) return;
    this.ensureModalShell();

    const { rootTab, view, categories, currentCategory, currentLoraCategory, loraCategories, counts, models, loading, error, favoriteIds, selectedTags, extraTags } = this.state;

    // Top tab bar
    const tabButtons = `
        <button class="root-tab-btn${rootTab==='browse'?' active':''}" data-tab="browse">Browse</button>
        <button class="root-tab-btn${rootTab==='train'?' active':''}" data-tab="train">Train</button>
      `;

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
          const isPrivate=(m)=>{
            const p=(m.path||m.save_path||'').toLowerCase();
            return p.includes('/users/');
          };
          const ownedPrivate=(m)=> uid && isPrivate(m) && (p=>(p.includes(`/users/${uid}/`)))( (m.path||m.save_path||'').toLowerCase());
          const weight=(m)=>{
            if(ownedPrivate(m)) return -3;
            const id=this.getModelIdentifier(m);
            if(favoriteIds.has(id)) return -2;
            return 0;
          };
          const visibleModels = models.filter(m=> this.isModelAccessible(m));
          const sortModels=[...visibleModels].sort((a,b)=>{
            const wA=weight(a), wB=weight(b);
            if(wA!==wB) return wA-wB;
            // fallback alphabetical
            const nameA=(a.name||a.slug||'').toLowerCase();
            const nameB=(b.name||b.slug||'').toLowerCase();
            return nameA.localeCompare(nameB);
          });
          const extraBar = extraTags.length ? `<div class="extra-tag-bar">`+extraTags.map(t=>`<button class="extra-tag-btn" data-tag="${t}">${t}</button>`).join('')+`</div>`:'';
          // store for click handling
          this._displayModels = sortModels;
          listHtml = header + importButton + extraBar + '<ul class="mods-list">' + sortModels.map((m,idx)=>{
            const id=this.getModelIdentifier(m);
            const isFav=favoriteIds.has(id);
            const heart=isFav?'❤️':'♡';
            const displayPath=m.path||m.name||m.save_path||'unknown';
            const display=displayPath.split('/').pop();
            const size=m.size?`${(m.size/(1024**2)).toFixed(1)} MB`:'';
            const priv=!this.isModelAccessible(m);
            const lockSpan=priv?'<span class="priv-icon">🔒</span>':'';
            const tagsArr=(m.tags||[]).map(t=>typeof t==='string'?t:t.tag);
            const expanded=this.getExpandedTagSet().has(id);
            const visibleTags=expanded?tagsArr:tagsArr.slice(0,5);
            const tagsHtml=visibleTags.map(t=>`<span class="tag">${t}</span>`).join(' ');
            const toggleBtn=tagsArr.length>5?`<button class="tag-toggle" data-id="${id}" data-idx="${idx}">${expanded?'Hide tags':'… Show tags'}</button>`:'';
            return `<li class="mods-item${priv?' private':''}" data-idx="${idx}"><span class="mods-title">${display}</span> <span class="mods-size">${size}</span> ${lockSpan} <button class="fav-btn" data-idx="${idx}">${heart}</button><div class="mods-tags">${tagsHtml} ${toggleBtn}</div></li>`; }).join('')+'</ul>';
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
      const { formMode, formValues, formError, submitting, uploading } = this.state;
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
            ${isDataset ? `
              <div class="form-section">
                <h3>Basic Information</h3>
                <label>Dataset Name:<br><input type="text" name="name" value="${formValues.name||''}" required /></label><br>
                <label>Description:<br><textarea name="description">${formValues.description||''}</textarea></label><br>
                <label>Tags:<br><input type="text" name="tags" value="${formValues.tags||''}" placeholder="comma,separated,tags" /></label><br>
              </div>

              <div class="form-section">
                <h3>Images</h3>
                
                <!-- Upload Methods Tabs -->
                <div class="upload-methods">
                  <button type="button" class="upload-tab-btn active" data-method="upload">Upload Files</button>
                  <button type="button" class="upload-tab-btn" data-method="urls">Image URLs</button>
                  <button type="button" class="upload-tab-btn" data-method="paste">Paste Images</button>
                </div>

                <!-- File Upload Area -->
                <div class="upload-method-content" id="upload-method">
                  <div class="file-upload-area" id="file-upload-area">
                    <div class="upload-prompt">
                      <div class="upload-icon">📁</div>
                      <p>Drag and drop images here, or <button type="button" class="file-select-btn">click to browse</button></p>
                      <p class="upload-hint">Supports JPG, PNG, WebP, GIF (max 10MB each)</p>
                    </div>
                    <input type="file" id="file-input" multiple accept="image/*" style="display: none;" />
                  </div>
                  
                  <!-- Upload Progress -->
                  <div class="upload-progress" id="upload-progress" style="display: ${uploading?'block':'none'};">
                    <div class="progress-bar">
                      <div class="progress-fill" id="progress-fill" style="width: 0%;"></div>
                    </div>
                    <div class="progress-text" id="progress-text">Uploading...</div>
                  </div>
                </div>

                <!-- URL Input (existing functionality) -->
                <div class="upload-method-content" id="urls-method" style="display: none;">
                  <label>Add Images (URLs):<br>
                    <textarea name="imageUrls" placeholder="Enter image URLs, one per line or comma-separated"></textarea>
                  </label>
                  <button type="button" class="add-images-btn">Add Images</button>
                </div>

                <!-- Paste Area -->
                <div class="upload-method-content" id="paste-method" style="display: none;">
                  <div class="paste-area" id="paste-area">
                    <div class="paste-prompt">
                      <div class="paste-icon">📋</div>
                      <p>Paste images from clipboard (Ctrl+V or Cmd+V)</p>
                      <p class="paste-hint">Copy images from any application and paste them here</p>
                    </div>
                  </div>
                </div>
                
                <div class="image-preview" id="image-preview">
                  ${(formValues.images||[]).map(url => `
                    <div class="image-item">
                      <img src="${url}" class="thumb" />
                      <button type="button" class="remove-image" data-url="${url}">×</button>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div class="form-section">
                <h3>Visibility</h3>
                <label>Visibility:<br>
                  <select name="visibility">
                    <option value="private" ${formValues.visibility==='private'?'selected':''}>Private</option>
                    <option value="unlisted" ${formValues.visibility==='unlisted'?'selected':''}>Unlisted</option>
                    <option value="public" ${formValues.visibility==='public'?'selected':''}>Public</option>
                  </select>
                </label><br>
              </div>
            ` : `
              <label>Name:<br><input type="text" name="name" value="${formValues.name||''}" /></label><br>
              <label>Dataset:<br><select name="datasetId" required>${dsOptions}</select></label><br>
              <label>Model Type:<br>
                <select name="modelType" required onchange="updateBaseModel(this.value)">
                  <option value="">Select Model Type</option>
                  <option value="SDXL" ${formValues.modelType==='SDXL'?'selected':''}>SDXL</option>
                  <option value="FLUX" ${formValues.modelType==='FLUX'?'selected':''}>FLUX</option>
                  <option value="WAN" ${formValues.modelType==='WAN'?'selected':''}>WAN</option>
                </select>
              </label><br>
              <input type="hidden" name="baseModel" value="${formValues.baseModel||''}" />
              <div class="form-section">
                <h3>Training Parameters</h3>
                <div class="param-row">
                  <label>Steps:<br><input type="number" name="steps" value="${formValues.steps||''}" min="100" max="5000" /></label>
                  <label>Learning Rate:<br><input type="number" name="learningRate" value="${formValues.learningRate||''}" step="0.0001" min="0.0001" max="0.01" /></label>
                </div>
                <div class="param-row">
                  <label>Batch Size:<br><input type="number" name="batchSize" value="${formValues.batchSize||1}" min="1" max="8" /></label>
                  <label>Resolution:<br><input type="text" name="resolution" value="${formValues.resolution||'1024,1024'}" placeholder="width,height" /></label>
                </div>
              </div>
              <div class="form-section">
                <h3>LoRA Configuration</h3>
                <div class="param-row">
                  <label>LoRA Rank:<br><input type="number" name="loraRank" value="${formValues.loraRank||16}" min="4" max="128" /></label>
                  <label>LoRA Alpha:<br><input type="number" name="loraAlpha" value="${formValues.loraAlpha||32}" min="4" max="256" /></label>
                </div>
                <div class="param-row">
                  <label>LoRA Dropout:<br><input type="number" name="loraDropout" value="${formValues.loraDropout||0.1}" step="0.01" min="0" max="0.5" /></label>
                  <label>Trigger Words:<br><input type="text" name="triggerWords" value="${formValues.triggerWords||''}" placeholder="comma,separated,words" required /></label>
                </div>
              </div>

              <div class="form-section advanced-params">
                <h3>Advanced Parameters</h3>
                <div class="advanced-toggle">
                  <label><input type="checkbox" id="show-advanced" /> Show Advanced Parameters</label>
                </div>
                
                <div class="advanced-content" id="advanced-content" style="display:none;">
                  <div class="param-group">
                    <h4>Validation Settings</h4>
                    <div class="param-row">
                      <label>Validation Steps:<br><input type="number" name="validationSteps" value="${formValues.validationSteps||100}" min="50" max="1000" /></label>
                      <label>Validation Images:<br><input type="number" name="validationImages" value="${formValues.validationImages||4}" min="1" max="20" /></label>
                    </div>
                  </div>
                  
                  <div class="param-group">
                    <h4>Optimization</h4>
                    <div class="param-row">
                      <label>Optimizer:<br>
                        <select name="optimizer">
                          <option value="AdamW8bit" ${formValues.optimizer==='AdamW8bit'?'selected':''}>AdamW8bit</option>
                          <option value="AdamW" ${formValues.optimizer==='AdamW'?'selected':''}>AdamW</option>
                          <option value="SGD" ${formValues.optimizer==='SGD'?'selected':''}>SGD</option>
                        </select>
                      </label>
                      <label>Scheduler:<br>
                        <select name="scheduler">
                          <option value="cosine" ${formValues.scheduler==='cosine'?'selected':''}>Cosine</option>
                          <option value="linear" ${formValues.scheduler==='linear'?'selected':''}>Linear</option>
                          <option value="constant" ${formValues.scheduler==='constant'?'selected':''}>Constant</option>
                        </select>
                      </label>
                    </div>
                    <div class="param-row">
                      <label>Warmup Steps:<br><input type="number" name="warmupSteps" value="${formValues.warmupSteps||100}" min="0" max="1000" /></label>
                      <label>Save Steps:<br><input type="number" name="saveSteps" value="${formValues.saveSteps||500}" min="100" max="5000" /></label>
                    </div>
                  </div>
                  
                  <div class="param-group">
                    <h4>Output Configuration</h4>
                    <div class="param-row">
                      <label>Save Last N Steps:<br><input type="number" name="saveLastNSteps" value="${formValues.saveLastNSteps||3}" min="1" max="10" /></label>
                      <label>Model Name Suffix:<br><input type="text" name="modelSuffix" value="${formValues.modelSuffix||''}" placeholder="optional" /></label>
                    </div>
                  </div>
                </div>
              </div>
              <div class="form-section cost-section">
                <h3>Cost Estimation</h3>
                <div class="cost-display">
                  <div class="cost-item">
                    <span>Estimated Cost:</span>
                    <span class="cost-value" id="estimated-cost">Click Calculate</span>
                  </div>
                  <button type="button" id="calculate-cost-btn">Calculate Cost</button>
                </div>
              </div>

              <div class="form-section marketplace-section">
                <h3>Marketplace Settings</h3>
                <div class="marketplace-options">
                  <label><input type="checkbox" name="enableMarketplace" ${formValues.enableMarketplace?'checked':''} /> Enable marketplace listing</label>
                  <div class="marketplace-details" id="marketplace-details" style="display:none;">
                    <div class="param-row">
                      <label>Price (USD):<br><input type="number" name="priceUSD" value="${formValues.priceUSD||0}" min="0" step="0.01" /></label>
                      <label>License Type:<br>
                        <select name="licenseType">
                          <option value="commercial">Commercial Use</option>
                          <option value="personal">Personal Use Only</option>
                          <option value="creative-commons">Creative Commons</option>
                        </select>
                      </label>
                    </div>
                    <div class="param-row">
                      <label>License Terms:<br><textarea name="licenseTerms" placeholder="Describe usage terms...">${formValues.licenseTerms||''}</textarea></label>
                    </div>
                  </div>
                </div>
              </div>

              <div class="form-section marketplace-section">
                <h3>Model Marketplace</h3>
                <div class="marketplace-options">
                  <label><input type="checkbox" name="publishModel" ${formValues.publishModel?'checked':''} /> Publish trained model to marketplace</label>
                  <div class="publish-details" id="publish-details" style="display:none;">
                    <div class="param-row">
                      <label>Model Price (USD):<br><input type="number" name="modelPriceUSD" value="${formValues.modelPriceUSD||0}" min="0" step="0.01" /></label>
                      <label>Rental Option:<br><input type="checkbox" name="enableRental" ${formValues.enableRental?'checked':''} /> Enable hourly rental</label>
                    </div>
                    <div class="param-row">
                      <label>Rental Price (USD/hour):<br><input type="number" name="rentalPriceUSD" value="${formValues.rentalPriceUSD||0}" min="0" step="0.01" disabled /></label>
                      <label>Rental Duration (hours):<br><input type="number" name="rentalDuration" value="${formValues.rentalDuration||24}" min="1" max="168" disabled /></label>
                    </div>
                  </div>
                </div>
              </div>
              <label>Offering ID:<br><input name="offeringId" value="${formValues.offeringId||''}" /></label><br>
            `}
            ${imageGallery}
            ${addImagesSection}
            <button type="submit" ${submitting||uploading?'disabled':''}>${submitting?'Saving…':uploading?'Uploading…':'Save'}</button>
            <button type="button" class="cancel-btn">Cancel</button>
          </form>`;
      } else {
        const { datasets, trainings, loadingTrain, trainError } = this.state;
        const dsList = loadingTrain ? '<div class="loading-spinner">Loading…</div>' : trainError ? `<div class="error-message">${trainError}</div>` : (
          datasets.length ? `
            <div class="datasets-header">
              <div class="search-filter">
                <input type="text" id="dataset-search" placeholder="Search datasets..." />
                <select id="dataset-filter">
                  <option value="all">All Datasets</option>
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                  <option value="unlisted">Unlisted</option>
                </select>
              </div>
              <div class="batch-actions">
                <button class="btn-secondary" id="select-all">Select All</button>
                <button class="btn-danger" id="delete-selected" disabled>Delete Selected</button>
                <button class="btn-primary" id="export-selected" disabled>Export Selected</button>
              </div>
            </div>
            <div class="datasets-grid">${datasets.map(ds=>{
              const dsId = this.normalizeId(ds._id);
              return `
              <div class="dataset-card" data-id="${dsId}">
                <div class="dataset-header">
                  <input type="checkbox" class="dataset-select" data-id="${dsId}" />
                  <h4>${ds.name||'Unnamed Dataset'}</h4>
                  <span class="visibility-badge visibility-${ds.visibility||'private'}">${ds.visibility||'private'}</span>
                </div>
                <div class="dataset-preview">
                  ${(ds.images||[]).slice(0,4).map(img=>`<img src="${img}" class="preview-thumb" />`).join('')}
                  ${(ds.images||[]).length > 4 ? `<div class="more-count">+${(ds.images||[]).length - 4}</div>` : ''}
                </div>
                <div class="dataset-stats">
                  <div class="stat-item">
                    <span class="label">Images:</span>
                    <span class="value">${(ds.images||[]).length}</span>
                  </div>
                  <div class="stat-item">
                    <span class="label">Used:</span>
                    <span class="value">${ds.usageCount||0} times</span>
                  </div>
                  <div class="stat-item">
                    <span class="label">Size:</span>
                    <span class="value">${this.formatBytes(ds.sizeBytes||0)}</span>
                  </div>
                </div>
                <div class="dataset-actions">
                  <button class="btn-secondary edit-dataset" data-id="${dsId}">Edit</button>
                  <button class="btn-primary use-dataset" data-id="${dsId}">Use for Training</button>
                  <button class="btn-danger delete-dataset" data-id="${dsId}">Delete</button>
                </div>
              </div>`;
            }).join('')}</div>
          ` : '<div class="empty-message">No datasets yet. Create your first dataset to get started!</div>'
        );
        const captionProgressHtml = this.renderCaptionProgressPanel();
        const trList = loadingTrain ? '' : trainError ? '' : (
          trainings.length ? 
          '<div class="trainings-grid">'+trainings.map(tr=>`
            <div class="training-card" data-id="${tr._id}">
              <div class="training-header">
                <h4>${tr.name||'Unnamed Training'}</h4>
                <span class="status-badge status-${tr.status||'draft'}">${tr.status||'draft'}</span>
              </div>
              <div class="training-details">
                <div class="detail-item">
                  <span class="label">Model:</span>
                  <span class="value">${tr.baseModel||'Unknown'}</span>
                </div>
                <div class="detail-item">
                  <span class="label">Progress:</span>
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: ${tr.progress||0}%"></div>
                  </div>
                  <span class="progress-text">${tr.progress||0}%</span>
                </div>
                <div class="detail-item">
                  <span class="label">Cost:</span>
                  <span class="value">${tr.costPoints||0} points</span>
                </div>
              </div>
              <div class="training-actions">
                <button class="btn-secondary view-details" data-id="${tr._id}">View Details</button>
                ${tr.status === 'QUEUED' ? '<button class="btn-danger cancel-training" data-id="${tr._id}">Cancel</button>' : ''}
                ${tr.status === 'FAILED' ? '<button class="btn-primary retry-training" data-id="${tr._id}">Retry</button>' : ''}
                ${tr.status === 'COMPLETED' ? '<button class="btn-success download-model" data-id="${tr._id}">Download</button>' : ''}
              </div>
            </div>
          `).join('')+'</div>' : 
          '<div class="empty-message">No trainings yet. Create your first training to get started!</div>'
        );
        mainContent = `
          <h2>Train Dashboard</h2>
          <div class="train-section">
            <div class="train-section-header"><h3>Datasets</h3><button class="add-dataset-btn">＋</button></div>
            ${dsList}
          </div>
          <div class="train-section">
            <div class="train-section-header"><h3>Captions</h3><button class="add-caption-btn" ${!this.state.selectedDatasetId?'disabled':''}>＋</button></div>
            ${captionProgressHtml}
            ${this.state.loadingCaptions?
              '<div class="loading-spinner">Loading…</div>':
              this.state.captionError?`<div class="error-message">${this.state.captionError}</div>`:
              (!this.state.selectedDatasetId?'<div class="empty-message">Select a dataset above to view caption sets.</div>':
                (this.state.captionSets.length? `<div class="captions-grid">${this.state.captionSets.map(cs=>{
                  const capId = this.normalizeId(cs._id);
                  return `
                  <div class="caption-card" data-id="${capId}">
                    <div class="caption-header"><h4>${cs.method}</h4><span class="caption-count">${cs.captions?.length||0} captions</span></div>
                    <div class="caption-meta"><span>${new Date(cs.createdAt||cs.created||Date.now()).toLocaleString()}</span>${cs.isDefault?'<span class="badge">Default</span>':''}</div>
                    <div class="caption-actions">
                      <button class="btn-secondary view-caption" data-id="${capId}">View</button>
                      <button class="btn-primary download-caption" data-id="${capId}">Download</button>
                      <button class="btn-danger delete-caption" data-id="${capId}">Delete</button>
                      ${cs.isDefault?'':`<button class="btn-primary set-default" data-id="${capId}">Set Default</button>`}
                    </div>
                  </div>`;
                }).join('')}</div>`:'<div class="empty-message">No caption sets found.</div>'))}
          </div>
          <div class="train-section">
            <div class="train-section-header"><h3>Trainings</h3><button class="add-training-btn">＋</button></div>
            ${trList}
          </div>`;
      }
    }

    const tabBarEl = this.modalElement.querySelector('.mods-root-tabs');
    if (tabBarEl) {
      tabBarEl.innerHTML = tabButtons;
    }

    const contentEl = this.modalElement.querySelector('.mods-content');
    if (!contentEl) return;
    const preserveScroll = rootTab === 'train' ? contentEl.scrollTop : null;
    if(rootTab==='browse') {
      contentEl.innerHTML = browseContent;
    } else {
      contentEl.innerHTML = mainContent;
    }
    if (preserveScroll !== null) {
      contentEl.scrollTop = preserveScroll;
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
      // Tag toggle click
      this.modalElement.querySelectorAll('.tag-toggle').forEach(btn=>{
        btn.onclick=()=>{
          const id=btn.getAttribute('data-id');
          const set=this.getExpandedTagSet();
          if(set.has(id)) set.delete(id); else set.add(id);
          this.persistExpandedTagSet();
          this.render();
        };
      });
      // ---------------- Row click opens detail overlay ----------------
      this.modalElement.querySelectorAll('.mods-item').forEach(li => {
        li.onclick = (e) => {
          if (e.target.closest('.fav-btn,.tag-toggle')) return; // ignore clicks on heart or tag toggle
          const idx = parseInt(li.getAttribute('data-idx'), 10);
          const list = this._displayModels || this.state.models;
          const model = list[idx];
          if (model) this.openModelDetail(model);
        };
      });
    }

    // Tab button events
    this.modalElement.querySelectorAll('.root-tab-btn').forEach(btn=>{
      btn.onclick = ()=>{
        const tab = btn.getAttribute('data-tab');
        if(tab!==this.state.rootTab){
          const newView = tab==='train' ? 'trainDash' : 'intro';
          this.setState({ rootTab: tab, view: newView });
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
    // Add Caption button
    const addCapBtn = this.modalElement.querySelector('.add-caption-btn');
    if(addCapBtn){
      addCapBtn.onclick = () => {
        if(!this.state.selectedDatasetId){
          alert('Select a dataset first.');
          return;
        }
        this.generateCaptionSet(this.state.selectedDatasetId);
      };
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
      
      // Add cost calculation button handler
      const calcBtn = this.modalElement.querySelector('#calculate-cost-btn');
      if(calcBtn) {
        calcBtn.onclick = () => this.calculateAndDisplayCost();
      }
      
      // Initialize image upload functionality
      this.initializeImageUpload();
      
      // Add image management handlers
      const addImagesBtn = this.modalElement.querySelector('.add-images-btn');
      if(addImagesBtn) {
        addImagesBtn.onclick = () => this.addImagesFromUrls();
      }
      
      // Remove image handlers
      this.modalElement.querySelectorAll('.remove-image').forEach(btn => {
        btn.onclick = (e) => {
          e.preventDefault();
          const url = btn.getAttribute('data-url');
          this.removeImage(url);
        };
      });
      
      // Caption generation toggle
      const autoCaptionCheckbox = this.modalElement.querySelector('input[name="autoGenerateCaptions"]');
      const manualCaptionCheckbox = this.modalElement.querySelector('input[name="manualCaptions"]');
      const captionMethodDiv = this.modalElement.querySelector('#caption-method');
      
      if(autoCaptionCheckbox && manualCaptionCheckbox && captionMethodDiv) {
        const toggleCaptionMethod = () => {
          if(autoCaptionCheckbox.checked) {
            captionMethodDiv.style.display = 'block';
            manualCaptionCheckbox.checked = false;
          } else if(manualCaptionCheckbox.checked) {
            captionMethodDiv.style.display = 'none';
            autoCaptionCheckbox.checked = false;
          } else {
            captionMethodDiv.style.display = 'none';
          }
        };
        
        autoCaptionCheckbox.onchange = toggleCaptionMethod;
        manualCaptionCheckbox.onchange = toggleCaptionMethod;
      }

      // Advanced parameters toggle
      const advancedToggle = this.modalElement.querySelector('#show-advanced');
      const advancedContent = this.modalElement.querySelector('#advanced-content');
      if(advancedToggle && advancedContent) {
        advancedToggle.onchange = () => {
          advancedContent.style.display = advancedToggle.checked ? 'block' : 'none';
        };
      }

      // Marketplace toggles
      const marketplaceToggle = this.modalElement.querySelector('input[name="enableMarketplace"]');
      const marketplaceDetails = this.modalElement.querySelector('#marketplace-details');
      if(marketplaceToggle && marketplaceDetails) {
        marketplaceToggle.onchange = () => {
          marketplaceDetails.style.display = marketplaceToggle.checked ? 'block' : 'none';
        };
      }

      const publishToggle = this.modalElement.querySelector('input[name="publishModel"]');
      const publishDetails = this.modalElement.querySelector('#publish-details');
      if(publishToggle && publishDetails) {
        publishToggle.onchange = () => {
          publishDetails.style.display = publishToggle.checked ? 'block' : 'none';
        };
      }

      // Rental option toggle
      const rentalToggle = this.modalElement.querySelector('input[name="enableRental"]');
      const rentalFields = this.modalElement.querySelectorAll('input[name="rentalPriceUSD"], input[name="rentalDuration"]');
      if(rentalToggle && rentalFields.length > 0) {
        rentalToggle.onchange = () => {
          rentalFields.forEach(field => field.disabled = !rentalToggle.checked);
        };
      }
    }

    // Batch operation handlers
    const selectAllBtn = this.modalElement.querySelector('#select-all');
    if(selectAllBtn) {
      selectAllBtn.onclick = () => this.selectAllItems('dataset');
    }

    const deleteSelectedBtn = this.modalElement.querySelector('#delete-selected');
    if(deleteSelectedBtn) {
      deleteSelectedBtn.onclick = () => this.batchDelete('dataset');
    }

    const exportSelectedBtn = this.modalElement.querySelector('#export-selected');
    if(exportSelectedBtn) {
      exportSelectedBtn.onclick = () => this.batchExport('dataset');
    }

    // Dataset search and filter
    const searchInput = this.modalElement.querySelector('#dataset-search');
    if(searchInput) {
      searchInput.oninput = () => this.filterDatasets();
    }

    const filterSelect = this.modalElement.querySelector('#dataset-filter');
    if(filterSelect) {
      filterSelect.onchange = () => this.filterDatasets();
    }

    // Dataset card actions
    this.modalElement.querySelectorAll('.dataset-card').forEach(card => {
      const datasetId = card.getAttribute('data-id');
      
      // Edit dataset
      const editBtn = card.querySelector('.edit-dataset');
      if(editBtn) {
        editBtn.onclick = (e) => {
          e.stopPropagation();
          const dataset = this.getDatasetById(datasetId);
          if(dataset) this.openDatasetForm(dataset);
        };
      }

      // Use for training
      const useBtn = card.querySelector('.use-dataset');
      if(useBtn) {
        useBtn.onclick = (e) => {
          e.stopPropagation();
          this.openTrainingForm({ datasetId });
        };
      }

      // Delete dataset
      const deleteBtn = card.querySelector('.delete-dataset');
      if(deleteBtn) {
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
          this.deleteDataset(datasetId);
        };
      }

      // Checkbox change
      const checkbox = card.querySelector('.dataset-select');
      if(checkbox) {
        checkbox.onchange = () => this.updateBatchActions();
      }

      // Click anywhere on card to select dataset and load captions
      card.addEventListener('click',(e)=>{
        if(e.target.closest('.dataset-actions, input.dataset-select')) return;
        const id=card.getAttribute('data-id');
        if(id!==this.state.selectedDatasetId){
          this.setState({selectedDatasetId:id, captionSets:[]},()=>{
            // Enable caption button
            const btn=this.modalElement.querySelector('.add-caption-btn');
            if(btn) btn.removeAttribute('disabled');
          });
          this.fetchCaptionSets(id);
        }
      });
    });

    // Click row to edit
    this.modalElement.querySelectorAll('.ds-item').forEach((li,idx)=>{
      li.onclick=()=>{ const ds=this.state.datasets[idx]; this.openDatasetForm(ds); };
    });
    
    // Training card actions
    this.modalElement.querySelectorAll('.training-card').forEach((card)=>{
      const trainingId = card.getAttribute('data-id');
      const training = this.state.trainings.find(t => t._id === trainingId);
      
      // View details
      const viewBtn = card.querySelector('.view-details');
      if (viewBtn) {
        viewBtn.onclick = (e) => {
          e.stopPropagation();
          this.openTrainingForm(training);
        };
      }
      
      // Cancel training
      const cancelBtn = card.querySelector('.cancel-training');
      if (cancelBtn) {
        cancelBtn.onclick = (e) => {
          e.stopPropagation();
          this.cancelTraining(trainingId);
        };
      }
      
      // Retry training
      const retryBtn = card.querySelector('.retry-training');
      if (retryBtn) {
        retryBtn.onclick = (e) => {
          e.stopPropagation();
          this.retryTraining(trainingId);
        };
      }
      
      // Download model
      const downloadBtn = card.querySelector('.download-model');
      if (downloadBtn) {
        downloadBtn.onclick = (e) => {
          e.stopPropagation();
          this.downloadModel(trainingId);
        };
      }
    });

    // Caption card actions
    this.modalElement.querySelectorAll('.view-caption').forEach(btn=>{
      btn.onclick=(e)=>{
        e.stopPropagation();
        const set=this.getCaptionSetById(btn.getAttribute('data-id'));
        if(set) this.openCaptionViewer(set);
      };
    });
    this.modalElement.querySelectorAll('.download-caption').forEach(btn=>{
      btn.onclick=(e)=>{
        e.stopPropagation();
        const set=this.getCaptionSetById(btn.getAttribute('data-id'));
        if(set) this.downloadCaptionSet(set);
      };
    });
    this.modalElement.querySelectorAll('.delete-caption').forEach(btn=>{
      btn.onclick=(e)=>{
        e.stopPropagation();
        const id=btn.getAttribute('data-id');
        const normalized=this.normalizeId(id);
        this.deleteCaptionSet(normalized);
      };
    });
    this.modalElement.querySelectorAll('.set-default').forEach(btn=>{
      btn.onclick=(e)=>{
        e.stopPropagation();
        const id=btn.getAttribute('data-id');
        this.setDefaultCaptionSet(this.normalizeId(id));
      };
    });
    this.modalElement.querySelectorAll('.cancel-caption-task').forEach(btn=>{
      btn.onclick=(e)=>{
        e.preventDefault();
        e.stopPropagation();
        const datasetId = btn.getAttribute('data-id');
        this.cancelCaptionTask(datasetId);
      };
    });

    // Import button
    const impBtn = this.modalElement.querySelector('.import-btn');
    if (impBtn) {
      impBtn.onclick = () => this.openImportDialog(currentCategory);
    }
  }

  attachCloseEvents() {
    if (!this.modalElement) return;
    this.modalElement.addEventListener('click', (e) => {
      if (e.target === this.modalElement || e.target.closest('.close-btn')) {
        e.preventDefault();
        this.hide();
      }
    });
    document.addEventListener('keydown', this.handleKeyDown);
  }

  resetForm(){ this.setState({formMode:null,formValues:{},originalFormValues:null,formError:null,submitting:false,newImageUrls:[]}); }

  openDatasetForm(ds=null){
    if(ds){ this.setState({formMode:'edit-dataset',formValues:{...ds},originalFormValues:JSON.parse(JSON.stringify(ds))}); }
    else { this.setState({formMode:'new-dataset',formValues:{name:'',description:'',images:[]},originalFormValues:null});} }

  openTrainingForm(tr=null){
    if(tr){ this.setState({formMode:'edit-training',formValues:{...tr}}); }
    else { 
      const firstDs=this.state.datasets[0]; 
      this.setState({
        formMode:'new-training',
        formValues:{
          name:'',
          datasetId:firstDs?firstDs._id:'',
          modelType:'SDXL',
          baseModel:'SDXL',
          offeringId:'',
          steps:1000,
          learningRate:0.0004,
          batchSize:1,
          resolution:'1024,1024',
          loraRank:16,
          loraAlpha:32,
          loraDropout:0.1,
          triggerWords:''
        }
      });
    } 
  }

  addImageUrls(urls){
    const clean=urls.split(/\s|,/).map(u=>u.trim()).filter(Boolean);
    this.setState({newImageUrls:[...this.state.newImageUrls,...clean]});
  }

  initializeImageUpload() {
    const fileUploadArea = this.modalElement.querySelector('#file-upload-area');
    const fileInput = this.modalElement.querySelector('#file-input');
    const fileSelectBtn = this.modalElement.querySelector('.file-select-btn');
    const pasteArea = this.modalElement.querySelector('#paste-area');
    const uploadTabs = this.modalElement.querySelectorAll('.upload-tab-btn');

    if (!fileUploadArea || !fileInput || !fileSelectBtn || !pasteArea || !uploadTabs.length) {
      return; // Not in dataset form mode
    }

    // File selection
    fileSelectBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => this.handleFileSelect(e.target.files));

    // Drag and drop
    fileUploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      fileUploadArea.classList.add('drag-over');
    });

    fileUploadArea.addEventListener('dragleave', (e) => {
      e.preventDefault();
      fileUploadArea.classList.remove('drag-over');
    });

    fileUploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      fileUploadArea.classList.remove('drag-over');
      this.handleFileSelect(e.dataTransfer.files);
    });

    // Paste functionality
    pasteArea.addEventListener('paste', (e) => this.handlePaste(e));

    // Tab switching
    uploadTabs.forEach(tab => {
      tab.addEventListener('click', () => this.switchUploadMethod(tab.dataset.method));
    });
  }

  async handleFileSelect(files) {
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
      this.setState({ formError: 'Please select valid image files' });
      return;
    }

    // Validate file sizes
    const oversizedFiles = imageFiles.filter(file => file.size > 10 * 1024 * 1024); // 10MB
    if (oversizedFiles.length > 0) {
      this.setState({ formError: `Some files are too large (max 10MB each): ${oversizedFiles.map(f => f.name).join(', ')}` });
      return;
    }

    this.setState({ uploading: true, formError: null });
    this.updateUploadProgress(0, imageFiles.length);
    
    try {
      const uploadedUrls = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        const url = await this.uploadImage(file);
        uploadedUrls.push(url);
        this.updateUploadProgress(i + 1, imageFiles.length);
      }
      
      // Add to existing images
      const currentImages = this.state.formValues.images || [];
      this.setState({
        formValues: {
          ...this.state.formValues,
          images: [...currentImages, ...uploadedUrls]
        },
        uploading: false,
        newImageUrls: [...this.state.newImageUrls, ...uploadedUrls]
      });
      
      this.render(); // Re-render to show new images
    } catch (error) {
      this.setState({ 
        uploading: false, 
        formError: `Upload failed: ${error.message}` 
      });
    }
  }

  async uploadImage(file) {
    try {
      const token = window.auth?.ensureCsrfToken ? await window.auth.ensureCsrfToken() : this.getCsrfToken();
      const res = await fetch('/api/v1/storage/uploads/sign', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token
        },
        body: JSON.stringify({ 
          fileName: file.name, 
          contentType: file.type,
          bucketName: 'datasets' // Use datasets bucket for dataset images
        })
      });
      
      if (!res.ok) throw new Error('Failed to get signed URL');
      const { signedUrl, permanentUrl } = await res.json();
      
      const raw = await file.arrayBuffer();
      const put = await fetch(signedUrl, { method: 'PUT', body: raw });
      if (!put.ok) throw new Error('Upload failed');
      
      return permanentUrl;
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    }
  }

  handlePaste(e) {
    const items = e.clipboardData.items;
    const imageFiles = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      this.handleFileSelect(imageFiles);
    }
  }

  switchUploadMethod(method) {
    // Update tab states
    this.modalElement.querySelectorAll('.upload-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.method === method);
    });

    // Show/hide content areas
    this.modalElement.querySelectorAll('.upload-method-content').forEach(content => {
      content.style.display = content.id === `${method}-method` ? 'block' : 'none';
    });
  }

  updateUploadProgress(loaded, total) {
    const progressFill = this.modalElement.querySelector('#progress-fill');
    const progressText = this.modalElement.querySelector('#progress-text');
    const progressContainer = this.modalElement.querySelector('#upload-progress');
    
    if (total > 0) {
      const percentage = (loaded / total) * 100;
      if (progressFill) progressFill.style.width = `${percentage}%`;
      if (progressText) progressText.textContent = `Uploading... ${loaded}/${total} (${Math.round(percentage)}%)`;
      if (progressContainer) progressContainer.style.display = 'block';
    } else {
      if (progressContainer) progressContainer.style.display = 'none';
    }
  }

  getCsrfToken() {
    return document.cookie.split('; ').find(c => c.startsWith('csrfToken='))?.split('=')[1] || '';
  }

  addImagesFromUrls() {
    const textarea = this.modalElement.querySelector('textarea[name="imageUrls"]');
    if (textarea && textarea.value.trim()) {
      const urls = textarea.value.split(/\n|,/).map(url => url.trim()).filter(Boolean);
      const currentImages = this.state.formValues.images || [];
      this.setState({
        formValues: {
          ...this.state.formValues,
          images: [...currentImages, ...urls]
        }
      });
      textarea.value = '';
      this.render();
    }
  }

  removeImage(url) {
    const currentImages = this.state.formValues.images || [];
    this.setState({
      formValues: {
        ...this.state.formValues,
        images: currentImages.filter(img => img !== url)
      }
    });
    this.render();
  }

  async cancelTraining(trainingId) {
    try {
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();
      
      await fetch(`/api/v1/trainings/${trainingId}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        }
      });
      
      this.fetchTrainings(); // Refresh the list
    } catch (error) {
      console.error('Failed to cancel training:', error);
      this.setState({ formError: 'Failed to cancel training' });
    }
  }

  async retryTraining(trainingId) {
    try {
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();
      
      await fetch(`/api/v1/trainings/${trainingId}/retry`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        }
      });
      
      this.fetchTrainings(); // Refresh the list
    } catch (error) {
      console.error('Failed to retry training:', error);
      this.setState({ formError: 'Failed to retry training' });
    }
  }

  async downloadModel(trainingId) {
    try {
      const response = await fetch(`/api/v1/trainings/${trainingId}/download`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `training-${trainingId}.safetensors`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        throw new Error('Download failed');
      }
    } catch (error) {
      console.error('Failed to download model:', error);
      this.setState({ formError: 'Failed to download model' });
    }
  }

  // Update baseModel when modelType changes
  updateBaseModel(modelType) {
    this.state.formValues.modelType = modelType;
    this.state.formValues.baseModel = modelType;
    
    // Update default values based on model type
    const defaults = this.getModelDefaults(modelType);
    Object.assign(this.state.formValues, defaults);
    
    this.render(); // Re-render to show updated values
  }

  // Get default values for each model type
  getModelDefaults(modelType) {
    switch(modelType) {
      case 'SDXL':
        return {
          steps: 1000,
          learningRate: 0.0004,
          loraRank: 16,
          loraAlpha: 32,
          loraDropout: 0.1
        };
      case 'FLUX':
        return {
          steps: 2000,
          learningRate: 0.0002,
          loraRank: 32,
          loraAlpha: 64,
          loraDropout: 0.1
        };
      case 'WAN':
        return {
          steps: 1500,
          learningRate: 0.0003,
          loraRank: 24,
          loraAlpha: 48,
          loraDropout: 0.1
        };
      default:
        return {};
    }
  }

  // Format bytes to human readable format
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  normalizeId(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value.$oid) return value.$oid;
    if (typeof value.toString === 'function') return value.toString();
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  getDatasetById(datasetId) {
    const target = this.normalizeId(datasetId);
    return this.state.datasets.find(ds => this.normalizeId(ds._id) === target) || null;
  }

  getCaptionSetById(captionSetId) {
    const target = this.normalizeId(captionSetId);
    return this.state.captionSets.find(cs => this.normalizeId(cs._id) === target) || null;
  }

  hydrateCaptionTasksFromDatasets(datasets = []) {
    const tasks = { ...this.state.captionTasks };
    const now = Date.now();
    datasets.forEach(ds => {
      const dsId = this.normalizeId(ds?._id);
      if (!dsId) return;
      const task = ds.captionTask;
      if (task && task.status === 'running') {
        const completedMap = {};
        (task.captions || []).forEach((caption, idx) => {
          if (caption) completedMap[idx] = true;
        });
        tasks[dsId] = {
          datasetId: dsId,
          datasetName: ds.name || 'Dataset',
          method: task.spellSlug || task.method || 'captioner',
          total: (ds.images || []).length || (task.castMap || []).length || (task.captions || []).length || 0,
          completedMap,
          completedCount: Object.keys(completedMap).length,
          status: 'running',
          updatedAt: now,
        };
      } else if (tasks[dsId] && tasks[dsId].status === 'running') {
        delete tasks[dsId];
      }
    });
    return tasks;
  }

  setCaptionTask(datasetId, task) {
    const id = this.normalizeId(datasetId);
    if (!id) return;
    const next = { ...this.state.captionTasks };
    if (task) next[id] = task;
    else delete next[id];
    this.setState({ captionTasks: next });
  }

  scheduleCaptionTaskCleanup(datasetId, delay = 8000) {
    const id = this.normalizeId(datasetId);
    if (!id) return;
    if (this._captionTaskCleanupTimers[id]) {
      clearTimeout(this._captionTaskCleanupTimers[id]);
    }
    this._captionTaskCleanupTimers[id] = setTimeout(() => {
      delete this._captionTaskCleanupTimers[id];
      const task = this.state.captionTasks[id];
      if (task && task.status !== 'running') {
        this.setCaptionTask(id, null);
      }
    }, delay);
  }

  markCaptionTaskStarting(datasetId, method) {
    const id = this.normalizeId(datasetId);
    if (!id) return;
    const dataset = this.getDatasetById(id);
    const total = (dataset?.images || []).length;
    const task = {
      datasetId: id,
      datasetName: dataset?.name || 'Dataset',
      method: method || 'captioner',
      total,
      completedMap: {},
      completedCount: 0,
      status: 'running',
      updatedAt: Date.now(),
    };
    this.setCaptionTask(id, task);
  }

  handleCaptionTaskEvent(data = {}) {
    const id = this.normalizeId(data.datasetId);
    if (!id) return;
    const dataset = this.getDatasetById(id);
    const prev = this.state.captionTasks[id] || {};
    const statusRaw = (data.status || '').toLowerCase();
    let completedMap = statusRaw === 'started' ? {} : { ...(prev.completedMap || {}) };
    if (Number.isInteger(data.imageIndex)) {
      completedMap[data.imageIndex] = true;
    }
    if (Array.isArray(data.completedIndices)) {
      data.completedIndices.forEach(idx => {
        if (Number.isInteger(idx)) completedMap[idx] = true;
      });
    }
    const castMapLength = Array.isArray(data.castMap)
      ? data.castMap.length
      : (data.castMap && typeof data.castMap === 'object' ? Object.keys(data.castMap).length : 0);
    const total = castMapLength || data.totalImages || prev.total || (dataset?.images || []).length || 0;
    let status = statusRaw || prev.status || 'running';
    if (status === 'started') status = 'running';
    let completedCount = Object.keys(completedMap).length;
    if (status === 'completed' && total) {
      completedCount = total;
    }
    const task = {
      datasetId: id,
      datasetName: dataset?.name || prev.datasetName || 'Dataset',
      method: data.spellSlug || prev.method || dataset?.captionTask?.spellSlug || 'captioner',
      total,
      completedMap,
      completedCount,
      status,
      updatedAt: Date.now(),
    };
    if (status !== 'running') {
      task.completedAt = Date.now();
    }
    this.setCaptionTask(id, task);
    if (status !== 'running') {
      this.scheduleCaptionTaskCleanup(id);
    }
  }

  renderCaptionProgressPanel() {
    const selectedId = this.normalizeId(this.state.selectedDatasetId);
    const entries = Object.values(this.state.captionTasks || {}).filter(task => {
      if (!task) return false;
      if (task.status === 'running') return true;
      return task.datasetId === selectedId;
    });
    if (!entries.length) return '';
    const ordered = entries.sort((a, b) => {
      if (a.datasetId === selectedId && b.datasetId !== selectedId) return -1;
      if (b.datasetId === selectedId && a.datasetId !== selectedId) return 1;
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (b.status === 'running' && a.status !== 'running') return 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return `<div class="caption-progress-panel">${ordered.map(task => this.renderCaptionProgressCard(task, selectedId)).join('')}</div>`;
  }

  renderCaptionProgressCard(task, selectedId) {
    if (!task) return '';
    const percent = task.total ? Math.min(100, Math.round((Math.min(task.completedCount, task.total) / task.total) * 100)) : (task.status === 'completed' ? 100 : 0);
    const statusLabel = task.status === 'completed'
      ? 'Completed'
      : task.status === 'failed'
        ? 'Failed'
        : 'Captioning…';
    const secondary = task.status === 'running' && task.total
      ? `${task.completedCount}/${task.total} images`
      : `${task.completedCount} images`;
    const highlightClass = selectedId && task.datasetId === selectedId ? ' selected-dataset' : '';
    const actions = task.status === 'running'
      ? `<button class="btn-danger cancel-caption-task" data-id="${task.datasetId}">Cancel</button>`
      : '';
    return `
      <div class="caption-progress-card status-${task.status}${highlightClass}">
        <div class="caption-progress-top">
          <div>
            <div class="caption-progress-title">${this.escapeHtml(task.datasetName || 'Dataset')}</div>
            <div class="caption-progress-method">${this.escapeHtml(task.method || '')}</div>
          </div>
          <span class="caption-progress-status">${statusLabel}</span>
        </div>
        <div class="caption-progress-bar">
          <div class="caption-progress-fill" style="width:${percent}%;"></div>
        </div>
        <div class="caption-progress-footer">
          <div class="caption-progress-text">${secondary}</div>
          ${actions}
        </div>
      </div>`;
  }

  // Batch operation methods
  selectAllItems(type) {
    const checkboxes = this.modalElement.querySelectorAll(`.${type}-select`);
    checkboxes.forEach(cb => cb.checked = true);
    this.updateBatchActions();
  }

  updateBatchActions() {
    const selectedDatasets = this.modalElement.querySelectorAll('.dataset-select:checked');
    const selectedTrainings = this.modalElement.querySelectorAll('.training-select:checked');
    
    const deleteBtn = this.modalElement.querySelector('#delete-selected');
    const exportBtn = this.modalElement.querySelector('#export-selected');
    
    if (selectedDatasets.length > 0 || selectedTrainings.length > 0) {
      deleteBtn.disabled = false;
      exportBtn.disabled = false;
    } else {
      deleteBtn.disabled = true;
      exportBtn.disabled = true;
    }
  }

  async batchDelete(type) {
    const selected = this.modalElement.querySelectorAll(`.${type}-select:checked`);
    const ids = Array.from(selected).map(cb => cb.dataset.id);
    
    if (ids.length === 0) return;
    
    const confirmed = confirm(`Delete ${ids.length} ${type}? This action cannot be undone.`);
    if (!confirmed) return;
    
    try {
      const response = await fetch(`/api/v1/${type}/batch-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      
      if (response.ok) {
        this.fetchDatasets();
        this.fetchTrainings();
      }
    } catch (error) {
      console.error('Batch delete failed:', error);
    }
  }

  // Analytics dashboard
  renderAnalyticsDashboard() {
    const analytics = this.state.analytics || {
      totalCost: 0,
      costChange: 0,
      successRate: 0,
      successChange: 0,
      avgTrainingTime: '0h 0m',
      timeChange: 0,
      modelsCreated: 0,
      modelsChange: 0
    };

    return `
      <div class="analytics-dashboard">
        <div class="analytics-header">
          <h3>Training Analytics</h3>
          <div class="date-range">
            <input type="date" id="start-date" />
            <input type="date" id="end-date" />
            <button id="update-analytics">Update</button>
          </div>
        </div>
        
        <div class="analytics-grid">
          <div class="analytics-card">
            <h4>Total Cost</h4>
            <div class="metric-value">${analytics.totalCost} points</div>
            <div class="metric-change ${analytics.costChange >= 0 ? 'positive' : 'negative'}">
              ${analytics.costChange >= 0 ? '+' : ''}${analytics.costChange}%
            </div>
          </div>
          
          <div class="analytics-card">
            <h4>Training Success Rate</h4>
            <div class="metric-value">${analytics.successRate}%</div>
            <div class="metric-change ${analytics.successChange >= 0 ? 'positive' : 'negative'}">
              ${analytics.successChange >= 0 ? '+' : ''}${analytics.successChange}%
            </div>
          </div>
          
          <div class="analytics-card">
            <h4>Average Training Time</h4>
            <div class="metric-value">${analytics.avgTrainingTime}</div>
            <div class="metric-change ${analytics.timeChange >= 0 ? 'positive' : 'negative'}">
              ${analytics.timeChange >= 0 ? '+' : ''}${analytics.timeChange}%
            </div>
          </div>
          
          <div class="analytics-card">
            <h4>Models Created</h4>
            <div class="metric-value">${analytics.modelsCreated}</div>
            <div class="metric-change ${analytics.modelsChange >= 0 ? 'positive' : 'negative'}">
              ${analytics.modelsChange >= 0 ? '+' : ''}${analytics.modelsChange}%
            </div>
          </div>
        </div>
        
        <div class="analytics-charts">
          <div class="chart-container">
            <h4>Cost Over Time</h4>
            <canvas id="cost-chart"></canvas>
          </div>
          <div class="chart-container">
            <h4>Training Status Distribution</h4>
            <canvas id="status-chart"></canvas>
          </div>
        </div>
      </div>
    `;
  }

  // Filter datasets based on search and visibility
  filterDatasets() {
    const searchTerm = this.modalElement.querySelector('#dataset-search')?.value.toLowerCase() || '';
    const visibilityFilter = this.modalElement.querySelector('#dataset-filter')?.value || 'all';
    
    const filteredDatasets = this.state.datasets.filter(dataset => {
      const matchesSearch = !searchTerm || 
        (dataset.name && dataset.name.toLowerCase().includes(searchTerm)) ||
        (dataset.description && dataset.description.toLowerCase().includes(searchTerm));
      
      const matchesVisibility = visibilityFilter === 'all' || 
        (dataset.visibility || 'private') === visibilityFilter;
      
      return matchesSearch && matchesVisibility;
    });
    
    // Update the display
    const grid = this.modalElement.querySelector('.datasets-grid');
    if(grid) {
      grid.innerHTML = filteredDatasets.map(ds=>{
        const dsId = this.normalizeId(ds._id);
        return `
        <div class="dataset-card" data-id="${dsId}">
          <div class="dataset-header">
            <input type="checkbox" class="dataset-select" data-id="${dsId}" />
            <h4>${ds.name||'Unnamed Dataset'}</h4>
            <span class="visibility-badge visibility-${ds.visibility||'private'}">${ds.visibility||'private'}</span>
          </div>
          <div class="dataset-preview">
            ${(ds.images||[]).slice(0,4).map(img=>`<img src="${img}" class="preview-thumb" />`).join('')}
            ${(ds.images||[]).length > 4 ? `<div class="more-count">+${(ds.images||[]).length - 4}</div>` : ''}
          </div>
          <div class="dataset-stats">
            <div class="stat-item">
              <span class="label">Images:</span>
              <span class="value">${(ds.images||[]).length}</span>
            </div>
            <div class="stat-item">
              <span class="label">Used:</span>
              <span class="value">${ds.usageCount||0} times</span>
            </div>
            <div class="stat-item">
              <span class="label">Size:</span>
              <span class="value">${this.formatBytes(ds.sizeBytes||0)}</span>
            </div>
          </div>
          <div class="dataset-actions">
            <button class="btn-secondary edit-dataset" data-id="${dsId}">Edit</button>
            <button class="btn-primary use-dataset" data-id="${dsId}">Use for Training</button>
            <button class="btn-danger delete-dataset" data-id="${dsId}">Delete</button>
          </div>
        </div>`;
      }).join('');
    }
  }

  // Batch export functionality
  async batchExport(type) {
    const selected = this.modalElement.querySelectorAll(`.${type}-select:checked`);
    const ids = Array.from(selected).map(cb => cb.dataset.id);
    
    if (ids.length === 0) return;
    
    try {
      const response = await fetch(`/api/v1/${type}/batch-export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${type}-export-${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Batch export failed:', error);
    }
  }

  // Delete single dataset
  async deleteDataset(datasetId) {
    const confirmed = confirm('Delete this dataset? This action cannot be undone.');
    if (!confirmed) return;
    
    try {
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();
      
      await fetch(`/api/v1/datasets/${datasetId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        }
      });
      
      this.fetchDatasets();
    } catch (error) {
      console.error('Failed to delete dataset:', error);
      this.setState({ formError: 'Failed to delete dataset' });
    }
  }

  // Calculate training cost based on parameters
  async calculateTrainingCost(formValues) {
    try {
      const response = await fetch('/api/v1/training/calculate-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formValues)
      });
      
      const costData = await response.json();
      this.setState({ 
        estimatedCost: costData.totalCost,
        costBreakdown: costData.breakdown 
      });
      return costData.totalCost;
    } catch (error) {
      console.error('Failed to calculate cost:', error);
      // Fallback to local calculation
      const modelType = formValues.modelType || 'SDXL';
      const steps = parseInt(formValues.steps) || 1000;
      
      const baseCosts = {
        'SDXL': 100,
        'FLUX': 200,
        'WAN': 150
      };
      
      const baseCost = baseCosts[modelType] || 100;
      const stepMultiplier = Math.max(1, steps / 1000);
      
      return Math.round(baseCost * stepMultiplier);
    }
  }

  // Calculate and display cost
  async calculateAndDisplayCost() {
    const cost = await this.calculateTrainingCost(this.state.formValues);
    const costEl = this.modalElement.querySelector('#estimated-cost');
    if(costEl) {
      costEl.textContent = `${cost} points`;
    }
  }

  validateForm(formData, formMode) {
    const errors = [];
    
    if (formMode === 'new-training' || formMode === 'edit-training') {
      if (!formData.modelType) errors.push('Model type is required');
      if (!formData.datasetId) errors.push('Dataset is required');
      if (!formData.triggerWords) errors.push('Trigger words are required');
      if (formData.steps && (formData.steps < 100 || formData.steps > 5000)) {
        errors.push('Steps must be between 100 and 5000');
      }
    }
    
    if (formMode === 'new-dataset' || formMode === 'edit-dataset') {
      if (!formData.name) errors.push('Dataset name is required');
      if (!formData.images || formData.images.length === 0) {
        errors.push('At least one image is required');
      }
    }
    
    return errors;
  }

  // Utility to fetch and cache the current user's masterAccountId
  async getCurrentMasterAccountId() {
    if (this._cachedMasterAccountId) return this._cachedMasterAccountId;
    try {
      const res = await fetch('/api/v1/user/dashboard', { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      const masterAccountId = data.masterAccountId || null;
      if (masterAccountId) this._cachedMasterAccountId = masterAccountId;
      return masterAccountId;
    } catch {
      return null;
    }
  }

  async submitForm(){
    const { formMode, formValues } = this.state;
    this.setState({submitting:true,formError:null});
    
    // Validate form
    const validationErrors = this.validateForm(formValues, formMode);
    if (validationErrors.length > 0) {
      this.setState({ 
        formError: validationErrors.join('. ') + '.', 
        submitting: false 
      });
      return;
    }
    
    // Extra guard: dataset must contain at least one caption set
    if(formMode==='new-training' || formMode==='edit-training'){
      const hasCaptions = await this.hasAnyCaptionSets(formValues.datasetId);
      if(!hasCaptions){
        this.setState({ formError: 'Selected dataset has no caption sets. Please generate captions before training.', submitting:false });
        return;
      }
    }
    
    // Calculate and confirm cost for training
    if (formMode === 'new-training' || formMode === 'edit-training') {
      const cost = await this.calculateTrainingCost(formValues);
      const confirmed = confirm(`Training will cost ${cost} points. Continue?`);
      if (!confirmed) {
        this.setState({ submitting: false });
        return;
      }
    }
    
    try{
      let url='',method='POST',payload=formValues;
      if(formMode==='new-dataset') url='/api/v1/datasets';
      else if(formMode==='edit-dataset'){ url=`/api/v1/datasets/${encodeURIComponent(formValues._id)}`; method='PUT'; }
      else if(formMode==='new-training') url='/api/v1/trainings';
      else if(formMode==='edit-training'){ url=`/api/v1/trainings/${encodeURIComponent(formValues._id)}`; method='PUT'; }

      // Get masterAccountId for dataset operations
      const masterAccountId = await this.getCurrentMasterAccountId();
      if (!masterAccountId) {
        this.setState({ formError: 'You must be logged in to save datasets', submitting: false });
        return;
      }

      // Add masterAccountId to payload for dataset operations
      if (formMode.includes('dataset')) {
        payload.masterAccountId = masterAccountId;
        // Include images in the payload for new dataset creation
        if (formMode === 'new-dataset' && this.state.formValues.images && this.state.formValues.images.length > 0) {
          payload.images = this.state.formValues.images;
        }
      }

      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();

      // For edit-dataset, compute precise changes to avoid empty update payloads
      let res = { ok: true };
      if(formMode==='edit-dataset') {
        const diff = {};
        const orig = this.state.originalFormValues || {};
        for (const [key, val] of Object.entries(formValues)) {
          if (key === 'images') continue; // images handled separately
          if (key === '_id') continue;
          if (JSON.stringify(val) !== JSON.stringify(orig[key])) diff[key] = val;
        }
        // Only send PUT if at least one field changed
        if (Object.keys(diff).length) {
          res = await fetch(url, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify(diff),
          });
          if (!res.ok) throw new Error(`save-failed-${res.status}`);
        }
      } else if (method === 'POST' || (method === 'PUT' && formMode !== 'edit-dataset')) {
        // new-dataset, new-training, edit-training
        res = await fetch(url, {
          method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`save-failed-${res.status}`);
      }

      // If dataset edit and we have new images, send them
      if(formMode==='edit-dataset' && this.state.newImageUrls.length){
        await fetch(`/api/v1/datasets/${encodeURIComponent(formValues._id)}/images`,{
          method:'POST',credentials:'include',headers:{'Content-Type':'application/json','x-csrf-token':csrfToken},
          body:JSON.stringify({imageUrls:this.state.newImageUrls, masterAccountId})
        });
      }

      this.resetForm();
      this.fetchDatasets();
      this.fetchTrainings();
    }catch(err){ this.setState({formError:'Save failed',submitting:false}); }
  }

  /**
   * Opens a small overlay that lets the user enter a remote URL to import a model.
   * @param {string} category – currently selected model category (checkpoint | lora)
   */
  openImportDialog(category) {
    if (this.importDialog) return; // already open

    const overlay = document.createElement('div');
    overlay.className = 'import-overlay';
    overlay.innerHTML = `
      <div class="import-dialog">
        <h3>Import ${category}</h3>
        <label>Remote URL:<br><input type="text" class="import-url-input" placeholder="https://example.com/model" autofocus /></label>
        <div class="error-message" style="display:none"></div>
        <div class="btn-row">
          <button class="confirm-import-btn">Import</button>
          <button class="cancel-import-btn">Cancel</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    this.importDialog = overlay;

    const inputEl = overlay.querySelector('.import-url-input');
    const confirmBtn = overlay.querySelector('.confirm-import-btn');
    const cancelBtn = overlay.querySelector('.cancel-import-btn');
    const errEl = overlay.querySelector('.error-message');

    const cleanup = () => {
      if (!this.importDialog) return;
      document.removeEventListener('keydown', escHandler);
      document.body.removeChild(this.importDialog);
      this.importDialog = null;
    };

    const escHandler = (e) => {
      if (e.key === 'Escape') cleanup();
    };
    document.addEventListener('keydown', escHandler);

    cancelBtn.onclick = cleanup;
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };

    const doImport = async () => {
      const url = inputEl.value.trim();
      if (!url) {
        errEl.textContent = 'Please enter a URL.';
        errEl.style.display = 'block';
        return;
      }
      confirmBtn.disabled = true;
      errEl.style.display = 'none';
      try {
        const csrfRes = await fetch('/api/v1/csrf-token');
        const { csrfToken } = await csrfRes.json();

        const res = await fetch('/api/v1/models/import', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ url, category }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Import failed');
        }

        cleanup();

        // Refresh models list
        if (category === 'lora' && this.state.currentLoraCategory) {
          this.fetchModels('lora', this.state.currentLoraCategory);
        } else {
          this.fetchModels(category);
        }
      } catch (err) {
        errEl.textContent = err.message || 'Import failed.';
        errEl.style.display = 'block';
        confirmBtn.disabled = false;
      }
    };

    confirmBtn.onclick = doImport;
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doImport();
      }
    });
  }

  /* ====================== MODEL DETAIL OVERLAY ====================== */
  /**
   * Opens a rich detail view overlay for the given model.
   * @param {Object} model
   */
  openModelDetail(model) {
    if (this.detailOverlayEl) return; // already open
    this.state.detailModel = model; // keep reference for other helpers
    let imgs = (model.previewImages && model.previewImages.length) ? model.previewImages.slice() : ((model.images&&model.images.length)?model.images.slice():[]);
    if (!imgs.length && model.previewImageUrl) imgs=[model.previewImageUrl];
    let currentIdx = 0;

    const overlay = document.createElement('div');
    overlay.className = 'model-detail-overlay';
    overlay.innerHTML = `
      <div class="model-detail-container" role="dialog" aria-modal="true">
        <div class="detail-header"><h3>${model.name || model.title || 'Model'}</h3><button class="detail-close-btn" aria-label="Close">×</button></div>
        <div class="detail-body">
          <div class="carousel">
            <button class="img-nav prev" ${imgs.length>1?'':'style="display:none"'}>‹</button>
            <img class="carousel-img" src="${imgs[0]||'/assets/placeholder.png'}" loading="lazy" />
            <button class="img-nav next" ${imgs.length>1?'':'style="display:none"'}>›</button>
            <div class="thumb-strip">${imgs.map((u,i)=>`<img src="${u}" data-idx="${i}" class="thumb${i===0?' active':''}" loading="lazy" />`).join('')}</div>
          </div>
          <div class="detail-meta"></div>
        </div>
        <div class="detail-footer">
          <div class="rating-stars" aria-label="Rate model">
            ${[1,2,3].map(n=>`<span class="star" data-val="${n}">☆</span>`).join('')}
          </div>
          <button class="fav-toggle-btn">${this.state.favoriteIds.has(this.getModelIdentifier(model)) ? '❤️ Unfavourite' : '♡ Favourite'}</button>
          <button class="copy-trigger-btn">Copy Trigger Words</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    this.detailOverlayEl = overlay;

    // Populate meta fields
    const metaEl = overlay.querySelector('.detail-meta');
    const addField = (label,val) => {
      if (val==null || val==='') return;
      metaEl.insertAdjacentHTML('beforeend', `<div class="meta-field"><span class="meta-label">${label}:</span> <span class="meta-val">${val}</span></div>`);
    };
    addField('Checkpoint', model.checkpoint);
    addField('Type', model.modelType || model.style);
    addField('Strength', model.strength);
    addField('Version', model.version);
    if (model.defaultWeight!=null) {
      const w = Number(model.defaultWeight).toFixed(2);
      metaEl.insertAdjacentHTML('beforeend', `<div class="meta-field"><span class="meta-label">Default Weight:</span> <input type="range" min="0" max="2" step="0.05" value="${w}" disabled /></div>`);
    }

    if (model.triggerWords && model.triggerWords.length) {
      const words=model.triggerWords.map(t=>`<code class="badge">${t}</code>`).join(' ');
      addField('Trigger Words', words);
    }

    // Tags (respect privacy)
    if (this.isModelAccessible(model) && model.tags && model.tags.length) {
      const tags=model.tags.map(t=>typeof t==='string'?t:t.tag).map(t=>`<span class="badge">${t}</span>`).join(' ');
      addField('Tags', tags);
    }

    // Description
    if (model.description) addField('Description', model.description.replace(/\n/g,'<br>'));

    // Imported from
    if (model.importedFrom && model.importedFrom.source && this.isModelAccessible(model)) {
      const src = model.importedFrom.source;
      const link = `<a href="${src}" target="_blank" rel="noopener">${src}</a>`;
      addField('Imported From', link);
    }

    // Dates & usage
    const toDate=(d)=>{
      if(!d) return '';
      if (typeof d === 'string') return new Date(d).toLocaleString();
      if (d.$date) return new Date(d.$date).toLocaleString();
      return new Date(d).toLocaleString();
    };
    addField('Created', toDate(model.createdAt || model.created || model.created_at));
    addField('Updated', toDate(model.updatedAt || model.updated || model.updated_at));
    if (model.usageCount!=null) addField('Usage', model.usageCount);

    // -------- event bindings --------
    const close = () => this.closeModelDetail();
    overlay.querySelector('.detail-close-btn').onclick = close;
    overlay.onclick = (e)=>{ if(e.target===overlay) close(); };

    const updateImage = ()=>{
      const imgEl = overlay.querySelector('.carousel-img');
      imgEl.src = imgs[currentIdx];
      overlay.querySelectorAll('.thumb').forEach(t=>t.classList.remove('active'));
      const activeThumb = overlay.querySelector(`.thumb[data-idx="${currentIdx}"]`);
      if(activeThumb) activeThumb.classList.add('active');
    };
    overlay.querySelectorAll('.thumb').forEach(thumb=>{
      thumb.onclick = ()=>{ currentIdx=parseInt(thumb.getAttribute('data-idx'),10); updateImage(); };
    });
    overlay.querySelector('.img-nav.prev')?.addEventListener('click', ()=>{ currentIdx=(currentIdx-1+imgs.length)%imgs.length; updateImage(); });
    overlay.querySelector('.img-nav.next')?.addEventListener('click', ()=>{ currentIdx=(currentIdx+1)%imgs.length; updateImage(); });
    // Click main image to advance
    overlay.querySelector('.carousel-img').addEventListener('click', ()=>{ if(imgs.length>1){ currentIdx=(currentIdx+1)%imgs.length; updateImage(); } });

    // Rating stars click
    overlay.querySelectorAll('.rating-stars .star').forEach(star=>{
      star.onclick = async ()=>{
        const val=parseInt(star.getAttribute('data-val'),10);
        renderStars(val);
        await this.rateModel(model,val);
      };
    });
    const renderStars=(n)=>{
      overlay.querySelectorAll('.rating-stars .star').forEach(st=>{ const v=parseInt(st.getAttribute('data-val'),10); st.textContent=v<=n?'★':'☆'; });
    };

    overlay.querySelector('.fav-toggle-btn').onclick = ()=>{ this.toggleFavorite(model, this.state.currentCategory||'checkpoint'); overlay.querySelector('.fav-toggle-btn').textContent = this.state.favoriteIds.has(this.getModelIdentifier(model))? '♡ Favourite':'❤️ Unfavourite'; };
    overlay.querySelector('.copy-trigger-btn').onclick = ()=>{
      if (model.triggerWords && model.triggerWords.length) navigator.clipboard.writeText(model.triggerWords.join(' '));
    };

    this._detailKeyHandler = (e)=>{
      if(e.key==='Escape') close();
      else if(e.key==='ArrowRight' && imgs.length>1){ currentIdx=(currentIdx+1)%imgs.length; updateImage(); }
      else if(e.key==='ArrowLeft' && imgs.length>1){ currentIdx=(currentIdx-1+imgs.length)%imgs.length; updateImage(); }
    };
    document.addEventListener('keydown', this._detailKeyHandler);

    // -------- after render: if no images loaded, fetch detail --------
    if (!imgs.length) {
      this.fetchModelDetail(model).then(detail=>{
        if(!detail) return;
        const newImgs=(detail.previewImages&&detail.previewImages.length)?detail.previewImages:[];
        if(newImgs.length){
          imgs.push(...newImgs);
          // rebuild thumb strip
          const strip=overlay.querySelector('.thumb-strip');
          strip.innerHTML=newImgs.map((u,i)=>`<img src="${u}" data-idx="${i}" class="thumb${i===0?' active':''}" loading="lazy" />`).join('');
          strip.querySelectorAll('.thumb').forEach(thumb=>{ thumb.onclick=()=>{ currentIdx=parseInt(thumb.getAttribute('data-idx'),10); updateImage(); }; });
          overlay.querySelector('.carousel-img').src=newImgs[0];
          overlay.querySelector('.img-nav.prev').style.display=newImgs.length>1?'':'none';
          overlay.querySelector('.img-nav.next').style.display=newImgs.length>1?'':'none';
        }
      });
    }
  }

  /** Fetch full model detail to obtain preview images */
  async fetchModelDetail(model){
    try{
      const id=this.getModelIdentifier(model);
      const category=this.state.currentCategory||'checkpoint';
      const pathCat=category==='lora'?'lora':'checkpoint';
      const url=`/api/v1/models/${pathCat}/${encodeURIComponent(id)}?userId=${window.currentUserId||''}`;
      const res= await fetch(url,{credentials:'include'});
      if(!res.ok) return null;
      const data= await res.json();
      return data.lora||data.model||data;
    }catch(err){ console.warn('[ModsMenuModal] fetchModelDetail error', err); return null; }
  }

  /** Rate a model 1-3 stars via API */
  async rateModel(model, stars){
    try{
      const id = this.getModelIdentifier(model);
      const category = this.state.currentCategory||'checkpoint';
      const pathCat = category==='lora'?'lora':'checkpoint';
      const url = `/api/v1/models/${pathCat}/${encodeURIComponent(id)}/rate`;
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();
      await fetch(url,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','x-csrf-token':csrfToken},body:JSON.stringify({stars})});
    }catch(err){ console.warn('[ModsMenuModal] rateModel error', err); }
  }

  /** Close the model detail overlay */
  closeModelDetail(){
    if(!this.detailOverlayEl) return;
    document.removeEventListener('keydown', this._detailKeyHandler);
    document.body.removeChild(this.detailOverlayEl);
    this.detailOverlayEl=null;
    this.state.detailModel=null;
  }

  // Inside close/reset cleanup ensure listener removed
  close(){
    // ... existing close logic ...
    window.removeEventListener('uploadCompleted', this._uploadListener);
  }

  /* ----------------- CAPTION HELPERS ----------------- */
  async fetchCaptionSets(datasetId){
    if(!datasetId) return;
    this.setState({loadingCaptions:true,captionError:null,captionSets:[]});
    try{
      const res= await fetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/captions`,{credentials:'include'});
      if(!res.ok) throw new Error('Failed');
      const payload= await res.json();
      const list = Array.isArray(payload?.data)
        ? payload.data
        : (payload?.data?.captionSets || payload?.captionSets || []);
      this.setState({captionSets:Array.isArray(list)?list:[],loadingCaptions:false});
    }catch(err){
      console.warn('[ModsMenuModal] fetchCaptionSets error',err);
      this.setState({loadingCaptions:false,captionError:'Could not load caption sets.'});
    }
  }

  async generateCaptionSet(initialDatasetId){
    const overlay=document.createElement('div');
    overlay.className='import-overlay';

    const normalizedInitialId = this.normalizeId(initialDatasetId);
    const dsOptions=this.state.datasets.map(d=>{
      const value=this.normalizeId(d._id);
      return `<option value="${value}" ${value===normalizedInitialId?'selected':''}>${d.name}</option>`;
    }).join('');
    if(!this.state.captionerSpells.length){ await this.fetchCaptionerSpells(); }
    const spellOpts=(this.state.captionerSpells.length?this.state.captionerSpells:[{slug:'',name:'(no captioner spells found)'}]).map(s=>`<option value="${s.slug||s.spellId}">${s.name||s.displayName}</option>`).join('');
    overlay.innerHTML=`<div class="import-dialog"><h3>Generate Captions</h3>
      <label>Dataset:<br><select class="cap-dataset">${dsOptions}</select></label><br>
      <label>Captioner Spell:<br><select class="cap-method">${spellOpts}</select></label><br>
      <label>Trigger Words (optional):<br><input type="text" class="cap-triggers" placeholder="comma,separated" /></label>
      <div class="error-message" style="display:none"></div>
      <div class="btn-row"><button class="confirm-generate-btn">Generate</button><button class="cancel-generate-btn">Cancel</button></div>
    </div>`;
    document.body.appendChild(overlay);

    const errEl=overlay.querySelector('.error-message');
    const cleanup=()=>{document.body.removeChild(overlay);};
    overlay.querySelector('.cancel-generate-btn').onclick=cleanup;
    overlay.onclick=(e)=>{if(e.target===overlay) cleanup();};
    overlay.querySelector('.confirm-generate-btn').onclick=async ()=>{
      const spellSlug=overlay.querySelector('.cap-method').value;
      const triggers=overlay.querySelector('.cap-triggers').value.trim();
      overlay.querySelector('.confirm-generate-btn').disabled=true;
      try{
        const dsId=overlay.querySelector('.cap-dataset').value;
        const csrfRes=await fetch('/api/v1/csrf-token');
        const {csrfToken}=await csrfRes.json();
        const masterAccountId = await this.getCurrentMasterAccountId();
        const res=await fetch(`/api/v1/datasets/${encodeURIComponent(dsId)}/caption-via-spell`,{
          method:'POST',credentials:'include',headers:{'Content-Type':'application/json','x-csrf-token':csrfToken},
          body:JSON.stringify({spellSlug,triggerWords:triggers,masterAccountId})});
        if(!res.ok) throw new Error('Generate failed');
        this.markCaptionTaskStarting(dsId, spellSlug);
        cleanup();
        this.fetchCaptionSets(dsId);
      }catch(err){errEl.textContent=err.message||'Generate failed';errEl.style.display='block';overlay.querySelector('.confirm-generate-btn').disabled=false;}
    };
  }

  normalizeCaptionEntries(captionSet, datasetId = this.state.selectedDatasetId){
    if(!captionSet) return [];
    const dataset = this.getDatasetById(datasetId);
    const datasetImages = dataset?.images || [];
    return (captionSet.captions || []).map((entry, idx) => {
      const normalized = { imageUrl: datasetImages[idx] || '', text: '' };
      if (typeof entry === 'string') {
        normalized.text = entry;
      } else if (entry && typeof entry === 'object') {
        normalized.text = entry.caption || entry.text || entry.description || '';
        normalized.imageUrl = entry.imageUrl || entry.url || normalized.imageUrl;
      }
      return normalized;
    });
  }

  openCaptionViewer(captionSet){
    if(!captionSet) return;
    const entries = this.normalizeCaptionEntries(captionSet);
    const overlay=document.createElement('div');
    overlay.className='import-overlay caption-viewer-overlay';
    const createdAt = new Date(captionSet.createdAt||captionSet.created||Date.now()).toLocaleString();
    overlay.innerHTML=`<div class="import-dialog caption-viewer-dialog">
      <div class="caption-viewer-header">
        <h3>${this.escapeHtml(captionSet.method||'Caption Set')}</h3>
        <button class="caption-viewer-close" aria-label="Close">×</button>
      </div>
      <div class="caption-viewer-meta">
        <span>${entries.length} captions</span>
        <span>${createdAt}</span>
      </div>
      <div class="caption-viewer-list">
        ${entries.length? entries.map((entry,idx)=>`
          <div class="caption-viewer-row">
            ${entry.imageUrl?`<img src="${this.escapeHtml(entry.imageUrl)}" alt="Image ${idx+1}" />`:`<div class="caption-thumb placeholder">#${idx+1}</div>`}
            <div class="caption-text-block">
              <div class="caption-row-title">Image ${idx+1}</div>
              <textarea readonly data-caption-idx="${idx}"></textarea>
            </div>
          </div>
        `).join('') : '<div class="empty-message">No captions available.</div>'}
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const cleanup=()=>{ if(overlay.parentNode){ overlay.parentNode.removeChild(overlay); } };
    overlay.addEventListener('click',(e)=>{ if(e.target===overlay) cleanup(); });
    overlay.querySelector('.caption-viewer-close').onclick=cleanup;
    overlay.querySelectorAll('textarea[data-caption-idx]').forEach(textarea=>{
      const idx=parseInt(textarea.getAttribute('data-caption-idx'),10);
      textarea.value = entries[idx]?.text || '';
    });
  }

  downloadCaptionSet(captionSet){
    if(!captionSet) return;
    const entries = this.normalizeCaptionEntries(captionSet);
    if(!entries.length){
      alert('This caption set has no captions yet.');
      return;
    }
    const header='imageUrl,caption';
    const rows=entries.map(entry=>`${this.toCsvValue(entry.imageUrl)},${this.toCsvValue(entry.text)}`);
    const csv=[header,...rows].join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const stamp=(captionSet.method||'captions').replace(/\s+/g,'-').toLowerCase();
    a.href=url;
    a.download=`${stamp}-dataset-captions.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async deleteCaptionSet(captionSetId){
    const datasetId = this.state.selectedDatasetId;
    if(!datasetId || !captionSetId) return;
    if(!confirm('Delete this caption set? This action cannot be undone.')) return;
    try{
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();
      const res = await fetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/captions/${encodeURIComponent(captionSetId)}`,{
        method:'DELETE',
        credentials:'include',
        headers:{'Content-Type':'application/json','x-csrf-token':csrfToken},
        body:JSON.stringify({})
      });
      if(!res.ok) throw new Error('Failed');
      this.fetchCaptionSets(datasetId);
    }catch(err){
      console.error('[ModsMenuModal] deleteCaptionSet error',err);
      this.setState({captionError:'Failed to delete caption set.'});
    }
  }

  async setDefaultCaptionSet(captionSetId){
    const datasetId = this.state.selectedDatasetId;
    if(!datasetId || !captionSetId) return;
    try{
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();
      const res = await fetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/captions/${encodeURIComponent(captionSetId)}/default`,{
        method:'POST',
        credentials:'include',
        headers:{'Content-Type':'application/json','x-csrf-token':csrfToken},
        body:JSON.stringify({})
      });
      if(!res.ok) throw new Error('Failed');
      this.fetchCaptionSets(datasetId);
    }catch(err){
      console.error('[ModsMenuModal] setDefaultCaptionSet error',err);
      this.setState({captionError:'Failed to update default caption set.'});
    }
  }

  async cancelCaptionTask(datasetId){
    const id = this.normalizeId(datasetId || this.state.selectedDatasetId);
    if(!id) return;
    const confirmed = confirm('Cancel caption generation for this dataset?');
    if(!confirmed) return;
    try{
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();
      const res = await fetch(`/api/v1/datasets/${encodeURIComponent(id)}/caption-task/cancel`,{
        method:'POST',
        credentials:'include',
        headers:{'Content-Type':'application/json','x-csrf-token':csrfToken},
        body:JSON.stringify({})
      });
      if(!res.ok) throw new Error('Failed');
      this.handleCaptionTaskEvent({ datasetId:id, status:'cancelled' });
      if (this.normalizeId(this.state.selectedDatasetId) === id) {
        this.fetchCaptionSets(id);
      }
    }catch(err){
      console.error('[ModsMenuModal] cancelCaptionTask error',err);
      alert('Failed to cancel caption task. Please try again.');
    }
  }

  escapeHtml(str=''){
    return String(str)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  toCsvValue(value){
    const str=value==null?'':String(value);
    if(/[",\n]/.test(str)){
      return `"${str.replace(/"/g,'""')}"`;
    }
    return str;
  }

  /**
   * Quick utility to verify that a dataset has at least one caption set.
   * Called synchronously during training form submission to prevent training on uncaptained datasets.
   * @returns {Promise<boolean>}
   */
  async hasAnyCaptionSets(datasetId){
    if(!datasetId) return false;
    try{
      // lightweight – ask for only first item
      const res = await fetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/captions?limit=1`, { credentials:'include' });
      if(!res.ok) return false;
      const payload = await res.json();
      const list = Array.isArray(payload?.data)
        ? payload.data
        : (payload?.data?.captionSets || payload?.captionSets || []);
      return Array.isArray(list) && list.length>0;
    }catch{ return false; }
  }

  /** Fetch spells tagged as captioner for dropdown */
  async fetchCaptionerSpells() {
    try {
      const url = `/api/v1/spells/marketplace?tag=captioner&_=${Date.now()}`;
      const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (res.status === 304) {
        // keep existing list
        if (!this.state.captionerSpells.length) this.setState({ captionerSpells: [] });
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const raw = await res.json();
      const list = Array.isArray(raw) ? raw : (raw.spells || raw.data || []);
      this.setState({ captionerSpells: Array.isArray(list) ? list : [] });
    } catch (err) {
      console.warn('[ModsMenuModal] fetchCaptionerSpells error', err);
      this.setState({ captionerSpells: [] });
    }
  }
}

// Global function for model type selection
window.updateBaseModel = function(modelType) {
  // Find the modal instance and call its method
  const modalEl = document.querySelector('.mods-modal-overlay');
  if (modalEl && modalEl._modsModalInstance) {
    modalEl._modsModalInstance.updateBaseModel(modelType);
  }
}; 
