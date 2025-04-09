/**
 * UIComponent Interface
 * 
 * Base interface for all platform-agnostic UI components.
 * This provides the contract that all UI components must fulfill
 * regardless of the platform they'll be rendered on.
 */

/**
 * @interface UIComponent
 * @description Base interface for all UI components
 */
class UIComponent {
  /**
   * Creates a new UI component
   * @param {Object} props - Component properties
   */
  constructor(props = {}) {
    this.type = 'base';
    // Extract id and metadata from props
    const { id, metadata, ...otherProps } = props;
    this.props = otherProps;
    this.id = id || `ui-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.metadata = metadata || {};
  }

  /**
   * Gets a serializable representation of the component
   * @returns {Object} Component data for serialization
   */
  toJSON() {
    return {
      type: this.type,
      id: this.id,
      props: this.props,
      metadata: this.metadata
    };
  }

  /**
   * Validate the component properties
   * @returns {boolean} True if valid, false otherwise
   */
  validate() {
    // Base validation - override in subclasses
    return true;
  }

  /**
   * Update component properties
   * @param {Object} props - New properties to merge
   * @returns {UIComponent} Updated component
   */
  update(props) {
    this.props = { ...this.props, ...props };
    return this;
  }
}

module.exports = UIComponent; 