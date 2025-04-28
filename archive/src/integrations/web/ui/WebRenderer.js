/**
 * WebRenderer
 * 
 * Renders UI components for web platforms.
 * Transforms abstract UI components into web-specific formats 
 * (HTML elements, CSS styles, and JavaScript event handlers).
 */

const { UIRenderer } = require('../../../core/ui/interfaces');

/**
 * @class WebRenderer
 * @extends UIRenderer
 * @description Renders UI components for web platforms
 */
class WebRenderer extends UIRenderer {
  /**
   * Creates a new web renderer
   * @param {Object} options - Renderer options
   * @param {Object} options.socket - WebSocket instance for real-time updates
   * @param {Object} options.elementMap - Map to track DOM elements by component ID
   */
  constructor(options = {}) {
    super(options);
    this.platform = 'web';
    this.socket = options.socket;
    this.elementMap = options.elementMap || new Map();
    
    // Component type to render function mapping
    this.renderMethods = {
      'text': this.renderText.bind(this),
      'button': this.renderButton.bind(this),
      'input': this.renderInput.bind(this),
      'select': this.renderSelect.bind(this),
      'message': this.renderMessage.bind(this),
      'carousel': this.renderCarousel.bind(this)
    };
  }

  /**
   * Check if this renderer supports the given component type
   * @param {string} componentType - Component type to check
   * @returns {boolean} True if supported
   */
  supportsComponentType(componentType) {
    return Object.keys(this.renderMethods).includes(componentType);
  }

  /**
   * Render a UI component
   * @param {UIComponent} component - Component to render
   * @param {Object} context - Rendering context
   * @param {string} context.containerId - Container element ID
   * @returns {Promise<Object>} Rendering result with element reference
   */
  async render(component, context) {
    if (!context.containerId) {
      throw new Error('containerId is required in context for web rendering');
    }
    
    const renderMethod = this.renderMethods[component.type];
    
    if (!renderMethod) {
      throw new Error(`Unsupported component type: ${component.type}`);
    }
    
    const result = await renderMethod(component, context);
    
    // Store element reference for future updates
    if (result.elementId) {
      this.elementMap.set(component.id, result);
    }
    
    return result;
  }

  /**
   * Update a previously rendered component
   * @param {UIComponent} component - Updated component
   * @param {Object} renderReference - Reference to the original rendered component
   * @param {Object} context - Rendering context
   * @returns {Promise<Object>} Update result
   */
  async update(component, renderReference, context) {
    if (!renderReference || !renderReference.elementId) {
      throw new Error('Valid element reference is required for update');
    }
    
    // Different update logic based on component type
    switch (component.type) {
      case 'text':
        return this.updateText(component, renderReference);
      case 'button':
        return this.updateButton(component, renderReference);
      case 'input':
        return this.updateInput(component, renderReference);
      case 'select':
        return this.updateSelect(component, renderReference);
      case 'message':
        return this.updateMessage(component, renderReference);
      case 'carousel':
        return this.updateCarousel(component, renderReference);
      default:
        throw new Error(`Unsupported component type for update: ${component.type}`);
    }
  }

  /**
   * Process user input for a component
   * @param {Object} input - Web input event
   * @param {UIComponent} component - Component that should receive input
   * @param {Object} context - Processing context
   * @returns {Promise<Object>} Processing result
   */
  async processInput(input, component, context) {
    // Process based on input and component type
    switch (component.type) {
      case 'button':
        return this.processButtonClick(input, component, context);
      case 'input':
        return this.processTextInput(input, component, context);
      case 'select':
        return this.processSelectChange(input, component, context);
      case 'carousel':
        return this.processCarouselAction(input, component, context);
      default:
        return { handled: false };
    }
  }

