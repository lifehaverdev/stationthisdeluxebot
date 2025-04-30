import { Component } from '../../../../../web/dom/Component.js';
import { appStore, storeActions } from '../../stores/AppStore.js';

export class SharedCollectionsComponent extends Component {
    constructor(element) {
        super(element);
        
        this.state = {
            sharedCollections: [],
            isLoading: true,
            error: null
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
        
        // Load shared collections
        this.loadSharedCollections();
    }
    
    onUnmount() {
        // Unsubscribe from store
        if (this.storeUnsubscribe) {
            this.storeUnsubscribe();
        }
    }
    
    async loadSharedCollections() {
        storeActions.setLoading(true);
        
        try {
            const response = await fetch('/api/share/collections/shared-with-me', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to load shared collections');
            }
            
            const data = await response.json();
            this.setState({ sharedCollections: data });
        } catch (error) {
            console.error('Error loading shared collections:', error);
            this.setState({ error: error.message });
        } finally {
            storeActions.setLoading(false);
        }
    }
    
    render() {
        const { sharedCollections, isLoading, error } = this.state;
        
        if (isLoading) {
            return `
                <div class="shared-collections-container">
                    <h1>Collections Shared With Me</h1>
                    <div class="loader"></div>
                </div>
            `;
        }
        
        if (error) {
            return `
                <div class="shared-collections-container">
                    <h1>Collections Shared With Me</h1>
                    <div class="error-message">${error}</div>
                    <button id="retry-button" class="btn btn-primary">Retry</button>
                </div>
            `;
        }
        
        if (sharedCollections.length === 0) {
            return `
                <div class="shared-collections-container">
                    <h1>Collections Shared With Me</h1>
                    <div class="empty-state">
                        <p>No collections have been shared with you yet.</p>
                    </div>
                </div>
            `;
        }
        
        return `
            <div class="shared-collections-container">
                <h1>Collections Shared With Me</h1>
                
                <div class="collections-grid">
                    ${sharedCollections.map(collection => `
                        <div class="collection-card card shared" data-id="${collection.id}">
                            <div class="shared-by">
                                <span>Shared by: ${collection.ownerName || 'Unknown'}</span>
                                <span class="permission-badge">${collection.permission}</span>
                            </div>
                            <h3>${collection.name}</h3>
                            <p>${collection.description || 'No description'}</p>
                            <div class="card-footer">
                                <span>${collection.itemCount || 0} items</span>
                                <a href="/shared-collections/${collection.id}" class="btn btn-secondary">View</a>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    events() {
        return {
            'click #retry-button': this.loadSharedCollections.bind(this),
            'click .collection-card': this.handleCollectionClick.bind(this)
        };
    }
    
    handleCollectionClick(e) {
        const card = e.target.closest('.collection-card');
        if (!card) return;
        
        const collectionId = card.dataset.id;
        if (collectionId) {
            // Avoid navigation if clicking on the View button (it has its own link)
            if (!e.target.closest('.btn')) {
                window.location.href = `/shared-collections/${collectionId}`;
            }
        }
    }
    
    static get styles() {
        return `
            .shared-collections-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 2rem 1rem;
            }
            
            .collections-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                gap: 1.5rem;
            }
            
            .collection-card {
                cursor: pointer;
                position: relative;
                padding: 1.5rem;
                background-color: #1a1a1a;
                border-radius: 8px;
                transition: transform 0.2s ease-in-out;
            }
            
            .collection-card:hover {
                transform: translateY(-5px);
            }
            
            .shared-by {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 0.85rem;
                color: #aaa;
                margin-bottom: 0.75rem;
            }
            
            .permission-badge {
                display: inline-block;
                padding: 0.25rem 0.5rem;
                background-color: #2c5282;
                border-radius: 4px;
                font-size: 0.8rem;
                color: white;
            }
            
            .card-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 1rem;
                padding-top: 1rem;
                border-top: 1px solid #333;
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