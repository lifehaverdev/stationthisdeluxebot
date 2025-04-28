/**
 * EventBus
 * 
 * Simple event bus implementation for publishing and subscribing to events.
 * Supports wildcard subscriptions and typed events.
 */

class EventBus {
  constructor() {
    this.listeners = new Map();
    this.wildcardListeners = [];
  }

  /**
   * Subscribe to an event
   * @param {string} eventName - Name of the event to subscribe to
   * @param {Function} listener - Listener function
   * @returns {Function} - Unsubscribe function
   */
  subscribe(eventName, listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }

    // Handle wildcard listeners
    if (eventName === '*') {
      this.wildcardListeners.push(listener);
      return () => {
        const index = this.wildcardListeners.indexOf(listener);
        if (index !== -1) {
          this.wildcardListeners.splice(index, 1);
        }
      };
    }

    // Create array for this event if it doesn't exist
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }

    // Add listener
    this.listeners.get(eventName).push(listener);

    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(eventName);
      if (!listeners) return;

      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
        
        // Clean up empty listener arrays
        if (listeners.length === 0) {
          this.listeners.delete(eventName);
        }
      }
    };
  }

  /**
   * Subscribe to an event once
   * @param {string} eventName - Name of the event to subscribe to
   * @param {Function} listener - Listener function
   * @returns {Function} - Unsubscribe function
   */
  once(eventName, listener) {
    const unsubscribe = this.subscribe(eventName, (...args) => {
      unsubscribe(); // Unsubscribe immediately
      listener(...args);
    });
    
    return unsubscribe;
  }

  /**
   * Publish an event
   * @param {string} eventName - Name of the event to publish
   * @param {Object} eventData - Event data
   * @returns {boolean} - Whether anyone was listening
   */
  publish(eventName, eventData = {}) {
    const timestamp = Date.now();
    const event = {
      type: eventName,
      timestamp,
      data: eventData
    };

    let listenersCount = 0;

    // Notify specific listeners
    const listeners = this.listeners.get(eventName);
    if (listeners && listeners.length > 0) {
      listenersCount += listeners.length;
      
      // Use a copy of the listeners array in case a listener unsubscribes during execution
      [...listeners].forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in event listener for ${eventName}:`, error);
        }
      });
    }

    // Notify wildcard listeners
    if (this.wildcardListeners.length > 0) {
      listenersCount += this.wildcardListeners.length;
      
      // Use a copy of the listeners array in case a listener unsubscribes during execution
      [...this.wildcardListeners].forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in wildcard event listener for ${eventName}:`, error);
        }
      });
    }

    return listenersCount > 0;
  }

  /**
   * Check if an event has listeners
   * @param {string} eventName - Name of the event to check
   * @returns {boolean} - Whether the event has listeners
   */
  hasListeners(eventName) {
    return (
      (this.listeners.has(eventName) && this.listeners.get(eventName).length > 0) ||
      this.wildcardListeners.length > 0
    );
  }

  /**
   * Remove all listeners
   * @param {string} [eventName] - Optional event name to remove listeners for
   */
  removeAllListeners(eventName) {
    if (eventName) {
      // Remove listeners for a specific event
      this.listeners.delete(eventName);
    } else {
      // Remove all listeners
      this.listeners.clear();
      this.wildcardListeners = [];
    }
  }

  /**
   * Get all event names with listeners
   * @returns {Array<string>} - Array of event names
   */
  eventNames() {
    return Array.from(this.listeners.keys());
  }

  /**
   * Alias for subscribe
   */
  on(eventName, listener) {
    return this.subscribe(eventName, listener);
  }

  /**
   * Alias for once
   */
  one(eventName, listener) {
    return this.once(eventName, listener);
  }

  /**
   * Alias for publish
   */
  emit(eventName, eventData) {
    return this.publish(eventName, eventData);
  }
}

// Create a singleton instance
const defaultEventBus = new EventBus();

module.exports = {
  EventBus,
  default: defaultEventBus
}; 