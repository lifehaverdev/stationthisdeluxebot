import BaseWindow from './BaseWindow.js';
import { renderResultContent } from '../node/resultContent.js';
import { getToolWindows } from '../state.js';

/**
 * CollectionWindow – unified window for collection test & review.
 * mode: 'test' | 'review'
 */
export default class CollectionWindow extends BaseWindow {
  /**
   * @param {object} opts
   * @param {'test'|'review'} opts.mode
   * @param {object} opts.collection – collection object from API
   * @param {object} opts.position – { x, y }
   */
  constructor({ mode = 'test', collection, position = { x: 200, y: 120 } }) {
    const idPrefix = mode === 'test' ? 'col-test' : 'col-review';
    const id = `${idPrefix}-${Math.random().toString(36).slice(2, 10)}`;
    const title = `${collection.name || 'Collection'} · ${mode === 'test' ? 'Test' : 'Review'}`;
    super({ id, title, position, classes: ['collection-window'] });

    this.mode = mode;
    this.collection = collection;

    this.renderBody();
  }

  serialize() {
    return {
      ...super.serialize(),
      type: 'collection',
      mode: this.mode,
      collection: this.collection
    };
  }

  renderBody() {
    if (this.mode === 'review') {
      this._renderReview();
    } else {
      this._renderTest();
    }
  }

  /* ---------------- Review Mode ---------------- */
  _renderReview() {
    const body = this.body;
    body.innerHTML = `<div style="text-align:center;"><button class="start-review-btn">Start Reviewing</button></div>`;

    body.addEventListener('click', (e) => {
      if (e.target.classList.contains('start-review-btn')) {
        this._loadNextReview();
      }
    });
  }

