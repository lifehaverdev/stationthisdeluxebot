/**
 * TextComponent
 * 
 * A basic component for displaying text content.
 * Supports simple formatting options.
 */

const UIComponent = require('../interfaces/UIComponent');

/**
 * @class TextComponent
 * @extends UIComponent
 * @description Component for displaying text content
 */
class TextComponent extends UIComponent {
  /**
   * Creates a new text component
   * @param {Object} props - Component properties
   * @param {string} props.text - Text content
   * @param {string} [props.format='plain'] - Text format ('plain', 'markdown', 'html')
   * @param {boolean} [props.inline=false] - Whether the text should be displayed inline
   * @param {Object} [props.style={}] - Styling properties
   */
  constructor(props = {}) {
    super(props);
    this.type = 'text';
    
    // Set defaults if not provided
    this.props.text = props.text || '';
    this.props.format = props.format || 'plain';
    this.props.inline = props.inline || false;
    this.props.style = props.style || {};
  }

  /**
   * Validate the component properties
   * @returns {boolean} True if valid, false otherwise
   */
  validate() {
    // Text must be a string
    if (typeof this.props.text !== 'string') {
      return false;
    }
    
    // Format must be one of the supported formats
    const validFormats = ['plain', 'markdown', 'html'];
    if (!validFormats.includes(this.props.format)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Set the text content
   * @param {string} text - New text content
   * @returns {TextComponent} This component
   */
  setText(text) {
    this.props.text = text;
    return this;
  }
  
  /**
   * Set the text format
   * @param {string} format - New format ('plain', 'markdown', 'html')
   * @returns {TextComponent} This component
   */
  setFormat(format) {
    this.props.format = format;
    return this;
  }
  
  /**
   * Apply formatting to a text string
   * @param {string} text - Text to format
   * @param {string} format - Format to apply
   * @returns {string} Formatted text
   */
  static applyFormat(text, format) {
    // This is a simple implementation - platforms would implement
    // their own specific formatting logic
    switch (format) {
      case 'markdown':
        // Apply simple markdown escaping
        return text.replace(/([*_`])/g, '\\$1');
      case 'html':
        // Apply simple HTML escaping
        return text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      case 'plain':
      default:
        return text;
    }
  }
}

module.exports = TextComponent; 