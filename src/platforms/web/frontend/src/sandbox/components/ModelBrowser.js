import { Component, h } from '@monygroupcorp/microact';
import { Loader, ModalError } from './Modal.js';
import { AsyncButton, EmptyState, TagPills, CopyButton, Badge } from './ModalKit.js';
import { fetchJson, postWithCsrf, fetchWithCsrf } from '../../lib/api.js';

const CATEGORIES = ['checkpoint', 'lora', 'upscale', 'embedding', 'vae', 'controlnet', 'clipseg'];
const VIEW = { GRID: 'grid', LIST: 'list', DETAIL: 'detail', IMPORT: 'import' };

/**
 * ModelBrowser — category grid, model list, detail overlay, favorites.
 *
 * Props:
 *   userId — current user's masterAccountId
 */
export class ModelBrowser extends Component {
  constructor(props) {
    super(props);
    this.state = {
      view: VIEW.GRID,
      counts: {},
      countsLoading: true,

      // Category / list
      currentCategory: null,
      currentLoraSub: null,
      loraCategories: [],
      models: [],
      modelsLoading: false,
      modelsError: null,
      selectedTag: null,
      extraTags: [],
      favoriteIds: new Set(),

      // Detail
      detailModel: null,
      detailImages: [],
      detailImgIdx: 0,

      // Import
      importUrl: '',
      importing: false,
      importError: null,
    };
  }

  didMount() {
    this._fetchStats();
  }

  // ── Data ────────────────────────────────────────────────

  async _fetchStats() {
    try {
      const data = await fetchJson('/api/v1/models/stats');
      this.setState({ counts: data.counts || {}, countsLoading: false });
    } catch {
      this.setState({ countsLoading: false });
    }
  }

  async _fetchFavorites(category) {
    if (!category) return;
    try {
      const data = await fetchJson(`/api/v1/user/me/preferences/model-favorites/${encodeURIComponent(category)}`);
      this.setState({ favoriteIds: new Set(data.favorites || []) });
    } catch {
      this.setState({ favoriteIds: new Set() });
    }
  }

  async _fetchModels(category, loraSub) {
    this.setState({ modelsLoading: true, modelsError: null, models: [], selectedTag: null, extraTags: [] });
    try {
      let url;
      if (category === 'lora') {
        const catParam = loraSub ? `category=${encodeURIComponent(loraSub)}&` : '';
        url = `/api/v1/models/lora?${catParam}limit=100`;
      } else {
        url = `/api/v1/models?category=${encodeURIComponent(category)}&limit=100`;
      }
      const data = await fetchJson(url);
      const models = data.loras || data.models || [];
      const extraTags = this._computeExtraTags(models, []);
      this.setState({ models, modelsLoading: false, extraTags });
      this._fetchFavorites(category);
    } catch {
      this.setState({ modelsLoading: false, modelsError: 'Failed to load models.' });
    }
  }

  async _fetchLoraCategories() {
    try {
      const data = await fetchJson(`/api/v1/models/lora/categories?_=${Date.now()}`);
      this.setState({ loraCategories: data.categories || [] });
    } catch {
      this.setState({ loraCategories: [] });
    }
  }

  // ── Tag helpers ─────────────────────────────────────────

  _getModelId(m) {
    return m._id || m.path || m.name || m.save_path || m.sha || JSON.stringify(m);
  }

  _isAccessible(m) {
    const uid = (this.props.userId || '').toString().toLowerCase();
    const raw = (m.path || m.save_path || '').toLowerCase().replace(/\\/g, '/');
    if (!raw) return true;
    const isPriv = raw.includes('/users/');
    if (!isPriv) return true;
    if (!uid) return false;
    return raw.includes(`/users/${uid}/`);
  }

  _computeExtraTags(models, selected) {
    const tagSet = new Set();
    models.filter(m => this._isAccessible(m)).forEach(m => {
      (m.tags || []).forEach(t => {
        const val = (typeof t === 'string' ? t : t.tag).toLowerCase();
        if (!selected.includes(val)) tagSet.add(val);
      });
    });
    return Array.from(tagSet).sort().slice(0, 15);
  }

