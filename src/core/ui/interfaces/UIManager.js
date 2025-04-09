/**
 * UIManager
 * 
 * Manages UI components and platform-specific renderers.
 * Acts as a central registry and orchestrator for UI operations.
 */

const { AppError } = require('../../shared/errors');

/**
 * @class UIManager
 * @description Central manager for UI components and renderers
 */
class UIManager {
  /**
   * Creates a new UI manager
   * @param {Object} options - Manager options
   */
  constructor(options = {}) {
    this.options = options;
    this.renderers = new Map();
    this.componentRegistry = new Map();
    this.renderCache = new Map();
    this.defaultRenderer = null;
  }

  /**
   * Register a UI renderer for a specific platform
   * @param {string} platform - Platform identifier
   * @param {UIRenderer} renderer - The renderer implementation
   * @param {boolean} isDefault - Whether this is the default renderer
   * @returns {UIManager} The manager instance for chaining
   */
  registerRenderer(platform, renderer, isDefault = false) {
    this.renderers.set(platform, renderer);
    
    if (isDefault || this.renderers.size === 1) {
      this.defaultRenderer = renderer;
    }
    
    return this;
  }

  /**
   * Register a component type
   * @param {string} componentType - Type identifier for the component
   * @param {Function} componentClass - The component class constructor
   * @returns {UIManager} The manager instance for chaining
   */
  registerComponent(componentType, componentClass) {
    this.componentRegistry.set(componentType, componentClass);
    return this;
  }

  /**
   * Get a renderer for a specific platform
   * @param {string} platform - Platform identifier
   * @returns {UIRenderer} The renderer for the platform
   * @throws {AppError} If no renderer is found for the platform
   */
  getRenderer(platform) {
    const renderer = this.renderers.get(platform) || this.defaultRenderer;
    
    if (!renderer) {
      throw new AppError(`No renderer found for platform: ${platform}`, {
        code: 'RENDERER_NOT_FOUND',
        statusCode: 500
      });
    }
    
    return renderer;
  }

  /**
   * Create a new component instance
   * @param {string} componentType - Type of component to create
   * @param {Object} props - Component properties
   * @returns {UIComponent} The created component
   * @throws {AppError} If the component type is not registered
   */
  createComponent(componentType, props = {}) {
    const ComponentClass = this.componentRegistry.get(componentType);
    
    if (!ComponentClass) {
      throw new AppError(`Component type not registered: ${componentType}`, {
        code: 'COMPONENT_TYPE_NOT_FOUND',
        statusCode: 500
      });
    }
    
    return new ComponentClass(props);
  }

  /**
   * Render a component on a specific platform
   * @param {UIComponent|string} component - Component or component type to render
   * @param {Object} props - Component properties (if string type provided)
   * @param {string} platform - Target platform
   * @param {Object} context - Rendering context
   * @returns {Promise<Object>} Rendering result
   */
  async render(component, props = {}, platform, context = {}) {
    // If component is a string, create the component
    if (typeof component === 'string') {
      component = this.createComponent(component, props);
    }
    
    // Validate the component
    if (!component.validate()) {
      throw new AppError('Invalid component configuration', {
        code: 'INVALID_COMPONENT',
        statusCode: 400,
        details: { component: component.toJSON() }
      });
    }
    
    // Get the appropriate renderer
    const renderer = this.getRenderer(platform);
    
    // Check if the renderer supports this component type
    if (!renderer.supportsComponentType(component.type)) {
      throw new AppError(`Renderer for platform '${platform}' does not support component type: ${component.type}`, {
        code: 'UNSUPPORTED_COMPONENT_TYPE',
        statusCode: 400
      });
    }
    
    // Render the component
    const result = await renderer.render(component, context);
    
    // Cache the render result
    this.renderCache.set(component.id, {
      component,
      platform,
      renderReference: result,
      context
    });
    
    return result;
  }

  /**
   * Update a previously rendered component
   * @param {string} componentId - ID of the component to update
   * @param {Object} props - New properties to apply
   * @returns {Promise<Object>} Update result
   * @throws {AppError} If the component is not found in the cache
   */
  async update(componentId, props = {}) {
    const cached = this.renderCache.get(componentId);
    
    if (!cached) {
      throw new AppError(`Component not found in render cache: ${componentId}`, {
        code: 'COMPONENT_NOT_RENDERED',
        statusCode: 404
      });
    }
    
    // Update the component
    cached.component.update(props);
    
    // Validate the updated component
    if (!cached.component.validate()) {
      throw new AppError('Invalid component configuration after update', {
        code: 'INVALID_COMPONENT',
        statusCode: 400,
        details: { component: cached.component.toJSON() }
      });
    }
    
    // Get the renderer
    const renderer = this.getRenderer(cached.platform);
    
    // Update the rendered component
    const result = await renderer.update(
      cached.component,
      cached.renderReference,
      cached.context
    );
    
    // Update the cache
    cached.renderReference = result;
    
    return result;
  }

  /**
   * Process input for a rendered component
   * @param {string} componentId - ID of the component
   * @param {Object} input - Input data from the platform
   * @param {Object} context - Additional context
   * @returns {Promise<Object>} Processing result
   * @throws {AppError} If the component is not found in the cache
   */
  async processInput(componentId, input, context = {}) {
    const cached = this.renderCache.get(componentId);
    
    if (!cached) {
      throw new AppError(`Component not found in render cache: ${componentId}`, {
        code: 'COMPONENT_NOT_RENDERED',
        statusCode: 404
      });
    }
    
    // Merge contexts
    const mergedContext = { ...cached.context, ...context };
    
    // Get the renderer
    const renderer = this.getRenderer(cached.platform);
    
    // Process the input
    return renderer.processInput(
      input,
      cached.component,
      mergedContext
    );
  }

  /**
   * Remove a rendered component
   * @param {string} componentId - ID of the component to remove
   * @returns {Promise<boolean>} Success indicator
   * @throws {AppError} If the component is not found in the cache
   */
  async remove(componentId) {
    const cached = this.renderCache.get(componentId);
    
    if (!cached) {
      throw new AppError(`Component not found in render cache: ${componentId}`, {
        code: 'COMPONENT_NOT_RENDERED',
        statusCode: 404
      });
    }
    
    // Get the renderer
    const renderer = this.getRenderer(cached.platform);
    
    // Remove the component
    const result = await renderer.remove(
      cached.renderReference,
      cached.context
    );
    
    // Remove from cache if successful
    if (result) {
      this.renderCache.delete(componentId);
    }
    
    return result;
  }
}

module.exports = UIManager; 