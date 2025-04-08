/**
 * State management utilities
 * Provides tools for immutable state management across the application
 */

const EventEmitter = require('events');

/**
 * StateContainer
 * A general-purpose immutable state container with version tracking
 * and efficient update mechanisms.
 * 
 * Features:
 * - Immutable state (frozen objects)
 * - Version tracking
 * - History of state changes (optional)
 * - Event emission on state changes
 * - State diffing for efficient updates
 * - Deep freezing of nested objects
 */
class StateContainer extends EventEmitter {
  /**
   * Creates a new StateContainer
   * @param {Object} options - Configuration options
   * @param {Object} [options.initialState={}] - Initial state
   * @param {number} [options.maxHistoryLength=0] - Max number of previous states to keep (0 disables history)
   * @param {boolean} [options.emitEvents=true] - Whether to emit events on state changes
   * @param {boolean} [options.deepFreeze=true] - Whether to deep freeze nested objects
   */
  constructor(options = {}) {
    super();
    
    const {
      initialState = {},
      maxHistoryLength = 0,
      emitEvents = true,
      deepFreeze = true,
    } = options;
    
    this._version = 1;
    this._emitEvents = emitEvents;
    this._shouldDeepFreeze = deepFreeze;
    this._maxHistoryLength = maxHistoryLength;
    this._history = [];
    
    // Create the initial immutable state
    this._state = this._freezeState(initialState);
  }
  
  /**
   * Helper method to deep freeze an object and all its nested objects
   * @param {Object} obj - Object to freeze
   * @returns {Object} - Frozen object
   * @private
   */
  _deepFreeze(obj) {
    // Don't try to freeze non-objects or already frozen objects
    if (typeof obj !== 'object' || obj === null || Object.isFrozen(obj)) {
      return obj;
    }
    
    // Recursively freeze all properties
    const propNames = Object.getOwnPropertyNames(obj);
    for (const name of propNames) {
      const value = obj[name];
      if (value && typeof value === 'object') {
        obj[name] = this._deepFreeze(value);
      }
    }
    
    return Object.freeze(obj);
  }
  
  /**
   * Freezes state according to configuration (deep or shallow)
   * @param {Object} state - State to freeze
   * @returns {Object} - Frozen state
   * @private
   */
  _freezeState(state) {
    if (this._shouldDeepFreeze) {
      return this._deepFreeze(state);
    }
    return Object.freeze({...state});
  }
  
  /**
   * Helper to check if objects are shallowly equal
   * @param {Object} obj1 - First object
   * @param {Object} obj2 - Second object
   * @returns {boolean} - Whether objects are shallowly equal
   * @private
   */
  _areShallowEqual(obj1, obj2) {
    if (obj1 === obj2) return true;
    if (!obj1 || !obj2) return false;
    
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    
    if (keys1.length !== keys2.length) return false;
    
    for (const key of keys1) {
      if (obj1[key] !== obj2[key]) return false;
    }
    
    return true;
  }
  
  /**
   * Gets the current state
   * @returns {Object} - Current immutable state
   */
  getState() {
    return this._state;
  }
  
  /**
   * Gets the current state version
   * @returns {number} - Current state version
   */
  getVersion() {
    return this._version;
  }
  
  /**
   * Gets the state history
   * @returns {Array<Object>} - Array of previous states (empty if history disabled)
   */
  getHistory() {
    return [...this._history];
  }
  
  /**
   * Updates the state with new values
   * @param {Object|Function} updater - Either an object to merge or a function that takes current state and returns new state
   * @param {string} [source] - Optional source identifier for event tracking
   * @returns {Object} - New immutable state
   */
  setState(updater, source = 'unknown') {
    // Handle function updaters
    const updates = typeof updater === 'function'
      ? updater(this._state)
      : updater;
    
    // Skip update if nothing changed
    if (!updates || typeof updates !== 'object') {
      return this._state;
    }
    
    // If updates is an empty object, return current state
    if (Object.keys(updates).length === 0) {
      return this._state;
    }
    
    // Check if any values would actually change
    let hasChanges = false;
    for (const key in updates) {
      if (this._state[key] !== updates[key]) {
        hasChanges = true;
        break;
      }
    }
    
    // Skip update if no values would change
    if (!hasChanges) {
      return this._state;
    }
    
    // Calculate new state
    const oldState = this._state;
    const newState = this._freezeState({...oldState, ...updates});
    
    // Add to history if enabled
    if (this._maxHistoryLength > 0) {
      this._history.push({
        state: oldState,
        version: this._version,
        timestamp: new Date()
      });
      
      // Trim history if needed
      if (this._history.length > this._maxHistoryLength) {
        this._history.shift();
      }
    }
    
    // Update state and version
    this._state = newState;
    this._version++;
    
    // Emit update event if enabled
    if (this._emitEvents) {
      const changedKeys = Object.keys(updates).filter(key => oldState[key] !== newState[key]);
      
      if (changedKeys.length > 0) {
        this.emit('stateChanged', {
          oldState,
          newState,
          changes: updates,
          changedKeys,
          version: this._version,
          source
        });
        
        // Emit individual change events for each changed property
        for (const key of changedKeys) {
          this.emit(`${key}Changed`, {
            oldValue: oldState[key],
            newValue: newState[key],
            key,
            version: this._version,
            source
          });
        }
      }
    }
    
    return newState;
  }
  
