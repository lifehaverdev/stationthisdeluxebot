import { Component, h } from '@monygroupcorp/microact';
import { Modal, Loader, ModalError } from './Modal.js';
import { CopyButton, AsyncButton, EmptyState, ConfirmInline, TabBar, SearchBar, TagPills, Badge } from './ModalKit.js';
import { fetchJson, postWithCsrf, fetchWithCsrf } from '../../lib/api.js';

const TAB = { MINE: 'mine', MARKET: 'marketplace' };
const VIEW = { LIST: 'list', DETAIL: 'detail', CREATE: 'create', MARKET_DETAIL: 'marketDetail' };
const VISIBILITY = { PRIVATE: 'private', LISTED: 'listed', PUBLIC: 'public' };
const POINTS_TO_USD = 0.000337;

/**
 * SpellsModal — unified spell management + marketplace.
 *
 * Props:
 *   onClose          — close handler
 *   initialSubgraph  — if set, opens directly to create view with this subgraph
 */
export class SpellsModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      tab: props.initialSubgraph ? TAB.MINE : TAB.MINE,
      view: props.initialSubgraph ? VIEW.CREATE : VIEW.LIST,

      // My Spells
      spells: [],
      spellsLoading: true,
      spellsError: null,
      spellSearch: '',

      // Detail
      selectedSpell: null,
      detailLoading: false,
      detailError: null,
      editing: false,
      editDraft: null,
      confirmDelete: false,
      deleting: false,
      saving: false,

      // Create
      subgraph: props.initialSubgraph || null,
      createName: '',
      createDesc: '',
      createVisibility: VISIBILITY.PRIVATE,
      createPrice: 100,
      createExposed: {},
      creating: false,
      createError: null,

      // Marketplace
      marketSpells: [],
      marketLoading: false,
      marketError: null,
      marketSearch: '',
      marketTag: null,
      marketTags: [],

      // Market Detail
      marketSpell: null,
      marketDetailLoading: false,
      marketDetailError: null,
      quote: null,
      quoteLoading: false,
      casting: false,
      castResult: null,

      // User
      userId: null,
    };

  }

  didMount() {
    this._fetchUserId();
    if (this.state.view === VIEW.LIST) this._fetchSpells();
  }

  async _fetchUserId() {
    if (this.state.userId) return this.state.userId;
    try {
      const data = await fetchJson('/api/v1/user/dashboard');
      this.setState({ userId: data.masterAccountId });
      return data.masterAccountId;
    } catch { return null; }
  }

  // ── My Spells: Fetch ──────────────────────────────────────

  async _fetchSpells() {
    this.setState({ spellsLoading: true, spellsError: null });
    try {
      const data = await fetchJson('/api/v1/spells');
      const spells = Array.isArray(data) ? data : (data.spells || []);
      this.setState({ spells, spellsLoading: false });
    } catch (err) {
      this.setState({ spellsError: err.message, spellsLoading: false });
    }
  }

  _openSpellDetail(spell) {
    // The list endpoint already returns full spell objects — no extra fetch needed
    this.setState({
      view: VIEW.DETAIL, selectedSpell: spell, detailLoading: false, detailError: null,
      editing: false, editDraft: null, confirmDelete: false, saving: false,
    });
  }

  // ── My Spells: CRUD ───────────────────────────────────────

  async _saveSpell() {
    const { editDraft, selectedSpell, userId } = this.state;
    if (!editDraft) return;
    this.setState({ saving: true });
    try {
      const id = selectedSpell._id || selectedSpell.spellId;
      const res = await fetchWithCsrf(`/api/v1/spells/${id}`, {
        method: 'PUT',
        body: { ...editDraft, masterAccountId: userId },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error?.message || `Save failed (${res.status})`);
      }
      this.setState({ saving: false, editing: false, editDraft: null });
      this._openSpellDetail(selectedSpell);
    } catch (err) {
      this.setState({ saving: false, detailError: err.message });
    }
  }

  async _deleteSpell() {
    const { selectedSpell, userId } = this.state;
    const id = selectedSpell._id || selectedSpell.spellId;
    this.setState({ deleting: true });
    try {
      const res = await fetchWithCsrf(`/api/v1/spells/${id}`, {
        method: 'DELETE',
        body: { masterAccountId: userId },
      });
      if (!res.ok && res.status !== 204) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error?.message || `Delete failed (${res.status})`);
      }
      this.setState({ deleting: false, view: VIEW.LIST, selectedSpell: null });
      this._fetchSpells();
    } catch (err) {
      this.setState({ deleting: false, detailError: err.message });
    }
  }

  async _createSpell() {
    const { createName, createDesc, createVisibility, createPrice, subgraph, createExposed, userId } = this.state;
    if (!createName.trim()) return;
    this.setState({ creating: true, createError: null });
    try {
      const steps = (subgraph?.nodes || []).map((node, i) => ({
        id: node.id,
        toolIdentifier: node.toolId,
        toolVersion: '1.0.0',
        displayName: node.displayName,
        parameterMappings: node.parameterMappings || {},
      }));
      const connections = subgraph?.connections || [];
      const exposedInputs = Object.entries(createExposed)
        .filter(([, v]) => v)
        .map(([key]) => {
          const [nodeId, paramKey] = key.split('__');
          return { nodeId, paramKey };
        });

      const body = {
        name: createName.trim(),
        description: createDesc.trim(),
        creatorId: userId,
        visibility: createVisibility,
        steps,
        connections,
        exposedInputs,
      };
      if (createVisibility === VISIBILITY.LISTED) {
        body.pricePoints = Number(createPrice) || 100;
      }

      const res = await postWithCsrf('/api/v1/spells', body);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error?.message || `Create failed (${res.status})`);
      }
      const newSpell = await res.json();
      this.setState({ creating: false });
      this._fetchSpells();
      this._openSpellDetail(newSpell);
    } catch (err) {
      this.setState({ creating: false, createError: err.message });
    }
  }

  // ── Canvas / Editor ───────────────────────────────────────

  _addToCanvas(spell) {
    const canvas = window.sandboxCanvas;
    if (!canvas) return;
    const pos = window.__sandboxState__?.lastClickPosition || { x: 200, y: 200 };
    canvas.addSpellWindow(spell, pos);
    this.props.onClose?.();
  }

  async _openFlowEditor() {
    if (!this.state.selectedSpell) return;
    // Hide modal, open overlay, restore on return
    const modalEl = this._el?.closest?.('.modal-overlay');
    if (modalEl) modalEl.style.display = 'none';
    try {
      const result = null; // flow editor overlay removed — spell editing done inline
      if (result) {
        const draft = { ...(this.state.editDraft || this.state.selectedSpell) };
        if (result.steps) draft.steps = result.steps;
        if (result.connections) draft.connections = result.connections;
        this.setState({ editing: true, editDraft: draft });
      }
    } finally {
      if (modalEl) modalEl.style.display = '';
    }
  }

  // ── Marketplace ───────────────────────────────────────────

  async _fetchMarketplace() {
    this.setState({ marketLoading: true, marketError: null });
    try {
      const params = new URLSearchParams();
      if (this.state.marketSearch) params.set('search', this.state.marketSearch);
      if (this.state.marketTag) params.set('tag', this.state.marketTag);
      const qs = params.toString();
      const data = await fetchJson(`/api/v1/spells/marketplace${qs ? '?' + qs : ''}`);
      const spells = Array.isArray(data) ? data : (data.spells || []);
      // Extract unique tags
      const tagSet = new Set();
      spells.forEach(s => (s.tags || []).forEach(t => tagSet.add(t)));
      this.setState({ marketSpells: spells, marketTags: [...tagSet].sort(), marketLoading: false });
    } catch (err) {
      this.setState({ marketError: err.message, marketLoading: false });
    }
  }

  async _fetchMarketDetail(spell) {
    const slug = spell.slug || spell.publicSlug || spell.spellId || spell._id;
    this.setState({
      view: VIEW.MARKET_DETAIL, marketSpell: spell, marketDetailLoading: true,
      marketDetailError: null, quote: null, castResult: null,
    });
    try {
      const data = await fetchJson(`/api/v1/spells/${slug}`);
      this.setState({ marketSpell: data, marketDetailLoading: false });
      // Fire off quote fetch
      this._fetchQuote(slug);
    } catch (err) {
      this.setState({ marketDetailError: err.message, marketDetailLoading: false });
    }
  }

  async _fetchQuote(spellId) {
    this.setState({ quoteLoading: true });
    try {
      const res = await postWithCsrf(`/api/v1/spells/${spellId}/quote`, {});
      if (res.ok) {
        const quote = await res.json();
        this.setState({ quote, quoteLoading: false });
      } else {
        this.setState({ quoteLoading: false });
      }
    } catch {
      this.setState({ quoteLoading: false });
    }
  }

  async _castSpell() {
    const { marketSpell, userId } = this.state;
    const slug = marketSpell.slug || marketSpell.publicSlug || marketSpell._id;
    this.setState({ casting: true, castResult: null });
    try {
      const res = await postWithCsrf('/api/v1/spells/cast', {
        slug,
        context: { masterAccountId: userId, parameterOverrides: {}, platform: 'web-sandbox' },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error?.message || `Cast failed (${res.status})`);
      }
      const result = await res.json();
      this.setState({ casting: false, castResult: result });
    } catch (err) {
      this.setState({ casting: false, castResult: { status: 'failed', error: err.message } });
    }
  }

  // ── Navigation ────────────────────────────────────────────

  _switchTab(tab) {
    this.setState({ tab, view: VIEW.LIST });
    if (tab === TAB.MINE && this.state.spells.length === 0) this._fetchSpells();
    if (tab === TAB.MARKET && this.state.marketSpells.length === 0) this._fetchMarketplace();
  }

  _goList() {
    this.setState({
      view: VIEW.LIST, selectedSpell: null, editDraft: null, editing: false,
      confirmDelete: false, marketSpell: null, castResult: null,
    });
  }

  _goCreate() {
    this.setState({
      view: VIEW.CREATE, createName: '', createDesc: '', createVisibility: VISIBILITY.PRIVATE,
      createPrice: 100, createExposed: {}, createError: null,
    });
  }

  _startEdit() {
    const s = this.state.selectedSpell;
    this.setState({
      editing: true,
      editDraft: {
        name: s.name,
        description: s.description,
        visibility: s.visibility || VISIBILITY.PRIVATE,
        pricePoints: s.pricePoints || 100,
        steps: s.steps ? [...s.steps] : [],
        connections: s.connections ? [...s.connections] : [],
        exposedInputs: s.exposedInputs ? [...s.exposedInputs] : [],
      },
    });
  }

  _cancelEdit() {
    this.setState({ editing: false, editDraft: null });
  }

  // ── Render: Tabs + Router ─────────────────────────────────

  _renderBody() {
    const { tab, view } = this.state;

    // Create view has no tabs
    if (view === VIEW.CREATE) return this._renderCreate();

    const tabs = [
      { key: TAB.MINE, label: 'My Spells' },
      { key: TAB.MARKET, label: 'Discover Spells' },
    ];

    let content;
    if (tab === TAB.MINE) {
      content = view === VIEW.DETAIL ? this._renderDetail() : this._renderMyList();
    } else {
      content = view === VIEW.MARKET_DETAIL ? this._renderMarketDetail() : this._renderMarketList();
    }

    return h('div', null,
      h(TabBar, { tabs, active: tab, onChange: this.bind(this._switchTab) }),
      content
    );
  }

  // ── Render: My Spells List ────────────────────────────────

  _renderMyList() {
    const { spells, spellsLoading, spellsError, spellSearch } = this.state;

    if (spellsLoading) return h(Loader, { message: 'Loading spells...' });
    if (spellsError) return h('div', null,
      ModalError({ message: spellsError }),
      h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._fetchSpells), label: 'Retry' })
    );

    const filtered = spellSearch
      ? spells.filter(s => s.name?.toLowerCase().includes(spellSearch.toLowerCase()))
      : spells;

    if (spells.length === 0) {
      return h(EmptyState, {
        icon: '\u2728',
        message: 'You haven\'t created any spells yet. Select 2+ nodes on the canvas and click "Mint as Spell", or create one from scratch.',
        action: 'Create Spell',
        onAction: this.bind(this._goCreate),
      });
    }

    return h('div', null,
      h('div', { className: 'sm-list-header' },
        h('input', {
          className: 'sm-filter-input',
          type: 'text',
          placeholder: 'Filter spells...',
          value: spellSearch,
          oninput: (e) => this.setState({ spellSearch: e.target.value }),
        }),
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._goCreate), label: '+ New Spell' })
      ),
      filtered.length === 0
        ? h('div', { className: 'sm-no-results' }, 'No spells match your filter.')
        : null,
      ...filtered.map(spell => this._renderSpellCard(spell))
    );
  }

  _renderSpellCard(spell) {
    const vis = spell.visibility || 'private';
    const badgeVariant = vis === 'public' ? 'success' : vis === 'listed' ? 'warning' : 'default';
    const stepCount = spell.steps?.length || 0;

    return h('div', {
      className: 'sm-card',
      key: spell._id || spell.slug,
      onclick: () => this._openSpellDetail(spell),
    },
      h('div', { className: 'sm-card-top' },
        h('div', { className: 'sm-card-name' }, spell.name),
        h('div', { className: 'sm-card-meta' },
          h(Badge, { label: vis, variant: badgeVariant }),
          stepCount ? h('span', { className: 'sm-card-steps' }, `${stepCount} step${stepCount !== 1 ? 's' : ''}`) : null
        )
      ),
      spell.description
        ? h('div', { className: 'sm-card-desc' }, spell.description.length > 120 ? spell.description.slice(0, 120) + '...' : spell.description)
        : null,
      h('div', { className: 'sm-card-actions' },
        h('button', {
          className: 'sm-card-add',
          onclick: (e) => { e.stopPropagation(); this._addToCanvas(spell); },
        }, '+ Add to Canvas')
      )
    );
  }

  // ── Render: Spell Detail ──────────────────────────────────

  _renderDetail() {
    const { selectedSpell, detailLoading, detailError, editing, editDraft, confirmDelete, deleting, saving, userId } = this.state;

    if (detailLoading) return h('div', null,
      h('button', { className: 'sm-back', onclick: this.bind(this._goList) }, '\u2190 My Spells'),
      h(Loader, { message: 'Loading spell...' })
    );

    if (detailError) return h('div', null,
      h('button', { className: 'sm-back', onclick: this.bind(this._goList) }, '\u2190 My Spells'),
      ModalError({ message: detailError })
    );

    const spell = editing ? { ...selectedSpell, ...editDraft } : selectedSpell;
    const isOwner = userId && (
      (spell.ownedBy?.toString() === userId.toString()) ||
      (spell.creatorId?.toString() === userId.toString())
    );

    return h('div', null,
      h('button', { className: 'sm-back', onclick: this.bind(this._goList) }, '\u2190 My Spells'),

      // Header
      h('div', { className: 'sm-detail-header' },
        h('h3', { className: 'sm-detail-name' }, spell.name),
        isOwner && !editing
          ? h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._startEdit), label: 'Edit' })
          : null
      ),

      // Edit mode
      editing ? this._renderEditForm(spell) : this._renderReadView(spell, isOwner),

      // Actions bar
      !editing ? h('div', { className: 'sm-detail-actions' },
        h(AsyncButton, {
          variant: 'secondary',
          onclick: () => this._addToCanvas(selectedSpell),
          label: '+ Add to Canvas',
        }),
        null,
        isOwner ? h(AsyncButton, {
          variant: 'danger',
          onclick: () => this.setState({ confirmDelete: true }),
          label: 'Delete',
        }) : null,
      ) : null,

      // Delete confirmation
      confirmDelete ? h(ConfirmInline, {
        message: `Delete "${spell.name}"? This cannot be undone.`,
        confirmLabel: deleting ? 'Deleting...' : 'Delete',
        onConfirm: this.bind(this._deleteSpell),
        onCancel: () => this.setState({ confirmDelete: false }),
      }) : null
    );
  }

  _renderReadView(spell, isOwner) {
    const vis = spell.visibility || 'private';
    const badgeVariant = vis === 'public' ? 'success' : vis === 'listed' ? 'warning' : 'default';

    return h('div', null,
      spell.description ? h('p', { className: 'sm-detail-desc' }, spell.description) : null,
      h('div', { className: 'sm-detail-row' },
        h('span', { className: 'sm-detail-label' }, 'Visibility'),
        h(Badge, { label: vis, variant: badgeVariant }),
        vis === 'listed' && spell.pricePoints
          ? h('span', { className: 'sm-detail-price' }, `${spell.pricePoints} pts (~$${(spell.pricePoints * POINTS_TO_USD).toFixed(2)})`)
          : null
      ),

      // Public link
      (vis === 'public' || vis === 'listed') && (spell.publicSlug || spell.slug)
        ? h('div', { className: 'sm-detail-row' },
          h('span', { className: 'sm-detail-label' }, 'Public Link'),
          h('code', { className: 'sm-detail-mono' }, `noema.art/spell/${spell.publicSlug || spell.slug}`),
          h(CopyButton, { text: `noema.art/spell/${spell.publicSlug || spell.slug}` })
        ) : null,

      // Steps
      spell.steps && spell.steps.length > 0
        ? h('div', { className: 'sm-steps' },
          h('div', { className: 'sm-steps-title' }, `Steps (${spell.steps.length})`),
          ...spell.steps.map((step, i) =>
            h('div', { className: 'sm-step', key: step.id || i },
              h('span', { className: 'sm-step-num' }, `${i + 1}.`),
              h('span', null, step.displayName || step.toolIdentifier)
            )
          )
        ) : null,

      // Exposed inputs
      spell.exposedInputs && spell.exposedInputs.length > 0
        ? h('div', { className: 'sm-exposed' },
          h('div', { className: 'sm-exposed-title' }, 'Exposed Inputs'),
          ...spell.exposedInputs.map((inp, i) =>
            h('div', { className: 'sm-exposed-item', key: `${inp.nodeId}__${inp.paramKey}` },
              h('span', null, `${inp.nodeId}: `),
              h('strong', null, inp.paramKey)
            )
          )
        ) : null
    );
  }

  _renderEditForm(spell) {
    const { editDraft, saving } = this.state;

    return h('div', { className: 'sm-edit' },
      h('div', { className: 'sm-form-group' },
        h('label', null, 'Name'),
        h('input', {
          className: 'sm-input',
          value: editDraft.name,
          oninput: (e) => this.setState({ editDraft: { ...editDraft, name: e.target.value } }),
        })
      ),
      h('div', { className: 'sm-form-group' },
        h('label', null, 'Description'),
        h('textarea', {
          className: 'sm-textarea',
          value: editDraft.description || '',
          oninput: (e) => this.setState({ editDraft: { ...editDraft, description: e.target.value } }),
        })
      ),
      h('div', { className: 'sm-form-group' },
        h('label', null, 'Visibility'),
        h('select', {
          className: 'sm-select',
          value: editDraft.visibility,
          onchange: (e) => this.setState({ editDraft: { ...editDraft, visibility: e.target.value } }),
        },
          h('option', { value: VISIBILITY.PRIVATE }, 'Private'),
          h('option', { value: VISIBILITY.LISTED }, 'Listed (Marketplace)'),
          h('option', { value: VISIBILITY.PUBLIC }, 'Public')
        )
      ),
      editDraft.visibility === VISIBILITY.LISTED
        ? h('div', { className: 'sm-form-group' },
          h('label', null, `Price (points) — ~$${((editDraft.pricePoints || 0) * POINTS_TO_USD).toFixed(2)}`),
          h('input', {
            className: 'sm-input',
            type: 'number',
            min: 1,
            value: editDraft.pricePoints || 100,
            oninput: (e) => this.setState({ editDraft: { ...editDraft, pricePoints: Number(e.target.value) } }),
          })
        ) : null,

      h('div', { className: 'sm-edit-actions' },
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._cancelEdit), label: 'Cancel' }),
        h(AsyncButton, { loading: saving, onclick: this.bind(this._saveSpell), label: 'Save Changes' })
      )
    );
  }

  // ── Render: Create ────────────────────────────────────────

  _renderCreate() {
    const { subgraph, createName, createDesc, createVisibility, createPrice, createExposed, creating, createError } = this.state;
    const nodes = subgraph?.nodes || [];

    // Collect all possible exposed inputs from the subgraph
    const potentialInputs = [];
    nodes.forEach(node => {
      const mappings = node.parameterMappings || {};
      Object.keys(mappings).forEach(paramKey => {
        const key = `${node.id}__${paramKey}`;
        potentialInputs.push({ key, nodeId: node.id, paramKey, nodeName: node.displayName });
      });
    });

    return h('div', null,
      h('button', { className: 'sm-back', onclick: this.bind(this._goList) }, '\u2190 Back'),
      h('h3', { style: 'color:#fff;margin:0 0 16px' }, 'Create New Spell'),

      createError ? ModalError({ message: createError }) : null,

      h('div', { className: 'sm-form-group' },
        h('label', null, 'Spell Name *'),
        h('input', {
          className: 'sm-input',
          value: createName,
          placeholder: 'My awesome spell',
          oninput: (e) => this.setState({ createName: e.target.value }),
        })
      ),
      h('div', { className: 'sm-form-group' },
        h('label', null, 'Description'),
        h('textarea', {
          className: 'sm-textarea',
          value: createDesc,
          placeholder: 'What does this spell do?',
          oninput: (e) => this.setState({ createDesc: e.target.value }),
        })
      ),
      h('div', { className: 'sm-form-group' },
        h('label', null, 'Visibility'),
        h('select', {
          className: 'sm-select',
          value: createVisibility,
          onchange: (e) => this.setState({ createVisibility: e.target.value }),
        },
          h('option', { value: VISIBILITY.PRIVATE }, 'Private'),
          h('option', { value: VISIBILITY.LISTED }, 'Listed (Marketplace)'),
          h('option', { value: VISIBILITY.PUBLIC }, 'Public')
        )
      ),
      createVisibility === VISIBILITY.LISTED
        ? h('div', { className: 'sm-form-group' },
          h('label', null, `Price (points) — ~$${(createPrice * POINTS_TO_USD).toFixed(2)}`),
          h('input', {
            className: 'sm-input', type: 'number', min: 1, value: createPrice,
            oninput: (e) => this.setState({ createPrice: Number(e.target.value) }),
          })
        ) : null,

      // Steps
      nodes.length > 0
        ? h('div', { className: 'sm-create-steps' },
          h('div', { className: 'sm-steps-title' }, `Steps (${nodes.length})`),
          ...nodes.map((node, i) =>
            h('div', { className: 'sm-step', key: node.id },
              h('span', { className: 'sm-step-num' }, `${i + 1}.`),
              h('span', null, node.displayName)
            )
          )
        ) : null,

      // Exposed inputs
      potentialInputs.length > 0
        ? h('div', { className: 'sm-create-exposed' },
          h('div', { className: 'sm-exposed-title' }, 'Expose Inputs'),
          h('p', { style: 'color:#888;font-size:14px;margin:0 0 8px' }, 'Exposed inputs can be overridden when someone casts your spell.'),
          ...potentialInputs.map(inp =>
            h('label', { className: 'sm-checkbox-row', key: inp.key },
              h('input', {
                type: 'checkbox',
                checked: !!createExposed[inp.key],
                onchange: (e) => this.setState({
                  createExposed: { ...createExposed, [inp.key]: e.target.checked }
                }),
              }),
              h('span', null, `${inp.nodeName}: `),
              h('strong', null, inp.paramKey)
            )
          )
        ) : null,

      h('div', { className: 'sm-nav' },
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._goList), label: 'Cancel' }),
        h(AsyncButton, {
          loading: creating,
          disabled: !createName.trim(),
          onclick: this.bind(this._createSpell),
          label: 'Save Spell',
        })
      )
    );
  }

  // ── Render: Marketplace List ──────────────────────────────

  _renderMarketList() {
    const { marketSpells, marketLoading, marketError, marketSearch, marketTag, marketTags } = this.state;

    return h('div', null,
      h(SearchBar, {
        value: marketSearch,
        placeholder: 'Search marketplace...',
        onInput: (v) => this.setState({ marketSearch: v }),
        onSearch: this.bind(this._fetchMarketplace),
      }),
      marketTags.length > 0
        ? h(TagPills, {
          tags: marketTags,
          active: marketTag,
          onSelect: (tag) => { this.setState({ marketTag: tag }); this._fetchMarketplace(); },
        }) : null,

      marketLoading ? h(Loader, { message: 'Loading marketplace...' }) : null,
      marketError ? h('div', null,
        ModalError({ message: marketError }),
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._fetchMarketplace), label: 'Retry' })
      ) : null,

      !marketLoading && marketSpells.length === 0
        ? h(EmptyState, { icon: '\uD83D\uDD0D', message: 'No spells found. Try a different search or tag.' })
        : null,

      ...marketSpells.map(spell => this._renderMarketCard(spell))
    );
  }

  _renderMarketCard(spell) {
    return h('div', {
      className: 'sm-card sm-card--market',
      key: spell.spellId || spell._id || spell.slug,
      onclick: () => this._fetchMarketDetail(spell),
    },
      h('div', { className: 'sm-card-top' },
        h('div', { className: 'sm-card-name' }, spell.name),
        h('div', { className: 'sm-card-meta' },
          spell.uses != null ? h('span', { className: 'sm-card-uses' }, `${spell.uses} uses`) : null
        )
      ),
      spell.description
        ? h('div', { className: 'sm-card-desc' }, spell.description.length > 120 ? spell.description.slice(0, 120) + '...' : spell.description)
        : null,
      spell.tags && spell.tags.length > 0
        ? h('div', { className: 'sm-card-tags' },
          ...spell.tags.map(t => h(Badge, { label: t, variant: 'info', key: t }))
        ) : null
    );
  }

  // ── Render: Marketplace Detail ────────────────────────────

  _renderMarketDetail() {
    const { marketSpell, marketDetailLoading, marketDetailError, quote, quoteLoading, casting, castResult } = this.state;

    if (marketDetailLoading) return h('div', null,
      h('button', { className: 'sm-back', onclick: this.bind(this._goList) }, '\u2190 Marketplace'),
      h(Loader, { message: 'Loading spell...' })
    );
    if (marketDetailError) return h('div', null,
      h('button', { className: 'sm-back', onclick: this.bind(this._goList) }, '\u2190 Marketplace'),
      ModalError({ message: marketDetailError })
    );

    const spell = marketSpell;

    return h('div', null,
      h('button', { className: 'sm-back', onclick: this.bind(this._goList) }, '\u2190 Marketplace'),

      h('h3', { className: 'sm-detail-name' }, spell.name),
      spell.description ? h('p', { className: 'sm-detail-desc' }, spell.description) : null,

      h('div', { className: 'sm-market-meta' },
        spell.uses != null ? h('span', null, `${spell.uses} uses`) : null,
        spell.tags && spell.tags.length > 0
          ? h('span', { className: 'sm-card-tags' }, ...spell.tags.map(t => h(Badge, { label: t, variant: 'info', key: t })))
          : null
      ),

      // Cost quote
      h('div', { className: 'sm-quote' },
        h('div', { className: 'sm-quote-title' }, 'Estimated Cost'),
        quoteLoading
          ? h('span', { style: 'color:#888;font-size:16px' }, 'Calculating...')
          : quote
            ? h('div', { className: 'sm-quote-body' },
              h('span', null, `${quote.totalCostPts?.toFixed(1) || '?'} pts`),
              h('span', { className: 'sm-quote-usd' }, `~$${((quote.totalCostPts || 0) * POINTS_TO_USD).toFixed(4)}`),
              quote.totalRuntimeMs ? h('span', { className: 'sm-quote-time' }, `~${(quote.totalRuntimeMs / 1000).toFixed(1)}s`) : null
            )
            : h('span', { style: 'color:#666;font-size:16px' }, 'No estimate available')
      ),

      // Steps
      spell.steps && spell.steps.length > 0
        ? h('div', { className: 'sm-steps' },
          h('div', { className: 'sm-steps-title' }, `Steps (${spell.steps.length})`),
          ...spell.steps.map((step, i) =>
            h('div', { className: 'sm-step', key: step.id || step.stepId || i },
              h('span', { className: 'sm-step-num' }, `${i + 1}.`),
              h('span', null, step.displayName || step.toolIdentifier)
            )
          )
        ) : null,

      // Actions
      h('div', { className: 'sm-detail-actions' },
        h(AsyncButton, {
          loading: casting,
          onclick: this.bind(this._castSpell),
          label: 'Cast Spell',
        }),
        h(AsyncButton, {
          variant: 'secondary',
          onclick: () => this._addToCanvas(spell),
          label: '+ Add to Canvas',
        })
      ),

      // Cast result
      castResult ? h('div', {
        className: `sm-cast-result${castResult.status === 'failed' ? ' sm-cast-result--err' : ''}`,
      },
        castResult.status === 'failed'
          ? `Cast failed: ${castResult.error || 'Unknown error'}`
          : `Cast ${castResult.status || 'submitted'}! ${castResult.castId ? `ID: ${castResult.castId}` : ''}`
      ) : null
    );
  }

  // ── Styles ────────────────────────────────────────────────

  static get styles() {
    return `
      /* List */
      .sm-list-header { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
      .sm-filter-input { flex: 1; background: #222; border: 1px solid #444; color: #e0e0e0; padding: 8px 12px; border-radius: 6px; font-size: 16px; }
      .sm-filter-input:focus { border-color: #90caf9; outline: none; }
      .sm-no-results { color: #666; font-size: 17px; text-align: center; padding: 20px 0; }

      /* Cards */
      .sm-card { background: #222; border: 1px solid #333; border-radius: 8px; padding: 14px 16px; margin-bottom: 8px; cursor: pointer; transition: border-color 0.15s; }
      .sm-card:hover { border-color: #555; }
      .sm-card--market { border-left: 3px solid #6366f1; }
      .sm-card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
      .sm-card-name { font-weight: 600; font-size: 18px; color: #fff; }
      .sm-card-meta { display: flex; gap: 8px; align-items: center; }
      .sm-card-steps { font-size: 13px; color: #888; }
      .sm-card-uses { font-size: 13px; color: #90caf9; }
      .sm-card-desc { font-size: 16px; color: #999; line-height: 1.4; margin-bottom: 8px; }
      .sm-card-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
      .sm-card-actions { display: flex; justify-content: flex-end; }
      .sm-card-add { background: none; border: 1px solid #444; color: #90caf9; padding: 4px 12px; border-radius: 4px; font-size: 14px; cursor: pointer; }
      .sm-card-add:hover { border-color: #90caf9; background: rgba(144,202,249,0.05); }

      /* Detail */
      .sm-back { background: none; border: none; color: #90caf9; cursor: pointer; font-size: 16px; padding: 0; margin-bottom: 16px; }
      .sm-back:hover { text-decoration: underline; }
      .sm-detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .sm-detail-name { margin: 0; font-size: 22px; color: #fff; }
      .sm-detail-desc { color: #aaa; font-size: 17px; line-height: 1.5; margin: 0 0 16px; }
      .sm-detail-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 16px; }
      .sm-detail-label { color: #888; min-width: 80px; }
      .sm-detail-mono { font-family: monospace; color: #ccc; font-size: 14px; }
      .sm-detail-price { color: #f39c12; font-size: 14px; }
      .sm-detail-actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }

      /* Steps */
      .sm-steps { margin: 16px 0; }
      .sm-steps-title { font-size: 16px; color: #888; font-weight: 600; margin-bottom: 8px; }
      .sm-step { display: flex; gap: 8px; padding: 6px 0; font-size: 16px; color: #ccc; border-bottom: 1px solid #222; }
      .sm-step-num { color: #666; min-width: 20px; }

      /* Exposed */
      .sm-exposed { margin: 16px 0; }
      .sm-exposed-title { font-size: 16px; color: #888; font-weight: 600; margin-bottom: 8px; }
      .sm-exposed-item { font-size: 16px; color: #aaa; padding: 4px 0; }
      .sm-exposed-item strong { color: #90caf9; }

      /* Edit / Create form */
      .sm-edit { margin: 16px 0; }
      .sm-form-group { margin-bottom: 14px; }
      .sm-form-group label { display: block; margin-bottom: 6px; color: #aaa; font-weight: 600; font-size: 16px; }
      .sm-input { width: 100%; padding: 8px 12px; background: #222; border: 1px solid #444; border-radius: 6px; color: #e0e0e0; font-size: 17px; box-sizing: border-box; }
      .sm-input:focus { border-color: #90caf9; outline: none; }
      .sm-textarea { width: 100%; padding: 8px 12px; background: #222; border: 1px solid #444; border-radius: 6px; color: #e0e0e0; font-size: 17px; min-height: 60px; resize: vertical; box-sizing: border-box; font-family: inherit; }
      .sm-textarea:focus { border-color: #90caf9; outline: none; }
      .sm-select { width: 100%; padding: 8px 12px; background: #222; border: 1px solid #444; border-radius: 6px; color: #e0e0e0; font-size: 17px; }
      .sm-edit-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
      .sm-nav { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

      /* Checkbox rows */
      .sm-checkbox-row { display: flex; gap: 8px; align-items: center; padding: 4px 0; font-size: 16px; color: #ccc; cursor: pointer; }
      .sm-checkbox-row input[type=checkbox] { accent-color: #90caf9; }

      /* Create steps */
      .sm-create-steps { margin: 16px 0; }
      .sm-create-exposed { margin: 16px 0; }

      /* Marketplace meta */
      .sm-market-meta { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; font-size: 16px; color: #888; }

      /* Quote */
      .sm-quote { background: #1e1e2e; border: 1px solid #333; border-radius: 8px; padding: 14px; margin: 16px 0; }
      .sm-quote-title { font-size: 14px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
      .sm-quote-body { display: flex; gap: 16px; font-size: 18px; color: #fff; }
      .sm-quote-usd { color: #888; font-size: 16px; }
      .sm-quote-time { color: #90caf9; font-size: 16px; }

      /* Cast result */
      .sm-cast-result { margin-top: 12px; padding: 10px 14px; border-radius: 6px; font-size: 16px; color: #2ecc71; background: rgba(46,204,113,0.08); }
      .sm-cast-result--err { color: #e74c3c; background: rgba(231,76,60,0.08); }
    `;
  }

  // ── Main render ───────────────────────────────────────────

  render() {
    const { view } = this.state;
    const title = view === VIEW.CREATE ? 'Create Spell' : 'Spells';

    return h(Modal, {
      onClose: this.props.onClose,
      title,
      wide: true,
      content: [this._renderBody()],
    });
  }
}
