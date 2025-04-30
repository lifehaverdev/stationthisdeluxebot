class Store {
    constructor(initialState = {}, validators = {}) {
        this.state = initialState;
        this.validators = validators;
        this.subscribers = new Set();
        this.debug = false;
    }

    // Enable/disable debug logging
    setDebug(enabled) {
        this.debug = enabled;
        this.log('Debug logging ' + (enabled ? 'enabled' : 'disabled'));
    }

    // Subscribe to state changes
    subscribe(callback) {
        if (typeof callback !== 'function') {
            throw new Error('Subscriber must be a function');
        }
        this.subscribers.add(callback);
        this.log(`New subscriber added. Total subscribers: ${this.subscribers.size}`);
        return () => this.unsubscribe(callback);
    }

    // Unsubscribe from state changes
    unsubscribe(callback) {
        this.subscribers.delete(callback);
        this.log(`Subscriber removed. Total subscribers: ${this.subscribers.size}`);
    }

    // Get current state
    getState() {
        return { ...this.state };
    }

    // Update state
    setState(updates) {
        // Create new state object
        const newState = { ...this.state, ...updates };

        // Validate state changes
        for (const [key, value] of Object.entries(updates)) {
            if (this.validators[key]) {
                const isValid = this.validators[key](value, newState);
                if (!isValid) {
                    this.log(`Validation failed for key: ${key}`, 'error');
                    throw new Error(`Invalid value for ${key}`);
                }
            }
        }

        // Update state atomically
        this.state = newState;
        this.log('State updated:', updates);

        // Notify subscribers
        this.notifySubscribers();
    }

    // Private method to notify subscribers
    notifySubscribers() {
        const state = this.getState();
        this.subscribers.forEach(callback => {
            try {
                callback(state);
            } catch (error) {
                this.log(`Error in subscriber: ${error.message}`, 'error');
            }
        });
    }

    // Private method for debug logging
    log(message, level = 'info') {
        if (!this.debug) return;
        const timestamp = new Date().toISOString();
        console[level](`[Store ${timestamp}]`, message);
    }
}

// Example usage:
const exampleUsage = () => {
    // Create validators
    const validators = {
        age: (value) => typeof value === 'number' && value >= 0,
        email: (value) => typeof value === 'string' && value.includes('@')
    };

    // Initialize store with validators
    const store = new Store({ name: 'John', age: 25 }, validators);
    
    // Enable debug logging
    store.setDebug(true);

    // Subscribe to changes
    const unsubscribe = store.subscribe((state) => {
        console.log('State changed:', state);
    });

    // Update state
    store.setState({ age: 26 }); // Valid update
    try {
        store.setState({ age: -1 }); // Will throw validation error
    } catch (error) {
        console.error('Validation error:', error.message);
    }

    // Unsubscribe
    unsubscribe();
};

export default Store; 