  /**
   * Resets the state to initial values
   * @param {Object} [initialState={}] - New initial state (defaults to empty object)
   * @param {string} [source] - Optional source identifier for event tracking
   * @returns {Object} - New immutable state
   */
  resetState(initialState = {}, source = 'reset') {
    // Clear history
    this._history = [];
    
    // Set new initial state and increment version
    const oldState = this._state;
    this._state = this._freezeState(initialState);
    this._version++;
    
    // Emit reset event if enabled
    if (this._emitEvents) {
      this.emit('stateReset', {
        oldState,
        newState: this._state,
        version: this._version,
        source
      });
    }
    
    return this._state;
  }
  
  /**
   * Creates a selector function that memoizes results
   * @param {Function} selectorFn - Function that takes state and returns derived data
   * @returns {Function} - Memoized selector
   */
  createSelector(selectorFn) {
    let lastVersion = -1;
    let lastArgs = null;
    let lastResult = null;
    
    return (...args) => {
      // Check if we need to recompute based on version and args
      const shouldRecompute = 
        lastVersion !== this._version || 
        !lastArgs || 
        args.length !== lastArgs.length ||
        args.some((arg, i) => arg !== lastArgs[i]);
      
      if (shouldRecompute) {
        lastResult = selectorFn(this._state, ...args);
        lastVersion = this._version;
        lastArgs = [...args];
      }
      
      return lastResult;
    };
  }
  
  /**
   * Gets a specific property from the state
   * @param {string} key - Property key
   * @param {*} [defaultValue=null] - Default value if property doesn't exist
   * @returns {*} - Property value or default
   */
  get(key, defaultValue = null) {
    return this._state[key] !== undefined ? this._state[key] : defaultValue;
  }
  
  /**
   * Updates a specific property in the state
   * @param {string} key - Property key
   * @param {*} value - New property value
   * @param {string} [source] - Optional source identifier for event tracking
   * @returns {Object} - New immutable state
   */
  set(key, value, source = 'set') {
    return this.setState({ [key]: value }, source);
  }
  
  /**
   * Updates multiple properties in the state
   * @param {Object} keyValuePairs - Object containing key-value pairs to update
   * @param {string} [source] - Optional source identifier for event tracking
   * @returns {Object} - New immutable state
   */
  setMultiple(keyValuePairs, source = 'setMultiple') {
    return this.setState(keyValuePairs, source);
  }
  
  /**
   * Removes a property from the state
   * @param {string} key - Property key to remove
   * @param {string} [source] - Optional source identifier for event tracking
   * @returns {Object} - New immutable state
   */
  remove(key, source = 'remove') {
    // Only proceed if the key exists in the state
    if (!(key in this._state)) {
      return this._state;
    }
    
    // Create a new state without the specified key
    const { [key]: _, ...rest } = this._state;
    
    // Update the state
    const oldState = this._state;
    const newState = this._freezeState(rest);
    
    // Add to history if enabled
    if (this._maxHistoryLength > 0) {
      this._history.push({
        state: oldState,
        version: this._version,
        timestamp: new Date()
      });
      
      // Trim history if needed
      if (this._history.length > this._maxHistoryLength) {
        this._history.shift();
      }
    }
    
    // Update state and version
    this._state = newState;
    this._version++;
    
    // Emit events if enabled
    if (this._emitEvents) {
      this.emit('stateChanged', {
        oldState,
        newState,
        changes: { [key]: undefined },
        changedKeys: [key],
        version: this._version,
        source
      });
      
      this.emit(`${key}Changed`, {
        oldValue: oldState[key],
        newValue: undefined,
        key,
        version: this._version,
        source
      });
    }
    
    return newState;
  }
  
  /**
   * Subscribes to state changes
   * @param {string} eventName - Event to subscribe to (stateChanged, propertyChanged, etc.)
   * @param {Function} listener - Callback function
   * @returns {Function} - Unsubscribe function
   */
  subscribe(eventName, listener) {
    this.on(eventName, listener);
    return () => this.off(eventName, listener);
  }
}

/**
 * Creates a new StateContainer with the provided options
 * @param {Object} options - Configuration options for the container
 * @returns {StateContainer} - New state container instance
 */
function createStateContainer(options = {}) {
  return new StateContainer(options);
}

module.exports = {
  StateContainer,
  createStateContainer
}; 