  _filteredModels() {
    const { models, selectedTag, favoriteIds } = this.state;
    const uid = (this.props.userId || '').toString().toLowerCase();
    let list = models.filter(m => this._isAccessible(m));

    if (selectedTag) {
      list = list.filter(m => {
        const tags = (m.tags || []).map(t => (typeof t === 'string' ? t : t.tag).toLowerCase());
        return tags.includes(selectedTag.toLowerCase());
      });
    }

    // Sort: owned private first, favorites second, alpha third
    const isPrivOwned = (m) => {
      const raw = (m.path || m.save_path || '').toLowerCase().replace(/\\/g, '/');
      return uid && raw.includes(`/users/${uid}/`);
    };
    list.sort((a, b) => {
      const wA = isPrivOwned(a) ? -3 : favoriteIds.has(this._getModelId(a)) ? -2 : 0;
      const wB = isPrivOwned(b) ? -3 : favoriteIds.has(this._getModelId(b)) ? -2 : 0;
      if (wA !== wB) return wA - wB;
      return (a.name || a.slug || '').localeCompare(b.name || b.slug || '');
    });
    return list;
  }

  // ── Actions ─────────────────────────────────────────────

  _selectCategory(cat) {
    if (cat === 'lora') {
      this.setState({ view: VIEW.LIST, currentCategory: 'lora', currentLoraSub: null });
      this._fetchLoraCategories();
      this._fetchModels('lora', null);
    } else {
      this.setState({ view: VIEW.LIST, currentCategory: cat, currentLoraSub: null, loraCategories: [] });
      this._fetchModels(cat);
    }
  }

  _selectLoraSub(sub) {
    this.setState({ currentLoraSub: sub });
    this._fetchModels('lora', sub);
  }

  _selectTag(tag) {
    this.setState({ selectedTag: tag });
  }

