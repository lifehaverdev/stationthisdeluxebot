import { Component, h } from '@monygroupcorp/microact';
import { AsyncButton, ConfirmInline } from './ModalKit.js';

const DEFAULT_GENERATOR = { type: 'range', start: 0, end: 10, step: 1, zeroPad: 0, uniqueAcrossCook: false, shuffleSeed: null };

/**
 * TraitTreeEditor — microact component for editing collection trait trees.
 *
 * Props:
 *   categories — array of category objects (initial value)
 *   onChange   — (categories) => void, called on every mutation
 *   onSave    — (categories) => Promise<void>
 */
export class TraitTreeEditor extends Component {
  constructor(props) {
    super(props);
    this.state = {
      categories: Array.isArray(props.categories) ? JSON.parse(JSON.stringify(props.categories)) : [],
      expandedIdx: null,
      validationErrors: {},
      isDirty: false,
      saving: false,
      newCatName: '',
      // New trait inputs per category
      newTraits: {},
    };
  }

  // ── Validation ──────────────────────────────────────────

  _validateTrait(trait) {
    const errors = [];
    if (!trait.name || trait.name.trim().length === 0) errors.push('Name is required');
    if (trait.name && trait.name.length > 50) errors.push('Name must be less than 50 characters');
    if (trait.value && trait.value.length > 1000) errors.push('Value must be less than 1000 characters');
    if (trait.rarity !== undefined && trait.rarity !== '') {
      const r = Number(trait.rarity);
      if (isNaN(r) || r < 0 || r > 100) errors.push('Rarity must be between 0 and 100');
    }
    return errors;
  }

  _setValidationError(catIdx, traitIdx, errors) {
    const key = `${catIdx}:${traitIdx}`;
    const ve = { ...this.state.validationErrors };
    if (errors && errors.length) {
      ve[key] = errors;
    } else {
      delete ve[key];
    }
    this.setState({ validationErrors: ve });
  }

  _clearCategoryErrors(catIdx) {
    const ve = { ...this.state.validationErrors };
    const prefix = `${catIdx}:`;
    Object.keys(ve).forEach(k => { if (k.startsWith(prefix)) delete ve[k]; });
    this.setState({ validationErrors: ve });
  }

  // ── Mutations ───────────────────────────────────────────

  _mutate(categories) {
    this.setState({ categories, isDirty: true });
    this.props.onChange?.(categories);
  }

  _addCategory() {
    const name = this.state.newCatName.trim();
    if (!name) return;
    const cats = [...this.state.categories, { name, mode: 'manual', traits: [] }];
    this.setState({ newCatName: '' });
    this._mutate(cats);
  }

  _deleteCategory(idx) {
    const cats = [...this.state.categories];
    cats.splice(idx, 1);
    this._clearCategoryErrors(idx);
    this._mutate(cats);
  }

  _updateCategoryName(idx, name) {
    const cats = [...this.state.categories];
    cats[idx] = { ...cats[idx], name };
    this._mutate(cats);
  }

  _changeCategoryMode(idx, mode) {
    const cats = [...this.state.categories];
    const cat = { ...cats[idx], mode };
    if (mode === 'generated') {
      cat.generator = cat.generator || { ...DEFAULT_GENERATOR };
    }
    cats[idx] = cat;
    this._mutate(cats);
  }

  _updateGenerator(catIdx, field, value) {
    const cats = [...this.state.categories];
    const cat = { ...cats[catIdx] };
    cat.generator = { ...(cat.generator || DEFAULT_GENERATOR), [field]: value };
    cats[catIdx] = cat;
    this._mutate(cats);
  }

  _addTrait(catIdx) {
    const nt = this.state.newTraits[catIdx] || { name: '', value: '', rarity: '' };
    const errors = this._validateTrait(nt);
    if (errors.length) {
      this._setValidationError(catIdx, 'new', errors);
      return;
    }
    this._setValidationError(catIdx, 'new', null);
    const cats = [...this.state.categories];
    const cat = { ...cats[catIdx], traits: [...(cats[catIdx].traits || [])] };
    const rarity = nt.rarity !== '' ? Number(nt.rarity) : undefined;
    cat.traits.push({ name: nt.name.trim(), value: nt.value.trim(), rarity });
    cats[catIdx] = cat;
    const newTraits = { ...this.state.newTraits, [catIdx]: { name: '', value: '', rarity: '' } };
    this.setState({ newTraits });
    this._mutate(cats);
  }

  _deleteTrait(catIdx, traitIdx) {
    const cats = [...this.state.categories];
    const cat = { ...cats[catIdx], traits: [...(cats[catIdx].traits || [])] };
    cat.traits.splice(traitIdx, 1);
    cats[catIdx] = cat;
    this._setValidationError(catIdx, traitIdx, null);
    this._mutate(cats);
  }

