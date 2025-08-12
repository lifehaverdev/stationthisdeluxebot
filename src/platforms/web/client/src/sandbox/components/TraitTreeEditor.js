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
    const traitsHtml = expanded ? `
      <table class="trait-table">
        <thead><tr><th>Name</th><th>Value</th><th>Rarity %</th><th></th></tr></thead>
        <tbody>
        ${cat.traits.map((tr, tIdx)=>`<tr data-trait="${tIdx}"><td><input type="text" class="trait-name" value="${tr.name}"/></td><td><input type="text" class="trait-value" value="${tr.value!==undefined?tr.value:(tr.prompt||'')}"/></td><td><input type="number" class="trait-rarity" min="0" max="100" value="${tr.rarity??''}"/></td><td><button class="clone-trait-btn" data-trait="${tIdx}">⧉</button> <button class="del-trait-btn" data-trait="${tIdx}">✕</button></td></tr>`).join('')}
        <tr class="new-trait-row"><td><input type="text" class="new-trait-name" placeholder="Trait name"/></td><td><input type="text" class="new-trait-value" placeholder="Value (prompt, URL, etc.)"/></td><td><input type="number" class="new-trait-rarity" min="0" max="100" placeholder=""/></td><td><button class="add-trait-btn">＋</button></td></tr>
        </tbody></table>` : '';
    return `
      <li data-cat="${idx}">
        <div class="cat-header">
          <span class="cat-toggle" data-toggle="${idx}">${expanded?'▼':'▶'}</span>
          <input type="text" class="cat-name-input" value="${cat.name}"/>
          <button class="del-cat-btn" data-del="${idx}">✕</button>
        </div>
        ${traitsHtml}
      </li>`;
  }

  // ---------- DOM attachment & events ----------
  attach(container) {
    container.innerHTML = this.render();
    // Add category
    container.querySelector('.add-cat-btn').onclick = () => {
      const input = container.querySelector('.new-cat-input');
      const name = input.value.trim(); if(!name) return;
      this.state.categories.push({ name, traits: [] });
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
        this.state.categories[catIdx].traits.push({ name, value, rarity });
        nameEl.value=''; valueEl.value=''; rarityEl.value='';
        this.attach(container);
      };
    });

    // Delete trait
    container.querySelectorAll('.del-trait-btn').forEach(btn=>{
      btn.onclick=()=>{
        const catIdx=Number(btn.closest('li').getAttribute('data-cat'));
        const tIdx=Number(btn.getAttribute('data-trait'));
        this.state.categories[catIdx].traits.splice(tIdx,1);
        this.attach(container);
      };
    });

    // Clone trait
    container.querySelectorAll('.clone-trait-btn').forEach(btn=>{
      btn.onclick=()=>{
        const catIdx=Number(btn.closest('li').getAttribute('data-cat'));
        const tIdx=Number(btn.getAttribute('data-trait'));
        const orig={...this.state.categories[catIdx].traits[tIdx]};
        this.state.categories[catIdx].traits.splice(tIdx+1,0,orig);
        this.attach(container);
      };
    });

    // Save
    container.querySelector('.save-traits-btn').onclick = () => {
      if(this.onSave) this.onSave(this.state.categories);
    };
  }
} 