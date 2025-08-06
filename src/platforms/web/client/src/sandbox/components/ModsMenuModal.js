// src/platforms/web/client/src/sandbox/components/ModsMenuModal.js
// A modal overlay that lets users browse available model assets (checkpoints, LoRAs, upscalers, etc.)
// and select one to add to the current workspace / canvas.
// Relies on external API endpoints:
//   GET /api/models?category=<cat>
//   GET /api/models/stats
// Styling follows spellsMenuModal.css with minor tweaks defined in modsMenuModal.css.

export default class ModsMenuModal {
  constructor(options = {}) {
    this.onSelect = options.onSelect || (() => {}); // callback when user picks a model
    this.state = {
      view: 'intro', // 'intro' | 'category'
      categories: ['checkpoint', 'lora', 'upscale', 'tagger', 'embedding', 'vae', 'other'],
      counts: {},
      currentCategory: null,
      models: [],
      loading: false,
      error: null,
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
      const res = await fetch('/api/models/stats', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch model stats');
      const data = await res.json();
      this.setState({ counts: data.counts || {} });
    } catch (err) {
      console.warn('[ModsMenuModal] stats fetch error', err);
    }
  }

  async fetchModels(category) {
    this.setState({ loading: true, error: null, models: [] });
    try {
      const url = category ? `/api/models?category=${encodeURIComponent(category)}` : '/api/models';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      this.setState({ models: data.models || [], loading: false });
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

    const { view, categories, currentCategory, counts, models, loading, error } = this.state;

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
        listHtml = '<ul class="mods-list">' + models.map((m, idx) => {
          const display = m.path || m.name || m.save_path || 'unknown';
          const size = m.size ? `${(m.size / (1024**2)).toFixed(1)} MB` : '';
          return `<li class="mods-item" data-idx="${idx}"><span>${display}</span> <span class="mods-size">${size}</span> <button class="add-mod-btn">+</button></li>`;
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
      this.modalElement.querySelectorAll('.add-mod-btn').forEach(btn => {
        btn.onclick = (e) => {
          const li = e.target.closest('.mods-item');
          const idx = Number(li.getAttribute('data-idx'));
          const model = this.state.models[idx];
          if (model) {
            this.onSelect(model);
            this.hide();
          }
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