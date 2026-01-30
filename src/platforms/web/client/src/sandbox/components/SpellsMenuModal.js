// src/platforms/web/client/src/sandbox/components/SpellsMenuModal.js
import { getAvailableTools, getLastClickPosition } from '../state.js';
import { createSpellWindow } from '../window/SpellWindow.js';
import { openSpellEditorOverlay } from '../node/overlays/spellEditorOverlay.js';

export default class SpellsMenuModal {
    constructor(options = {}) {
        this.state = {
            view: 'main', // 'main', 'spellDetail', 'toolSelect', 'paramEdit', 'marketplace', 'marketDetail', 'create'
            loading: false,
            error: null,
            spells: [],
            marketplaceSpells: [],
            marketplaceSearchQuery: '',
            marketplaceSelectedTag: null,
            marketplaceTags: [],
            selectedSpell: null,
            isEditingSpell: false, // Track if spell is in edit mode
            currentUserId: null, // Cache current user ID for ownership checks
            // For create form
            newSpellName: '',
            newSpellDescription: '',
            newSpellVisibility: 'private', // 'private', 'listed', 'public'
            newSpellPricePoints: 100, // Default price for listed spells
            subgraph: options.initialData?.subgraph || null,
            newSpellExposedInputs: {},
            editExposedInputMap: {},
            pendingSpellStructure: null,
        };
        this.modalElement = null;
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this._modalFlowHidden = false;
        this._modalPrevDisplay = '';

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
        const { sanitizedSpell, exposureMap } = this.prepareSpellForEdit(spell);
        this.setState({
            selectedSpell: sanitizedSpell,
            view: 'spellDetail',
            error: null,
            pendingSpellStructure: null,
            isEditingSpell: false,
            editExposedInputMap: exposureMap
        });
    }

