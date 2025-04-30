// EventBus for component communication
// Implements a pub/sub pattern for decoupled event-based messaging

class EventBusClass {
  constructor() {
    this.subscribers = {};
    this.debug = false;
  }
  
  /**
   * Subscribe to an event
   * @param {string} event - The event name
   * @param {function} callback - The callback function
   * @param {boolean} once - Whether to remove the subscription after first invocation
   * @returns {function} - Unsubscribe function
   */
  subscribe(event, callback, once = false) {
    if (!this.subscribers[event]) {
      this.subscribers[event] = [];
    }
    
    const subscription = { callback, once };
    this.subscribers[event].push(subscription);
    
    // Return unsubscribe function
    return () => {
      this.unsubscribe(event, callback);
    };
  }
  
  /**
   * Subscribe to an event once
   * @param {string} event - The event name
   * @param {function} callback - The callback function
   * @returns {function} - Unsubscribe function
   */
  subscribeOnce(event, callback) {
    return this.subscribe(event, callback, true);
  }
  
  /**
   * Unsubscribe from an event
   * @param {string} event - The event name
   * @param {function} callback - The callback function
   */
  unsubscribe(event, callback) {
    if (!this.subscribers[event]) return;
    
    this.subscribers[event] = this.subscribers[event].filter(
      subscription => subscription.callback !== callback
    );
  }
  
  /**
   * Publish an event
   * @param {string} event - The event name
   * @param {any} data - The event data
   */
  publish(event, data) {
    if (this.debug) {
      console.log(`%c[EventBus] ${event}`, 'color: blue; font-weight: bold;', data);
    }
    
    if (!this.subscribers[event]) return;
    
    // Create a copy of the subscribers array to avoid issues if callbacks modify subscribers
    const subscribersCopy = [...this.subscribers[event]];
    
    // Call each callback
    subscribersCopy.forEach(subscription => {
      try {
        subscription.callback(data);
      } catch (error) {
        console.error(`Error in event handler for "${event}":`, error);
      }
    });
    
    // Remove subscribers marked as once
    this.subscribers[event] = this.subscribers[event].filter(
      subscription => !subscription.once
    );
  }
  
  /**
   * Enable or disable debug mode
   * @param {boolean} enabled - Whether to enable debug mode
   */
  setDebug(enabled) {
    this.debug = enabled;
  }
  
  /**
   * Clear all subscribers for an event or all events
   * @param {string} event - The event name (optional, clears all if not provided)
   */
  clear(event) {
    if (event) {
      this.subscribers[event] = [];
    } else {
      this.subscribers = {};
    }
  }
}

// Create a singleton instance
export const EventBus = new EventBusClass(); 