  _cloneTrait(catIdx, traitIdx) {
    const cats = [...this.state.categories];
    const cat = { ...cats[catIdx], traits: [...(cats[catIdx].traits || [])] };
    const orig = { ...cat.traits[traitIdx] };
    cat.traits.splice(traitIdx + 1, 0, orig);
    cats[catIdx] = cat;
    this._mutate(cats);
  }

  _updateTraitField(catIdx, traitIdx, field, value) {
    const cats = [...this.state.categories];
    const cat = { ...cats[catIdx], traits: [...(cats[catIdx].traits || [])] };
    cat.traits[traitIdx] = { ...cat.traits[traitIdx], [field]: value };
    cats[catIdx] = cat;
    // Re-validate on change
    const errors = this._validateTrait(cat.traits[traitIdx]);
    this._setValidationError(catIdx, traitIdx, errors.length ? errors : null);
    this._mutate(cats);
  }

  _editCategoryJson(catIdx) {
    const category = this.state.categories[catIdx];
    if (!category) return;
    const initial = JSON.stringify(category, null, 2);
    const newValue = window.prompt('Edit category JSON:', initial);
    if (newValue === null) return;
    {
      let parsed;
      try { parsed = JSON.parse(newValue); } catch (err) {
        alert('Failed to parse JSON: ' + err.message);
        return;
      }
      if (!parsed || typeof parsed !== 'object') { alert('JSON must describe an object.'); return; }
      if (typeof parsed.name !== 'string' || !parsed.name.trim()) { alert('Category must include a non-empty "name" field.'); return; }
      parsed.name = parsed.name.trim();
      parsed.mode = parsed.mode === 'generated' ? 'generated' : 'manual';
      if (parsed.mode === 'manual') {
        parsed.traits = Array.isArray(parsed.traits) ? parsed.traits : [];
      } else {
        parsed.generator = parsed.generator || { ...DEFAULT_GENERATOR };
      }
      const cats = [...this.state.categories];
      cats[catIdx] = parsed;
      this._clearCategoryErrors(catIdx);
      this._mutate(cats);
    }
  }

  async _save() {
    if (!this.props.onSave) return;
    this.setState({ saving: true });
    try {
      await this.props.onSave(this.state.categories);
      this.setState({ saving: false, isDirty: false });
    } catch (err) {
      this.setState({ saving: false });
    }
  }

  // ── Range helpers ───────────────────────────────────────

  _computeRangeCount(gen) {
    const start = Number.isFinite(gen.start) ? gen.start : 0;
    const end = Number.isFinite(gen.end) ? gen.end : start;
    const step = Number.isFinite(gen.step) && gen.step > 0 ? gen.step : 1;
    if (end < start) return 0;
    return Math.floor((end - start) / step) + 1;
  }

  _computeRangePreview(gen, n = 5) {
    const start = Number.isFinite(gen.start) ? gen.start : 0;
    const end = Number.isFinite(gen.end) ? gen.end : start;
    const step = Number.isFinite(gen.step) && gen.step > 0 ? gen.step : 1;
    const count = this._computeRangeCount(gen);
    const take = Math.min(n, count);
    const out = [];
    for (let i = 0; i < take; i++) out.push(start + i * step);
    const zp = Number(gen.zeroPad) || 0;
    return out.map(v => zp > 0 ? String(v).padStart(zp, '0') : String(v));
  }

  // ── Render ──────────────────────────────────────────────

