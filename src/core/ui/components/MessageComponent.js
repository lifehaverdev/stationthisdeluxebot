/**
 * MessageComponent
 * 
 * A component for displaying chat-like messages with enhanced formatting.
 * Supports sender information, timestamps, and attachments alongside text content.
 */

const UIComponent = require('../interfaces/UIComponent');
const TextComponent = require('./TextComponent');

/**
 * @class MessageComponent
 * @extends UIComponent
 * @description Component for displaying chat-style messages
 */
class MessageComponent extends UIComponent {
  /**
   * Creates a new message component
   * @param {Object} props - Component properties
   * @param {string} props.text - Message text content
   * @param {string} [props.format='plain'] - Text format ('plain', 'markdown', 'html')
   * @param {string} [props.sender] - Sender name or identifier
   * @param {string} [props.avatar] - URL to sender avatar image
   * @param {Date|string} [props.timestamp] - Message timestamp
   * @param {Array} [props.attachments=[]] - List of attachment objects
   * @param {boolean} [props.isOutgoing=false] - Whether the message is outgoing (sent by user)
   * @param {Object} [props.style={}] - Custom styling properties
   */
  constructor(props = {}) {
    super(props);
    this.type = 'message';
    
    // Set defaults if not provided
    this.props.text = props.text || '';
    this.props.format = props.format || 'plain';
    this.props.sender = props.sender || null;
    this.props.avatar = props.avatar || null;
    this.props.timestamp = props.timestamp || new Date();
    this.props.attachments = props.attachments || [];
    this.props.isOutgoing = props.isOutgoing || false;
    this.props.style = props.style || {};
    
    // Create text component for the message content
    this.textComponent = new TextComponent({
      text: this.props.text,
      format: this.props.format
    });
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
    
    // Sender must be a string or null
    if (this.props.sender !== null && typeof this.props.sender !== 'string') {
      return false;
    }
    
    // Avatar must be a string or null
    if (this.props.avatar !== null && typeof this.props.avatar !== 'string') {
      return false;
    }
    
    // Attachments must be an array
    if (!Array.isArray(this.props.attachments)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Set the message text
   * @param {string} text - New message text
   * @returns {MessageComponent} This component
   */
  setText(text) {
    this.props.text = text;
    this.textComponent.setText(text);
    return this;
  }
  
  /**
   * Set the text format
   * @param {string} format - New format ('plain', 'markdown', 'html')
   * @returns {MessageComponent} This component
   */
  setFormat(format) {
    this.props.format = format;
    this.textComponent.setFormat(format);
    return this;
  }
  
  /**
   * Set the sender information
   * @param {string} sender - Sender name or identifier
   * @param {string} [avatar] - URL to sender avatar image
   * @returns {MessageComponent} This component
   */
  setSender(sender, avatar = null) {
    this.props.sender = sender;
    if (avatar !== null) {
      this.props.avatar = avatar;
    }
    return this;
  }
  
  /**
   * Set the message timestamp
   * @param {Date|string} timestamp - Message timestamp
   * @returns {MessageComponent} This component
   */
  setTimestamp(timestamp) {
    this.props.timestamp = timestamp;
    return this;
  }
  
  /**
   * Add an attachment to the message
   * @param {Object} attachment - Attachment object
   * @returns {MessageComponent} This component
   */
  addAttachment(attachment) {
    this.props.attachments.push(attachment);
    return this;
  }
  
  /**
   * Set whether the message is outgoing (sent by user)
   * @param {boolean} isOutgoing - Whether the message is outgoing
   * @returns {MessageComponent} This component
   */
  setOutgoing(isOutgoing) {
    this.props.isOutgoing = isOutgoing;
    return this;
  }
  
  /**
   * Get a formatted timestamp string
   * @returns {string} Formatted timestamp
   */
  getFormattedTimestamp() {
    let timestamp = this.props.timestamp;
    
    // Convert string to Date if needed
    if (typeof timestamp === 'string') {
      timestamp = new Date(timestamp);
    }
    
    // Format the timestamp - platforms can implement their own formatting
    try {
      // Check if date is valid first
      if (isNaN(timestamp.getTime())) {
        return '';
      }
      return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }
  
  /**
   * Get the text component for this message
   * @returns {TextComponent} The text component
   */
  getTextComponent() {
    return this.textComponent;
  }
  
  /**
   * Gets a serializable representation of the component
   * @returns {Object} Component data for serialization
   */
  toJSON() {
    const json = super.toJSON();
    
    // Format timestamp if it's a Date object
    if (json.props.timestamp instanceof Date) {
      json.props.timestamp = json.props.timestamp.toISOString();
    }
    
    return json;
  }
}

module.exports = MessageComponent; 