  /**
   * Remove/hide a rendered component
   * @param {Object} renderReference - Reference to the rendered component
   * @param {Object} context - Additional context
   * @returns {Promise<boolean>} Success indicator
   */
  async remove(renderReference, context) {
    if (!renderReference || !renderReference.elementId) {
      throw new Error('Valid element reference is required for removal');
    }
    
    try {
      // Use socket or direct DOM manipulation based on context
      if (this.socket && context.userId) {
        // Send removal message through socket
        this.socket.emit('removeElement', {
          userId: context.userId,
          elementId: renderReference.elementId
        });
      } else {
        // Direct DOM removal (client-side)
        const script = `
          const element = document.getElementById('${renderReference.elementId}');
          if (element) element.remove();
        `;
        
        // Execute script (implementation depends on context)
        if (context.executeScript) {
          context.executeScript(script);
        }
      }
      
      // Remove from element map
      this.elementMap.delete(renderReference.componentId);
      
      return true;
    } catch (error) {
      console.error('Error removing web element:', error);
      return false;
    }
  }

  /**
   * Render a text component
   * @param {TextComponent} component - Text component to render
   * @param {Object} context - Rendering context
   * @returns {Promise<Object>} Rendering result
   * @private
   */
  async renderText(component, context) {
    const { containerId } = context;
    const { text, format, style = {} } = component.props;
    const elementId = `text-${component.id}`;
    
    // Create HTML for text component
    let html = `<div id="${elementId}" class="ui-text ${style.className || ''}" style="${this.buildStyleString(style)}">`;
    
    // Apply formatting
    if (format === 'markdown') {
      // Simple markdown-to-HTML conversion (would use a proper library in production)
      html += this.convertMarkdownToHtml(text);
    } else if (format === 'html') {
      // HTML is already in the right format
      html += text;
    } else {
      // Plain text - escape HTML entities
      html += this.escapeHtml(text);
    }
    
    html += '</div>';
    
    // Insert HTML into container
    if (this.socket && context.userId) {
      // Send through socket for remote clients
      this.socket.emit('renderElement', {
        userId: context.userId,
        containerId: containerId,
        html: html
      });
    } else if (context.executeScript) {
      // Direct DOM insertion (client-side)
      const script = `
        const container = document.getElementById('${containerId}');
        if (container) container.innerHTML += ${JSON.stringify(html)};
      `;
      context.executeScript(script);
    }
    
    return {
      elementId: elementId,
      containerId: containerId,
      componentId: component.id,
      html: html
    };
  }

  /**
   * Render a button component
   * @param {ButtonComponent} component - Button component to render
   * @param {Object} context - Rendering context
   * @returns {Promise<Object>} Rendering result
   * @private
   */
  async renderButton(component, context) {
    const { containerId } = context;
    const { text, action, actionId, style = {}, disabled, url } = component.props;
    const elementId = `button-${component.id}`;
    
    // Determine button type and styling
    let buttonClass = 'ui-button';
    if (style.type === 'primary') buttonClass += ' primary';
    if (style.type === 'danger') buttonClass += ' danger';
    if (style.className) buttonClass += ` ${style.className}`;
    
    // Create HTML for button component
    let html = '';
    if (url) {
      // Link button
      html = `<a id="${elementId}" class="${buttonClass}" href="${url}" style="${this.buildStyleString(style)}" 
        ${disabled ? 'disabled' : ''}>${this.escapeHtml(text)}</a>`;
    } else {
      // Action button
      html = `<button id="${elementId}" class="${buttonClass}" data-action="${actionId}" 
        style="${this.buildStyleString(style)}" ${disabled ? 'disabled' : ''}>${this.escapeHtml(text)}</button>`;
    }
    
    // Insert HTML and add event listener
    if (this.socket && context.userId) {
      // Send through socket for remote clients
      this.socket.emit('renderElement', {
        userId: context.userId,
        containerId: containerId,
        html: html,
        eventHandlers: [{
          elementId: elementId,
          event: 'click',
          action: actionId
        }]
      });
    } else if (context.executeScript) {
      // Direct DOM insertion and event binding (client-side)
      const script = `
        const container = document.getElementById('${containerId}');
        if (container) {
          container.innerHTML += ${JSON.stringify(html)};
          const button = document.getElementById('${elementId}');
          if (button) {
            button.addEventListener('click', function(e) {
              e.preventDefault();
              window.dispatchAction({
                type: 'button_click',
                componentId: '${component.id}',
                actionId: '${actionId}'
              });
            });
          }
        }
      `;
      context.executeScript(script);
    }
    
    return {
      elementId: elementId,
      containerId: containerId,
      componentId: component.id,
      html: html
    };
  }

