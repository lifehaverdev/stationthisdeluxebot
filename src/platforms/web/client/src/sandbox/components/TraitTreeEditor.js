export default class TraitTreeEditor {
  constructor({ collection, onSave }) {
    this.collection = collection;
    this.onSave = onSave;
    this.state = {
      categories: (collection?.config?.traitTree) || [],
      editingCatIdx: null, // index currently expanded
    };
  }

  // ---------- Render helpers ----------
  render() {
    return `
      <div class="trait-tree-editor">
        <h3>Trait Categories</h3>
        <ul class="cat-list">
          ${this.state.categories.map((cat, idx) => this.renderCategoryRow(cat, idx)).join('')}
        </ul>
        <div class="add-cat-row"><input type="text" placeholder="New category" class="new-cat-input"/><button class="add-cat-btn">Add Category</button></div>
        <div style="margin-top:12px"><button class="save-traits-btn">Save Changes</button></div>
      </div>`;
  }

  renderCategoryRow(cat, idx) {
    const expanded = this.state.editingCatIdx === idx;
    const mode = cat.mode || 'manual';
    const generator = cat.generator || { type:'range', start:0, end:10, step:1, zeroPad:0, uniqueAcrossCook:false, shuffleSeed:null };

    let bodyHtml = '';
    if (expanded) {
      if (mode === 'generated') {
        const count = this.computeRangeCount(generator);
        const preview = this.computeRangePreview(generator, 5).join(', ');
        bodyHtml = `
          <div class="generated-config">
            <div style="margin:6px 0;">
              <label>Type</label>
              <select class="gen-type">
                <option value="range" ${generator.type==='range'?'selected':''}>Range</option>
              </select>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <label>Start<br><input type="number" class="gen-start" value="${Number.isFinite(generator.start)?generator.start:0}"></label>
              <label>End<br><input type="number" class="gen-end" value="${Number.isFinite(generator.end)?generator.end:10}"></label>
              <label>Step<br><input type="number" class="gen-step" value="${Number.isFinite(generator.step)?generator.step:1}"></label>
              <label>Zero Pad<br><input type="number" class="gen-zeropad" value="${Number.isFinite(generator.zeroPad)?generator.zeroPad:0}"></label>
              <label>Unique Across Cook<br><input type="checkbox" class="gen-unique" ${generator.uniqueAcrossCook?'checked':''}></label>
              <label>Shuffle Seed<br><input type="number" class="gen-shuffle" value="${Number.isFinite(generator.shuffleSeed)?generator.shuffleSeed:''}"></label>
            </div>
            <div style="margin-top:8px;color:#aaa;">Count: ${count} · Preview: ${preview}</div>
          </div>`;
      } else {
        bodyHtml = `
          <table class="trait-table">
            <thead><tr><th>Name</th><th>Value</th><th>Rarity %</th><th></th></tr></thead>
            <tbody>
            ${(cat.traits||[]).map((tr, tIdx)=>`<tr data-trait="${tIdx}"><td><input type="text" class="trait-name" value="${tr.name}"/></td><td><input type="text" class="trait-value" value="${tr.value!==undefined?tr.value:(tr.prompt||'')}"/></td><td><input type="number" class="trait-rarity" min="0" max="100" value="${tr.rarity??''}"/></td><td><button class="clone-trait-btn" data-trait="${tIdx}">⧉</button> <button class="del-trait-btn" data-trait="${tIdx}">✕</button></td></tr>`).join('')}
            <tr class="new-trait-row"><td><input type="text" class="new-trait-name" placeholder="Trait name"/></td><td><input type="text" class="new-trait-value" placeholder="Value (prompt, URL, etc.)"/></td><td><input type="number" class="new-trait-rarity" min="0" max="100" placeholder=""/></td><td><button class="add-trait-btn">＋</button></td></tr>
            </tbody></table>`;
      }
    }

    return `
      <li data-cat="${idx}">
        <div class="cat-header">
          <span class="cat-toggle" data-toggle="${idx}">${expanded?'▼':'▶'}</span>
          <input type="text" class="cat-name-input" value="${cat.name}"/>
          <select class="cat-mode" title="Category mode">
            <option value="manual" ${mode==='manual'?'selected':''}>Manual</option>
            <option value="generated" ${mode==='generated'?'selected':''}>Generated</option>
          </select>
          <button class="del-cat-btn" data-del="${idx}">✕</button>
        </div>
        ${bodyHtml}
      </li>`;
  }

  computeRangeCount(gen){
    const start = Number.isFinite(gen.start) ? gen.start : 0;
    const end = Number.isFinite(gen.end) ? gen.end : start;
    const step = Number.isFinite(gen.step) && gen.step>0 ? gen.step : 1;
    if (end < start) return 0;
    return Math.floor((end - start) / step) + 1;
  }

  computeRangePreview(gen, n=5){
    const start = Number.isFinite(gen.start) ? gen.start : 0;
    const end = Number.isFinite(gen.end) ? gen.end : start;
    const step = Number.isFinite(gen.step) && gen.step>0 ? gen.step : 1;
    const count = this.computeRangeCount(gen);
    const take = Math.min(n, count);
    const out = [];
    for (let i=0;i<take;i++) out.push(start + i*step);
    const zp = Number(gen.zeroPad)||0;
    return out.map(v => zp>0 ? String(v).padStart(zp,'0') : String(v));
  }

  // ---------- DOM attachment & events ----------
  attach(container) {
    container.innerHTML = this.render();
    // Add category
    container.querySelector('.add-cat-btn').onclick = () => {
      const input = container.querySelector('.new-cat-input');
      const name = input.value.trim(); if(!name) return;
      this.state.categories.push({ name, mode:'manual', traits: [] });
      input.value='';
      this.attach(container);
    };

    // Category name edits & expand/collapse
    container.querySelectorAll('.cat-name-input').forEach((inp, idx)=>{
      inp.oninput = ()=>{ this.state.categories[idx].name = inp.value; };
    });
    container.querySelectorAll('.cat-toggle').forEach(toggle=>{
      toggle.onclick=()=>{
        const idx = Number(toggle.getAttribute('data-toggle'));
        this.state.editingCatIdx = this.state.editingCatIdx===idx ? null : idx;
        this.attach(container);
      };
    });

    // Mode change
    container.querySelectorAll('.cat-mode').forEach((sel, idx)=>{
      sel.onchange = ()=>{
        const cat = this.state.categories[idx];
        const newMode = sel.value;
        cat.mode = newMode;
        if (newMode === 'generated') {
          cat.generator = cat.generator || { type:'range', start:0, end:10, step:1, zeroPad:0, uniqueAcrossCook:false, shuffleSeed:null };
        }
        this.attach(container);
      };
    });

    // Delete category
    container.querySelectorAll('.del-cat-btn').forEach(btn=>{
      btn.onclick=()=>{
        const idx=Number(btn.getAttribute('data-del'));
        if(confirm('Delete category and all its traits?')){
          this.state.categories.splice(idx,1);
          this.attach(container);
        }
      };
    });

    // Generator inputs
    container.querySelectorAll('li').forEach((li)=>{
      const idx = Number(li.getAttribute('data-cat'));
      const cat = this.state.categories[idx];
      if (!cat || cat.mode!=='generated') return;
      const gen = cat.generator = cat.generator || {};
      const getNum = (el)=>{ const v = el.value; return v===''?undefined:Number(v); };
      const startEl = li.querySelector('.gen-start');
      const endEl = li.querySelector('.gen-end');
      const stepEl = li.querySelector('.gen-step');
      const zpEl = li.querySelector('.gen-zeropad');
      const uniqEl = li.querySelector('.gen-unique');
      const shuffleEl = li.querySelector('.gen-shuffle');
      const reattach = ()=>this.attach(container);
      if (startEl) startEl.oninput = ()=>{ gen.start = getNum(startEl); };
      if (endEl) endEl.oninput = ()=>{ gen.end = getNum(endEl); };
      if (stepEl) stepEl.oninput = ()=>{ gen.step = getNum(stepEl); };
      if (zpEl) zpEl.oninput = ()=>{ gen.zeroPad = getNum(zpEl)||0; };
      if (uniqEl) uniqEl.onchange = ()=>{ gen.uniqueAcrossCook = !!uniqEl.checked; };
      if (shuffleEl) shuffleEl.oninput = ()=>{ const n=getNum(shuffleEl); gen.shuffleSeed = Number.isFinite(n)?n:null; };
    });

    // Add trait
    container.querySelectorAll('.add-trait-btn').forEach((btn)=>{
      btn.onclick=()=>{
        const catEl=btn.closest('li');
        const catIdx=Number(catEl.getAttribute('data-cat'));
        const nameEl=catEl.querySelector('.new-trait-name');
        const valueEl=catEl.querySelector('.new-trait-value');
        const rarityEl=catEl.querySelector('.new-trait-rarity');
        const name=nameEl.value.trim(); if(!name) return;
        const value=valueEl.value.trim();
        const rarityRaw=rarityEl.value.trim();
        const rarity=rarityRaw?Number(rarityRaw):undefined;
        const cat=this.state.categories[catIdx];
        cat.traits = cat.traits || [];
        cat.traits.push({ name, value, rarity });
        nameEl.value=''; valueEl.value=''; rarityEl.value='';
        this.attach(container);
      };
    });

    // Delete trait
    container.querySelectorAll('.del-trait-btn').forEach(btn=>{
      btn.onclick=()=>{
        const catIdx=Number(btn.closest('li').getAttribute('data-cat'));
        const tIdx=Number(btn.getAttribute('data-trait'));
        const cat=this.state.categories[catIdx];
        if (!cat.traits) cat.traits = [];
        cat.traits.splice(tIdx,1);
        this.attach(container);
      };
    });

    // Clone trait
    container.querySelectorAll('.clone-trait-btn').forEach(btn=>{
      btn.onclick=()=>{
        const catIdx=Number(btn.closest('li').getAttribute('data-cat'));
        const tIdx=Number(btn.getAttribute('data-trait'));
        const cat=this.state.categories[catIdx];
        const orig={...(cat.traits?.[tIdx]||{})};
        cat.traits = cat.traits || [];
        cat.traits.splice(tIdx+1,0,orig);
        this.attach(container);
      };
    });

    // Save
    container.querySelector('.save-traits-btn').onclick = () => {
      if(this.onSave) this.onSave(this.state.categories);
    };
  }
} 