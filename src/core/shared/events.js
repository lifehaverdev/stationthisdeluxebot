/**
 * Event Bus System
 * A minimal implementation of an event bus for broadcasting events between services
 * Allows for loose coupling between components through a publish-subscribe pattern
 */

class EventBus {
  constructor() {
    this.listeners = {};
  }

  /**
   * Subscribe to an event with a callback function
   * @param {string} event - The event name to subscribe to
   * @param {Function} callback - The function to call when the event is published
   * @returns {Function} - Unsubscribe function
   */
  subscribe(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    
    this.listeners[event].push(callback);
    
    // Return unsubscribe function
    return () => {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
      if (this.listeners[event].length === 0) {
        delete this.listeners[event];
      }
    };
  }

  /**
   * Publish an event with optional data
   * @param {string} event - The event name to publish
   * @param {*} data - The data to pass to subscribers
   */
  publish(event, data) {
    if (!this.listeners[event]) {
      return;
    }
    
    this.listeners[event].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event listener for '${event}':`, error);
      }
    });
  }

  /**
   * Get all active event names with subscribers
   * @returns {Array<string>} - Array of event names
   */
  getActiveEvents() {
    return Object.keys(this.listeners);
  }

  /**
   * Clear all listeners for a specific event
   * @param {string} event - Event name to clear
   */
  clearEvent(event) {
    delete this.listeners[event];
  }

  /**
   * Clear all events and listeners
   */
  clearAll() {
    this.listeners = {};
  }
}

// Create a singleton instance
const eventBus = new EventBus();

module.exports = eventBus; 