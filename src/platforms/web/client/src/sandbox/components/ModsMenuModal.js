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
    if(this.state.rootTab==='train') this.fetchDatasets(); // prefetch
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

    // Category buttons
    const catButtons = categories.map(cat => {
      const active = cat === currentCategory;
      const count = counts[cat] != null ? ` (${counts[cat]})` : '';
      return `<button class="cat-btn${active ? ' active' : ''}" data-cat="${cat}">${cat}${count}</button>`;
    }).join('');

    // LoRA sub-category buttons (only when in loraRoot view)
    let loraCatBar = '';
    if (currentCategory === 'lora' && (view === 'loraRoot' || view === 'category')) {
      loraCatBar = '<div class="lora-cat-bar">' + (
        loraCategories.length ? loraCategories.map(cat => {
          const active = cat === currentLoraCategory;
          return `<button class="lora-sub-btn${active ? ' active' : ''}" data-loracat="${cat}">${cat}</button>`;
        }).join('') : (loading ? '<em>Loading…</em>' : '<em>No categories found</em>')
      ) + '</div>';
    }

    // Model list
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
        // Add an Import button for LoRA or Checkpoint categories
        const showImport = ['lora','checkpoint'].includes(currentCategory);
        const importButton = showImport ? '<button class="import-btn">＋ Import</button>' : '';
        const uid = window.currentUserId || null;
        const isPrivate = (m)=>{
          const raw=(m.path||m.save_path||'').toLowerCase();
          if(!raw) return false;
          const normalized = raw.replace(/\\/g,'/');
          const inPrivateDir = normalized.includes('checkpoints/users/');
          if(!inPrivateDir) return false;
          if(!uid) return true; // unknown user id – treat any private dir as private
          return normalized.includes(`checkpoints/users/${uid.toLowerCase()}/`);
        };
        // Filter out private checkpoints that belong to other users
        const visibleModels = models.filter(m=>{
          const p=(m.path||m.save_path||'').toLowerCase();
          if(!p.includes('checkpoints/users/')) return true; // public model
          if(!uid) return true; // no user context – show it (likely belongs to current user when SSR omitted id)
          return p.includes(`checkpoints/users/${uid.toLowerCase()}/`);
        });

        const sortModels = [...visibleModels].sort((a,b)=>{
          const privA = isPrivate(a);
          const privB = isPrivate(b);
          if(privA!==privB) return privA? -1:1; // private user models first

          const idA = this.getModelIdentifier(a);
          const idB = this.getModelIdentifier(b);
          const favA = favoriteIds.has(idA);
          const favB = favoriteIds.has(idB);
          if (favA === favB) return 0;
          return favA ? -1 : 1;
        });
        listHtml = '<ul class="mods-list">' + sortModels.map((m, idx) => {
          const id = this.getModelIdentifier(m);
          const isFav = favoriteIds.has(id);
          const heart = isFav ? '❤️' : '♡';
          const displayPath = m.path || m.name || m.save_path || 'unknown';
          const display = displayPath.split('/').pop();
          const size = m.size ? `${(m.size / (1024**2)).toFixed(1)} MB` : '';
          const isPriv = isPrivate(m);
          const lockSpan = isPriv ? `<span class="priv-icon">🔒</span>` : '';
          return `<li class="mods-item${isPriv ? ' private' : ''}" data-idx="${idx}"><span class="mods-title">${display}</span> <span class="mods-size">${size}</span> ${lockSpan} <button class="fav-btn" data-idx="${idx}">${heart}</button></li>`;
        }).join('') + '</ul>';
        // Extra tag bar
        const extraBar = extraTags.length ? `<div class="extra-tag-bar">` + extraTags.map(t => `<button class="extra-tag-btn" data-tag="${t}">${t}</button>`).join('') + `</div>` : '';
        listHtml = header + importButton + extraBar + listHtml;
      }
    }

    let mainContent = '';
    if(rootTab==='browse') {
      // base modal html
      this.modalElement.innerHTML = `
        <div class="mods-modal-container">
          <button class="close-btn" aria-label="Close">×</button>
          ${tabBar}
          <div class="mods-content">
            <h2>Model Browser</h2>
            <p class="intro-text">Browse the models currently available on StationThis. Select a category to see assets and click + to add.</p>
            <div class="mods-category-bar">${catButtons}</div>
            ${currentCategory === 'lora' ? loraCatBar : ''}
            ${view === 'category' ? listHtml : ''}
          </div>
        </div>`;

      // Attach category btn events
      this.modalElement.querySelectorAll('.cat-btn').forEach(btn => {
        btn.onclick = () => {
          const cat = btn.getAttribute('data-cat');
          if (cat === 'lora') {
            this.setState({ view: 'category', currentCategory: 'lora', currentLoraCategory: null, selectedTags: [], extraTags: [], models: [] });
            this.fetchLoraCategories();
            this.fetchModels('lora'); // load all LoRAs
            return;
          }
          this.setState({ view: 'category', currentCategory: cat, currentLoraCategory: null });
          this.fetchModels(cat);
        };
      });

      // LoRA sub-category events
      this.modalElement.querySelectorAll('.lora-sub-btn').forEach(btn => {
        btn.onclick = () => {
          const sub = btn.getAttribute('data-loracat');
          this.setState({ view: 'category', currentLoraCategory: sub });
          this.fetchModels('lora', sub);
        };
      });

      // Attach add buttons
      if (view === 'category') {
        // Row click to select
        this.modalElement.querySelectorAll('.mods-item').forEach(li => {
          li.onclick = (e) => {
            if (e.target.closest('.fav-btn')) return; // ignore clicks on heart
            const idx = Number(li.getAttribute('data-idx'));
            const model = this.state.models[idx];
            if (model) {
              this.setState({ view: 'detail', detailModel: model });
              }
          };
        });
        // Heart toggle handler
        this.modalElement.querySelectorAll('.fav-btn').forEach(btn => {
          btn.onclick = (e) => {
            e.stopPropagation();
            const idx = Number(btn.getAttribute('data-idx'));
            const model = this.state.models[idx];
            const category = this.state.currentCategory;
            this.toggleFavorite(model, category);
          };
        });
      }

      if (view === 'detail' && this.state.detailModel) {
        const m = this.state.detailModel;
        const tags = (m.tags || []).map(t => (typeof t==='string'?t:t.tag)).join(', ');
        const ratingAvg = (m.ratingAvg || 0).toFixed(2);
        const ratingStars = '★'.repeat(Math.round(m.ratingAvg || 0)) + '☆'.repeat(3-Math.round(m.ratingAvg||0));
        const html = `
          <div class="mods-detail">
            <button class="back-btn">← Back</button>
            <h3>${m.name || m.slug}</h3>
            <div class="rating-display">${ratingStars} <small>(${ratingAvg})</small></div>
            <p><strong>Checkpoint:</strong> ${m.checkpoint || 'n/a'}</p>
            <p><strong>Trigger:</strong> ${(m.triggerWords||[]).join(', ')}</p>
            ${m.cognates && m.cognates.length ? `<p><strong>Cognates:</strong> ${m.cognates.map(c=>c.word).join(', ')}</p>` : ''}
            <p><strong>Tags:</strong> ${tags}</p>
            <button class="add-tag-btn">+ Tag</button>
            <button class="rate-btn">Rate ★</button>
            <button class="select-btn">Use</button>
          </div>`;
        this.modalElement.querySelector('.mods-content').innerHTML = html;
        this.modalElement.querySelector('.back-btn').onclick = () => {
          this.setState({ view: 'category', detailModel: null });
          this.render();
        };
        this.modalElement.querySelector('.select-btn').onclick = () => {
          this.onSelect(m);
          this.hide();
        };
        const userId = window.currentUserId || null;
        const modelId = m._id || m.id || m.slug;

        const addTagBtn = this.modalElement.querySelector('.add-tag-btn');
        addTagBtn.onclick = async () => {
          const newTag = prompt('Add tag');
          if (!newTag) return;
          try {
            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();
            await fetch(`/api/v1/models/lora/${encodeURIComponent(modelId)}/tag`, {
              method:'POST',
              headers:{ 'Content-Type':'application/json', 'x-csrf-token': csrfToken },
              body: JSON.stringify({ tag:newTag }),
              credentials:'include'
            });
            alert('Tag added!');
            // refresh detail
            const res = await fetch(`/api/v1/models/lora/${encodeURIComponent(modelId)}`);
            const data = await res.json();
            this.setState({ detailModel: { ...data.lora } });
            this.render();
          } catch(err){alert('failed');}
        };

        this.modalElement.querySelector('.rate-btn').onclick = async () => {
          const val = prompt('Rate 1-3');
          const n = Number(val);
          if (![1,2,3].includes(n)) return;
          try {
            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();
            await fetch(`/api/v1/models/lora/${encodeURIComponent(modelId)}/rate`, {
              method:'POST',
              headers:{'Content-Type':'application/json','x-csrf-token': csrfToken},
              body: JSON.stringify({ stars:n }),
              credentials:'include'
            });
            alert('Thanks for rating!');
            const res = await fetch(`/api/v1/models/lora/${encodeURIComponent(modelId)}`);
            const data = await res.json();
            this.setState({ detailModel:{...data.lora} });
            this.render();
          }catch(err){alert('failed');}
        };
        return; // skip rest attach
      }

      // Extra tag click
      this.modalElement.querySelectorAll('.extra-tag-btn').forEach(btn => {
        btn.onclick = () => {
          const tag = btn.getAttribute('data-tag').toLowerCase();
          const newSelected = [...this.state.selectedTags.map(t=>t.toLowerCase()), tag];
          const filtered = this.applyTagFilter(this.state.models, newSelected);
          const remaining = this.computeExtraTags(filtered, newSelected);
          this.setState({ selectedTags: newSelected, models: filtered, extraTags: remaining });
        };
      });

      // Import button event
      const importBtn = this.modalElement.querySelector('.import-btn');
      if (importBtn) {
        importBtn.onclick = () => {
          this.setState({ view: 'importForm', importUrl: '' });
          this.render();
        };
      }

      if (view === 'importForm') {
        const importTitle = this.state.currentCategory === 'checkpoint' ? 'Import Checkpoint' : 'Import LoRA';
        const html = `
          <div class="import-form">
            <h3>${importTitle}</h3>
            <input type="text" class="url-input" placeholder="Civitai or HuggingFace URL" value="${this.state.importUrl}">
            <button class="submit-import">Import</button>
            <button class="cancel-import">Cancel</button>
          </div>`;
        this.modalElement.querySelector('.mods-content').innerHTML = html;
        const input = this.modalElement.querySelector('.url-input');
        input.oninput = () => { this.state.importUrl = input.value; };
        this.modalElement.querySelector('.cancel-import').onclick = () => {
          this.setState({ view: 'intro' });
          this.render();
        };
        this.modalElement.querySelector('.submit-import').onclick = async () => {
          const url = input.value.trim();
          if (!url) return;
          try {
            const endpoint = this.state.currentCategory === 'checkpoint'
              ? '/api/v1/models/checkpoint/import'
              : '/api/v1/models/lora/import';
            // CSRF-protected request (similar to favourites toggle)
            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();
            await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type':'application/json', 'x-csrf-token': csrfToken },
              body: JSON.stringify({ url }),
              credentials: 'include'
            });
            alert('Import requested! Once approved it will appear in the list.');
            this.setState({ view: 'intro' });
            this.render();
          } catch(err){
            alert('Import failed');
          }
        };
        return;
      }
    } else if(rootTab==='train') {
      const { datasets } = this.state;
      const dsList = datasets.length ? `<ul class="dataset-list">${datasets.map(d=>`<li>${d.name} (${(d.images||[]).length} imgs)</li>`).join('')}</ul>` : '<p>No datasets yet.</p>';
      mainContent = `
        <div class="train-dashboard">
          <h3>Your Datasets</h3>
          ${dsList}
          <button class="add-dataset-btn">＋ Dataset</button>
          <h3 style="margin-top:1em;">Your Trainings</h3>
          <p>Coming soon…</p>
          <button class="add-training-btn">＋ Training</button>
        </div>`;
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
      // reuse existing rendering logic by temporarily storing, call old browse renderer
      // to keep diff minimal, we simply call original renderBrowse if existed, else keep placeholder
      contentEl.innerHTML = '<p>Browse view loading…</p>';
    } else {
      contentEl.innerHTML = mainContent;
    }

    // Tab button events
    this.modalElement.querySelectorAll('.root-tab-btn').forEach(btn=>{
      btn.onclick = ()=>{
        const tab = btn.getAttribute('data-tab');
        if(tab!==this.state.rootTab){
          this.setState({ rootTab: tab, view: tab==='browse'? 'intro':'trainDash' });
          if(tab==='train') this.fetchDatasets();
        }
      };
    });

    // Add Dataset button
    const addDsBtn = this.modalElement.querySelector('.add-dataset-btn');
    if(addDsBtn){
      addDsBtn.onclick = ()=> alert('Dataset form coming soon');
    }
  }

  attachCloseEvents() {
    this.modalElement.querySelector('.close-btn').addEventListener('click', () => this.hide());
    this.modalElement.addEventListener('click', (e) => {
      if (e.target === this.modalElement) this.hide();
    });
    document.addEventListener('keydown', this.handleKeyDown);
  }
} 