/**
 * UIRenderer Interface
 * 
 * Base interface for platform-specific UI renderers.
 * Each platform (Telegram, Web, API, etc.) must implement
 * this interface to render UI components.
 */

/**
 * @interface UIRenderer
 * @description Base interface for platform-specific UI renderers
 */
class UIRenderer {
  /**
   * Creates a new UI renderer
   * @param {Object} options - Renderer options
   */
  constructor(options = {}) {
    this.options = options;
    this.platform = 'generic';
  }

  /**
   * Render a UI component
   * @param {UIComponent} component - The component to render
   * @param {Object} context - Context information (user, session, etc.)
   * @returns {Promise<Object>} Rendering result
   * @abstract
   */
  async render(component, context) {
    throw new Error('Method "render" must be implemented by subclasses');
  }

  /**
   * Update a previously rendered component
   * @param {UIComponent} component - The updated component
   * @param {Object} renderReference - Reference to the original rendered component
   * @param {Object} context - Context information (user, session, etc.)
   * @returns {Promise<Object>} Update result
   * @abstract
   */
  async update(component, renderReference, context) {
    throw new Error('Method "update" must be implemented by subclasses');
  }

  /**
   * Process user input for a component
   * @param {Object} input - Platform-specific input data
   * @param {UIComponent} component - The component that received input
   * @param {Object} context - Context information (user, session, etc.)
   * @returns {Promise<Object>} Processing result
   * @abstract
   */
  async processInput(input, component, context) {
    throw new Error('Method "processInput" must be implemented by subclasses');
  }
  
  /**
   * Remove/hide a rendered component
   * @param {Object} renderReference - Reference to the rendered component
   * @param {Object} context - Context information
   * @returns {Promise<boolean>} Success indicator
   * @abstract
   */
  async remove(renderReference, context) {
    throw new Error('Method "remove" must be implemented by subclasses');
  }
  
  /**
   * Checks if this renderer can handle the specified component type
   * @param {string} componentType - The type of component
   * @returns {boolean} True if supported, false otherwise
   */
  supportsComponentType(componentType) {
    return false; // Base implementation doesn't support any components
  }
}

module.exports = UIRenderer; 