  async _loadNextReview() {
    const body = this.body;
    body.textContent = 'Loading…';
    try {
      const res = await fetch(`/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/pieces/unreviewed`);
      const json = await res.json();
      const gen = (json.generations || [])[0];
      if (!gen) {
        body.textContent = 'No unreviewed pieces 🎉';
        return;
      }
      body.innerHTML = '';
      const resultDiv = document.createElement('div');
      resultDiv.className = 'result-container';
      body.appendChild(resultDiv);
      renderResultContent(resultDiv, { type: 'text', text: gen.outputs?.text || gen.outputs?.response || '(unknown output)' });

      const btnRow = document.createElement('div');
      const acceptBtn = document.createElement('button');
      acceptBtn.textContent = 'Accept ✅';
      const rejectBtn = document.createElement('button');
      rejectBtn.textContent = 'Reject ❌';
      btnRow.append(acceptBtn, rejectBtn);
      body.appendChild(btnRow);

      const mark = async (outcome) => {
        await fetch(`/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/pieces/${encodeURIComponent(gen._id)}/review`, {
          method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome })
        });
        this._loadNextReview();
      };
      acceptBtn.onclick = () => mark('accepted');
      rejectBtn.onclick = () => mark('rejected');
    } catch (e) {
      body.textContent = 'Error loading piece';
    }
  }

  /* ---------------- Test Mode ---------------- */
  async _renderTest() {
    const body = this.body;
    body.innerHTML = '';

    const categories = this.collection.config?.traitTree || [];
    const selects = {};

    // Trait selectors form ------------------
    categories.forEach(cat => {
      const row = document.createElement('div');
      row.style.marginBottom = '4px';
      const label = document.createElement('label');
      label.textContent = cat.name;
      label.style.marginRight = '6px';
      row.appendChild(label);

      let inp;
      if (cat.mode === 'generated' && cat.generator?.type === 'range') {
        inp = document.createElement('input');
        inp.type = 'number';
        if (Number.isFinite(cat.generator.start)) inp.min = String(cat.generator.start);
        if (Number.isFinite(cat.generator.end)) inp.max = String(cat.generator.end);
        if (Number.isFinite(cat.generator.step)) inp.step = String(cat.generator.step);
      } else {
        inp = document.createElement('select');
        inp.innerHTML = `<option value="">(random)</option>` + (cat.traits || []).map(t => `<option value="${t.value ?? t.name}">${t.name}</option>`).join('');
      }
      selects[cat.name] = inp;
      row.appendChild(inp);
      body.appendChild(row);
    });

    // Parameter inputs (required/optional) --------
    const paramsWrap = document.createElement('div');
    paramsWrap.style.marginTop = '8px';
    const requiredSection = document.createElement('div');
    requiredSection.className = 'required-params';
    const optionalSection = document.createElement('div');
    optionalSection.className = 'optional-params';
    optionalSection.style.display = 'none';
    const showMoreBtn = document.createElement('button');
    showMoreBtn.textContent = 'show more';
    showMoreBtn.className = 'show-more-button';
    let expanded = false;
    showMoreBtn.onclick = () => {
      expanded = !expanded;
      optionalSection.style.display = expanded ? 'flex' : 'none';
      showMoreBtn.textContent = expanded ? 'show less' : 'show more';
      showMoreBtn.classList.toggle('active', expanded);
    };
    paramsWrap.append(requiredSection, showMoreBtn, optionalSection);
    body.appendChild(paramsWrap);

    // Fetch tool definition for parameter schema ----------
    let toolDef;
    try {
      const res = await fetch(`/api/v1/tools/registry/${encodeURIComponent(this.collection.toolId)}`);
      if (res.ok) toolDef = await res.json();
    } catch {}
    const overrides = this.collection.config?.paramOverrides || {};
    const schema = toolDef?.inputSchema || {};
    const paramEntries = Object.entries(schema).reduce((acc, [k, d]) => {
      (d?.required ? acc.req : acc.opt).push([k, d]);
      return acc;
    }, { req: [], opt: [] });

    const createInput = (k, d) => {
      const wrap = document.createElement('div');
      wrap.className = 'parameter-input';
      wrap.dataset.paramName = k;
      const lab = document.createElement('label');
      lab.textContent = d?.name || k;
      const inp = document.createElement('input');
      inp.type = (d?.type === 'number' || d?.type === 'integer') ? 'number' : 'text';
      inp.value = overrides[k] ?? (d?.default ?? '');
      inp.name = k;
      inp.placeholder = d?.description || lab.textContent;
      wrap.append(lab, inp);
      return wrap;
    };
    paramEntries.req.forEach(e => requiredSection.appendChild(createInput(...e)));
    paramEntries.opt.forEach(e => optionalSection.appendChild(createInput(...e)));

    // Buttons row ------------------
    const btnRow = document.createElement('div');
    btnRow.style.marginTop = '8px';
    const randBtn = document.createElement('button');
    randBtn.textContent = '🎲';
    const execBtn = document.createElement('button');
    execBtn.textContent = 'Execute';
    execBtn.style.marginLeft = '8px';
    btnRow.append(randBtn, execBtn);
    body.appendChild(btnRow);

    const outputDiv = document.createElement('div');
    outputDiv.style.marginTop = '10px';
    body.appendChild(outputDiv);

    // Pre-create step status list so websocket handlers can update
    const stepUl = document.createElement('ul');
    stepUl.className = 'spell-step-status';
    const stepLi = document.createElement('li');
    stepLi.dataset.toolId = this.collection.toolId;
    stepLi.textContent = `1. ${this.collection.toolId}`;
    stepLi.className = 'pending';
    stepUl.appendChild(stepLi);
    body.appendChild(stepUl);

    let progressIndicator; let progBar;

    // Randomise traits handler
    randBtn.onclick = () => {
      categories.forEach(cat => {
        const el = selects[cat.name];
        if (!el) return;
        if (el.tagName === 'SELECT') {
          const opts = Array.from(el.options).slice(1);
          if (opts.length) el.value = opts[Math.floor(Math.random() * opts.length)].value;
        } else if (el.type === 'number') {
          const g = cat.generator || {};
          const start = Number(g.start) || 0;
          const end = Number(g.end) || start;
          const step = Number(g.step) || 1;
          const count = Math.floor((end - start) / step) + 1;
          const idx = Math.floor(Math.random() * count);
          el.value = String(start + idx * step);
        }
      });
    };

    // Execute handler ------------------------
    execBtn.onclick = async () => {
      // progress UI bootstrap
      if (!progressIndicator) {
        progressIndicator = document.createElement('div');
        progressIndicator.className = 'progress-indicator';
        body.appendChild(progressIndicator);
      }
      progressIndicator.textContent = 'Executing…';

      if (!progBar) {
        progBar = document.createElement('progress');
        progBar.className = 'spell-progress-bar';
        progBar.max = 100; progBar.value = 0;
        body.appendChild(progBar);
      }

      outputDiv.textContent = '';

      const traitSel = {};
      categories.forEach(cat => {
        const el = selects[cat.name];
        if (!el) return;
        const val = el.value;
        if (val !== '') traitSel[cat.name] = el.type === 'number' ? Number(val) : val;
      });

      // Build paramOverrides from inputs
      const paramOverrides = {};
      paramsWrap.querySelectorAll('.parameter-input input').forEach(inp => {
        paramOverrides[inp.name] = inp.type === 'number' ? Number(inp.value) : inp.value;
      });

      // Substitute traits into param strings
      Object.entries(paramOverrides).forEach(([k, v]) => {
        if (typeof v === 'string') {
          Object.entries(traitSel).forEach(([cat, catVal]) => {
            v = v.replaceAll(`[[${cat}]]`, String(catVal)).replaceAll(`[[${cat.toLowerCase()}]]`, String(catVal));
          });
          paramOverrides[k] = v;
        }
      });

      // Execute via executionClient (ensure dynamically imported)
      try {
        const { default: execClient } = await import('../executionClient.js');
        const payload = { toolId: this.collection.toolId, inputs: paramOverrides, metadata: { platform: 'cook-test', traitSel } };
        const res = await execClient.execute(payload);
        outputDiv.innerHTML = '';
        renderResultContent(outputDiv, res.outputs?.[0]?.data || { type: 'text', text: 'Done' });
      } catch (e) {
        outputDiv.textContent = e.message || 'Error';
      }
    };
  }
}

// Factory helpers for legacy calls
export function createCollectionReviewWindow(collection, position) {
  const win = new CollectionWindow({ mode: 'review', collection, position });
  win.mount();
  return win.el;
}

export function createCollectionTestWindow(collection, position) {
  const win = new CollectionWindow({ mode: 'test', collection, position });
  win.mount();
  return win.el;
}
