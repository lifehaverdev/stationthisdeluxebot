//import { eventBus } from './EventBus.js';

export class Component {
    constructor(rootElement) {
        this.element = rootElement;
        this.state = {};
        this.mounted = false;
        this.boundEvents = new Map();
    }

    /**
     * Initialize state with default values
     * @param {Object} initialState 
     */
    setState(newState) {
        const oldState = {...this.state};
        this.state = { ...this.state, ...newState };
        
        // Only update if we should based on state changes
        if (this.shouldUpdate(oldState, this.state)) {
            this.update();
            this.onStateUpdate(oldState, this.state);
        }
    }

    /**
     * Determines if the component should update based on state changes
     * Override in child classes for custom comparison logic
     * @param {Object} oldState - Previous state
     * @param {Object} newState - New state 
     * @returns {boolean} - Whether component should update
     */
    shouldUpdate(oldState, newState) {
        // Default shallow comparison of top-level state properties
        // Check if any properties have changed
        if (!oldState || !newState) return true;
        
        // Check if object references are the same
        if (oldState === newState) return false;
        
        // Do a shallow comparison of properties
        const oldKeys = Object.keys(oldState);
        const newKeys = Object.keys(newState);
        
        // If they have different number of keys, they changed
        if (oldKeys.length !== newKeys.length) return true;
        
        // Check if any key's value has changed
        return oldKeys.some(key => oldState[key] !== newState[key]);
    }
    
    /**
     * Lifecycle hook called after state is updated but before rendering
     * Override in child classes to handle state updates
     * @param {Object} oldState 
     * @param {Object} newState 
     */
    onStateUpdate(oldState, newState) {
        // Default implementation does nothing
    }

    /**
     * Mount component to DOM
     * @param {HTMLElement} container 
     */
    mount(element) {
        this.element = element;
        
        // Apply styles if they exist
        if (this.constructor.styles) {
            const styleElement = document.createElement('style');
            styleElement.textContent = this.constructor.styles;
            document.head.appendChild(styleElement);
            this.styleElement = styleElement;
        }

        this.update();
        if (this.onMount) {
            this.onMount();
        }
    }

    /**
     * Remove component from DOM
     */
    unmount() {
        if (!this.mounted) return;

        // Unbind all events
        this.unbindEvents();
        
        // Remove styles if they exist
        if (this.styleElement) {
            this.styleElement.remove();
        }
        
        // Remove element
        this.element.remove();
        this.element = null;
        
        // Call lifecycle method
        this.mounted = false;
        this.onUnmount();
    }

    /**
     * Bind DOM events based on this.events()
     */
    bindEvents() {
        // First unbind any existing events
        this.unbindEvents();
        
        const events = this.events();
        if (!events) return;

        for (const [eventSelector, handler] of Object.entries(events)) {
            const [eventName, selector] = eventSelector.split(' ');
            const boundHandler = handler.bind(this);
            
            if (selector) {
                // Delegated event
                const eventHandler = (e) => {
                    if (e.target.matches(selector)) {
                        boundHandler(e);
                    }
                };
                this.element.addEventListener(eventName, eventHandler);
                this.boundEvents.set(eventSelector, eventHandler);
            } else {
                // Direct event
                this.element.addEventListener(eventName, boundHandler);
                this.boundEvents.set(eventSelector, boundHandler);
            }
        }
    }

    /**
     * Unbind all DOM events
     */
    unbindEvents() {
        for (const [eventSelector, handler] of this.boundEvents.entries()) {
            const [eventName] = eventSelector.split(' ');
            this.element.removeEventListener(eventName, handler);
        }
        this.boundEvents.clear();
    }

    /**
     * Update component after state change
     */
    update() {
        if (!this.element) return;
        
        // Get new content
        const newContent = this.render();
        
        // Always update on first render or when content changes
        // First render is detected by checking if innerHTML is empty
        if (!this.element.innerHTML || this.element.innerHTML !== newContent) {
            this.element.innerHTML = newContent;
            
            // Re-attach event listeners after DOM update
            if (this.setupDOMEventListeners) {
                this.setupDOMEventListeners();
            }
        }
    }

    // Lifecycle methods (to be overridden by child classes)
    onMount() {}
    onUnmount() {}
    onUpdate(oldState) {}

    // Methods to be implemented by child classes
    render() {
        return this.template ? this.template() : '';
    }

    events() {
        return {};
    }
} 