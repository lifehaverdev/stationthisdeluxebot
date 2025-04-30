import { eventBus } from './EventBus.js';

export class Router {
    constructor() {
        this.routes = new Map();
        this.currentRoute = null;
        this.defaultRoute = '/collections';
        
        // Bind methods
        this.handlePopState = this.handlePopState.bind(this);
        this.navigateTo = this.navigateTo.bind(this);
    }
    
    /**
     * Initialize the router
     */
    init() {
        // Listen for navigation events
        window.addEventListener('popstate', this.handlePopState);
        
        // Setup click delegation for navigation links
        document.addEventListener('click', (e) => {
            // Find closest anchor tag
            const anchor = e.target.closest('a');
            if (!anchor) return;
            
            // Check if it's an internal link (no external attribute and same origin)
            const isExternal = anchor.getAttribute('external') !== null;
            const isSameOrigin = anchor.href.startsWith(window.location.origin);
            
            if (!isExternal && isSameOrigin) {
                e.preventDefault();
                this.navigateTo(anchor.pathname);
            }
        });
        
        // Register route change events with the event bus
        eventBus.on('router:navigate', this.navigateTo);
        
        // Initialize with current URL
        this.handleInitialRoute();
    }
    
    /**
     * Register a route handler
     * @param {string} path - The route path
     * @param {Function} handler - The route handler function
     */
    registerRoute(path, handler) {
        this.routes.set(path, handler);
    }
    
    /**
     * Set the default route
     * @param {string} path - The default route path
     */
    setDefaultRoute(path) {
        this.defaultRoute = path;
    }
    
    /**
     * Handle the initial route on page load
     */
    handleInitialRoute() {
        const path = window.location.pathname;
        
        if (this.routes.has(path)) {
            this.handleRoute(path);
        } else {
            // Redirect to default route if no match
            this.navigateTo(this.defaultRoute);
        }
    }
    
    /**
     * Handle popstate events (browser back/forward)
     * @param {Event} event - The popstate event
     */
    handlePopState(event) {
        const path = window.location.pathname;
        this.handleRoute(path);
    }
    
    /**
     * Navigate to a specific route
     * @param {string} path - The route path to navigate to
     */
    navigateTo(path) {
        // Update browser history
        window.history.pushState({}, '', path);
        
        // Handle the route
        this.handleRoute(path);
    }
    
    /**
     * Handle a route change
     * @param {string} path - The route path to handle
     */
    handleRoute(path) {
        // Skip if same route
        if (this.currentRoute === path) return;
        
        console.log(`[Router] Navigating to: ${path}`);
        
        // Find the route handler
        const handler = this.routes.get(path);
        
        if (handler) {
            // Execute route handler
            handler();
            this.currentRoute = path;
            
            // Emit route change event
            eventBus.emit('router:changed', { path });
        } else {
            console.warn(`[Router] No handler for route: ${path}`);
            
            // Redirect to default route if no handler found
            if (path !== this.defaultRoute) {
                this.navigateTo(this.defaultRoute);
            }
        }
    }
    
    /**
     * Check if user is authenticated
     * @returns {boolean} - Whether the user is authenticated
     */
    isAuthenticated() {
        return localStorage.getItem('token') !== null;
    }
    
    /**
     * Register a protected route that requires authentication
     * @param {string} path - The route path
     * @param {Function} handler - The route handler function
     */
    registerProtectedRoute(path, handler) {
        this.routes.set(path, () => {
            if (this.isAuthenticated()) {
                handler();
            } else {
                this.navigateTo('/login');
            }
        });
    }
} 