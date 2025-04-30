// Base Component class for all UI components
// Provides common functionality for rendering and lifecycle management

export class Component {
  constructor(parentElement) {
    this.parentElement = parentElement;
    this.element = null;
  }
  
  /**
   * Returns the HTML template for the component
   * Must be implemented by child classes
   */
  template() {
    throw new Error('Components must implement template method');
  }
  
  /**
   * Renders the component and updates the DOM
   */
  render() {
    const template = this.template();
    
    if (!this.element) {
      // Create a new DOM element for the component
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = template.trim();
      this.element = tempDiv.firstChild;
    } else {
      // Update the existing element
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = template.trim();
      
      const newElement = tempDiv.firstChild;
      this.element.parentNode.replaceChild(newElement, this.element);
      this.element = newElement;
    }
    
    return this.element;
  }
  
  /**
   * Appends the component to its parent element
   */
  appendToParent() {
    if (!this.parentElement) {
      throw new Error('Cannot append component: No parent element specified');
    }
    
    // Render the component if it hasn't been rendered yet
    if (!this.element) {
      this.render();
    }
    
    // Append to parent
    this.parentElement.appendChild(this.element);
    
    return this;
  }
  
  /**
   * Safely removes the component from the DOM
   */
  remove() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
  
  /**
   * Creates a child component and appends it to the specified selector
   */
  createChild(ComponentClass, selector, options = {}) {
    const targetElement = selector ? this.element.querySelector(selector) : this.element;
    if (!targetElement) {
      throw new Error(`Cannot create child component: Target element "${selector}" not found`);
    }
    
    return new ComponentClass(targetElement, options);
  }
} 