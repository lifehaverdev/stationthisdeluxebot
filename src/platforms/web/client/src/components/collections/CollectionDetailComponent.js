import { Component } from '../../../../../web/dom/Component.js';
import { appStore, storeActions } from '../../stores/AppStore.js';
import { eventBus } from '../../../../../web/dom/EventBus.js';

export class CollectionDetailComponent extends Component {
    constructor(element) {
        super(element);
        
        this.state = {
            collectionId: null,
            collection: null,
            items: [],
            isShared: false,
            isLoading: true,
            error: null,
            userPermission: 'read' // Default to most restrictive permission
        };
    }
    
    onMount() {
        // Subscribe to store updates
        this.storeUnsubscribe = appStore.subscribe((state) => {
            this.setState({
                isLoading: state.isLoading,
                error: state.error
            });
        });
        
        // Load collection data if we have an ID
        if (this.state.collectionId) {
            this.loadCollection();
        }
    }
    
    onUnmount() {
        // Unsubscribe from store
        if (this.storeUnsubscribe) {
            this.storeUnsubscribe();
        }
    }
    
    async loadCollection() {
        const { collectionId, isShared } = this.state;
        
        if (!collectionId) return;
        
        storeActions.setLoading(true);
        
        try {
            // Determine the endpoint based on whether this is a shared collection
            const endpoint = isShared 
                ? `/api/share/collections/${collectionId}` 
                : `/api/collections/${collectionId}`;
                
            const response = await fetch(endpoint, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to load collection');
            }
            
            const collectionData = await response.json();
            // If this is a shared collection, get the user's permission for it
            const userPermission = isShared ? (collectionData.permission || 'read') : 'admin';
            
            this.setState({ 
                collection: collectionData,
                userPermission: userPermission
            });
            storeActions.setCurrentCollection(collectionData);
            
            // Load collection items
            const itemsEndpoint = isShared 
                ? `/api/share/collections/${collectionId}/items`
                : `/api/collections/${collectionId}/items`;
                
            const itemsResponse = await fetch(itemsEndpoint, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (!itemsResponse.ok) {
                throw new Error('Failed to load collection items');
            }
            
            const itemsData = await itemsResponse.json();
            this.setState({ items: itemsData });
        } catch (error) {
            console.error('Error loading collection:', error);
            this.setState({ error: error.message });
        } finally {
            storeActions.setLoading(false);
        }
    }
    
    navigateToSharing() {
        const { collectionId } = this.state;
        if (collectionId) {
            eventBus.emit('router:navigate', `/collections/${collectionId}/share`);
        }
    }
    
    // Check if user has permission to edit items
    canEditItems() {
        const { userPermission } = this.state;
        return userPermission === 'edit' || userPermission === 'admin';
    }
    
    // Check if user has permission to share the collection
    canShareCollection() {
        const { userPermission } = this.state;
        return userPermission === 'admin';
    }
    
    // Get permission display name (capitalized)
    getPermissionDisplayName(permission) {
        return permission.charAt(0).toUpperCase() + permission.slice(1);
    }
    
    getPermissionBadgeClass(permission) {
        const classes = {
            'read': 'badge-info',
            'edit': 'badge-success',
            'admin': 'badge-primary'
        };
        return classes[permission] || 'badge-info';
    }
    
    render() {
        const { collection, items, isShared, isLoading, error, userPermission } = this.state;
        
        if (isLoading) {
            return `
                <div class="collection-detail-container">
                    <div class="loader"></div>
                </div>
            `;
        }
        
        if (error) {
            return `
                <div class="collection-detail-container">
                    <div class="error-message">${error}</div>
                    <button id="retry-button" class="btn btn-primary">Retry</button>
                </div>
            `;
        }
        
        if (!collection) {
            return `
                <div class="collection-detail-container">
                    <div class="error-message">Collection not found</div>
                    <a href="/collections" class="btn btn-primary">Back to Collections</a>
                </div>
            `;
        }
        
        return `
            <div class="collection-detail-container">
                <div class="collection-header">
                    <div class="collection-title">
                        <h1>${collection.name}</h1>
                        ${collection.description ? `<p>${collection.description}</p>` : ''}
                    </div>
                    
                    <div class="collection-actions">
                        ${!isShared || this.canShareCollection() ? `
                            <button id="share-button" class="btn btn-secondary">
                                <span class="icon">🔗</span> Share
                            </button>
                        ` : ''}
                        <a href="${isShared ? '/shared' : '/collections'}" class="btn btn-outline">
                            Back
                        </a>
                    </div>
                </div>
                
                ${isShared ? `
                    <div class="shared-info">
                        <span>Shared by: ${collection.ownerName || 'Unknown'}</span>
                        <span class="permission-badge ${this.getPermissionBadgeClass(userPermission)}">
                            ${this.getPermissionDisplayName(userPermission)}
                        </span>
                    </div>
                ` : ''}
                
                <div class="collection-content">
                    ${items.length === 0 
                        ? `
                            <div class="empty-state">
                                <p>No items in this collection yet.</p>
                                ${this.canEditItems() ? `
                                    <button id="add-item-button" class="btn btn-primary">Add Item</button>
                                ` : ''}
                            </div>
                        ` 
                        : `
                            <div class="items-grid">
                                ${items.map(item => `
                                    <div class="item-card card" data-id="${item.id}">
                                        ${item.thumbnailUrl ? `
                                            <div class="item-thumbnail">
                                                <img src="${item.thumbnailUrl}" alt="${item.name}">
                                            </div>
                                        ` : ''}
                                        <div class="item-info">
                                            <h3>${item.name}</h3>
                                            <p>${item.description || 'No description'}</p>
                                            ${item.metadata ? `
                                                <div class="item-metadata">
                                                    <div class="metadata-item">
                                                        <span class="label">Type:</span>
                                                        <span class="value">${item.metadata.type || 'Unknown'}</span>
                                                    </div>
                                                    ${item.metadata.created ? `
                                                        <div class="metadata-item">
                                                            <span class="label">Created:</span>
                                                            <span class="value">${new Date(item.metadata.created).toLocaleDateString()}</span>
                                                        </div>
                                                    ` : ''}
                                                </div>
                                            ` : ''}
                                        </div>
                                        ${this.canEditItems() ? `
                                            <div class="item-actions">
                                                <button class="btn btn-icon edit-item-button" data-id="${item.id}">✏️</button>
                                                <button class="btn btn-icon delete-item-button" data-id="${item.id}">🗑️</button>
                                            </div>
                                        ` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        `
                    }
                </div>
                
                ${!this.canEditItems() ? `
                    <div class="permission-notice">
                        <p>You have ${this.getPermissionDisplayName(userPermission)} access. ${userPermission === 'read' ? 'You cannot make changes to this collection.' : ''}</p>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    events() {
        return {
            'click #retry-button': this.loadCollection.bind(this),
            'click #share-button': this.navigateToSharing.bind(this),
            'click #add-item-button': this.handleAddItem.bind(this),
            'click .edit-item-button': this.handleEditItem.bind(this),
            'click .delete-item-button': this.handleDeleteItem.bind(this)
        };
    }
    
    handleAddItem() {
        // This would be implemented in a future task
        console.log('Add item to collection:', this.state.collectionId);
    }
    
    handleEditItem(e) {
        const itemId = e.target.dataset.id;
        if (itemId) {
            // This would be implemented in a future task
            console.log('Edit item:', itemId);
        }
    }
    
    handleDeleteItem(e) {
        const itemId = e.target.dataset.id;
        if (itemId && confirm('Are you sure you want to delete this item?')) {
            // This would be implemented in a future task
            console.log('Delete item:', itemId);
        }
    }
    
    static get styles() {
        return `
            .collection-detail-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 2rem 1rem;
            }
            
            .collection-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 2rem;
            }
            
            .collection-title h1 {
                margin-bottom: 0.5rem;
            }
            
            .collection-actions {
                display: flex;
                gap: 0.75rem;
            }
            
            .shared-info {
                display: flex;
                align-items: center;
                gap: 1rem;
                background-color: #1e1e1e;
                padding: 0.75rem 1rem;
                border-radius: 6px;
                margin-bottom: 2rem;
            }
            
            .permission-badge {
                display: inline-block;
                padding: 0.25rem 0.5rem;
                border-radius: 4px;
                font-size: 0.8rem;
                color: white;
            }
            
            .badge-info {
                background-color: #2c5282;
            }
            
            .badge-success {
                background-color: #276749;
            }
            
            .badge-primary {
                background-color: #6b21a8;
            }
            
            .permission-notice {
                margin-top: 2rem;
                padding: 1rem;
                background-color: #1e1e1e;
                border-left: 4px solid #2c5282;
                border-radius: 4px;
            }
            
            .items-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                gap: 1.5rem;
            }
            
            .item-card {
                background-color: #1a1a1a;
                border-radius: 8px;
                overflow: hidden;
                transition: transform 0.2s;
            }
            
            .item-card:hover {
                transform: translateY(-5px);
            }
            
            .item-thumbnail {
                width: 100%;
                height: 180px;
                overflow: hidden;
            }
            
            .item-thumbnail img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            
            .item-info {
                padding: 1rem;
            }
            
            .item-metadata {
                margin-top: 0.75rem;
                font-size: 0.85rem;
                color: #aaa;
            }
            
            .metadata-item {
                display: flex;
                justify-content: space-between;
                margin-bottom: 0.25rem;
            }
            
            .item-actions {
                display: flex;
                justify-content: flex-end;
                gap: 0.5rem;
                padding: 0.75rem;
                border-top: 1px solid #333;
            }
            
            .btn-icon {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                background-color: transparent;
                border: 1px solid #555;
                cursor: pointer;
                transition: background-color 0.2s;
            }
            
            .btn-icon:hover {
                background-color: rgba(255, 255, 255, 0.1);
            }
            
            .empty-state {
                text-align: center;
                padding: 3rem;
                background-color: #1e1e1e;
                border-radius: 8px;
            }
            
            .icon {
                margin-right: 0.5rem;
            }
        `;
    }
} 