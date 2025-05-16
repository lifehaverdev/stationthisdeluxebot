/**
 * ButtonComponent
 * 
 * Interactive button component for triggering actions.
 * Can be rendered as a clickable button on various platforms.
 */

const UIComponent = require('../interfaces/UIComponent');

/**
 * @class ButtonComponent
 * @extends UIComponent
 * @description Component for interactive buttons
 */
class ButtonComponent extends UIComponent {
  /**
   * Creates a new button component
   * @param {Object} props - Component properties
   * @param {string} props.text - Button text
   * @param {string} [props.action='default'] - Action identifier
   * @param {Object} [props.data={}] - Data to associate with button
   * @param {string} [props.style='default'] - Button style ('default', 'primary', 'danger', etc.)
   * @param {boolean} [props.disabled=false] - Whether the button is disabled
   * @param {string} [props.url] - URL to navigate to (for link buttons)
   */
  constructor(props = {}) {
    super(props);
    this.type = 'button';
    
    // Set defaults if not provided
    this.props.text = props.text || 'Button';
    this.props.action = props.action || 'default';
    this.props.data = props.data || {};
    this.props.style = props.style || 'default';
    this.props.disabled = props.disabled || false;
    
    // URL is optional
    if (props.url) {
      this.props.url = props.url;
    }
    
    // Generate a unique action ID if not provided
    this.props.actionId = props.actionId || `btn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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
    
    // Action must be a string
    if (typeof this.props.action !== 'string') {
      return false;
    }
    
    // Action ID must be a string
    if (typeof this.props.actionId !== 'string') {
      return false;
    }
    
    // URL must be a string if provided
    if (this.props.url !== undefined && typeof this.props.url !== 'string') {
      return false;
    }
    
    return true;
  }
  
  /**
   * Set the button text
   * @param {string} text - New button text
   * @returns {ButtonComponent} This component
   */
  setText(text) {
    this.props.text = text;
    return this;
  }
  
  /**
   * Set the button action
   * @param {string} action - New action identifier
   * @returns {ButtonComponent} This component
   */
  setAction(action) {
    this.props.action = action;
    return this;
  }
  
  /**
   * Set the button style
   * @param {string} style - New style ('default', 'primary', 'danger', etc.)
   * @returns {ButtonComponent} This component
   */
  setStyle(style) {
    this.props.style = style;
    return this;
  }
  
  /**
   * Set the button enabled/disabled state
   * @param {boolean} disabled - Whether the button should be disabled
   * @returns {ButtonComponent} This component
   */
  setDisabled(disabled) {
    this.props.disabled = disabled;
    return this;
  }
  
  /**
   * Set the URL for link buttons
   * @param {string} url - URL to navigate to
   * @returns {ButtonComponent} This component
   */
  setUrl(url) {
    this.props.url = url;
    return this;
  }
  
  /**
   * Check if the button is a link button
   * @returns {boolean} True if it's a link button
   */
  isLinkButton() {
    return typeof this.props.url === 'string' && this.props.url.length > 0;
  }
  
  /**
   * Create an action payload for this button
   * @returns {Object} Action payload
   */
  createActionPayload() {
    return {
      type: 'button_click',
      componentId: this.id,
      actionId: this.props.actionId,
      action: this.props.action,
      data: this.props.data
    };
  }
}

module.exports = ButtonComponent; 