    async handleSaveSpell() {
        const { selectedSpell, spells, pendingSpellStructure } = this.state;
        if (!selectedSpell) return;

        const spellId = selectedSpell._id;
        if (!spellId) {
            this.setState({ error: 'Unable to determine spell identifier.' });
            return;
        }

        const currentExposedInputs = this.getCurrentExposedInputs();
        
        const masterAccountId = await this.getCurrentMasterAccountId();
        if (!masterAccountId) {
            this.setState({ error: 'Could not verify your account. Please log in again.' });
            return;
        }
        
        // Validate spell name
        const newName = (selectedSpell.name || '').trim();
        if (!newName) {
            this.setState({ error: 'Spell name is required.' });
            return;
        }
        
        // Uniqueness check (case-insensitive, exclude current spell)
        const newNameLower = newName.toLowerCase();
        const isDuplicate = spells.some(s => s._id !== spellId && (s.name || '').trim().toLowerCase() === newNameLower);
        if (isDuplicate) {
            this.setState({ error: 'You already have a spell with this name. Please choose a different name.' });
            return;
        }
        
        // Check ownership before saving
        const canEdit = await this.isSpellOwner(selectedSpell);
        if (!canEdit) {
            this.setState({ error: 'You do not have permission to edit this spell.' });
            return;
        }

        const structure = pendingSpellStructure || {
            steps: selectedSpell.steps || [],
            connections: selectedSpell.connections || []
        };

        this.setState({ loading: true, error: null });
        try {
            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();
            const payload = {
                masterAccountId,
                name: selectedSpell.name,
                description: selectedSpell.description,
                visibility: selectedSpell.visibility || 'private',
                pricePoints: selectedSpell.visibility === 'listed' ? (selectedSpell.pricePoints || 0) : undefined,
                steps: structure.steps,
                connections: structure.connections,
                exposedInputs: currentExposedInputs,
            };
            const res = await fetch(`/api/v1/spells/${spellId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrfToken
                },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || errData.message || 'Failed to save spell');
            }

            const refreshedSpell = await this.fetchSpellById(spellId) || selectedSpell;
            const { sanitizedSpell, exposureMap } = this.prepareSpellForEdit(refreshedSpell);

            this.setState({ 
                loading: false, 
                isEditingSpell: false,
                selectedSpell: sanitizedSpell,
                pendingSpellStructure: null,
                editExposedInputMap: exposureMap,
                error: null
            });
            
            await this.fetchUserSpells();
            
            setTimeout(() => {
                const content = this.modalElement?.querySelector('.spells-modal-content');
                if (!content) return;
                const successMsg = document.createElement('div');
                successMsg.className = 'success-message';
                successMsg.textContent = 'Spell saved successfully!';
                const detailView = content.querySelector('.spell-detail-view');
                if (detailView) {
                    detailView.insertBefore(successMsg, detailView.firstChild);
                    setTimeout(() => successMsg.remove(), 3000);
                }
            }, 100);
        } catch (err) {
            console.error('[SpellsMenuModal] Save spell failed:', err);
            this.setState({ error: err.message || 'Failed to save spell.', loading: false });
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
            this.setState({ loading: false, view: 'main', selectedSpell: null, pendingSpellStructure: null, isEditingSpell: false, editExposedInputMap: {} });
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
            if (masterAccountId) {
                this._cachedMasterAccountId = masterAccountId;
                this.state.currentUserId = masterAccountId;
            }
            return masterAccountId;
        } catch {
            return null;
        }
    }

    /**
     * Check if the current user owns the spell (is creator or owner)
     * @param {Object} spell - The spell object
     * @returns {Promise<boolean>} - True if user owns the spell
     */
    async isSpellOwner(spell) {
        if (!spell) return false;
        const currentUserId = await this.getCurrentMasterAccountId();
        if (!currentUserId) return false;
        
        // Check if user is creator or owner
        const creatorId = spell.creatorId?.toString() || spell.creatorId;
        const ownedBy = spell.ownedBy?.toString() || spell.ownedBy;
        const userIdStr = currentUserId.toString();
        
        return creatorId === userIdStr || ownedBy === userIdStr;
    }

    prepareSpellForEdit(spell) {
        if (!spell) {
            return { sanitizedSpell: null, exposureMap: {} };
        }
        const sanitizedExposedInputs = this.sanitizeExposedInputs(spell);
        const exposureMap = {};
        sanitizedExposedInputs.forEach(input => {
            exposureMap[`${input.nodeId}__${input.paramKey}`] = true;
        });
        return {
            sanitizedSpell: { ...spell, exposedInputs: sanitizedExposedInputs },
            exposureMap
        };
    }

    sanitizeExposedInputs(spell) {
        if (!spell) return [];
        const currentExposures = Array.isArray(spell.exposedInputs) ? spell.exposedInputs : [];
        const potentialInputs = this.getPotentialExposedInputs(spell);
        if (!potentialInputs.length) return currentExposures;
        const allowed = new Set(potentialInputs.map(input => input.uniqueId));
        return currentExposures.filter(input => allowed.has(`${input.nodeId}__${input.paramKey}`));
    }

    getPotentialExposedInputs(spell) {
        if (!spell || !Array.isArray(spell.steps) || spell.steps.length === 0) return [];
        const availableTools = getAvailableTools?.() || [];
        if (!availableTools.length) return [];
        const toolMap = new Map(availableTools.map(tool => [tool.toolId, tool]));
        const connectedInputs = new Set();
        if (Array.isArray(spell.connections)) {
            spell.connections.forEach(conn => {
                if (conn.toWindowId && conn.toInput) {
                    connectedInputs.add(`${conn.toWindowId}__${conn.toInput}`);
                }
            });
        }
        const potential = [];
        spell.steps.forEach(step => {
            const nodeId = step.id || step.stepId;
            if (!nodeId) return;
            const toolIdentifier = step.toolIdentifier || step.toolId;
            const tool = toolIdentifier ? (toolMap.get(toolIdentifier) || availableTools.find(t => t.toolId === toolIdentifier)) : null;
            if (!tool || !tool.inputSchema) return;
            Object.entries(tool.inputSchema).forEach(([paramKey, paramDef]) => {
                const uniqueId = `${nodeId}__${paramKey}`;
                if (connectedInputs.has(uniqueId)) return;
                potential.push({
                    nodeId,
                    paramKey,
                    nodeDisplayName: step.displayName || tool.displayName || toolIdentifier || nodeId,
                    paramDisplayName: paramDef.displayName || paramKey,
                    uniqueId
                });
            });
        });
        return potential;
    }

    getCurrentExposedInputs() {
        const map = this.state.editExposedInputMap || {};
        const keys = Object.keys(map);
        if (keys.length === 0) {
            return Array.isArray(this.state.selectedSpell?.exposedInputs) ? this.state.selectedSpell.exposedInputs : [];
        }
        return keys.filter(key => map[key]).map(key => {
            const [nodeId, paramKey] = key.split('__');
            return { nodeId, paramKey };
        });
    }

    updateExposedInputSelection(uniqueId, checked) {
        if (!uniqueId) return;
        const newMap = { ...this.state.editExposedInputMap };
        if (checked) {
            newMap[uniqueId] = true;
        } else {
            delete newMap[uniqueId];
        }
        const updatedExposures = Object.keys(newMap).map(key => {
            const [nodeId, paramKey] = key.split('__');
            return { nodeId, paramKey };
        });
        const updatedSpell = this.state.selectedSpell ? { ...this.state.selectedSpell, exposedInputs: updatedExposures } : this.state.selectedSpell;
        this.setState({ editExposedInputMap: newMap, selectedSpell: updatedSpell });
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

    async fetchMarketplaceSpells(tag = null, searchQuery = null) {
        this.setState({ loading: true, error: null });
        try {
            const params = new URLSearchParams();
            if (tag) params.append('tag', tag);
            if (searchQuery) params.append('search', searchQuery);
            
            const url = `/api/v1/spells/marketplace${params.toString() ? '?' + params.toString() : ''}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch marketplace spells');
            const marketplaceSpells = await res.json();
            
            // Extract unique tags from spells for filter UI
            const allTags = new Set();
            marketplaceSpells.forEach(spell => {
                if (spell.tags && Array.isArray(spell.tags)) {
                    spell.tags.forEach(t => allTags.add(t));
                }
            });
            
            this.setState({ 
                marketplaceSpells, 
                marketplaceTags: Array.from(allTags).sort(),
                loading: false 
            });
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
                    this.setState({ view: 'main', selectedSpell: null, pendingSpellStructure: null, isEditingSpell: false, editExposedInputMap: {} });
                    this.fetchUserSpells();
                } else if (tab === 'marketplace') {
                    this.setState({ view: 'marketplace', selectedSpell: null, pendingSpellStructure: null, isEditingSpell: false, editExposedInputMap: {} });
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
            if (nameInput) {
                nameInput.oninput = (e) => {
                    this.state.newSpellName = e.target.value;
                    // Real-time validation: enable/disable submit button
                    const submitBtn = this.modalElement.querySelector('.submit-create-spell-btn');
                    if (submitBtn) {
                        submitBtn.disabled = !e.target.value.trim();
                    }
                };
            }
            if (descInput) {
                descInput.oninput = (e) => {
                    this.state.newSpellDescription = e.target.value;
                };
            }
            // Handle visibility radio buttons
            const visibilityRadios = this.modalElement.querySelectorAll('.create-spell-visibility');
            visibilityRadios.forEach(radio => {
                radio.onchange = (e) => {
                    this.state.newSpellVisibility = e.target.value;
                    // Re-render to show/hide price input
                    this.render();
                };
            });
            // Handle price input
            const priceInput = this.modalElement.querySelector('.create-spell-price');
            if (priceInput) {
                priceInput.oninput = (e) => {
                    const points = parseInt(e.target.value, 10) || 0;
                    this.state.newSpellPricePoints = points;
                    // Update the conversion display
                    const conversionSpan = this.modalElement.querySelector('.price-conversion');
                    if (conversionSpan) {
                        conversionSpan.textContent = `≈ $${(points * SpellsMenuModal.POINTS_TO_USD_RATE).toFixed(2)} USD`;
                    }
                };
            }
            // Handle exposed inputs checkboxes
            const inputCheckboxes = this.modalElement.querySelectorAll('.spell-input-checkbox');
            inputCheckboxes.forEach(checkbox => {
                checkbox.onchange = (e) => {
                    const inputId = e.target.dataset.inputId;
                    this.state.newSpellExposedInputs[inputId] = e.target.checked;
                    // Re-render to update visual feedback (exposed count, highlighted items)
                    this.render();
                };
            });
            const submitBtn = this.modalElement.querySelector('.submit-create-spell-btn');
            const cancelBtn = this.modalElement.querySelector('.cancel-create-spell-btn');
            if (submitBtn) submitBtn.onclick = () => this.handleCreateSpell();
            if (cancelBtn) cancelBtn.onclick = () => {
                this.setState({ view: 'main', newSpellName: '', newSpellDescription: '', newSpellVisibility: 'private', newSpellPricePoints: 100, error: null, newSpellExposedInputs: {} });
                this.fetchUserSpells();
            };
            // --- step reordering events ---
            const items = this.modalElement.querySelectorAll('.spell-step-item');
            const stepsList = this.modalElement.querySelector('#spell-steps-list');
            let draggedElement = null;
            let draggedIndex = null;
            
            items.forEach((item, idx) => {
                // Drag start
                item.ondragstart = e => {
                    draggedElement = item;
                    draggedIndex = parseInt(item.dataset.index, 10);
                    item.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', draggedIndex.toString());
                    // Set drag image
                    e.dataTransfer.setDragImage(item, 0, 0);
                };
                
                // Drag end
                item.ondragend = e => {
                    item.classList.remove('dragging');
                    // Remove all drop indicators
                    items.forEach(i => i.classList.remove('drag-over', 'drag-over-above', 'drag-over-below'));
                    draggedElement = null;
                    draggedIndex = null;
                };
                
                // Drag over - show drop indicator
                item.ondragover = e => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    
                    if (!draggedElement || draggedElement === item) return;
                    
                    // Remove indicators from all items
                    items.forEach(i => i.classList.remove('drag-over', 'drag-over-above', 'drag-over-below'));
                    
                    const rect = item.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    const mouseY = e.clientY;
                    
                    if (mouseY < midpoint) {
                        item.classList.add('drag-over-above');
                    } else {
                        item.classList.add('drag-over-below');
                    }
                };
                
                // Drag leave - remove indicator
                item.ondragleave = e => {
                    // Only remove if we're actually leaving the item (not just moving to a child)
                    if (!item.contains(e.relatedTarget)) {
                        item.classList.remove('drag-over', 'drag-over-above', 'drag-over-below');
                    }
                };
                
                // Drop
                item.ondrop = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    if (!draggedElement || draggedElement === item) return;
                    
                    const fromIdx = draggedIndex;
                    const toIdx = parseInt(item.dataset.index, 10);
                    
                    // Determine final position based on drop position
                    const rect = item.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    const mouseY = e.clientY;
                    const finalToIdx = mouseY < midpoint ? toIdx : toIdx + 1;
                    
                    this.reorderSpellSteps(fromIdx, finalToIdx);
                    
                    // Clean up
                    items.forEach(i => i.classList.remove('drag-over', 'drag-over-above', 'drag-over-below'));
                };
                
                // Arrow buttons
                const upBtn = item.querySelector('.move-up');
                const downBtn = item.querySelector('.move-down');
                if (upBtn) {
                    upBtn.onclick = (e) => { 
                        e.stopPropagation(); 
                        const currentIdx = parseInt(item.dataset.index, 10);
                        if (currentIdx > 0) {
                            this.reorderSpellSteps(currentIdx, currentIdx - 1);
                        }
                    };
                }
                if (downBtn) {
                    downBtn.onclick = (e) => { 
                        e.stopPropagation(); 
                        const currentIdx = parseInt(item.dataset.index, 10);
                        if (currentIdx < items.length - 1) {
                            this.reorderSpellSteps(currentIdx, currentIdx + 1);
                        }
                    };
                }
            });
        }
        // Spell detail actions - handle async rendering
        if (this.state.view === 'spellDetail' && this.state.selectedSpell) {
            // Render spell detail view asynchronously (needs ownership check)
            this.renderSpellDetailView().then(html => {
                const content = this.modalElement.querySelector('.spells-modal-content');
                if (content) {
                    const loadingEl = content.querySelector('.spell-detail-view-loading');
                    if (loadingEl) {
                        loadingEl.outerHTML = html;
                    } else {
                        // If already rendered, update it
                        const detailView = content.querySelector('.spell-detail-view');
                        if (detailView) {
                            detailView.outerHTML = html;
                        }
                    }
                    // Re-attach event handlers after rendering
                    this.attachSpellDetailHandlers();
                }
            }).catch(err => {
                console.error('[SpellsMenuModal] Error rendering spell detail:', err);
                const content = this.modalElement.querySelector('.spells-modal-content');
                if (content) {
                    const loadingEl = content.querySelector('.spell-detail-view-loading');
                    if (loadingEl) {
                        loadingEl.outerHTML = '<div class="error-message">Failed to load spell details.</div>';
                    }
                }
            });
        }
        // Marketplace spell click handlers
        if (this.state.view === 'marketplace') {
            // Search and filter handlers
            const searchInput = this.modalElement.querySelector('.marketplace-search-input');
            const searchBtn = this.modalElement.querySelector('.marketplace-search-btn');
            const tagBtns = this.modalElement.querySelectorAll('.tag-filter-btn');
            
            if (searchInput) {
                searchInput.onkeypress = (e) => {
                    if (e.key === 'Enter') {
                        const query = searchInput.value.trim();
                        this.setState({ marketplaceSearchQuery: query });
                        this.fetchMarketplaceSpells(this.state.marketplaceSelectedTag, query);
                    }
                };
            }
            
            if (searchBtn) {
                searchBtn.onclick = () => {
                    const query = searchInput ? searchInput.value.trim() : '';
                    this.setState({ marketplaceSearchQuery: query });
                    this.fetchMarketplaceSpells(this.state.marketplaceSelectedTag, query);
                };
            }
            
            tagBtns.forEach(btn => {
                btn.onclick = () => {
                    const tag = btn.dataset.tag || null;
                    this.setState({ marketplaceSelectedTag: tag });
                    this.fetchMarketplaceSpells(tag, this.state.marketplaceSearchQuery);
                };
            });
            
            // Spell item click handlers
            const spellItems = this.modalElement.querySelectorAll('.marketplace-spell-item');
            spellItems.forEach((item, idx) => {
                const viewBtn = item.querySelector('.view-spell-btn');
                if (viewBtn) {
                    viewBtn.onclick = (e) => {
                        e.stopPropagation();
                        const spell = this.state.marketplaceSpells[idx];
                        this.setState({ view: 'marketDetail', selectedSpell: spell, editExposedInputMap: {} });
                    };
                }
                // Also allow clicking the item itself
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.view-spell-btn')) return;
                    const spell = this.state.marketplaceSpells[idx];
                    this.setState({ view: 'marketDetail', selectedSpell: spell, editExposedInputMap: {} });
                });
            });
        }
        // Marketplace detail view actions
        if (this.state.view === 'marketDetail' && this.state.selectedSpell) {
            const castBtn = this.modalElement.querySelector('.cast-spell-btn');
            const addToCanvasBtn = this.modalElement.querySelector('.add-to-canvas-btn');
            const backBtn = this.modalElement.querySelector('.back-to-marketplace-btn');
            
            if (castBtn) {
                castBtn.onclick = () => {
                    const spell = this.state.selectedSpell;
                    const slug = spell.slug || spell.spellId || spell._id;
                    this.handleCastMarketplaceSpell(slug);
                };
            }
            
            if (addToCanvasBtn) {
                addToCanvasBtn.onclick = () => {
                    const spell = this.state.selectedSpell;
                    this.handleAddSpellToCanvas(spell);
                };
            }
            
            if (backBtn) {
                backBtn.onclick = () => {
                    this.setState({ view: 'marketplace', selectedSpell: null, editExposedInputMap: {} });
                    this.fetchMarketplaceSpells();
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
            // renderSpellDetailView is async, so we need to handle it differently
            // For now, render a placeholder and update it after async check
            html += '<div class="spell-detail-view-loading">Loading spell details...</div>';
        } else if (view === 'marketDetail' && selectedSpell) {
            html += this.renderMarketplaceSpellDetailView();
        } else if (view === 'marketplace') {
            // Search and filter UI
            html += `
                <div class="marketplace-controls">
                    <div class="search-box">
                        <input type="text" 
                               class="marketplace-search-input" 
                               placeholder="Search spells..." 
                               value="${this.state.marketplaceSearchQuery || ''}" />
                        <button class="marketplace-search-btn">Search</button>
                    </div>
                    ${this.state.marketplaceTags.length > 0 ? `
                        <div class="tag-filters">
                            <button class="tag-filter-btn ${!this.state.marketplaceSelectedTag ? 'active' : ''}" 
                                    data-tag="">All</button>
                            ${this.state.marketplaceTags.map(tag => `
                                <button class="tag-filter-btn ${this.state.marketplaceSelectedTag === tag ? 'active' : ''}" 
                                        data-tag="${tag}">${tag}</button>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
            
            if (!marketplaceSpells || marketplaceSpells.length === 0) {
                html += '<div class="empty-message">No public spells found.</div>';
            } else {
                html += '<ul class="spells-list">';
                for (const spell of marketplaceSpells) {
                    const slug = spell.slug || spell.spellId || spell._id;
                    html += `<li class="spell-item marketplace-spell-item" data-spell-slug="${slug}">
                        <div class="spell-info">
                            <span class="spell-name">🪄 ${spell.name}</span>
                            <span class="spell-desc">${spell.description || ''}</span>
                            <span class="spell-uses">${spell.uses || 0} uses</span>
                        </div>
                        <button class="view-spell-btn" data-spell-slug="${slug}">View</button>
                    </li>`;
                }
                html += '</ul>';
            }
        }
        return html;
    }

    // Points to USD conversion (keep in sync with CreditService)
    static POINTS_TO_USD_RATE = 0.000337;

    getVisibilityDisplayName(visibility) {
        switch (visibility) {
            case 'public': return 'Public';
            case 'listed': return 'Listed (Marketplace)';
            case 'private':
            default: return 'Private';
        }
    }

    renderCreateView() {
        const { newSpellName, newSpellDescription, subgraph, error, newSpellExposedInputs, newSpellVisibility, newSpellPricePoints } = this.state;
        
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
                    <div class="steps-header">
                        <h4>Step Execution Order</h4>
                        <p class="steps-help-text">Reorder the steps to control the execution sequence. Steps will execute from top to bottom.</p>
                    </div>
                    <ul class="spell-steps-list" id="spell-steps-list">
                        ${nodesWithTools.map((node, idx) => `
                            <li class="spell-step-item" data-index="${idx}" draggable="true">
                                <div class="step-number">${idx + 1}</div>
                                <div class="step-content-wrapper">
                                    <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                                    <span class="step-label">${node.tool.displayName}</span>
                                </div>
                                <div class="step-actions">
                                    <button class="move-up" title="Move Up" ${idx === 0 ? 'disabled' : ''}>↑</button>
                                    <button class="move-down" title="Move Down" ${idx === nodesWithTools.length - 1 ? 'disabled' : ''}>↓</button>
                                </div>
                            </li>`).join('')}
                    </ul>
                    ${nodesWithTools.length > 1 ? '<p class="steps-note">💡 Tip: Drag steps or use ↑↓ buttons to reorder. The order determines execution sequence.</p>' : ''}
                </div>
            `;
        } else {
            return `<div class="create-spell-view"><h2>Mint New Spell</h2><div class="error-message">Could not find the definitions for any of the selected tools.</div></div>`;
        }

        let potentialInputs = [];
        if (nodesWithTools.length > 0) {
            const connectedInputs = new Set();
            if (subgraph.connections) {
                subgraph.connections.forEach(conn => {
                    connectedInputs.add(`${conn.toWindowId}__${conn.toInput}`);
                });
            }

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
        }

        // Count exposed inputs for better UI feedback
        const exposedCount = Object.values(newSpellExposedInputs).filter(Boolean).length;
        const exposedCountText = exposedCount > 0 ? ` (${exposedCount} selected)` : '';

        return `
            <div class="create-spell-view">
                <h2>Mint New Spell</h2>
                ${error ? `<div class="error-message">${error}</div>` : ''}
                
                <div class="spell-form-section">
                    <h3>Basic Information</h3>
                    <div class="form-group">
                        <label for="spell-name">Spell Name <span class="required">*</span></label>
                        <input type="text" id="spell-name" class="create-spell-name" placeholder="e.g., Psychedelic Portrait" value="${newSpellName}" required>
                    </div>
                    <div class="form-group">
                        <label for="spell-desc">Description</label>
                        <textarea id="spell-desc" class="create-spell-desc" placeholder="A short description of what this spell does.">${newSpellDescription}</textarea>
                    </div>
                    <div class="form-group visibility-group">
                        <label>Visibility</label>
                        <div class="visibility-options">
                            <label class="visibility-option">
                                <input type="radio" name="spell-visibility" value="private" class="create-spell-visibility" ${newSpellVisibility === 'private' ? 'checked' : ''}>
                                <span class="visibility-label">Private</span>
                                <span class="visibility-desc">Only you can use this spell</span>
                            </label>
                            <label class="visibility-option">
                                <input type="radio" name="spell-visibility" value="listed" class="create-spell-visibility" ${newSpellVisibility === 'listed' ? 'checked' : ''}>
                                <span class="visibility-label">Listed (Marketplace)</span>
                                <span class="visibility-desc">Others can purchase and use this spell</span>
                            </label>
                            <label class="visibility-option">
                                <input type="radio" name="spell-visibility" value="public" class="create-spell-visibility" ${newSpellVisibility === 'public' ? 'checked' : ''}>
                                <span class="visibility-label">Public</span>
                                <span class="visibility-desc">Anyone can use this spell for free</span>
                            </label>
                        </div>
                    </div>
                    <div class="form-group price-group" style="display: ${newSpellVisibility === 'listed' ? 'block' : 'none'}">
                        <label for="spell-price">Price (in points) <span class="required">*</span></label>
                        <div class="price-input-wrapper">
                            <input type="number" id="spell-price" class="create-spell-price" min="1" value="${newSpellPricePoints}" placeholder="100">
                            <span class="price-conversion">≈ $${(newSpellPricePoints * SpellsMenuModal.POINTS_TO_USD_RATE).toFixed(2)} USD</span>
                        </div>
                        <p class="price-help-text">Users will pay this amount each time they cast your spell.</p>
                    </div>
                </div>

                ${stepsHtml}

                ${potentialInputs.length > 0 ? `
                    <div class="spell-inputs-selection">
                        <h4>Expose Spell Inputs${exposedCountText}</h4>
                        <p class="input-help-text">Select which parameters will be available as inputs when using this spell. Exposed inputs will be left open for users to provide their own values.</p>
                        <ul class="spell-inputs-list">
                            ${potentialInputs.map(input => `
                                <li class="spell-input-item ${newSpellExposedInputs[input.uniqueId] ? 'exposed' : ''}">
                                    <label>
                                        <input type="checkbox" class="spell-input-checkbox" data-input-id="${input.uniqueId}" ${newSpellExposedInputs[input.uniqueId] ? 'checked' : ''}>
                                        <span class="spell-input-nodename">${input.nodeDisplayName}:</span>
                                        <span class="spell-input-paramname">${input.paramDisplayName}</span>
                                    </label>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                ` : ''}

                <div class="form-actions">
                    <button class="cancel-create-spell-btn">Cancel</button>
                    <button class="submit-create-spell-btn" ${!newSpellName.trim() ? 'disabled' : ''}>Save Spell</button>
                </div>
            </div>
        `;
    }

    async renderSpellDetailView() {
        const { selectedSpell, isEditingSpell, error } = this.state;
        if (!selectedSpell) return '<div class="error-message">Spell not found.</div>';
        
        // Check if user owns the spell
        const canEdit = await this.isSpellOwner(selectedSpell);
        const isEditable = isEditingSpell && canEdit;
        const hasPendingFlowChanges = !!this.state.pendingSpellStructure;
        const exposuresSection = isEditingSpell ? this.renderEditableExposedInputs(selectedSpell) : this.renderExposedInputsDisplay(selectedSpell);
        
        let stepsHtml = '';
        if (selectedSpell.steps) {
            stepsHtml = `
                <div class="spell-detail-steps">
                    <h4>Steps (${selectedSpell.steps.length})</h4>
                    <ul class="spell-steps-list">
                        ${selectedSpell.steps.map((step, idx) => `
                            <li class="spell-step-display-item">
                                <span class="step-number-small">${idx + 1}</span>
                                <span class="step-name">${step.displayName || step.toolIdentifier || 'Unknown'}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }

        const flowEditorControls = isEditable ? `
            <div class="spell-flow-edit-banner">
                <div>
                    <strong>Edit Spell Flow</strong>
                    <p>Tweak tool parameters or connections in the sandbox overlay.</p>
                </div>
                <div class="spell-flow-actions">
                    ${hasPendingFlowChanges ? '<span class="flow-unsaved-indicator">Unsaved flow changes</span>' : ''}
                    <button class="open-spell-flow-editor-btn">Open Editor</button>
                </div>
            </div>
        ` : '';
        
        const nameValue = (selectedSpell.name || '').replace(/"/g, '&quot;');
        const descValue = (selectedSpell.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        return `
            <div class="spell-detail-view">
                ${error ? `<div class="error-message">${error}</div>` : ''}
                <div class="spell-detail-header">
                    <h2>${selectedSpell.name || 'Untitled Spell'}</h2>
                    ${canEdit && !isEditingSpell ? `<button class="edit-spell-btn" title="Edit spell">✏️ Edit</button>` : ''}
                </div>
                
                ${isEditingSpell ? `
                    <div class="spell-edit-form">
                        <div class="form-group">
                            <label for="spell-edit-name">Spell Name <span class="required">*</span></label>
                            <input type="text" id="spell-edit-name" class="spell-detail-name" value="${nameValue}" ${isEditable ? '' : 'readonly'} />
                        </div>
                        <div class="form-group">
                            <label for="spell-edit-desc">Description</label>
                            <textarea id="spell-edit-desc" class="spell-detail-desc" ${isEditable ? '' : 'readonly'}>${descValue}</textarea>
                        </div>
                        <div class="form-group visibility-group">
                            <label>Visibility</label>
                            <div class="visibility-options">
                                <label class="visibility-option">
                                    <input type="radio" name="spell-edit-visibility" value="private" class="spell-detail-visibility" ${(selectedSpell.visibility || 'private') === 'private' ? 'checked' : ''} ${isEditable ? '' : 'disabled'}>
                                    <span class="visibility-label">Private</span>
                                </label>
                                <label class="visibility-option">
                                    <input type="radio" name="spell-edit-visibility" value="listed" class="spell-detail-visibility" ${selectedSpell.visibility === 'listed' ? 'checked' : ''} ${isEditable ? '' : 'disabled'}>
                                    <span class="visibility-label">Listed</span>
                                </label>
                                <label class="visibility-option">
                                    <input type="radio" name="spell-edit-visibility" value="public" class="spell-detail-visibility" ${selectedSpell.visibility === 'public' ? 'checked' : ''} ${isEditable ? '' : 'disabled'}>
                                    <span class="visibility-label">Public</span>
                                </label>
                            </div>
                        </div>
                        <div class="form-group price-group" style="display: ${selectedSpell.visibility === 'listed' ? 'block' : 'none'}">
                            <label for="spell-edit-price">Price (in points)</label>
                            <div class="price-input-wrapper">
                                <input type="number" id="spell-edit-price" class="spell-detail-price" min="1" value="${selectedSpell.pricePoints || 100}" ${isEditable ? '' : 'readonly'}>
                                <span class="price-conversion">≈ $${((selectedSpell.pricePoints || 100) * SpellsMenuModal.POINTS_TO_USD_RATE).toFixed(2)} USD</span>
                            </div>
                        </div>
                    </div>
                ` : `
                    <div class="spell-detail-display">
                        <div class="spell-detail-field">
                            <label>Name</label>
                            <div class="spell-detail-value">${selectedSpell.name || 'Untitled Spell'}</div>
                        </div>
                        <div class="spell-detail-field">
                            <label>Description</label>
                            <div class="spell-detail-value">${selectedSpell.description || 'No description'}</div>
                        </div>
                        <div class="spell-detail-field">
                            <label>Visibility</label>
                            <div class="spell-detail-value">${this.getVisibilityDisplayName(selectedSpell.visibility)}${selectedSpell.visibility === 'listed' ? ` (${selectedSpell.pricePoints || 0} points)` : ''}</div>
                        </div>
                    </div>
                `}

                ${(selectedSpell.visibility === 'public' || selectedSpell.visibility === 'listed') && (selectedSpell.publicSlug || selectedSpell.slug) ? `
                    <div class="public-link">
                        <label>Public Link</label>
                        <div class="public-link-wrapper">
                            <input type="text" readonly value="${window.location.origin}/spells/${selectedSpell.publicSlug || selectedSpell.slug}" />
                            <button class="copy-link-btn">Copy</button>
                        </div>
                    </div>
                ` : ''}
                
                ${stepsHtml}
                ${flowEditorControls}
                ${exposuresSection}

                <div class="spell-detail-actions">
                    ${isEditingSpell ? `
                        <button class="save-spell-btn">Save Changes</button>
                        <button class="cancel-edit-spell-btn">Cancel</button>
                    ` : `
                        ${canEdit ? `<button class="delete-spell-btn">Delete</button>` : ''}
                    `}
                    <button class="back-spell-btn">Back</button>
                </div>
            </div>
        `;
    }

    renderEditableExposedInputs(spell) {
        const potentialInputs = this.getPotentialExposedInputs(spell);
        if (!potentialInputs.length) {
            return `
                <div class="spell-inputs-selection">
                    <h4>Expose Inputs</h4>
                    <div class="empty-message">No eligible inputs are available to expose right now.</div>
                </div>
            `;
        }
        const map = this.state.editExposedInputMap || {};
        const selectedCount = Object.keys(map).length;
        const countText = selectedCount ? ` (${selectedCount} selected)` : '';
        return `
            <div class="spell-inputs-selection">
                <h4>Expose Inputs${countText}</h4>
                <p class="input-help-text">Select which parameters stay open for users when casting this spell.</p>
                <ul class="spell-inputs-list">
                    ${potentialInputs.map(input => `
                        <li class="spell-input-item ${map[input.uniqueId] ? 'exposed' : ''}">
                            <label>
                                <input type="checkbox" class="edit-exposed-input-checkbox" data-input-id="${input.uniqueId}" ${map[input.uniqueId] ? 'checked' : ''}>
                                <span class="spell-input-nodename">${input.nodeDisplayName}:</span>
                                <span class="spell-input-paramname">${input.paramDisplayName}</span>
                            </label>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    renderExposedInputsDisplay(spell) {
        const exposures = Array.isArray(spell?.exposedInputs) ? spell.exposedInputs : [];
        if (!exposures.length) {
            return `
                <div class="spell-inputs-selection spell-inputs-display">
                    <h4>Exposed Inputs</h4>
                    <div class="empty-message">No inputs are currently exposed.</div>
                </div>
            `;
        }
        const metadata = {};
        this.getPotentialExposedInputs(spell).forEach(input => {
            metadata[input.uniqueId] = input;
        });
        const listItems = exposures.map(input => {
            const uniqueId = `${input.nodeId}__${input.paramKey}`;
            const meta = metadata[uniqueId];
            if (meta) {
                return `<li>${meta.nodeDisplayName}: ${meta.paramDisplayName}</li>`;
            }
            return `<li>${input.nodeId}: ${input.paramKey}</li>`;
        }).join('');
        return `
            <div class="spell-inputs-selection spell-inputs-display">
                <h4>Exposed Inputs</h4>
                <ul>${listItems}</ul>
            </div>
        `;
    }

    renderMarketplaceSpellDetailView() {
        const { selectedSpell } = this.state;
        if (!selectedSpell) return '<div class="error-message">Spell not found.</div>';
        
        const slug = selectedSpell.slug || selectedSpell.spellId || selectedSpell._id;
        
        let stepsHtml = '';
        if (selectedSpell.steps && selectedSpell.steps.length > 0) {
            stepsHtml = `
                <div class="spell-detail-steps">
                    <strong>Steps:</strong>
                    <ul>
                        ${selectedSpell.steps.map(step => `<li>${step.toolIdentifier || step.toolId || 'Unknown tool'}</li>`).join('')}
                    </ul>
                </div>
            `;
        }
        
        const tagsHtml = selectedSpell.tags && selectedSpell.tags.length > 0 
            ? `<div class="spell-tags">Tags: ${selectedSpell.tags.map(tag => `<span class="tag">${tag}</span>`).join(' ')}</div>`
            : '';
        
        return `
            <div class="spell-detail-view marketplace-spell-detail">
                <h2>${selectedSpell.name}</h2>
                <p class="spell-description">${selectedSpell.description || 'No description available.'}</p>
                <div class="spell-meta">
                    <span class="spell-uses">${selectedSpell.uses || 0} uses</span>
                    ${tagsHtml}
                </div>
                ${stepsHtml}
                <div class="spell-detail-actions">
                    <button class="cast-spell-btn" data-spell-slug="${slug}">Cast Spell</button>
                    <button class="add-to-canvas-btn" data-spell-slug="${slug}">Add to Canvas</button>
                    <button class="back-to-marketplace-btn">Back to Marketplace</button>
                </div>
            </div>
        `;
    }

    attachSpellDetailHandlers() {
        const { selectedSpell, isEditingSpell } = this.state;
        if (!selectedSpell) return;

        const nameInput = this.modalElement.querySelector('.spell-detail-name');
        const descInput = this.modalElement.querySelector('.spell-detail-desc');

        if (nameInput && isEditingSpell) {
            nameInput.oninput = (e) => {
                this.state.selectedSpell.name = e.target.value;
            };
        }
        if (descInput && isEditingSpell) {
            descInput.oninput = (e) => {
                this.state.selectedSpell.description = e.target.value;
            };
        }

        // Handle visibility radio buttons
        if (isEditingSpell) {
            const visibilityRadios = this.modalElement.querySelectorAll('.spell-detail-visibility');
            visibilityRadios.forEach(radio => {
                radio.onchange = (e) => {
                    this.state.selectedSpell.visibility = e.target.value;
                    // Show/hide price input
                    const priceGroup = this.modalElement.querySelector('.price-group');
                    if (priceGroup) {
                        priceGroup.style.display = e.target.value === 'listed' ? 'block' : 'none';
                    }
                };
            });

            // Handle price input
            const priceInput = this.modalElement.querySelector('.spell-detail-price');
            if (priceInput) {
                priceInput.oninput = (e) => {
                    const points = parseInt(e.target.value, 10) || 0;
                    this.state.selectedSpell.pricePoints = points;
                    // Update conversion display
                    const conversionSpan = this.modalElement.querySelector('.price-conversion');
                    if (conversionSpan) {
                        conversionSpan.textContent = `≈ $${(points * SpellsMenuModal.POINTS_TO_USD_RATE).toFixed(2)} USD`;
                    }
                };
            }
        }
        
        const editBtn = this.modalElement.querySelector('.edit-spell-btn');
        const saveBtn = this.modalElement.querySelector('.save-spell-btn');
        const cancelBtn = this.modalElement.querySelector('.cancel-edit-spell-btn');
        const deleteBtn = this.modalElement.querySelector('.delete-spell-btn');
        const backBtn = this.modalElement.querySelector('.back-spell-btn');
        const copyBtn = this.modalElement.querySelector('.copy-link-btn');
        const flowBtn = this.modalElement.querySelector('.open-spell-flow-editor-btn');
        
        if (editBtn) {
            editBtn.onclick = () => {
                this.setState({ isEditingSpell: true });
                // Re-render to show edit form
                this.render();
            };
        }
        if (saveBtn) {
            saveBtn.onclick = () => this.handleSaveSpell();
        }
        if (cancelBtn) {
            cancelBtn.onclick = () => {
                // Reload spell data to discard changes
                const spellId = selectedSpell._id || selectedSpell.slug;
                this.fetchSpellById(spellId).then(spell => {
                    if (spell) {
                        const { sanitizedSpell, exposureMap } = this.prepareSpellForEdit(spell);
                        this.setState({ selectedSpell: sanitizedSpell, isEditingSpell: false, pendingSpellStructure: null, editExposedInputMap: exposureMap });
                        // Re-render to show display view
                        this.render();
                    } else {
                        this.setState({ isEditingSpell: false, pendingSpellStructure: null });
                        this.render();
                    }
                });
            };
        }
        if (deleteBtn) {
            deleteBtn.onclick = () => this.handleDeleteSpell();
        }
        if (backBtn) {
            backBtn.onclick = () => {
                this.setState({ view: 'main', selectedSpell: null, isEditingSpell: false, pendingSpellStructure: null, editExposedInputMap: {} });
                this.fetchUserSpells();
            };
        }
        if (copyBtn) {
            copyBtn.onclick = () => {
                const urlInput = this.modalElement.querySelector('.public-link input');
                if (urlInput) {
                    urlInput.select();
                    document.execCommand('copy');
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => copyBtn.textContent = 'Copy', 1500);
                }
            };
        }

        if (flowBtn) {
            flowBtn.onclick = () => this.launchSpellFlowEditor(flowBtn);
        }

        if (isEditingSpell) {
            const exposureCheckboxes = this.modalElement.querySelectorAll('.edit-exposed-input-checkbox');
            exposureCheckboxes.forEach(checkbox => {
                checkbox.onchange = (e) => {
                    const inputId = e.target.dataset.inputId;
                    const checked = e.target.checked;
                    this.updateExposedInputSelection(inputId, checked);
                };
            });
        }
    }

    async fetchSpellById(spellId) {
        try {
            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();
            const res = await fetch(`/api/v1/spells/${spellId}`, {
                headers: { 'x-csrf-token': csrfToken },
                credentials: 'include'
            });
            if (res.ok) {
                return await res.json();
            }
            return null;
        } catch (err) {
            console.error('[SpellsMenuModal] Error fetching spell:', err);
            return null;
        }
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

    async launchSpellFlowEditor(triggerButton = null) {
        const { selectedSpell, pendingSpellStructure } = this.state;
        if (!selectedSpell) return;

        const workingSpell = pendingSpellStructure
            ? { ...selectedSpell, steps: pendingSpellStructure.steps, connections: pendingSpellStructure.connections }
            : selectedSpell;

        try {
            if (triggerButton) triggerButton.disabled = true;
            this.hideModalForFlowEditor();
            const result = await openSpellEditorOverlay(workingSpell);
            if (result) {
                const updatedSpell = {
                    ...selectedSpell,
                    steps: result.steps,
                    connections: result.connections
                };
                const { sanitizedSpell, exposureMap } = this.prepareSpellForEdit(updatedSpell);
                this.setState({
                    selectedSpell: sanitizedSpell,
                    pendingSpellStructure: result,
                    editExposedInputMap: exposureMap,
                    error: null
                });
            }
        } catch (err) {
            console.error('[SpellsMenuModal] Spell editor overlay failed:', err);
            this.setState({ error: err.message || 'Failed to open the spell editor overlay.' });
        } finally {
            this.restoreModalAfterFlowEditor();
            if (triggerButton) triggerButton.disabled = false;
        }
    }

    hideModalForFlowEditor() {
        if (this.modalElement && !this._modalFlowHidden) {
            this._modalPrevDisplay = this.modalElement.style.display || '';
            this.modalElement.style.display = 'none';
            this._modalFlowHidden = true;
        }
    }

    restoreModalAfterFlowEditor() {
        if (this.modalElement && this._modalFlowHidden) {
            this.modalElement.style.display = this._modalPrevDisplay || '';
            this._modalFlowHidden = false;
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

    async handleCastMarketplaceSpell(slug) {
        if (!slug) return;

        this.setState({ loading: true, error: null });

        try {
            // Get the current user's masterAccountId (required for casting)
            const masterAccountId = await this.getCurrentMasterAccountId();
            if (!masterAccountId) {
                this.setState({ error: 'You must be logged in to cast spells.', loading: false });
                return;
            }

            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();

            const res = await fetch('/api/v1/spells/cast', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-csrf-token': csrfToken
                },
                credentials: 'include',
                body: JSON.stringify({
                    slug,
                    context: {
                        masterAccountId,
                        parameterOverrides: {},
                        platform: 'web-sandbox'
                    }
                })
            });
            
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error?.message || 'Failed to cast spell');
            }
            
            const result = await res.json();
            
            // Close modal and show success message
            this.hide();
            alert(`Spell "${slug}" cast successfully!`);
            
        } catch (err) {
            this.setState({ error: err.message || 'Failed to cast spell.', loading: false });
        }
    }

    /**
     * Creates a new spell from the selected nodes.
     * 
     * CRITICAL FIX: Exposed inputs are filtered out from parameterMappings before saving.
     * This ensures that exposed inputs don't have static values "baked in" to the spell definition.
     * When a spell is loaded, exposed inputs will be empty/default, allowing users to provide
     * their own values when using the spell.
     * 
     * Flow:
     * 1. User marks parameters as "exposed inputs" via checkboxes
     * 2. Exposed inputs are extracted into the exposedInputs array
     * 3. Before saving, we filter out exposed inputs from each step's parameterMappings
     * 4. This ensures exposed inputs have no static values in the saved spell
     * 5. When spell is loaded, SpellWindow creates empty mappings for exposed inputs (see SpellWindow.js)
     * 6. Users can then provide values for exposed inputs when casting the spell
     */
    async handleCreateSpell() {
        const { newSpellName, newSpellDescription, spells, subgraph, newSpellExposedInputs, newSpellVisibility, newSpellPricePoints } = this.state;

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

        // For listed spells, price is required
        if (newSpellVisibility === 'listed' && (!newSpellPricePoints || newSpellPricePoints < 1)) {
            this.setState({ error: 'Listed spells must have a price of at least 1 point.' });
            return;
        }

        this.setState({ loading: true, error: null });

        // Extract exposed inputs from checkbox state
        const exposedInputs = Object.entries(newSpellExposedInputs)
            .filter(([, isExposed]) => isExposed)
            .map(([inputId]) => {
                const [nodeId, paramKey] = inputId.split('__');
                return { nodeId, paramKey };
            });

        try {
            const csrfRes = await fetch('/api/v1/csrf-token');
            const { csrfToken } = await csrfRes.json();

            // Create a Set for quick lookup of exposed inputs
            const exposedInputsSet = new Set();
            exposedInputs.forEach(input => {
                exposedInputsSet.add(`${input.nodeId}__${input.paramKey}`);
            });

            // CRITICAL: Filter out exposed inputs from parameterMappings before saving
            // Exposed inputs should NOT have static values saved - they should be user-provided when using the spell
            // This prevents "baking in" static values that should be left open for user input
            // 
            // NOTE: subgraph.nodes is already in the correct order (may have been reordered via reorderSpellSteps)
            // The order of nodes in this array determines the execution order of steps in the spell
            const steps = subgraph ? subgraph.nodes.map(n => {
                const stepMappings = { ...n.parameterMappings };
                
                // Remove any parameters that are marked as exposed inputs
                // This ensures exposed inputs don't have static values "baked in"
                Object.keys(stepMappings).forEach(paramKey => {
                    const exposedKey = `${n.id}__${paramKey}`;
                    if (exposedInputsSet.has(exposedKey)) {
                        delete stepMappings[paramKey];
                    }
                });
                
                return {
                    id: n.id,
                    toolIdentifier: n.toolId,
                    displayName: n.displayName,
                    parameterMappings: stepMappings
                };
            }) : [];

            const payload = {
                name: newSpellName,
                description: newSpellDescription,
                visibility: newSpellVisibility,
                pricePoints: newSpellVisibility === 'listed' ? newSpellPricePoints : undefined,
                steps: steps,
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

            this.setState({ loading: false, view: 'main', newSpellName: '', newSpellDescription: '', newSpellVisibility: 'private', newSpellPricePoints: 100, newSpellExposedInputs: {} });
            this.fetchUserSpells();
        } catch (err) {
            this.setState({ error: err.message, loading: false });
        }
    }

    /**
     * Reorder spell steps in the subgraph.nodes array and rerender.
     * This ensures the execution order matches the user's desired sequence.
     * @param {number} fromIdx - original index
     * @param {number} toIdx   - new index (can be equal to length for moving to end)
     */
    reorderSpellSteps(fromIdx, toIdx) {
        const nodes = [...(this.state.subgraph?.nodes || [])];
        if (fromIdx === toIdx || fromIdx < 0 || fromIdx >= nodes.length) return;
        
        // Clamp toIdx to valid range (0 to length)
        const maxIdx = nodes.length;
        const clampedToIdx = Math.min(Math.max(0, toIdx), maxIdx);
        
        // Remove the item from its current position
        const [moved] = nodes.splice(fromIdx, 1);
        
        // Calculate the correct insertion index
        // If moving down (fromIdx < clampedToIdx), we need to account for the removed item
        const insertIdx = fromIdx < clampedToIdx ? clampedToIdx - 1 : clampedToIdx;
        
        // Insert at the calculated position
        nodes.splice(insertIdx, 0, moved);
        
        // Update state & rerender - this will update the displayed order
        const newSubgraph = { ...this.state.subgraph, nodes };
        this.setState({ subgraph: newSubgraph });
        
        console.log(`[SpellsMenuModal] Reordered step ${fromIdx + 1} to position ${insertIdx + 1}`);
    }
} 
