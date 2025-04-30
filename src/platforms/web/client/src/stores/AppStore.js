import Store from '../../../../web/dom/Store.js';

// Define validators
const validators = {
    isAuthenticated: (value) => typeof value === 'boolean',
    token: (value) => value === null || typeof value === 'string',
    collections: (value) => Array.isArray(value),
    sharedCollections: (value) => Array.isArray(value),
    currentCollection: (value) => value === null || typeof value === 'object',
    isLoading: (value) => typeof value === 'boolean',
    error: (value) => value === null || typeof value === 'string' || value instanceof Error
};

// Initialize store with default values
const initialState = {
    isAuthenticated: localStorage.getItem('token') !== null,
    token: localStorage.getItem('token'),
    collections: [],
    sharedCollections: [],
    currentCollection: null,
    isLoading: false,
    error: null
};

// Create and export app store
export const appStore = new Store(initialState, validators);

// Enable debug in development
if (process.env.NODE_ENV === 'development') {
    appStore.setDebug(true);
}

// Helper methods for common state updates
export const storeActions = {
    // Authentication actions
    login(token) {
        localStorage.setItem('token', token);
        appStore.setState({
            isAuthenticated: true,
            token
        });
    },
    
    logout() {
        localStorage.removeItem('token');
        appStore.setState({
            isAuthenticated: false,
            token: null,
            collections: [],
            sharedCollections: [],
            currentCollection: null
        });
    },
    
    // Collections actions
    setCollections(collections) {
        appStore.setState({ collections });
    },
    
    setSharedCollections(sharedCollections) {
        appStore.setState({ sharedCollections });
    },
    
    setCurrentCollection(collection) {
        appStore.setState({ currentCollection: collection });
    },
    
    // UI state actions
    setLoading(isLoading) {
        appStore.setState({ isLoading });
    },
    
    setError(error) {
        appStore.setState({ error });
    },
    
    clearError() {
        appStore.setState({ error: null });
    }
}; 