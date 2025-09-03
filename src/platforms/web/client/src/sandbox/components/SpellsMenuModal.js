// src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js
import { getAvailableTools, getLastClickPosition } from '../state.js';
import { createSpellWindow } from '../window/SpellWindow.js';

export default class SpellsMenuModal {
    constructor(options = {}) {
        this.state = {
            view: 'main', // 'main', 'spellDetail', 'toolSelect', 'paramEdit', 'marketplace', 'marketDetail', 'create'
            loading: false,
            error: null,
            spells: [],
            marketplaceSpells: [],
            selectedSpell: null,
            // For create form
            newSpellName: '',
            newSpellDescription: '',
            newSpellIsPublic: false,
            subgraph: options.initialData?.subgraph || null,
            newSpellExposedInputs: {},
        };
        this.modalElement = null;
        this.handleKeyDown = this.handleKeyDown.bind(this);

        if (this.state.subgraph) {
            this.state.view = 'create';
        }
    }

    setState(newState) {
        Object.assign(this.state, newState);
        if (this.modalElement) {
            this.render();
        }
    }

    handleSpellClick(spell) {
        this.setState({
            selectedSpell: { ...spell },
            view: 'spellDetail',
            error: null
        });
    }

    async handleSaveSpell() {
        const { selectedSpell, spells } = this.state;
        if (!selectedSpell) return;
        // Uniqueness check (case-insensitive, exclude current spell)
        const newName = (selectedSpell.name || '').trim().toLowerCase();
        const isDuplicate = spells.some(s => s._id !== selectedSpell._id && (s.name || '').trim().toLowerCase() === newName);
        if (isDuplicate) {
            this.setState({ error: 'You already have a spell with this name. Please choose a different name.' });
            return;
        }
        this.setState({ loading: true, error: null });
        try {
            // Get CSRF token
            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();
            const res = await fetch(`/api/v1/spells/${selectedSpell._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrfToken
                },
                credentials: 'include',
                body: JSON.stringify({
                    name: selectedSpell.name,
                    description: selectedSpell.description,
                    isPublic: !!selectedSpell.isPublic,
                })
            });
            if (!res.ok) throw new Error('Failed to save spell');
            // After saving, return to main view and re-fetch spells
            this.setState({ loading: false, view: 'main', selectedSpell: null });
            this.fetchUserSpells();
        } catch (err) {
            this.setState({ error: 'Failed to save spell.', loading: false });
        }
    }

    async handleDeleteSpell() {
        const { selectedSpell } = this.state;
        if (!selectedSpell) return;
        if (!confirm('Are you sure you want to delete this spell? This cannot be undone.')) return;
        this.setState({ loading: true, error: null });
        try {
            // Get CSRF token
            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();
            // Get masterAccountId
            const masterAccountId = await this.getCurrentMasterAccountId();
            if (!masterAccountId) throw new Error('Could not determine your account ID. Please log in again.');
            const res = await fetch(`/api/v1/spells/${selectedSpell._id}`, {
                method: 'DELETE',
                headers: { 'x-csrf-token': csrfToken, 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ masterAccountId })
            });
            if (!res.ok) {
                let errMsg = 'Failed to delete spell';
                try { const errData = await res.json(); errMsg = errData.error || errMsg; } catch {}
                throw new Error(errMsg);
            }
            this.setState({ loading: false, view: 'main', selectedSpell: null });
            this.fetchUserSpells();
        } catch (err) {
            this.setState({ error: err.message || 'Failed to delete spell.', loading: false });
        }
    }

    // Utility to fetch and cache the current user's masterAccountId
    async getCurrentMasterAccountId() {
        if (this._cachedMasterAccountId) return this._cachedMasterAccountId;
        try {
            const res = await fetch('/api/v1/user/dashboard', { credentials: 'include' });
            if (!res.ok) return null;
            const data = await res.json();
            const masterAccountId = data.masterAccountId || null;
            if (masterAccountId) this._cachedMasterAccountId = masterAccountId;
            return masterAccountId;
        } catch {
            return null;
        }
    }

    show() {
        if (this.modalElement) return;

        this.modalElement = document.createElement('div');
        this.modalElement.className = 'spells-modal-overlay';
        document.body.appendChild(this.modalElement);
        
        this.render();
        this.attachCloseEvents();

        if (!this.state.subgraph) {
            this.fetchUserSpells();
        }
    }

    hide() {
        if (!this.modalElement) return;
        document.removeEventListener('keydown', this.handleKeyDown);
        document.body.removeChild(this.modalElement);
        this.modalElement = null;
    }

    async fetchUserSpells() {
        this.setState({ loading: true, error: null });
        try {
            // Get CSRF token
            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();
            const res = await fetch('/api/v1/spells', {
                method: 'GET',
                headers: { 'x-csrf-token': csrfToken },
                credentials: 'include',
            });
            if (res.status === 401 || res.status === 403) {
                this.setState({ error: 'You must be logged in to view your spells.', loading: false });
                return;
            }
            const data = await res.json();
            const list = Array.isArray(data.spells)?data.spells:data;
            this.setState({ spells: list || [], loading: false });
        } catch (err) {
            this.setState({ error: 'Failed to fetch your spells.', loading: false });
        }
    }

    async fetchMarketplaceSpells() {
        this.setState({ loading: true, error: null });
        try {
            const res = await fetch('/api/v1/spells/marketplace');
            if (!res.ok) throw new Error('Failed to fetch marketplace spells');
            const marketplaceSpells = await res.json();
            this.setState({ marketplaceSpells, loading: false });
        } catch (err) {
            this.setState({ error: 'Failed to fetch marketplace spells.', loading: false });
        }
    }

    render() {
        if (!this.modalElement) {
            this.modalElement = document.createElement('div');
            this.modalElement.className = 'spells-modal-overlay';
            document.body.appendChild(this.modalElement);
        }
        this.modalElement.innerHTML = `
            <div class="spells-modal-container">
                <button class="close-btn" aria-label="Close">×</button>
                <div class="spells-menu-tabs">
                    <button class="tab-btn${this.state.view === 'main' ? ' active' : ''}" data-tab="main">My Spells</button>
                    <button class="tab-btn${this.state.view === 'marketplace' ? ' active' : ''}" data-tab="marketplace">Discover Spells</button>
                </div>
                <div class="spells-modal-content">
                    ${this.renderCurrentView()}
                </div>
            </div>
        `;
        // Close button
        const closeBtn = this.modalElement.querySelector('.close-btn');
        if (closeBtn) closeBtn.onclick = () => this.hide();
        // Tab buttons
        const tabBtns = this.modalElement.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.onclick = () => {
                const tab = btn.getAttribute('data-tab');
                if (tab === 'main') {
                    this.setState({ view: 'main', selectedSpell: null });
                    this.fetchUserSpells();
                } else if (tab === 'marketplace') {
                    this.setState({ view: 'marketplace', selectedSpell: null });
                    this.fetchMarketplaceSpells();
                }
            };
        });
        // Spell click (main list)
        if (this.state.view === 'main') {
            const spellItems = this.modalElement.querySelectorAll('.spell-item');
            spellItems.forEach((item, idx) => {
                // The item itself is now a container for the name and the button
                const addToCanvasBtn = item.querySelector('.add-spell-to-canvas-btn');
                if (addToCanvasBtn) {
                    addToCanvasBtn.onclick = (e) => {
                        e.stopPropagation(); // Prevent detail view from opening
                        const spell = this.state.spells[idx];
                        this.handleAddSpellToCanvas(spell);
                    };
                }

                // Allow clicking the rest of the item to see details
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.add-spell-to-canvas-btn')) return;
                    const spell = this.state.spells[idx];
                    this.handleSpellClick(spell);
                });
            });
            // Create button
            const createBtn = this.modalElement.querySelector('.create-spell-btn');
            if (createBtn) createBtn.onclick = () => {
                this.setState({ view: 'create', newSpellName: '', newSpellDescription: '', error: null, newSpellExposedInputs: {} });
            };
        }
        // Spell create actions
        if (this.state.view === 'create') {
            const nameInput = this.modalElement.querySelector('.create-spell-name');
            const descInput = this.modalElement.querySelector('.create-spell-desc');
            const publicChk = this.modalElement.querySelector('.create-spell-public');
            if (nameInput) {
                nameInput.oninput = (e) => {
                    this.state.newSpellName = e.target.value;
                };
            }
            if (descInput) {
                descInput.oninput = (e) => {
                    this.state.newSpellDescription = e.target.value;
                };
            }
            if (publicChk) {
                publicChk.onchange = (e)=>{ this.state.newSpellIsPublic = e.target.checked; };
            }
            // Handle exposed inputs checkboxes
            const inputCheckboxes = this.modalElement.querySelectorAll('.spell-input-checkbox');
            inputCheckboxes.forEach(checkbox => {
                checkbox.onchange = (e) => {
                    const inputId = e.target.dataset.inputId;
                    this.state.newSpellExposedInputs[inputId] = e.target.checked;
                };
            });
            const submitBtn = this.modalElement.querySelector('.submit-create-spell-btn');
            const cancelBtn = this.modalElement.querySelector('.cancel-create-spell-btn');
            if (submitBtn) submitBtn.onclick = () => this.handleCreateSpell();
            if (cancelBtn) cancelBtn.onclick = () => {
                this.setState({ view: 'main', newSpellName: '', newSpellDescription: '', error: null, newSpellExposedInputs: {} });
                this.fetchUserSpells();
            };
        }
        // Spell detail actions
        if (this.state.view === 'spellDetail' && this.state.selectedSpell) {
            const nameInput = this.modalElement.querySelector('.spell-detail-name');
            const descInput = this.modalElement.querySelector('.spell-detail-desc');
            const publicChk = this.modalElement.querySelector('.spell-detail-public');
            if (nameInput) {
                nameInput.oninput = (e) => {
                    this.state.selectedSpell.name = e.target.value;
                };
            }
            if (descInput) {
                descInput.oninput = (e) => {
                    this.state.selectedSpell.description = e.target.value;
                };
            }
            if (publicChk) {
                publicChk.onchange = (e)=>{ this.state.selectedSpell.isPublic = e.target.checked; };
            }
            const saveBtn = this.modalElement.querySelector('.save-spell-btn');
            const deleteBtn = this.modalElement.querySelector('.delete-spell-btn');
            const backBtn = this.modalElement.querySelector('.back-spell-btn');
            const copyBtn = this.modalElement.querySelector('.copy-link-btn');
            if (saveBtn) saveBtn.onclick = () => this.handleSaveSpell();
            if (deleteBtn) deleteBtn.onclick = () => this.handleDeleteSpell();
            if (backBtn) backBtn.onclick = () => {
                this.setState({ view: 'main', selectedSpell: null });
                this.fetchUserSpells();
            };
            if(copyBtn){
                copyBtn.onclick = ()=>{
                    const urlInput = this.modalElement.querySelector('.public-link input');
                    urlInput.select();
                    document.execCommand('copy');
                    copyBtn.textContent='Copied!';
                    setTimeout(()=>copyBtn.textContent='Copy',1500);
                };
            }
        }
    }

    renderCurrentView() {
        const { view, loading, error, spells, marketplaceSpells, selectedSpell, newSpellName, newSpellDescription } = this.state;
        let html = '';
        if (loading) {
            html += '<div class="loading-spinner">Loading…</div>';
        } else if (error) {
            html += `<div class="error-message">${error}</div>`;
        } else if (view === 'main') {
            html += `<button class="create-spell-btn">+ Create New Spell</button>`;
            if (!spells || spells.length === 0) {
                html += '<div class="empty-message">You have no spells yet.</div>';
            } else {
                html += '<ul class="spells-list">';
                for (const spell of spells) {
                    html += `<li class="spell-item" data-spell-id="${spell._id}">
                        <div class="spell-info">
                            <span class="spell-name">🪄 ${spell.name}</span>
                            <span class="spell-desc">${spell.description || ''}</span>
                        </div>
                        <button class="add-spell-to-canvas-btn" title="Add to Canvas">+</button>
                    </li>`;
                }
                html += '</ul>';
            }
        } else if (view === 'create') {
            html += this.renderCreateView();
        } else if (view === 'spellDetail' && selectedSpell) {
            html += this.renderSpellDetailView();
        } else if (view === 'marketplace') {
            if (!marketplaceSpells || marketplaceSpells.length === 0) {
                html += '<div class="empty-message">No public spells found.</div>';
            } else {
                html += '<ul class="spells-list">';
                for (const spell of marketplaceSpells) {
                    html += `<li class="spell-item">${spell.name} <span class="spell-desc">${spell.description || ''}</span> <span class="spell-uses">${spell.uses} uses</span></li>`;
                }
                html += '</ul>';
            }
        }
        return html;
    }

    renderCreateView() {
        const { newSpellName, newSpellDescription, subgraph, error, newSpellExposedInputs, newSpellIsPublic } = this.state;
        
        if (!subgraph || !subgraph.nodes) {
            return `<div class="create-spell-view"><h2>Mint New Spell</h2><div class="empty-message">No nodes were selected to create a spell.</div></div>`;
        }

        const availableTools = getAvailableTools();
        const toolMap = new Map(availableTools.map(t => [t.toolId, t]));
        
        const nodesWithTools = subgraph.nodes.map(node => {
            const tool = toolMap.get(node.toolId);
            if (!tool) {
                console.warn(`Could not find tool definition for toolId '${node.toolId}'. This node will be omitted from the spell.`);
                return null;
            }
            return { ...node, tool };
        }).filter(Boolean);

        let stepsHtml = '';
        if (nodesWithTools.length > 0) {
            stepsHtml = `
                <div class="spell-steps-preview">
                    <h4>Steps in this Spell:</h4>
                    <ul>
                        ${nodesWithTools.map(node => `<li>${node.tool.displayName}</li>`).join('')}
                    </ul>
                </div>
            `;
        } else {
            return `<div class="create-spell-view"><h2>Mint New Spell</h2><div class="error-message">Could not find the definitions for any of the selected tools.</div></div>`;
        }

        let potentialInputsHtml = '';
        if (nodesWithTools.length > 0) {
            const connectedInputs = new Set();
            if (subgraph.connections) {
                subgraph.connections.forEach(conn => {
                    connectedInputs.add(`${conn.toWindowId}__${conn.toInput}`);
                });
            }

            const potentialInputs = [];
            for (const node of nodesWithTools) {
                if (node.tool.inputSchema) {
                    for (const paramKey in node.tool.inputSchema) {
                        if (!connectedInputs.has(`${node.id}__${paramKey}`)) {
                            const paramDef = node.tool.inputSchema[paramKey];
                            potentialInputs.push({
                                nodeId: node.id,
                                nodeDisplayName: node.tool.displayName,
                                paramKey: paramKey,
                                paramDisplayName: paramDef.displayName || paramKey,
                                uniqueId: `${node.id}__${paramKey}`
                            });
                        }
                    }
                }
            }

            if (potentialInputs.length > 0) {
                const inputsList = potentialInputs.map(input => `
                    <li class="spell-input-item">
                        <label>
                            <input type="checkbox" class="spell-input-checkbox" data-input-id="${input.uniqueId}" ${newSpellExposedInputs[input.uniqueId] ? 'checked' : ''}>
                            <span class="spell-input-nodename">${input.nodeDisplayName}:</span>
                            <span class="spell-input-paramname">${input.paramDisplayName}</span>
                        </label>
                    </li>
                `).join('');

                potentialInputsHtml = `
                    <div class="spell-inputs-selection">
                        <h4>Expose Spell Inputs</h4>
                        <p>Select which parameters will be available as inputs when using this spell.</p>
                        <ul>
                            ${inputsList}
                        </ul>
                    </div>
                `;
            }
        }

        return `
            <div class="create-spell-view">
                <h2>Mint New Spell</h2>
                ${error ? `<div class="error-message">${error}</div>` : ''}
                <div class="form-group">
                    <label for="spell-name">Spell Name</label>
                    <input type="text" id="spell-name" class="create-spell-name" placeholder="e.g., Psychedelic Portrait" value="${newSpellName}">
                </div>
                <div class="form-group">
                    <label for="spell-desc">Description</label>
                    <textarea id="spell-desc" class="create-spell-desc" placeholder="A short description of what this spell does.">${newSpellDescription}</textarea>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" class="create-spell-public" ${newSpellIsPublic ? 'checked' : ''}/> Make spell public / shareable</label>
                </div>
                ${stepsHtml}
                ${potentialInputsHtml}
                <div class="form-actions">
                    <button class="cancel-create-spell-btn">Cancel</button>
                    <button class="submit-create-spell-btn">Save Spell</button>
                </div>
            </div>
        `;
    }

    renderSpellDetailView() {
        const { selectedSpell } = this.state;
        let stepsHtml = '';
        if (selectedSpell && selectedSpell.steps) {
            stepsHtml = `
                <div class="spell-detail-steps">
                    <strong>Steps:</strong>
                    <ul>
                        ${selectedSpell.steps.map(step => `<li>${step.toolIdentifier}</li>`).join('')}
                    </ul>
                </div>
            `;
        }
        return `
            <div class="spell-detail-view">
                <label>Name:<br><input type="text" class="spell-detail-name" value="${selectedSpell.name || ''}" /></label><br>
                <label>Description:<br><textarea class="spell-detail-desc">${selectedSpell.description || ''}</textarea></label><br>
                <label><input type="checkbox" class="spell-detail-public" ${selectedSpell.isPublic ? 'checked' : ''}/> Public / shareable</label><br>
                ${selectedSpell.isPublic && (selectedSpell.publicSlug || selectedSpell.slug) ? `<div class="public-link"><input type="text" readonly value="${window.location.origin}/spells/${selectedSpell.publicSlug || selectedSpell.slug}" /> <button class="copy-link-btn">Copy</button></div>` : ''}
                ${stepsHtml}
                <div class="spell-detail-actions">
                    <button class="save-spell-btn">Save</button>
                    <button class="delete-spell-btn">Delete</button>
                    <button class="back-spell-btn">Back</button>
                </div>
            </div>
        `;
    }

    attachEvents() {
        // Main event delegation
        const content = this.modalElement.querySelector('.spells-modal-content');
        if (!content) return;

        content.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;

            const action = button.dataset.action;
            switch(action) {
                case 'create-new':
                    console.log('Create new spell clicked');
                    // this.setState({ view: 'create' });
                    break;
                case 'discover':
                    console.log('Discover spells clicked');
                    this.setState({ view: 'marketplace' });
                    // this.fetchMarketplaceSpells(); // We'll implement this next
                    break;
                case 'edit-spell':
                    const slug = button.dataset.slug;
                    console.log(`Edit spell: ${slug}`);
                    // this.setState({ view: 'spellDetail', selectedSpellSlug: slug });
                    break;
            }
        });
    }

    attachCloseEvents() {
        this.modalElement.querySelector('.close-btn').addEventListener('click', () => this.hide());
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) {
                this.hide();
            }
        });
        document.addEventListener('keydown', this.handleKeyDown);
    }
    
    handleKeyDown(e) {
        if (e.key === 'Escape') {
            this.hide();
        }
    }

    handleAddSpellToCanvas(spell) {
        if (!spell) return;
        
        console.log(`[SpellsMenuModal] Adding spell "${spell.name}" to canvas.`);
        
        // Use the last click position to place the node, or a default
        const position = getLastClickPosition() || { x: 200, y: 200 };
        
        // Call the new function to create a spell window
        createSpellWindow(spell, position);
        
        // Hide the modal after adding the spell
        this.hide();
    }

    async handleCreateSpell() {
        const { newSpellName, newSpellDescription, spells, subgraph, newSpellExposedInputs } = this.state;

        // Validation
        if (!newSpellName.trim()) {
            this.setState({ error: 'Spell name is required.' });
            return;
        }

        const isDuplicate = spells.some(s => (s.name || '').trim().toLowerCase() === newSpellName.trim().toLowerCase());
        if (isDuplicate) {
            this.setState({ error: 'You already have a spell with this name. Please choose a different name.' });
            return;
        }

        this.setState({ loading: true, error: null });

        const exposedInputs = Object.entries(newSpellExposedInputs)
            .filter(([, isExposed]) => isExposed)
            .map(([inputId]) => {
                const [nodeId, paramKey] = inputId.split('__');
                return { nodeId, paramKey };
            });

        try {
            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();

            const payload = {
                name: newSpellName,
                description: newSpellDescription,
                isPublic: !!this.state.newSpellIsPublic,
                steps: subgraph ? subgraph.nodes.map(n => ({ id: n.id, toolIdentifier: n.toolId, displayName: n.displayName, parameterMappings: n.parameterMappings })) : [],
                connections: subgraph ? subgraph.connections : [],
                exposedInputs: exposedInputs,
            };

            const res = await fetch('/api/v1/spells', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrfToken
                },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to create spell');
            }

            this.setState({ loading: false, view: 'main', newSpellName: '', newSpellDescription: '', newSpellExposedInputs: {} });
            this.fetchUserSpells();
        } catch (err) {
            this.setState({ error: err.message, loading: false });
        }
    }
} 