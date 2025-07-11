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
        this.fetchMySpells();
    }

    hide() {
        if (!this.modalElement) return;
        document.removeEventListener('keydown', this.handleKeyDown);
        document.body.removeChild(this.modalElement);
        this.modalElement = null;
    }

    async fetchMySpells() {
        this.setState({ loading: true, error: null });
        try {
            // Using the new external API endpoint
            const response = await fetch(`/api/v1/spells`);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || 'Failed to fetch your spells.');
            }
            const data = await response.json();
            this.setState({ loading: false, spells: data.spells || [] });
        } catch (error) {
            this.setState({ loading: false, error: error.message });
        }
    }

    render() {
        if (!this.modalElement) return;

        this.modalElement.innerHTML = `
            <div class="spells-modal-container">
                <button class="close-btn">&times;</button>
                <div class="spells-modal-content">
                    ${this.renderCurrentView()}
                </div>
            </div>
        `;
        this.attachEvents();
    }

    renderCurrentView() {
        const { view, loading, error } = this.state;

        if (loading) {
            return `<div class="loading-spinner"></div>`;
        }

        if (error) {
            return `<div class="error-message">Error: ${error}</div>`;
        }

        switch (view) {
            case 'main':
                return this.renderMainMenu();
            case 'marketplace':
                return this.renderMarketplace();
            default:
                return `<h2>Unknown view: ${view}</h2>`;
        }
    }

    renderMainMenu() {
        const { spells } = this.state;
        return `
            <div class="spells-header">
                <h2>Spells Menu</h2>
                <div class="spells-main-actions">
                    <button class="action-button" data-action="create-new">🪄 Create New Spell</button>
                    <button class="action-button" data-action="discover">🔍 Discover Spells</button>
                </div>
            </div>
            <div class="spells-list">
                <h3>My Spells</h3>
                ${spells && spells.length > 0 ? spells.map(spell => `
                    <div class="spell-item">
                        <span>📖 ${spell.name}</span>
                        <button class="action-button-secondary" data-action="edit-spell" data-slug="${spell.slug}">Edit</button>
                    </div>
                `).join('') : '<p class="empty-list-message">You have no spells yet. Create one or discover new spells!</p>'}
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
} 