  /**
   * Render an input component
   * @param {InputComponent} component - Input component to render
   * @param {Object} context - Rendering context
   * @returns {Promise<Object>} Rendering result
   * @private
   */
  async renderInput(component, context) {
    const { containerId } = context;
    const { label, placeholder, value, type, required, multiline, style = {} } = component.props;
    const elementId = `input-${component.id}`;
    const labelId = `label-${component.id}`;
    
    // Create HTML for input component
    let html = `<div class="input-container" style="${this.buildStyleString(style.container || {})}">`;
    
    // Add label if provided
    if (label) {
      html += `<label id="${labelId}" for="${elementId}" class="input-label">${this.escapeHtml(label)}</label>`;
    }
    
    // Create input or textarea
    if (multiline) {
      html += `<textarea id="${elementId}" class="ui-input multiline ${style.className || ''}" 
        placeholder="${this.escapeHtml(placeholder || '')}" 
        ${required ? 'required' : ''}
        style="${this.buildStyleString(style)}">${this.escapeHtml(value || '')}</textarea>`;
    } else {
      html += `<input id="${elementId}" class="ui-input ${style.className || ''}" 
        type="${type || 'text'}" 
        value="${this.escapeHtml(value || '')}" 
        placeholder="${this.escapeHtml(placeholder || '')}" 
        ${required ? 'required' : ''}
        style="${this.buildStyleString(style)}" />`;
    }
    
    html += '</div>';
    
    // Insert HTML and add event listeners
    if (this.socket && context.userId) {
      // Send through socket for remote clients
      this.socket.emit('renderElement', {
        userId: context.userId,
        containerId: containerId,
        html: html,
        eventHandlers: [{
          elementId: elementId,
          event: 'input',
          debounce: 300
        }]
      });
    } else if (context.executeScript) {
      // Direct DOM insertion and event binding (client-side)
      const script = `
        const container = document.getElementById('${containerId}');
        if (container) {
          container.innerHTML += ${JSON.stringify(html)};
          const input = document.getElementById('${elementId}');
          if (input) {
            input.addEventListener('input', function(e) {
              window.dispatchAction({
                type: 'input_change',
                componentId: '${component.id}',
                value: e.target.value
              });
            });
          }
        }
      `;
      context.executeScript(script);
    }
    
    return {
      elementId: elementId,
      containerId: containerId,
      componentId: component.id,
      html: html,
      labelId: labelId
    };
  }

  /**
   * Helper to build CSS style string from style object
   * @param {Object} styleObj - Style object with camelCase properties
   * @returns {string} CSS style string
   * @private
   */
  buildStyleString(styleObj) {
    return Object.entries(styleObj)
      .filter(([key, value]) => key !== 'className' && key !== 'type')
      .map(([key, value]) => {
        // Convert camelCase to kebab-case
        const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        return `${cssKey}: ${value};`;
      })
      .join(' ');
  }