  _renderGeneratedBody(cat, catIdx) {
    const gen = cat.generator || { ...DEFAULT_GENERATOR };
    const count = this._computeRangeCount(gen);
    const preview = this._computeRangePreview(gen, 5).join(', ');

    const numInput = (label, field, val) =>
      h('label', { style: 'display:flex;flex-direction:column;gap:2px;font-size:12px;color:#888' },
        label,
        h('input', {
          type: 'number', value: Number.isFinite(val) ? val : '',
          style: 'width:80px;background:#222;border:1px solid #444;color:#e0e0e0;padding:4px 6px;border-radius:4px;font-size:13px',
          oninput: (e) => {
            const v = e.target.value === '' ? undefined : Number(e.target.value);
            this._updateGenerator(catIdx, field, v);
          },
        })
      );

    return h('div', { style: 'padding:8px 0' },
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end' },
        numInput('Start', 'start', gen.start),
        numInput('End', 'end', gen.end),
        numInput('Step', 'step', gen.step),
        numInput('Zero Pad', 'zeroPad', gen.zeroPad),
        h('label', { style: 'display:flex;align-items:center;gap:4px;font-size:12px;color:#888' },
          h('input', {
            type: 'checkbox', checked: !!gen.uniqueAcrossCook,
            onchange: (e) => this._updateGenerator(catIdx, 'uniqueAcrossCook', e.target.checked),
          }),
          'Unique'
        ),
        numInput('Shuffle Seed', 'shuffleSeed', gen.shuffleSeed),
      ),
      h('div', { style: 'margin-top:8px;color:#666;font-size:12px' }, `Count: ${count} | Preview: ${preview}`),
      h('div', { style: 'margin-top:8px' },
        h(AsyncButton, { variant: 'secondary', onclick: () => this._editCategoryJson(catIdx), label: 'Edit JSON' })
      )
    );
  }

  _renderManualBody(cat, catIdx) {
    const traits = cat.traits || [];
    const nt = this.state.newTraits[catIdx] || { name: '', value: '', rarity: '' };
    const newErrors = this.state.validationErrors[`${catIdx}:new`] || [];

    const inputStyle = 'background:#222;border:1px solid #444;color:#e0e0e0;padding:4px 8px;border-radius:4px;font-size:13px;width:100%;box-sizing:border-box';
    const cellStyle = 'padding:4px 4px;vertical-align:top';

    return h('div', { style: 'padding:8px 0' },
      h('table', { style: 'width:100%;border-collapse:collapse' },
        h('thead', null,
          h('tr', { style: 'font-size:12px;color:#888;text-align:left' },
            h('th', { style: 'padding:4px;width:30%' }, 'Name *'),
            h('th', { style: 'padding:4px;width:40%' }, 'Value'),
            h('th', { style: 'padding:4px;width:15%' }, 'Rarity %'),
            h('th', { style: 'padding:4px;width:15%' })
          )
        ),
        h('tbody', null,
          ...traits.map((tr, tIdx) => {
            const errs = this.state.validationErrors[`${catIdx}:${tIdx}`] || [];
            return h('tr', { key: `${catIdx}-${tIdx}`, style: errs.length ? 'background:rgba(255,68,68,0.05)' : '' },
              h('td', { style: cellStyle },
                h('input', {
                  type: 'text', value: tr.name || '', maxlength: 50, style: inputStyle,
                  oninput: (e) => this._updateTraitField(catIdx, tIdx, 'name', e.target.value),
                }),
                errs.length ? h('div', { style: 'color:#f44;font-size:11px;margin-top:2px' }, errs.join(', ')) : null
              ),
              h('td', { style: cellStyle },
                h('input', {
                  type: 'text', value: tr.value !== undefined ? tr.value : (tr.prompt || ''), maxlength: 1000, style: inputStyle,
                  oninput: (e) => this._updateTraitField(catIdx, tIdx, 'value', e.target.value),
                })
              ),
              h('td', { style: cellStyle },
                h('input', {
                  type: 'number', value: tr.rarity ?? '', min: 0, max: 100, step: 0.1, style: inputStyle,
                  oninput: (e) => this._updateTraitField(catIdx, tIdx, 'rarity', e.target.value === '' ? undefined : Number(e.target.value)),
                })
              ),
              h('td', { style: cellStyle + ';white-space:nowrap' },
                h('button', {
                  style: 'background:none;border:none;color:#888;cursor:pointer;font-size:14px;padding:2px 4px',
                  title: 'Clone', onclick: () => this._cloneTrait(catIdx, tIdx),
                }, '\u29C9'),
                h('button', {
                  style: 'background:none;border:none;color:#f44;cursor:pointer;font-size:14px;padding:2px 4px',
                  title: 'Delete', onclick: () => this._deleteTrait(catIdx, tIdx),
                }, '\u2715')
              )
            );
          }),
          // New trait row
          h('tr', { style: 'border-top:1px solid #333' },
            h('td', { style: cellStyle },
              h('input', {
                type: 'text', value: nt.name, maxlength: 50, placeholder: 'Trait name', style: inputStyle,
                oninput: (e) => this.setState({ newTraits: { ...this.state.newTraits, [catIdx]: { ...nt, name: e.target.value } } }),
              }),
              newErrors.length ? h('div', { style: 'color:#f44;font-size:11px;margin-top:2px' }, newErrors.join(', ')) : null
            ),
            h('td', { style: cellStyle },
              h('input', {
                type: 'text', value: nt.value, maxlength: 1000, placeholder: 'Value', style: inputStyle,
                oninput: (e) => this.setState({ newTraits: { ...this.state.newTraits, [catIdx]: { ...nt, value: e.target.value } } }),
              })
            ),
            h('td', { style: cellStyle },
              h('input', {
                type: 'number', value: nt.rarity, min: 0, max: 100, step: 0.1, placeholder: '', style: inputStyle,
                oninput: (e) => this.setState({ newTraits: { ...this.state.newTraits, [catIdx]: { ...nt, rarity: e.target.value } } }),
              })
            ),
            h('td', { style: cellStyle },
              h('button', {
                style: 'background:none;border:1px solid #444;color:#90caf9;cursor:pointer;padding:4px 8px;border-radius:4px;font-size:13px',
                title: 'Add trait', onclick: () => this._addTrait(catIdx),
              }, '+')
            )
          )
        )
      ),
      this.state.isDirty ? h('div', { style: 'color:#f39c12;font-size:12px;margin-top:8px' }, 'You have unsaved changes') : null,
      h('div', { style: 'margin-top:8px' },
        h(AsyncButton, { variant: 'secondary', onclick: () => this._editCategoryJson(catIdx), label: 'Edit JSON' })
      )
    );
  }

  _renderCategory(cat, idx) {
    const expanded = this.state.expandedIdx === idx;
    const mode = cat.mode || 'manual';

    return h('div', {
      key: `cat-${idx}`,
      style: 'border:1px solid #333;border-radius:8px;margin-bottom:8px;overflow:hidden',
    },
      h('div', {
        style: 'display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1e1e2e;cursor:pointer',
        onclick: () => this.setState({ expandedIdx: expanded ? null : idx }),
      },
        h('span', { style: 'color:#888;font-size:12px;min-width:16px' }, expanded ? '\u25BC' : '\u25B6'),
        h('input', {
          type: 'text', value: cat.name || '',
          style: 'flex:1;background:transparent;border:1px solid transparent;color:#fff;font-size:14px;font-weight:600;padding:2px 6px;border-radius:4px',
          onclick: (e) => e.stopPropagation(),
          onfocus: (e) => { e.target.style.borderColor = '#444'; },
          onblur: (e) => { e.target.style.borderColor = 'transparent'; },
          oninput: (e) => this._updateCategoryName(idx, e.target.value),
        }),
        h('select', {
          style: 'background:#222;border:1px solid #444;color:#ccc;padding:2px 6px;border-radius:4px;font-size:12px',
          value: mode,
          onclick: (e) => e.stopPropagation(),
          onchange: (e) => this._changeCategoryMode(idx, e.target.value),
        },
          h('option', { value: 'manual' }, 'Manual'),
          h('option', { value: 'generated' }, 'Generated')
        ),
        h('button', {
          style: 'background:none;border:none;color:#f44;cursor:pointer;font-size:16px;padding:2px 6px',
          title: 'Delete category',
          onclick: (e) => { e.stopPropagation(); this._deleteCategory(idx); },
        }, '\u2715')
      ),
      expanded ? h('div', { style: 'padding:8px 12px;background:#161622' },
        mode === 'generated' ? this._renderGeneratedBody(cat, idx) : this._renderManualBody(cat, idx)
      ) : null
    );
  }

  static get styles() {
    return `
      .tte-root { }
      .tte-add-row { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
      .tte-add-input { flex: 1; background: #222; border: 1px solid #444; color: #e0e0e0; padding: 8px 12px; border-radius: 6px; font-size: 13px; }
      .tte-add-input:focus { border-color: #90caf9; outline: none; }
      .tte-footer { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
    `;
  }

  render() {
    const { categories, newCatName, saving, isDirty } = this.state;

    return h('div', { className: 'tte-root' },
      h('h3', { style: 'color:#fff;margin:0 0 12px;font-size:15px' }, 'Trait Categories'),
      categories.length === 0
        ? h('div', { style: 'color:#666;font-size:13px;padding:12px 0' }, 'No categories yet. Add one below.')
        : null,
      ...categories.map((cat, idx) => this._renderCategory(cat, idx)),
      h('div', { className: 'tte-add-row' },
        h('input', {
          className: 'tte-add-input',
          type: 'text', placeholder: 'New category name',
          value: newCatName,
          oninput: (e) => this.setState({ newCatName: e.target.value }),
          onkeydown: (e) => { if (e.key === 'Enter') this._addCategory(); },
        }),
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._addCategory), label: 'Add Category' })
      ),
      h('div', { className: 'tte-footer' },
        isDirty ? h('span', { style: 'color:#f39c12;font-size:12px;align-self:center' }, 'Unsaved changes') : null,
        h(AsyncButton, { loading: saving, onclick: this.bind(this._save), label: 'Save Changes' })
      )
    );
  }
}
