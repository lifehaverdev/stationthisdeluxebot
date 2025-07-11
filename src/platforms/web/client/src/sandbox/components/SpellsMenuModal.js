// src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js

export default class SpellsMenuModal {
    constructor() {
        this.state = {
            view: 'main', // 'main', 'spellDetail', 'toolSelect', 'paramEdit', 'marketplace', 'marketDetail'
            loading: false,
            error: null,
            spells: [],
            marketplaceSpells: [],
            selectedSpell: null,
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
            const spells = await res.json();
            this.setState({ spells, loading: false });
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
        if (!this.modalElement) return;

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
        this.attachEvents();
    }

    renderCurrentView() {
        const { view, loading, error, spells, marketplaceSpells } = this.state;
        let html = '';
        html += `<div class="spells-modal-container">
            <button class="close-btn" aria-label="Close">×</button>
            <div class="spells-menu-tabs">
                <button class="tab-btn${view === 'main' ? ' active' : ''}" data-tab="main">My Spells</button>
                <button class="tab-btn${view === 'marketplace' ? ' active' : ''}" data-tab="marketplace">Discover Spells</button>
            </div>
            <div class="spells-modal-content">`;
        if (loading) {
            html += '<div class="loading-spinner">Loading…</div>';
        } else if (error) {
            html += `<div class="error-message">${error}</div>`;
        } else if (view === 'main') {
            if (!spells || spells.length === 0) {
                html += '<div class="empty-message">You have no spells yet.</div>';
            } else {
                html += '<ul class="spells-list">';
                for (const spell of spells) {
                    html += `<li class="spell-item">${spell.name} <span class="spell-desc">${spell.description || ''}</span></li>`;
                }
                html += '</ul>';
            }
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
        html += '</div></div>';
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
} 