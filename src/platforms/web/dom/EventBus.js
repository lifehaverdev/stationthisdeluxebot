class EventBus {
    constructor() {
        this.listeners = new Map();
        this.debugMode = false;
    }

    /**
     * Enable or disable debug logging
     * @param {boolean} enabled 
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
    }

    /**
     * Subscribe to an event
     * @param {string} eventName 
     * @param {Function} callback 
     * @returns {Function} Unsubscribe function
     */
    on(eventName, callback) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, new Set());
        }
        
        this.listeners.get(eventName).add(callback);
        
        if (this.debugMode) {
            console.log(`[EventBus] Listener added for "${eventName}"`);
        }

        // Return unsubscribe function
        return () => this.off(eventName, callback);
    }

    /**
     * Remove a specific event listener
     * @param {string} eventName 
     * @param {Function} callback 
     */
    off(eventName, callback) {
        if (!this.listeners.has(eventName)) return;
        
        this.listeners.get(eventName).delete(callback);
        
        if (this.debugMode) {
            console.log(`[EventBus] Listener removed for "${eventName}"`);
        }

        // Cleanup empty event sets
        if (this.listeners.get(eventName).size === 0) {
            this.listeners.delete(eventName);
        }
    }

    /**
     * Remove all listeners for an event
     * @param {string} eventName 
     */
    removeAllListeners(eventName) {
        if (eventName) {
            this.listeners.delete(eventName);
            if (this.debugMode) {
                console.log(`[EventBus] All listeners removed for "${eventName}"`);
            }
        } else {
            this.listeners.clear();
            if (this.debugMode) {
                console.log('[EventBus] All listeners removed');
            }
        }
    }

    /**
     * Emit an event with data
     * @param {string} eventName 
     * @param {any} data 
     */
    emit(eventName, data) {
        console.log(`[DEBUG-EventBus] Emitting event "${eventName}"`, data);
        if (!this.listeners.has(eventName)) {
            console.log(`[DEBUG-EventBus] No listeners found for "${eventName}"`);
            return;
        }

        console.log(`[DEBUG-EventBus] Found ${this.listeners.get(eventName).size} listener(s) for "${eventName}"`);
        if (this.debugMode) {
            console.log(`[EventBus] Emitting "${eventName}"`, data);
        }

        this.listeners.get(eventName).forEach(callback => {
            try {
                console.log(`[DEBUG-EventBus] Executing listener callback for "${eventName}"`);
                callback(data);
                console.log(`[DEBUG-EventBus] Listener callback completed for "${eventName}"`);
            } catch (error) {
                console.error(`[DEBUG-EventBus] Error in listener for "${eventName}":`, error);
            }
        });
    }

    /**
     * Subscribe to an event for one-time use
     * @param {string} eventName 
     * @param {Function} callback 
     * @returns {Function} Unsubscribe function
     */
    once(eventName, callback) {
        console.log(`[DEBUG-EventBus] Registering once listener for "${eventName}"`);
        // Create a wrapper that will call the callback and then unsubscribe
        const wrappedCallback = (data) => {
            console.log(`[DEBUG-EventBus] Executing once callback for "${eventName}"`);
            // Unsubscribe first to prevent issues if the callback triggers the same event
            this.off(eventName, wrappedCallback);
            console.log(`[DEBUG-EventBus] Unsubscribed once callback for "${eventName}"`);
            // Call the original callback
            try {
                callback(data);
                console.log(`[DEBUG-EventBus] Once callback completed for "${eventName}"`);
            } catch (error) {
                console.error(`[DEBUG-EventBus] Error in once callback for "${eventName}":`, error);
            }
        };
        
        // Register the wrapped callback
        const unsubscribe = this.on(eventName, wrappedCallback);
        console.log(`[DEBUG-EventBus] Registered once listener for "${eventName}"`);
        return unsubscribe;
    }
}

// Create a single instance for the application
export const eventBus = new EventBus(); 