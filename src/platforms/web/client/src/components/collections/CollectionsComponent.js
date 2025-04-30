import { Component } from '../../../../../web/dom/Component.js';
import { appStore, storeActions } from '../../stores/AppStore.js';
import { eventBus } from '../../../../../web/dom/EventBus.js';

export class CollectionsComponent extends Component {
    constructor(element) {
        super(element);
        
        // Initialize state
        this.state = {
            collections: [],
            isLoading: true,
            error: null
        };
    }
    
    onMount() {
        // Subscribe to store updates
        this.storeUnsubscribe = appStore.subscribe((state) => {
            this.setState({
                collections: state.collections,
                isLoading: state.isLoading,
                error: state.error
            });
        });
        
        // Load collections
        this.loadCollections();
    }
    
    onUnmount() {
        // Unsubscribe from store
        if (this.storeUnsubscribe) {
            this.storeUnsubscribe();
        }
    }
    
    async loadCollections() {
        storeActions.setLoading(true);
        
        try {
            const response = await fetch('/api/collections', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to load collections');
            }
            
            const data = await response.json();
            storeActions.setCollections(data);
        } catch (error) {
            console.error('Error loading collections:', error);
            storeActions.setError(error.message);
        } finally {
            storeActions.setLoading(false);
        }
    }
    
    navigateToShareCollection(collectionId) {
        eventBus.emit('router:navigate', `/collections/${collectionId}/share`);
    }
    
    render() {
        const { collections, isLoading, error } = this.state;
        
        if (isLoading) {
            return `
                <div class="collections-container">
                    <h1>My Collections</h1>
                    <div class="loader"></div>
                </div>
            `;
        }
        
        if (error) {
            return `
                <div class="collections-container">
                    <h1>My Collections</h1>
                    <div class="error-message">${error}</div>
                    <button id="retry-button" class="btn btn-primary">Retry</button>
                </div>
            `;
        }
        
        if (collections.length === 0) {
            return `
                <div class="collections-container">
                    <h1>My Collections</h1>
                    <div class="empty-state">
                        <p>You don't have any collections yet.</p>
                        <button id="create-collection-button" class="btn btn-primary">Create Collection</button>
                    </div>
                </div>
            `;
        }
        
        return `
            <div class="collections-container">
                <div class="collections-header">
                    <h1>My Collections</h1>
                    <div class="collections-actions">
                        <a href="/shared" class="btn btn-secondary">Shared With Me</a>
                        <button id="create-collection-button" class="btn btn-primary">Create Collection</button>
                    </div>
                </div>
                
                <div class="collections-grid">
                    ${collections.map(collection => `
                        <div class="collection-card card" data-id="${collection.id}">
                            <h3>${collection.name}</h3>
                            <p>${collection.description || 'No description'}</p>
                            <div class="card-footer">
                                <span>${collection.itemCount || 0} items</span>
                                <div class="card-actions">
                                    <button class="btn btn-icon share-collection-button" data-id="${collection.id}" title="Share Collection">🔗</button>
                                    <a href="/collections/${collection.id}" class="btn btn-secondary">View</a>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    events() {
        return {
            'click #retry-button': this.loadCollections.bind(this),
            'click #create-collection-button': this.handleCreateCollection.bind(this),
            'click .collection-card': this.handleCollectionClick.bind(this),
            'click .share-collection-button': (e) => {
                e.stopPropagation(); // Prevent the card click event
                const button = e.target.closest('.share-collection-button');
                if (button) {
                    const collectionId = button.dataset.id;
                    if (collectionId) {
                        this.navigateToShareCollection(collectionId);
                    }
                }
            }
        };
    }
    
    handleCreateCollection() {
        // ToDo: Implement collection creation
        console.log('Create collection');
    }
    
    handleCollectionClick(e) {
        // Don't handle clicks on buttons
        if (e.target.closest('button')) return;
        
        const card = e.target.closest('.collection-card');
        if (!card) return;
        
        const collectionId = card.dataset.id;
        if (collectionId) {
            // Avoid navigation if clicking on the View button (it has its own link)
            if (!e.target.closest('.btn')) {
                window.location.href = `/collections/${collectionId}`;
            }
        }
    }
    
    static get styles() {
        return `
            .collections-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 2rem 1rem;
            }
            
            .collections-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 2rem;
            }
            
            .collections-actions {
                display: flex;
                gap: 0.75rem;
            }
            
            .collections-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                gap: 1.5rem;
            }
            
            .collection-card {
                cursor: pointer;
                padding: 1.5rem;
                background-color: #1a1a1a;
                border-radius: 8px;
                transition: transform 0.2s;
            }
            
            .collection-card:hover {
                transform: translateY(-5px);
            }
            
            .card-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 1rem;
                padding-top: 1rem;
                border-top: 1px solid #333;
            }
            
            .card-actions {
                display: flex;
                align-items: center;
                gap: 0.5rem;
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
            
            .error-message {
                background-color: #5a1c1c;
                color: #f8d7da;
                padding: 0.75rem;
                border-radius: 4px;
                margin-bottom: 1rem;
            }
        `;
    }
} 