  /**
   * Helper to escape HTML entities
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   * @private
   */
  escapeHtml(text) {
    if (typeof text !== 'string') {
      return '';
    }
    
    const htmlEntities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    
    return text.replace(/[&<>"']/g, char => htmlEntities[char]);
  }

  /**
   * Helper to convert simple markdown to HTML
   * @param {string} markdown - Markdown text
   * @returns {string} HTML text
   * @private
   */
  convertMarkdownToHtml(markdown) {
    if (typeof markdown !== 'string') {
      return '';
    }
    
    let html = markdown;
    
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Italic
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Links
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
    
    // Line breaks
    html = html.replace(/\n/g, '<br />');
    
    return html;
  }

  /**
   * Update text component
   * @param {TextComponent} component - Updated component
   * @param {Object} renderReference - Reference to rendered component
   * @returns {Promise<Object>} Update result
   * @private
   */
  async updateText(component, renderReference) {
    const { text, format, style = {} } = component.props;
    const { elementId } = renderReference;
    
    // Generate updated text content
    let content = '';
    if (format === 'markdown') {
      content = this.convertMarkdownToHtml(text);
    } else if (format === 'html') {
      content = text;
    } else {
      content = this.escapeHtml(text);
    }
    
    // Update element
    if (this.socket) {
      // Send through socket for remote clients
      this.socket.emit('updateElement', {
        elementId: elementId,
        content: content,
        style: this.buildStyleString(style)
      });
    } else if (renderReference.context?.executeScript) {
      // Direct DOM update (client-side)
      const script = `
        const element = document.getElementById('${elementId}');
        if (element) {
          element.innerHTML = ${JSON.stringify(content)};
          element.style = "${this.buildStyleString(style)}";
          if ('${style.className || ''}') {
            element.className = 'ui-text ${style.className || ''}';
          }
        }
      `;
      renderReference.context.executeScript(script);
    }
    
    // Update reference
    renderReference.html = `<div id="${elementId}" class="ui-text ${style.className || ''}" style="${this.buildStyleString(style)}">${content}</div>`;
    
    return renderReference;
  }

  /**
   * Process button click
   * @param {Object} input - Click event data
   * @param {ButtonComponent} component - Button component
   * @param {Object} context - Processing context
   * @returns {Promise<Object>} Processing result
   * @private
   */
  async processButtonClick(input, component, context) {
    const { action, actionId } = component.props;
    const payload = component.createActionPayload();
    
    // Handle action
    return {
      handled: true,
      action: actionId,
      payload
    };
  }

  // Additional methods for rendering and updating other component types
  // would be implemented here in a full implementation

  /**
   * Placeholder for rendering Select component
   */
  async renderSelect(component, context) {
    // Implementation would be similar to renderInput but with <select> and <option> elements
    return {
      elementId: `select-${component.id}`,
      containerId: context.containerId,
      componentId: component.id,
      html: `<div id="select-${component.id}">Select placeholder</div>`
    };
  }

  /**
   * Placeholder for rendering Message component
   */
  async renderMessage(component, context) {
    // Implementation would include sender, text, and attachments in a message bubble
    return {
      elementId: `message-${component.id}`,
      containerId: context.containerId,
      componentId: component.id,
      html: `<div id="message-${component.id}">Message placeholder</div>`
    };
  }

  /**
   * Placeholder for rendering Carousel component
   */
  async renderCarousel(component, context) {
    // Implementation would include a container with horizontally scrollable items
    return {
      elementId: `carousel-${component.id}`,
      containerId: context.containerId,
      componentId: component.id,
      html: `<div id="carousel-${component.id}">Carousel placeholder</div>`
    };
  }

  /**
   * Update button component - placeholder implementation
   */
  async updateButton(component, renderReference) {
    // Would update button text, style, disabled state, etc.
    return renderReference;
  }

  /**
   * Update input component - placeholder implementation
   */
  async updateInput(component, renderReference) {
    // Would update input value, placeholder, etc.
    return renderReference;
  }

  /**
   * Update select component - placeholder implementation
   */
  async updateSelect(component, renderReference) {
    // Would update select options, value, etc.
    return renderReference;
  }

  /**
   * Update message component - placeholder implementation
   */
  async updateMessage(component, renderReference) {
    // Would update message content
    return renderReference;
  }

  /**
   * Update carousel component - placeholder implementation
   */
  async updateCarousel(component, renderReference) {
    // Would update carousel items
    return renderReference;
  }

  /**
   * Process text input - placeholder implementation
   */
  async processTextInput(input, component, context) {
    return { handled: true, value: input.value };
  }

  /**
   * Process select change - placeholder implementation
   */
  async processSelectChange(input, component, context) {
    return { handled: true, value: input.value };
  }

  /**
   * Process carousel action - placeholder implementation
   */
  async processCarouselAction(input, component, context) {
    return { handled: true, action: input.action };
  }
}

module.exports = WebRenderer; 