/**
 * Event Bus
 * Simple event handling system for cross-module communication
 */

class EventBus {
  constructor() {
    this.events = {};
  }

  /**
   * Subscribe to an event
   * @param {string} event - Name of the event to subscribe to
   * @param {Function} callback - Function to call when event occurs
   * @returns {Function} - Unsubscribe function
   */
  subscribe(event, callback) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    
    this.events[event].push(callback);
    
    return () => this.unsubscribe(event, callback);
  }

  /**
   * Unsubscribe from an event
   * @param {string} event - Name of the event to unsubscribe from
   * @param {Function} callback - Function to unsubscribe
   */
  unsubscribe(event, callback) {
    if (!this.events[event]) {
      return;
    }
    
    this.events[event] = this.events[event].filter(cb => cb !== callback);
  }

  /**
   * Publish an event
   * @param {string} event - Name of the event to publish
   * @param {*} data - Data to pass to event subscribers
   */
  publish(event, data) {
    if (!this.events[event]) {
      return;
    }
    
    this.events[event].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    });
  }

  /**
   * Remove all subscribers for an event
   * @param {string} event - Name of the event to clear
   */
  clear(event) {
    if (event) {
      delete this.events[event];
    } else {
      this.events = {};
    }
  }
}

// Create a singleton instance
const eventBus = new EventBus();

// For backward compatibility
module.exports = eventBus;
module.exports.events = eventBus;
module.exports.default = eventBus; 