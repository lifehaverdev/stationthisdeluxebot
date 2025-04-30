import { Component } from '../../../../web/dom/Component.js';
import { eventBus } from '../../../../web/dom/EventBus.js';
import { appStore } from '../stores/AppStore.js';
import { LoginComponent } from './auth/LoginComponent.js';
import { CollectionsComponent } from './collections/CollectionsComponent.js';
import { CollectionDetailComponent } from './collections/CollectionDetailComponent.js';
import { SharedCollectionsComponent } from './collections/SharedCollectionsComponent.js';
import { CollectionSharingComponent } from './collections/CollectionSharingComponent.js';
import { NavbarComponent } from './common/NavbarComponent.js';

export class AppComponent extends Component {
    constructor(root) {
        super(root);
        
        // Initialize state
        this.state = {
            isAuthenticated: localStorage.getItem('token') ? true : false,
            currentRoute: null,
            activeComponent: null
        };
        
        // Initialize components
        this.navbar = null;
        this.contentContainer = null;
        
        // Bind methods
        this.handleLogin = this.handleLogin.bind(this);
        this.handleLogout = this.handleLogout.bind(this);
        this.handleRouteChange = this.handleRouteChange.bind(this);
    }
    
    onMount() {
        // Listen for route changes
        eventBus.on('router:changed', this.handleRouteChange);
        
        // Create navigation and content containers
        this.createBaseLayout();
        
        // Initialize navbar
        this.navbar = new NavbarComponent(this.element.querySelector('#navbar'));
        this.navbar.setState({
            isAuthenticated: this.state.isAuthenticated,
            onLogout: this.handleLogout
        });
        this.navbar.mount(this.element.querySelector('#navbar'));
        
        // Register routes
        this.registerRoutes();
    }
    
    createBaseLayout() {
        this.element.innerHTML = `
            <div class="app-container">
                <div id="navbar"></div>
                <div id="content" class="content-container"></div>
            </div>
        `;
        
        this.contentContainer = this.element.querySelector('#content');
    }
    
    registerRoutes() {
        const router = window.router;
        
        // Public route
        router.registerRoute('/login', () => {
            this.renderComponent(new LoginComponent(this.contentContainer), {
                onLogin: this.handleLogin
            });
        });
        
        // Protected routes
        router.registerProtectedRoute('/collections', () => {
            this.renderComponent(new CollectionsComponent(this.contentContainer));
        });
        
        router.registerProtectedRoute('/collections/:id', (params) => {
            this.renderComponent(new CollectionDetailComponent(this.contentContainer), {
                collectionId: params.id
            });
        });
        
        router.registerProtectedRoute('/collections/:id/share', (params) => {
            // First fetch the collection details
            fetch(`/api/collections/${params.id}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            })
            .then(response => {
                if (!response.ok) throw new Error('Collection not found');
                return response.json();
            })
            .then(collection => {
                // Set the current collection in the store
                appStore.setState({ currentCollection: collection });
                
                // Render the sharing component
                this.renderComponent(new CollectionSharingComponent(this.contentContainer));
            })
            .catch(error => {
                console.error('Error loading collection:', error);
                eventBus.emit('router:navigate', '/collections');
            });
        });
        
        router.registerProtectedRoute('/shared', () => {
            this.renderComponent(new SharedCollectionsComponent(this.contentContainer));
        });
        
        router.registerProtectedRoute('/shared-collections/:id', (params) => {
            this.renderComponent(new CollectionDetailComponent(this.contentContainer), {
                collectionId: params.id,
                isShared: true
            });
        });
        
        // Default route
        router.registerRoute('/', () => {
            eventBus.emit('router:navigate', '/collections');
        });
    }
    
    renderComponent(component, props = {}) {
        // Clean up previous component
        if (this.state.activeComponent) {
            this.state.activeComponent.unmount();
        }
        
        // Set component props
        if (props) {
            component.setState(props);
        }
        
        // Mount new component
        component.mount(this.contentContainer);
        
        // Update state
        this.setState({
            activeComponent: component
        });
    }
    
    handleRouteChange(data) {
        this.setState({
            currentRoute: data.path
        });
    }
    
    handleLogin(token) {
        localStorage.setItem('token', token);
        this.setState({ isAuthenticated: true });
        
        // Update navbar
        if (this.navbar) {
            this.navbar.setState({ isAuthenticated: true });
        }
        
        // Navigate to collections
        eventBus.emit('router:navigate', '/collections');
    }
    
    handleLogout() {
        localStorage.removeItem('token');
        this.setState({ isAuthenticated: false });
        
        // Update navbar
        if (this.navbar) {
            this.navbar.setState({ isAuthenticated: false });
        }
        
        // Navigate to login
        eventBus.emit('router:navigate', '/login');
    }
    
    events() {
        return {};
    }
} 