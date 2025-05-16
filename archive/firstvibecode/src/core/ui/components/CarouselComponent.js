const UIComponent = require('../interfaces/UIComponent');
const validator = require('../../validation/validator');

/**
 * CarouselComponent
 * 
 * A component that displays a horizontally scrollable list of items.
 * Each item can contain any supported UI component.
 */
class CarouselComponent extends UIComponent {
  /**
   * Creates a new carousel component
   * @param {Object} props - Component properties
   * @param {Array} props.items - Array of components to display in the carousel
   * @param {string} [props.title] - Optional title for the carousel
   * @param {Object} [props.style] - Optional style customizations
   * @param {number} [props.activeIndex=0] - Initial active item index
   * @param {boolean} [props.loop=false] - Whether the carousel should loop when reaching the end
   * @param {boolean} [props.showIndicators=true] - Whether to show navigation indicators
   */
  constructor(props = {}) {
    super(props);
    this.type = 'carousel';
    
    this.items = props.items || [];
    this.title = props.title || '';
    this.style = props.style || {};
    this.activeIndex = props.activeIndex !== undefined ? props.activeIndex : 0;
    this.loop = props.loop !== undefined ? props.loop : false;
    this.showIndicators = props.showIndicators !== undefined ? props.showIndicators : true;
  }

  /**
   * Validates the carousel component
   * @returns {boolean} True if valid, false otherwise
   * @throws {Error} If validation fails
   */
  validate() {
    if (!Array.isArray(this.items)) {
      throw new Error('Carousel items must be an array');
    }

    if (this.items.length === 0) {
      throw new Error('Carousel must have at least one item');
    }

    // Validate each item is a UIComponent
    this.items.forEach((item, index) => {
      if (!(item instanceof UIComponent)) {
        throw new Error(`Carousel item at index ${index} is not a valid UI component`);
      }
      
      // Validate each item individually
      item.validate();
    });

    if (this.activeIndex < 0 || this.activeIndex >= this.items.length) {
      throw new Error(`Active index ${this.activeIndex} is out of bounds for carousel with ${this.items.length} items`);
    }

    return true;
  }

  /**
   * Sets the items in the carousel
   * @param {Array} items - New items to display
   * @returns {CarouselComponent} This component instance
   */
  setItems(items) {
    if (!Array.isArray(items)) {
      throw new Error('Carousel items must be an array');
    }
    
    this.items = items;
    
    // Reset active index if it's out of bounds
    if (this.activeIndex >= this.items.length) {
      this.activeIndex = Math.max(0, this.items.length - 1);
    }
    
    return this;
  }

  /**
   * Sets the active item index
   * @param {number} index - Index to set as active
   * @returns {CarouselComponent} This component instance
   */
  setActiveIndex(index) {
    if (index < 0 || index >= this.items.length) {
      throw new Error(`Index ${index} is out of bounds for carousel with ${this.items.length} items`);
    }
    
    this.activeIndex = index;
    return this;
  }

  /**
   * Gets a serializable representation of the component
   * @returns {Object} Component data for serialization
   */
  toJSON() {
    return {
      ...super.toJSON(),
      items: this.items.map(item => item.toJSON()),
      title: this.title,
      style: this.style,
      activeIndex: this.activeIndex,
      loop: this.loop,
      showIndicators: this.showIndicators
    };
  }
}

module.exports = CarouselComponent; 