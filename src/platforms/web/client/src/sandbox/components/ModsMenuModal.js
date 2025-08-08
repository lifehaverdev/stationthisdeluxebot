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
      view: 'intro', // 'intro' | 'category'
      categories: ['checkpoint', 'lora', 'upscale', 'embedding', 'vae', 'controlnet', 'clipseg'],
      counts: {},
      currentCategory: null,
      models: [],
      loading: false,
      error: null,
      favoriteIds: new Set(), // store ids liked by user
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

  getModelIdentifier(model) {
    return model._id || model.path || model.name || model.save_path || model.sha || JSON.stringify(model);
  }

  async fetchModels(category) {
    this.setState({ loading: true, error: null, models: [] });
    try {
      const url = category ? `/api/v1/models?category=${encodeURIComponent(category)}` : '/api/v1/models';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      this.setState({ models: data.models || [], loading: false });
      // After models load, fetch favourites so we can sort
      this.fetchFavorites(category);
    } catch (err) {
      this.setState({ loading: false, error: 'Failed to load models.' });
    }
  }

  show() {
    if (this.modalElement) return;
    this.modalElement = document.createElement('div');
    this.modalElement.className = 'mods-modal-overlay';
    document.body.appendChild(this.modalElement);
    this.render();
    this.attachCloseEvents();
    this.fetchStats();
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

    const { view, categories, currentCategory, counts, models, loading, error, favoriteIds } = this.state;

    // Category buttons
    const catButtons = categories.map(cat => {
      const active = cat === currentCategory;
      const count = counts[cat] != null ? ` (${counts[cat]})` : '';
      return `<button class="cat-btn${active ? ' active' : ''}" data-cat="${cat}">${cat}${count}</button>`;
    }).join('');

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
        const sortModels = [...models].sort((a, b) => {
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
          const display = m.path || m.name || m.save_path || 'unknown';
          const size = m.size ? `${(m.size / (1024**2)).toFixed(1)} MB` : '';
          return `<li class="mods-item" data-idx="${idx}"><span class="mods-title">${display}</span> <span class="mods-size">${size}</span> <button class="fav-btn" data-idx="${idx}">${heart}</button></li>`;
        }).join('') + '</ul>';
      }
    }

    this.modalElement.innerHTML = `
      <div class="mods-modal-container">
        <button class="close-btn" aria-label="Close">×</button>
        <h2>Model Browser</h2>
        <p class="intro-text">Browse the models currently available on StationThis. Select a category to see assets and click + to add.</p>
        <div class="mods-category-bar">${catButtons}</div>
        <div class="mods-content">${view === 'intro' ? '<div class="intro-placeholder">Select a category above.</div>' : listHtml}</div>
      </div>`;

    // Attach category btn events
    this.modalElement.querySelectorAll('.cat-btn').forEach(btn => {
      btn.onclick = () => {
        const cat = btn.getAttribute('data-cat');
        this.setState({ view: 'category', currentCategory: cat });
        this.fetchModels(cat);
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
            this.onSelect(model);
            this.hide();
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
  }

  attachCloseEvents() {
    this.modalElement.querySelector('.close-btn').addEventListener('click', () => this.hide());
    this.modalElement.addEventListener('click', (e) => {
      if (e.target === this.modalElement) this.hide();
    });
    document.addEventListener('keydown', this.handleKeyDown);
  }
} 