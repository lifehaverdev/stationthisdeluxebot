// src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js

export default class SpellsMenuModal {
    constructor() {
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
                    description: selectedSpell.description
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
            const res = await fetch(`/api/v1/spells/${selectedSpell._id}`, {
                method: 'DELETE',
                headers: { 'x-csrf-token': csrfToken },
                credentials: 'include'
            });
            if (!res.ok) throw new Error('Failed to delete spell');
            this.setState({ loading: false, view: 'main', selectedSpell: null });
            this.fetchUserSpells();
        } catch (err) {
            this.setState({ error: 'Failed to delete spell.', loading: false });
        }
    }

    show() {
        if (this.modalElement) return;

        this.modalElement = document.createElement('div');
        this.modalElement.className = 'spells-modal-overlay';
        document.body.appendChild(this.modalElement);
        
        this.render();
        this.attachCloseEvents();
        this.fetchUserSpells();
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
            this.setState({ spells: data.spells || [], loading: false });
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
                item.onclick = () => {
                    const spell = this.state.spells[idx];
                    this.handleSpellClick(spell);
                };
            });
            // Create button
            const createBtn = this.modalElement.querySelector('.create-spell-btn');
            if (createBtn) createBtn.onclick = () => {
                this.setState({ view: 'create', newSpellName: '', newSpellDescription: '', error: null });
            };
        }
        // Spell create actions
        if (this.state.view === 'create') {
            const nameInput = this.modalElement.querySelector('.create-spell-name');
            const descInput = this.modalElement.querySelector('.create-spell-desc');
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
            const submitBtn = this.modalElement.querySelector('.submit-create-spell-btn');
            const cancelBtn = this.modalElement.querySelector('.cancel-create-spell-btn');
            if (submitBtn) submitBtn.onclick = () => this.handleCreateSpell();
            if (cancelBtn) cancelBtn.onclick = () => {
                this.setState({ view: 'main', newSpellName: '', newSpellDescription: '', error: null });
                this.fetchUserSpells();
            };
        }
        // Spell detail actions
        if (this.state.view === 'spellDetail' && this.state.selectedSpell) {
            const nameInput = this.modalElement.querySelector('.spell-detail-name');
            const descInput = this.modalElement.querySelector('.spell-detail-desc');
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
            const saveBtn = this.modalElement.querySelector('.save-spell-btn');
            const deleteBtn = this.modalElement.querySelector('.delete-spell-btn');
            const backBtn = this.modalElement.querySelector('.back-spell-btn');
            if (saveBtn) saveBtn.onclick = () => this.handleSaveSpell();
            if (deleteBtn) deleteBtn.onclick = () => this.handleDeleteSpell();
            if (backBtn) backBtn.onclick = () => {
                this.setState({ view: 'main', selectedSpell: null });
                this.fetchUserSpells();
            };
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
                        <span class="spell-name">${spell.name}</span>
                        <span class="spell-desc">${spell.description || ''}</span>
                    </li>`;
                }
                html += '</ul>';
            }
        } else if (view === 'create') {
            html += `<div class="spell-create-view">
                <label>Name:<br><input type="text" class="create-spell-name" value="${newSpellName || ''}" maxlength="64" /></label><br>
                <label>Description:<br><textarea class="create-spell-desc" maxlength="256">${newSpellDescription || ''}</textarea></label><br>
                <div class="spell-create-actions">
                    <button class="submit-create-spell-btn">Create</button>
                    <button class="cancel-create-spell-btn">Cancel</button>
                </div>
            </div>`;
        } else if (view === 'spellDetail' && selectedSpell) {
            html += `<div class="spell-detail-view">
                <label>Name:<br><input type="text" class="spell-detail-name" value="${selectedSpell.name || ''}" /></label><br>
                <label>Description:<br><textarea class="spell-detail-desc">${selectedSpell.description || ''}</textarea></label><br>
                <div class="spell-detail-steps">
                    <strong>Steps:</strong>
                    <ul>
                        ${(selectedSpell.steps || []).map(step => `<li>${step.toolIdentifier}</li>`).join('') || '<li>No steps yet.</li>'}
                    </ul>
                </div>
                <div class="spell-detail-actions">
                    <button class="save-spell-btn">Save</button>
                    <button class="delete-spell-btn">Delete</button>
                    <button class="back-spell-btn">Back</button>
                </div>
            </div>`;
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

    async handleCreateSpell() {
        const { newSpellName, newSpellDescription, spells } = this.state;
        const name = (newSpellName || '').trim();
        if (!name) {
            this.setState({ error: 'Spell name is required.' });
            return;
        }
        // Uniqueness check (case-insensitive)
        const isDuplicate = spells.some(s => (s.name || '').trim().toLowerCase() === name.toLowerCase());
        if (isDuplicate) {
            this.setState({ error: 'You already have a spell with this name. Please choose a different name.' });
            return;
        }
        this.setState({ loading: true, error: null });
        try {
            // Get CSRF token
            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();
            const res = await fetch('/api/v1/spells', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrfToken
                },
                credentials: 'include',
                body: JSON.stringify({
                    name,
                    description: newSpellDescription
                })
            });
            if (!res.ok) throw new Error('Failed to create spell');
            // After creating, return to main view and re-fetch spells
            this.setState({ loading: false, view: 'main', newSpellName: '', newSpellDescription: '', error: null });
            this.fetchUserSpells();
        } catch (err) {
            this.setState({ error: 'Failed to create spell.', loading: false });
        }
    }
} 