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
      formMode:null, // 'new-dataset'|'edit-dataset'|'view-dataset'|'new-training'|'edit-training'
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
      embellishmentTasks: {},
      // Wizard state (separate namespace to avoid breaking formMode flows)
      wizardStep: 0,               // 0=dashboard, 1-4=wizard steps
      wizardDatasetId: null,        // selected dataset in step 1
      wizardModelType: null,        // 'SDXL'|'FLUX'|'KONTEXT' from step 2
      wizardTrainingMode: null,     // 'style_subject'|'concept' for KONTEXT
      wizardControlDatasetId: null, // control dataset for concept mode
      wizardCaptionSetId: null,     // selected caption set from step 3
      wizardFormValues: {},         // name, triggerWords, description, advanced params
      wizardCaptionSets: [],        // caption sets for selected dataset
      wizardLoadingCaptions: false,
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
    this._captionSpellCache = {};
    this._crcTable = null;

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

  // Poll for training updates when there are active trainings
  startTrainingPolling() {
    if (this._trainingPollInterval) return; // Already polling
    const ACTIVE_STATUSES = ['QUEUED', 'PROVISIONING', 'RUNNING', 'FINALIZING'];
    this._trainingPollInterval = setInterval(() => {
      // Only poll if we have active trainings and the modal is open on the train tab
      const hasActiveTrainings = this.state.trainings.some(
        t => ACTIVE_STATUSES.includes(t.status)
      );
      if (hasActiveTrainings && this.modalElement && this.state.rootTab === 'train') {
        this.fetchTrainings();
      } else if (!hasActiveTrainings && this._trainingPollInterval) {
        this.stopTrainingPolling();
      }
    }, 10000); // Poll every 10 seconds
  }

  stopTrainingPolling() {
    if (this._trainingPollInterval) {
      clearInterval(this._trainingPollInterval);
      this._trainingPollInterval = null;
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

        // Wizard awareness: refresh wizard caption sets when on step 3
        if (this.state.wizardStep === 3 && normalizedDatasetId === this.normalizeId(this.state.wizardDatasetId)) {
          this.fetchWizardCaptionSets(this.state.wizardDatasetId);
        }

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

      // Embellishment progress updates (unified progress for captions, control images, etc.)
      this.ws.on('embellishmentProgress', (data) => {
        this.handleEmbellishmentProgressEvent(data);
        const { datasetId, status, embellishmentType } = data;
        const normalizedDatasetId = this.normalizeId(datasetId);

        // Wizard awareness: refresh wizard caption sets when on step 3 and this is a caption embellishment
        if (embellishmentType === 'caption' && this.state.wizardStep === 3 && normalizedDatasetId === this.normalizeId(this.state.wizardDatasetId)) {
          this.fetchWizardCaptionSets(this.state.wizardDatasetId);
        }

        // Wizard awareness: refresh wizard control sets when on step 3 (KONTEXT concept mode) and this is a control embellishment
        const isKontextConcept = this.state.wizardModelType === 'KONTEXT' && this.state.wizardTrainingMode === 'concept';
        if (embellishmentType === 'control' && this.state.wizardStep === 3 && isKontextConcept && normalizedDatasetId === this.normalizeId(this.state.wizardDatasetId)) {
          this.fetchWizardControlSets(this.state.wizardDatasetId);
        }

        // Wizard awareness: refresh datasets when control embellishment completes (for general UI updates)
        if (embellishmentType === 'control' && status === 'completed') {
          this.fetchDatasets().then(() => {
            if (this.state.wizardStep === 2 || this.state.wizardStep === 3) {
              this.render();
            }
          });
        }

        // Re-render if viewing the affected dataset
        if (normalizedDatasetId === this.normalizeId(this.state.selectedDatasetId)) {
          if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            // Refresh embellishments list when task completes
            this.fetchCaptionSets(datasetId);
          }
          this.render();
        }
      });

      // Single item regeneration result
      this.ws.on('embellishmentRegenerateResult', (data) => {
        const { datasetId, embellishmentId, itemIndex, success, value, error } = data;
        if (success) {
          console.log(`[ModsMenuModal] Regenerated control image ${itemIndex} successfully`);
          // Refresh the dataset to get updated embellishment results
          this.fetchDatasets().then(() => {
            if (this.normalizeId(datasetId) === this.normalizeId(this.state.selectedDatasetId)) {
              this.render();
            }
          });
        } else {
          console.warn(`[ModsMenuModal] Regenerate failed for item ${itemIndex}:`, error);
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
    if(this.state.rootTab==='train') {
      this.fetchDatasets();
      this.fetchTrainings().then(() => this.startTrainingPolling());
    }
  }

  hide() {
    if (!this.modalElement) return;
    this.stopTrainingPolling();
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
      const { formMode, formValues, formError, submitting, uploading, wizardStep } = this.state;

      // Priority 1: Wizard is active
      if (wizardStep > 0) {
        const stepBar = this.renderWizardStepBar();
        let stepContent = '';
        if (wizardStep === 1) stepContent = this.renderWizardStep1();
        else if (wizardStep === 2) stepContent = this.renderWizardStep2();
        else if (wizardStep === 3) stepContent = this.renderWizardStep3();
        else if (wizardStep === 4) stepContent = this.renderWizardStep4();
        const isFirst = wizardStep === 1;
        const isLast = wizardStep === 4;
        // Show progress panel for running embellishment tasks in wizard
        const progressHtml = this.renderWizardProgressPanel();
        mainContent = `
          <h2>New Training</h2>
          ${stepBar}
          ${progressHtml}
          ${stepContent}
          <div class="wizard-footer">
            <button class="btn-secondary wizard-cancel-btn">Cancel</button>
            <div>
              ${!isFirst ? '<button class="btn-secondary wizard-back-btn">Back</button>' : ''}
              ${isLast
                ? `<button class="btn-primary wizard-submit-btn" ${submitting ? 'disabled' : ''}>${submitting ? 'Starting...' : 'Start Training'}</button>`
                : '<button class="btn-primary wizard-next-btn">Next</button>'}
            </div>
          </div>`;
      }
      // Priority 2: Dataset detail view
      else if (formMode === 'view-dataset') {
        mainContent = this.renderDatasetDetailView();
      }
      // Priority 3: Dataset form (edit/new)
      else if (formMode === 'new-dataset' || formMode === 'edit-dataset') {
        const legend = formMode === 'new-dataset' ? 'New Dataset' : 'Edit Dataset';
        const imageGallery = formMode === 'edit-dataset' ? `<div class="image-gallery">${(formValues.previewImages||[]).map(url=>`<img src="${url}" class="thumb" />`).join('')}</div>` : '';
        const addImagesSection = formMode === 'edit-dataset' ? `
          <label>Add Images (URLs comma or space separated):<br><textarea name="_imgInput"></textarea></label>
          <button type="button" class="add-img-btn">Add Images</button>
          <div class="new-img-preview">${this.state.newImageUrls.map(u=>`<img src="${u}" class="thumb" />`).join('')}</div>` : '';
        mainContent = `<h2>${legend}</h2>
          ${formError ? `<div class="error-message">${formError}</div>` : ''}
          <form class="train-form">
            <div class="form-section">
              <h3>Basic Information</h3>
              <label>Dataset Name:<br><input type="text" name="name" value="${formValues.name||''}" required /></label><br>
              <label>Description:<br><textarea name="description">${formValues.description||''}</textarea></label><br>
              <label>Tags:<br><input type="text" name="tags" value="${formValues.tags||''}" placeholder="comma,separated,tags" /></label><br>
            </div>
            <div class="form-section">
              <h3>Images</h3>
              <div class="upload-methods">
                <button type="button" class="upload-tab-btn active" data-method="upload">Upload Files</button>
                <button type="button" class="upload-tab-btn" data-method="urls">Image URLs</button>
                <button type="button" class="upload-tab-btn" data-method="paste">Paste Images</button>
              </div>
              <div class="upload-method-content" id="upload-method">
                <div class="file-upload-area" id="file-upload-area">
                  <div class="upload-prompt">
                    <div class="upload-icon">📁</div>
                    <p>Drag and drop images here, or <button type="button" class="file-select-btn">click to browse</button></p>
                    <p class="upload-hint">Supports JPG, PNG, WebP, GIF (max 10MB each)</p>
                  </div>
                  <input type="file" id="file-input" multiple accept="image/*" style="display: none;" />
                </div>
                <div class="upload-progress" id="upload-progress" style="display: ${uploading?'block':'none'};">
                  <div class="progress-bar">
                    <div class="progress-fill" id="progress-fill" style="width: 0%;"></div>
                  </div>
                  <div class="progress-text" id="progress-text">Uploading...</div>
                </div>
              </div>
              <div class="upload-method-content" id="urls-method" style="display: none;">
                <label>Add Images (URLs):<br>
                  <textarea name="imageUrls" placeholder="Enter image URLs, one per line or comma-separated"></textarea>
                </label>
                <button type="button" class="add-images-btn">Add Images</button>
              </div>
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
            ${imageGallery}
            ${addImagesSection}
            <button type="submit" ${submitting||uploading?'disabled':''}>${submitting ? 'Saving…' : uploading ? 'Uploading…' : 'Save'}</button>
            <button type="button" class="cancel-btn">Cancel</button>
          </form>`;
      }
      // Priority 3: Edit training form (unchanged)
      else if (formMode === 'edit-training') {
        const dsOptions = this.state.datasets.map(d=>`<option value="${d._id}" ${formValues.datasetId===d._id?'selected':''}>${d.name}</option>`).join('');
        mainContent = `<h2>Edit Training</h2>
          ${formError ? `<div class="error-message">${formError}</div>` : ''}
          <form class="train-form">
            <label>Name:<br><input type="text" name="name" value="${formValues.name||''}" /></label><br>
            <label>Dataset:<br><select name="datasetId" required>${dsOptions}</select></label><br>
            <label>Model Type:<br>
              <select name="modelType" required>
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
            <div class="form-section">
              <h3>Model Card</h3>
              <label>Description (optional):<br>
                <textarea name="description" placeholder="Describe what this LoRA does...">${formValues.description||''}</textarea>
              </label>
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
            <button type="submit" ${submitting?'disabled':''}>${submitting ? 'Saving…' : 'Save'}</button>
            <button type="button" class="cancel-btn">Cancel</button>
          </form>`;
      }
      // Priority 4: Dashboard (default)
      else {
        mainContent = this.renderTrainDashboard();
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
          if(tab==='train') {
            this.fetchDatasets();
            this.fetchTrainings().then(() => this.startTrainingPolling());
          } else {
            this.stopTrainingPolling();
          }
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
      addTrBtn.onclick = ()=> this.openWizard();
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
    // Dataset search and filter
    const searchInput = this.modalElement.querySelector('#dataset-search');
    if(searchInput) {
      searchInput.oninput = () => this.filterDatasets();
    }

    const filterSelect = this.modalElement.querySelector('#dataset-filter');
    if(filterSelect) {
      filterSelect.onchange = () => this.filterDatasets();
    }

    this.bindDatasetCardEvents();

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

      // Delete training
      const deleteBtn = card.querySelector('.delete-training');
      if (deleteBtn) {
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
          this.deleteTraining(trainingId);
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
    this.modalElement.querySelectorAll('.cancel-embellishment-task').forEach(btn=>{
      btn.onclick=(e)=>{
        e.preventDefault();
        e.stopPropagation();
        const taskId = btn.getAttribute('data-task-id');
        const datasetId = btn.getAttribute('data-dataset-id');
        this.cancelEmbellishmentTask(taskId, datasetId);
      };
    });

    // Control set card actions
    this.modalElement.querySelectorAll('.view-control').forEach(btn=>{
      btn.onclick=(e)=>{
        e.stopPropagation();
        const controlSetId = btn.getAttribute('data-id');
        this.openControlViewer(controlSetId);
      };
    });
    this.modalElement.querySelectorAll('.delete-control').forEach(btn=>{
      btn.onclick=(e)=>{
        e.stopPropagation();
        const controlSetId = btn.getAttribute('data-id');
        this.deleteControlSet(controlSetId);
      };
    });
    // Generate control images button
    const genControlDetailBtn = this.modalElement.querySelector('.detail-generate-control-btn');
    if (genControlDetailBtn) {
      genControlDetailBtn.onclick = () => {
        if (!this.state.selectedDatasetId) {
          alert('Select a dataset first.');
          return;
        }
        this.generateControlImages(this.state.selectedDatasetId);
      };
    }

    // Import button
    const impBtn = this.modalElement.querySelector('.import-btn');
    if (impBtn) {
      impBtn.onclick = () => this.openImportDialog(currentCategory);
    }

    // Wizard event bindings
    this.bindWizardEvents();
    // Dashboard event bindings
    this.bindDashboardEvents();
    this.bindDatasetDetailEvents();
  }

  bindWizardEvents() {
    if (!this.modalElement || this.state.wizardStep === 0) return;

    // Navigation buttons
    const nextBtn = this.modalElement.querySelector('.wizard-next-btn');
    if (nextBtn) nextBtn.onclick = () => this.wizardNext();

    const backBtn = this.modalElement.querySelector('.wizard-back-btn');
    if (backBtn) backBtn.onclick = () => this.wizardBack();

    const cancelBtn = this.modalElement.querySelector('.wizard-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = () => this.wizardCancel();

    const submitBtn = this.modalElement.querySelector('.wizard-submit-btn');
    if (submitBtn) submitBtn.onclick = () => this.submitWizard();

    // Step 1: Dataset card selection
    this.modalElement.querySelectorAll('.wizard-dataset-card').forEach(card => {
      card.onclick = () => {
        const id = card.getAttribute('data-id');
        this.wizardSelectDataset(id);
      };
    });

    // Step 1: New Dataset card
    const newDsCard = this.modalElement.querySelector('.wizard-new-dataset-card');
    if (newDsCard) {
      newDsCard.onclick = () => {
        this.wizardCancel();
        this.openDatasetForm();
      };
    }

    // Step 2: Model card selection
    this.modalElement.querySelectorAll('.wizard-model-card').forEach(card => {
      card.onclick = () => {
        const type = card.getAttribute('data-type');
        this.wizardSelectModel(type);
      };
    });

    // Step 2: Training mode selection (for KONTEXT)
    this.modalElement.querySelectorAll('.wizard-mode-card').forEach(card => {
      card.onclick = () => {
        const mode = card.getAttribute('data-mode');
        this.wizardSelectTrainingMode(mode);
      };
    });

    // Step 2.5: Control dataset selection (for KONTEXT concept mode)
    this.modalElement.querySelectorAll('.wizard-control-dataset-card').forEach(card => {
      card.onclick = () => {
        const id = card.getAttribute('data-id');
        this.wizardSelectControlDataset(id);
      };
    });

    // Step 2.5: Generate control images button
    const genControlBtn = this.modalElement.querySelector('.wizard-generate-control-btn');
    if (genControlBtn) {
      genControlBtn.onclick = () => {
        const dsId = genControlBtn.getAttribute('data-dataset-id');
        this.generateControlImages(dsId);
      };
    }

    // Step 2.5: Use self-control checkbox (use control images from same dataset)
    const selfControlCheckbox = this.modalElement.querySelector('.wizard-use-self-control');
    if (selfControlCheckbox) {
      selfControlCheckbox.onchange = () => {
        if (selfControlCheckbox.checked) {
          this.wizardSelectControlDataset(this.state.wizardDatasetId);
        } else {
          this.wizardSelectControlDataset(null);
        }
      };
    }

    // Step 3: Caption set selection
    this.modalElement.querySelectorAll('.wizard-caption-card').forEach(card => {
      card.onclick = () => {
        const id = card.getAttribute('data-id');
        this.wizardSelectCaptionSet(id);
      };
    });

    // Step 3: Control set selection (for KONTEXT concept mode)
    this.modalElement.querySelectorAll('.wizard-control-set-card').forEach(card => {
      card.onclick = () => {
        const id = card.getAttribute('data-control-id');
        this.wizardSelectControlSet(id);
      };
    });

    // Step 3: Generate Captions button
    const genCapBtn = this.modalElement.querySelector('.wizard-generate-captions-btn');
    if (genCapBtn) {
      genCapBtn.onclick = () => {
        const dsId = genCapBtn.getAttribute('data-dataset-id');
        this.generateCaptionSet(dsId);
      };
    }

    // Step 3: Generate Control Images button (in wizard)
    const wizGenCtrlBtn = this.modalElement.querySelector('.wizard-generate-control-btn');
    if (wizGenCtrlBtn) {
      wizGenCtrlBtn.onclick = () => {
        const dsId = wizGenCtrlBtn.getAttribute('data-dataset-id');
        this.generateControlImages(dsId);
      };
    }

    // Step 4: Advanced toggle
    const advToggle = this.modalElement.querySelector('#wizard-show-advanced');
    const advContent = this.modalElement.querySelector('#wizard-advanced-content');
    if (advToggle && advContent) {
      advToggle.onchange = () => {
        advContent.style.display = advToggle.checked ? 'block' : 'none';
      };
    }

    // Step 4: Form input bindings (update wizardFormValues without re-render)
    this.modalElement.querySelectorAll('.wizard-input').forEach(input => {
      input.oninput = (e) => {
        const nameMap = {
          wizardName: 'name',
          wizardDescription: 'description',
          wizardSteps: 'steps',
          wizardLearningRate: 'learningRate',
          wizardBatchSize: 'batchSize',
          wizardResolution: 'resolution',
          wizardLoraRank: 'loraRank',
          wizardLoraAlpha: 'loraAlpha',
          wizardLoraDropout: 'loraDropout',
        };
        const key = nameMap[e.target.name];
        if (key) {
          this.state.wizardFormValues[key] = e.target.value;
        }
      };
    });
  }

  bindDashboardEvents() {
    if (!this.modalElement || this.state.wizardStep > 0 || this.state.formMode) return;

    // Dashboard dataset card events
    this.modalElement.querySelectorAll('.compact-dataset-card').forEach(card => {
      const dsId = card.getAttribute('data-id');

      const viewBtn = card.querySelector('.view-dataset');
      if (viewBtn) {
        viewBtn.onclick = (e) => {
          e.stopPropagation();
          this.openDatasetDetail(dsId);
        };
      }

      const editBtn = card.querySelector('.edit-dataset');
      if (editBtn) {
        editBtn.onclick = (e) => {
          e.stopPropagation();
          const dataset = this.getDatasetById(dsId);
          if (dataset) this.openDatasetForm(dataset);
        };
      }

      const useBtn = card.querySelector('.use-dataset');
      if (useBtn) {
        useBtn.onclick = (e) => {
          e.stopPropagation();
          this.openWizard(dsId);
        };
      }
    });

    // Dashboard training card actions (active + history)
    this.modalElement.querySelectorAll('.active-training-card, .history-item').forEach(card => {
      const trainingId = card.getAttribute('data-id');
      const training = this.state.trainings.find(t => t._id === trainingId);

      const viewBtn = card.querySelector('.view-details');
      if (viewBtn) {
        viewBtn.onclick = (e) => {
          e.stopPropagation();
          if (training) this.openTrainingForm(training);
        };
      }

      const cancelBtn = card.querySelector('.cancel-training');
      if (cancelBtn) {
        cancelBtn.onclick = (e) => {
          e.stopPropagation();
          this.cancelTraining(trainingId);
        };
      }

      const retryBtn = card.querySelector('.retry-training');
      if (retryBtn) {
        retryBtn.onclick = (e) => {
          e.stopPropagation();
          this.retryTraining(trainingId);
        };
      }

      const deleteBtn = card.querySelector('.delete-training');
      if (deleteBtn) {
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
          this.deleteTraining(trainingId);
        };
      }
    });
  }

  bindDatasetDetailEvents() {
    if (!this.modalElement || this.state.formMode !== 'view-dataset') return;

    const backBtn = this.modalElement.querySelector('.detail-back-btn');
    if (backBtn) {
      backBtn.onclick = () => this.resetForm();
    }

    const editBtn = this.modalElement.querySelector('.detail-edit-btn');
    if (editBtn) {
      editBtn.onclick = () => {
        const dataset = this.getDatasetById(this.state.selectedDatasetId);
        if (dataset) this.openDatasetForm(dataset);
      };
    }

    const trainBtn = this.modalElement.querySelector('.detail-train-btn');
    if (trainBtn) {
      trainBtn.onclick = () => {
        this.openWizard(this.state.selectedDatasetId);
      };
    }

    const generateBtn = this.modalElement.querySelector('.detail-generate-captions-btn');
    if (generateBtn) {
      generateBtn.onclick = () => {
        this.generateCaptionSet(this.state.selectedDatasetId);
      };
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

  resetForm(){
    this.setState({
      formMode:null,formValues:{},originalFormValues:null,formError:null,submitting:false,newImageUrls:[],
      // Wizard cleanup
      wizardStep:0,wizardDatasetId:null,wizardModelType:null,wizardCaptionSetId:null,wizardFormValues:{},wizardCaptionSets:[],wizardLoadingCaptions:false,
    });
  }

  openDatasetForm(ds=null){
    if(ds){ this.setState({formMode:'edit-dataset',formValues:{...ds},originalFormValues:JSON.parse(JSON.stringify(ds))}); }
    else { this.setState({formMode:'new-dataset',formValues:{name:'',description:'',images:[]},originalFormValues:null});} }

  openDatasetDetail(datasetId) {
    this.setState({
      formMode: 'view-dataset',
      selectedDatasetId: datasetId,
      captionSets: [],
      loadingCaptions: true,
      captionError: null,
    });
    this.fetchCaptionSets(datasetId);
  }

  openTrainingForm(tr=null){
    if(!tr){
      // New training → open wizard
      this.openWizard();
      return;
    }
    if(tr && tr.datasetId && !tr._id){
      // Only has datasetId → open wizard with pre-selected dataset
      this.openWizard(tr.datasetId);
      return;
    }
    // Full training object → edit form
    this.setState({formMode:'edit-training',formValues:{...tr}});
  }

  /* ====================== WIZARD LIFECYCLE ====================== */

  openWizard(preselectedDatasetId = null) {
    this.setState({
      wizardStep: 1,
      wizardDatasetId: preselectedDatasetId,
      wizardModelType: null,
      wizardTrainingMode: null,
      wizardControlDatasetId: null,
      wizardCaptionSetId: null,
      wizardControlSetId: null,
      wizardFormValues: {},
      wizardCaptionSets: [],
      wizardControlSets: [],
      wizardLoadingCaptions: false,
      wizardLoadingControlSets: false,
      formMode: null, // clear any existing form
    });
  }

  wizardNext() {
    const { wizardStep, wizardDatasetId, wizardModelType, wizardTrainingMode, wizardControlDatasetId, wizardCaptionSetId, wizardControlSetId } = this.state;
    if (wizardStep === 1) {
      if (!wizardDatasetId) { alert('Please select a dataset.'); return; }
      this.fetchWizardCaptionSets(wizardDatasetId);
      this.setState({ wizardStep: 2 });
    } else if (wizardStep === 2) {
      if (!wizardModelType) { alert('Please select a model type.'); return; }
      // KONTEXT requires training mode selection
      if (wizardModelType === 'KONTEXT') {
        if (!wizardTrainingMode) { alert('Please select a training mode for KONTEXT.'); return; }
      }
      const defaults = this.getModelDefaults(wizardModelType, wizardTrainingMode);
      // For KONTEXT concept mode, fetch control sets for step 3
      if (wizardModelType === 'KONTEXT' && wizardTrainingMode === 'concept') {
        this.fetchWizardControlSets(wizardDatasetId);
      }
      this.setState({
        wizardStep: 3,
        wizardFormValues: {
          ...this.state.wizardFormValues,
          modelType: wizardModelType,
          baseModel: wizardModelType,
          trainingMode: wizardTrainingMode,
          controlDatasetId: wizardControlDatasetId,
          ...defaults,
        },
      });
    } else if (wizardStep === 3) {
      // For KONTEXT concept mode, require control set instead of caption set
      const isKontextConcept = wizardModelType === 'KONTEXT' && wizardTrainingMode === 'concept';
      if (isKontextConcept) {
        if (!wizardControlSetId) { alert('Please select a control set.'); return; }
      } else {
        if (!wizardCaptionSetId) { alert('Please select a caption set.'); return; }
      }
      // Auto-calculate cost for review step
      this.setState({ wizardStep: 4 });
      this.calculateWizardCost();
    }
  }

  wizardBack() {
    const { wizardStep } = this.state;
    if (wizardStep > 1) {
      this.setState({ wizardStep: wizardStep - 1 });
    }
  }

  wizardCancel() {
    this.setState({
      wizardStep: 0,
      wizardDatasetId: null,
      wizardModelType: null,
      wizardTrainingMode: null,
      wizardControlDatasetId: null,
      wizardCaptionSetId: null,
      wizardControlSetId: null,
      wizardFormValues: {},
      wizardCaptionSets: [],
      wizardControlSets: [],
      wizardLoadingCaptions: false,
      wizardLoadingControlSets: false,
    });
  }

  wizardSelectDataset(id) {
    this.setState({ wizardDatasetId: id });
  }

  wizardSelectModel(type) {
    const defaults = this.getModelDefaults(type);
    this.setState({
      wizardModelType: type,
      wizardTrainingMode: null, // Reset training mode when model changes
      wizardControlDatasetId: null, // Reset control dataset
      wizardFormValues: {
        ...this.state.wizardFormValues,
        modelType: type,
        baseModel: type,
        ...defaults,
      },
    });
  }

  wizardSelectTrainingMode(mode) {
    this.setState({
      wizardTrainingMode: mode,
      wizardControlDatasetId: null, // Reset control dataset when mode changes
      wizardFormValues: {
        ...this.state.wizardFormValues,
        trainingMode: mode,
      },
    });
  }

  wizardSelectControlDataset(id) {
    this.setState({ wizardControlDatasetId: id });
  }

  wizardSelectCaptionSet(id) {
    this.setState({ wizardCaptionSetId: id });
  }

  wizardSelectControlSet(id) {
    this.setState({ wizardControlSetId: id });
  }

  /**
   * Generate control images for a dataset (for KONTEXT concept mode)
   * Shows a dialog to select spell and input concept description
   */
  async generateControlImages(datasetId) {
    if (!datasetId) return;
    const dataset = this.getDatasetById(datasetId);
    if (!dataset) {
      alert('Dataset not found');
      return;
    }

    // Fetch available control spells
    let controlSpells = [];
    try {
      const res = await fetch('/api/v1/datasets/embellishment-spells?type=control', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        controlSpells = json.data || [];
      }
    } catch (err) {
      console.warn('[ModsMenuModal] Failed to fetch control spells', err);
    }

    if (!controlSpells.length) {
      alert('No control image generation spells are available. Please contact support.');
      return;
    }

    // Create dialog
    const overlay = document.createElement('div');
    overlay.className = 'import-overlay';

    const spellOpts = controlSpells.map((s, idx) =>
      `<option value="${s.slug}" data-idx="${idx}">${s.name}</option>`
    ).join('');

    overlay.innerHTML = `<div class="import-dialog control-generator-dialog">
      <h3>Generate Control Images</h3>
      <p class="dialog-description">Create "before" images for KONTEXT concept training. These will be paired with your result images to teach the model a transformation.</p>

      <label>Dataset:<br>
        <input type="text" class="control-dataset-name" value="${this.escapeHtml(dataset.name)} (${(dataset.images || []).length} images)" disabled />
      </label>

      <label>Control Spell:<br>
        <select class="control-spell-select">${spellOpts}</select>
      </label>

      <label>Concept Description:<br>
        <textarea class="control-concept-input" rows="3" placeholder="Describe what transformation/concept you're training. Example: 'make her a fullyarmoredgirl with a deluxe weaponized mech suit'"></textarea>
      </label>
      <p class="input-hint">This tells the spell what was added to the original images, so it can generate the "before" versions.</p>

      <div class="error-message" style="display:none"></div>
      <div class="btn-row">
        <button class="confirm-control-btn btn-primary">Generate</button>
        <button class="cancel-control-btn btn-secondary">Cancel</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);

    const errEl = overlay.querySelector('.error-message');
    const cleanup = () => { document.body.removeChild(overlay); };

    overlay.querySelector('.cancel-control-btn').onclick = cleanup;
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };

    overlay.querySelector('.confirm-control-btn').onclick = async () => {
      const spellSlug = overlay.querySelector('.control-spell-select').value;
      const concept = overlay.querySelector('.control-concept-input').value.trim();

      if (!concept) {
        errEl.textContent = 'Please describe the concept you are training.';
        errEl.style.display = 'block';
        return;
      }

      overlay.querySelector('.confirm-control-btn').disabled = true;

      try {
        const csrfRes = await fetch('/api/v1/csrf-token');
        const { csrfToken } = await csrfRes.json();
        const masterAccountId = await this.getCurrentMasterAccountId();

        const payload = {
          spellSlug,
          masterAccountId,
          parameterOverrides: {
            prompt: concept
          }
        };

        const res = await fetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/embellish`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || 'Failed to start control image generation');
        }

        const taskInfo = await res.json();
        if (taskInfo.taskId) {
          this.handleEmbellishmentProgressEvent({
            taskId: taskInfo.taskId.toString(),
            datasetId,
            embellishmentType: 'control',
            status: 'started',
            progress: {
              total: taskInfo.totalItems || 0,
              completed: 0,
              failed: 0
            }
          });
        }

        cleanup();

        // Refresh datasets to show the embellishment task
        await this.fetchDatasets();
        this.render();
      } catch (err) {
        errEl.textContent = err.message || 'Generation failed';
        errEl.style.display = 'block';
        overlay.querySelector('.confirm-control-btn').disabled = false;
      }
    };
  }

  async fetchWizardCaptionSets(datasetId) {
    if (!datasetId) return;
    this.setState({ wizardLoadingCaptions: true, wizardCaptionSets: [] });
    try {
      const res = await fetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/captions`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const payload = await res.json();
      const list = Array.isArray(payload?.data)
        ? payload.data
        : (payload?.data?.captionSets || payload?.captionSets || []);
      this.setState({ wizardCaptionSets: Array.isArray(list) ? list : [], wizardLoadingCaptions: false });
    } catch (err) {
      console.warn('[ModsMenuModal] fetchWizardCaptionSets error', err);
      this.setState({ wizardLoadingCaptions: false, wizardCaptionSets: [] });
    }
  }

  async fetchWizardControlSets(datasetId) {
    if (!datasetId) return;
    this.setState({ wizardLoadingControlSets: true, wizardControlSets: [] });
    try {
      // Get the dataset and extract control embellishments
      const dataset = this.getDatasetById(datasetId);
      if (!dataset) {
        // Fetch from API if not in local state
        const res = await fetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}`, { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch dataset');
        const payload = await res.json();
        const ds = payload?.data || payload;
        const controlEmbellishments = (ds.embellishments || []).filter(
          e => e.type === 'control' && e.status === 'completed'
        );
        this.setState({ wizardControlSets: controlEmbellishments, wizardLoadingControlSets: false });
      } else {
        const controlEmbellishments = (dataset.embellishments || []).filter(
          e => e.type === 'control' && e.status === 'completed'
        );
        this.setState({ wizardControlSets: controlEmbellishments, wizardLoadingControlSets: false });
      }
    } catch (err) {
      console.warn('[ModsMenuModal] fetchWizardControlSets error', err);
      this.setState({ wizardLoadingControlSets: false, wizardControlSets: [] });
    }
  }

  async calculateWizardCost() {
    const fv = this.state.wizardFormValues;
    try {
      const cost = await this.calculateTrainingCost(fv);
      this.setState({ estimatedCost: cost });
    } catch (e) {
      console.warn('[ModsMenuModal] wizard cost error', e);
    }
  }

  /* ====================== WIZARD RENDER METHODS ====================== */

  /**
   * Render progress panel for running embellishment tasks in wizard view
   * Shows tasks for the currently selected wizard dataset or any running tasks
   */
  renderWizardProgressPanel() {
    const { wizardDatasetId, embellishmentTasks } = this.state;
    const normalizedWizardId = this.normalizeId(wizardDatasetId);

    // Get running tasks (for wizard dataset or any running)
    const runningTasks = Object.values(embellishmentTasks || {}).filter(task => {
      if (!task) return false;
      if (task.status === 'running') return true;
      // Also show recently completed for the wizard dataset
      if (task.datasetId === normalizedWizardId && task.completedAt && (Date.now() - task.completedAt) < 5000) return true;
      return false;
    });

    if (!runningTasks.length) return '';

    return `<div class="wizard-progress-panel">
      ${runningTasks.map(task => {
        const percent = task.total ? Math.min(100, Math.round((task.completedCount / task.total) * 100)) : 0;
        const typeLabel = this.getEmbellishmentTypeLabel(task.embellishmentType);
        const statusLabel = task.status === 'completed' ? 'Completed' : `${typeLabel}…`;
        const secondary = task.total ? `${task.completedCount}/${task.total} images` : 'Starting...';

        return `<div class="wizard-progress-card status-${task.status}">
          <div class="wizard-progress-info">
            <span class="wizard-progress-label">${statusLabel}</span>
            <span class="wizard-progress-count">${secondary}</span>
          </div>
          <div class="wizard-progress-bar">
            <div class="wizard-progress-fill" style="width:${percent}%;"></div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  renderWizardStepBar() {
    const { wizardStep } = this.state;
    const steps = ['Dataset', 'Model', 'Captions', 'Review'];
    return `<div class="wizard-step-bar">
      ${steps.map((label, i) => {
        const stepNum = i + 1;
        const cls = stepNum === wizardStep ? 'active' : stepNum < wizardStep ? 'completed' : '';
        const connector = i < steps.length - 1 ? `<div class="wizard-step-connector ${stepNum < wizardStep ? 'completed' : ''}"></div>` : '';
        return `<div class="wizard-step-indicator ${cls}">
          <span class="wizard-step-num">${stepNum < wizardStep ? '&#10003;' : stepNum}</span>
          <span class="wizard-step-label">${label}</span>
        </div>${connector}`;
      }).join('')}
    </div>`;
  }

  renderWizardStep1() {
    const { datasets, wizardDatasetId } = this.state;
    return `<div class="wizard-body">
      <h3>Select a Dataset</h3>
      <p style="color:#aaa;margin-bottom:16px;">Choose the dataset of images you want to train on.</p>
      <div class="wizard-dataset-grid">
        ${datasets.map(ds => {
          const dsId = this.normalizeId(ds._id);
          const sel = this.normalizeId(wizardDatasetId) === dsId ? ' selected' : '';
          const imgCount = (ds.images || []).length;
          return `<div class="wizard-dataset-card${sel}" data-id="${dsId}">
            <div class="dataset-preview">
              ${(ds.images || []).slice(0, 4).map(img => `<img src="${img}" class="preview-thumb" />`).join('')}
              ${imgCount > 4 ? `<div class="more-count">+${imgCount - 4}</div>` : ''}
            </div>
            <h4>${ds.name || 'Unnamed Dataset'}</h4>
            <span class="wizard-card-meta">${imgCount} image${imgCount !== 1 ? 's' : ''}</span>
          </div>`;
        }).join('')}
        <div class="wizard-new-dataset-card" data-action="new-dataset">
          <div class="wizard-new-icon">+</div>
          <h4>New Dataset</h4>
        </div>
      </div>
    </div>`;
  }

  renderWizardStep2() {
    const { wizardModelType, wizardTrainingMode, wizardControlDatasetId, wizardDatasetId, datasets } = this.state;
    const models = [
      { type: 'SDXL', name: 'SDXL', desc: 'Stable Diffusion XL — fast training, great for stylized art and characters.', defaults: '1000 steps, LR 0.0004, rank 16' },
      { type: 'FLUX', name: 'FLUX', desc: 'FLUX — high-fidelity realism, best for photorealistic and detailed subjects.', defaults: '4000 steps, LR 0.0001, rank 32' },
      { type: 'KONTEXT', name: 'KONTEXT', desc: 'FLUX Kontext — train style/subject LoRAs or concept transformations.', defaults: '3000 steps, LR 0.0001, rank 16' },
    ];

    // Training mode selection for KONTEXT
    const kontextModes = [
      { mode: 'style_subject', name: 'Style / Subject', desc: 'Train on a single dataset to capture a style or subject. Works like standard LoRA training.' },
      { mode: 'concept', name: 'Concept', desc: 'Train on paired before/after images to teach a transformation. Requires a control dataset.' },
    ];

    // Get datasets with control images for concept mode
    // Control datasets have embellishment of type 'control' that is completed
    const controlDatasets = (datasets || []).filter(ds => {
      // Don't show the currently selected dataset as a control option
      if (this.normalizeId(ds._id) === this.normalizeId(wizardDatasetId)) return false;
      // Check if dataset has control embellishments completed
      const hasControlImages = ds.embellishments?.some(e => e.type === 'control' && e.status === 'completed');
      return hasControlImages;
    });

    // Check if the selected dataset itself has control images
    const selectedDataset = (datasets || []).find(ds => this.normalizeId(ds._id) === this.normalizeId(wizardDatasetId));
    const selectedHasControl = selectedDataset?.embellishments?.some(e => e.type === 'control' && e.status === 'completed');

    return `<div class="wizard-body">
      <h3>Choose Model Type</h3>
      <p style="color:#aaa;margin-bottom:16px;">Select the base model architecture for your LoRA.</p>
      <div class="wizard-model-grid">
        ${models.map(m => {
          const sel = wizardModelType === m.type ? ' selected' : '';
          return `<div class="wizard-model-card${sel}" data-type="${m.type}">
            <div class="model-name">${m.name}</div>
            <div class="model-desc">${m.desc}</div>
            <div class="model-defaults">${m.defaults}</div>
          </div>`;
        }).join('')}
      </div>
      ${wizardModelType === 'KONTEXT' ? `
        <div class="wizard-mode-section" style="margin-top:24px;">
          <h4 style="margin-bottom:8px;">Training Mode</h4>
          <p style="color:#aaa;margin-bottom:12px;font-size:16px;">Choose how you want to train your KONTEXT LoRA.</p>
          <div class="wizard-mode-grid">
            ${kontextModes.map(m => {
              const sel = wizardTrainingMode === m.mode ? ' selected' : '';
              return `<div class="wizard-mode-card${sel}" data-mode="${m.mode}">
                <div class="mode-name">${m.name}</div>
                <div class="mode-desc">${m.desc}</div>
              </div>`;
            }).join('')}
          </div>
        </div>
        ${wizardTrainingMode === 'concept' ? `
          <div class="wizard-control-section" style="margin-top:24px;">
            <div class="wizard-control-info" style="background:#2a3a2a;border:1px solid #3a5a3a;padding:12px;border-radius:8px;">
              <strong style="color:#8f8;">Concept Training Selected</strong>
              <p style="color:#aaa;font-size:14px;margin:4px 0 0;">In the next step, you'll select which control image set to use. The transformation prompt from that set will be used for all training captions.</p>
            </div>
          </div>
        ` : ''}
      ` : ''}
    </div>`;
  }

  renderWizardStep3() {
    const {
      wizardCaptionSets, wizardCaptionSetId, wizardLoadingCaptions,
      wizardControlSets, wizardControlSetId, wizardLoadingControlSets,
      wizardModelType, wizardTrainingMode, wizardDatasetId
    } = this.state;

    // For KONTEXT concept mode, show control set selection instead of captions
    const isKontextConcept = wizardModelType === 'KONTEXT' && wizardTrainingMode === 'concept';

    if (isKontextConcept) {
      // Control set selection for concept training
      if (wizardLoadingControlSets) {
        return `<div class="wizard-body"><div class="loading-spinner">Loading control sets...</div></div>`;
      }

      return `<div class="wizard-body">
        <h3>Select Control Set</h3>
        <p class="wizard-caption-recommendation">Choose the control image set to use for concept training. The transformation prompt from this set will be used for all training captions.</p>
        ${wizardControlSets.length ? `<div class="wizard-caption-grid">
          ${wizardControlSets.map(cs => {
            const csId = this.normalizeId(cs._id);
            const sel = this.normalizeId(wizardControlSetId) === csId ? ' selected' : '';
            const count = cs.results?.filter(r => r && r.value)?.length || 0;
            const date = new Date(cs.createdAt || cs.created || Date.now()).toLocaleDateString();
            const prompt = cs.config?.prompt || 'Unknown prompt';
            const promptPreview = prompt.length > 80 ? prompt.slice(0, 80) + '...' : prompt;
            return `<div class="wizard-control-set-card${sel}" data-control-id="${csId}">
              <div class="wizard-caption-method">${cs.method || 'Control'}</div>
              <div class="wizard-control-prompt" style="font-size:14px;color:#aaa;margin:4px 0;font-style:italic;">"${promptPreview}"</div>
              <div class="wizard-caption-meta">${count} image${count !== 1 ? 's' : ''} &middot; ${date}</div>
            </div>`;
          }).join('')}
        </div>` : `<div class="empty-message">No control sets found for this dataset. Generate control images first.</div>`}
        <button class="btn-primary wizard-generate-control-btn" data-dataset-id="${this.normalizeId(wizardDatasetId)}">Generate Control Images</button>
      </div>`;
    }

    // Caption selection for all other modes
    let recommendation = 'SDXL models work well with tag-style and short captions.';
    if (wizardModelType === 'FLUX') {
      recommendation = 'FLUX models work best with detailed, natural language captions.';
    } else if (wizardModelType === 'KONTEXT') {
      recommendation = 'KONTEXT works well with detailed captions describing the subject or style.';
    }

    if (wizardLoadingCaptions) {
      return `<div class="wizard-body"><div class="loading-spinner">Loading caption sets...</div></div>`;
    }
    return `<div class="wizard-body">
      <h3>Select Caption Set</h3>
      <p class="wizard-caption-recommendation">${recommendation}</p>
      ${wizardCaptionSets.length ? `<div class="wizard-caption-grid">
        ${wizardCaptionSets.map(cs => {
          const capId = this.normalizeId(cs._id);
          const sel = this.normalizeId(wizardCaptionSetId) === capId ? ' selected' : '';
          const count = cs.captions?.length || 0;
          const date = new Date(cs.createdAt || cs.created || Date.now()).toLocaleDateString();
          return `<div class="wizard-caption-card${sel}" data-id="${capId}">
            <div class="wizard-caption-method">${cs.method || 'Unknown method'}</div>
            <div class="wizard-caption-meta">${count} caption${count !== 1 ? 's' : ''} &middot; ${date}${cs.isDefault ? ' &middot; <strong>Default</strong>' : ''}</div>
          </div>`;
        }).join('')}
      </div>` : `<div class="empty-message">No caption sets found for this dataset.</div>`}
      <button class="btn-primary wizard-generate-captions-btn" data-dataset-id="${this.normalizeId(wizardDatasetId)}">Generate Captions</button>
    </div>`;
  }

  renderWizardStep4() {
    const { wizardFormValues, wizardDatasetId, wizardModelType, wizardTrainingMode, wizardControlDatasetId, wizardCaptionSetId, wizardControlSetId, estimatedCost, datasets } = this.state;
    const dataset = this.getDatasetById(wizardDatasetId);
    const captionSet = this.state.wizardCaptionSets.find(cs => this.normalizeId(cs._id) === this.normalizeId(wizardCaptionSetId));
    const controlSet = this.state.wizardControlSets.find(cs => this.normalizeId(cs._id) === this.normalizeId(wizardControlSetId));
    const controlDataset = wizardControlDatasetId ? (datasets || []).find(ds => this.normalizeId(ds._id) === this.normalizeId(wizardControlDatasetId)) : null;
    const fv = wizardFormValues;

    // Format training mode for display
    const trainingModeDisplay = wizardTrainingMode === 'style_subject' ? 'Style / Subject'
      : wizardTrainingMode === 'concept' ? 'Concept'
      : null;

    const isKontextConcept = wizardModelType === 'KONTEXT' && wizardTrainingMode === 'concept';

    // Get control set info for display
    const controlSetCount = controlSet?.results?.filter(r => r && r.value)?.length || 0;
    const controlSetPrompt = controlSet?.config?.prompt || '';
    const controlSetPromptPreview = controlSetPrompt.length > 60 ? controlSetPrompt.slice(0, 60) + '...' : controlSetPrompt;

    return `<div class="wizard-body">
      <h3>Review &amp; Start Training</h3>
      <div class="wizard-summary-card">
        <div class="wizard-summary-row"><span class="label">Dataset:</span> <span class="value">${dataset?.name || 'Unknown'} (${(dataset?.images || []).length} images)</span></div>
        <div class="wizard-summary-row"><span class="label">Model Type:</span> <span class="value">${wizardModelType}</span></div>
        ${wizardModelType === 'KONTEXT' && trainingModeDisplay ? `
          <div class="wizard-summary-row"><span class="label">Training Mode:</span> <span class="value">${trainingModeDisplay}</span></div>
        ` : ''}
        ${controlDataset ? `
          <div class="wizard-summary-row"><span class="label">Control Dataset:</span> <span class="value">${controlDataset.name || 'Unknown'}${this.normalizeId(wizardControlDatasetId) === this.normalizeId(wizardDatasetId) ? ' (same dataset)' : ''}</span></div>
        ` : ''}
        ${isKontextConcept && controlSet ? `
          <div class="wizard-summary-row"><span class="label">Control Set:</span> <span class="value">${controlSet.method || 'Control'} (${controlSetCount} images)</span></div>
          <div class="wizard-summary-row"><span class="label">Prompt:</span> <span class="value" style="font-style:italic;">"${controlSetPromptPreview}"</span></div>
        ` : `
          <div class="wizard-summary-row"><span class="label">Captions:</span> <span class="value">${captionSet?.method || 'Unknown'} (${captionSet?.captions?.length || 0})</span></div>
        `}
        <div class="wizard-summary-row"><span class="label">Steps:</span> <span class="value">${fv.steps || '—'}</span></div>
        <div class="wizard-summary-row"><span class="label">Learning Rate:</span> <span class="value">${fv.learningRate || '—'}</span></div>
        <div class="wizard-summary-row"><span class="label">LoRA Rank:</span> <span class="value">${fv.loraRank || '—'}</span></div>
      </div>
      <div class="form-section" style="margin-top:16px;">
        <label>Training Name (becomes trigger word):<br>
          <input type="text" class="wizard-input" name="wizardName" value="${fv.name || ''}" placeholder="e.g. mystyle" required />
        </label>
        <label style="margin-top:12px;display:block;">Description (optional, AI-generated if blank):<br>
          <textarea class="wizard-input" name="wizardDescription" placeholder="Describe what this LoRA does...">${fv.description || ''}</textarea>
        </label>
      </div>
      <div class="form-section advanced-params" style="margin-top:12px;">
        <div class="advanced-toggle">
          <label><input type="checkbox" id="wizard-show-advanced" /> Show Advanced Parameters</label>
        </div>
        <div class="advanced-content" id="wizard-advanced-content" style="display:none;">
          <div class="param-row">
            <label>Steps:<br><input type="number" class="wizard-input" name="wizardSteps" value="${fv.steps || ''}" min="100" max="5000" /></label>
            <label>Learning Rate:<br><input type="number" class="wizard-input" name="wizardLearningRate" value="${fv.learningRate || ''}" step="0.0001" min="0.0001" max="0.01" /></label>
          </div>
          <div class="param-row">
            <label>Batch Size:<br><input type="number" class="wizard-input" name="wizardBatchSize" value="${fv.batchSize || 1}" min="1" max="8" /></label>
            <label>Resolution:<br><input type="text" class="wizard-input" name="wizardResolution" value="${fv.resolution || '1024,1024'}" /></label>
          </div>
          <div class="param-row">
            <label>LoRA Rank:<br><input type="number" class="wizard-input" name="wizardLoraRank" value="${fv.loraRank || 16}" min="4" max="128" /></label>
            <label>LoRA Alpha:<br><input type="number" class="wizard-input" name="wizardLoraAlpha" value="${fv.loraAlpha || 32}" min="4" max="256" /></label>
          </div>
          <div class="param-row">
            <label>LoRA Dropout:<br><input type="number" class="wizard-input" name="wizardLoraDropout" value="${fv.loraDropout || 0.1}" step="0.01" min="0" max="0.5" /></label>
          </div>
        </div>
      </div>
      <div class="form-section cost-section" style="margin-top:12px;">
        <h3>Cost Estimation</h3>
        <div class="cost-display">
          <div class="cost-item">
            <span>Estimated Cost:</span>
            <span class="cost-value">${estimatedCost ? estimatedCost + ' points' : 'Calculating...'}</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  /* ====================== WIZARD SUBMISSION ====================== */

  async submitWizard() {
    const { wizardDatasetId, wizardModelType, wizardTrainingMode, wizardControlDatasetId, wizardCaptionSetId, wizardControlSetId, wizardFormValues } = this.state;
    // Read latest input values from DOM before submitting
    const nameInput = this.modalElement.querySelector('[name="wizardName"]');
    const descInput = this.modalElement.querySelector('[name="wizardDescription"]');
    const name = nameInput?.value?.trim() || wizardFormValues.name || '';
    const description = descInput?.value?.trim() || wizardFormValues.description || '';

    if (!name) { alert('Please enter a training name.'); return; }

    const isKontextConcept = wizardModelType === 'KONTEXT' && wizardTrainingMode === 'concept';

    const payload = {
      name,
      description,
      datasetId: wizardDatasetId,
      modelType: wizardModelType,
      baseModel: wizardModelType,
      // For KONTEXT concept mode, don't send captionSetId (we use control set's prompt instead)
      captionSetId: isKontextConcept ? null : wizardCaptionSetId,
      triggerWords: name, // name becomes trigger word
      steps: wizardFormValues.steps,
      learningRate: wizardFormValues.learningRate,
      batchSize: wizardFormValues.batchSize || 1,
      resolution: wizardFormValues.resolution || '1024,1024',
      loraRank: wizardFormValues.loraRank,
      loraAlpha: wizardFormValues.loraAlpha,
      loraDropout: wizardFormValues.loraDropout,
    };

    // Add KONTEXT-specific fields
    if (wizardModelType === 'KONTEXT') {
      payload.trainingMode = wizardTrainingMode;
      if (isKontextConcept) {
        // For concept mode, send the control set (embellishment) ID
        payload.controlSetId = wizardControlSetId;
      }
    }

    // Read advanced overrides from DOM if present
    const advFields = { wizardSteps: 'steps', wizardLearningRate: 'learningRate', wizardBatchSize: 'batchSize', wizardResolution: 'resolution', wizardLoraRank: 'loraRank', wizardLoraAlpha: 'loraAlpha', wizardLoraDropout: 'loraDropout' };
    for (const [domName, key] of Object.entries(advFields)) {
      const el = this.modalElement.querySelector(`[name="${domName}"]`);
      if (el && el.value !== '') payload[key] = el.value;
    }

    // Calculate cost
    const cost = await this.calculateTrainingCost(payload);
    payload.costPoints = cost;
    const confirmed = confirm(`Training will cost ${cost} points. Continue?`);
    if (!confirmed) return;

    this.setState({ submitting: true });
    try {
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();
      const res = await fetch('/api/v1/trainings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Training failed: ${res.status}`);
      this.wizardCancel();
      this.setState({ submitting: false });
      this.fetchTrainings();
    } catch (err) {
      console.error('[ModsMenuModal] submitWizard error', err);
      this.setState({ submitting: false });
      alert('Failed to start training. Please try again.');
    }
  }

  /* ====================== TRAIN DASHBOARD ====================== */

  renderTrainDashboard() {
    const { datasets, trainings, loadingTrain, trainError } = this.state;
    const ACTIVE_STATUSES = ['QUEUED', 'PROVISIONING', 'RUNNING', 'FINALIZING'];
    const activeTrainings = trainings.filter(t => ACTIVE_STATUSES.includes(t.status));
    const historyTrainings = trainings.filter(t => !ACTIVE_STATUSES.includes(t.status));

    // Active Trainings section
    const activeSection = activeTrainings.length ? `
      <div class="active-trainings-section">
        ${activeTrainings.map(tr => {
          const progressText = tr.currentStep && tr.totalSteps
            ? `${tr.currentStep}/${tr.totalSteps} (${tr.progress || 0}%)`
            : `${tr.progress || 0}%`;
          const statusLower = (tr.status || 'draft').toLowerCase();
          return `<div class="active-training-card status-border-${statusLower}" data-id="${tr._id}">
            <div class="training-header">
              <h4>${tr.name || 'Unnamed Training'}</h4>
              <span class="status-badge status-${statusLower}">${tr.status || 'draft'}</span>
            </div>
            <div class="detail-item">
              <span class="label">Model:</span>
              <span class="value">${tr.baseModel || 'Unknown'}</span>
            </div>
            <div class="detail-item">
              <span class="label">Progress:</span>
              <div class="progress-bar"><div class="progress-fill" style="width: ${tr.progress || 0}%"></div></div>
              <span class="progress-text">${progressText}</span>
            </div>
            <div class="training-actions">
              <button class="btn-secondary view-details" data-id="${tr._id}">Details</button>
              ${tr.status === 'QUEUED' ? `<button class="btn-danger cancel-training" data-id="${tr._id}">Cancel</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>` : '';

    // Datasets (compact grid)
    const datasetGrid = loadingTrain ? '<div class="loading-spinner">Loading...</div>' : trainError ? `<div class="error-message">${trainError}</div>` :
      datasets.length ? `<div class="wizard-dataset-grid compact">
        ${datasets.map(ds => {
          const dsId = this.normalizeId(ds._id);
          const imgCount = (ds.images || []).length;
          // Count caption sets for this dataset
          const captionBadge = ds.captionSetCount != null ? ds.captionSetCount : '';
          return `<div class="compact-dataset-card" data-id="${dsId}">
            <div class="dataset-preview">
              ${(ds.images || []).slice(0, 2).map(img => `<img src="${img}" class="preview-thumb" />`).join('')}
            </div>
            <div class="compact-dataset-info">
              <h4>${ds.name || 'Unnamed'}</h4>
              <span class="wizard-card-meta">${imgCount} img${captionBadge ? ` &middot; ${captionBadge} cap sets` : ''}</span>
            </div>
            <div class="dataset-actions">
              <button class="btn-secondary view-dataset" data-id="${dsId}">View</button>
              <button class="btn-secondary edit-dataset" data-id="${dsId}">Edit</button>
              <button class="btn-primary use-dataset" data-id="${dsId}">Train</button>
            </div>
          </div>`;
        }).join('')}
      </div>` : '<div class="empty-message">No datasets yet.</div>';

    // History
    const historyHtml = historyTrainings.length ? `<div class="history-section">
      ${historyTrainings.map(tr => {
        const statusLower = (tr.status || 'draft').toLowerCase();
        const hfLink = tr.modelRepoUrl ? `<a href="${tr.modelRepoUrl}" target="_blank" class="hf-link">HF</a>` : '';
        const date = tr.completedAt ? new Date(tr.completedAt).toLocaleDateString() : '';
        return `<div class="history-item" data-id="${tr._id}">
          <span class="status-badge status-${statusLower}">${tr.status || 'draft'}</span>
          <span class="history-name">${tr.name || 'Unnamed'}</span>
          <span class="history-model">${tr.baseModel || ''}</span>
          <span class="history-date">${date}</span>
          ${hfLink}
          <div class="training-actions">
            <button class="btn-secondary view-details" data-id="${tr._id}">Details</button>
            ${tr.status === 'FAILED' ? `<button class="btn-primary retry-training" data-id="${tr._id}">Retry</button>` : ''}
            <button class="btn-danger delete-training" data-id="${tr._id}">Delete</button>
          </div>
        </div>`;
      }).join('')}
    </div>` : '<div class="empty-message">No training history yet.</div>';

    return `
      <div class="dashboard-header-bar">
        <h2>Training Studio</h2>
        <div class="dashboard-actions-bar">
          <button class="add-training-btn btn-primary">+ New Training</button>
          <button class="add-dataset-btn btn-secondary">+ New Dataset</button>
        </div>
      </div>
      ${activeTrainings.length ? `<div class="train-section active-section-wrapper">
        <div class="train-section-header"><h3>Active Trainings</h3><span class="active-count-badge">${activeTrainings.length}</span></div>
        ${activeSection}
      </div>` : ''}
      <div class="dashboard-bottom">
        <div class="train-section">
          <div class="train-section-header"><h3>Datasets</h3><span class="section-count">${datasets.length}</span></div>
          ${datasetGrid}
        </div>
        <div class="train-section">
          <div class="train-section-header"><h3>History</h3><span class="section-count">${historyTrainings.length}</span></div>
          ${historyHtml}
        </div>
      </div>`;
  }

  renderDatasetDetailView() {
    const { selectedDatasetId, captionSets, loadingCaptions, captionError } = this.state;
    const dataset = this.getDatasetById(selectedDatasetId);
    if (!dataset) return '<div class="error-message">Dataset not found.</div>';

    const images = dataset.images || [];
    const tags = (dataset.tags || '').split(',').map(t => t.trim()).filter(Boolean);

    // Header
    const header = `
      <div class="detail-header">
        <div class="detail-header-left">
          <button class="btn-secondary detail-back-btn">&larr; Back</button>
          <h3>${this.escapeHtml(dataset.name || 'Unnamed Dataset')}</h3>
        </div>
        <div>
          <button class="btn-secondary detail-edit-btn" data-id="${selectedDatasetId}">Edit</button>
          <button class="btn-primary detail-train-btn" data-id="${selectedDatasetId}">Train</button>
        </div>
      </div>`;

    // Description & tags
    const descHtml = dataset.description
      ? `<p class="detail-description">${this.escapeHtml(dataset.description)}</p>` : '';
    const tagsHtml = tags.length
      ? `<div class="detail-tags">${tags.map(t => `<span class="detail-tag">${this.escapeHtml(t)}</span>`).join('')}</div>` : '';

    // Images gallery
    const galleryHtml = images.length
      ? `<div class="detail-section">
          <h3>Images <span class="section-count">${images.length}</span></h3>
          <div class="detail-image-gallery">
            ${images.map(url => `<img src="${url}" class="detail-gallery-thumb" />`).join('')}
          </div>
        </div>`
      : `<div class="detail-section"><h3>Images</h3><div class="empty-message">No images in this dataset.</div></div>`;

    // Caption sets
    let captionHtml = '';
    if (loadingCaptions) {
      captionHtml = '<div class="loading-spinner">Loading captions...</div>';
    } else if (captionError) {
      captionHtml = `<div class="error-message">${captionError}</div>`;
    } else if (captionSets.length) {
      captionHtml = `<div class="detail-caption-list">
        ${captionSets.map(cs => {
          const csId = this.normalizeId(cs._id);
          const isDefault = cs.isDefault;
          return `<div class="detail-caption-card" data-id="${csId}">
            <div>
              <span class="detail-caption-method">${this.escapeHtml(cs.method || cs.spellSlug || 'Unknown')}</span>
              ${isDefault ? '<span class="default-badge">Default</span>' : ''}
              <div class="detail-caption-meta">${cs.captions ? cs.captions.length : 0} captions &middot; ${cs.createdAt ? new Date(cs.createdAt).toLocaleDateString() : ''}</div>
            </div>
            <div class="detail-caption-actions">
              <button class="btn-secondary view-caption" data-id="${csId}">Inspect</button>
              <button class="btn-secondary download-caption" data-id="${csId}">Download</button>
              ${!isDefault ? `<button class="btn-secondary set-default" data-id="${csId}">Set Default</button>` : ''}
              <button class="btn-danger delete-caption" data-id="${csId}">Delete</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    } else {
      captionHtml = '<div class="empty-message">No caption sets yet.</div>';
    }

    // Progress panel (reuse existing)
    const progressHtml = this.renderCaptionProgressPanel();

    // Control sets (from embellishments)
    const controlSets = (dataset.embellishments || []).filter(e => e.type === 'control');
    let controlHtml = '';
    if (controlSets.length) {
      controlHtml = `<div class="detail-control-list">
        ${controlSets.map(cs => {
          const csId = this.normalizeId(cs._id);
          const resultCount = (cs.results || []).filter(r => r && r.value).length;
          const createdAt = cs.createdAt ? new Date(cs.createdAt).toLocaleDateString() : '';
          return `<div class="detail-control-card" data-id="${csId}">
            <div>
              <span class="detail-control-method">${this.escapeHtml(cs.method || 'Control Images')}</span>
              <div class="detail-control-meta">${resultCount} images &middot; ${cs.status || 'unknown'} &middot; ${createdAt}</div>
            </div>
            <div class="detail-control-actions">
              <button class="btn-secondary view-control" data-id="${csId}">Inspect</button>
              <button class="btn-danger delete-control" data-id="${csId}">Delete</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    } else {
      controlHtml = '<div class="empty-message">No control image sets yet.</div>';
    }

    return `
      ${header}
      ${descHtml}
      ${tagsHtml}
      ${galleryHtml}
      <div class="detail-section">
        <div class="train-section-header">
          <h3>Caption Sets <span class="section-count">${captionSets.length}</span></h3>
          <button class="btn-primary detail-generate-captions-btn">Generate Captions</button>
        </div>
        ${progressHtml}
        ${captionHtml}
      </div>
      <div class="detail-section">
        <div class="train-section-header">
          <h3>Control Images <span class="section-count">${controlSets.length}</span></h3>
          <button class="btn-primary detail-generate-control-btn">Generate Control Images</button>
        </div>
        ${controlHtml}
      </div>`;
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

  async deleteTraining(trainingId) {
    const training = this.state.trainings.find(t => t._id === trainingId);
    const confirmed = confirm(`Delete training "${training?.name || trainingId}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();

      const response = await fetch(`/api/v1/trainings/${trainingId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        }
      });

      if (!response.ok) {
        throw new Error(`Delete failed: ${response.status}`);
      }

      this.fetchTrainings(); // Refresh the list
    } catch (error) {
      console.error('Failed to delete training:', error);
      this.setState({ formError: 'Failed to delete training' });
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
  getModelDefaults(modelType, trainingMode = null) {
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
          steps: 4000,
          learningRate: 0.0001,
          loraRank: 32,
          loraAlpha: 32,
          loraDropout: 0.05
        };
      case 'KONTEXT':
        return {
          steps: 3000,
          learningRate: 0.0001,
          loraRank: 16,
          loraAlpha: 16,
          loraDropout: 0.05,
          resolution: '512,768'
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

  triggerFileDownload(blob, fileName) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  sanitizeFilenamePart(value, fallback = 'file') {
    const raw = (value || '').toString().trim().toLowerCase();
    const collapsed = raw.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return collapsed || fallback;
  }

  resolveImageUrl(source){
    if(!source) return '';
    if(typeof source === 'string') return source;
    if(typeof source === 'object'){
      return source.imageUrl || source.url || source.src || source.path || '';
    }
    return '';
  }

  extractImageFilename(source){
    if(!source) return '';
    let candidate = '';
    let context = '';
    if (typeof source === 'string') {
      candidate = source;
      context = source;
    } else if (typeof source === 'object') {
      candidate =
        source.imageFilename ||
        source.imageName ||
        source.filename ||
        source.fileName ||
        source.name ||
        source.originalFilename ||
        source.originalFileName ||
        source.imageUrl ||
        source.url ||
        source.src ||
        source.path ||
        '';
      context =
        source.imageUrl ||
        source.url ||
        source.src ||
        source.path ||
        candidate;
    }
    if(!candidate) return '';
    const withoutQuery = candidate.split('?')[0].split('#')[0];
    const decoded = this.safeDecodeURIComponent(withoutQuery);
    const parts = decoded.split('/');
    const filename = parts.length ? parts.pop() : decoded;
    return this.stripStoragePrefix((filename || '').trim(), context || decoded);
  }

  stripFileExtension(name = ''){
    return name.replace(/\.[^.]+$/, '').trim();
  }

  stripStoragePrefix(filename = '', source = ''){
    if(!filename) return '';
    const cleaned = filename.replace(/^[/\\]+/, '');
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i;
    const match = cleaned.match(uuidPattern);
    if(match && match[1]){
      const shouldStrip = this.sourceLooksLikeInternalUpload(source) || !source;
      if(shouldStrip){
        return match[1];
      }
    }
    const slashIdx = cleaned.indexOf('/');
    if(slashIdx !== -1){
      const remainder = cleaned.slice(slashIdx + 1);
      const nestedMatch = remainder.match(uuidPattern);
      if(nestedMatch && nestedMatch[1] && (this.sourceLooksLikeInternalUpload(source) || !source)){
        return nestedMatch[1];
      }
      return remainder;
    }
    return cleaned;
  }

  sourceLooksLikeInternalUpload(source = ''){
    if(!source) return false;
    const value = source.toString();
    if(/web-upload-user/i.test(value)) return true;
    if(/\/\/[^/]*(?:r2\.|\.r2|cloudflarestorage)/i.test(value)) return true;
    if(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i.test(value) && /(milady|stationthis|cloudflare|\.r2)/i.test(value)){
      return true;
    }
    return false;
  }

  safeDecodeURIComponent(value){
    try{
      return decodeURIComponent(value);
    }catch(err){
      return value;
    }
  }

  deriveCaptionFileBase(entry, idx) {
    const fallback = `image-${String(idx + 1).padStart(3, '0')}`;
    const candidate =
      this.stripFileExtension(entry?.imageFilename || '') ||
      this.stripFileExtension(this.extractImageFilename(entry?.imageUrl)) ||
      '';
    if (!candidate) return fallback;
    return candidate;
  }

  buildCaptionTextFiles(entries) {
    const used = new Set();
    return entries.map((entry, idx) => {
      const base = this.deriveCaptionFileBase(entry, idx);
      let name = `${base}.txt`;
      let counter = 2;
      while (used.has(name)) {
        name = `${base}-${counter++}.txt`;
      }
      used.add(name);
      return { name, content: (entry?.text || '').toString() };
    });
  }

  createZipFromTextFiles(files) {
    if (!files?.length) return null;
    if (typeof TextEncoder === 'undefined') {
      console.error('TextEncoder not available for caption export.');
      return null;
    }
    const encoder = new TextEncoder();
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;
    let centralSize = 0;
    const timestamp = this.getMsDosDateTimeParts();

    files.forEach(file => {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = encoder.encode(file.content || '');
      const crc = this.computeCrc32(dataBytes);

      const localHeader = new ArrayBuffer(30);
      const localView = new DataView(localHeader);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 0x0014, true);
      localView.setUint16(6, 0, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, timestamp.time, true);
      localView.setUint16(12, timestamp.date, true);
      localView.setUint32(14, crc >>> 0, true);
      localView.setUint32(18, dataBytes.length, true);
      localView.setUint32(22, dataBytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);

      const localHeaderBytes = new Uint8Array(localHeader);
      localChunks.push(localHeaderBytes, nameBytes, dataBytes);

      const centralHeader = new ArrayBuffer(46);
      const centralView = new DataView(centralHeader);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 0x0014, true);
      centralView.setUint16(6, 0x0014, true);
      centralView.setUint16(8, 0, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, timestamp.time, true);
      centralView.setUint16(14, timestamp.date, true);
      centralView.setUint32(16, crc >>> 0, true);
      centralView.setUint32(20, dataBytes.length, true);
      centralView.setUint32(24, dataBytes.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);

      const centralHeaderBytes = new Uint8Array(centralHeader);
      centralChunks.push(centralHeaderBytes, nameBytes.slice());
      centralSize += centralHeaderBytes.length + nameBytes.length;

      offset += localHeaderBytes.length + nameBytes.length + dataBytes.length;
    });

    const footer = new ArrayBuffer(22);
    const footerView = new DataView(footer);
    footerView.setUint32(0, 0x06054b50, true);
    footerView.setUint16(4, 0, true);
    footerView.setUint16(6, 0, true);
    footerView.setUint16(8, files.length, true);
    footerView.setUint16(10, files.length, true);
    footerView.setUint32(12, centralSize, true);
    footerView.setUint32(16, offset, true);
    footerView.setUint16(20, 0, true);

    return new Blob([...localChunks, ...centralChunks, new Uint8Array(footer)], { type: 'application/zip' });
  }

  getMsDosDateTimeParts(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    return {
      date: dosDate & 0xffff,
      time: dosTime & 0xffff,
    };
  }

  getCrc32Table() {
    if (this._crcTable) return this._crcTable;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let j = 0; j < 8; j += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    this._crcTable = table;
    return table;
  }

  computeCrc32(bytes) {
    const table = this.getCrc32Table();
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
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

  handleEmbellishmentProgressEvent(data = {}) {
    const { taskId, datasetId, embellishmentType, status, progress = {} } = data;
    const id = this.normalizeId(datasetId);
    if (!id || !taskId) return;

    const dataset = this.getDatasetById(id);
    const prev = this.state.embellishmentTasks[taskId] || {};

    // Map backend status to UI status
    let uiStatus = 'running';
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      uiStatus = status;
    } else if (status === 'started') {
      uiStatus = 'running';
    }

    const task = {
      taskId,
      datasetId: id,
      datasetName: dataset?.name || prev.datasetName || 'Dataset',
      embellishmentType: embellishmentType || prev.embellishmentType || 'caption',
      total: progress.total || prev.total || 0,
      completedCount: progress.completed || prev.completedCount || 0,
      failedCount: progress.failed || prev.failedCount || 0,
      status: uiStatus,
      updatedAt: Date.now(),
    };

    if (uiStatus !== 'running') {
      task.completedAt = Date.now();
    }

    this.setEmbellishmentTask(taskId, task);

    if (uiStatus !== 'running') {
      this.scheduleEmbellishmentTaskCleanup(taskId);
    }
  }

  setEmbellishmentTask(taskId, task) {
    if (!taskId) return;
    const next = { ...this.state.embellishmentTasks };
    if (task) next[taskId] = task;
    else delete next[taskId];
    this.setState({ embellishmentTasks: next });
  }

  scheduleEmbellishmentTaskCleanup(taskId, delay = 8000) {
    if (!taskId) return;
    this._embellishmentTaskCleanupTimers = this._embellishmentTaskCleanupTimers || {};
    if (this._embellishmentTaskCleanupTimers[taskId]) {
      clearTimeout(this._embellishmentTaskCleanupTimers[taskId]);
    }
    this._embellishmentTaskCleanupTimers[taskId] = setTimeout(() => {
      delete this._embellishmentTaskCleanupTimers[taskId];
      const task = this.state.embellishmentTasks[taskId];
      if (task && task.status !== 'running') {
        this.setEmbellishmentTask(taskId, null);
      }
    }, delay);
  }

  renderCaptionProgressPanel() {
    const selectedId = this.normalizeId(this.state.selectedDatasetId);

    // Collect legacy caption tasks
    const captionEntries = Object.values(this.state.captionTasks || {}).filter(task => {
      if (!task) return false;
      if (task.status === 'running') return true;
      return task.datasetId === selectedId;
    }).map(t => ({ ...t, _source: 'caption' }));

    // Collect embellishment tasks (for this dataset or running)
    const embellishmentEntries = Object.values(this.state.embellishmentTasks || {}).filter(task => {
      if (!task) return false;
      if (task.status === 'running') return true;
      return task.datasetId === selectedId;
    }).map(t => ({ ...t, _source: 'embellishment' }));

    const entries = [...captionEntries, ...embellishmentEntries];
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
    const isEmbellishment = task._source === 'embellishment';
    const percent = task.total ? Math.min(100, Math.round((Math.min(task.completedCount, task.total) / task.total) * 100)) : (task.status === 'completed' ? 100 : 0);

    // Determine status label based on task type and status
    let statusLabel;
    if (task.status === 'completed') {
      statusLabel = 'Completed';
    } else if (task.status === 'failed') {
      statusLabel = 'Failed';
    } else if (task.status === 'cancelled') {
      statusLabel = 'Cancelled';
    } else {
      // Running - show type-specific label
      const typeLabel = isEmbellishment ? this.getEmbellishmentTypeLabel(task.embellishmentType) : 'Captioning';
      statusLabel = `${typeLabel}…`;
    }

    // Build secondary text with count and failed info
    let secondary;
    if (task.status === 'running' && task.total) {
      secondary = `${task.completedCount}/${task.total} images`;
      if (task.failedCount > 0) {
        secondary += ` (${task.failedCount} failed)`;
      }
    } else {
      secondary = `${task.completedCount} images`;
      if (task.failedCount > 0) {
        secondary += ` (${task.failedCount} failed)`;
      }
    }

    const highlightClass = selectedId && task.datasetId === selectedId ? ' selected-dataset' : '';

    // Cancel button - use different data attribute for embellishment vs legacy caption tasks
    let actions = '';
    if (task.status === 'running') {
      if (isEmbellishment) {
        actions = `<button class="btn-danger cancel-embellishment-task" data-task-id="${task.taskId}" data-dataset-id="${task.datasetId}">Cancel</button>`;
      } else {
        actions = `<button class="btn-danger cancel-caption-task" data-id="${task.datasetId}">Cancel</button>`;
      }
    }

    // Method label - for legacy tasks use method, for embellishments use type
    const methodLabel = isEmbellishment
      ? this.getEmbellishmentTypeLabel(task.embellishmentType)
      : (task.method || '');

    return `
      <div class="caption-progress-card status-${task.status}${highlightClass}">
        <div class="caption-progress-top">
          <div>
            <div class="caption-progress-title">${this.escapeHtml(task.datasetName || 'Dataset')}</div>
            <div class="caption-progress-method">${this.escapeHtml(methodLabel)}</div>
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

  getEmbellishmentTypeLabel(type) {
    const labels = {
      caption: 'Captioning',
      control: 'Control Images',
      controlImage: 'Control Images',
      audio: 'Audio',
      video: 'Video',
    };
    return labels[type] || type || 'Processing';
  }

  bindDatasetCardEvents(root = this.modalElement) {
    if (!root) return;
    root.querySelectorAll('.dataset-card').forEach(card => {
      const datasetId = card.getAttribute('data-id');

      const editBtn = card.querySelector('.edit-dataset');
      if (editBtn) {
        editBtn.onclick = (e) => {
          e.stopPropagation();
          const dataset = this.getDatasetById(datasetId);
          if (dataset) this.openDatasetForm(dataset);
        };
      }

      const useBtn = card.querySelector('.use-dataset');
      if (useBtn) {
        useBtn.onclick = (e) => {
          e.stopPropagation();
          this.openWizard(datasetId);
        };
      }

      const deleteBtn = card.querySelector('.delete-dataset');
      if (deleteBtn) {
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
          this.deleteDataset(datasetId);
        };
      }

      card.addEventListener('click', (e) => {
        if (e.target.closest('.dataset-actions')) return;
        const id = card.getAttribute('data-id');
        if (id !== this.state.selectedDatasetId) {
          this.setState({ selectedDatasetId: id, captionSets: [] }, () => {
            const btn = this.modalElement.querySelector('.add-caption-btn');
            if (btn) btn.removeAttribute('disabled');
          });
          this.fetchCaptionSets(id);
        }
      });
    });
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
      const selectedId = this.normalizeId(this.state.selectedDatasetId);
      grid.innerHTML = filteredDatasets.map(ds=>{
        const dsId = this.normalizeId(ds._id);
        const isSelected = selectedId && dsId === selectedId;
        return `
        <div class="dataset-card${isSelected?' selected':''}" data-id="${dsId}">
          <div class="dataset-header">
            <h4>${ds.name||'Unnamed Dataset'}</h4>
            ${isSelected?'<span class="selected-indicator">Selected</span>':''}
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
      this.bindDatasetCardEvents(grid);
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
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();

      const response = await fetch('/api/v1/trainings/calculate-cost', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify(formValues)
      });

      if (!response.ok) {
        throw new Error(`Cost calculation failed: ${response.status}`);
      }

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
    let trainingCost = 0;
    if (formMode === 'new-training' || formMode === 'edit-training') {
      trainingCost = await this.calculateTrainingCost(formValues);
      const confirmed = confirm(`Training will cost ${trainingCost} points. Continue?`);
      if (!confirmed) {
        this.setState({ submitting: false });
        return;
      }
    }

    try{
      let url='',method='POST',payload={...formValues};

      // Add cost to training payload
      if (formMode === 'new-training' || formMode === 'edit-training') {
        payload.costPoints = trainingCost;
      }
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
    // Show choice dialog: Write manually or Generate with AI
    const overlay=document.createElement('div');
    overlay.className='import-overlay';
    overlay.innerHTML=`<div class="import-dialog caption-choice-dialog">
      <h3>Add Captions</h3>
      <p class="caption-choice-desc">How would you like to caption this dataset?</p>
      <div class="caption-choice-options">
        <button class="caption-choice-btn caption-choice-manual">
          <span class="caption-choice-icon">✏️</span>
          <span class="caption-choice-label">Write Manually</span>
          <span class="caption-choice-hint">Create captions yourself for each image</span>
        </button>
        <button class="caption-choice-btn caption-choice-ai">
          <span class="caption-choice-icon">✨</span>
          <span class="caption-choice-label">Generate with AI</span>
          <span class="caption-choice-hint">Use a captioning spell to auto-generate</span>
        </button>
      </div>
      <div class="btn-row"><button class="cancel-choice-btn">Cancel</button></div>
    </div>`;
    document.body.appendChild(overlay);

    const cleanup=()=>{document.body.removeChild(overlay);};
    overlay.querySelector('.cancel-choice-btn').onclick=cleanup;
    overlay.onclick=(e)=>{if(e.target===overlay) cleanup();};

    overlay.querySelector('.caption-choice-manual').onclick=()=>{
      cleanup();
      this.createManualCaptions(initialDatasetId);
    };
    overlay.querySelector('.caption-choice-ai').onclick=()=>{
      cleanup();
      this.generateCaptionSetWithAI(initialDatasetId);
    };
  }

  async createManualCaptions(datasetId){
    const dataset = this.getDatasetById(datasetId);
    if(!dataset || !dataset.images?.length){
      alert('Dataset has no images.');
      return;
    }

    try {
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();
      const masterAccountId = await this.getCurrentMasterAccountId();

      const res = await fetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/embellishments/manual`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ masterAccountId, type: 'caption' })
      });

      if (!res.ok) throw new Error('Failed to create caption set');
      const { data } = await res.json();

      // Open editable caption viewer
      this.openEditableCaptionViewer(datasetId, data.embellishmentId, dataset.images);
    } catch (err) {
      console.error('[ModsMenuModal] createManualCaptions error', err);
      alert('Failed to create caption set. Please try again.');
    }
  }

  openEditableCaptionViewer(datasetId, embellishmentId, images){
    const overlay = document.createElement('div');
    overlay.className = 'import-overlay caption-viewer-overlay';

    overlay.innerHTML = `<div class="import-dialog caption-editor-dialog">
      <div class="caption-viewer-header">
        <h3>Edit Captions</h3>
        <button class="caption-viewer-close" aria-label="Close">×</button>
      </div>
      <div class="caption-viewer-meta">
        <span>${images.length} images</span>
        <span class="caption-save-status"></span>
      </div>
      <div class="caption-viewer-list">
        ${images.map((img, idx) => {
          const imageUrl = this.resolveImageUrl(img);
          return `
          <div class="caption-viewer-row">
            ${imageUrl ? `<img src="${this.escapeHtml(imageUrl)}" alt="Image ${idx+1}" />` : `<div class="caption-thumb placeholder">#${idx+1}</div>`}
            <div class="caption-text-block">
              <div class="caption-row-title">Image ${idx+1}</div>
              <textarea data-caption-idx="${idx}" placeholder="Enter caption for this image..."></textarea>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="btn-row">
        <button class="btn-secondary caption-save-btn">Save All</button>
        <button class="btn-primary caption-done-btn">Done</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);

    const cleanup = () => { if(overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    overlay.addEventListener('click', (e) => { if(e.target === overlay) cleanup(); });
    overlay.querySelector('.caption-viewer-close').onclick = cleanup;
    overlay.querySelector('.caption-done-btn').onclick = async () => {
      await this.saveEditableCaptions(overlay, datasetId, embellishmentId, images.length);
      cleanup();
      this.fetchCaptionSets(datasetId);
    };
    overlay.querySelector('.caption-save-btn').onclick = async () => {
      await this.saveEditableCaptions(overlay, datasetId, embellishmentId, images.length);
    };
  }

  async saveEditableCaptions(overlay, datasetId, embellishmentId, imageCount){
    const statusEl = overlay.querySelector('.caption-save-status');
    const textareas = overlay.querySelectorAll('textarea[data-caption-idx]');
    const results = [];

    for (let i = 0; i < imageCount; i++) {
      const textarea = overlay.querySelector(`textarea[data-caption-idx="${i}"]`);
      results.push(textarea ? textarea.value : null);
    }

    try {
      statusEl.textContent = 'Saving...';
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();
      const masterAccountId = await this.getCurrentMasterAccountId();

      const res = await fetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/embellishments/${encodeURIComponent(embellishmentId)}/results`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ masterAccountId, results })
      });

      if (!res.ok) throw new Error('Save failed');
      statusEl.textContent = 'Saved!';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    } catch (err) {
      console.error('[ModsMenuModal] saveEditableCaptions error', err);
      statusEl.textContent = 'Save failed';
    }
  }

  async generateCaptionSetWithAI(initialDatasetId){
    const overlay=document.createElement('div');
    overlay.className='import-overlay';

    const normalizedInitialId = this.normalizeId(initialDatasetId);
    const dsOptions=this.state.datasets.map(d=>{
      const value=this.normalizeId(d._id);
      return `<option value="${value}" ${value===normalizedInitialId?'selected':''}>${d.name}</option>`;
    }).join('');

    // Fetch embellishment spells instead of marketplace spells
    let embellishmentSpells = [];
    try {
      const res = await fetch('/api/v1/datasets/embellishment-spells?type=caption', { credentials: 'include' });
      console.log('[ModsMenuModal] embellishment-spells response status:', res.status);
      if (res.ok) {
        const json = await res.json();
        console.log('[ModsMenuModal] embellishment-spells response:', JSON.stringify(json, null, 2));
        embellishmentSpells = json.data || [];
        console.log('[ModsMenuModal] embellishmentSpells count:', embellishmentSpells.length);
        if (embellishmentSpells.length > 0) {
          console.log('[ModsMenuModal] First spell embellishment:', JSON.stringify(embellishmentSpells[0]?.embellishment, null, 2));
        }
      }
    } catch (err) {
      console.warn('[ModsMenuModal] Failed to fetch embellishment spells', err);
    }

    // Fallback to old method if no embellishment spells found
    if (!embellishmentSpells.length) {
      if(!this.state.captionerSpells.length){ await this.fetchCaptionerSpells(); }
      embellishmentSpells = this.state.captionerSpells.map(s => ({
        slug: s.slug || s.spellId,
        name: s.name || s.displayName,
        embellishment: { instructions: 'Enter your trigger word below if using one.', userInputs: [] }
      }));
    }

    const spellOpts = embellishmentSpells.length
      ? embellishmentSpells.map(s => `<option value="${s.slug}" data-idx="${embellishmentSpells.indexOf(s)}">${s.name}</option>`).join('')
      : '<option value="">(no caption spells found)</option>';

    overlay.innerHTML=`<div class="import-dialog caption-generator-dialog"><h3>Generate Captions with AI</h3>
      <label>Dataset:<br><select class="cap-dataset">${dsOptions}</select></label><br>
      <label>Caption Spell:<br><select class="cap-method">${spellOpts}</select></label>
      <div class="cap-instructions"></div>
      <div class="cap-user-inputs"></div>
      <div class="error-message" style="display:none"></div>
      <div class="btn-row"><button class="confirm-generate-btn">Generate</button><button class="cancel-generate-btn">Cancel</button></div>
    </div>`;
    document.body.appendChild(overlay);

    const errEl=overlay.querySelector('.error-message');
    const cleanup=()=>{document.body.removeChild(overlay);};
    overlay.querySelector('.cancel-generate-btn').onclick=cleanup;
    overlay.onclick=(e)=>{if(e.target===overlay) cleanup();};

    const instructionsEl = overlay.querySelector('.cap-instructions');
    const userInputsEl = overlay.querySelector('.cap-user-inputs');
    const methodSelect = overlay.querySelector('.cap-method');

    // Render instructions and user inputs for selected spell
    const renderSpellUI = (spellIdx) => {
      const spell = embellishmentSpells[spellIdx];
      const emb = spell?.embellishment || {};

      // Show instructions
      if (emb.instructions) {
        instructionsEl.innerHTML = `<div class="cap-instructions-text">${this.escapeHtml(emb.instructions)}</div>`;
      } else {
        instructionsEl.innerHTML = '';
      }

      // Show user inputs
      const userInputs = emb.userInputs || [];
      if (userInputs.length) {
        userInputsEl.innerHTML = userInputs.map(input => `
          <div class="cap-user-input">
            <label>${this.escapeHtml(input.label || input.key)}${input.required ? ' <span class="required">*</span>' : ''}</label>
            <input type="text" class="cap-input-field" data-key="${this.escapeHtml(input.key)}" placeholder="${this.escapeHtml(input.placeholder || '')}" />
            ${input.description ? `<div class="cap-input-hint">${this.escapeHtml(input.description)}</div>` : ''}
          </div>
        `).join('');
      } else {
        userInputsEl.innerHTML = '';
      }
    };

    // Initial render
    const initialIdx = methodSelect.selectedOptions[0]?.dataset?.idx || 0;
    renderSpellUI(parseInt(initialIdx, 10));

    methodSelect.onchange = () => {
      const idx = methodSelect.selectedOptions[0]?.dataset?.idx || 0;
      renderSpellUI(parseInt(idx, 10));
    };

    overlay.querySelector('.confirm-generate-btn').onclick=async ()=>{
      const spellSlug=overlay.querySelector('.cap-method').value;
      if (!spellSlug) {
        errEl.textContent = 'Please select a caption spell';
        errEl.style.display = 'block';
        return;
      }

      // Collect parameter overrides from user inputs
      const parameterOverrides={};
      overlay.querySelectorAll('.cap-input-field').forEach(input=>{
        const key = input.dataset.key;
        const value = input.value.trim();
        if(key && value) {
          parameterOverrides[key] = value;
        }
      });

      overlay.querySelector('.confirm-generate-btn').disabled=true;
      try{
        const dsId=overlay.querySelector('.cap-dataset').value;
        const csrfRes=await fetch('/api/v1/csrf-token');
        const {csrfToken}=await csrfRes.json();
        const masterAccountId = await this.getCurrentMasterAccountId();

        // Use new embellishment API
        const payload={spellSlug, masterAccountId, parameterOverrides};
        const res=await fetch(`/api/v1/datasets/${encodeURIComponent(dsId)}/embellish`,{
          method:'POST',credentials:'include',headers:{'Content-Type':'application/json','x-csrf-token':csrfToken},
          body:JSON.stringify(payload)});

        if(!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || 'Generate failed');
        }

        // Get task info from response and show immediate progress
        const taskInfo = await res.json();
        if (taskInfo.taskId) {
          // Show immediate progress using embellishment task system
          this.handleEmbellishmentProgressEvent({
            taskId: taskInfo.taskId.toString(),
            datasetId: dsId,
            embellishmentType: taskInfo.type || 'caption',
            status: 'started',
            progress: {
              total: taskInfo.totalItems || 0,
              completed: 0,
              failed: 0
            }
          });
        }

        cleanup();
        this.fetchCaptionSets(dsId);
      }catch(err){
        errEl.textContent=err.message||'Generate failed';
        errEl.style.display='block';
        overlay.querySelector('.confirm-generate-btn').disabled=false;
      }
    };
  }

  async fetchSpellDefinition(primaryIdentifier, fallbackIdentifier = '') {
    const attempts = [primaryIdentifier, fallbackIdentifier].filter(Boolean);
    for (const key of attempts) {
      if (this._captionSpellCache[key]) {
        return this._captionSpellCache[key];
      }
    }
    for (const key of attempts) {
      try {
        const res = await fetch(`/api/v1/spells/registry/${encodeURIComponent(key)}`, {
          credentials: 'include',
          cache: 'no-store'
        });
        if (!res.ok) continue;
        const payload = await res.json();
        attempts.forEach(id => {
          if (id) this._captionSpellCache[id] = payload;
        });
        return payload;
      } catch (err) {
        console.warn('[ModsMenuModal] fetchSpellDefinition error', err);
      }
    }
    return null;
  }

  renderCaptionSpellPreview(definition) {
    if (!definition) {
      return '<div class="cap-spell-preview-empty">Spell inputs unavailable.</div>';
    }
    const rows = this.buildCaptionSpellInputSummaries(definition);
    const template = this.extractStringPrimitiveTemplate(definition);
    const rowsHtml = rows.length
      ? rows.map(row => `
        <div class="cap-spell-preview-row">
          <div class="cap-spell-preview-key">${this.escapeHtml(row.param)}</div>
          <div class="cap-spell-preview-note">
            <div class="cap-spell-preview-step">${this.escapeHtml(row.tool)}</div>
            <div class="cap-spell-preview-desc">${this.escapeHtml(row.note)}</div>
          </div>
        </div>`).join('')
      : '<div class="cap-spell-preview-empty">No exposed inputs detected.</div>';
    const templateHtml = template
      ? `<div class="cap-spell-template">
          <div class="cap-spell-template-label">String template (stringA)</div>
          <textarea readonly>${this.escapeHtml(template)}</textarea>
        </div>`
      : '';
    return `<div class="cap-spell-preview-body">${rowsHtml}${templateHtml}</div>`;
  }

  buildCaptionSpellInputSummaries(definition) {
    const rows = [];
    if (!definition) return rows;
    const stepsById = {};
    (definition.steps || []).forEach(step => {
      const key = step.stepId || step.id || step.nodeId;
      if (key) stepsById[key] = step;
    });

    const pushRow = (param, tool, note) => {
      rows.push({ param, tool, note });
    };

    const joyStep = (definition.steps || []).find(s => s.toolIdentifier === 'joycaption');
    const joyLabel = joyStep?.displayName || 'JoyCaption';
    pushRow('imageUrl', joyLabel, 'Automatically set to each dataset image.');

    const seen = new Set(['imageUrl']);
    const exposures = Array.isArray(definition.exposedInputs) ? definition.exposedInputs : [];
    exposures.forEach(exp => {
      const param = exp.paramKey || exp.param || '';
      if (!param || seen.has(`${exp.nodeId}:${param}`)) return;
      const toolLabel = stepsById[exp.nodeId]?.displayName || stepsById[exp.nodeId]?.toolIdentifier || 'Spell Step';
      let note = 'Provide this parameter below when creating the caption set.';
      if (param === 'imageUrl') {
        note = 'Automatically set to each dataset image.';
      } else if (param === 'stringB') {
        note = 'Trigger word replacement value. Set it below so xxx becomes your token.';
      }
      seen.add(`${exp.nodeId}:${param}`);
      pushRow(param, toolLabel, note);
    });

    return rows;
  }

  extractStringPrimitiveTemplate(definition) {
    if (!definition) return '';
    const step = (definition.steps || []).find(s => s.toolIdentifier === 'string-primitive');
    // Support both new (inputText) and legacy (stringA) parameter names
    const template = step?.parameterMappings?.inputText?.value ?? step?.parameterMappings?.stringA?.value;
    return typeof template === 'string' ? template : '';
  }

  normalizeCaptionEntries(captionSet, datasetId = this.state.selectedDatasetId){
    if(!captionSet) return [];
    const dataset = this.getDatasetById(datasetId);
    const datasetImages = dataset?.images || [];
    return (captionSet.captions || []).map((entry, idx) => {
      const datasetImageEntry = datasetImages[idx];
      const normalized = {
        imageUrl: this.resolveImageUrl(datasetImageEntry),
        imageFilename: this.extractImageFilename(datasetImageEntry),
        text: ''
      };
      if (typeof entry === 'string') {
        normalized.text = entry;
      } else if (entry && typeof entry === 'object') {
        normalized.text = entry.caption || entry.text || entry.description || '';
        normalized.imageUrl = entry.imageUrl || entry.url || normalized.imageUrl;
        normalized.imageFilename =
          entry.imageFilename ||
          entry.filename ||
          entry.fileName ||
          entry.imageName ||
          normalized.imageFilename;
      }
      if (!normalized.imageFilename) {
        normalized.imageFilename = this.extractImageFilename(normalized.imageUrl);
      }
      return normalized;
    });
  }

  openCaptionViewer(captionSet){
    if(!captionSet) return;
    const captionSetId = this.normalizeId(captionSet._id);
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
        <span class="caption-edit-hint">Click a caption to edit</span>
      </div>
      <div class="caption-viewer-list">
        ${entries.length? entries.map((entry,idx)=>`
          <div class="caption-viewer-row" data-idx="${idx}">
            ${entry.imageUrl?`<img src="${this.escapeHtml(entry.imageUrl)}" alt="Image ${idx+1}" />`:`<div class="caption-thumb placeholder">#${idx+1}</div>`}
            <div class="caption-text-block">
              <div class="caption-row-header">
                <span class="caption-row-title">Image ${idx+1}</span>
                <div class="caption-row-actions">
                  <button class="btn-small save-caption hidden" data-idx="${idx}">Save</button>
                  <button class="btn-small cancel-edit hidden" data-idx="${idx}">Cancel</button>
                </div>
              </div>
              <textarea data-caption-idx="${idx}" data-original=""></textarea>
            </div>
          </div>
        `).join('') : '<div class="empty-message">No captions available.</div>'}
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const cleanup=()=>{ if(overlay.parentNode){ overlay.parentNode.removeChild(overlay); } };
    overlay.addEventListener('click',(e)=>{ if(e.target===overlay) cleanup(); });
    overlay.querySelector('.caption-viewer-close').onclick=cleanup;

    // Initialize textareas
    overlay.querySelectorAll('textarea[data-caption-idx]').forEach(textarea=>{
      const idx=parseInt(textarea.getAttribute('data-caption-idx'),10);
      const text = entries[idx]?.text || '';
      textarea.value = text;
      textarea.setAttribute('data-original', text);

      // Enable editing on focus
      textarea.onfocus = () => {
        const row = textarea.closest('.caption-viewer-row');
        row.querySelectorAll('.save-caption, .cancel-edit').forEach(btn => btn.classList.remove('hidden'));
      };

      // Track changes
      textarea.oninput = () => {
        const original = textarea.getAttribute('data-original');
        const row = textarea.closest('.caption-viewer-row');
        const saveBtn = row.querySelector('.save-caption');
        if (textarea.value !== original) {
          saveBtn.classList.add('changed');
        } else {
          saveBtn.classList.remove('changed');
        }
      };
    });

    // Save caption handlers
    overlay.querySelectorAll('.save-caption').forEach(btn => {
      btn.onclick = async () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const textarea = overlay.querySelector(`textarea[data-caption-idx="${idx}"]`);
        const newText = textarea.value;

        btn.disabled = true;
        btn.textContent = 'Saving...';

        try {
          await this.updateCaption(captionSetId, idx, newText);
          textarea.setAttribute('data-original', newText);
          btn.textContent = 'Saved!';
          btn.classList.remove('changed');
          setTimeout(() => {
            btn.textContent = 'Save';
            btn.disabled = false;
          }, 1500);
        } catch (err) {
          alert(`Failed to save: ${err.message}`);
          btn.textContent = 'Save';
          btn.disabled = false;
        }
      };
    });

    // Cancel edit handlers
    overlay.querySelectorAll('.cancel-edit').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const textarea = overlay.querySelector(`textarea[data-caption-idx="${idx}"]`);
        const original = textarea.getAttribute('data-original');
        textarea.value = original;
        textarea.blur();
        const row = textarea.closest('.caption-viewer-row');
        row.querySelectorAll('.save-caption, .cancel-edit').forEach(b => b.classList.add('hidden'));
        row.querySelector('.save-caption').classList.remove('changed');
      };
    });
  }

  async updateCaption(captionSetId, index, newText) {
    const datasetId = this.state.selectedDatasetId;
    if (!datasetId || !captionSetId) throw new Error('Missing IDs');

    const csrfRes = await fetch('/api/v1/csrf-token');
    const { csrfToken } = await csrfRes.json();

    const res = await fetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/captions/${encodeURIComponent(captionSetId)}/entries/${index}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ text: newText })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || 'Failed to update caption');
    }
  }

  downloadCaptionSet(captionSet){
    if(!captionSet) return;
    const entries = this.normalizeCaptionEntries(captionSet);
    if(!entries.length){
      alert('This caption set has no captions yet.');
      return;
    }
    const files = this.buildCaptionTextFiles(entries);
    const zipBlob = this.createZipFromTextFiles(files);
    if(!zipBlob){
      alert('Unable to prepare caption download. Please try again.');
      return;
    }
    const dataset = this.getDatasetById(this.state.selectedDatasetId);
    const datasetPart = this.sanitizeFilenamePart(dataset?.name || 'dataset', 'dataset');
    const methodPart = this.sanitizeFilenamePart(captionSet.method || 'captions', 'captions');
    const fileName = `${datasetPart}-${methodPart}-captions.zip`;
    this.triggerFileDownload(zipBlob, fileName);
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

  /* ====================== CONTROL SET METHODS ====================== */

  getControlSetById(controlSetId) {
    const dataset = this.getDatasetById(this.state.selectedDatasetId);
    if (!dataset || !dataset.embellishments) return null;
    const normalized = this.normalizeId(controlSetId);
    return dataset.embellishments.find(e => e.type === 'control' && this.normalizeId(e._id) === normalized);
  }

  openControlViewer(controlSetId) {
    const controlSet = this.getControlSetById(controlSetId);
    if (!controlSet) {
      alert('Control set not found');
      return;
    }

    const dataset = this.getDatasetById(this.state.selectedDatasetId);
    const images = dataset?.images || [];
    const results = controlSet.results || [];

    const overlay = document.createElement('div');
    overlay.className = 'import-overlay control-viewer-overlay';

    const createdAt = controlSet.createdAt ? new Date(controlSet.createdAt).toLocaleString() : '';
    const resultCount = results.filter(r => r && r.value).length;

    overlay.innerHTML = `<div class="import-dialog control-viewer-dialog">
      <div class="control-viewer-header">
        <h3>Control Images</h3>
        <button class="control-viewer-close" aria-label="Close">×</button>
      </div>
      <div class="control-viewer-meta">
        <span>${resultCount} of ${images.length} generated</span>
        <span>${this.escapeHtml(controlSet.method || '')}</span>
        <span>${createdAt}</span>
      </div>
      <div class="control-viewer-list">
        ${images.length ? images.map((imgUrl, idx) => {
          const result = results[idx];
          const controlUrl = result?.value || null;
          return `<div class="control-viewer-row" data-idx="${idx}">
            <div class="control-image-pair">
              <div class="control-image-box">
                <div class="control-image-label">Original</div>
                <img src="${this.escapeHtml(imgUrl)}" alt="Original ${idx + 1}" />
              </div>
              <div class="control-arrow">→</div>
              <div class="control-image-box">
                <div class="control-image-label">Control</div>
                ${controlUrl
                  ? `<img src="${this.escapeHtml(controlUrl)}" alt="Control ${idx + 1}" class="control-result-img" />`
                  : `<div class="control-placeholder">Not generated</div>`}
              </div>
            </div>
            <div class="control-row-actions">
              <button class="btn-secondary regenerate-control" data-idx="${idx}">Regenerate</button>
              ${controlUrl ? `<button class="btn-secondary replace-control" data-idx="${idx}">Replace</button>` : ''}
            </div>
          </div>`;
        }).join('') : '<div class="empty-message">No images in dataset.</div>'}
      </div>
    </div>`;

    document.body.appendChild(overlay);
    const cleanup = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
    overlay.querySelector('.control-viewer-close').onclick = cleanup;

    // Bind regenerate/replace buttons
    overlay.querySelectorAll('.regenerate-control').forEach(btn => {
      btn.onclick = async () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);

        // Check if controlSet has config stored
        let config = controlSet.config;
        if (!config || !config.prompt) {
          // Legacy control set - need to ask for concept
          const concept = prompt('This control set was created before config storage was added.\n\nPlease re-enter the concept description that was used to generate these control images:');
          if (!concept || !concept.trim()) {
            return; // User cancelled
          }
          config = { prompt: concept.trim() };
        }

        btn.disabled = true;
        btn.textContent = 'Regenerating...';
        try {
          await this.regenerateControlImage(controlSetId, idx, config);
          btn.textContent = 'Started!';
          setTimeout(() => {
            btn.textContent = 'Regenerate';
            btn.disabled = false;
          }, 2000);
        } catch (err) {
          alert(`Failed to regenerate: ${err.message}`);
          btn.textContent = 'Regenerate';
          btn.disabled = false;
        }
      };
    });
    overlay.querySelectorAll('.replace-control').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        this.openReplaceControlDialog(controlSetId, idx, cleanup);
      };
    });
  }

  openReplaceControlDialog(controlSetId, imageIndex, parentCleanup) {
    const url = prompt('Enter the URL of the replacement control image:');
    if (!url || !url.trim()) return;

    this.replaceControlImage(controlSetId, imageIndex, url.trim())
      .then(() => {
        alert('Control image replaced successfully');
        if (parentCleanup) parentCleanup();
        this.fetchDatasets().then(() => this.render());
      })
      .catch(err => {
        alert(`Failed to replace: ${err.message}`);
      });
  }

  async replaceControlImage(controlSetId, imageIndex, newUrl) {
    const datasetId = this.state.selectedDatasetId;
    if (!datasetId || !controlSetId) throw new Error('Missing IDs');

    const csrfRes = await fetch('/api/v1/csrf-token');
    const { csrfToken } = await csrfRes.json();

    const res = await fetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/embellishments/${encodeURIComponent(controlSetId)}/results/${imageIndex}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ value: newUrl })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || 'Failed to replace control image');
    }
  }

  async regenerateControlImage(controlSetId, imageIndex, config = null) {
    const datasetId = this.state.selectedDatasetId;
    if (!datasetId || !controlSetId) throw new Error('Missing IDs');

    const csrfRes = await fetch('/api/v1/csrf-token');
    const { csrfToken } = await csrfRes.json();

    const body = config ? { config } : {};

    const res = await fetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/embellishments/${encodeURIComponent(controlSetId)}/regenerate/${imageIndex}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || 'Failed to start regeneration');
    }

    return await res.json();
  }

  async deleteControlSet(controlSetId) {
    const datasetId = this.state.selectedDatasetId;
    if (!datasetId || !controlSetId) return;
    if (!confirm('Delete this control image set? This action cannot be undone.')) return;

    try {
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();

      const res = await fetch(`/api/v1/datasets/${encodeURIComponent(datasetId)}/embellishments/${encodeURIComponent(controlSetId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken }
      });

      if (!res.ok) throw new Error('Failed to delete');

      // Refresh datasets to update the view
      await this.fetchDatasets();
      this.render();
    } catch (err) {
      console.error('[ModsMenuModal] deleteControlSet error', err);
      alert('Failed to delete control set.');
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

  async cancelEmbellishmentTask(taskId, datasetId) {
    if (!taskId) return;
    const confirmed = confirm('Cancel this embellishment task?');
    if (!confirmed) return;
    try {
      const csrfRes = await fetch('/api/v1/csrf-token');
      const { csrfToken } = await csrfRes.json();
      const res = await fetch(`/api/v1/datasets/embellishment-tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({})
      });
      if (!res.ok) throw new Error('Failed');
      // Update local state to show cancelled status
      this.handleEmbellishmentProgressEvent({ taskId, datasetId, status: 'cancelled' });
      // Refresh embellishments list if viewing this dataset
      const normalizedId = this.normalizeId(datasetId);
      if (normalizedId && this.normalizeId(this.state.selectedDatasetId) === normalizedId) {
        this.fetchCaptionSets(normalizedId);
      }
    } catch (err) {
      console.error('[ModsMenuModal] cancelEmbellishmentTask error', err);
      alert('Failed to cancel embellishment task. Please try again.');
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
