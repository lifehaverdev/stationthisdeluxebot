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
    // Tag as spell window to enable shared websocket progress handling when testing a spell
    if (mode === 'test' && collection.generatorType === 'spell') {
      this.el.classList.add('spell-window');
      if (collection.spellId) {
        this.el.dataset.spellId = collection.spellId;
      }
    }

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
      console.log('[CollectionWindow] unreviewed API response', json);
      const gen = (json.generations || [])[0];
      console.log('[CollectionWindow] selected generation', gen);
      if (!gen) {
        body.textContent = 'No unreviewed pieces 🎉';
        return;
      }
      body.innerHTML = '';
      const resultDiv = document.createElement('div');
      resultDiv.className = 'result-container';
      body.appendChild(resultDiv);
      // --- Normalise outputs similarly to websocketHandlers ---
      const outputs = gen.outputs || gen.responsePayload || gen.artifactUrls || {};
      console.log('[CollectionWindow] raw outputs', outputs);
      let outputData;
      if (Array.isArray(outputs) && outputs[0]?.data?.images?.[0]?.url) {
        outputData = { type: 'image', url: outputs[0].data.images[0].url, generationId: gen._id };
      } else if (Array.isArray(outputs.images) && outputs.images.length) {
        const firstImg = outputs.images[0];
        outputData = { type: 'image', url: (typeof firstImg==='string'? firstImg : firstImg.url), generationId: gen._id };
      } else if (outputs.image) {
        // single image string field
        outputData = { type: 'image', url: outputs.image, generationId: gen._id };
      } else if (outputs.imageUrl) {
        outputData = { type: 'image', url: outputs.imageUrl, generationId: gen._id };
      } else if (outputs.text) {
        outputData = { type: 'text', text: outputs.text, generationId: gen._id };
      } else if (outputs.response) {
        outputData = { type: 'text', text: outputs.response, generationId: gen._id };
      } else if (outputs.steps && Array.isArray(outputs.steps)) {
        outputData = { type: 'spell', steps: outputs.steps, generationId: gen._id };
      } else {
        outputData = { type: 'unknown', generationId: gen._id, ...outputs };
      }
      console.log('[CollectionWindow] outputData selected', outputData);
      renderResultContent(resultDiv, outputData);

      const btnRow = document.createElement('div');
      const acceptBtn = document.createElement('button');
      acceptBtn.textContent = 'Accept ✅';
      const rejectBtn = document.createElement('button');
      rejectBtn.textContent = 'Reject ❌';
      btnRow.append(acceptBtn, rejectBtn);
      body.appendChild(btnRow);

      const getCsrfToken = async () => {
        if (CollectionWindow._csrfToken) return CollectionWindow._csrfToken;
        try {
          const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
          const data = await res.json();
          CollectionWindow._csrfToken = data.csrfToken;
          return CollectionWindow._csrfToken;
        } catch { return ''; }
      };

      const mark = async (outcome) => {
        const csrf = await getCsrfToken();
        await fetch(`/api/v1/collections/${encodeURIComponent(this.collection.collectionId)}/pieces/${encodeURIComponent(gen._id)}/review`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({ outcome })
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
      let res;
      if (this.collection.generatorType==='spell' && this.collection.spellId) {
        res = await fetch(`/api/v1/spells/registry/${encodeURIComponent(this.collection.spellId)}`);
      } else {
        res = await fetch(`/api/v1/tools/registry/${encodeURIComponent(this.collection.toolId)}`);
      }
      if (res.ok) toolDef = await res.json();
    } catch {}
    const overrides = this.collection.config?.paramOverrides || {};
    let schema = toolDef?.inputSchema || {};
    if(Object.keys(schema).length===0 && Array.isArray(toolDef?.exposedInputs)){
      // create minimal schema objects marking them required
      schema = {};
      toolDef.exposedInputs.forEach(({ paramKey })=>{ schema[paramKey]={ required:true }; });
    }
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

    let stepUl; // will be created on execute for spells
    let progressIndicator;
    let progBar;

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
      // Note: Unlike SpellWindow we don't pre-create castId; mapping will rely on generationId until first update sets castId.
      // --- Progress UI bootstrap ---
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

      // Ensure we have step definitions for spell so we can build the status list
      let stepsArr = [];
      if (this.collection.generatorType === 'spell') {
        if (Array.isArray(toolDef?.steps) && toolDef.steps.length) {
          stepsArr = toolDef.steps;
        } else try {
          const resSteps = await fetch(`/api/v1/spells/registry/${encodeURIComponent(this.collection.spellId)}`);
          if (resSteps.ok) {
            const jd = await resSteps.json();
            stepsArr = Array.isArray(jd.steps) ? jd.steps : [];
            toolDef = jd; // cache for future reuse
          }
        } catch {}
      }

      // For spell generator type, build or reset step status list
      if (this.collection.generatorType === 'spell' && stepsArr.length) {
        if (!stepUl) {
          stepUl = document.createElement('ul');
          stepUl.className = 'spell-step-status';

          stepsArr.forEach((step, idx) => {
            const li = document.createElement('li');
            li.dataset.stepId = step.id || idx;
            li.dataset.toolId = step.toolIdentifier || step.toolId;
            li.textContent = `${idx + 1}. ${step.displayName || step.toolIdentifier || 'step'}`;
            li.className = 'pending';
            stepUl.appendChild(li);
          });

          body.appendChild(stepUl);
          // Mark first step as running
          const firstLi = stepUl.querySelector('li');
          if(firstLi) firstLi.className = 'running';
        } else {
          // reset to pending if re-executed
          stepUl.querySelectorAll('li').forEach(li => li.className = 'pending');
        }
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

      try {
        if (this.collection.generatorType==='spell' && this.collection.spellId) {
          // --- Register as spell window in global state (if not already) ---
          const { addToolWindow, getToolWindow } = await import('../state.js');
          const spellObj = {
            _id: this.collection.spellId,
            slug: this.collection.spellId,
            name: this.collection.name || 'Spell',
            steps: stepsArr,
            exposedInputs: Array.isArray(toolDef?.exposedInputs) ? toolDef.exposedInputs : []
          };
          const model = addToolWindow({ id: this.id, type:'spell', spell: spellObj });
          // Build parameterMappings keyed by nodeId_paramKey, matching executeSpell expectations
          const mappings = (model.parameterMappings = {});
          // 1. create lookup of form values
          const formValues = {};
          paramsWrap.querySelectorAll('.parameter-input input').forEach(inp=>{
            formValues[inp.name] = inp.type==='number'? Number(inp.value) : inp.value;
          });
          // 2. map over exposedInputs to create proper keys
          (spellObj.exposedInputs || []).forEach(inpDef=>{
            const val=formValues[inpDef.paramKey];
            if(val!==undefined){
              mappings[`${inpDef.nodeId}_${inpDef.paramKey}`]={ type:'static', value: val };
            }
          });
          // Fallback: also include plain keys so ToolWindow UI shows defaults if needed
          Object.entries(formValues).forEach(([k,v])=>{ if(!mappings[k]) mappings[k]={type:'static', value:v}; });
          (await import('../state.js')).persistState();

          // --- Reuse central spell execution flow ---
          const { executeSpell } = await import('../logic/spellExecution.js');
          executeSpell(this.id);
        } else {
          // --- Tool path stays inline ---
          const { default: execClient } = await import('../executionClient.js');
          const resp = await execClient.execute({ toolId: this.collection.toolId, inputs: paramOverrides, metadata:{ platform:'cook-test', traitSel } });
          const outputs = resp.outputs?.[0]?.data || resp;
          outputDiv.innerHTML='';
          renderResultContent(outputDiv, outputs);
        }
      } catch(e){
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
