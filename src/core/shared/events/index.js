/**
 * Event Bus Module
 * 
 * Provides a simple event bus for emitting and subscribing to events.
 * Used for system-wide communication between components.
 * 
 * @module core/shared/events
 */

class EventBus {
  constructor() {
    this.subscribers = new Map();
  }

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} callback - Event handler
   * @returns {Function} Function to unsubscribe
   */
  subscribe(event, callback) {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, new Set());
    }
    
    this.subscribers.get(event).add(callback);
    
    // Return unsubscribe function
    return () => {
      this.subscribers.get(event)?.delete(callback);
      
      // Clean up if no more subscribers
      if (this.subscribers.get(event)?.size === 0) {
        this.subscribers.delete(event);
      }
    };
  }

  /**
   * Publish an event
   * @param {string} event - Event name
   * @param {any} data - Event data
   */
  publish(event, data) {
    if (!this.subscribers.has(event)) {
      return;
    }
    
    this.subscribers.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event handler for '${event}':`, error);
      }
    });
  }

  /**
   * Unsubscribe all callbacks for an event
   * @param {string} event - Event name
   */
  unsubscribeAll(event) {
    if (this.subscribers.has(event)) {
      this.subscribers.delete(event);
    }
  }

  /**
   * Get subscription count for an event
   * @param {string} event - Event name
   * @returns {number} Number of subscribers
   */
  getSubscriberCount(event) {
    return this.subscribers.get(event)?.size || 0;
  }
}

// Create default singleton
const defaultEventBus = new EventBus();

module.exports = {
  EventBus,
  default: defaultEventBus
}; 