  async _toggleFavorite(model) {
    const { currentCategory, favoriteIds } = this.state;
    const id = this._getModelId(model);
    const isFav = favoriteIds.has(id);
    const cat = currentCategory || 'checkpoint';

    // Optimistic update
    const next = new Set(favoriteIds);
    if (isFav) next.delete(id); else next.add(id);
    this.setState({ favoriteIds: next });

    try {
      if (isFav) {
        await fetchWithCsrf(`/api/v1/user/me/preferences/model-favorites/${encodeURIComponent(cat)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } else {
        await postWithCsrf(`/api/v1/user/me/preferences/model-favorites/${encodeURIComponent(cat)}`, { modelId: id });
      }
    } catch (err) {
      console.warn('[ModelBrowser] toggleFavorite error', err);
    }
  }

  _openDetail(model) {
    let imgs = (model.previewImages && model.previewImages.length)
      ? model.previewImages.slice()
      : (model.images && model.images.length) ? model.images.slice() : [];
    if (!imgs.length && model.previewImageUrl) imgs = [model.previewImageUrl];

    this.setState({ view: VIEW.DETAIL, detailModel: model, detailImages: imgs, detailImgIdx: 0 });
  }

  _closeDetail() {
    this.setState({ view: VIEW.LIST, detailModel: null });
  }

  _goGrid() {
    this.setState({ view: VIEW.GRID, currentCategory: null, models: [], detailModel: null });
  }

  // Import
  async _doImport() {
    const { importUrl, currentCategory, currentLoraSub } = this.state;
    if (!importUrl.trim()) return;
    this.setState({ importing: true, importError: null });
    try {
      const res = await postWithCsrf('/api/v1/models/import', { url: importUrl.trim(), category: currentCategory });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Import failed');
      }
      this.setState({ importing: false, importUrl: '', view: VIEW.LIST });
      this._fetchModels(currentCategory, currentLoraSub);
    } catch (err) {
      this.setState({ importing: false, importError: err.message });
    }
  }

  // ── Render: Category Grid ──────────────────────────────

  _renderGrid() {
    const { counts, countsLoading } = this.state;
    if (countsLoading) return h(Loader, { message: 'Loading categories...' });

    return h('div', null,
      h('p', { style: 'color:#aaa;font-size:13px;margin:0 0 16px' }, 'Browse the models available on StationThis. Select a category to see assets.'),
      h('div', { className: 'mb-cat-grid' },
        ...CATEGORIES.map(cat =>
          h('button', {
            className: 'mb-cat-card',
            onclick: () => this._selectCategory(cat),
          },
            h('div', { className: 'mb-cat-name' }, cat),
            counts[cat] != null ? h('div', { className: 'mb-cat-count' }, `${counts[cat]}`) : null
          )
        )
      )
    );
  }

  // ── Render: Model List ─────────────────────────────────

  _renderList() {
    const { currentCategory, currentLoraSub, loraCategories, modelsLoading, modelsError, selectedTag, extraTags, favoriteIds } = this.state;

    const showImport = ['lora', 'checkpoint'].includes(currentCategory);
    const models = this._filteredModels();

    return h('div', null,
      h('button', { className: 'mb-back', onclick: this.bind(this._goGrid) }, '\u2190 Categories'),

      h('div', { className: 'mb-list-header' },
        h('h3', { style: 'margin:0;color:#fff' }, `${currentCategory}${models.length ? ` (${models.length})` : ''}`),
        showImport ? h(AsyncButton, {
          variant: 'secondary',
          onclick: () => this.setState({ view: VIEW.IMPORT, importUrl: '', importError: null }),
          label: '+ Import',
        }) : null
      ),

      // LoRA sub-category bar
      currentCategory === 'lora' && loraCategories.length > 0
        ? h('div', { className: 'mb-lora-bar' },
          ...loraCategories.map(sub =>
            h('button', {
              className: `mb-lora-btn${sub === currentLoraSub ? ' mb-lora-btn--active' : ''}`,
              onclick: () => this._selectLoraSub(sub),
            }, sub)
          )
        ) : null,

      // Tags
      extraTags.length > 0
        ? h(TagPills, { tags: extraTags, active: selectedTag, onSelect: this.bind(this._selectTag) })
        : null,

      // Content
      modelsLoading ? h(Loader, { message: 'Loading models...' }) : null,
      modelsError ? h('div', null, ModalError({ message: modelsError })) : null,
      !modelsLoading && !modelsError && models.length === 0
        ? h(EmptyState, { message: 'No models found.' })
        : null,

      !modelsLoading ? h('div', { className: 'mb-model-list' },
        ...models.map(m => this._renderModelRow(m))
      ) : null
    );
  }

  _renderModelRow(model) {
    const { favoriteIds } = this.state;
    const id = this._getModelId(model);
    const isFav = favoriteIds.has(id);
    const display = (model.path || model.name || model.save_path || 'unknown').split('/').pop();
    const size = model.size ? `${(model.size / (1024 ** 2)).toFixed(1)} MB` : '';
    const tags = (model.tags || []).map(t => typeof t === 'string' ? t : t.tag).slice(0, 5);

    return h('div', {
      className: 'mb-model-row',
      key: id,
      onclick: () => this._openDetail(model),
    },
      h('div', { className: 'mb-model-info' },
        h('span', { className: 'mb-model-name' }, display),
        size ? h('span', { className: 'mb-model-size' }, size) : null,
        tags.length > 0 ? h('div', { className: 'mb-model-tags' },
          ...tags.map(t => h('span', { className: 'mb-tag', key: t }, t))
        ) : null
      ),
      h('button', {
        className: 'mb-fav-btn',
        onclick: (e) => { e.stopPropagation(); this._toggleFavorite(model); },
      }, isFav ? '\u2764\uFE0F' : '\u2661')
    );
  }

  // ── Render: Model Detail ───────────────────────────────

  _renderDetail() {
    const { detailModel, detailImages, detailImgIdx, favoriteIds, currentCategory } = this.state;
    if (!detailModel) return h('div', { style: 'display:none' });

    const model = detailModel;
    const imgs = detailImages;
    const id = this._getModelId(model);
    const isFav = favoriteIds.has(id);

    // Meta fields
    const metaFields = [];
    const addMeta = (label, val) => { if (val != null && val !== '') metaFields.push({ label, val }); };
    addMeta('Checkpoint', model.checkpoint);
    addMeta('Type', model.modelType || model.style);
    addMeta('Strength', model.strength);
    addMeta('Version', model.version);
    if (model.defaultWeight != null) addMeta('Default Weight', Number(model.defaultWeight).toFixed(2));
    if (model.description) addMeta('Description', model.description);
    if (model.usageCount != null) addMeta('Usage', model.usageCount);

    const triggerWords = model.triggerWords || [];

    return h('div', null,
      h('button', { className: 'mb-back', onclick: this.bind(this._closeDetail) }, '\u2190 Back'),

      h('h3', { style: 'color:#fff;margin:0 0 12px' }, model.name || model.title || 'Model'),

      // Image carousel
      imgs.length > 0 ? h('div', { className: 'mb-carousel' },
        imgs.length > 1 ? h('button', {
          className: 'mb-carousel-nav',
          onclick: () => this.setState({ detailImgIdx: (detailImgIdx - 1 + imgs.length) % imgs.length }),
        }, '\u2039') : null,
        h('img', { className: 'mb-carousel-img', src: imgs[detailImgIdx] || '/assets/placeholder.png' }),
        imgs.length > 1 ? h('button', {
          className: 'mb-carousel-nav',
          onclick: () => this.setState({ detailImgIdx: (detailImgIdx + 1) % imgs.length }),
        }, '\u203A') : null,
        imgs.length > 1 ? h('div', { className: 'mb-thumb-strip' },
          ...imgs.map((url, i) =>
            h('img', {
              className: `mb-thumb${i === detailImgIdx ? ' mb-thumb--active' : ''}`,
              src: url,
              onclick: () => this.setState({ detailImgIdx: i }),
              key: i,
            })
          )
        ) : null
      ) : null,

      // Meta
      metaFields.length > 0 ? h('div', { className: 'mb-meta' },
        ...metaFields.map(f => h('div', { className: 'mb-meta-row', key: f.label },
          h('span', { className: 'mb-meta-label' }, f.label + ':'),
          h('span', { className: 'mb-meta-val' }, String(f.val))
        ))
      ) : null,

      // Trigger words
      triggerWords.length > 0 ? h('div', { className: 'mb-triggers' },
        h('span', { className: 'mb-meta-label' }, 'Trigger Words:'),
        ...triggerWords.map(tw => h('code', { className: 'mb-trigger-badge', key: tw }, tw)),
        h(CopyButton, { text: triggerWords.join(' '), label: 'Copy' })
      ) : null,

      // Tags
      this._isAccessible(model) && model.tags && model.tags.length > 0
        ? h('div', { className: 'mb-detail-tags' },
          ...model.tags.map(t => {
            const tag = typeof t === 'string' ? t : t.tag;
            return h(Badge, { label: tag, variant: 'info', key: tag });
          })
        ) : null,

      // Actions
      h('div', { className: 'mb-detail-actions' },
        h('button', {
          className: `mb-fav-toggle${isFav ? ' mb-fav-toggle--active' : ''}`,
          onclick: () => this._toggleFavorite(model),
        }, isFav ? '\u2764\uFE0F Unfavourite' : '\u2661 Favourite'),
      )
    );
  }

  // ── Render: Import Dialog ──────────────────────────────

  _renderImport() {
    const { importUrl, importing, importError, currentCategory } = this.state;

    return h('div', null,
      h('button', { className: 'mb-back', onclick: () => this.setState({ view: VIEW.LIST }) }, '\u2190 Back'),
      h('h3', { style: 'color:#fff;margin:0 0 16px' }, `Import ${currentCategory}`),
      h('div', { className: 'mb-form-group' },
        h('label', null, 'Remote URL'),
        h('input', {
          className: 'mb-input',
          type: 'text',
          placeholder: 'https://example.com/model',
          value: importUrl,
          oninput: (e) => this.setState({ importUrl: e.target.value }),
          onkeydown: (e) => { if (e.key === 'Enter') this._doImport(); },
        })
      ),
      importError ? ModalError({ message: importError }) : null,
      h('div', { className: 'mb-import-actions' },
        h(AsyncButton, { variant: 'secondary', onclick: () => this.setState({ view: VIEW.LIST }), label: 'Cancel' }),
        h(AsyncButton, { loading: importing, disabled: !importUrl.trim(), onclick: this.bind(this._doImport), label: 'Import' })
      )
    );
  }

  // ── Styles ─────────────────────────────────────────────

  static get styles() {
    return `
      .mb-back { background:none; border:none; color:#90caf9; cursor:pointer; font-size:13px; padding:0; margin-bottom:16px; }
      .mb-back:hover { text-decoration:underline; }

      /* Category Grid */
      .mb-cat-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:8px; }
      .mb-cat-card { background:#222; border:1px solid #333; border-radius:8px; padding:16px; cursor:pointer; text-align:center; transition:border-color 0.15s; }
      .mb-cat-card:hover { border-color:#555; }
      .mb-cat-name { font-size:14px; font-weight:600; color:#fff; text-transform:capitalize; margin-bottom:4px; }
      .mb-cat-count { font-size:12px; color:#888; }

      /* List header */
      .mb-list-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }

      /* LoRA bar */
      .mb-lora-bar { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
      .mb-lora-btn { background:#222; border:1px solid #444; color:#aaa; padding:4px 12px; border-radius:16px; font-size:12px; cursor:pointer; }
      .mb-lora-btn:hover { border-color:#666; color:#ccc; }
      .mb-lora-btn--active { background:#3f51b5; border-color:#3f51b5; color:#fff; }

      /* Model list */
      .mb-model-list { max-height:400px; overflow-y:auto; }
      .mb-model-row { display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border-bottom:1px solid #222; cursor:pointer; transition:background 0.1s; }
      .mb-model-row:hover { background:rgba(255,255,255,0.03); }
      .mb-model-info { flex:1; min-width:0; }
      .mb-model-name { font-size:14px; color:#e0e0e0; font-weight:500; }
      .mb-model-size { font-size:11px; color:#888; margin-left:8px; }
      .mb-model-tags { display:flex; gap:4px; flex-wrap:wrap; margin-top:4px; }
      .mb-tag { font-size:10px; color:#aaa; background:#2a2a2a; padding:2px 6px; border-radius:3px; }
      .mb-fav-btn { background:none; border:none; font-size:16px; cursor:pointer; padding:4px; }

      /* Detail */
      .mb-carousel { position:relative; margin-bottom:16px; text-align:center; }
      .mb-carousel-img { max-width:100%; max-height:300px; border-radius:8px; object-fit:contain; }
      .mb-carousel-nav { position:absolute; top:50%; transform:translateY(-50%); background:rgba(0,0,0,0.5); border:none; color:#fff; font-size:24px; padding:8px 12px; cursor:pointer; border-radius:4px; z-index:1; }
      .mb-carousel-nav:first-child { left:4px; }
      .mb-carousel-nav:last-of-type { right:4px; }
      .mb-thumb-strip { display:flex; gap:4px; justify-content:center; margin-top:8px; }
      .mb-thumb { width:40px; height:40px; border-radius:4px; object-fit:cover; cursor:pointer; opacity:0.5; border:2px solid transparent; }
      .mb-thumb--active { opacity:1; border-color:#90caf9; }

      .mb-meta { margin-bottom:16px; }
      .mb-meta-row { display:flex; gap:8px; padding:4px 0; font-size:13px; }
      .mb-meta-label { color:#888; min-width:100px; flex-shrink:0; }
      .mb-meta-val { color:#ccc; word-break:break-word; }

      .mb-triggers { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
      .mb-trigger-badge { font-family:monospace; font-size:12px; background:#2a2a3a; color:#90caf9; padding:2px 8px; border-radius:4px; }

      .mb-detail-tags { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:12px; }

      .mb-detail-actions { display:flex; gap:8px; margin-top:16px; }
      .mb-fav-toggle { background:none; border:1px solid #444; color:#ccc; padding:6px 16px; border-radius:6px; cursor:pointer; font-size:13px; }
      .mb-fav-toggle:hover { border-color:#666; }
      .mb-fav-toggle--active { border-color:#e74c3c; color:#e74c3c; }

      /* Import */
      .mb-form-group { margin-bottom:14px; }
      .mb-form-group label { display:block; margin-bottom:6px; color:#aaa; font-weight:600; font-size:13px; }
      .mb-input { width:100%; padding:8px 12px; background:#222; border:1px solid #444; border-radius:6px; color:#e0e0e0; font-size:14px; box-sizing:border-box; }
      .mb-input:focus { border-color:#90caf9; outline:none; }
      .mb-import-actions { display:flex; gap:8px; justify-content:flex-end; }
    `;
  }

  // ── Main render ────────────────────────────────────────

  render() {
    const { view } = this.state;
    switch (view) {
      case VIEW.GRID: return this._renderGrid();
      case VIEW.LIST: return this._renderList();
      case VIEW.DETAIL: return this._renderDetail();
      case VIEW.IMPORT: return this._renderImport();
      default: return h('div', { style: 'display:none' });
    }
  }
}
